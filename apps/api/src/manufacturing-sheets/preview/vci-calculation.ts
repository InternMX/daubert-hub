// Libras de resina VCI por capa COEX: libras_vci_capa = peso_capa_lb × (porcentaje_vci / 100).
// Aritmética decimal exacta sobre enteros (sin coma flotante binaria) con redondeo half-up: el peso se redondea PRIMERO a los decimales mostrados (cinco)
// y a partir de ese valor se calcula el VCI (seis decimales). Función pura; los datos ausentes o no válidos nunca producen un resultado.

const DECIMAL = /^\d+(?:[.,]\d+)?$/;

/** Cuenta de unidades de 10^-escala del texto decimal, redondeada half-up; null si no es un decimal no negativo o excede la precisión segura. */
export function escalarDecimal(texto: string, escala: number): number | null {
  const t = texto.trim();
  if (!DECIMAL.test(t)) return null;
  const [entero = '0', fraccion = ''] = t.replace(',', '.').split('.');
  const digitos = `${entero}${fraccion.slice(0, escala).padEnd(escala, '0')}`;
  const unidades = Number(digitos) + (Number(fraccion[escala] ?? '0') >= 5 ? 1 : 0);
  return Number.isSafeInteger(unidades) ? unidades : null;
}

const formatear = (unidades: number, escala: number): string => {
  const s = String(unidades).padStart(escala + 1, '0');
  return `${s.slice(0, s.length - escala)}.${s.slice(s.length - escala)}`;
};

/**
 * Libras de VCI de una capa (texto con `decimalesVci` decimales) o null si el peso es ausente, no numérico o no positivo.
 * El peso se toma redondeado a `decimalesPeso`; el porcentaje se admite hasta dos decimales.
 */
export function calcularLibrasVci(pesoCapa: string, porcentajeVci: number, decimalesPeso = 5, decimalesVci = 6): string | null {
  const peso = escalarDecimal(pesoCapa, decimalesPeso);
  if (peso === null || peso <= 0 || !Number.isFinite(porcentajeVci) || porcentajeVci < 0) return null;
  const centesimas = Math.round(porcentajeVci * 100);                       // porcentaje en 10^-2
  // peso (10^-dp) × centésimas (10^-2) / 100 = lb en 10^-(dp+4); se lleva a 10^-dv con redondeo half-up.
  const bruto = peso * centesimas;
  const paso = decimalesPeso + 4 - decimalesVci;
  if (paso < 0) return null;
  const divisor = 10 ** paso;
  const unidades = Math.floor((bruto + divisor / 2) / divisor);
  return Number.isSafeInteger(bruto) ? formatear(unidades, decimalesVci) : null;
}

/** ¿Dos textos decimales representan la misma cantidad a `escala` decimales? */
export const mismaCantidad = (a: string, b: string, escala: number): boolean => {
  const x = escalarDecimal(a, escala);
  return x !== null && x === escalarDecimal(b, escala);
};
