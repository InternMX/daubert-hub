// Offline generator (5F). Base is the reviewed candidate-5678 JSON (itself derived from the TEST export), NOT PROD and NOT 5690.
// Output stays INACTIVE and BLOCKED: every PostgreSQL/file/command action keeps its unconditional hold. Nothing is imported or executed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base5678 = require('../candidate-5678/prepare-candidate.cjs');

const sourceFile = path.join(__dirname, '../candidate-5678/caterpillar-test-5678.PROPOSED.BLOCKED.json');
const outputFile = path.join(__dirname, 'caterpillar-test-015.PROPOSED.BLOCKED.json');
const { holdCode } = base5678;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const gateSql = (fn) => `SELECT * FROM ops.${fn}($1::bigint,$2::text,$3::text,$4::integer);`;
const holdExpression = body => `={{ (() => { ${holdCode} return ${body}; })() }}`;
const nm = (candidate, startsWith) => candidate.nodes.find(n => n.name.startsWith(startsWith));

function replaceOnce(code, search, replacement) {
  const hits = typeof search === 'string' ? code.split(search).length - 1 : (code.match(search) || []).length;
  if (hits !== 1) throw new Error('Unexpected source shape for 015 adaptation: ' + String(search).slice(0, 60));
  return code.replace(search, replacement);
}

// The V1 manifest is already computed (before Torreon grouping) and transported by Normalizar; only its canonical text travels to SQL.
// Company and file name come from the stored document inside ops.fn_guardar_snapshot_caterpillar_test, never from this workflow.
const SNAPSHOT_PREPARE = `const items = $input.all();
const content = items[0]?.json?.cat_operational_content;
const origen = $("Propagar documento origen PG").first().json || {};
if (!items.length || !content?.manifest || !origen.documento_origen_id) {
  throw new Error("CAT_TEST_015_SNAPSHOT_INPUT_INVALID");
}
return [{ json: { documento_origen_id: String(origen.documento_origen_id), manifest_canonical: JSON.stringify(content.manifest) } }];`;
// Continue ONLY after STORED/ALREADY_STORED; any other result (CONFLICT, HISTORICAL_LOCKED, SQL error) aborts before any execution exists.
const SNAPSHOT_VERIFY = `const estado = $input.first()?.json?.estado;
if (!["STORED", "ALREADY_STORED"].includes(estado)) {
  throw new Error("CAT_TEST_015_SNAPSHOT_NOT_STORED");
}
return $("Normalizar datos CAT").all();`;

const PREPARE_TAIL_ORIGINAL = `if (!base.ejecucion_id) {
  throw new Error("No existe ejecucion_id para reservar folios.");
}`;
const ADMISSION_CONTEXT = `// 015: no hay ejecucion previa; el gate la crea junto con la reserva. El contexto sale del documento resuelto.
const origen = $("Propagar documento origen PG").first().json || {};
if (!origen.documento_origen_id) {
  throw new Error("No existe documento_origen_id para admitir la programacion.");
}
const esReproceso = origen.mode === "REPROCESS";
if (esReproceso !== Boolean(origen.reproceso_de_id)) {
  throw new Error("CAT_TEST_015_REPROCESS_CONTEXT_INVALID");
}`;

const PROPAGATE_ADMISSION = `// Valida la respuesta del gate 015 (equivalente a assertAtomicAdmissionResult). Un BLOCK/REVIEW es un resultado normal SIN derecho a emitir.
const prep = $("Preparar reserva folios PG").first().json;
const origen = $("Propagar documento origen PG").first().json || {};
const rows = $input.all();
if (rows.length !== 1) throw new Error("CAT_TEST_015_ADMISSION_RESPONSE_INVALID");
const r = rows[0].json || {};
const worker = String($execution.id);
const isId = v => (typeof v === "string" && /^[1-9]\\d*$/.test(v)) || (Number.isSafeInteger(v) && v > 0);
if (!["ADMIT", "BLOCK", "REVIEW"].includes(r.decision) || typeof r.can_emit !== "boolean") {
  throw new Error("CAT_TEST_015_ADMISSION_RESPONSE_INVALID");
}
const emitReasons = prep.reproceso_de_id ? ["REPROCESS_ACQUIRED", "OWNED_RETRY"] : ["ACQUIRED", "OWNED_RETRY"];
let puedeEmitir = false;
if (r.can_emit) {
  const proven = r.decision === "ADMIT" && emitReasons.includes(r.reason) && r.worker_id === worker &&
    [r.ejecucion_id, r.reserva_id, r.folio_inicial, r.folio_final].every(isId) &&
    Number(r.cantidad) === prep.cantidad && Number(r.folio_final) - Number(r.folio_inicial) + 1 === prep.cantidad;
  if (!proven) throw new Error("CAT_TEST_015_EMISSION_RIGHT_NOT_PROVEN");
  puedeEmitir = true;
} else if (r.decision === "ADMIT") {
  throw new Error("CAT_TEST_015_ADMISSION_WITHOUT_RESERVATION");
}
const out = {
  ...origen,
  documento_origen_id: prep.documento_origen_id,
  mode: prep.mode,
  reproceso_de_id: prep.reproceso_de_id,
  serie_codigo: prep.serie_codigo,
  cat_operational_content: prep.cat_operational_content,
  puede_emitir: puedeEmitir,
  admision_decision: r.decision,
  admision_reason: String(r.reason ?? ""),
  cantidad: puedeEmitir ? Number(r.cantidad) : prep.cantidad
};
if (puedeEmitir) {
  Object.assign(out, { ejecucion_id: String(r.ejecucion_id), reserva_id: String(r.reserva_id),
    folio_inicial: String(r.folio_inicial), folio_final: String(r.folio_final) });
} else if (r.ejecucion_id) {
  out.ejecucion_ajena_id = String(r.ejecucion_id); // Informativo: NUNCA se usa para registrar, fallar ni finalizar.
}
return [{ json: out }];`;

const MAP_REPROCESS = `// Traduce la decision del gate 015 a un status sanitizado para el webhook. Falla cerrado ante cualquier razon desconocida.
const json = $input.first()?.json || {};
const razon = String(json.admision_reason ?? "").trim();
const RAZON_A_STATUS = {
  REPROCESS_ACQUIRED: "PROCESSING",
  OWNED_RETRY: "PROCESSING",
  REPROCESS_IN_PROGRESS: "ALREADY_PROCESSING",
  ALREADY_REPROCESSED: "ALREADY_REPROCESSED"
};
const status = RAZON_A_STATUS[razon] ?? null;
const hija = json.puede_emitir === true ? json.ejecucion_id : json.ejecucion_ajena_id;
const valido = status !== null && Boolean(hija) && (status === "PROCESSING") === (json.puede_emitir === true);
// Gate refusals are domain rules for the Hub (409), never an "accepted" answer and never a technical error.
const rechazo = valido ? null : razon === "PARENT_NOT_REPROCESSABLE" ? "NOT_ELIGIBLE_STATE"
  : json.puede_emitir === false && ["BLOCK", "REVIEW"].includes(json.admision_decision) ? "ADMISSION_REJECTED" : "UNEXPECTED_EXECUTION_STATE";
return [{ json: { ...json, reproceso_status: valido ? status : null, reproceso_status_valido: valido,
  reproceso_status_motivo_crudo: razon, reproceso_ejecucion_hija_id: valido ? String(hija) : null, reproceso_motivo_rechazo: rechazo } }];`;

function ifBoolean(id, expression) {
  return { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
    conditions: [{ id, leftValue: expression, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } };
}

function prepare(source) {
  const c = structuredClone(source);
  c.name = 'Caterpillar TEST 015 — PROPOSED / BLOCKED';
  c.active = false; c.pinData = {}; c.tags = [];
  const byName = name => c.nodes.find(n => n.name === name);
  const find = prefix => nm(c, prefix);
  const crear = find('Crear o recuperar ejecuci'), propagarEjec = find('Propagar ejecuci');
  const esReproceso = find('¿Es reproceso?'), procesar = find('¿Procesar seg'), mapear = find('Mapear resultado creaci');
  const reservar = byName('Reservar folios PG'), normalizar = byName('Normalizar datos CAT'), prepararReserva = byName('Preparar reserva folios PG');
  const asignar = byName('Asignar folios PG CAT'), registrar = find('Registrar remisi'), finalizar = find('Finalizar ejecuci');
  const fallo = byName('Registrar fallo PG'), prepararError = byName('Preparar error CAT'), aceptado = byName('Responder reproceso aceptado');
  for (const n of [crear, propagarEjec, esReproceso, procesar, mapear, reservar, normalizar, prepararReserva, asignar, registrar, finalizar, fallo, prepararError, aceptado]) {
    if (!n) throw new Error('Candidate-5678 topology changed; review required');
  }
  const connections = c.connections;

  // The unconnected diagnostic node (pg_get_functiondef of a legacy function) is dropped: nothing in the candidate should name them.
  c.nodes = c.nodes.filter(n => n.name !== 'Execute a SQL query');
  delete connections['Execute a SQL query'];

  // 1. Resolve document -> catalogues/normalization. The execution is created by the gate AFTER the snapshot, never before.
  c.nodes = c.nodes.filter(n => n !== crear && n !== propagarEjec);
  delete connections[crear.name]; delete connections[propagarEjec.name];
  connections['Propagar documento origen PG'] = { main: [[{ node: 'Leer catálogo Caterpillar', type: 'main', index: 0 }]] };

  // 2. Normalization reads the document context only (no emitting execution required).
  normalizar.parameters.jsCode = replaceOnce(normalizar.parameters.jsCode,
    /const contexto = \$\("Propagar ejecuci.n PG"\)\.first\(\)\.json;\s*if \(!contexto\.documento_origen_id \|\| !contexto\.ejecucion_id\) \{[\s\S]*?\n\}/,
    `const contexto = $("Propagar documento origen PG").first().json;

if (!contexto.documento_origen_id) {
  throw new Error(
    "Normalizar datos CAT no recibió documento_origen_id desde PostgreSQL."
  );
}`);
  normalizar.notes += ' 015: contexto desde el documento; la ejecucion nace en el gate.';

  // 3. Snapshot capture BEFORE the gate: prepare -> protected SQL entry -> verify -> original normalized items. Failure aborts; no execution exists yet.
  const at = (n, dx) => [normalizar.position[0] + dx, normalizar.position[1] - 160];
  const snapPrepare = { id: 'cat015-snapshot-0001', name: 'Preparar snapshot admisión CAT', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: at(0, 224), parameters: { jsCode: SNAPSHOT_PREPARE }, notes: 'Solo el manifest V1 canonico viaja a SQL. Sin I/O.' };
  const snapSave = { id: 'cat015-snapshot-0002', name: 'Guardar snapshot admisión CAT', type: 'n8n-nodes-base.postgres', typeVersion: 2.6,
    position: at(0, 448), parameters: { operation: 'executeQuery',
      query: holdExpression(JSON.stringify('SELECT ops.fn_guardar_snapshot_caterpillar_test($1::bigint,$2::text) AS estado;')),
      options: { queryReplacement: '={{ [ $json.documento_origen_id, $json.manifest_canonical ] }}' } },
    notes: 'SQL HOLD. Entrada protegida de 015: compare-and-set inmutable; n8n_cat_test no recibe UPDATE sobre core.documentos.' };
  const snapVerify = { id: 'cat015-snapshot-0003', name: 'Verificar snapshot CAT', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: at(0, 672), parameters: { jsCode: SNAPSHOT_VERIFY }, notes: 'Fail-closed: solo STORED/ALREADY_STORED continua; re-emite los items normalizados originales.' };
  connections[normalizar.name].main[0] = [{ node: snapPrepare.name, type: 'main', index: 0 }];
  connections[snapPrepare.name] = { main: [[{ node: snapSave.name, type: 'main', index: 0 }]] };
  connections[snapSave.name] = { main: [[{ node: snapVerify.name, type: 'main', index: 0 }]] };
  connections[snapVerify.name] = { main: [[{ node: prepararReserva.name, type: 'main', index: 0 }]] };

  // 4. Series/quantity preparation without an execution.
  let prep = replaceOnce(prepararReserva.parameters.jsCode, PREPARE_TAIL_ORIGINAL, ADMISSION_CONTEXT);
  prep = replaceOnce(prep, '      ejecucion_id: String(base.ejecucion_id),',
    '      documento_origen_id: String(origen.documento_origen_id),\n      mode: origen.mode || null,\n      reproceso_de_id: esReproceso ? String(origen.reproceso_de_id) : null,');
  prepararReserva.parameters.jsCode = prep;

  // 5. Atomic admission + reservation (first emission or protected manual reprocess).
  reservar.parameters.query = holdExpression(`($json.reproceso_de_id ? ${JSON.stringify(gateSql('fn_reprocesar_reservar_caterpillar_test'))} : ${JSON.stringify(gateSql('fn_admitir_reservar_caterpillar_test'))})`);
  reservar.parameters.options = { queryReplacement: '={{ [ $json.reproceso_de_id || $json.documento_origen_id, String($execution.id), $json.serie_codigo, $json.cantidad ] }}' };
  reservar.notes = 'Gate 015: admision + reserva atomicas. Worker = $execution.id real. Reproceso usa la entrada protegida con el id del PADRE. Hold intacto.';

  // 6. Validate the right to emit; branch exclusively on puede_emitir.
  const propagar = { id: 'cat015-admission-0001', name: 'Propagar admisión CAT', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [reservar.position[0] + 224, reservar.position[1]], parameters: { jsCode: PROPAGATE_ADMISSION },
    notes: 'Falla cerrado ante respuesta inesperada. BLOCK/REVIEW => puede_emitir=false.' };
  c.nodes.push(snapPrepare, snapSave, snapVerify, propagar);
  connections[reservar.name] = { main: [[{ node: propagar.name, type: 'main', index: 0 }]] };
  connections[propagar.name] = { main: [[{ node: esReproceso.name, type: 'main', index: 0 }]] };
  mapear.parameters.jsCode = MAP_REPROCESS;
  aceptado.parameters.responseBody = '={{ {\n  accepted: true,\n  originalExecutionId: $json.reproceso_de_id,\n  executionId: $json.reproceso_ejecucion_hija_id,\n  status: $json.reproceso_status\n} }}';
  aceptado.notes = 'BLOQUEADO hasta medir: la respuesta ahora ocurre despues de leer Excel y del gate (timeout Hub 10 s).';
  // Not-accepted reprocess answers all go through the rejection responder (known Hub codes); the unreachable "estado inesperado" node is dropped.
  connections['¿Estado de reproceso reconocido?'].main[1] = [{ node: 'Responder reproceso rechazado', type: 'main', index: 0 }];
  c.nodes = c.nodes.filter(n => n.name !== 'Responder reproceso estado inesperado');
  procesar.name = '¿Puede emitir CAT?';
  procesar.parameters = ifBoolean('cat015-can-emit-0001', '={{ $json.puede_emitir === true }}');
  const rename = (from, to) => { connections[to] = connections[from]; delete connections[from];
    for (const entry of Object.values(connections)) for (const outputs of entry.main) for (const t of outputs) if (t.node === from) t.node = to; };
  rename('¿Procesar según PG?', procesar.name);
  connections[procesar.name] = { main: [[{ node: asignar.name, type: 'main', index: 0 }], [{ node: 'Loop Over Items', type: 'main', index: 0 }]] };

  // 7. Assignment uses the reservation returned by the gate; the execution id comes from the proven result only.
  asignar.parameters.jsCode = replaceOnce(asignar.parameters.jsCode, 'const reservaId = reserva.reserva_id;',
    'if (reserva.puede_emitir !== true || !reserva.ejecucion_id) {\n  throw new Error("CAT_TEST_015_NO_EMISSION_RIGHT");\n}\nconst reservaId = reserva.reserva_id;');
  asignar.parameters.jsCode = replaceOnce(asignar.parameters.jsCode, '      reserva_id: String(reservaId),',
    '      ejecucion_id: String(reserva.ejecucion_id),\n      reserva_id: String(reservaId),');

  // 8. Protected wrappers (owner check inside SQL). Parameter order keeps the legacy contract; worker is inserted second.
  registrar.parameters.query = holdExpression(JSON.stringify('SELECT * FROM operacion.fn_registrar_remision_caterpillar_test($1::bigint,$2::text,$3::text,$4::bigint,$5::date,$6::text,$7::jsonb);'));
  registrar.parameters.options = { queryReplacement: '={{ [  $json.ejecucion_id,  String($execution.id),  $json.serie_codigo,  $json.folio_numero,  $json.fecha_documento,  $json.pdf_path,  JSON.stringify($json.detalles)] }}' };
  finalizar.parameters.query = holdExpression(JSON.stringify('SELECT * FROM ops.fn_finalizar_caterpillar_test($1::bigint,$2::text,$3::text,$4::text,$5::text);'));
  finalizar.parameters.options = { queryReplacement: '={{ [  $json.ejecucion_id,  String($execution.id),  $json.estado_final,  null,  null] }}' };
  fallo.parameters.query = holdExpression(JSON.stringify('SELECT\n    f.*,\n    $3::text AS nodo_error,\n    $4::text AS error_mensaje\nFROM ops.fn_fallo_caterpillar_test(\n    $1::bigint,\n    $2::text,\n    $3::text,\n    $4::text\n) AS f;'));

  // 9. Failures before admission never touch SQL; only a PROVEN own execution of the CURRENT document receives a fault.
  let err = replaceOnce(prepararError.parameters.jsCode, /const contextoPG =\s*getNodeJson\("Propagar ejecuci.n PG"\);/,
    'const contextoPG = getNodeJson("Propagar admisión CAT");\nconst documentoActual = getNodeJson("Propagar documento origen PG");');
  err = replaceOnce(err, /const ejecucionId = getFirstExisting\(\s*current\.ejecucion_id,\s*contextoPG\.ejecucion_id\s*\);\s*if \(!ejecucionId\) \{[\s\S]*?\n\}/,
    '// Contexto de admision viejo (otra iteracion del loop) NUNCA cuenta: debe pertenecer al documento actual y haber probado propiedad.\n' +
    'const ejecucionId = contextoPG.puede_emitir === true &&\n  cleanText(contextoPG.documento_origen_id) === cleanText(documentoActual.documento_origen_id)\n  ? cleanText(contextoPG.ejecucion_id)\n  : "";');
  err = replaceOnce(err, '      ejecucion_id: String(ejecucionId),', '      ejecucion_id: ejecucionId,\n      fallo_previo_admision: ejecucionId === "",');
  prepararError.parameters.jsCode = err;
  const branch = { id: 'cat015-owned-0001', name: '¿Ejecución propia confirmada?', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [prepararError.position[0] + 224, prepararError.position[1]], parameters: ifBoolean('cat015-owned-cond-0001', '={{ $json.fallo_previo_admision === false }}') };
  c.nodes.push(branch);
  connections[prepararError.name] = { main: [[{ node: branch.name, type: 'main', index: 0 }]] };
  connections[branch.name] = { main: [[{ node: fallo.name, type: 'main', index: 0 }], [{ node: 'Registrar log error CAT', type: 'main', index: 0 }]] };

  for (const n of c.nodes.filter(x => x.type.endsWith('.stickyNote'))) {
    n.parameters.content = '## Caterpillar TEST 015 — NO APTO PARA EJECUCIÓN\nOffline: gate atómico 015; captura de snapshot por entrada SQL protegida; respuesta de reproceso sigue bloqueada.';
  }
  return c;
}

function main() {
  const bytes = fs.readFileSync(sourceFile);
  const candidate = prepare(JSON.parse(bytes));
  fs.writeFileSync(outputFile, JSON.stringify(candidate, null, 2) + '\n');
  console.log(JSON.stringify({ candidate: path.relative(base5678.root, outputFile), sha256: hash(fs.readFileSync(outputFile)), baseSha256: hash(bytes) }));
}
if (require.main === module) main();
module.exports = { prepare, outputFile, sourceFile, hash };
