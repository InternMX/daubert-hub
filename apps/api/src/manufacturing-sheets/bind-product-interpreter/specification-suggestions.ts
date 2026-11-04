import { FAMILY_CODES } from '../preview/family-registry';
import type { FamiliaPosible, ResultadoInterpretacion } from './bind-product.types';
import { normalizarTitulo } from './title-parser';
import { denominacionEspecifica } from '../preview/product-denomination';

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
  /** El producto es válido en BIND pero ninguna plantilla del prototipo le corresponde (papel, tubo): no es una familia por confirmar. */
  sinPlantilla?: true;
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

export interface SugerenciaVariante {
  /** Variante COEX declarada por el título (AZUL o VERDE) o null: nunca se asume una por defecto. */
  valor: 'AZUL' | 'VERDE' | null;
  nota: string;
}

export interface SugerenciasEspecificacion {
  productoEspecifico: string | null;
  coexVariante: SugerenciaVariante;
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

const FUELLE = /\b(FUELLES?|GUSSET\w*)\b/;
const COEX = /\bCOEX\w*\b/;
const TERMO = /\bTERMOENCOG\w*\b/;
const ROLLO_CONTINUO = /\bROLLO\s+CONTINUO\b/;
const OTRA_FORMA = /\b(TUBOS?|TUBING)\b/;
const COLOR_AZUL = /\b(AZUL|BLUE)\b/;
const COLOR_VERDE = /\b(VERDE|GREEN)\b/;
const OTROS_COLORES = /\b(AMARILL[OA]|YELLOW|BANANA|ROSA|PINK|ROJ[OA]|RED|NEGR[OA]|BLACK|BLANC[OA]|WHITE|NARANJA|ORANGE|TRANSPARENTE|CLEAR|NATURAL)\b/g;
const NOMBRES: Record<FamiliaPosible, string> = {
  BOLSA_PLANA_1: 'Bolsa Plana 1', HOJA_PAQ: 'Hojas', BOLSA_FUELLE: 'Bolsa Fuelle', BOLSA_NATURAL: 'Bolsa Natural', ROLLO_CONTINUO: 'Rollo Continuo', TERMOENCOGIBLE: 'Termoencogible', COEX: 'COEX'
};

function sugerirFamilia(r: ResultadoInterpretacion, t: string): SugerenciaFamilia {
  const { tipo, resina, ancho, largo, material } = r.campos;
  const todas = Object.keys(NOMBRES) as FamiliaPosible[];
  const dimensiones3 = /\d+(?:[.,]\d+)?\s*"?\s*X\s*\d+(?:[.,]\d+)?\s*"?\s*X\s*\d+/.test(t);
  const fuelle = FUELLE.test(t) || (tipo.valor === 'BOLSA' && dimensiones3);
  const incompatiblesExcepto = (familia: FamiliaPosible, motivo: string): FamiliaIncompatible[] => todas.filter((f) => f !== familia).map((f) => ({ familia: f, motivo }));
  const pendiente = (motivo: string, incompatibles: FamiliaIncompatible[] = [], sinPlantilla = false): SugerenciaFamilia => ({ valor: null, motivo, incompatibles, ...(sinPlantilla ? { sinPlantilla: true as const } : {}) });
  // Solo se sugiere una familia que el prototipo ya tiene habilitada (el registro es la fuente de verdad).
  const sugerida = (familia: FamiliaPosible, motivo: string, incompatibles: FamiliaIncompatible[]): SugerenciaFamilia => (
    (FAMILY_CODES as string[]).includes(familia) ? { valor: familia, motivo, incompatibles } : pendiente(`${motivo} ${NOMBRES[familia]} todavía no está disponible en el prototipo: elige la familia manualmente.`, incompatibles)
  );

  const esPapel = tipo.valor === 'PAPEL' || (material.valor === 'PAPEL' && material.procedencia !== 'CONTRADICCION');
  if (esPapel) return pendiente(`Producto de papel${r.campos.claveMaterial.valor?.startsWith('PW') ? ` (clave ${r.campos.claveMaterial.valor}${material.procedencia === 'CODE' ? ', inferida del código' : ''})` : ''}: no hay una plantilla de papel disponible en este prototipo. El producto es válido en BIND; no se asigna ninguna plantilla plástica.`, incompatiblesExcepto('COEX', 'Es un producto de papel.').concat([{ familia: 'COEX', motivo: 'Es un producto de papel.' }]), true);
  if (TERMO.test(t)) return sugerida('TERMOENCOGIBLE', 'El título indica material termoencogible.', incompatiblesExcepto('TERMOENCOGIBLE', 'El título indica termoencogible.'));
  if (COEX.test(t)) return sugerida('COEX', 'El título indica coextrusión.', incompatiblesExcepto('COEX', 'El título indica coextrusión.'));
  if (ROLLO_CONTINUO.test(t)) return sugerida('ROLLO_CONTINUO', 'El título indica rollo continuo.', incompatiblesExcepto('ROLLO_CONTINUO', 'El título indica rollo continuo.'));
  if (OTRA_FORMA.test(t)) return pendiente('El título menciona tubo: no corresponde a una familia disponible; elige la familia manualmente.', todas.map((f) => ({ familia: f, motivo: 'El título menciona tubo.' })), true);
  if (r.advertencias.some((a) => a.codigo === 'TIPO_AMBIGUO')) return pendiente('El título menciona varios tipos de producto: elige la familia manualmente.');
  if (tipo.valor === null) return pendiente('El título no indica si el producto es una bolsa o una hoja: elige la familia manualmente.');
  if (resina.origen !== 'PENDIENTE' && (resina.valor === 'ESD' || resina.valor === 'XOW')) return pendiente(`La resina ${resina.valor} no tiene casilla de Composición en las familias disponibles: elige la familia manualmente.`);

  const natural = resina.origen !== 'PENDIENTE' && resina.valor === 'NAT';
  if (tipo.valor === 'HOJA') {
    const incompat: FamiliaIncompatible[] = (['BOLSA_PLANA_1', 'BOLSA_FUELLE', 'BOLSA_NATURAL'] as const).map((familia) => ({ familia, motivo: 'BIND describe una hoja, no una bolsa.' }));
    if (ancho.valor === null || largo.valor === null) return pendiente('No se identificaron las dos medidas (ancho y largo) de la hoja: elige la familia manualmente.', incompat);
    return sugerida('HOJA_PAQ', 'Producto identificado explícitamente como hoja plástica de dos medidas, sin indicios de otra familia especial.', incompat);
  }
  // Bolsa
  const incompat: FamiliaIncompatible[] = [{ familia: 'HOJA_PAQ', motivo: 'BIND describe una bolsa, no una hoja.' }];
  if (fuelle) {
    incompat.push({ familia: 'BOLSA_PLANA_1', motivo: 'El título indica fuelle o tres dimensiones: no corresponde a una bolsa plana de dos medidas.' });
    if (natural) return sugerida('BOLSA_NATURAL', 'Bolsa de material natural con fuelle (o tres medidas). Confirma que sea realmente una bolsa natural.', incompat);
    return sugerida('BOLSA_FUELLE', FUELLE.test(t) ? 'El título menciona fuelle.' : 'Bolsa con tres medidas: se sugiere Ancho × Fuelle total × Largo; confirma que tenga fuelles.', incompat);
  }
  if (ancho.valor === null || largo.valor === null) return pendiente('No se identificaron las dos medidas (ancho y largo) en el título: elige la familia manualmente.', incompat);
  return sugerida('BOLSA_PLANA_1', natural ? 'Bolsa natural de dos medidas, sin indicios de fuelle (la composición Natural existe en Bolsa Plana 1). Si es una bolsa natural con fuelles, cambia la familia.' : 'Bolsa con dos medidas (ancho × largo) y sin indicios de fuelle ni de otra familia especial.', incompat);
}

function sugerirVariante(t: string): SugerenciaVariante {
  const azul = COLOR_AZUL.test(t);
  const verde = COLOR_VERDE.test(t);
  if (azul && !verde) return { valor: 'AZUL', nota: 'El título indica color azul: se sugiere COEX Azul. Confírmalo.' };
  if (verde && !azul) return { valor: 'VERDE', nota: 'El título indica color verde: se sugiere COEX Verde. Confírmalo.' };
  return { valor: null, nota: azul && verde ? 'El título menciona azul y verde: elige la variante COEX.' : 'BIND no declara el color: elige la variante COEX (Azul o Verde).' };
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
  // Las marcas explícitas de familia/color se buscan en Title y en Description (la información adicional también puede decir «fuelle», «COEX», «azul»).
  const t = normalizarTitulo(`${r.producto.title} ${r.producto.informacionAdicional ?? ''}`);
  const composicion = r.campos.resina.origen === 'PENDIENTE' ? null : r.campos.resina.valor;
  const porComposicion = composicion === null ? undefined : RESINA_VCI_POR_COMPOSICION[composicion];
  const resinaVci: SugerenciaTexto = porComposicion
    ? { valor: porComposicion, regla: `RESINA_VCI_${composicion}_3PCT`, nota: `Sugerida para composición ${composicion}${r.campos.resina.procedencia === 'CODE' ? ' (inferida del código, no del título)' : ''}; el 3 % es la concentración histórica más frecuente, no una obligación.` }
    : { valor: null, regla: null, nota: composicion === 'NAT' ? 'Composición Natural: no se asigna una formulación VCI automáticamente.' : 'Sin regla confirmada para esta composición: captura la resina VCI si aplica.' };
  const titulo = r.producto.title.trim();
  return {
    productoEspecifico: denominacionEspecifica(r.producto.title),
    familia: sugerirFamilia(r, t),
    coexVariante: sugerirVariante(t),
    resinaVci,
    resinaVciPorComposicion: { ...RESINA_VCI_POR_COMPOSICION },
    color: sugerirColor(r, t),
    etiqueta: titulo === '' ? { valor: null, regla: null, nota: 'BIND no entrega título.' } : { valor: titulo, regla: 'ETIQUETA_TITLE_BIND', nota: 'Título completo de BIND (incluye números de ítem o parte del cliente).' }
  };
}
