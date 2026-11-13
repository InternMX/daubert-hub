#!/usr/bin/env node
// Valida el contrato de datos de TERMOENCOGIBLE antes de componer o imprimir. La plantilla HTML no contiene esta lógica.
//   node validate-termoencogible-data.mjs <datos.json>     → código de salida 0 = válido, 1 = errores (se listan en stderr)
// Reglas: indicadores Doblada/Extendida coherentes con la modalidad; solo se generan modalidades con variante gráfica confirmada
// (hoy, DOBLADA); y las cotas técnicas de los dibujos son datos independientes obligatorios (no se calculan a partir de ancho ni largo).
// Los campos opcionales (cliente, fecha, color, código, descripción, peso, etiqueta) pueden venir vacíos: no se inventan valores.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { validarModalidad } from './validate-modalidad.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const PERFIL = JSON.parse(readFileSync(resolve(AQUI, '..', 'profiles', 'termoencogible.profile.json'), 'utf8'));
export const COTAS_REQUERIDAS = ['ancho_doblado', 'medida_pliegue', 'largo_presentacion_final', 'ancho_presentacion_final'];

export function validarDatosTermoencogible(contrato, perfil = PERFIL) {
  const { errores, config } = validarModalidad(contrato, perfil);
  const datos = contrato.datos ?? {};
  for (const k of COTAS_REQUERIDAS) {
    if (typeof datos[k] !== 'string' || !datos[k].trim()) errores.push(`falta ${k} (cota técnica independiente, con su unidad)`);
  }
  if (config && config.soportada === false) {
    errores.push(`la modalidad ${contrato.modalidad} de TERMOENCOGIBLE no tiene variante gráfica confirmada por Manufactura: ${config.motivo}`);
  }
  return errores;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ruta = process.argv[2];
  if (!ruta) { console.error('Uso: node validate-termoencogible-data.mjs <datos.json>'); process.exit(2); }
  const contrato = JSON.parse(readFileSync(ruta, 'utf8'));
  const errores = validarDatosTermoencogible(contrato);
  if (errores.length) { console.error(errores.map((e) => `- ${e}`).join('\n')); process.exit(1); }
  console.log(`modalidad válida: ${contrato.modalidad}`);
}
