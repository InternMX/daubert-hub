const required = require('./required-steps.json');

function assertCompletion(job, mode, scopeResult, steps) {
  if (scopeResult !== 'success') throw new Error('Scope did not succeed');
  if (!Object.hasOwn(required, job) || !['docs', 'full'].includes(mode)) throw new Error('Invalid CI job or mode');
  if (!steps || typeof steps !== 'object' || Array.isArray(steps)) throw new Error('Invalid steps object');
  const policy = required[job];
  for (const id of policy[mode]) {
    if (!Object.hasOwn(steps, id) || steps[id]?.conclusion !== 'success') throw new Error(`Required step did not succeed: ${id}`);
  }
  if (mode === 'docs') {
    for (const id of policy.full) {
      if (!policy.docs.includes(id) && steps[id]?.conclusion === 'success') throw new Error(`Heavy step ran in docs mode: ${id}`);
    }
  }
}

if (require.main === module) {
  const [jobFlag, job, modeFlag, mode, resultFlag, result, ...extra] = process.argv.slice(2);
  try {
    if (jobFlag !== '--job' || modeFlag !== '--mode' || resultFlag !== '--scope-result' || extra.length) {
      throw new Error('Expected --job, --mode and --scope-result');
    }
    let steps;
    try {
      steps = JSON.parse(process.env.STEPS_JSON);
    } catch {
      throw new Error('Invalid STEPS_JSON');
    }
    assertCompletion(job, mode, result, steps);
  } catch (error) {
    const message = `completion-guard FAILED for ${job ?? "(missing job)"}: scope result ${JSON.stringify(result)} (expected "success"), mode ${JSON.stringify(mode)}. ${error.message}`;
    console.error(`::error::${message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
    process.exitCode = 1;
  }
}

module.exports = { assertCompletion };
