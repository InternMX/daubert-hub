'use strict';
/*
 * n8n-sqlite-snapshot.js  (helper versionado del backup de n8n)
 *
 * Crea un snapshot CONSISTENTE de la base SQLite de n8n mientras n8n sigue
 * ejecutandose, usando UNICAMENTE APIs built-in de Node (node:sqlite):
 *   DatabaseSync + backup().
 * No depende de paquetes npm, no copia el archivo .sqlite ni su WAL/SHM.
 *
 * Uso:
 *   node --no-warnings n8n-sqlite-snapshot.js --source <database.sqlite> --dest <snapshot.sqlite>
 *
 * Contrato de salida:
 *   - stdout: UNA linea JSON con metadata segura:
 *       {"ok":true,"quickCheck":"ok","tableCount":N,"sizeBytes":N}
 *       {"ok":false,"error":"<codigo>","detail":"<codigo corto>"}
 *   - exit code 0 solo si el snapshot existe, es consistente y quick_check == ok.
 *     Cualquier otro caso sale con codigo != 0 y elimina el snapshot parcial.
 *   - NUNCA imprime filas, credenciales ni contenido de tablas: del quick_check
 *     solo se informa "ok" o "failed"; de los errores, solo un codigo corto.
 */

const fs = require('node:fs');
const path = require('node:path');

function emit(obj, exitCode) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exitCode = exitCode;
}

function fail(error, detail, exitCode) {
  const out = { ok: false, error };
  if (detail) out.detail = String(detail).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
  emit(out, exitCode || 1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--dest') args.dest = argv[++i];
    else return null;
  }
  return args.source && args.dest ? args : null;
}

function removeQuietly(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
}

function removeSidecars(dest) {
  for (const suffix of ['-wal', '-shm', '-journal']) removeQuietly(dest + suffix);
}

async function main() {
  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch (err) {
    return fail('sqlite_unavailable', err && err.code, 2);
  }
  const { DatabaseSync, backup } = sqlite;
  if (typeof DatabaseSync !== 'function' || typeof backup !== 'function') {
    return fail('backup_api_unavailable', null, 2);
  }

  const args = parseArgs(process.argv.slice(2));
  if (!args) return fail('invalid_arguments', null, 2);

  const source = path.resolve(args.source);
  const dest = path.resolve(args.dest);
  if (source.toLowerCase() === dest.toLowerCase()) return fail('dest_equals_source', null, 2);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return fail('source_missing', null, 2);
  if (fs.existsSync(dest)) return fail('dest_exists', null, 2);

  // 1-3. Abrir la SQLite origen (solo lectura), backup() al staging, cerrar la fuente.
  let src = null;
  try {
    src = new DatabaseSync(source, { readOnly: true, timeout: 30000 });
    await backup(src, dest);
  } catch (err) {
    removeQuietly(dest);
    removeSidecars(dest);
    return fail('backup_failed', err && err.code, 3);
  } finally {
    if (src) {
      try { src.close(); } catch { /* ya cerrada */ }
    }
  }

  // 4-7. Abrir el snapshot, PRAGMA quick_check, contar tablas de sqlite_schema.
  let snap = null;
  try {
    snap = new DatabaseSync(dest);
    const rows = snap.prepare('PRAGMA quick_check').all();
    const isOk = rows.length === 1 && String(Object.values(rows[0])[0]).toLowerCase() === 'ok';
    if (!isOk) {
      snap.close();
      snap = null;
      removeQuietly(dest);
      removeSidecars(dest);
      return fail('quick_check_failed', null, 4);
    }
    const tableCount = Number(snap.prepare("SELECT COUNT(*) AS c FROM sqlite_schema WHERE type = 'table'").get().c);
    snap.close();
    snap = null;
    removeSidecars(dest); // el snapshot debe quedar como un unico archivo autocontenido
    const sizeBytes = fs.statSync(dest).size;
    return emit({ ok: true, quickCheck: 'ok', tableCount, sizeBytes }, 0);
  } catch (err) {
    if (snap) {
      try { snap.close(); } catch { /* ignorar */ }
    }
    removeQuietly(dest);
    removeSidecars(dest);
    return fail('snapshot_check_failed', err && err.code, 5);
  }
}

main().catch((err) => fail('unexpected_error', err && err.code, 1));
