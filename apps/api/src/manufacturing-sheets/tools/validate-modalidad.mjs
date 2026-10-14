// Validación común de la selección Doblada / Extendida (HOJA_PAQ y ROLLO_CONTINUO): los indicadores X/NA deben ser coherentes entre sí y
// con la modalidad explícita. No contiene reglas de negocio de cada familia; cada validador de familia añade las suyas.
export function validarModalidad(contrato, perfil) {
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
  return { errores, config };
}
