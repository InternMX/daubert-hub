'use strict';

// Two minimal, shared edits that let the existing reprocess webhook branch carry a COMMERCIAL REGENERATION request (kind = "REGENERATION"). They are applied
// by the TEST generator (prepare-candidate.cjs) and, unchanged, to the PRODUCTION nodes of the same name (prepare-prod.cjs), so both environments behave alike.
//   1. "Normalizar y validar entrada reproceso CAT": reads the optional "kind" field. Anything other than empty or REGENERATION makes the entry invalid.
//   2. "Validar elegibilidad reproceso CAT": a regeneration is eligible ONLY from a COMPLETADA execution; a plain reprocess keeps ERROR/CANCELADA only.
// n8n does NOT decide whether the regeneration is authorized: the SQL gate (ops.fn_reprocesar_reservar_*) accepts a COMPLETADA parent only when an ADMIN
// authorization exists and every remission is formally cancelled. These edits only stop n8n from rejecting a COMPLETADA execution before it asks the gate.

function replaceOnce(code, search, replacement) {
  if (code.split(search).length !== 2) throw new Error(`Unexpected reprocess node shape; review required: ${search.slice(0, 60)}`);
  return code.replace(search, () => replacement);
}

const ENTRY_NODE = 'Normalizar y validar entrada reproceso CAT';
const ELIGIBILITY_NODE = 'Validar elegibilidad reproceso CAT';

function patchEntryCode(code) {
  let out = replaceOnce(code, 'const reasonRaw = cleanText(body.reason);',
    'const reasonRaw = cleanText(body.reason);\nconst kindRaw = cleanText(body.kind);\nconst regeneracion = kindRaw === "REGENERATION";\nconst kindValido = kindRaw === "" || regeneracion;');
  out = replaceOnce(out, '      reproceso_reason: reasonRaw,', '      reproceso_reason: reasonRaw,\n      regeneracion,');
  out = replaceOnce(out, 'entrada_valida: executionIdValido && reasonValida,', 'entrada_valida: executionIdValido && reasonValida && kindValido,');
  return out;
}

function patchEligibilityCode(code) {
  return replaceOnce(code, 'const estadoElegible = ["ERROR", "CANCELADA"].includes(estado);',
    '// Regeneracion comercial: solo desde COMPLETADA (la autorizacion la exige el gate SQL). El reproceso tecnico sigue siendo ERROR/CANCELADA.\n' +
    'const estadoElegible = entrada.regeneracion === true ? estado === "COMPLETADA" : ["ERROR", "CANCELADA"].includes(estado);');
}

function patchNode(node) {
  if (node.name === ENTRY_NODE) node.parameters.jsCode = patchEntryCode(node.parameters.jsCode);
  else if (node.name === ELIGIBILITY_NODE) node.parameters.jsCode = patchEligibilityCode(node.parameters.jsCode);
  return node;
}

module.exports = { ENTRY_NODE, ELIGIBILITY_NODE, patchEntryCode, patchEligibilityCode, patchNode };
