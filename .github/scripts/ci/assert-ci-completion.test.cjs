const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { assertCompletion } = require('./assert-ci-completion.cjs');
const required = require('./required-steps.json');

const stepsWith = (ids, conclusion = 'success') => Object.fromEntries(ids.map(id => [id, { conclusion }]));
const heavySteps = policy => policy.full.filter(id => !policy.docs.includes(id));

test('G1–G5, G10: exact step conclusions for both jobs and modes', () => {
  for (const [job, policy] of Object.entries(required)) {
    for (const mode of ['full', 'docs']) {
      const valid = {
        ...stepsWith(heavySteps(policy), 'skipped'),
        ...stepsWith(policy[mode]),
      };
      assert.doesNotThrow(() => assertCompletion(job, mode, 'success', valid));
      for (const id of policy[mode]) {
        const missing = { ...valid };
        delete missing[id];
        assert.throws(() => assertCompletion(job, mode, 'success', missing), /Required step/);
        for (const conclusion of ['skipped', 'failure', 'cancelled', 'neutral', null, undefined, '', 'in_progress', 'other']) {
          assert.throws(() => assertCompletion(job, mode, 'success', { ...valid, [id]: { conclusion } }), /Required step/);
        }
      }
      if (mode === 'docs') {
        for (const id of heavySteps(policy)) {
          assert.throws(() => assertCompletion(job, mode, 'success', { ...valid, [id]: { conclusion: 'success' } }), /Heavy step/);
        }
      }
    }
  }
});

test('G6–G7: reject unexpected mode and unsuccessful scope', () => {
  for (const [job, policy] of Object.entries(required)) {
    for (const mode of ['', 'Docs', 'FULL', 'docs ', 'unknown']) {
      assert.throws(() => assertCompletion(job, mode, 'success', stepsWith(policy.full)), /Invalid CI job or mode/);
    }
    for (const mode of ['docs', 'full']) {
      for (const result of ['failure', 'cancelled', 'skipped', '']) {
        assert.throws(() => assertCompletion(job, mode, result, stepsWith(policy[mode])), /Scope did not succeed/);
      }
    }
  }
});

test('G8: malformed STEPS_JSON fails in the CLI', () => {
  const result = spawnSync(process.execPath, [
    require.resolve('./assert-ci-completion.cjs'), '--job', 'validate', '--mode', 'full', '--scope-result', 'success',
  ], { env: { ...process.env, STEPS_JSON: '{' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid STEPS_JSON/);
});

test('G9: manifest lists both jobs and modes, without duplicate ids', () => {
  assert.deepEqual(Object.keys(required).sort(), ['release-plan', 'validate']);
  for (const policy of Object.values(required)) {
    assert.deepEqual(Object.keys(policy).sort(), ['docs', 'full']);
    for (const ids of Object.values(policy)) assert.equal(new Set(ids).size, ids.length);
    for (const id of policy.docs) assert.ok(policy.full.includes(id));
  }
});

test('G11: seeded guard properties over 2,000 cases', t => {
  const seed = 0x4d595df4;
  t.diagnostic(`Seed: ${seed}`);
  let state = seed;
  function choose(values) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return values[Math.floor(state / 2 ** 32 * values.length)];
  }
  for (let iteration = 0; iteration < 2000; iteration++) {
    const job = choose(Object.keys(required));
    const ids = required[job].full;
    const steps = stepsWith(ids);
    for (const id of ids) {
      const conclusion = choose(['success', 'success', 'success', 'success', 'skipped', 'neutral', null, 'cancelled', 'missing']);
      if (conclusion === 'missing') delete steps[id];
      else steps[id].conclusion = conclusion;
    }
    if (iteration % 10 === 0) Object.assign(steps, stepsWith(ids));
    const mode = choose(['docs', 'full', '', 'Docs', 'other']);
    const result = choose(['failure', 'cancelled', 'skipped', '', null, undefined, 'neutral', 'other']);
    assert.throws(() => assertCompletion(job, mode, result, steps), /Scope did not succeed/);
    if (ids.every(id => steps[id]?.conclusion === 'success')) assert.doesNotThrow(() => assertCompletion(job, 'full', 'success', steps));
    else assert.throws(() => assertCompletion(job, 'full', 'success', steps), /Required step/);
  }
});
