#!/usr/bin/env node
// Valida el contrato de datos de ROLLO_CONTINUO antes de componer o imprimir. La plantilla HTML no contiene esta lógica.
//   node validate-rollo-continuo-data.mjs <datos.json>     → código de salida 0 = válido, 1 = errores (se listan en stderr)
// Reglas: indicadores Doblada/Extendida coherentes con la modalidad; ancho_rollo (dato independiente de ancho) presente; y solo se
// generan modalidades con variante gráfica confirmada (hoy, DOBLADA). EXTENDIDA se rechaza para no producir un documento engañoso.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { validarModalidad } from './validate-modalidad.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const PERFIL = JSON.parse(readFileSync(resolve(AQUI, '..', 'profiles', 'rollo-continuo.profile.json'), 'utf8'));

export function validarDatosRolloContinuo(contrato, perfil = PERFIL) {
  const { errores, config } = validarModalidad(contrato, perfil);
  const datos = contrato.datos ?? {};
  if (typeof datos.ancho_rollo !== 'string' || !datos.ancho_rollo.trim()) errores.push('falta ancho_rollo (dato independiente de ancho, con su unidad)');
  if (config && config.soportada === false) {
    errores.push(`la modalidad ${contrato.modalidad} de ROLLO_CONTINUO no tiene variante gráfica confirmada por Manufactura: ${config.motivo}`);
  }
  return errores;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ruta = process.argv[2];
  if (!ruta) { console.error('Uso: node validate-rollo-continuo-data.mjs <datos.json>'); process.exit(2); }
  const contrato = JSON.parse(readFileSync(ruta, 'utf8'));
  const errores = validarDatosRolloContinuo(contrato);
  if (errores.length) { console.error(errores.map((e) => `- ${e}`).join('\n')); process.exit(1); }
  console.log(`modalidad válida: ${contrato.modalidad}`);
}
