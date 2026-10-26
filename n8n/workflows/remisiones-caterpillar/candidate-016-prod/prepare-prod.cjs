#!/usr/bin/env node
'use strict';

// Offline generator of the PRODUCTION Caterpillar workflow candidate (016). Imports, activates and executes NOTHING.
//   node prepare-prod.cjs                                   -> candidate from the committed LIVE production export (prod/workflow.live-20261023.json)
//   node prepare-prod.cjs --prod-export <live-prod.json> --require-live
//                                                           -> candidate from a newer live export (--require-live refuses any <WINDOWS_USER> placeholder)
//   node prepare-prod.cjs compare-prod <live-prod.json>     -> differences between a live PROD export and the committed reference (parameters, edges, credentials, flags)
//   node prepare-prod.cjs compare-full <live-full.json>     -> same for the FULL that really runs in n8n TEST against the repository FULL
//
// Principle: TEST is the source of truth for LOGIC, PROD for ENVIRONMENT. The candidate starts from the PROD export (paths, route table, enabled
// processes, triggers, webhook, Header Auth) and replaces ONLY the nodes whose behaviour changed in the validated TEST workflow (FULL), mapping SQL
// names to the PROD functions. Every other node is byte-identical to PROD. The TEST sandbox (confined paths, per-execution temp dir, removed HTML
// sweep), the TEST-only filter and every TEST path/credential are never carried over.

const fs = require('node:fs');
const regenerationEntry = require('../candidate-015/regeneration-entry.cjs');
const path = require('node:path');

const FULL_FILE = path.join(__dirname, '..', 'candidate-015', 'caterpillar-test-015.FULL.INACTIVE.json');
const PROD_FILE = path.join(__dirname, '..', 'prod', 'workflow.live-20261023.json');
const OUTPUT_FILE = path.join(__dirname, 'caterpillar-prod-016.CANDIDATE.INACTIVE.json');
const PLACEHOLDER = '<WINDOWS_USER>';

// Dedicated credential (role n8n_cat_prod, created by the 016 role template). It is referenced BY NAME only: no id, no secret.
const WORKER_CREDENTIAL = { postgres: { name: 'Postgres produccion CAT (n8n_cat_prod)' } };

// Nodes whose behaviour changed in the validated TEST workflow and that contain no environment constant: taken from FULL.
const LOGIC_FROM_FULL = ['Normalizar datos CAT', 'Preparar reserva folios PG', 'Reservar folios PG', 'Asignar folios PG CAT', 'Registrar remisión PG',
  'Finalizar ejecución PG', 'Preparar error CAT', 'Registrar fallo PG', 'Responder reproceso aceptado', 'Mapear resultado creación reproceso CAT'];
const NEW_FROM_FULL = ['Preparar snapshot admisión CAT', 'Guardar snapshot admisión CAT', '¿Histórico ya emitido?', 'Omitir histórico CAT', 'Verificar snapshot CAT', 'Propagar admisión CAT', '¿Ejecución propia confirmada?'];
const GATE_NODE = '¿Puede emitir CAT?';            // replaces PROD "¿Procesar según PG?" (same position, same two outputs)
const PROD_GATE_NODE = '¿Procesar según PG?';
const DROPPED_PROD_NODES = ['Crear o recuperar ejecución PG', 'Propagar ejecución PG', 'Responder reproceso estado inesperado'];
const TEST_ONLY_NODES = ['Filtrar solo pruebas locales1'];
const WEBHOOK_TEST = 'Webhook Reproceso CAT (TEST)';
const WEBHOOK_PROD = 'Webhook Reproceso CAT (PROD)';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const byName = workflow => new Map(workflow.nodes.map(node => [node.name, node]));
const clone = value => structuredClone(value);

// Wording/identifier mapping of FULL-derived text to the PROD contract. Behaviour is untouched.
function toProdText(value) {
  return JSON.parse(JSON.stringify(value)
    .split('_caterpillar_test').join('_caterpillar')
    .split('CAT_TEST_').join('CAT_')
    .split('Caterpillar TEST 015').join('Caterpillar 016'));
}

function derivedNode(fullNode, prodNode) {
  const node = toProdText(fullNode);
  delete node.notes; delete node.credentials; delete node.webhookId;
  if (prodNode) { node.id = prodNode.id; node.position = clone(prodNode.position); if (prodNode.notes) node.notes = prodNode.notes; }
  return node;
}

function rewriteConnections(fullConnections) {
  const connections = clone(fullConnections);
  const filter = TEST_ONLY_NODES[0];
  const bypass = connections[filter]?.main?.[0] ?? [];
  delete connections[filter];
  for (const entry of Object.values(connections)) {
    entry.main = entry.main.map(outputs => outputs.flatMap(target => (target.node === filter ? bypass : [target])));
  }
  connections[WEBHOOK_PROD] = connections[WEBHOOK_TEST];
  delete connections[WEBHOOK_TEST];
  return connections;
}

function build(prod, full) {
  const prodNodes = byName(prod), fullNodes = byName(full);
  for (const name of [...LOGIC_FROM_FULL, ...NEW_FROM_FULL, GATE_NODE]) if (!fullNodes.has(name)) throw new Error(`FULL topology changed: missing ${name}`);
  for (const name of [...LOGIC_FROM_FULL, PROD_GATE_NODE, ...DROPPED_PROD_NODES, WEBHOOK_PROD]) if (!prodNodes.has(name)) throw new Error(`PROD topology changed: missing ${name}`);

  const nodes = [];
  for (const prodNode of prod.nodes) {
    if (DROPPED_PROD_NODES.includes(prodNode.name)) continue;
    if (prodNode.name === PROD_GATE_NODE) { nodes.push(derivedNode(fullNodes.get(GATE_NODE), prodNode)); continue; }
    if (LOGIC_FROM_FULL.includes(prodNode.name)) { nodes.push(derivedNode(fullNodes.get(prodNode.name), prodNode)); continue; }
    // The two reprocess-entry nodes keep PROD's own code (routes, process gating) plus the shared commercial-regeneration edit.
    nodes.push(regenerationEntry.patchNode(clone(prodNode)));
  }
  for (const name of NEW_FROM_FULL) nodes.push(derivedNode(fullNodes.get(name), null));

  for (const node of nodes) {
    // A node-level webhook id belongs to the live workflow's registration; n8n assigns a new one on import, so the candidate can never collide with it.
    delete node.webhookId;
    if (node.type.endsWith('.postgres')) node.credentials = clone(WORKER_CREDENTIAL);
    // Nothing automatic is enabled in the candidate: enabling Schedule/Webhook is an explicit, ordered step of the cutover.
    if (/\.(scheduleTrigger|webhook)$/.test(node.type)) { node.disabled = true; node.notes = 'Caterpillar 016: mantener deshabilitado hasta el paso correspondiente del corte.'; }
    if (node.type.endsWith('.stickyNote')) node.parameters.content = '## Caterpillar 016 — CANDIDATO PRODUCTIVO (INACTIVO)\nLogica validada en pruebas + entorno de produccion. Importar como workflow NUEVO; no activar hasta el paso del corte.';
  }
  const candidate = {
    ...Object.fromEntries(Object.entries(prod).filter(([key]) => !['id', 'versionId', 'activeVersionId', 'versionMetadata', 'meta', 'shared', 'staticData', 'pinData', 'tags'].includes(key))),
    name: 'Remisiones CAT Produccion PG 016 (CANDIDATE, INACTIVE)', active: false, pinData: {}, tags: [], nodes, connections: rewriteConnections(full.connections)
  };
  return candidate;
}

function placeholders(workflow) { return JSON.stringify(workflow).split(PLACEHOLDER.replace(/[<>]/g, m => m)).length - 1; }

const edgeSet = workflow => new Set(Object.entries(workflow.connections).flatMap(([from, entry]) => entry.main.flatMap((outputs, index) => outputs.map(target => `${from} [${index}] -> ${target.node}`))));
// Cosmetic = the same code/SQL once whitespace, line comments, the leading "=" expression marker and empty option objects are ignored (what the n8n editor rewrites on save).
const normalizeParameters = value => {
  if (typeof value === 'string') return value.replace(/^=/, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
  if (Array.isArray(value)) return value.map(normalizeParameters);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key, item]) => !(key === 'options' && item && typeof item === 'object' && Object.keys(item).length === 0))
      .map(([key, item]) => [key, normalizeParameters(item)]));
  }
  return value;
};
const credentialNames = node => JSON.stringify(Object.fromEntries(Object.entries(node.credentials ?? {}).map(([type, ref]) => [type, ref.name])));

// Parameters decide behaviour; edges decide the flow; credential NAMES and enable/disable flags are environment. Ids and positions are deliberately ignored.
function compareWorkflows(reference, exported) {
  const l = byName(reference), r = byName(exported), parameters = [], flags = [], credentials = [];
  for (const [name, node] of l) {
    if (!r.has(name)) { parameters.push({ node: name, kind: 'only in reference' }); continue; }
    const other = r.get(name);
    if (JSON.stringify(node.parameters) !== JSON.stringify(other.parameters)) {
      const cosmetic = JSON.stringify(normalizeParameters(node.parameters)) === JSON.stringify(normalizeParameters(other.parameters));
      parameters.push({ node: name, kind: cosmetic ? 'cosmetic only (same code after normalization)' : 'parameters differ' });
    }
    if (credentialNames(node) !== credentialNames(other)) credentials.push({ node: name, reference: credentialNames(node), exported: credentialNames(other) });
    for (const key of ['disabled', 'onError', 'type', 'typeVersion']) if (JSON.stringify(node[key]) !== JSON.stringify(other[key])) flags.push({ node: name, field: key, reference: node[key] ?? null, exported: other[key] ?? null });
  }
  for (const name of r.keys()) if (!l.has(name)) parameters.push({ node: name, kind: 'only in exported' });
  const left = edgeSet(reference), right = edgeSet(exported);
  return { parameters, connections: { onlyReference: [...left].filter(e => !right.has(e)), onlyExported: [...right].filter(e => !left.has(e)) }, credentials, flags };
}

function main() {
  const args = process.argv.slice(2);
  const option = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  if (args[0] === 'compare-prod') {
    console.log(JSON.stringify({ comparedAgainst: 'committed live PROD reference', differences: compareWorkflows(readJson(PROD_FILE), readJson(args[1])) }, null, 2));
    return;
  }
  if (args[0] === 'compare-full') {
    console.log(JSON.stringify({ comparedAgainst: 'repository FULL candidate', differences: compareWorkflows(readJson(FULL_FILE), readJson(args[1])) }, null, 2));
    return;
  }
  const prodFile = option('--prod-export') ?? PROD_FILE;
  const out = option('--out') ?? OUTPUT_FILE;
  const prod = JSON.parse(fs.readFileSync(prodFile, 'utf8'));
  const candidate = build(prod, readJson(FULL_FILE));
  const remaining = placeholders(candidate);
  if (args.includes('--require-live') && remaining > 0) throw new Error('--require-live needs the LIVE production export without <WINDOWS_USER> placeholders');
  fs.writeFileSync(out, JSON.stringify(candidate, null, 2) + '\n');
  console.log(JSON.stringify({ candidate: path.basename(out), nodes: candidate.nodes.length, windowsUserPlaceholders: remaining, source: path.basename(prodFile) }));
}

module.exports = { build, rewriteConnections, compareWorkflows, FULL_FILE, PROD_FILE, OUTPUT_FILE, LOGIC_FROM_FULL, NEW_FROM_FULL, GATE_NODE, PROD_GATE_NODE, DROPPED_PROD_NODES, WORKER_CREDENTIAL };
if (require.main === module) main();
