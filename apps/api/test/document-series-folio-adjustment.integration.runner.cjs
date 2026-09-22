const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createAuthenticatedTestSession, cleanupAuthenticatedTestSession } = require('./support/test-auth.cjs');

// Local development may keep TEST credentials in apps/api/.env. Only the two explicit TEST URLs
// are imported; no DB_*, DATABASE_URL, or production fallback is accepted by this runner.
for (const envPath of [path.resolve(__dirname, '../.env')]) {
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^(TEST_DATABASE_URL|TEST_DATABASE_URL_MIGRATOR)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim();
  }
}

const port = 3115;
const apiDirectory = path.resolve(__dirname, '..');
const automationCode = 'REMISIONES_CATERPILLAR';
const seriesCode = 'REMISION_CAT_P5';
const expectedFloor = 119;
const marker = `HUB_TEST_FOLIO_ADJUSTMENT_${randomUUID().replace(/-/g, '').toUpperCase()}`;
const reasons = {
  forward: `${marker}_FORWARD`,
  backward: `${marker}_BACKWARD`,
  stale: `${marker}_STALE`,
  belowFloor: `${marker}_BELOW_FLOOR`,
  general: `${marker}_GENERAL`,
  recovery: `${marker}_RECOVERY`
};

function assert(condition, message) { if (!condition) throw new Error(message); }

function requireGuardedUrl(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be explicitly set for the document-series folio adjustment integration test.`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid PostgreSQL URL.`); }
  const databaseName = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (databaseName !== 'daubert_hub_test') throw new Error(`${name} must point exactly to daubert_hub_test; got "${databaseName}".`);
  return { value, url, databaseName };
}

async function verifyIdentity(pool, label) {
  const row = (await pool.query('SELECT current_database() AS database_name, current_user AS database_user')).rows[0];
  assert(row.database_name === 'daubert_hub_test', `${label} connected to unexpected database "${row.database_name}".`);
  return row.database_user;
}

async function waitForApi(api, startupState) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (startupState.error) throw new Error(`Document-series integration API failed to start: ${startupState.error.message}`);
    if (api.exitCode !== null) throw new Error(`Document-series integration API exited during startup with code ${api.exitCode}.${startupState.output.trim() ? `\n${startupState.output.trim()}` : ''}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for the document-series integration API.${startupState.output.trim() ? `\n${startupState.output.trim()}` : ''}`);
}

async function apiRequest(method, cookie, body) {
  const response = await fetch(`http://127.0.0.1:${port}/api/automations/${automationCode}/document-series/${seriesCode}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { response, body: await response.json().catch(() => null) };
}

async function readSeries(pool) {
  const result = await pool.query(`
    SELECT serie_id::text, siguiente_folio::text, folio_minimo_ajustable::text
    FROM operacion.series_documentales
    WHERE codigo = $1`, [seriesCode]);
  assert(result.rows.length === 1, `Expected exactly one ${seriesCode} row, found ${result.rows.length}.`);
  return {
    seriesId: result.rows[0].serie_id,
    current: Number(result.rows[0].siguiente_folio),
    floor: result.rows[0].folio_minimo_ajustable === null ? null : Number(result.rows[0].folio_minimo_ajustable)
  };
}

async function readAuditBaseline(pool, seriesId) {
  const row = (await pool.query(`
    SELECT count(*)::int AS count, COALESCE(max(ajuste_id), 0)::text AS max_id
    FROM operacion.ajustes_series
    WHERE serie_id = $1`, [seriesId])).rows[0];
  return { count: row.count, maxId: row.max_id };
}

async function readAuditRows(pool, seriesId) {
  return (await pool.query(`
    SELECT ajuste_id::text, siguiente_folio_anterior::text, siguiente_folio_nuevo::text,
      motivo, usuario_id::text, usuario_email
    FROM operacion.ajustes_series
    WHERE serie_id = $1 AND motivo = ANY($2::text[])
    ORDER BY ajuste_id`, [seriesId, Object.values(reasons)])).rows;
}

async function historySnapshot(pool, table, idColumn, seriesId) {
  assert(['remisiones', 'reservas_folios'].includes(table), `Unexpected snapshot table ${table}.`);
  assert(['remision_id', 'reserva_id'].includes(idColumn), `Unexpected snapshot ID column ${idColumn}.`);
  const row = (await pool.query(`
    SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(row_to_json(snapshot_row)::text, '|' ORDER BY snapshot_row.${idColumn}), '')) AS fingerprint
    FROM (SELECT * FROM operacion.${table} WHERE serie_id = $1) snapshot_row`, [seriesId])).rows[0];
  return `${row.count}:${row.fingerprint}`;
}

async function assertHistoryUnchanged(pool, seriesId, before) {
  const after = {
    remissions: await historySnapshot(pool, 'remisiones', 'remision_id', seriesId),
    reservations: await historySnapshot(pool, 'reservas_folios', 'reserva_id', seriesId)
  };
  assert(after.remissions === before.remissions, 'operacion.remisiones changed during folio adjustment E2E.');
  assert(after.reservations === before.reservations, 'operacion.reservas_folios changed during folio adjustment E2E.');
}

async function assertCounterAndAudit(pool, seriesId, expectedCurrent, expectedAuditCount) {
  const series = await readSeries(pool);
  const audit = await readAuditBaseline(pool, seriesId);
  assert(series.current === expectedCurrent, `Expected siguiente_folio=${expectedCurrent}, got ${series.current}.`);
  assert(audit.count === expectedAuditCount, `Expected ${expectedAuditCount} audit rows, got ${audit.count}.`);
}

async function cleanupAuthWithMigrator(migratorUrl, sessions) {
  // The application role intentionally cannot delete security fixtures. Reuse the established
  // helper with the explicitly required TEST migrator identity only for exact-ID fixture cleanup.
  const previous = process.env.TEST_DATABASE_ADMIN_URL;
  process.env.TEST_DATABASE_ADMIN_URL = migratorUrl;
  try {
    for (const session of sessions) await cleanupAuthenticatedTestSession(session);
  } finally {
    if (previous === undefined) delete process.env.TEST_DATABASE_ADMIN_URL;
    else process.env.TEST_DATABASE_ADMIN_URL = previous;
  }
}

async function createSessionWithCleanupCredential(apiBaseUrl, markerPrefix, role, migratorUrl) {
  // The spawned API has already received its environment and never sees this credential. It is
  // exposed only while the auth helper creates a runtime-role user, so its own failure path can
  // delete that exact synthetic fixture if setup does not complete.
  const previous = process.env.TEST_DATABASE_ADMIN_URL;
  process.env.TEST_DATABASE_ADMIN_URL = migratorUrl;
  try {
    return await createAuthenticatedTestSession(apiBaseUrl, markerPrefix, { role });
  } finally {
    if (previous === undefined) delete process.env.TEST_DATABASE_ADMIN_URL;
    else process.env.TEST_DATABASE_ADMIN_URL = previous;
  }
}

async function run() {
  const runtime = requireGuardedUrl('TEST_DATABASE_URL');
  const migrator = requireGuardedUrl('TEST_DATABASE_URL_MIGRATOR');
  const runtimePool = new Pool({ connectionString: runtime.value });
  const migratorPool = new Pool({ connectionString: migrator.value });
  const sessions = [];
  let api;
  let adminSession;
  let baseline;
  let baselineAudit;
  let historyBefore;
  let databaseVerified = false;
  let primaryError;

  try {
    const runtimeUser = await verifyIdentity(runtimePool, 'TEST_DATABASE_URL');
    const migratorUser = await verifyIdentity(migratorPool, 'TEST_DATABASE_URL_MIGRATOR');
    databaseVerified = true;

    baseline = await readSeries(runtimePool);
    assert(baseline.floor === expectedFloor, `Expected ${seriesCode} floor ${expectedFloor}, got ${baseline.floor}.`);
    assert(baseline.current >= baseline.floor, `Baseline siguiente_folio ${baseline.current} is below configured floor ${baseline.floor}; safe HTTP restoration would be impossible.`);
    baselineAudit = await readAuditBaseline(runtimePool, baseline.seriesId);

    const rangeEnd = baseline.current + 2;
    const remissionConflicts = (await runtimePool.query(`
      SELECT remision_id::text, folio::text, estatus
      FROM operacion.remisiones
      WHERE serie_id = $1 AND folio BETWEEN $2 AND $3 AND estatus <> 'CANCELADA'
      ORDER BY folio, remision_id`, [baseline.seriesId, baseline.current, rangeEnd])).rows;
    const reservationConflicts = (await runtimePool.query(`
      SELECT reserva_id::text, folio_inicial::text, folio_final::text, estatus
      FROM operacion.reservas_folios
      WHERE serie_id = $1 AND folio_inicial <= $3 AND folio_final >= $2
      ORDER BY folio_inicial, reserva_id`, [baseline.seriesId, baseline.current, rangeEnd])).rows;
    if (remissionConflicts.length || reservationConflicts.length) {
      throw new Error(`PREFLIGHT CONFLICT: planned reused range ${baseline.current}-${rangeEnd} is not clean. remisiones=${JSON.stringify(remissionConflicts)} reservas=${JSON.stringify(reservationConflicts)}`);
    }

    historyBefore = {
      remissions: await historySnapshot(runtimePool, 'remisiones', 'remision_id', baseline.seriesId),
      reservations: await historySnapshot(runtimePool, 'reservas_folios', 'reserva_id', baseline.seriesId)
    };
    console.log(`Preflight clean: ${seriesCode} serie_id=${baseline.seriesId}, current=${baseline.current}, floor=${baseline.floor}, reusedRange=${baseline.current}-${rangeEnd}, auditCount=${baselineAudit.count}, auditMaxId=${baselineAudit.maxId}.`);
    console.log(`Verified TEST identities: runtime=${runtimeUser}, migrator=${migratorUser}; both current_database()=daubert_hub_test.`);

    api = spawn(process.execPath, ['dist/src/main.js'], {
      cwd: apiDirectory,
      env: {
        ...process.env,
        DB_HOST: runtime.url.hostname,
        DB_PORT: runtime.url.port || '5432',
        DB_NAME: runtime.databaseName,
        DB_USER: decodeURIComponent(runtime.url.username),
        DB_PASSWORD: decodeURIComponent(runtime.url.password),
        API_PORT: String(port),
        AUTH_COOKIE_SECURE: 'false'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const startupState = { output: '', error: null };
    api.stdout.on('data', (chunk) => { startupState.output += chunk; });
    api.stderr.on('data', (chunk) => { startupState.output += chunk; });
    api.on('error', (error) => { startupState.error = error; });
    await waitForApi(api, startupState);

    const generalSession = await createSessionWithCleanupCredential(`http://127.0.0.1:${port}/api`, `${marker}_GENERAL`, 'GENERAL', migrator.value);
    sessions.push(generalSession);
    adminSession = await createSessionWithCleanupCredential(`http://127.0.0.1:${port}/api`, `${marker}_ADMIN`, 'ADMIN', migrator.value);
    sessions.push(adminSession);

    const generalGet = await apiRequest('GET', generalSession.cookie);
    assert(generalGet.response.status === 200, `GENERAL GET failed: ${generalGet.response.status} ${JSON.stringify(generalGet.body)}`);
    assert(generalGet.body.data.series.nextFolio === baseline.current, 'GENERAL GET returned an unexpected baseline folio.');

    const forwardTarget = baseline.current + 3;
    const forward = await apiRequest('PATCH', adminSession.cookie, {
      expectedCurrentFolio: baseline.current,
      nextFolio: forwardTarget,
      reason: reasons.forward
    });
    assert(forward.response.status === 200, `ADMIN forward adjustment failed: ${forward.response.status} ${JSON.stringify(forward.body)}`);
    assert(forward.body.data.series.nextFolio === forwardTarget, 'Forward response did not contain the advanced folio.');
    await assertCounterAndAudit(runtimePool, baseline.seriesId, forwardTarget, baselineAudit.count + 1);
    await assertHistoryUnchanged(runtimePool, baseline.seriesId, historyBefore);

    const backward = await apiRequest('PATCH', adminSession.cookie, {
      expectedCurrentFolio: forwardTarget,
      nextFolio: baseline.current,
      reason: reasons.backward,
      backwardFilesystemAcknowledged: true
    });
    assert(backward.response.status === 200, `ADMIN backward restoration failed: ${backward.response.status} ${JSON.stringify(backward.body)}`);
    assert(backward.body.data.series.nextFolio === baseline.current, 'Backward response did not restore the baseline folio.');
    await assertCounterAndAudit(runtimePool, baseline.seriesId, baseline.current, baselineAudit.count + 2);
    await assertHistoryUnchanged(runtimePool, baseline.seriesId, historyBefore);

    const auditRows = await readAuditRows(runtimePool, baseline.seriesId);
    assert(auditRows.length === 2, `Expected exactly two marker audit rows, got ${auditRows.length}.`);
    const forwardAudit = auditRows.find((row) => row.motivo === reasons.forward);
    const backwardAudit = auditRows.find((row) => row.motivo === reasons.backward);
    assert(forwardAudit && Number(forwardAudit.siguiente_folio_anterior) === baseline.current && Number(forwardAudit.siguiente_folio_nuevo) === forwardTarget, 'Forward audit values are incorrect.');
    assert(backwardAudit && Number(backwardAudit.siguiente_folio_anterior) === forwardTarget && Number(backwardAudit.siguiente_folio_nuevo) === baseline.current, 'Backward audit values are incorrect.');
    for (const row of auditRows) {
      assert(row.usuario_id === adminSession.userId, `Audit ${row.ajuste_id} did not record the authenticated ADMIN user ID.`);
      assert(row.usuario_email === adminSession.email, `Audit ${row.ajuste_id} did not record the authenticated ADMIN email.`);
      assert(BigInt(row.ajuste_id) > BigInt(baselineAudit.maxId), `Audit ${row.ajuste_id} was not created after the captured baseline.`);
    }

    const stale = await apiRequest('PATCH', adminSession.cookie, {
      expectedCurrentFolio: baseline.current - 1,
      nextFolio: baseline.current + 1,
      reason: reasons.stale
    });
    assert(stale.response.status === 409 && stale.body.code === 'SERIES_FOLIO_STALE', `Stale request returned unexpected response: ${stale.response.status} ${JSON.stringify(stale.body)}`);
    await assertCounterAndAudit(runtimePool, baseline.seriesId, baseline.current, baselineAudit.count + 2);

    const belowFloor = await apiRequest('PATCH', adminSession.cookie, {
      expectedCurrentFolio: baseline.current,
      nextFolio: baseline.floor - 1,
      reason: reasons.belowFloor,
      backwardFilesystemAcknowledged: true
    });
    assert(belowFloor.response.status === 409 && belowFloor.body.code === 'SERIES_FOLIO_BELOW_FLOOR', `Below-floor request returned unexpected response: ${belowFloor.response.status} ${JSON.stringify(belowFloor.body)}`);
    await assertCounterAndAudit(runtimePool, baseline.seriesId, baseline.current, baselineAudit.count + 2);

    const generalPatch = await apiRequest('PATCH', generalSession.cookie, {
      expectedCurrentFolio: baseline.current,
      nextFolio: baseline.current + 1,
      reason: reasons.general
    });
    assert(generalPatch.response.status === 403, `GENERAL PATCH was not rejected with 403: ${generalPatch.response.status} ${JSON.stringify(generalPatch.body)}`);
    await assertCounterAndAudit(runtimePool, baseline.seriesId, baseline.current, baselineAudit.count + 2);
    await assertHistoryUnchanged(runtimePool, baseline.seriesId, historyBefore);

    console.log(`Forward HTTP E2E passed: ${baseline.current} -> ${forwardTarget}.`);
    console.log(`Backward HTTP E2E passed and restored baseline: ${forwardTarget} -> ${baseline.current}; reused range ${baseline.current}-${rangeEnd}.`);
    console.log('Stale 409, below-floor 409, GENERAL PATCH 403, and GENERAL GET 200 checks passed.');
    console.log(`Audit verification passed for ADMIN ${adminSession.email}; exactly two marker rows were retained.`);
  } catch (error) {
    primaryError = error;
  } finally {
    let finalizationError;
    try {
      if (databaseVerified && baseline) {
        const currentBeforeShutdown = await readSeries(runtimePool);
        if (currentBeforeShutdown.current !== baseline.current && adminSession && api && api.exitCode === null) {
          const recovery = await apiRequest('PATCH', adminSession.cookie, {
            expectedCurrentFolio: currentBeforeShutdown.current,
            nextFolio: baseline.current,
            reason: reasons.recovery,
            backwardFilesystemAcknowledged: true
          });
          if (recovery.response.status !== 200) {
            throw new Error(`TEST COUNTER REQUIRES REVIEW: HTTP recovery to ${baseline.current} failed with ${recovery.response.status} ${JSON.stringify(recovery.body)}. No direct SQL reset was attempted.`);
          }
          console.warn(`Recovery PATCH restored ${seriesCode} from ${currentBeforeShutdown.current} to baseline ${baseline.current}.`);
        }
      }
    } catch (error) {
      finalizationError = error;
    }

    try {
      if (api && api.exitCode === null && !api.killed) { api.kill(); await once(api, 'exit'); }
    } catch (error) {
      finalizationError ??= error;
    }

    try {
      if (databaseVerified && baseline) {
        const finalSeries = await readSeries(runtimePool);
        if (finalSeries.current !== baseline.current) {
          throw new Error(`TEST COUNTER REQUIRES REVIEW: ${seriesCode} final siguiente_folio=${finalSeries.current}, expected baseline=${baseline.current}. No direct SQL reset was attempted.`);
        }
        if (historyBefore) await assertHistoryUnchanged(runtimePool, baseline.seriesId, historyBefore);
        console.log(`Final TEST counter verified at baseline ${baseline.current}; remisiones/reservas fingerprints unchanged.`);
      }
    } catch (error) {
      finalizationError ??= error;
    }

    try { await cleanupAuthWithMigrator(migrator.value, sessions); } catch (error) { finalizationError ??= error; }
    await Promise.allSettled([runtimePool.end(), migratorPool.end()]);

    if (finalizationError) {
      if (primaryError) console.error(`Primary failure: ${primaryError.message}`);
      throw finalizationError;
    }
  }

  if (primaryError) throw primaryError;
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
