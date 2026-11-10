'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyChangedFiles, buildPlan, renderMarkdown, parseArgs } = require('./plan-release.cjs');

test('Hub-only release is a candidate, never a deployment approval', () => {
  const r = classifyChangedFiles(['apps/web/src/App.tsx', 'apps/api/src/main.ts', 'docs/README.md']);
  assert.equal(r.decision, 'CANDIDATO_SOLO_HUB');
  assert.equal(r.hubRequiresBuild, true);
  assert.equal(r.needsCoordination, false);
  const plan = buildPlan({ base: 'a'.repeat(40), head: 'b'.repeat(40), version: '1.1.2', files: ['apps/web/src/App.tsx'], generatedAt: '2026-11-10T00:00:00.000Z' });
  assert.match(renderMarkdown(plan), /No es una autorizacion de produccion/);
});

test('Database and n8n always require manual coordination', () => {
  const r = classifyChangedFiles(['database/migrations/daubert_global/a.sql', 'n8n/workflows/remisiones-caterpillar/prod/workflow.json']);
  assert.equal(r.decision, 'REQUIERE_COORDINACION_MANUAL');
  assert.equal(r.hubRequiresBuild, false);
  assert.equal(r.warnings.length, 2);
});

test('Host and unknown paths are conservative', () => {
  for (const file of ['scripts/deploy/Deploy-DaubertHub.ps1', 'deploy/closure/entry-closure-override.yaml', 'unclassified.yaml']) {
    assert.equal(classifyChangedFiles([file]).decision, 'REQUIERE_COORDINACION_MANUAL');
  }
});

test('Tooling and documentation do not trigger Hub redeploy', () => {
  const r = classifyChangedFiles(['.github/workflows/ci.yml', 'scripts/release/plan-release.cjs', 'docs/operations/README.md']);
  assert.equal(r.decision, 'SIN_DESPLIEGUE_HUB');
  assert.equal(r.hubRequiresBuild, false);
});

test('Compose, Docker and package lock changes count as Hub changes', () => {
  const r = classifyChangedFiles(['compose.pilot.yaml', 'docker/api.Dockerfile', 'package-lock.json']);
  assert.equal(r.decision, 'CANDIDATO_SOLO_HUB');
  assert.equal(r.groups.hub.length, 3);
});

test('Duplicate files collapse, paths are sorted, and an empty release does not deploy', () => {
  assert.deepEqual(classifyChangedFiles(['apps/web/b.ts', 'apps/web/a.ts', 'apps/web/b.ts']).groups.hub, ['apps/web/a.ts', 'apps/web/b.ts']);
  assert.equal(classifyChangedFiles([]).decision, 'SIN_DESPLIEGUE_HUB');
});

test('Only explicitly named arguments are accepted', () => {
  assert.deepEqual(parseArgs(['--base', 'abc', '--head', 'def', '--out-dir', '/tmp']), { '--base': 'abc', '--head': 'def', '--out-dir': '/tmp' });
  assert.throws(() => parseArgs(['--base', 'abc', '--base', 'b', '--head', 'def', '--out-dir', '/tmp']));
  assert.throws(() => parseArgs(['--base', 'abc', '--head', 'def']));
  assert.throws(() => parseArgs(['--run', 'deploy', '--head', 'def', '--out-dir', '/tmp']));
});
