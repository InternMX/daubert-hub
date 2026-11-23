'use strict';

// Reads ONLY catalog metadata from daubert_hub_test, then closes that connection.
// All writes go to a new in-memory PGlite instance. No application is started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const fromApi = createRequire(path.resolve(__dirname, '../../apps/api/package.json'));
const { Client } = fromApi('pg');
const { PGlite } = fromApi('@electric-sql/pglite');
const guard = require('../../scripts/dev-test-only.cjs');

const tables = ['ops.automatizaciones', 'ops.ejecuciones_automatizacion', 'ops.automatizacion_series_proceso',
  'operacion.series_documentales', 'operacion.reservas_folios', 'operacion.remisiones',
  'operacion.remision_detalle', 'security.users'];
const functionNames = ['reservar_folios', 'reservar_folios_para_ejecucion', 'fn_crear_ejecucion_automatizacion',
  'fn_finalizar_ejecucion_automatizacion', 'fn_registrar_fallo_ejecucion', 'fn_registrar_remision_generada'];
const ident = value => `"${value.replaceAll('"', '""')}"`;
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function inspectTest() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--test-env-file'), 'Only --test-env-file <path> is accepted');
  const envFile = args[1] || path.resolve(__dirname, '../../apps/api/.env');
  const { url } = guard.parseGuardedTestDatabaseUrl(guard.resolveTestDatabaseUrl(process.env, envFile));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'TEST must be local');
  assert.equal(decodeURIComponent(url.username), 'daubert_hub_test_user', 'Use TEST Hub credentials, never production or admin credentials');
  assert.equal(url.search + url.hash, '', 'Connection URL options are not accepted');
  const source = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000,
    options: '-c default_transaction_read_only=on -c statement_timeout=15000' });
  try {
    await source.connect();
    const actual = (await source.query("SELECT current_database() AS db, current_setting('transaction_read_only') AS ro")).rows[0];
    assert.deepEqual(actual, { db: 'daubert_hub_test', ro: 'on' });
    const definitions = [];
    for (const table of tables) {
      const attrs = (await source.query(`SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type,
        a.attidentity, a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS default_expr
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table])).rows;
      assert.ok(attrs.length, `Missing real TEST table: ${table}`);
      const columns = attrs.map(a => `${ident(a.attname)} ${a.type}${a.attidentity ? ' GENERATED ALWAYS AS IDENTITY (START WITH 10000)' :
        a.default_expr ? ` DEFAULT ${a.default_expr}` : ''}${a.attnotnull ? ' NOT NULL' : ''}`);
      definitions.push(`CREATE TABLE ${table} (${columns.join(',')});`);
      // External FKs and audit triggers are not replicated: this is deliberately not a full integration test.
      const constraints = (await source.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid=$1::regclass AND contype IN ('p','u','c') ORDER BY conname`, [table])).rows;
      for (const c of constraints) definitions.push(`ALTER TABLE ${table} ADD CONSTRAINT ${ident(c.conname)} ${c.definition};`);
      const indexes = (await source.query(`SELECT pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i
        WHERE i.indrelid=$1::regclass AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)`, [table])).rows;
      for (const i of indexes) definitions.push(`${i.definition};`);
    }
    const functions = (await source.query(`SELECT n.nspname,p.proname,pg_get_functiondef(p.oid) AS definition,
      md5(pg_get_functiondef(p.oid)) AS fingerprint FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('operacion','ops') AND p.proname=ANY($1::text[]) ORDER BY n.nspname,p.proname`, [functionNames])).rows;
    assert.equal(functions.length, 6, 'Expected exactly the six inspected real functions');
    const modern = (await source.query(`SELECT p.oid::regprocedure::text AS signature,md5(pg_get_functiondef(p.oid)) AS fingerprint
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ops'
      AND p.proname='fn_reprocesar_reservar_caterpillar_test'`)).rows;
    assert.equal(modern.length, 1, 'Existing TEST atomic gate must be inspected before further integration');
    // Check only the locking primitive in two real read-only TEST sessions, using a fresh synthetic key.
    const other = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000,
      options: '-c default_transaction_read_only=on -c statement_timeout=5000' });
    try {
      await other.connect();
      assert.equal((await other.query('SELECT current_database() AS db')).rows[0].db, 'daubert_hub_test');
      const key = `CAT_RECOVERY:SYNTHETIC:${randomUUID()}`;
      await source.query('BEGIN READ ONLY'); await other.query('BEGIN READ ONLY');
      await source.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      assert.equal((await other.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [key])).rows[0].acquired, false);
      await source.query('ROLLBACK');
      assert.equal((await other.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [key])).rows[0].acquired, true);
      console.log('LIVE_TEST_ADVISORY_PRIMITIVE_PASS: second session excluded until rollback; synthetic key only');
    } finally { await source.query('ROLLBACK'); await other.query('ROLLBACK').catch(() => {}); await other.end(); }
    console.log('TEST_CATALOG_READ_ONLY', JSON.stringify({ functions: functions.map(f => `${f.nspname}.${f.proname}:${f.fingerprint}`), modern }));
    return { definitions, functions };
  } finally { await source.end(); }
}

async function run() {
  const catalog = await inspectTest();
  const db = new PGlite();
  const query = async (text, args = []) => (await db.query(text, args)).rows;
  let passed = 0;
  try {
    await db.exec('CREATE SCHEMA ops; CREATE SCHEMA operacion; CREATE SCHEMA security;');
    for (const sql of catalog.definitions) await db.exec(sql);
    for (const f of catalog.functions) await db.exec(f.definition);
    const sql = fs.readFileSync(path.join(__dirname, 'prototype.sql'), 'utf8');
    await assert.rejects(db.exec(sql), /CAT_RECOVERY_ISOLATED_SANDBOX_REQUIRED/);
    await db.exec("SET cat_recovery.sandbox='isolated';");
    await db.exec(sql);

    async function fixture() {
      const auto = (await query("INSERT INTO ops.automatizaciones(codigo,nombre,estatus) VALUES('REMISIONES_CATERPILLAR','Synthetic CAT','ACTIVA') RETURNING automatizacion_id"))[0].automatizacion_id;
      const series = (await query("INSERT INTO operacion.series_documentales(codigo,nombre,siguiente_folio,estatus) VALUES('SYNTHETIC_CAT','Synthetic P2',111,'ACTIVA') RETURNING serie_id"))[0].serie_id;
      await query("INSERT INTO ops.automatizacion_series_proceso(automatizacion_id,llave_proceso,serie_id,empresa_cliente_id,estatus) VALUES($1,'SYNTHETIC|P2|',$2,900001,'ACTIVA')", [auto, series]);
      const admin = (await query("INSERT INTO security.users(display_name,email,password_hash,role,status,must_change_password) VALUES('Synthetic ADMIN','synthetic@example.invalid','not-a-login-hash','ADMIN','ACTIVE',false) RETURNING user_id"))[0].user_id;
      const parent = (await query("SELECT * FROM ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR',900001,'synthetic-parent')"))[0].ejecucion_id;
      const reservation = (await query("SELECT * FROM operacion.reservar_folios_para_ejecucion($1,'SYNTHETIC_CAT',4)", [parent]))[0];
      for (const worker of ['synthetic-fail-1','synthetic-fail-2']) {
        await query("SELECT * FROM ops.fn_registrar_fallo_ejecucion($1,$2,'synthetic-node','Synthetic conversion failure')", [parent, worker]);
      }
      const child = (await query("SELECT * FROM ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR',900001,'synthetic-child',NULL,$1)", [parent]))[0].ejecucion_id;
      const originalExecution = (await query('SELECT to_jsonb(e) AS data FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=$1', [parent]))[0].data;
      const originalReservation = (await query('SELECT to_jsonb(r) AS data FROM operacion.reservas_folios r WHERE r.reserva_id=$1', [reservation.reserva_id]))[0].data;
      return { auto, series, admin, parent, child, reservation, originalExecution, originalReservation, request: randomUUID(), proof: randomUUID() };
    }
    async function proof(f, { delivery = 'UNDELIVERED', clear = true, verified = true, hash = sha256('[]') } = {}) {
      await query(`INSERT INTO cat_recovery_prototype.evidence(evidence_id,reservation_id,inventory_sha256,delivery_state,output_clear,quarantine_verified)
        VALUES($1,$2,$3,$4,$5,$6)`, [f.proof, f.reservation.reserva_id, hash, delivery, clear, verified]);
    }
    const recover = f => query('SELECT cat_recovery_prototype.recover($1,$2,$3,$4,$5,$6,true) AS id',
      [f.parent, f.child, f.proof, f.request, f.admin, 'Synthetic ADMIN confirmation: no delivery']);
    async function rejected(action, pattern) {
      await db.exec('SAVEPOINT expected_failure');
      try { await assert.rejects(action, pattern); } finally { await db.exec('ROLLBACK TO SAVEPOINT expected_failure'); }
    }
    async function coherent(f, remissions = 0, next = 115) {
      assert.equal(Number((await query('SELECT siguiente_folio FROM operacion.series_documentales WHERE serie_id=$1', [f.series]))[0].siguiente_folio), next);
      assert.equal(Number((await query('SELECT count(*) AS n FROM operacion.remisiones WHERE serie_id=$1', [f.series]))[0].n), remissions);
      assert.equal((await query('SELECT estatus FROM operacion.reservas_folios WHERE reserva_id=$1', [f.reservation.reserva_id]))[0].estatus, 'ABANDONADA');
      assert.equal((await query('SELECT estado FROM ops.ejecuciones_automatizacion WHERE ejecucion_id=$1', [f.parent]))[0].estado, 'ERROR');
      assert.deepEqual((await query('SELECT to_jsonb(e) AS data FROM ops.ejecuciones_automatizacion e WHERE e.ejecucion_id=$1', [f.parent]))[0].data, f.originalExecution);
      assert.deepEqual((await query('SELECT to_jsonb(r) AS data FROM operacion.reservas_folios r WHERE r.reserva_id=$1', [f.reservation.reserva_id]))[0].data, f.originalReservation);
    }
    async function scenario(label, action) {
      await db.exec('BEGIN');
      try { const f = await fixture(); await action(f); passed++; console.log(`PASS ${passed}: ${label}`); }
      finally { await db.exec('ROLLBACK'); }
    }

    await scenario('1. failure before PDFs: reuse 111-114 without decrementing 115', async f => {
      await proof(f); await recover(f); await coherent(f);
    });
    await scenario('2. partial synthetic PDFs: hashes retained, reject until output is isolated', async f => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', 'cat-recovery-synthetic-'));
      const output = path.join(root, 'output'); fs.mkdirSync(output);
      for (let n = 111; n <= 113; n++) fs.writeFileSync(path.join(output, `REM-${n}.pdf`), `%PDF-synthetic-${n}`, { flag: 'wx' });
      const inventory = fs.readdirSync(output).sort().map(name => ({ name, sha256: sha256(fs.readFileSync(path.join(output, name))) }));
      await proof(f, { clear: false, hash: sha256(JSON.stringify(inventory)) });
      await rejected(() => recover(f), /FILES_OR_DELIVERY_UNPROVEN/);
      // Fixture-only move of a whole new directory; never handles user/operational paths or deletes files.
      const quarantine = path.join(root, 'quarantine'); fs.renameSync(output, quarantine); fs.mkdirSync(output);
      for (const item of inventory) assert.equal(sha256(fs.readFileSync(path.join(quarantine, item.name))), item.sha256);
      assert.deepEqual(fs.readdirSync(output), []);
      await query('UPDATE cat_recovery_prototype.evidence SET output_clear=true WHERE evidence_id=$1', [f.proof]);
      await recover(f); await coherent(f); console.log(`SYNTHETIC_EVIDENCE_RETAINED ${root}`);
    });
    await scenario('3. recovered reservation registers four remissions and becomes APLICADA', async f => {
      await proof(f); const recovered = (await recover(f))[0].id;
      const repeated = (await query("SELECT * FROM operacion.reservar_folios_para_ejecucion($1,'SYNTHETIC_CAT',4)", [f.child]))[0];
      assert.equal(repeated.reserva_id, recovered);
      for (let folio = 111; folio <= 114; folio++) await query(`SELECT * FROM operacion.fn_registrar_remision_generada($1,'SYNTHETIC_CAT',$2,'2026-11-06',$3,$4::jsonb)`,
        [f.child, folio, `SYNTHETIC/NO_FILE/${folio}.pdf`, JSON.stringify([{ codigo_interno: 'TEST', cantidad_texto: '1 PZA' }])]);
      await query("SELECT * FROM ops.fn_finalizar_ejecucion_automatizacion($1,'COMPLETADA')", [f.child]);
      assert.equal((await query('SELECT estatus FROM operacion.reservas_folios WHERE reserva_id=$1', [recovered]))[0].estatus, 'APLICADA');
      assert.deepEqual((await query('SELECT folio FROM operacion.remisiones WHERE ejecucion_id=$1 ORDER BY folio', [f.child])).map(r => Number(r.folio)), [111,112,113,114]);
      assert.equal((await recover(f))[0].id, recovered); // A transport retry after completion must not allocate again.
      await coherent(f, 4);
    });
    await scenario('4. later reservation: reject even if later range is also abandoned', async f => {
      await proof(f);
      const other = (await query("SELECT * FROM ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR',900002,'synthetic-later')"))[0].ejecucion_id;
      await query("SELECT * FROM operacion.reservar_folios_para_ejecucion($1,'SYNTHETIC_CAT',1)", [other]);
      await query("SELECT * FROM ops.fn_finalizar_ejecucion_automatizacion($1,'ERROR','synthetic','synthetic')", [other]);
      await rejected(() => recover(f), /NOT_LAST_RANGE|LATER_RESERVATION/); await coherent(f, 0, 116);
    });
    await scenario('5. registered or cancelled remission in range: reject', async f => {
      await proof(f);
      await query("INSERT INTO operacion.remisiones(serie_id,folio,empresa_cliente_id,ejecucion_id,fecha_documento,estatus) VALUES($1,111,900001,$2,'2026-11-06','GENERADA')", [f.series, f.parent]);
      await rejected(() => recover(f), /REMISSION_EXISTS/);
      await query("UPDATE operacion.remisiones SET estatus='CANCELADA' WHERE serie_id=$1", [f.series]);
      await rejected(() => recover(f), /REMISSION_EXISTS/); await coherent(f, 1);
    });
    await scenario('6. delivered PDF, unknown delivery or missing proof: reject', async f => {
      await rejected(() => recover(f), /FILES_OR_DELIVERY_UNPROVEN/);
      await proof(f, { delivery: 'DELIVERED' }); await rejected(() => recover(f), /FILES_OR_DELIVERY_UNPROVEN/);
      await query("UPDATE cat_recovery_prototype.evidence SET delivery_state='UNKNOWN' WHERE evidence_id=$1", [f.proof]);
      await rejected(() => recover(f), /FILES_OR_DELIVERY_UNPROVEN/); await coherent(f);
    });
    await scenario('7. serialized competing requests: only one transfer (NOT a multi-session lock test)', async f => {
      await proof(f); await recover(f);
      await rejected(() => recover({ ...f, request: randomUUID() }), /ALREADY_RECOVERED/);
      assert.equal(Number((await query('SELECT count(*) AS n FROM cat_recovery_prototype.recoveries'))[0].n), 1); await coherent(f);
    });
    await scenario('8. duplicate request: same reservation, conflicting payload rejected', async f => {
      await proof(f); const first = (await recover(f))[0].id;
      assert.equal((await recover(f))[0].id, first);
      await rejected(() => recover({ ...f, proof: randomUUID() }), /IDEMPOTENCY_CONFLICT/); await coherent(f);
    });
    await scenario('9. new child error abandons its reservation, preserves counter and both histories', async f => {
      await proof(f); const id = (await recover(f))[0].id;
      for (const worker of ['child-fail-1', 'child-fail-2']) await query("SELECT * FROM ops.fn_registrar_fallo_ejecucion($1,$2,'synthetic','Synthetic new failure')", [f.child, worker]);
      assert.equal((await query('SELECT estatus FROM operacion.reservas_folios WHERE reserva_id=$1', [id]))[0].estatus, 'ABANDONADA');
      assert.equal((await query('SELECT estado FROM ops.ejecuciones_automatizacion WHERE ejecucion_id=$1', [f.child]))[0].estado, 'ERROR');
      await coherent(f);
    });
    await scenario('10. audit link, ADMIN and confirmation checks, retained history', async f => {
      await proof(f);
      await query("UPDATE security.users SET role='GENERAL' WHERE user_id=$1", [f.admin]);
      await rejected(() => recover(f), /ADMIN_REQUIRED/);
      await query("UPDATE security.users SET role='ADMIN' WHERE user_id=$1", [f.admin]);
      await rejected(() => query('SELECT cat_recovery_prototype.recover($1,$2,$3,$4,$5,$6,false)', [f.parent,f.child,f.proof,f.request,f.admin,'synthetic']), /EXPLICIT_CONFIRMATION_REQUIRED/);
      const id = (await recover(f))[0].id;
      const audit = (await query('SELECT * FROM cat_recovery_prototype.recoveries WHERE request_id=$1', [f.request]))[0];
      assert.equal(audit.original_reservation_id, f.reservation.reserva_id); assert.equal(audit.new_reservation_id, id);
      assert.equal(audit.admin_id, f.admin); assert.equal(audit.child_execution_id, f.child); assert.equal(Number(audit.next_folio_before), 115);
      await rejected(() => db.exec(fs.readFileSync(path.join(__dirname, 'prototype.down.sql'), 'utf8')), /HISTORY_MUST_BE_RETAINED/);
      await coherent(f);
    });
    await scenario('11. another active execution blocks even before it reserves', async f => {
      await proof(f); await query("SELECT * FROM ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR',900002,'synthetic-other')");
      await rejected(() => recover(f), /OTHER_EXECUTION_PROCESSING/); await coherent(f);
    });
    await scenario('12. stale evidence or unverified quarantine rejects without touching the counter', async f => {
      await proof(f, { verified: false });
      await rejected(() => recover(f), /FILES_OR_DELIVERY_UNPROVEN/);
      await query("UPDATE cat_recovery_prototype.evidence SET quarantine_verified=true,verified_at=clock_timestamp()-interval '6 minutes' WHERE evidence_id=$1", [f.proof]);
      await rejected(() => recover(f), /FILES_OR_DELIVERY_UNPROVEN/); await coherent(f);
    });
    await scenario('13. incompatible quantity and transaction failure do not allocate fresh folios', async f => {
      await proof(f); await recover(f);
      await rejected(() => query("SELECT * FROM operacion.reservar_folios_para_ejecucion($1,'SYNTHETIC_CAT',5)", [f.child]), /already has a reservation/);
      await coherent(f);
    });
    await db.exec(fs.readFileSync(path.join(__dirname, 'prototype.down.sql'), 'utf8'));
    assert.equal((await query("SELECT to_regnamespace('cat_recovery_prototype') AS schema"))[0].schema, null);
    console.log('PROTOTYPE_DOWN_PASS: empty prototype removed; history-bearing down rejected');
    console.log(`PROTOTYPE_PASS=${passed}; LIVE_TEST_WRITES=0; LIVE_TEST_INTEGRATION=BLOCKED_MIGRATOR_MISSING; MULTI_SESSION_CONCURRENCY=NOT_TESTED; WORKFLOW_FILES_COORDINATION=NOT_PROVEN`);
  } finally { await db.close(); }
}

run().catch(error => { console.error('PROTOTYPE_FAILED', error.code || '', error.message); process.exitCode = 1; });
