#!/usr/bin/env node
// Valida el contrato de datos de HOJA_PAQ antes de componer o imprimir. La plantilla HTML no contiene esta lógica: el backend (o la
// prueba) llama a validarDatosHojaPaq y, solo si no hay errores, compone.
//   node validate-hoja-paq-data.mjs <datos.json>     → código de salida 0 = válido, 1 = errores (se listan en stderr)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const PERFIL = JSON.parse(readFileSync(resolve(AQUI, '..', 'profiles', 'hoja-paq.profile.json'), 'utf8'));

export function validarDatosHojaPaq(contrato, perfil = PERFIL) {
  const errores = [];
  const datos = contrato.datos ?? {};
  const modalidad = contrato.modalidad;
  const config = perfil.modalidades[modalidad];
  if (!config) errores.push(`modalidad inválida: ${JSON.stringify(modalidad)} (se esperaba ${Object.keys(perfil.modalidades).join(' o ')})`);
  for (const k of ['hoja_doblada', 'hoja_extendida']) {
    if (!['X', 'NA'].includes(datos[k])) errores.push(`${k} debe ser "X" o "NA": ${JSON.stringify(datos[k])}`);
  }
  if (datos.hoja_doblada === 'X' && datos.hoja_extendida === 'X') errores.push('Doblada y Extendida están ambas en X');
  if (datos.hoja_doblada === 'NA' && datos.hoja_extendida === 'NA') errores.push('Doblada y Extendida están ambas en NA');
  if (config && (datos[config.indicador_x] !== 'X' || datos[config.indicador_na] !== 'NA')) {
    errores.push(`los indicadores X/NA contradicen la modalidad ${modalidad}`);
  }
  return errores;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ruta = process.argv[2];
  if (!ruta) { console.error('Uso: node validate-hoja-paq-data.mjs <datos.json>'); process.exit(2); }
  const errores = validarDatosHojaPaq(JSON.parse(readFileSync(ruta, 'utf8')));
  if (errores.length) { console.error(errores.map((e) => `- ${e}`).join('\n')); process.exit(1); }
  console.log(`modalidad válida: ${JSON.parse(readFileSync(ruta, 'utf8')).modalidad}`);
}
