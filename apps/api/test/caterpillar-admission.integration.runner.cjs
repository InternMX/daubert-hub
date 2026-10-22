// EXPLICIT TEST integration, ROLLBACK ONLY. Does not boot an API, n8n or load .env/DB_*.
// Preconditions are based on the operator's 5C report; mismatch stops BEFORE any INSERT.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { assert, guardedUrl } = require('./support/caterpillar-cancellation-test-guards.cjs');
const { rollbackOnly, snapshotDatabase } = require('./support/caterpillar-snapshot-rollback.cjs');
const api = path.resolve(__dirname, '..');
const root = path.resolve(api, '../..');
const args = process.argv.slice(2);
let phase = 'ENVIRONMENT';
const protectedTables = ['core.documentos', 'ops.ejecuciones_automatizacion', 'operacion.remisiones',
  'operacion.remision_detalle', 'operacion.reservas_folios', 'operacion.series_documentales', 'operacion.cancelaciones_remisiones'];
async function fingerprints(client) {
  const result = {};
  for (const table of protectedTables) result[table] = (await client.query(`SELECT count(*)::int AS n,
    md5(COALESCE(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) AS hash FROM ${table} t`)).rows[0];
  return result;
}
async function identity(client, role) {
  const row = (await client.query(`SELECT current_database() AS db,current_user AS role,
    inet_server_addr()::text AS host,inet_server_port() AS port`)).rows[0];
  assert(row.db === 'daubert_hub_test' && row.role === role, 'CAT_SNAPSHOT_LIVE_IDENTITY_MISMATCH');
  return row;
}
async function run() {
  const available = { TEST_DATABASE_URL_MIGRATOR: !!process.env.TEST_DATABASE_URL_MIGRATOR,
    TEST_DATABASE_URL: !!process.env.TEST_DATABASE_URL };
  if (!Object.values(available).every(Boolean)) {
    console.log(JSON.stringify({ result: 'TEST_SNAPSHOT_INTEGRATION_BLOCKED', phase, available,
      writesAttempted: false, liveRuntimeTested: false }));
    process.exitCode = 2; return;
  }
  assert(args.includes('--allow-test-writes'), 'CAT_SNAPSHOT_WRITE_FLAG_REQUIRED');
  const companyId = args[args.indexOf('--company-id') + 1];
  assert(args.includes('--company-id') && /^[1-9]\d*$/.test(companyId || '') && BigInt(companyId) <= 9223372036854775807n,
    'CAT_SNAPSHOT_APPROVED_COMPANY_REQUIRED');
  const urls = [guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR, 'postgres'),
    guardedUrl(process.env.TEST_DATABASE_URL, 'daubert_hub_test_user')];
  assert(urls[0].hostname === urls[1].hostname && (urls[0].port || '5432') === (urls[1].port || '5432'), 'CAT_SNAPSHOT_SERVER_MISMATCH');
  const pools = urls.map(u => new Pool({ connectionString: u.toString(), connectionTimeoutMillis: 5000, max: 1 }));
  let owner, runtime;
  const runId = randomUUID();
  const marker = 'HUB_CAT_ADMISSION_' + runId.replace(/-/g, '').toUpperCase();
  // Explicit positive int8 fixture ID: avoid nextval/identity sequence changes, which ROLLBACK does NOT undo.
  const documentId = ((1n << 62n) + (BigInt('0x' + randomBytes(8).toString('hex')) & ((1n << 62n) - 1n))).toString();
  try {
    phase = 'IDENTITY'; owner = await pools[0].connect(); runtime = await pools[1].connect();
    const a = await identity(owner, 'postgres'), b = await identity(runtime, 'daubert_hub_test_user');
    assert(a.host === b.host && a.port === b.port, 'CAT_SNAPSHOT_LIVE_SERVER_MISMATCH');
    phase = 'POSTCHECK_014';
    await owner.query(fs.readFileSync(path.join(root, 'database/migrations/daubert_global/20261021_014_caterpillar_admission_test.postcheck.sql'), 'utf8'));
    phase = 'PERMISSIONS';
    const permissions = (await runtime.query(`SELECT
      has_column_privilege(current_user,'core.documentos','caterpillar_admission','UPDATE') AS snapshot_update,
      (SELECT bool_and(has_table_privilege(current_user,t,'SELECT')) FROM unnest(ARRAY[
        'core.documentos','ops.automatizaciones','ops.ejecuciones_automatizacion','operacion.remisiones','operacion.reservas_folios']) t) AS required_reads,
      (SELECT bool_and(has_schema_privilege(current_user,s,'USAGE')) FROM unnest(ARRAY['core','ops','operacion']) s) AS required_schemas,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS administrative`)).rows[0];
    assert(permissions.snapshot_update && permissions.required_reads && permissions.required_schemas && !permissions.administrative,
      'CAT_SNAPSHOT_RUNTIME_PERMISSIONS_REQUIRED');
    phase = 'SCHEMA_SAFETY';
    const columns = (await owner.query(`SELECT attname FROM pg_attribute WHERE attrelid='core.documentos'::regclass
      AND attnum>0 AND NOT attisdropped ORDER BY attname`)).rows.map(r => r.attname).sort();
    const expectedColumns = ['documento_id','empresa_id','empresa_fiscal_id','tipo_documento','nombre_archivo','ruta_archivo',
      'fecha_documento','hash_archivo','origen','estatus','observaciones','created_at','updated_at','caterpillar_admission'].sort();
    assert(JSON.stringify(columns) === JSON.stringify(expectedColumns), 'CAT_SNAPSHOT_DOCUMENT_SCHEMA_REVIEW_REQUIRED');
    const triggers = (await owner.query(`SELECT t.tgtype::int AS type,t.tgenabled,t.tgqual IS NULL AS unconditional,
      n.nspname,p.proname,p.prosrc FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='core.documentos'::regclass AND NOT t.tgisinternal`)).rows;
    for (const t of triggers) {
      const body = t.prosrc.replace(/--[^\n]*/g, '').replace(/\s+/g, '').toLowerCase();
      assert(t.type === 19 && t.tgenabled === 'O' && t.unconditional && t.nspname === 'core' && t.proname === 'fn_actualizar_updated_at' &&
        /^beginnew\.updated_at(?::=|=)(now\(\)|current_timestamp);returnnew;end;?$/.test(body), 'CAT_SNAPSHOT_TRIGGER_REVIEW_REQUIRED');
    }
    const rules = (await owner.query("SELECT count(*)::int AS n FROM pg_rewrite WHERE ev_class='core.documentos'::regclass")).rows[0].n;
    assert(rules === 0, 'CAT_SNAPSHOT_RULE_REVIEW_REQUIRED');
    const checks = (await owner.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='core.documentos'::regclass AND contype='c'")).rows;
    for (const check of checks) {
      const calls = [...check.def.matchAll(/\b([a-z_][a-z0-9_.]*)\s*\(/gi)].map(m => m[1].toLowerCase());
      assert(calls.every(name => ['check','any','and','or','not','in','btrim','pg_catalog.btrim'].includes(name)), 'CAT_SNAPSHOT_CONSTRAINT_REVIEW_REQUIRED');
    }
    const [sequence] = (await owner.query(`SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS quoted
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.oid=pg_get_serial_sequence('core.documentos','documento_id')::regclass`)).rows;
    assert(sequence, 'CAT_SNAPSHOT_IDENTITY_SEQUENCE_REQUIRED');
    const sequenceState = async () => (await owner.query(`SELECT last_value::text,is_called FROM ${sequence.quoted}`)).rows[0];
    phase = 'BASELINE';
    const summary = (await owner.query(`SELECT count(*)::int AS documents,count(caterpillar_admission)::int AS snapshots,
      count(*) FILTER (WHERE EXISTS(SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
        WHERE e.documento_origen_id=d.documento_id AND a.codigo='REMISIONES_CATERPILLAR'))::int AS historical_documents FROM core.documentos d`)).rows[0];
    console.log(JSON.stringify({ result: 'TEST_SNAPSHOT_PREFLIGHT_READ_ONLY', database: 'daubert_hub_test', permissions, observedBaseline: summary }));
    assert(summary.documents === 209 && summary.snapshots === 0 && summary.historical_documents === 17, 'CAT_SNAPSHOT_REPORTED_BASELINE_CHANGED');
    const [company] = (await owner.query("SELECT empresa_id FROM core.empresas WHERE empresa_id=$1::bigint AND estatus='ACTIVO'", [companyId])).rows;
    assert(company, 'CAT_SNAPSHOT_TEST_COMPANY_NOT_FOUND');
    const [historical] = (await owner.query(`SELECT d.documento_id::text AS id FROM core.documentos d
      WHERE d.empresa_id=$1::bigint AND d.tipo_documento='PROGRAMACION_ENTREGA' AND EXISTS(
        SELECT 1 FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
        WHERE e.documento_origen_id=d.documento_id AND a.codigo='REMISIONES_CATERPILLAR' AND e.estado<>'PROCESANDO')
      ORDER BY d.documento_id LIMIT 1`, [companyId])).rows;
    assert(historical, 'CAT_SNAPSHOT_READ_ONLY_HISTORICAL_TARGET_REQUIRED');
    assert(!(await owner.query('SELECT 1 FROM core.documentos WHERE documento_id=$1::bigint OR nombre_archivo=$2', [documentId, marker + '.xlsx'])).rowCount,
      'CAT_SNAPSHOT_FIXTURE_COLLISION');
    const before = await fingerprints(owner), beforeSequence = await sequenceState();
    // ts-node compiles the existing API classes only. No Nest bootstrap/DatabaseService Pool is constructed.
    require('ts-node').register({ project: path.join(api, 'tsconfig.json'), transpileOnly: true });
    const { CaterpillarExecutionsRepository } = require('../src/automations/remisiones-caterpillar/caterpillar-executions.repository.ts');
    const { createCaterpillarAdmissionCandidate, createCaterpillarAdmissionSnapshot } = require('../src/automations/remisiones-caterpillar/caterpillar-automatic-admission.ts');
    const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/caterpillar-normalized-items.json'), 'utf8')).normal;
    const expected = createCaterpillarAdmissionSnapshot(createCaterpillarAdmissionCandidate({ sourceCompanyId: companyId, fileName: marker + '.xlsx', normalizedItems: items }));
    const cases = {};
    let failure, failurePhase;
    try {
      await rollbackOnly(owner, async () => {
        phase = 'FIXTURE';
        await owner.query("SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s'");
        // All columns explicit: no defaults/nextval, no filesystem file is created.
        await owner.query(`INSERT INTO core.documentos(documento_id,empresa_id,empresa_fiscal_id,tipo_documento,nombre_archivo,
          ruta_archivo,fecha_documento,hash_archivo,origen,estatus,observaciones,created_at,updated_at,caterpillar_admission)
          OVERRIDING SYSTEM VALUE VALUES($1::bigint,$2::bigint,NULL,'PROGRAMACION_ENTREGA',$3,$4,DATE '2026-10-21',
            NULL,'OTRO','ACTIVO','Synthetic snapshot rollback test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL)`,
        [documentId, companyId, marker + '.xlsx', 'E2E-NO-FILE/' + marker + '.xlsx']);
        await owner.query('SET LOCAL ROLE daubert_hub_test_user');
        const session = (await owner.query('SELECT pg_backend_pid() AS pid,pg_current_xact_id_if_assigned()::text AS xid')).rows[0];
        const repo = new CaterpillarExecutionsRepository(snapshotDatabase(owner, { ...session, documentId, companyId }));
        phase = 'INITIAL_CAPTURE';
        cases.initial = (await repo.storeAdmissionSnapshot(documentId, companyId, items)).status;
        phase = 'READBACK';
        const read = await repo.findAdmissionSnapshot(documentId, companyId); cases.read = read.status;
        assert(JSON.stringify(read.snapshot) === JSON.stringify(expected), 'CAT_SNAPSHOT_READ_MISMATCH');
        phase = 'IDEMPOTENT_REPEAT';
        cases.repeat = (await repo.storeAdmissionSnapshot(documentId, companyId, items)).status;
        const changed = items.map(item => ({ json: { ...item.json, cantidad_numerica: 999 } }));
        phase = 'IMMUTABILITY';
        cases.changed = (await repo.storeAdmissionSnapshot(documentId, companyId, changed)).status;
        phase = 'HISTORICAL_REJECTION';
        cases.historical = (await repo.storeAdmissionSnapshot(historical.id, companyId, items)).status;
        phase = 'SCOPE_REJECTION';
        cases.outOfScope = (await repo.storeAdmissionSnapshot(documentId, '0', items)).status;
        assert(JSON.stringify(cases) === JSON.stringify({ initial: 'STORED', read: 'FOUND', repeat: 'ALREADY_STORED',
          changed: 'CONFLICT', historical: 'HISTORICAL_LOCKED', outOfScope: 'NOT_FOUND' }), 'CAT_SNAPSHOT_CASE_FAILED');
        const finalRead = await repo.findAdmissionSnapshot(documentId, companyId);
        assert(JSON.stringify(finalRead.snapshot) === JSON.stringify(expected), 'CAT_SNAPSHOT_OVERWRITTEN');
      });
    } catch (e) { failure = e; failurePhase = phase; }
    phase = 'VERIFY_ROLLBACK';
    const after = await fingerprints(owner), afterSequence = await sequenceState();
    const absent = !(await owner.query('SELECT 1 FROM core.documentos WHERE documento_id=$1::bigint OR nombre_archivo=$2', [documentId, marker + '.xlsx'])).rowCount;
    assert(absent && JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(beforeSequence) === JSON.stringify(afterSequence),
      'CAT_SNAPSHOT_ROLLBACK_OR_BASELINE_MISMATCH');
    if (failure) { phase = failurePhase; throw failure; }
    console.log(JSON.stringify({ result: 'TEST_SNAPSHOT_INTEGRATION_PASS', runId, database: 'daubert_hub_test',
      repositoryCodeTested: true, httpApiTested: false, runtimeRole: 'daubert_hub_test_user', permissions,
      baseline: summary, cases, fixtureAbsent: absent, protectedTablesUnchanged: true, identitySequenceUnchanged: true,
      transaction: 'ROLLBACK', noExecutionRemissionOrReservationCreated: true }, null, 2));
  } finally {
    if (owner) { await owner.query('ROLLBACK').catch(() => {}); owner.release(); }
    if (runtime) runtime.release();
    await Promise.all(pools.map(p => p.end()));
  }
}
if (require.main === module) run().catch(error => {
  console.error(JSON.stringify({ result: 'TEST_SNAPSHOT_INTEGRATION_BLOCKED', phase,
    detail: /^CAT_SNAPSHOT_[A-Z_]+$/.test(error.message || '') ? error.message : 'RAW_ERROR_SUPPRESSED',
    sqlstate: /^[A-Z0-9]{5}$/.test(error.code || '') ? error.code : null }));
  process.exitCode = 1;
});
