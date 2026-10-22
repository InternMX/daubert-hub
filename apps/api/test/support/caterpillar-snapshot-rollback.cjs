// Session-bound adapter for integration testing. No Pool/URLs/config/env access here.
const { assert } = require('./caterpillar-cancellation-test-guards.cjs');
async function rollbackOnly(client, action) {
  await client.query('BEGIN');
  try { return await action(); }
  finally { await client.query('ROLLBACK'); }
}
function snapshotDatabase(client, expected) {
  assert(Number.isInteger(expected.pid) && expected.pid > 0 && typeof expected.xid === 'string' && /^[1-9]\d*$/.test(expected.xid),
    'CAT_SNAPSHOT_ACTIVE_TRANSACTION_REQUIRED');
  return { async query(text, values) {
    const live = (await client.query(`SELECT current_database() AS db,current_user AS role,
      pg_backend_pid() AS pid,pg_current_xact_id_if_assigned()::text AS xid`)).rows[0];
    assert(live.db === 'daubert_hub_test' && live.role === 'daubert_hub_test_user' &&
      live.pid === expected.pid && live.xid === expected.xid, 'CAT_SNAPSHOT_SESSION_CHANGED');
    const sql = text.replace(/\s+/g, ' ').trim();
    assert(!sql.includes(';'), 'CAT_SNAPSHOT_MULTIPLE_STATEMENTS_REJECTED');
    if (!sql.startsWith('SELECT ')) {
      assert(sql.startsWith('UPDATE core.documentos d SET caterpillar_admission=$3::jsonb ') &&
        sql.includes("WHERE current_database()='daubert_hub_test' AND d.documento_id=$1::bigint AND d.empresa_id=$2::bigint") &&
        sql.includes('d.caterpillar_admission IS NULL') && sql.endsWith('RETURNING d.caterpillar_admission AS snapshot') &&
        values?.[0] === expected.documentId && values?.[1] === expected.companyId,
      'CAT_SNAPSHOT_NON_FIXTURE_WRITE_REJECTED');
    }
    const result = await client.query(text, values);
    return result.rows;
  } };
}
module.exports = { rollbackOnly, snapshotDatabase };
