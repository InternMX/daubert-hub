// Offline verification only: compile Code nodes but NEVER evaluate workflow code or call services.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { build } = require('./build-payment-recovery-prod.cjs');

function functions(sql) {
  return Object.fromEntries([...sql.replace(/\r\n/g, '\n').matchAll(/CREATE(?: OR REPLACE)? FUNCTION core\.(\w+)[\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$;/g)]
    .map(match => [match[1], match[2]]));
}
function verifySql(root) {
  const folder = path.join(root, 'database/migrations/daubert_global');
  const read = name => fs.readFileSync(path.join(folder, name), 'utf8');
  const test = functions(read('20261023_018_payment_file_recovery_test.up.sql'));
  const up = functions(read('20261023_019_payment_file_recovery_prod.up.sql'));
  assert.deepEqual(up, test, 'No functional SQL delta from approved TEST 018');
  const down = functions(read('20261023_019_payment_file_recovery_prod.down.sql'));
  const previous = functions(read('20261022_015_payment_file_assignment_prod.up.sql'));
  assert.equal(Object.keys(down).length, 2);
  for (const [name, body] of Object.entries(down)) assert.equal(body, previous[name], `Rollback body drift: ${name}`);
  for (const suffix of ['precheck', 'up', 'postcheck', 'down']) {
    const sql = read(`20261023_019_payment_file_recovery_prod.${suffix}.sql`);
    assert(sql.includes("current_database() <> 'daubert_global'"));
    assert(sql.includes('\\set ON_ERROR_STOP on'));
  }
  const rollback = read('20261023_019_payment_file_recovery_prod.down.sql');
  assert(!/\b(DROP|DELETE|TRUNCATE)\s+(TABLE|FROM|core\.)/i.test(rollback));
  assert(rollback.includes("estado <> 'FINALIZADO'"));
  return { approvedTestFunctionBodiesEqual: Object.keys(up).length, previousFunctionBodiesRestored: 2 };
}

function verifyWorkflow(bytes) {
  const workflows = build(bytes);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let compiled = 0;
  for (const workflow of Object.values(workflows)) {
    const names = new Set(workflow.nodes.map(n => n.name));
    for (const node of workflow.nodes) {
      if (node.type === 'n8n-nodes-base.code') { new AsyncFunction(node.parameters.jsCode); compiled++; }
      // Named n8n lookups must remain valid after moving the processing graph to the child.
      const params = JSON.stringify(node.parameters);
      for (const match of params.matchAll(/\$\((?:\\)?["']([^"']+?)(?:\\)?["']\)/g)) {
        const referenced = match[1].replace(/\\$/, '');
        assert(names.has(referenced), `Missing named node ${referenced} in ${node.name}`);
      }
    }
    for (const [from, types] of Object.entries(workflow.connections)) {
      assert(names.has(from), `Missing source ${from}`);
      for (const outputs of Object.values(types)) for (const output of outputs) for (const connection of output) {
        assert(names.has(connection.node), `Missing graph target ${connection.node}`);
      }
    }
  }
  return { parentNodes: workflows.parent.nodes.length, childNodes: workflows.child.nodes.length, compiledCodeNodes: compiled };
}
if (require.main === module) {
  const [input] = process.argv.slice(2); assert(input, 'Usage: private-published-production-export.json');
  console.log(JSON.stringify({ sql: verifySql(path.resolve(__dirname, '../..')), workflow: verifyWorkflow(fs.readFileSync(input)) }, null, 2));
}
module.exports = { functions, verifySql, verifyWorkflow };
