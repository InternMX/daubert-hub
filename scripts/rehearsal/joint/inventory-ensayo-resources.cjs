#!/usr/bin/env node
'use strict';

// READ ONLY inventory of every temporary resource created by the rehearsals of the Pagos + Caterpillar integration (Phase F input).
//   node scripts/inventory-ensayo-resources.cjs [--out <file.json>]
// It lists, classifies and measures. It never deletes, stops, removes, prunes or modifies anything. "Mine" means: created by the rehearsal work and identifiable by an exact name
// or by the prefix daubert-hub-rbtest; everything else found in Docker/Git is reported under "notOurs" and must not be touched by the cleanup.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const sh = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { encoding: 'utf8', cwd, maxBuffer: 64 * 1024 * 1024 }); return (r.stdout || '').trim(); };
const lines = text => text.split('\n').map(s => s.trim()).filter(Boolean);
const sizeOf = target => {
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return stat.size;
    let total = 0; const stack = [target];
    while (stack.length) { const dir = stack.pop(); for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); try { if (e.isDirectory()) stack.push(p); else total += fs.statSync(p).size; } catch { /* unreadable entry */ } } }
    return total;
  } catch { return null; }
};
const mb = bytes => (bytes == null ? 'missing' : `${(bytes / 1048576).toFixed(1)} MB`);

const MINE = /^daubert-hub-rbtest/;
const inventory = { generatedAt: new Date().toISOString(), docker: {}, git: {}, files: [], notOurs: {} };

// ---- Docker (names only; mounts tell which anonymous volumes belong to our database containers)
const containers = lines(sh('docker', ['ps', '-a', '--format', '{{.Names}}|{{.Image}}|{{.Status}}|{{.CreatedAt}}'])).map(l => { const [name, image, status, created] = l.split('|'); return { name, image, status, created }; });
inventory.docker.containers = containers.filter(c => MINE.test(c.name)).map(c => ({ ...c, volumes: lines(sh('docker', ['inspect', c.name, '--format', '{{range .Mounts}}{{.Name}}{{"\\n"}}{{end}}'])), project: lines(sh('docker', ['inspect', c.name, '--format', '{{index .Config.Labels "com.docker.compose.project"}}']))[0] || null }));
inventory.docker.volumes = [...new Set(inventory.docker.containers.flatMap(c => c.volumes))];
inventory.docker.networks = lines(sh('docker', ['network', 'ls', '--format', '{{.Name}}'])).filter(n => MINE.test(n));
inventory.docker.images = lines(sh('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.Size}}'])).filter(l => MINE.test(l)).map(l => { const [ref, id, size] = l.split('|'); return { ref, id, size }; });
inventory.notOurs.containers = containers.filter(c => !MINE.test(c.name)).map(c => `${c.name} (${c.status})`);
inventory.notOurs.networks = lines(sh('docker', ['network', 'ls', '--format', '{{.Name}}'])).filter(n => !MINE.test(n));
inventory.notOurs.productionImageTagsToKeep = lines(sh('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}|{{.ID}}'])).filter(l => /^daubert-hub-(api|web):/.test(l));

// ---- Git (shared repository of all worktrees)
const repo = 'C:/Users/06/Documents/Daubert/daubert-hub-caterpillar-remission-controls';
inventory.git.worktrees = lines(sh('git', ['worktree', 'list'], repo));
inventory.git.ourBranches = lines(sh('git', ['branch', '--list', 'release/hub-caterpillar-b2', 'ensayo/*', 'feat/caterpillar-remission-controls'], repo)).map(s => s.replace(/^[*+]\s*/, ''));
inventory.git.ourRefs = lines(sh('git', ['for-each-ref', '--format=%(refname) %(objectname:short)', 'refs/sim'], repo));
inventory.git.ensayoWorktree = 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\combined';

// ---- Folders and files (exact paths; the classification is the proposal for Phase F, not an action)
const scratch = 'C:\\Users\\06\\AppData\\Local\\Temp\\claude\\C--Users-06-Documents-Daubert-daubert-hub\\1abf4c63-5987-4aef-b91c-0e39856090f4\\scratchpad';
const tmp = process.env.TEMP || 'C:\\Users\\06\\AppData\\Local\\Temp';
const entries = [
  // keep: durable evidence or recovery artifacts
  ['KEEP', 'C:\\Users\\06\\Documents\\Daubert\\respaldos-postgres-prod\\daubert_global_pre_caterpillar_016_20261023_220606.dump', 'durable PROD backup (SHA-256 CA8A82AA...); recovery artifact'],
  ['KEEP', 'C:\\Users\\06\\Documents\\Daubert\\daubert-hub-caterpillar-remission-controls', 'active worktree (branch release/hub-caterpillar-b2 checked out; feat/caterpillar-remission-controls kept as a branch)'],
  ['KEEP', 'C:\\Users\\06\\Documents\\Daubert\\daubert-hub-deploy-main', 'PROD deployment checkout'],
  // candidates for deletion after the project closes
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-postgres-prod\\20261023_221512', 'isolated PostgreSQL data folder (partial --keep run)'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-postgres-prod\\20261023_222211', 'isolated PostgreSQL data folder'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-postgres-prod\\20261023_222228', 'isolated PostgreSQL data folder (final PASS run)'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-postgres-prod', 'parent folder of the three above (remove last, only if empty)'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\combined', 'temporary git worktree (branch ensayo/integracion-conjunta-pagos-caterpillar): remove with "git worktree remove", never with a file delete'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\joint-migrations-state.json', 'contains throw-away DB credentials of a rehearsal container'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\joint-migrations-result.json', 'result of the joint migrations rehearsal (consolidate into docs first)'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\schema-order-A.sql', 'schema dump, order A'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\schema-order-B.sql', 'schema dump, order B'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\combined-lf', 'LF clone used to build/test the joint Hub (node_modules inside); has the temporary worktree branch as origin'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\combined-logs', 'lint/typecheck/build/focused-test logs of the joint Hub'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\run-combined.sh', 'runner script of the joint Hub checks'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\n8n-coexistence-static.json', 'static n8n analysis result (consolidate into docs first)'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\n8n-coexistence-runtime.json', 'isolated n8n coexistence result (consolidate into docs first)'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\hub-on-joint-db.json', 'Hub-on-migrated-database probe result (consolidate into docs first)'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta\\joint-deploy-rehearsal-3.log', 'persistent Pagos gate / deploy / rollback rehearsal log (final run; consolidate into docs first)'],
  ['CANDIDATE', 'C:\\Users\\06\\Documents\\Daubert\\ensayo-integracion-conjunta', 'parent folder of the ensayo artifacts (remove last)'],
  ['CANDIDATE', path.join(tmp, 'daubert-hub-rbtest'), 'rehearsal env file (throw-away passwords) and compose copy'],
  ['CANDIDATE', path.join(tmp, 'daubert-hub-rbtestb'), 'rehearsal env file (throw-away passwords) and compose copy, release B run'],
  ['CANDIDATE', path.join(scratch, 'b2-sim'), 'clone: branch + origin/main merge simulation (node_modules inside)'],
  ['CANDIDATE', path.join(scratch, 'b2-sim-crlf'), 'clone with CRLF working tree (first simulation)'],
  ['CANDIDATE', path.join(scratch, 'b2-relB'), 'clone: release B (6370753 + Caterpillar) validation (node_modules inside)'],
  ['CANDIDATE', path.join(scratch, 'b2-pf'), 'clone: preflight run for release B (holds a REDACTED env copy)'],
  ['CANDIDATE', path.join(scratch, 'b2-pf-old'), 'earlier preflight clone, if present'],
  ['REVIEW_FIRST', 'C:\\Users\\06\\Documents\\Dropbox\\Pruebas\\REMISIONES CAT\\00_ARCHIVOS A PROCESAR\\PROGRAMACION DE ENTREGA CAT P2 PRUEBA B1 20261026.xlsx', 'TEST scenario file created for B1 (script -Remove deletes exactly these two); its TEST execution 239 stays as evidence'],
  ['REVIEW_FIRST', 'C:\\Users\\06\\Documents\\Dropbox\\Pruebas\\REMISIONES CAT\\00_ARCHIVOS A PROCESAR\\PROGRAMACI\u00d3N DE ENTREGA CAT SC PLANTA 2 PRUEBA PG FINAL2.xlsx', 'TEST copy of an already-emitted historical file (B1 scenario)'],
  ['CANDIDATE', '/tmp/prodcat.txt', 'catalog listing of the backup (Git Bash /tmp)']
];
for (const [action, p, note] of entries) inventory.files.push({ action, path: p, exists: fs.existsSync(p), size: mb(sizeOf(p)), note });
for (const name of fs.readdirSync(scratch)) {
  if (/^(sim|sim2|sim3|relB|hub-rehearsal|evlog|inv|cls|docs|q\d|t1|histlock|testq|pgq|patch_docs|run-)/.test(name) || /\.(log|json|sql|cjs|sh)$/.test(name)) {
    const p = path.join(scratch, name);
    if (!inventory.files.some(f => f.path === p)) inventory.files.push({ action: 'CANDIDATE', path: p, exists: true, size: mb(sizeOf(p)), note: 'scratchpad working file (logs, scripts, probes)' });
  }
}
for (const name of fs.readdirSync(tmp)) {
  const p = path.join(tmp, name);
  if (/^(patch_docs\d*\.cjs|hub-probe-.*\.cjs|joint-probe-.*\.cjs)$/.test(name)) inventory.files.push({ action: 'CANDIDATE', path: p, exists: true, size: mb(sizeOf(p)), note: 'temporary patch/probe script' });
  else if (/^daubert-hub-rbtest[a-z0-9]*$/.test(name) && !inventory.files.some(f => f.path === p)) inventory.files.push({ action: 'CANDIDATE', path: p, exists: true, size: mb(sizeOf(p)), note: 'rehearsal env file (throw-away passwords), compose copies, gate files and probe logs of one project' });
  else if (/^daubert-n8n-rehearsal-/.test(name)) inventory.files.push({ action: 'CANDIDATE', path: p, exists: true, size: mb(sizeOf(p)), note: 'temporary workflow copies used by the isolated n8n rehearsal' });
}
// Our rehearsal containers include the isolated n8n instances (prefix daubert-hub-rbtest-n8n-), already covered by the daubert-hub-rbtest prefix.
inventory.notOurs.pagosPhase0Anchor = 'daubert-hub-api:rollback-6370753 exists with a PRODUCTION name; the Pagos proposal states "Phase 0 created rollback-6370753": created by the Pagos work, NOT by these rehearsals. Keep.';

const out = process.argv.indexOf('--out') >= 0 ? process.argv[process.argv.indexOf('--out') + 1] : null;
const text = JSON.stringify(inventory, null, 2);
if (out) fs.writeFileSync(out, text);
console.log(JSON.stringify({
  containers: inventory.docker.containers.length, volumes: inventory.docker.volumes.length, networks: inventory.docker.networks, images: inventory.docker.images.length,
  files: { keep: inventory.files.filter(f => f.action === 'KEEP').length, candidate: inventory.files.filter(f => f.action === 'CANDIDATE').length, reviewFirst: inventory.files.filter(f => f.action === 'REVIEW_FIRST').length },
  gitWorktrees: inventory.git.worktrees.length, ourBranches: inventory.git.ourBranches, ourRefs: inventory.git.ourRefs
}, null, 2));
