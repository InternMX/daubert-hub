import { useCallback, useState } from 'react';

// Catálogo LOCAL de colores personalizados de las Hojas de Manufactura (prototipo). Vive únicamente en el `localStorage` de ESTE navegador: no se comparte entre usuarios ni se envía al servidor
// (no existe un catálogo persistente apropiado; un catálogo global en PostgreSQL queda para después). Solo se guardan NOMBRE y HEX: nunca datos de clientes, credenciales ni documentos.
// Todo lo que se lee se valida estrictamente (formato, longitudes, duplicados y límite): un valor alterado en el almacenamiento nunca llega a la interfaz ni a la hoja.

export const CUSTOM_COLORS_KEY = 'daubert-hub.manufacturing.custom-colors.v1';
export const CUSTOM_COLORS_MAX = 20;
export const CUSTOM_COLOR_NAME_MAX = 40;
const HEX = /^#[0-9A-Fa-f]{6}$/;
// Letras (con acentos), dígitos, espacio y puntuación habitual de un nombre de color; sin caracteres de control ni marcado.
const NAME_CHARS = /^[\p{L}\p{N} .,'%()/_+&-]+$/u;

export interface CustomColor {
  /** Identidad estable derivada de nombre + HEX: el mismo color nunca se duplica. */
  id: string;
  nombre: string;
  /** #RRGGBB en mayúsculas. */
  hex: string;
}

export type CustomColorError = 'NOMBRE_VACIO' | 'NOMBRE_LARGO' | 'NOMBRE_INVALIDO' | 'HEX_INVALIDO' | 'LIMITE' | 'ALMACENAMIENTO';

export const CUSTOM_COLOR_ERRORS: Record<CustomColorError, string> = {
  NOMBRE_VACIO: 'Escribe el nombre del color.',
  NOMBRE_LARGO: `El nombre admite hasta ${CUSTOM_COLOR_NAME_MAX} caracteres.`,
  NOMBRE_INVALIDO: 'El nombre solo admite letras, números, espacios y . , \' % ( ) / _ + & -.',
  HEX_INVALIDO: 'El código debe tener el formato #RRGGBB (p. ej. #3778C8).',
  LIMITE: `Hay ${CUSTOM_COLORS_MAX} colores guardados: elimina alguno para agregar otro.`,
  ALMACENAMIENTO: 'Este navegador no permite guardar colores; el color se aplica a la hoja pero no se recordará.'
};

export const normalizarNombre = (nombre: string): string => nombre.replace(/\s+/g, ' ').trim();
export const normalizarHex = (hex: string): string => hex.trim().toUpperCase();

/** Identidad corta y estable (FNV-1a) de «nombre en minúsculas|HEX». */
export function idDeColor(nombre: string, hex: string): string {
  let h = 0x811c9dc5;
  for (const c of `${normalizarNombre(nombre).toLowerCase()}|${normalizarHex(hex)}`) { h ^= c.codePointAt(0) as number; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Valida un color a guardar; devuelve el color normalizado o el primer error. */
export function validarColor(nombre: string, hex: string): { ok: true; color: CustomColor } | { ok: false; error: CustomColorError } {
  const n = normalizarNombre(nombre);
  if (n === '') return { ok: false, error: 'NOMBRE_VACIO' };
  if (n.length > CUSTOM_COLOR_NAME_MAX) return { ok: false, error: 'NOMBRE_LARGO' };
  if (!NAME_CHARS.test(n)) return { ok: false, error: 'NOMBRE_INVALIDO' };
  if (!HEX.test(hex.trim())) return { ok: false, error: 'HEX_INVALIDO' };
  const h = normalizarHex(hex);
  return { ok: true, color: { id: idDeColor(n, h), nombre: n, hex: h } };
}

/** Lectura estricta: solo entradas válidas, sin duplicados y hasta el límite; cualquier otra cosa se descarta. Nunca lanza. */
export function leerCatalogo(storage: Pick<Storage, 'getItem'> | null = almacenamiento()): CustomColor[] {
  try {
    const bruto = storage?.getItem(CUSTOM_COLORS_KEY);
    if (!bruto || bruto.length > 20_000) return [];
    const datos: unknown = JSON.parse(bruto);
    if (typeof datos !== 'object' || datos === null || (datos as { version?: unknown }).version !== 1 || !Array.isArray((datos as { colores?: unknown }).colores)) return [];
    const vistos = new Set<string>();
    const lista: CustomColor[] = [];
    for (const e of (datos as { colores: unknown[] }).colores) {
      if (typeof e !== 'object' || e === null) continue;
      const { nombre, hex } = e as Record<string, unknown>;
      if (typeof nombre !== 'string' || typeof hex !== 'string') continue;
      const v = validarColor(nombre, hex);
      if (!v.ok || vistos.has(v.color.id)) continue;
      vistos.add(v.color.id);
      lista.push(v.color);
      if (lista.length >= CUSTOM_COLORS_MAX) break;
    }
    return lista;
  } catch {
    return [];
  }
}

function almacenamiento(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** Escribe solo {version, colores:[{nombre,hex}]}; devuelve false si el navegador no lo permite. */
function escribirCatalogo(lista: CustomColor[]): boolean {
  try {
    const s = almacenamiento();
    if (!s) return false;
    s.setItem(CUSTOM_COLORS_KEY, JSON.stringify({ version: 1, colores: lista.map((c) => ({ nombre: c.nombre, hex: c.hex })) }));
    return true;
  } catch {
    return false;
  }
}

function combinar(a: CustomColor[], b: CustomColor[]): CustomColor[] {
  const vistos = new Set<string>();
  return [...a, ...b].filter((c) => !vistos.has(c.id) && vistos.add(c.id)).slice(0, CUSTOM_COLORS_MAX);
}

export interface CustomColorsApi {
  colores: CustomColor[];
  /** Agrega (sin duplicar) y devuelve el color guardado o el error. Si el navegador no puede persistirlo, el color igual queda disponible en esta sesión (`persistido` = false). */
  agregar: (nombre: string, hex: string) => { ok: true; color: CustomColor; persistido: boolean } | { ok: false; error: CustomColorError };
  eliminar: (id: string) => void;
}

/** Catálogo local reactivo. Los colores predeterminados de las familias no pasan por aquí: no se pueden modificar ni eliminar. */
export function useCustomColors(): CustomColorsApi {
  const [colores, setColores] = useState<CustomColor[]>(() => leerCatalogo());

  const agregar = useCallback<CustomColorsApi['agregar']>((nombre, hex) => {
    const v = validarColor(nombre, hex);
    if (!v.ok) return v;
    const actual = combinar(leerCatalogo(), colores);                       // se relee (otra pestaña pudo cambiarlo) y se conserva lo de esta sesión si el almacenamiento no está disponible
    const existente = actual.find((c) => c.id === v.color.id);
    if (existente) { setColores(actual); return { ok: true, color: existente, persistido: true }; }     // mismo nombre y HEX: no se duplica
    if (actual.length >= CUSTOM_COLORS_MAX) return { ok: false, error: 'LIMITE' };
    const siguiente = [...actual, v.color];
    const persistido = escribirCatalogo(siguiente);
    setColores(siguiente);
    return { ok: true, color: v.color, persistido };
  }, [colores]);

  const eliminar = useCallback((id: string) => {
    const siguiente = combinar(leerCatalogo(), colores).filter((c) => c.id !== id);
    escribirCatalogo(siguiente);
    setColores(siguiente);
  }, [colores]);

  return { colores, agregar, eliminar };
}
