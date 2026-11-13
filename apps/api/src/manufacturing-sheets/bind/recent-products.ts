import { interpretarProductoBind, sugerirEspecificacion } from '../bind-product-interpreter';
import type { FamiliaPosible } from '../bind-product-interpreter';
import type { BindProductRaw } from './bind-erp.client';

// Novedades del catálogo de BIND: clasificación CONSERVADORA de un producto reciente con los intérpretes existentes de Title y Code (no se duplica ninguna regla ni se inventa
// compatibilidad). No dice nada sobre si el producto ya tiene o necesita una hoja: no existe persistencia que lo permita saber.

/**
 * COMPATIBLE: hay una familia sugerida y Title/Code no se contradicen (la familia igualmente la confirma el usuario).
 * POR_CONFIRMAR: hay una familia sugerida, pero Title y Code (u otra evidencia) se contradicen.
 * SIN_PLANTILLA: producto válido en BIND para el que ninguna plantilla del prototipo sirve (papel, tubo).
 * SIN_FAMILIA: la interpretación no permite identificar una familia.
 */
export type CompatibilidadNovedad = 'COMPATIBLE' | 'POR_CONFIRMAR' | 'SIN_PLANTILLA' | 'SIN_FAMILIA';

export interface NovedadProducto {
  code: string;
  title: string;
  /** Fecha de alta en BIND (yyyy-mm-dd) solo si es una fecha válida y no futura; null en caso contrario. */
  fechaAlta: string | null;
  familiaSugerida: FamiliaPosible | null;
  /** Explicación de la sugerencia de familia (o de por qué no existe). */
  motivo: string;
  compatibilidad: CompatibilidadNovedad;
}

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** `CreationDate` de BIND (ISO sin zona) → yyyy-mm-dd; null si no es una fecha confiable. */
export function fechaDeAlta(valor: string | null, ahora: number = Date.now()): string | null {
  if (valor === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(valor);
  const t = Date.parse(valor);
  if (!m || Number.isNaN(t) || t > ahora + UN_DIA_MS) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function clasificarNovedad(raw: BindProductRaw, ahora: number = Date.now()): NovedadProducto {
  const interpretacion = interpretarProductoBind({ ID: raw.ID, Code: raw.Code, Title: raw.Title, Description: raw.Description, Weight: raw.Weight, CreationDate: raw.CreationDate });
  const { familia } = sugerirEspecificacion(interpretacion);
  const contradiccion = interpretacion.advertencias.some((a) => a.nivel === 'CONTRADICCION');
  const compatibilidad: CompatibilidadNovedad = familia.valor !== null ? (contradiccion ? 'POR_CONFIRMAR' : 'COMPATIBLE') : familia.sinPlantilla === true ? 'SIN_PLANTILLA' : 'SIN_FAMILIA';
  return { code: raw.Code, title: raw.Title, fechaAlta: fechaDeAlta(raw.CreationDate, ahora), familiaSugerida: familia.valor, motivo: familia.motivo, compatibilidad };
}
