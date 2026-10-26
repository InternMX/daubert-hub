#!/usr/bin/env node
'use strict';

// READ ONLY static analysis of the three n8n candidates that would coexist in the shared n8n 2.27.4 (Pagos parent 111 nodes, Pagos child 106 nodes, Caterpillar PROD 62 nodes)
// plus the production references they replace. Nothing is imported, published, activated or executed anywhere.
//   node scripts/inspect-joint-n8n-candidates.cjs --pagos-dir <folder with payment-*.json> --cat <caterpillar candidate.json> --cat-live <live prod export.json>
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const arg = flag => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const pagosDir = arg('--pagos-dir'), catFile = arg('--cat'), catLive = arg('--cat-live');
if (!pagosDir || !catFile || !catLive) throw new Error('Usage: --pagos-dir <dir> --cat <file> --cat-live <file>');
const load = file => { const raw = fs.readFileSync(file); return { file, sha256: crypto.createHash('sha256').update(raw).digest('hex'), bytes: raw.length, json: JSON.parse(raw.toString('utf8')) }; };
const W = {
  pagosSource: load(path.join(pagosDir, 'payment-production-source.json')),
  pagosParent: load(path.join(pagosDir, 'payment-recovery-prod-parent.json')),
  pagosChild: load(path.join(pagosDir, 'payment-recovery-prod-child.json')),
  catCandidate: load(catFile),
  catLive: load(catLive)
};
const EXPECTED = { pagosParent: 'e472624557987d4f0b42306cb074daa4f731e6b7fa64b3629e3ccec37af1d5f9', pagosChild: 'a63f2f4c291851d7f15fe5a27d0346a663f544f53feacae276032740fa592a9a', pagosSource: '47e15801d582e1f00d866e3dd21575907b492e61170e84750aca1055806e6295' };
const out = { workflows: {}, checks: [] };
const check = (name, ok, detail) => out.checks.push({ name, pass: Boolean(ok), ...(detail === undefined ? {} : { detail }) });

const triggers = w => (w.json.nodes || []).filter(n => /Trigger$|\.webhook$/.test(n.type));
const describeTrigger = n => {
  const p = n.parameters || {};
  if (n.type.endsWith('.webhook')) return { node: n.name, kind: 'webhook', method: p.httpMethod || 'GET', path: p.path, auth: p.authentication || 'none', disabled: Boolean(n.disabled) };
  if (n.type.endsWith('.scheduleTrigger')) return { node: n.name, kind: 'schedule', rule: JSON.stringify(p.rule), disabled: Boolean(n.disabled) };
  return { node: n.name, kind: n.type.split('.').pop(), disabled: Boolean(n.disabled) };
};
const credentialsOf = w => [...new Set((w.json.nodes || []).flatMap(n => Object.entries(n.credentials || {}).map(([type, ref]) => `${type}:${ref.name || ref.id}`)))].sort();
const executeWorkflowRefs = w => (w.json.nodes || []).filter(n => n.type.endsWith('.executeWorkflow')).map(n => ({ node: n.name, workflowId: n.parameters?.workflowId?.value ?? n.parameters?.workflowId, wait: n.parameters?.options?.waitForSubWorkflow }));
const windowsPaths = w => [...new Set(JSON.stringify(w.json.nodes || []).match(/[A-Za-z]:\\\\[^"\\]*(?:\\\\[^"\\]+)*/g) || [])].map(s => s.replace(/\\\\/g, '\\')).sort();

for (const [key, w] of Object.entries(W)) {
  out.workflows[key] = { file: path.basename(w.file), sha256: w.sha256, nodes: (w.json.nodes || []).length, id: w.json.id ?? null, name: w.json.name, active: w.json.active ?? null, versionId: w.json.versionId ?? null,
    errorWorkflow: w.json.settings?.errorWorkflow ?? null, triggers: triggers(w).map(describeTrigger), credentials: credentialsOf(w), executeWorkflow: executeWorkflowRefs(w), tags: (w.json.tags || []).length };
}
// 1. identity and size
for (const key of Object.keys(EXPECTED)) check(`${key} SHA-256 equals the hash recorded by the Pagos promotion`, W[key].sha256 === EXPECTED[key], W[key].sha256);
check('Pagos parent has 111 nodes and the child 106', out.workflows.pagosParent.nodes === 111 && out.workflows.pagosChild.nodes === 106, `${out.workflows.pagosParent.nodes}/${out.workflows.pagosChild.nodes}`);
check('Caterpillar candidate has 62 nodes, is inactive and carries the B1 nodes', out.workflows.catCandidate.nodes === 62 && W.catCandidate.json.active === false && W.catCandidate.json.nodes.some(n => n.name === '\u00bfHist\u00f3rico ya emitido?') && W.catCandidate.json.nodes.some(n => n.name === 'Omitir hist\u00f3rico CAT'), JSON.stringify([out.workflows.catCandidate.nodes, W.catCandidate.json.active]));
check('the three candidates are inactive', [W.pagosParent, W.pagosChild, W.catCandidate].every(w => w.json.active === false), JSON.stringify([W.pagosParent.json.active, W.pagosChild.json.active, W.catCandidate.json.active]));
// 2. identifiers: parent keeps the production id, child is new, the Caterpillar candidate has no id (n8n assigns one on import) and differs from the live workflow
check('Pagos parent keeps the id of the production workflow it replaces', W.pagosParent.json.id === W.pagosSource.json.id && W.pagosParent.json.id === 'pagosProdAsignaciones01', `${W.pagosParent.json.id} / ${W.pagosSource.json.id}`);
check('Pagos child has its own id and it is not used by the source', W.pagosChild.json.id === 'pagosProdRecuperacion01' && W.pagosSource.json.id !== W.pagosChild.json.id, W.pagosChild.json.id);
check('Caterpillar candidate carries no workflow id (new workflow on import) and its id differs from the live production workflow', !W.catCandidate.json.id && W.catLive.json.id === '9Ngnrpi16b6GtOAX', `candidate=${W.catCandidate.json.id ?? 'none'} live=${W.catLive.json.id}`);
// 3. sub-workflow wiring
const call = out.workflows.pagosParent.executeWorkflow;
check('Pagos parent calls the child by id and waits for it (waitForSubWorkflow)', call.length >= 1 && call.every(c => c.workflowId === 'pagosProdRecuperacion01' && c.wait === true), JSON.stringify(call));
check('the Pagos child is triggered only by Execute Workflow Trigger (no webhook, no schedule)', out.workflows.pagosChild.triggers.every(t => t.kind === 'executeWorkflowTrigger'), JSON.stringify(out.workflows.pagosChild.triggers));
check('the Caterpillar candidate calls no sub-workflow and nothing calls it', out.workflows.catCandidate.executeWorkflow.length === 0 && ![W.pagosParent, W.pagosChild, W.pagosSource].some(w => JSON.stringify(w.json).includes('Remisiones CAT')), '');
// 4. webhooks and schedules
const hooks = Object.entries(out.workflows).flatMap(([key, v]) => v.triggers.filter(t => t.kind === 'webhook').map(t => ({ key, ...t })));
out.webhooks = hooks;
const activeHookKeys = hooks.filter(h => ['pagosParent', 'pagosChild', 'catCandidate'].includes(h.key));
const dup = {}; for (const h of activeHookKeys) (dup[`${h.method} ${h.path}`] = dup[`${h.method} ${h.path}`] || []).push(h.key);
check('no two of the THREE candidates declare the same webhook method+path', Object.values(dup).every(list => list.length === 1), JSON.stringify(dup));
const parentHook = hooks.find(h => h.key === 'pagosParent'), sourceHook = hooks.find(h => h.key === 'pagosSource');
check('the Pagos parent keeps the exact webhook (method, path, authentication) of the workflow it replaces', parentHook && sourceHook && parentHook.path === sourceHook.path && parentHook.method === sourceHook.method && parentHook.auth === sourceHook.auth, JSON.stringify({ parentHook, sourceHook }));
const catHook = hooks.find(h => h.key === 'catCandidate'), catLiveHook = hooks.find(h => h.key === 'catLive');
check('the Caterpillar candidate keeps the exact webhook of the live production workflow (cat-reprocess, Header Auth) but is disabled', catHook && catLiveHook && catHook.path === catLiveHook.path && catHook.auth === catLiveHook.auth && catHook.disabled === true, JSON.stringify({ catHook, catLiveHook }));
check('Caterpillar and Pagos webhook paths differ', catHook && parentHook && catHook.path !== parentHook.path, `${catHook?.path} vs ${parentHook?.path}`);
out.schedules = Object.entries(out.workflows).flatMap(([key, v]) => v.triggers.filter(t => t.kind === 'schedule').map(t => ({ key, node: t.node, rule: t.rule, disabled: t.disabled })));
check('every Schedule Trigger of the Caterpillar candidate is disabled until the cutover step', out.workflows.catCandidate.triggers.filter(t => t.kind === 'schedule').every(t => t.disabled), JSON.stringify(out.workflows.catCandidate.triggers));
check('the Caterpillar candidate keeps the 10-minute schedule of the live workflow', out.workflows.catCandidate.triggers.some(t => t.kind === 'schedule' && t.rule === out.workflows.catLive.triggers.find(x => x.kind === 'schedule').rule), '');
// 5. credentials: nothing shared between Pagos and Caterpillar; the Caterpillar worker credential is referenced by name only
const catCred = new Set(out.workflows.catCandidate.credentials), pagosCred = new Set([...out.workflows.pagosParent.credentials, ...out.workflows.pagosChild.credentials]);
out.credentialSharing = [...catCred].filter(c => pagosCred.has(c));
// The only deliberate shared credential is the Header Auth that authenticates Hub -> n8n webhooks; the live PROD Caterpillar workflow already uses it today.
const deliberate = ['httpHeaderAuth:Daubert Hub - n8n PROD'];
check('Pagos and Caterpillar share only the deliberate Hub->n8n Header Auth credential (no database, mail or other credential)', out.credentialSharing.every(c => deliberate.includes(c)), JSON.stringify(out.credentialSharing));
check('the Caterpillar candidate uses the dedicated worker credential for every Postgres node and never n8n_app', JSON.stringify(W.catCandidate.json).includes('Postgres produccion CAT (n8n_cat_prod)') && !out.workflows.catCandidate.credentials.some(c => /postgres:/i.test(c) && !/n8n_cat_prod/.test(c)), JSON.stringify(out.workflows.catCandidate.credentials));
// 6. shared resources: filesystem directories and external services
const catPaths = windowsPaths(W.catCandidate), pagosPaths = [...new Set([...windowsPaths(W.pagosParent), ...windowsPaths(W.pagosChild)])];
const norm = p => p.toLowerCase().replace(/[\\/]+$/, '');
out.pathOverlap = catPaths.filter(c => pagosPaths.some(p => norm(c).startsWith(norm(p)) || norm(p).startsWith(norm(c))));
out.paths = { caterpillar: catPaths.slice(0, 12), pagos: pagosPaths.slice(0, 12) };
check('the filesystem directories of Pagos and Caterpillar do not overlap', out.pathOverlap.length === 0, JSON.stringify(out.pathOverlap));
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.checks.every(c => c.pass) ? 0 : 3;
