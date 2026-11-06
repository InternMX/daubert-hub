// Targeted guard verification on TEST, using READ ONLY transactions. Never connects to daubert_global.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

(async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert(url && new URL(url).pathname === '/daubert_hub_test', 'TEST_DATABASE_URL must identify daubert_hub_test');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const client = await pool.connect();
    try {
      assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, 'daubert_hub_test');
      for (const suffix of ['precheck', 'up', 'postcheck', 'down']) {
        const file = path.resolve(__dirname, `../../../database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.${suffix}.sql`);
        const sql = fs.readFileSync(file, 'utf8').replace(/^\\set[^\r\n]*/gm, '');
        await client.query('BEGIN READ ONLY');
        try { await assert.rejects(client.query(sql), /requires daubert_global/); }
        finally { await client.query('ROLLBACK'); }
        console.log(`PASS production ${suffix} refuses TEST before any change`);
      }
    } finally { client.release(); }
  } finally { await pool.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
