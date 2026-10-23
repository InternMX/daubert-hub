// Offline generator of the two STAGED, INACTIVE copies derived from the reviewed BLOCKED candidate. Imports/activates nothing.
//   INSPECT : read-only inspection (Excel, classification, V1 manifest). No PostgreSQL, no file/command mutation: stops at "Preparar snapshot".
//   FULL    : every action unlocked, but only through confined paths (TEST root) and the protected 015 SQL entries; credential cat_test by id.
// Neither profile enables Schedule; the webhook stays disabled until the operator enables it after the manual stages.
const fs = require('node:fs');
const path = require('node:path');
const { createCaterpillarWindowsTestSafety } = require('../candidate-5678/runtime-test-safety.cjs');
const { catConfinedPath, catCommandArg, createCaterpillarConfinedFs, WRITE_SUBTREES, TEMP_SUBTREE } = require('./confined-fs.cjs');

const blockedFile = path.join(__dirname, 'caterpillar-test-015.PROPOSED.BLOCKED.json');
const outputs = { INSPECT: path.join(__dirname, 'caterpillar-test-015.INSPECT.INACTIVE.json'), FULL: path.join(__dirname, 'caterpillar-test-015.FULL.INACTIVE.json'),
  FAILURE: path.join(__dirname, 'caterpillar-test-015.FAILURE.INACTIVE.json') };
const ROOT = 'C:\\Users\\06\\Documents\\Dropbox\\Pruebas\\REMISIONES CAT';
const SCRIPTS = '05_ARCHIVOS AUXILIARES\\SCRIPTS';
const CAT_TEST_CREDENTIAL = { postgres: { id: 'xK9CGscXx6kKLZTi', name: 'cat_test' } }; // reference only; the secret never leaves n8n
const HOLD = "throw new Error('CAT_TEST_5678_NOT_APPROVED');";
const helpers = [catConfinedPath, catCommandArg].map(fn => fn.toString()).join('\n');
const ps = JSON.stringify;

// The BLOCKED candidate stores every action as: ={{ (() => { <hold> return "<original>"; })() }}
function original(expression) {
  const match = /return ("(?:[^"\\]|\\.)*");\s*\}\)\(\) \}\}$/s.exec(String(expression));
  if (!match || !String(expression).includes(HOLD)) throw new Error('Unexpected hold shape; review required');
  return JSON.parse(match[1]);
}
// SQL holds are either a plain literal or a computed expression (the reprocess/first-emission gate choice).
function originalQuery(expression) {
  const text = String(expression), marker = `${HOLD} return `, tail = '; })() }}';
  if (!text.includes(marker) || !text.endsWith(tail)) throw new Error('Unexpected SQL hold shape; review required');
  const raw = text.slice(text.indexOf(marker) + marker.length, -tail.length);
  try { const literal = JSON.parse(raw); if (typeof literal === 'string') return literal; } catch { /* computed expression */ }
  return `={{ ${raw} }}`;
}
const inner = value => { const m = /^=\{\{([\s\S]*)\}\}$/.exec(value.trim()); if (!m) throw new Error('Unexpected expression shape'); return m[1].trim(); };
const checked = (expression, subtrees) =>
  `={{ (() => { ${helpers}\nconst __v = (${expression}); catConfinedPath(__v, ${ps(ROOT)}, ${ps(subtrees)}); return __v; })() }}`;

function unlockNative(node, subtrees) {
  const key = node.parameters.operation === 'write' ? 'fileName' : 'fileSelector';
  node.parameters[key] = checked(inner(original(node.parameters[key])), subtrees);
  node.notes = 'Etapa habilitada: la ruta debe quedar dentro de la raiz TEST y del subarbol permitido.';
}
function unlockCodeIo(node, confinedWrites) {
  let code = node.parameters.jsCode;
  if (!code.includes(`// CAT_TEST_IO_HOLD\n${HOLD}\n`)) throw new Error('Unexpected I/O hold shape');
  code = code.replace(`${HOLD}\n`, '');
  if (confinedWrites) {
    const start = code.indexOf('const __catTest = ('), endMarker = ")(require('fs'), require('path'));";
    const end = code.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error('Unexpected safety factory shape');
    const base = code.slice(start + 'const __catTest = ('.length, end);
    code = code.slice(0, start) + `${catConfinedPath.toString()}\nconst __catBase = (${base})(require('fs'), require('path'));\n` +
      `const __catTest = (${createCaterpillarConfinedFs.toString()})(require('fs'), require('path'), __catBase, catConfinedPath, ${ps(WRITE_SUBTREES)}, ${ps(TEMP_SUBTREE)});` +
      code.slice(end + endMarker.length);
  }
  node.parameters.jsCode = code;
}
function unlockCommand(node, expression) {
  node.parameters.command = `={{ (() => { ${helpers}\nconst r = ${ps(ROOT)};\n${expression}\n})() }}`;
  node.notes = 'Etapa habilitada: script fijo del arbol TEST; argumentos confinados y sin metacaracteres.';
}
const script = file => `if (script.toLowerCase() !== (r + ${ps('\\' + SCRIPTS + '\\' + file)}).toLowerCase()) throw new Error('CAT_TEST_PATH_REJECTED');`;

function stage(blocked, profile) {
  const c = structuredClone(blocked);
  const byName = prefix => c.nodes.find(n => n.name.startsWith(prefix));
  c.name = `Caterpillar TEST 015 \u2014 ${profile} (INACTIVE, staged)`;
  c.active = false;
  const full = profile !== 'INSPECT'; // FAILURE = FULL + failure injection + terminal-ERROR finalization (patched below)
  for (const node of c.nodes) {
    if (node.type.endsWith('.manualTrigger')) { node.disabled = false; node.notes = 'Solo ejecucion manual en el editor.'; }
    if (node.type.endsWith('.webhook')) { node.disabled = true; if (full) node.parameters.path = profile === 'FULL' ? 'cat-test-reprocess-015' : 'cat-test-failure-015-unused'; node.notes = 'Mantener deshabilitado hasta la etapa de reproceso; asignar Header Auth en la UI.'; }
    if (/\.code$/.test(node.type) && String(node.parameters.jsCode).includes('// CAT_TEST_IO_HOLD')) unlockCodeIo(node, full);
  }
  for (const name of ['Leer archivo detectado', 'Leer cat\u00E1logo Caterpillar', 'Leer cat\u00E1logo Caterpillar clientes']) unlockNative(c.nodes.find(n => n.name === name), ['']);
  if (!full) {
    // Inspection: synthetic document (no write), original file read directly, flow ends at the prepared snapshot payload.
    const resolver = c.nodes.find(n => n.name === 'Resolver documento origen PG');
    resolver.type = 'n8n-nodes-base.code'; resolver.typeVersion = 2;
    resolver.parameters = { jsCode: "return [{ json: { documento_id: '0', ya_existia: false } }];" };
    resolver.notes = 'INSPECCION: documento sintetico, sin PostgreSQL.';
    c.connections['Leer archivo detectado'] = { main: [[{ node: 'Extraccion de informacion de excel', type: 'main', index: 0 }]] };
    c.connections['Preparar snapshot admisi\u00F3n CAT'] = { main: [[]] };
    return c;
  }
  unlockNative(byName('Guardar copia en entrada'), ['01_ENTRADA']);
  unlockNative(byName('Leer copia en entrada'), ['']);
  unlockNative(byName('Guardar HTML temporal'), [TEMP_SUBTREE]);
  unlockCommand(byName('Convertir PDF CAT'), `const script = catCommandArg($json.pdf_script_path, r, [${ps(SCRIPTS)}]); ${script('convertir-cat-pdf.ps1')}
const temp = catCommandArg($json.temp_dir, r, [${ps(TEMP_SUBTREE)}]); const out = catCommandArg($json.output_dir, r, ['02_SALIDAS']);
return 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + script + '" -TempDir "' + temp + '" -OutDir "' + out + '"';`);
  const prev = '$node["Preparar conversi\u00F3n PDF CAT"].json';
  unlockCommand(byName('Eliminar HTML temporal CAT'), `const script = catCommandArg(${prev}.clean_script_path, r, [${ps(SCRIPTS)}]); ${script('limpiar-temp-cat.ps1')}
const temp = catCommandArg(${prev}.temp_dir, r, [${ps(TEMP_SUBTREE)}]);
return 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + script + '" -TempDir "' + temp + '"';`);
  for (const node of c.nodes.filter(n => n.type.endsWith('.postgres'))) {
    node.parameters.query = originalQuery(node.parameters.query);
    node.credentials = structuredClone(CAT_TEST_CREDENTIAL);
    node.notes = 'cat_test (usuario n8n_cat_test). Solo entradas protegidas de 015 y resolutores.';
  }
  terminalErrorBranch(c);
  return profile === 'FAILURE' ? injectFailure(c) : c;
}

const nodeOf = (c, name) => { const node = c.nodes.find(n => n.name === name); if (!node) throw new Error(`Missing node ${name}`); return node; };
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) throw new Error('Unexpected error preparation shape; review required');
  return text.replace(from, to);
}

// Error branch of FULL and FAILURE. fn_fallo only counts an attempt (1 of 2) and leaves the execution PROCESANDO, and under 015 no retry can own it again,
// so a controlled error is finalized as a terminal ERROR through the owner-checked protected entry (reservations are abandoned, folios never reused).
// Only the PDF conversion (after admission, before any remission is registered) may own an execution; an error from Normalizar is always pre-admission, so
// stale context of an earlier file in the same n8n run can never finalize a foreign or already COMPLETADA execution.
function terminalErrorBranch(c) {
  const failure = nodeOf(c, 'Registrar fallo PG');
  failure.parameters.query = [
    "SELECT f.ejecucion_id, f.ya_estaba_finalizada AS ya_registrado, f.estado_final AS estado_actual, (f.estado_final = 'ERROR') AS error_final,",
    '  f.reservas_aplicadas, f.reservas_abandonadas, $3::text AS nodo_error, $4::text AS error_mensaje',
    "FROM ops.fn_finalizar_caterpillar_test($1::bigint, $2::text, 'ERROR', $3::text, $4::text) AS f;"
  ].join('\n');
  failure.notes = 'Finalizacion ERROR terminal por la entrada protegida (propietario verificado). Reemplaza fn_fallo, que dejaba PROCESANDO.';
  const prepare = nodeOf(c, 'Preparar error CAT');
  let code = prepare.parameters.jsCode;
  code = replaceOnce(code, 'current.total_html !== undefined ||', ['current.total_html !== undefined ||', '    /powershell|convertir-cat-pdf/i.test(errorMensaje) ||'].join('\n'));
  code = replaceOnce(code, 'return [\n', [
    '// Solo la conversion PDF ocurre despues de la admision y antes de registrar remisiones: cualquier otro origen no es propietario.',
    'const ejecucionPropia = nodoError === "Convertir PDF CAT" ? ejecucionId : "";', '', 'return [', ''
  ].join('\n'));
  code = replaceOnce(code, 'ejecucion_id: ejecucionId,', 'ejecucion_id: ejecucionPropia,');
  code = replaceOnce(code, 'fallo_previo_admision: ejecucionId === "",', 'fallo_previo_admision: ejecucionPropia === "",');
  prepare.parameters.jsCode = code;
  prepare.notes = 'Solo un fallo de Convertir PDF CAT con admision propia confirmada puede finalizar la ejecucion.';
}

// FAILURE TEST copy only: the PDF conversion always exits 1, after the folios are reserved and before any remission is registered.
function injectFailure(c) {
  c.name = 'Caterpillar TEST 015 — FAILURE TEST';
  const convert = nodeOf(c, 'Convertir PDF CAT');
  convert.parameters.command = `powershell -NoProfile -Command "[Console]::Error.WriteLine('CAT_FAILURE_TEST_015: conversion PDF provocada'); exit 1"`;
  convert.notes = 'FAILURE TEST: falla controlada (exit 1) tras reservar folios y antes de registrar remisiones. NO usar en el flujo operativo.';
  return c;
}

function main() {
  const blocked = JSON.parse(fs.readFileSync(blockedFile, 'utf8'));
  for (const profile of Object.keys(outputs)) fs.writeFileSync(outputs[profile], JSON.stringify(stage(blocked, profile), null, 2) + '\n');
  console.log(Object.values(outputs).map(file => path.basename(file)).join('\n'));
}
if (require.main === module) main();
module.exports = { stage, original, outputs, blockedFile, ROOT, CAT_TEST_CREDENTIAL };
