#!/usr/bin/env node
'use strict';

// READ ONLY inventory of the Caterpillar PROD input folders, mirroring the detector of "Remisiones CAT Produccion PG" (paths, name pattern, enabled plants P2/P5/P6,
// production cutoff 2026-09-22). It never moves, renames, deletes or writes files; hashes are computed by reading. With --db it also cross-checks each candidate
// against core.documentos / ops.ejecuciones_automatizacion in daubert_global inside a READ ONLY transaction that is rolled back (postgres account of the session
// reused in memory from TEST_DATABASE_URL_MIGRATOR, localhost:5432 only; the password is never printed).
//   node scripts/inventory-caterpillar-prod-files.cjs [--db]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DROPBOX = 'C:\\Users\\06\\Documents\\Dropbox\\';
const TOOLS = `${DROPBOX}HERRAMIENTAS AUTOMATIZACION\\REMISIONES CAT\\`;
const CUTOFF = new Date('2026-09-22T00:00:00-06:00');
const ENABLED = new Set(['P2', 'P5', 'P6']);
const YEARS = (() => { const now = new Date(); return now.getMonth() === 0 ? [now.getFullYear() - 1, now.getFullYear()] : [now.getFullYear()]; })();
const SOURCES = [
  { tag: 'P2', dir: `${DROPBOX}CLIENTES\\CATERPILLAR MEXICO - P2\\SOLICITUD DE MATERIAL`, plant: () => 'P2' },
  ...YEARS.map(y => ({ tag: `P3-P6 ${y}`, dir: `${DROPBOX}CLIENTES\\CATERPILLAR INDUSTRIAS MEXICO - P3 P4 P5 P6\\MAS INFORMACION\\SOLICITUD DE MATERIAL\\${y}`, plant: plantFromName })),
  ...YEARS.map(y => ({ tag: `NUEVO_LAREDO ${y}`, dir: `${DROPBOX}CLIENTES\\CAT NUEVO LAREDO\\MAS INFORMACION\\SOLICITUD DE MATERIAL\\${y}`, plant: () => 'NUEVO_LAREDO' })),
  { tag: 'TORREON', dir: `${DROPBOX}CLIENTES\\CAT TORREON\\MAS INFORMACION\\SOLICITUD DE MATERIAL`, plant: () => 'TORREON' },
];
const WORK_DIRS = ['01_ENTRADA', '00_ARCHIVOS A PROCESAR', '04_ERRORES', '06_ARCHIVOS TEMPORALES'].map(d => ({ tag: d, dir: `${TOOLS}${d}` }));

const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
function plantFromName(name) {
  const n = norm(name);
  if (n.includes('SC PLANTA 3') || n.includes('SC PL 3')) return 'P3';
  const m = n.match(/\b(?:PLANTA|PL)\s*(\d+)\b/);
  return m ? `P${m[1]}` : 'SIN_PLANTA';
}
const isExcel = name => /\.(xlsx|xlsm|xls)$/i.test(name);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function scan() {
  const candidates = [];
  const workFolders = [];
  for (const src of SOURCES) {
    if (!fs.existsSync(src.dir)) { candidates.push({ tag: src.tag, missingFolder: true }); continue; }
    for (const entry of fs.readdirSync(src.dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('~$') || !isExcel(entry.name) || !norm(entry.name).includes('PROGRAMACION DE ENTREGA')) continue;
      const full = path.join(src.dir, entry.name);
      const stat = fs.statSync(full);
      const plant = src.plant(entry.name);
      candidates.push({ tag: src.tag, plant, name: entry.name, size: stat.size, mtime: stat.mtime.toISOString(),
        enabled: ENABLED.has(plant), afterCutoff: stat.mtime >= CUTOFF, sha256: sha(full) });
    }
  }
  for (const w of WORK_DIRS) {
    if (!fs.existsSync(w.dir)) { workFolders.push({ tag: w.tag, exists: false }); continue; }
    const files = fs.readdirSync(w.dir, { withFileTypes: true }).filter(e => e.isFile());
    workFolders.push({ tag: w.tag, exists: true, files: files.length, excel: files.filter(f => isExcel(f.name)).length });
  }
  return { candidates, workFolders };
}

async function crossCheck(files) {
  const { Client } = require(require.resolve('pg', { paths: [path.join(__dirname, '..', 'apps', 'api')] }));
  const url = new URL(process.env.TEST_DATABASE_URL_MIGRATOR || '');
  if (decodeURIComponent(url.username) !== 'postgres' || !['localhost', '127.0.0.1'].includes(url.hostname) || (url.port || '5432') !== '5432') throw new Error('Only postgres@localhost:5432 may be reused');
  const client = new Client({ host: url.hostname, port: 5432, user: 'postgres', password: decodeURIComponent(url.password), database: 'daubert_global',
    options: '-c default_transaction_read_only=on -c statement_timeout=15000' });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const id = (await client.query("SELECT current_database() AS db, current_setting('transaction_read_only') AS ro")).rows[0];
    if (id.db !== 'daubert_global' || id.ro !== 'on') throw new Error('Unexpected connection identity');
    const hasSnapshotColumn = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'core' AND table_name = 'documentos' AND column_name = 'caterpillar_admission'")).rowCount === 1;
    const docs = (await client.query(`SELECT d.documento_id, d.nombre_archivo, lower(btrim(d.hash_archivo)) AS hash, ${hasSnapshotColumn ? 'd.caterpillar_admission IS NOT NULL' : 'false'} AS has_snapshot,
        (SELECT string_agg(e.ejecucion_id || ':' || e.estado, ',' ORDER BY e.ejecucion_id) FROM ops.ejecuciones_automatizacion e WHERE e.documento_origen_id = d.documento_id) AS executions
      FROM core.documentos d WHERE d.tipo_documento = 'PROGRAMACION_ENTREGA'`)).rows;
    const series = (await client.query("SELECT codigo, siguiente_folio::text AS next FROM operacion.series_documentales WHERE codigo IN ('REMISION_CAT_P2','REMISION_CAT_P5','REMISION_CAT_P6') ORDER BY codigo")).rows;
    const running = (await client.query("SELECT ejecucion_id::text AS id, estado FROM ops.ejecuciones_automatizacion WHERE estado IN ('PROCESANDO','PENDIENTE') ORDER BY 1")).rows;
    const sessions = (await client.query(`SELECT count(*) FILTER (WHERE state LIKE 'idle in transaction%')::int AS idle_in_tx, count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting_locks,
        count(*)::int AS total FROM pg_stat_activity WHERE datname = 'daubert_global' AND pid <> pg_backend_pid()`)).rows[0];
    await client.query('ROLLBACK');
    for (const f of files) {
      f.pgByHash = docs.filter(d => d.hash && d.hash === f.sha256).map(d => `doc ${d.documento_id} [${d.executions || 'sin ejecucion'}]${d.has_snapshot ? ' snapshot' : ''}`);
      f.pgByName = docs.filter(d => d.nombre_archivo === f.name).map(d => d.documento_id);
      f.pending = f.pgByHash.length === 0;
    }
    return { series, running, sessions };
  } finally { await client.end(); }
}

(async () => {
  const { candidates, workFolders } = scan();
  const files = candidates.filter(c => !c.missingFolder);
  const result = { scannedAt: new Date().toISOString(), cutoff: CUTOFF.toISOString(), workFolders, missingFolders: candidates.filter(c => c.missingFolder).map(c => c.tag) };
  if (process.argv.includes('--db')) result.postgres = await crossCheck(files);
  const detector = files.filter(f => f.enabled && f.afterCutoff);
  const byHash = new Map();
  for (const f of files) byHash.set(f.sha256, [...(byHash.get(f.sha256) || []), `${f.tag}:${f.name}`]);
  result.summary = { enabledAfterCutoff: detector.length, enabledBeforeCutoff: files.filter(f => f.enabled && !f.afterCutoff).length, notEnabled: files.filter(f => !f.enabled).length,
    pendingAmongDetectorCandidates: process.argv.includes('--db') ? detector.filter(f => f.pending).length : 'run with --db' };
  result.detectorCandidates = detector.map(f => ({ plant: f.plant, name: f.name, size: f.size, mtime: f.mtime, sha256: f.sha256.slice(0, 12), pg: f.pgByHash, pending: f.pending }));
  result.duplicateContent = [...byHash.values()].filter(g => g.length > 1);
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(`INVENTORY_FAILED: ${String(error.message).split('\n')[0].slice(0, 200)}`); process.exitCode = 1; });
