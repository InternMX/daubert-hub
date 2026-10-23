// Offline delta for the isolated, stubbed TEST workflow. Never imports or calls n8n itself.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const credential = { postgres: { id: 'pgTestAisladoCred01', name: 'Postgres pruebas (n8n_app_test)' } };
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

function pg(name, query, replacement) {
  return { id: name, name, type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [0, 0],
    credentials: credential, parameters: { operation: 'executeQuery', query, options: { queryReplacement: replacement } } };
}
const edge = (node) => ({ main: [[{ node, type: 'main', index: 0 }]] });

function build(source, correoId) {
  assert.match(source.id, /^pnHarnessReproc/);
  assert.match(String(correoId), /^[1-9]\d*$/);
  assert(!source.nodes.some(n => /httpRequest|microsoftOutlook/.test(n.type)), 'Only stubbed TEST input is accepted');
  assert(source.nodes.every(n => !n.credentials || JSON.stringify(n.credentials) === JSON.stringify(credential)), 'Only the isolated TEST credential is accepted');
  const body = structuredClone(source);
  body.id = 'pnRecoveryBodyTest01'; body.name = 'TEST only - payment recovery processing'; body.active = false;
  delete body.versionId; delete body.activeVersionId;
  body.nodes = body.nodes.filter(n => !/manualTrigger|scheduleTrigger|webhook$/.test(n.type) && n.name !== 'Seleccionar correo a reprocesar');
  const names = new Set(body.nodes.map(n => n.name));
  for (const [name, connection] of Object.entries(body.connections)) {
    if (!names.has(name)) { delete body.connections[name]; continue; }
    for (const output of connection.main ?? []) for (let i = output.length - 1; i >= 0; i--) if (!names.has(output[i].node)) output.splice(i, 1);
  }
  body.settings = { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner' };
  body.nodes.push({ id: 'recovery-input', name: 'Entrada recuperacion', type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1, position: [0, 0], parameters: { inputSource: 'passthrough' } });
  body.connections['Entrada recuperacion'] = edge('Preparar correo para reproceso');
  body.nodes.push(pg('Registrar evidencia sin efectos',
    'SELECT core.fn_observar_archivos_pago_sin_efectos($1::bigint, $2::text, $3::jsonb) AS observado', evidence));
  body.nodes.push({ id: 'recovery-resume', name: 'Conservar archivos tras evidencia', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [0, 0], parameters: { jsCode: 'return $("Aplicar toma de archivo").all();' } });
  body.connections['Aplicar toma de archivo'] = edge('Registrar evidencia sin efectos');
  body.connections['Registrar evidencia sin efectos'] = edge('Conservar archivos tras evidencia');
  body.connections['Conservar archivos tras evidencia'] = edge('Verificar duplicados');

  const wrapper = { id: 'pnRecoveryParentTest01', name: 'TEST only - payment recovery owner', active: false,
    settings: { executionOrder: 'v1' }, nodes: [
      { id: 'manual', name: 'Inicio TEST', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      pg('Adquirir correo TEST', `SELECT $1::bigint AS correo_id, $2::text AS recovery_execution_id
        WHERE current_database() = 'daubert_hub_test'
          AND EXISTS (SELECT 1 FROM core.correos_notificacion_pago WHERE correo_id=$1::bigint AND outlook_message_id LIKE 'HUB_TEST_RECOVERY_%')
          AND core.fn_iniciar_recuperacion_pago($1::bigint, $2::text)`, `={{ [ '${correoId}', String($execution.id) ] }}`),
      { id: 'processing', name: 'Procesar y esperar', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [0, 0],
        alwaysOutputData: true, parameters: { workflowId: { __rl: true, value: body.id, mode: 'id' },
          workflowInputs: { mappingMode: 'passthrough' }, options: { waitForSubWorkflow: true } } },
      pg('Confirmar fin y rehabilitar', 'SELECT core.fn_finalizar_recuperacion_pago($1::bigint, $2::text) AS rehabilitados',
        `={{ [ $('Adquirir correo TEST').first().json.correo_id, $('Adquirir correo TEST').first().json.recovery_execution_id ] }}`)
    ], connections: { 'Inicio TEST': edge('Adquirir correo TEST'), 'Adquirir correo TEST': edge('Procesar y esperar'),
      'Procesar y esperar': edge('Confirmar fin y rehabilitar') } };
  return { body, wrapper };
}

if (require.main === module) {
  const [input, output, correoId] = process.argv.slice(2);
  assert(input && output && correoId, 'Usage: node build-payment-recovery-test.cjs input-test.json existing-output-directory synthetic-correo-id');
  assert(fs.statSync(output).isDirectory());
  for (const [name, workflow] of Object.entries(build(JSON.parse(fs.readFileSync(input, 'utf8')), correoId))) {
    fs.writeFileSync(path.join(output, `payment-recovery-${name}.json`), JSON.stringify(workflow, null, 2));
  }
}
module.exports = { build };
