const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const manifest = require('./package.json');
const lock = require('./package-lock.json');
const required = require('./required-steps.json');

const yamlRoot = path.join(__dirname, 'node_modules', 'js-yaml');
const yamlEntry = require.resolve(yamlRoot);
const relativeEntry = path.relative(yamlRoot, fs.realpathSync(yamlEntry));
assert.ok(relativeEntry && !relativeEntry.startsWith('..') && !path.isAbsolute(relativeEntry), yamlEntry);
const yaml = require(yamlEntry);
const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../../workflows/ci.yml'), 'utf8'));
const jobs = workflow.jobs;
const requiredJobs = ['validate', 'release-plan'];
const heavyCondition = "needs.scope.outputs.mode != 'docs'";
const expression = value => value?.trim().replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1');
const checkout = job => job.steps.find(step => step.uses?.startsWith('actions/checkout@'));

test('W0: YAML parser is local, pinned and integrity locked', () => {
  const pin = manifest.devDependencies['js-yaml'];
  assert.equal(pin, '4.3.1');
  assert.equal(require(path.join(yamlRoot, 'package.json')).version, pin);
  assert.equal(lock.packages[''].devDependencies['js-yaml'], pin);
  assert.equal(lock.packages['node_modules/js-yaml'].version, pin);
  assert.match(lock.packages['node_modules/js-yaml'].integrity, /^sha512-/);
});

test('W1–W4: required checks always run, verify scope first, and guard completion last', () => {
  for (const name of [...requiredJobs, 'scope']) {
    assert.ok(Object.hasOwn(jobs, name));
    assert.equal(jobs[name].name ?? name, name);
  }
  for (const name of requiredJobs) {
    const job = jobs[name];
    assert.ok([job.needs].flat().includes('scope'));
    assert.equal(expression(job.if), 'always()');
    for (const item of [job, ...job.steps]) assert.ok(!Object.hasOwn(item, 'continue-on-error'));
    const [cancel, verify] = job.steps;
    assert.equal(cancel.id, 'fail-if-cancelled');
    assert.equal(expression(cancel.if), 'cancelled()');
    assert.equal(cancel.run.trim(), 'exit 1');
    assert.equal(verify.id, 'verify-scope');
    assert.equal(verify.if, undefined);
    assert.equal(expression(verify.env.SCOPE_RESULT), 'needs.scope.result');
    assert.equal(expression(verify.env.CI_MODE), 'needs.scope.outputs.mode');
    const guard = job.steps.at(-1);
    assert.equal(guard.id, 'completion-guard');
    assert.equal(expression(guard.if), 'always()');
    assert.ok(guard.run.includes(`assert-ci-completion.cjs --job ${name}`));
    assert.equal(expression(guard.env.STEPS_JSON), 'toJSON(steps)');
    assert.equal(expression(guard.env.SCOPE_RESULT), 'needs.scope.result');
    assert.equal(expression(guard.env.CI_MODE), 'needs.scope.outputs.mode');
  }
});

test('W5–W6: heavy steps and manifest agree; docs checks run in both modes', () => {
  for (const name of requiredJobs) {
    const { docs, full } = required[name];
    const common = name === 'validate' ? ['verify-scope', 'docs-checks'] : ['verify-scope'];
    assert.deepEqual([...docs].sort(), common.sort());
    const heavy = jobs[name].steps.filter(step => step.run &&
      !['fail-if-cancelled', 'completion-guard', ...docs].includes(step.id));
    for (const step of heavy) {
      assert.ok(step.id);
      assert.equal(expression(step.if), heavyCondition, step.id);
    }
    const conditioned = jobs[name].steps.filter(step => expression(step.if) === heavyCondition);
    assert.deepEqual(conditioned.map(step => step.id).sort(), heavy.map(step => step.id).sort());
    assert.deepEqual(heavy.map(step => step.id).sort(), full.filter(id => !docs.includes(id)).sort());
  }
  const docsCheck = jobs.validate.steps.find(step => step.id === 'docs-checks');
  assert.equal(docsCheck.if, undefined);
  assert.match(docsCheck.run, /check-docs\.cjs/);
});

test('W7–W10: triggers, shallow checkouts, and policy dependency order', () => {
  assert.deepEqual(workflow.on, { pull_request: { branches: ['main'] }, push: { branches: ['main'] } });
  assert.equal(jobs.scope['runs-on'], 'ubuntu-latest');
  assert.equal(jobs.scope['timeout-minutes'], 5);
  for (const job of [jobs.scope, jobs.validate]) {
    assert.equal(checkout(job).with['fetch-depth'], 2);
  }
  for (const job of Object.values(jobs)) assert.equal(checkout(job).with['persist-credentials'], false);
  const steps = jobs.validate.steps;
  const install = steps.findIndex(step => step.id === 'ci-tooling-install');
  const policy = steps.findIndex(step => step.id === 'ci-policy-tests');
  assert.ok(install >= 0 && policy > install);
  assert.equal(steps[install].run, 'npm ci --prefix .github/scripts/ci --ignore-scripts');
  assert.equal(steps[policy].run, 'node --test .github/scripts/ci/ci-workflow-policy.test.cjs');
  for (const id of ['ci-tooling-install', 'ci-policy-tests']) assert.ok(required.validate.full.includes(id));
});
