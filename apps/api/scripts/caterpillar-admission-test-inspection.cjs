// Explicit TEST URLs only. Read-only PostgreSQL transactions; NO schema/data modifications.
// Output contains technical metadata/counts only, never URLs, names, paths or credentials.
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const { guardedUrl, assert } = require('../test/support/caterpillar-cancellation-test-guards.cjs');
async function inspect() {
  const available = {
    migrator: !!process.env.TEST_DATABASE_URL_MIGRATOR,
    runtime: !!process.env.TEST_DATABASE_URL
  };
  if (!available.migrator || !available.runtime) {
    console.log(JSON.stringify({ result: 'TEST_READ_ONLY_INSPECTION_UNAVAILABLE', available }));
    return;
  }
  const admin = guardedUrl(process.env.TEST_DATABASE_URL_MIGRATOR, 'postgres');
  const runtime = guardedUrl(process.env.TEST_DATABASE_URL, 'daubert_hub_test_user');
  assert(admin.hostname === runtime.hostname && (admin.port || '5432') === (runtime.port || '5432'), 'Server mismatch');
  const pools = [admin, runtime].map(u => new Pool({ connectionString: u.toString(), connectionTimeoutMillis: 5000 }));
  let client;
  try {
    const identities = [];
    for (let i = 0; i < pools.length; i++) {
      const c = await pools[i].connect();
      try {
        await c.query('BEGIN READ ONLY');
        const identity = (await c.query(`SELECT current_database() AS db,current_user AS role,
          inet_server_addr()::text AS host,inet_server_port() AS port,current_setting('server_version') AS version`)).rows[0];
        assert(identity.db === 'daubert_hub_test' && identity.role === (i ? 'daubert_hub_test_user' : 'postgres'), 'Live identity mismatch');
        identities.push(identity);
        await c.query('ROLLBACK');
      } finally { c.release(); }
    }
    assert(identities[0].host === identities[1].host && identities[0].port === identities[1].port, 'Live server mismatch');
    client = await pools[0].connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='20s'");
    const columns = (await client.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='core.documentos'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows;
    const detailColumns = (await client.query(`SELECT attname AS name FROM pg_attribute
      WHERE attrelid='operacion.remision_detalle'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`)).rows.map(r => r.name);
    const rows = (await client.query(`WITH executions AS (
      SELECT e.* FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id)
      WHERE a.codigo='REMISIONES_CATERPILLAR'
    ) SELECT d.documento_id::text AS document_id,d.empresa_id::text AS source_company_id,
      d.nombre_archivo AS internal_filename,d.hash_archivo IS NOT NULL AS physical_hash_present,
      d.ruta_archivo IS NOT NULL AND btrim(d.ruta_archivo)<>'' AS path_present,
      d.fecha_documento IS NOT NULL AS document_date_present,
      jsonb_typeof(to_jsonb(d)->'caterpillar_admission')='object' AS snapshot_present,
      COALESCE(d.observaciones LIKE '%CAT_OPERATIONAL_CONTENT_V1%',false) AS manifest_marker_in_notes,
      (SELECT count(*)::int FROM executions e WHERE e.documento_origen_id=d.documento_id) AS executions,
      (SELECT count(*)::int FROM executions e WHERE e.documento_origen_id=d.documento_id AND e.estado='PROCESANDO') AS processing,
      (SELECT jsonb_agg(DISTINCT e.estado) FROM executions e WHERE e.documento_origen_id=d.documento_id) AS states,
      (SELECT count(*)::int FROM operacion.remisiones r JOIN executions e USING(ejecucion_id)
        WHERE e.documento_origen_id=d.documento_id AND r.estatus='GENERADA') AS generated,
      (SELECT count(*)::int FROM operacion.remisiones r JOIN executions e USING(ejecucion_id)
        WHERE e.documento_origen_id=d.documento_id AND r.estatus='CANCELADA') AS cancelled,
      (SELECT count(*)::int FROM operacion.remisiones r JOIN executions e USING(ejecucion_id)
        WHERE e.documento_origen_id=d.documento_id AND r.estatus='PENDIENTE') AS pending
      FROM core.documentos d WHERE EXISTS(SELECT 1 FROM executions e WHERE e.documento_origen_id=d.documento_id)
      ORDER BY d.documento_id`)).rows;
    const names = rows.map(r => r.internal_filename.normalize('NFC').trim().replace(/\.(xlsx|xlsm|xls)$/i, '').replace(/\s+/g, ' ').toUpperCase());
    const documents = rows.map((r, index) => {
      const { internal_filename: _privateName, ...safe } = r;
      return { ...safe, snapshot_present: r.snapshot_present === true,
        same_normalized_name_document_count: names.filter(n => n === names[index]).length };
    });
    const runtimePrivileges = (await client.query(`SELECT
      has_table_privilege('daubert_hub_test_user','core.documentos','SELECT') AS document_read,
      has_table_privilege('daubert_hub_test_user','core.documentos','UPDATE') AS document_general_update,
      has_schema_privilege('daubert_hub_test_user','core','CREATE') AS schema_create`)).rows[0];
    const report = {
      result: 'TEST_READ_ONLY_INSPECTION_PASS', at: new Date().toISOString(),
      database: 'daubert_hub_test', roles: identities.map(i => i.role), sameServer: true, serverVersion: identities[0].version,
      snapshotColumnPresent: columns.some(c => c.name === 'caterpillar_admission'),
      documentColumns: columns, detailColumns, runtimePrivileges,
      historicalDocuments: documents.length, historicalExecutions: documents.reduce((n, d) => n + d.executions, 0),
      documentsWithoutSnapshot: documents.filter(d => !d.snapshot_present).length,
      documents, readOnly: true
    };
    await client.query('ROLLBACK');
    const folder = path.resolve(__dirname, '../../../node_modules/.cache/cat-admission-5a');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, new Date().toISOString().replace(/[:.]/g, '-') + '.inspection.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ ...report, evidence: path.relative(path.resolve(__dirname, '../../..'), file) }, null, 2));
  } finally {
    if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    await Promise.all(pools.map(p => p.end()));
  }
}
if (require.main === module) inspect().catch(e => {
  console.error('TEST_READ_ONLY_INSPECTION_FAILED SQLSTATE=' + (/^[A-Z0-9]{5}$/.test(e.code || '') ? e.code : 'NONE'));
  process.exitCode = 1;
});
