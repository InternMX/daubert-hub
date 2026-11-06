// Offline transformation of the published production export. No network, import, or execution.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const SOURCE_SHA256 = '47e15801d582e1f00d866e3dd21575907b492e61170e84750aca1055806e6295';
const CHILD_ID = 'pagosProdRecuperacion01';
const reroutes = ['Seleccionar correo a reprocesar', 'Preparar solicitud Hub reproceso'];
const removedFromChild = ['Schedule Trigger', 'Reprocesar correo manual', 'Seleccionar correo a reprocesar',
  'Hub - Reprocesar notificación', 'Preparar solicitud Hub reproceso'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const edge = node => ({ main: [[{ node, type: 'main', index: 0 }]] });
const evidence = `={{ [
  $('Entrada recuperacion').first().json.correo_id,
  $('Entrada recuperacion').first().json.recovery_execution_id,
  JSON.stringify($('Aplicar toma de archivo').all().map(it => it.json).filter(j =>
    j.archivo_id && j.archivo_tomado === false && j.estado === 'ERROR' &&
    j.registro_estado === 'REGISTRADO' && j.resolucion_estado === 'PROCESABLE_SIN_ASIGNACION' &&
    !j.empresa_puntual_id && ['ALIAS_NO_CATALOGADO','ALIAS_AMBIGUO'].includes(j.motivo)
  ).map(j => ({ archivo_id: j.archivo_id, tomado: false, adjunto_origen_id: j.adjunto_origen_id,
    zip_sha256: j.zip_sha256, entrada_indice: j.entrada_indice, file_sha256: j.file_hash,
    nombre_archivo: j.file_name, codigo_error: j.motivo })))
] }}`;

function build(bytes) {
  assert.equal(sha(bytes), SOURCE_SHA256, 'Published source drift: refresh export, review diff and update the PR first');
  const source = JSON.parse(bytes);
  assert.equal(source.id, 'pagosProdAsignaciones01'); assert.equal(source.nodes.length, 108);
  assert(!source.pinData || Object.keys(source.pinData).length === 0, 'Pinned business data are not a promotion input');
  const pgSource = source.nodes.find(n => n.name === 'Preparar correo para reproceso');
  assert(pgSource?.credentials?.postgres, 'Production Postgres credential reference missing');
  function pg(name, query, queryReplacement) {
    return { id: name, name, type: pgSource.type, typeVersion: pgSource.typeVersion, position: [0, 0],
      credentials: structuredClone(pgSource.credentials), parameters: { operation: 'executeQuery', query, options: { queryReplacement } } };
  }
  const parent = structuredClone(source);
  parent.active = false;
  parent.nodes.push(pg('Adquirir exclusividad de reproceso',
    `SELECT $1::bigint AS correo_id, $2::text AS recovery_execution_id
     WHERE current_database()='daubert_global' AND core.fn_iniciar_recuperacion_pago($1::bigint,$2::text)`,
    `={{ [ String($json.correo_id), String($execution.id) ] }}`));
  parent.nodes.push({ id: 'payment-recovery-call', name: 'Procesar reproceso y esperar',
    type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [0, 0], alwaysOutputData: true,
    parameters: { workflowId: { __rl: true, value: CHILD_ID, mode: 'id' },
      workflowInputs: { mappingMode: 'passthrough' }, options: { waitForSubWorkflow: true } } });
  parent.nodes.push(pg('Confirmar fin de reproceso',
    'SELECT core.fn_finalizar_recuperacion_pago($1::bigint,$2::text) AS rehabilitados',
    `={{ [ $('Adquirir exclusividad de reproceso').first().json.correo_id, $('Adquirir exclusividad de reproceso').first().json.recovery_execution_id ] }}`));
  for (const name of reroutes) {
    assert.deepEqual(source.connections[name], edge('Preparar correo para reproceso'), `Unexpected entry ${name}`);
    parent.connections[name] = edge('Adquirir exclusividad de reproceso');
  }
  parent.connections['Adquirir exclusividad de reproceso'] = edge('Procesar reproceso y esperar');
  parent.connections['Procesar reproceso y esperar'] = edge('Confirmar fin de reproceso');

  const child = structuredClone(source);
  child.id = CHILD_ID; child.name = 'Notificaciones de pago PROD - cuerpo de reproceso con recuperación'; child.active = false;
  child.staticData = null; child.settings.callerPolicy = 'workflowsFromSameOwner';
  child.nodes = child.nodes.filter(n => !removedFromChild.includes(n.name));
  const names = new Set(child.nodes.map(n => n.name));
  for (const [name, connection] of Object.entries(child.connections)) {
    if (!names.has(name)) { delete child.connections[name]; continue; }
    for (const output of connection.main ?? []) for (let i = output.length - 1; i >= 0; i--) if (!names.has(output[i].node)) output.splice(i, 1);
  }
  child.nodes.push({ id: 'payment-recovery-input', name: 'Entrada recuperacion', type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1, position: [0, 0], parameters: { inputSource: 'passthrough' } });
  child.connections['Entrada recuperacion'] = edge('Preparar correo para reproceso');
  child.nodes.push(pg('Registrar evidencia sin efectos', 'SELECT core.fn_observar_archivos_pago_sin_efectos($1::bigint,$2::text,$3::jsonb) AS observado', evidence));
  child.nodes.push({ id: 'payment-recovery-resume', name: 'Conservar archivos tras evidencia', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [0, 0], parameters: { jsCode: 'return $("Aplicar toma de archivo").all();' } });
  child.connections['Aplicar toma de archivo'] = edge('Registrar evidencia sin efectos');
  child.connections['Registrar evidencia sin efectos'] = edge('Conservar archivos tras evidencia');
  child.connections['Conservar archivos tras evidencia'] = edge('Verificar duplicados');

  // These invariants compare the actual export, including literal Outlook filters, paths and credentials.
  for (const node of source.nodes) {
    assert.deepEqual(parent.nodes.find(n => n.name === node.name), node);
    if (!removedFromChild.includes(node.name)) assert.deepEqual(child.nodes.find(n => n.name === node.name), node);
  }
  for (const [name, connection] of Object.entries(source.connections)) if (!reroutes.includes(name)) assert.deepEqual(parent.connections[name], connection);
  assert.deepEqual(parent.settings, source.settings); assert.deepEqual(parent.staticData, source.staticData);
  assert(!child.nodes.some(n => /manualTrigger|scheduleTrigger|webhook$/.test(n.type)));
  return { parent, child };
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2); assert(input && output, 'Usage: input-production-export.json existing-private-output-directory');
  const relative = path.relative(path.resolve(__dirname, '../..'), path.resolve(output));
  assert(relative.startsWith('..') || path.isAbsolute(relative), 'Do not write production exports into the repository');
  assert(fs.statSync(output).isDirectory());
  const source = fs.readFileSync(input); const workflows = build(source);
  const manifest = { sourceSha256: sha(source), parentId: 'pagosProdAsignaciones01', childId: CHILD_ID,
    sourceNodes: 108, parentNodes: workflows.parent.nodes.length, childNodes: workflows.child.nodes.length,
    originalParentNodesUnchanged: 108, reroutedEdges: reroutes, removedFromChild,
    parentSettingsAndStaticDataUnchanged: true, artifactsInactive: true, artifacts: {} };
  for (const [name, workflow] of Object.entries(workflows)) {
    const data = JSON.stringify(workflow, null, 2) + '\n'; const filename = `payment-recovery-prod-${name}.json`;
    fs.writeFileSync(path.join(output, filename), data); manifest.artifacts[name] = { filename, sha256: sha(data) };
  }
  fs.writeFileSync(path.join(output, 'payment-recovery-prod.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
}
module.exports = { build, SOURCE_SHA256, CHILD_ID };
