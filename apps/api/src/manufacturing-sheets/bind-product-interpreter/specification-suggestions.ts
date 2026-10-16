import type { FamiliaPosible, ResultadoInterpretacion } from './bind-product.types';
import { normalizarTitulo } from './title-parser';

// Sugerencias de la fase 3.1 para el formulario de especificación. Función pura (sin red ni base de datos) construida SOBRE el resultado del interpretador:
// no relee BIND ni reinterpreta el título más allá de buscar marcas explícitas. Todo lo que devuelve es una SUGERENCIA editable con su regla de origen;
// nada se confirma aquí (la familia, el color y la resina los confirma el usuario).

export type PresetColor = 'DAUBERT_AZUL' | 'VERDE';

export interface FamiliaIncompatible {
  familia: FamiliaPosible;
  motivo: string;
}

export interface SugerenciaFamilia {
  /** Familia sugerida o null cuando la información es insuficiente o contradictoria. */
  valor: FamiliaPosible | null;
  /** Explicación legible: por qué se sugiere esa familia o por qué se deja pendiente. */
  motivo: string;
  /** Familias que los datos de BIND contradicen (para advertir si el usuario las elige). */
  incompatibles: FamiliaIncompatible[];
}

export interface SugerenciaTexto {
  valor: string | null;
  /** Regla que originó la sugerencia (identificable en la interfaz); null si no hay sugerencia. */
  regla: string | null;
  nota: string;
}

export interface SugerenciaColor {
  preset: PresetColor | null;
  /** Concentración del color en %, independiente de la resina VCI (solo se sugiere para Daubert Azul). */
  concentracionPct: string | null;
  /** Color explícito detectado en el título (p. ej. «AMARILLO»), si lo hay. */
  detectado: string | null;
  regla: string | null;
  nota: string;
}

export interface SugerenciasEspecificacion {
  familia: SugerenciaFamilia;
  /** Resina VCI sugerida para la composición interpretada (monocapa). */
  resinaVci: SugerenciaTexto;
  /** Tabla de la regla, para recalcular cuando el usuario cambie la composición: Natural y las demás no tienen entrada. */
  resinaVciPorComposicion: Record<string, string>;
  color: SugerenciaColor;
  /** Etiqueta precargada: el Title completo de BIND, sin recortar. */
  etiqueta: SugerenciaTexto;
}

export const RESINA_VCI_POR_COMPOSICION: Record<string, string> = { PMG: 'PMG AL 3%', CP5000: 'CP5000 AL 3%' };

const MARCAS_ESPECIALES = /\b(FUELLES?|GUSSET\w*|COEX\w*|TUBOS?|TUBING|TERMOENCOG\w*|CONTINUO)\b/;
const COLOR_AZUL = /\b(AZUL|BLUE)\b/;
const COLOR_VERDE = /\b(VERDE|GREEN)\b/;
const OTROS_COLORES = /\b(AMARILL[OA]|YELLOW|BANANA|ROSA|PINK|ROJ[OA]|RED|NEGR[OA]|BLACK|BLANC[OA]|WHITE|NARANJA|ORANGE|TRANSPARENTE|CLEAR|NATURAL)\b/g;

function sugerirFamilia(r: ResultadoInterpretacion, t: string): SugerenciaFamilia {
  const { tipo, resina, ancho, largo } = r.campos;
  const incompatibles: FamiliaIncompatible[] = [];
  const cadenaTresMedidas = /\d+(?:[.,]\d+)?\s*"?\s*X\s*\d+(?:[.,]\d+)?\s*"?\s*X\s*\d+/.test(t);
  const especial = MARCAS_ESPECIALES.exec(t)?.[1] ?? null;

  if (tipo.valor === 'PAPEL') return { valor: null, motivo: 'Producto de papel: fuera del alcance de las familias disponibles.', incompatibles: [{ familia: 'BOLSA_PLANA_1', motivo: 'Es un producto de papel.' }, { familia: 'HOJA_PAQ', motivo: 'Es un producto de papel, no una hoja plástica.' }] };
  if (tipo.valor === 'BOLSA') incompatibles.push({ familia: 'HOJA_PAQ', motivo: 'BIND describe una bolsa, no una hoja.' });
  if (tipo.valor === 'HOJA') incompatibles.push({ familia: 'BOLSA_PLANA_1', motivo: 'BIND describe una hoja, no una bolsa.' });
  if (tipo.valor === 'BOLSA' && (cadenaTresMedidas || (especial !== null && /FUELLE|GUSSET/.test(especial)))) {
    incompatibles.push({ familia: 'BOLSA_PLANA_1', motivo: 'El título indica fuelle o tres dimensiones: no corresponde a una bolsa plana de dos medidas.' });
  }
  if (especial !== null && !/FUELLE|GUSSET/.test(especial)) {
    const motivo = `El título menciona «${especial}», característica de otra familia de manufactura.`;
    for (const familia of ['BOLSA_PLANA_1', 'HOJA_PAQ'] as const) if (!incompatibles.some((i) => i.familia === familia)) incompatibles.push({ familia, motivo });
  }
  const pendiente = (motivo: string): SugerenciaFamilia => ({ valor: null, motivo, incompatibles });

  if (r.advertencias.some((a) => a.codigo === 'TIPO_AMBIGUO')) return pendiente('El título menciona varios tipos de producto: elige la familia manualmente.');
  if (tipo.valor === null) return pendiente('El título no indica si el producto es una bolsa o una hoja: elige la familia manualmente.');
  if (resina.origen === 'EXTRAIDO' && (resina.valor === 'ESD' || resina.valor === 'XOW')) return pendiente(`La resina ${resina.valor} no tiene casilla de Composición en Bolsa Plana 1 ni en Hojas: elige la familia manualmente.`);
  if (incompatibles.some((i) => (tipo.valor === 'BOLSA' ? i.familia === 'BOLSA_PLANA_1' : i.familia === 'HOJA_PAQ'))) {
    return pendiente(tipo.valor === 'BOLSA'
      ? 'Hay indicios de fuelle u otra familia especial: no se sugiere Bolsa Plana 1.'
      : 'Hay indicios de otra familia especial: no se sugiere Hojas.');
  }
  if (ancho.valor === null || largo.valor === null) return pendiente('No se identificaron las dos medidas (ancho y largo) en el título: elige la familia manualmente.');
  if (tipo.valor === 'BOLSA') return { valor: 'BOLSA_PLANA_1', motivo: 'Bolsa con dos medidas (ancho × largo) y sin indicios de fuelle ni de otra familia especial.', incompatibles };
  return { valor: 'HOJA_PAQ', motivo: 'Producto identificado explícitamente como hoja plástica de dos medidas, sin indicios de otra familia especial.', incompatibles };
}

function sugerirColor(r: ResultadoInterpretacion, t: string): SugerenciaColor {
  const sinSugerencia = (nota: string, detectado: string | null = null): SugerenciaColor => ({ preset: null, concentracionPct: null, detectado, regla: null, nota });
  const resina = r.campos.resina.origen === 'PENDIENTE' ? null : r.campos.resina.valor;
  const azul = COLOR_AZUL.test(t);
  const verde = COLOR_VERDE.test(t);
  const otros = [...new Set([...t.matchAll(OTROS_COLORES)].map((m) => m[1] as string))].filter((c) => c !== 'NATURAL' || resina === 'NAT');
  const detectados = [azul ? 'AZUL' : null, verde ? 'VERDE' : null, ...otros].filter((c): c is string => c !== null);
  if (detectados.length > 1) return sinSugerencia(`El título menciona varios colores (${detectados.join(', ')}): confirma el color.`, detectados.join(', '));
  if (verde) return { preset: 'VERDE', concentracionPct: null, detectado: 'VERDE', regla: 'COLOR_EXPLICITO_EN_TITULO', nota: 'BIND indica color verde.' };
  if (azul) return { preset: 'DAUBERT_AZUL', concentracionPct: '2', detectado: 'AZUL', regla: 'COLOR_EXPLICITO_EN_TITULO', nota: 'BIND indica color azul; se sugiere Daubert Azul con 2 % de concentración de color.' };
  if (otros.length === 1) return sinSugerencia(`BIND indica color ${otros[0]}: elige «Otro» y confirma el nombre y el color del dibujo.`, otros[0] as string);
  if (resina === 'PMG' || resina === 'CP5000') {
    return { preset: 'DAUBERT_AZUL', concentracionPct: '2', detectado: null, regla: 'COLOR_POR_DEFECTO_VCI_AZUL_2', nota: 'BIND no indica color: se sugiere Daubert Azul con 2 % de concentración de color (práctica más frecuente en hojas VCI históricas; confírmalo).' };
  }
  return sinSugerencia('Sin sugerencia de color: la resina no es PMG ni CP5000 o no se pudo determinar.');
}

/** Sugerencias del formulario (familia, resina VCI, color y etiqueta). La resina VCI nunca se asigna a composiciones Natural u otras sin regla confirmada. */
export function sugerirEspecificacion(r: ResultadoInterpretacion): SugerenciasEspecificacion {
  const t = normalizarTitulo(r.producto.title);
  const composicion = r.campos.resina.origen === 'PENDIENTE' ? null : r.campos.resina.valor;
  const porComposicion = composicion === null ? undefined : RESINA_VCI_POR_COMPOSICION[composicion];
  const resinaVci: SugerenciaTexto = porComposicion
    ? { valor: porComposicion, regla: `RESINA_VCI_${composicion}_3PCT`, nota: `Sugerida para composición ${composicion}; el 3 % es la concentración histórica más frecuente, no una obligación.` }
    : { valor: null, regla: null, nota: composicion === 'NAT' ? 'Composición Natural: no se asigna una formulación VCI automáticamente.' : 'Sin regla confirmada para esta composición: captura la resina VCI si aplica.' };
  const titulo = r.producto.title.trim();
  return {
    familia: sugerirFamilia(r, t),
    resinaVci,
    resinaVciPorComposicion: { ...RESINA_VCI_POR_COMPOSICION },
    color: sugerirColor(r, t),
    etiqueta: titulo === '' ? { valor: null, regla: null, nota: 'BIND no entrega título.' } : { valor: titulo, regla: 'ETIQUETA_TITLE_BIND', nota: 'Título completo de BIND (incluye números de ítem o parte del cliente).' }
  };
}
