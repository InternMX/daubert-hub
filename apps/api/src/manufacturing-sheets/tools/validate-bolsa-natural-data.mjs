#!/usr/bin/env node
// Valida el contrato de datos de BOLSA_NATURAL antes de componer o imprimir. La plantilla HTML no contiene esta lógica.
//   node validate-bolsa-natural-data.mjs <datos.json>     → código de salida 0 = válido, 1 = errores (se listan en stderr)
// Reglas:
//   - La Composición es una restricción del formato (perfil, "restricciones.composicion"): PMG = NA, ESD = NA y Natural = X. Los datos externos
//     no pueden contradecirla ni omitirla en silencio, y comp_cp5000 no pertenece al contrato de esta familia.
//   - La Presentación (Rollo / Paquete) debe tener exactamente una opción en X y la otra en NA.
//   - Los campos opcionales (cliente, fecha, Resina VCI, color, código, descripción, cantidad, etiqueta) pueden venir vacíos: no se inventan valores.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const PERFIL = JSON.parse(readFileSync(resolve(AQUI, '..', 'profiles', 'bolsa-natural.profile.json'), 'utf8'));

const texto = (v) => (typeof v === 'string' ? v.trim() : v);

export function validarDatosBolsaNatural(contrato, perfil = PERFIL) {
  const errores = [];
  if (contrato.formato !== perfil.formato) errores.push(`el formato debe ser ${perfil.formato} (se recibió ${JSON.stringify(contrato.formato)})`);
  const datos = contrato.datos ?? {};
  const { composicion } = perfil.restricciones;
  for (const [campo, esperado] of Object.entries(composicion.valores)) {
    if (!(campo in datos)) errores.push(`falta ${campo}: la composición de BOLSA_NATURAL es fija (${campo} = ${esperado})`);
    else if (texto(datos[campo]) !== esperado) errores.push(`${campo} = ${JSON.stringify(datos[campo])} contradice la composición del formato (${campo} = ${esperado})`);
  }
  for (const campo of composicion.excluidos) {
    if (campo in datos) errores.push(`${campo} no pertenece a BOLSA_NATURAL (la composición es solo PMG / ESD / Natural)`);
  }
  const rollo = texto(datos.pres_rollo), paquete = texto(datos.pres_paquete);
  for (const [campo, v] of [['pres_rollo', rollo], ['pres_paquete', paquete]]) {
    if (v !== 'X' && v !== 'NA') errores.push(`${campo} debe ser X o NA (se recibió ${JSON.stringify(datos[campo])})`);
  }
  if (rollo === 'X' && paquete === 'X') errores.push('Rollo y Paquete están ambos en X: la presentación debe tener exactamente una opción seleccionada');
  if (rollo === 'NA' && paquete === 'NA') errores.push('Rollo y Paquete están ambos en NA: la presentación debe tener exactamente una opción seleccionada');
  return errores;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ruta = process.argv[2];
  if (!ruta) { console.error('Uso: node validate-bolsa-natural-data.mjs <datos.json>'); process.exit(2); }
  const contrato = JSON.parse(readFileSync(ruta, 'utf8'));
  const errores = validarDatosBolsaNatural(contrato);
  if (errores.length) { console.error(errores.map((e) => `- ${e}`).join('\n')); process.exit(1); }
  console.log('contrato válido: composición PMG = NA, ESD = NA, Natural = X');
}
