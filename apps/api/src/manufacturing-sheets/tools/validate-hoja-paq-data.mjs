#!/usr/bin/env node
// Valida el contrato de datos de HOJA_PAQ antes de componer o imprimir. La plantilla HTML no contiene esta lógica: el backend (o la
// prueba) llama a validarDatosHojaPaq y, solo si no hay errores, compone.
//   node validate-hoja-paq-data.mjs <datos.json>     → código de salida 0 = válido, 1 = errores (se listan en stderr)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { validarModalidad } from './validate-modalidad.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const PERFIL = JSON.parse(readFileSync(resolve(AQUI, '..', 'profiles', 'hoja-paq.profile.json'), 'utf8'));

export function validarDatosHojaPaq(contrato, perfil = PERFIL) {
  return validarModalidad(contrato, perfil).errores;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ruta = process.argv[2];
  if (!ruta) { console.error('Uso: node validate-hoja-paq-data.mjs <datos.json>'); process.exit(2); }
  const errores = validarDatosHojaPaq(JSON.parse(readFileSync(ruta, 'utf8')));
  if (errores.length) { console.error(errores.map((e) => `- ${e}`).join('\n')); process.exit(1); }
  console.log(`modalidad válida: ${JSON.parse(readFileSync(ruta, 'utf8')).modalidad}`);
}
