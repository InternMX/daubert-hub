import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Registro CENTRAL de familias de manufactura del prototipo. Es la ÚNICA fuente de verdad de qué campos tiene cada familia, cuáles son obligatorios, qué composiciones,
// colores y modalidades admite y qué plantilla/perfil usa. El frontend lo consume por `GET /api/manufacturing-sheets/families` (no replica ninguna regla familiar), el
// mapeador de la vista previa lo usa para armar los datos de la plantilla y el servicio de vista previa para elegir la plantilla aprobada y su validador.
// Las modalidades salen de los PERFILES existentes (profiles/*.profile.json): nada se habilita aquí que el perfil no autorice.

export type FamilyCode = 'BOLSA_PLANA_1' | 'HOJA_PAQ' | 'BOLSA_FUELLE' | 'BOLSA_NATURAL' | 'ROLLO_CONTINUO' | 'TERMOENCOGIBLE' | 'COEX';
export type Composition = 'PMG' | 'CP5000' | 'NAT';
export type UnitCode = 'IN' | 'MM' | 'CM' | 'M';

export const FIELD_KEYS = [
  'codigo', 'descripcion', 'producto', 'cliente', 'fechaEmision', 'resinaVci', 'colorPreset', 'colorConcentracion', 'colorNombre', 'colorHex',
  'composicion', 'presentacion', 'cantidad', 'cantidadUnidad', 'ancho', 'largo', 'unidadDimensiones', 'calibre', 'pesoLb', 'etiqueta', 'modalidad',
  'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo', 'anchoRollo', 'anchoDoblado', 'medidaPliegue', 'largoPresentacionFinal', 'anchoPresentacionFinal',
  'coexVariante', 'pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior', 'lbVciInterior', 'lbVciIntermedia', 'lbVciExterior'
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface ColorPresetDef {
  id: string;
  etiqueta: string;
  /** Texto que se imprime por defecto en el campo Color del documento. */
  nombre: string;
  hex: string;
  /** Color de las flechas internas de los fuelles para este color (decisión de legibilidad de los datos aprobados). */
  cotasInternasHex: string;
}

/** Variante COEX aprobada: colores del cuerpo, de las tres capas y de las flechas internas (datos de las pruebas COEX Azul y COEX Verde). No hay una tercera variante sin aprobación específica. */
export interface VarianteDef {
  valor: string;
  etiqueta: string;
  /** Texto que se imprime por defecto en el campo Color. */
  colorTexto: string;
  colorCuerpo: string;
  colorCapaInterior: string;
  colorCapaIntermedia: string;
  colorCapaExterior: string;
  cotasInternasHex: string;
  /** Color predefinido de las demás familias que equivale a esta variante (para sugerirla al cambiar de familia). */
  presetEquivalente: string;
}

/** Capa de coextrusión: formulación fija; peso sugerido editable desde el total, libras de VCI siempre capturadas por el usuario. */
export interface CapaDef {
  id: 'interior' | 'intermedia' | 'exterior';
  etiqueta: string;
  resina: string;
  /** Porcentaje de resina VCI de la capa (0 = SIN VCI). Base de `libras_vci_capa = peso_capa_lb × porcentaje / 100`. */
  porcentajeVci: number;
  pesoKey: FieldKey;
  lbKey: FieldKey;
}

export const CAPAS_COEX: CapaDef[] = [
  { id: 'interior', etiqueta: 'Capa interior', resina: 'VCI PMG al 4%', porcentajeVci: 4, pesoKey: 'pesoCapaInterior', lbKey: 'lbVciInterior' },
  { id: 'intermedia', etiqueta: 'Capa intermedia', resina: 'VCI PMG al 2%', porcentajeVci: 2, pesoKey: 'pesoCapaIntermedia', lbKey: 'lbVciIntermedia' },
  { id: 'exterior', etiqueta: 'Capa exterior', resina: 'SIN VCI', porcentajeVci: 0, pesoKey: 'pesoCapaExterior', lbKey: 'lbVciExterior' }
];

export const VARIANTES_COEX: VarianteDef[] = [
  { valor: 'AZUL', etiqueta: 'COEX Azul', colorTexto: 'AZUL', colorCuerpo: '#558ED5', colorCapaInterior: '#376092', colorCapaIntermedia: '#95B3D7', colorCapaExterior: '#C6D9F1', cotasInternasHex: '#FFFFFF', presetEquivalente: 'DAUBERT_AZUL' },
  { valor: 'VERDE', etiqueta: 'COEX Verde', colorTexto: 'VERDE', colorCuerpo: '#00B050', colorCapaInterior: '#00B050', colorCapaIntermedia: '#92D050', colorCapaExterior: '#D7E4BD', cotasInternasHex: '#4A7EBB', presetEquivalente: 'VERDE' }
];

export interface ModalidadDef {
  valor: string;
  etiqueta: string;
  /** false = sin variante gráfica confirmada por Manufactura (perfil): no se puede elegir como opción válida. */
  habilitada: boolean;
  motivo?: string;
}

export interface FamilyDef {
  codigo: FamilyCode;
  nombre: string;
  productoSugerido: string;
  productoNota?: string;
  pesosCapasRegla?: { divisor: number; decimales: number; toleranciaLb: number; decimalesVci: number; variantes: string[]; campos: FieldKey[] };
  plantilla: string;
  imagenes: string;
  perfil: string;
  /** Campos que muestra el formulario, en el orden de captura. */
  campos: FieldKey[];
  /** Campos técnicos obligatorios para que la vista previa sea técnicamente completa (el cliente NO está aquí: es una regla de emisión). */
  requeridos: FieldKey[];
  composiciones: Composition[];
  /** Composición impuesta por el formato (Bolsa Natural); null = el usuario elige entre `composiciones`. */
  composicionFija: Composition | null;
  cantidad: boolean;
  fuelles: boolean;
  /** El dibujo usa un color de relleno (`color_bolsa_hex`). */
  colorDibujo: boolean;
  colores: ColorPresetDef[];
  /** Color que se sugiere cuando BIND no declara uno (id de `colores`); null si no aplica. */
  colorSugerido: string | null;
  /** Color de las flechas internas cuando el color elegido no coincide con un preset. */
  cotasInternasPorDefecto: string;
  /** Variantes aprobadas (solo COEX). */
  variantes?: VarianteDef[];
  /** Capas con formulación fija (solo COEX). */
  capas?: CapaDef[];
  /** Validador autoritativo de tools/ (exportación) o null. */
  validador: { archivo: string; funcion: string } | null;
  notas: string[];
}

const AZUL: ColorPresetDef = { id: 'DAUBERT_AZUL', etiqueta: 'Daubert Azul', nombre: 'DAUBERT AZUL', hex: '#538DD5', cotasInternasHex: '#FFFFFF' };
const VERDE: ColorPresetDef = { id: 'VERDE', etiqueta: 'Verde', nombre: 'VERDE', hex: '#00B050', cotasInternasHex: '#4A7EBB' };
// Beige del machote de Bolsa Natural (datos aprobados «ejemplo-original»).
const NATURAL: ColorPresetDef = { id: 'NATURAL', etiqueta: 'Natural', nombre: 'NATURAL', hex: '#FFF2CC', cotasInternasHex: '#000000' };

const BASE_ANTES: FieldKey[] = ['codigo', 'descripcion', 'producto', 'cliente', 'fechaEmision', 'resinaVci', 'colorPreset', 'colorConcentracion', 'colorNombre', 'colorHex', 'composicion', 'presentacion'];
const MEDIDAS: FieldKey[] = ['ancho', 'largo', 'unidadDimensiones'];
const BASE_DESPUES: FieldKey[] = ['calibre', 'pesoLb', 'etiqueta'];
const OBLIGATORIOS_BASE: FieldKey[] = ['codigo', 'descripcion', 'composicion', 'presentacion', 'cantidad', 'cantidadUnidad', 'ancho', 'largo', 'unidadDimensiones', 'calibre', 'pesoLb', 'colorPreset', 'colorNombre', 'colorHex'];

export const FAMILIAS: Record<FamilyCode, FamilyDef> = {
  BOLSA_PLANA_1: {
    productoSugerido: 'Bolsa PLANA',
    codigo: 'BOLSA_PLANA_1', nombre: 'Bolsa Plana 1', plantilla: 'templates/bolsa-plana-1/bolsa-plana-1.template.html', imagenes: 'templates/bolsa-plana-1/images', perfil: 'bolsa-plana-1.profile.json',
    campos: [...BASE_ANTES, 'cantidad', 'cantidadUnidad', ...MEDIDAS, ...BASE_DESPUES], requeridos: OBLIGATORIOS_BASE,
    composiciones: ['PMG', 'CP5000', 'NAT'], composicionFija: null, cantidad: true, fuelles: false, colorDibujo: true, colores: [AZUL, VERDE], colorSugerido: 'DAUBERT_AZUL', cotasInternasPorDefecto: '#FFFFFF', validador: null,
    notas: ['Dibujo de bolsa plana con sello inferior y la nota de altura del sello.']
  },
  HOJA_PAQ: {
    productoSugerido: 'Bolsa PLANA', productoNota: 'Nombre sugerido conforme al machote compartido de Hojas; editable.',
    codigo: 'HOJA_PAQ', nombre: 'Hojas', plantilla: 'templates/hoja-paq/hoja-paq.template.html', imagenes: 'templates/hoja-paq/images', perfil: 'hoja-paq.profile.json',
    campos: [...BASE_ANTES, 'cantidad', 'cantidadUnidad', 'modalidad', ...MEDIDAS, ...BASE_DESPUES], requeridos: [...OBLIGATORIOS_BASE, 'modalidad'],
    composiciones: ['PMG', 'CP5000', 'NAT'], composicionFija: null, cantidad: true, fuelles: false, colorDibujo: true, colores: [AZUL, VERDE], colorSugerido: 'DAUBERT_AZUL', cotasInternasPorDefecto: '#FFFFFF',
    validador: { archivo: 'validate-hoja-paq-data.mjs', funcion: 'validarDatosHojaPaq' },
    notas: ['Dibujo rectangular de la hoja; la modalidad (doblada o extendida) es un dato explícito.']
  },
  BOLSA_FUELLE: {
    productoSugerido: 'Bolsa con Fuelle',
    codigo: 'BOLSA_FUELLE', nombre: 'Bolsa Fuelle', plantilla: 'templates/bolsa-fuelle/bolsa-fuelle.template.html', imagenes: 'templates/bolsa-fuelle/images', perfil: 'bolsa-fuelle.profile.json',
    campos: [...BASE_ANTES, 'cantidad', 'cantidadUnidad', 'ancho', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo', 'largo', 'unidadDimensiones', ...BASE_DESPUES],
    requeridos: [...OBLIGATORIOS_BASE, 'fuelleDerecho', 'fuelleIzquierdo'] as FieldKey[],
    composiciones: ['PMG', 'CP5000', 'NAT'], composicionFija: null, cantidad: true, fuelles: true, colorDibujo: true, colores: [AZUL, VERDE], colorSugerido: 'DAUBERT_AZUL', cotasInternasPorDefecto: '#FFFFFF', validador: null,
    notas: ['Ambos fuelles (derecho e izquierdo) y sello integrado. «Fuelle total» es auxiliar: se reparte en dos mitades editables.']
  },
  ROLLO_CONTINUO: {
    productoSugerido: 'ROLLO VCI',
    codigo: 'ROLLO_CONTINUO', nombre: 'Rollo Continuo', plantilla: 'templates/rollo-continuo/rollo-continuo.template.html', imagenes: 'templates/rollo-continuo/images', perfil: 'rollo-continuo.profile.json',
    campos: [...BASE_ANTES, 'modalidad', ...MEDIDAS, 'anchoRollo', ...BASE_DESPUES],
    requeridos: [...OBLIGATORIOS_BASE.filter((k) => k !== 'cantidad' && k !== 'cantidadUnidad'), 'modalidad', 'anchoRollo'] as FieldKey[],
    composiciones: ['PMG', 'CP5000', 'NAT'], composicionFija: null, cantidad: false, fuelles: false, colorDibujo: true, colores: [AZUL, VERDE], colorSugerido: 'DAUBERT_AZUL', cotasInternasPorDefecto: '#FFFFFF',
    validador: { archivo: 'validate-rollo-continuo-data.mjs', funcion: 'validarDatosRolloContinuo' },
    notas: ['Dibujo de hoja y dibujo de rollo doblado; el ancho del rollo es un dato independiente del ancho. Solo la modalidad Doblada está autorizada: Extendida no tiene variante gráfica confirmada.']
  },
  TERMOENCOGIBLE: {
    productoSugerido: 'ROLLO VCI + UV TERMOENCOGIBLE',
    codigo: 'TERMOENCOGIBLE', nombre: 'Termoencogible', plantilla: 'templates/termoencogible/termoencogible.template.html', imagenes: 'templates/termoencogible/images', perfil: 'termoencogible.profile.json',
    campos: ['codigo', 'descripcion', 'producto', 'cliente', 'fechaEmision', 'resinaVci', 'colorNombre', 'composicion', 'presentacion', 'modalidad', ...MEDIDAS, 'calibre', 'pesoLb', 'etiqueta',
      'anchoDoblado', 'medidaPliegue', 'largoPresentacionFinal', 'anchoPresentacionFinal'],
    requeridos: ['codigo', 'descripcion', 'composicion', 'presentacion', 'modalidad', 'ancho', 'largo', 'unidadDimensiones', 'calibre', 'pesoLb', 'anchoDoblado', 'medidaPliegue', 'largoPresentacionFinal', 'anchoPresentacionFinal'],
    composiciones: ['PMG', 'CP5000', 'NAT'], composicionFija: null, cantidad: false, fuelles: false, colorDibujo: false, colores: [], colorSugerido: null, cotasInternasPorDefecto: '#FFFFFF',
    validador: { archivo: 'validate-termoencogible-data.mjs', funcion: 'validarDatosTermoencogible' },
    notas: ['Dibujo del material y de la presentación final: las cuatro cotas técnicas (ancho doblado, pliegue, largo y ancho de la presentación final) son datos independientes y no se calculan. Solo la modalidad Doblada está autorizada.']
  },
  COEX: {
    productoSugerido: 'Bolsa con Fuelle - 20% de material reciclado', productoNota: 'Sugerencia editable del machote COEX: el 20% reciclado no es una característica universal ni un dato confirmado del producto.',
    pesosCapasRegla: { divisor: 3, decimales: 5, toleranciaLb: 0.000015, decimalesVci: 6, variantes: ['AZUL', 'VERDE'], campos: ['pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior'] },
    codigo: 'COEX', nombre: 'COEX', plantilla: 'templates/coex/coex.template.html', imagenes: 'templates/coex/images', perfil: 'coex.profile.json',
    campos: ['codigo', 'descripcion', 'producto', 'cliente', 'fechaEmision', 'coexVariante', 'colorNombre', 'composicion', 'presentacion', 'cantidad', 'cantidadUnidad', 'ancho', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo', 'largo',
      'unidadDimensiones', 'calibre', 'pesoLb', 'pesoCapaInterior', 'lbVciInterior', 'pesoCapaIntermedia', 'lbVciIntermedia', 'pesoCapaExterior', 'lbVciExterior', 'etiqueta'],
    requeridos: ['codigo', 'descripcion', 'presentacion', 'cantidad', 'cantidadUnidad', 'ancho', 'fuelleDerecho', 'fuelleIzquierdo', 'largo', 'unidadDimensiones', 'calibre', 'pesoLb', 'coexVariante', 'colorNombre',
      'pesoCapaInterior', 'lbVciInterior', 'pesoCapaIntermedia', 'lbVciIntermedia', 'pesoCapaExterior', 'lbVciExterior'],
    composiciones: ['PMG'], composicionFija: 'PMG', cantidad: true, fuelles: true, colorDibujo: false, colores: [], colorSugerido: null, cotasInternasPorDefecto: '#FFFFFF', validador: null,
    variantes: VARIANTES_COEX, capas: CAPAS_COEX,
    notas: ['Una sola familia COEX con dos variantes aprobadas (Azul #558ED5 y Verde #00B050) sobre la misma plantilla. Tres capas con formulación fija (interior VCI PMG al 4 %, intermedia VCI PMG al 2 %, exterior SIN VCI). Peso por capa sugerido: peso total ÷ 3, editable y con cinco decimales. Libras de VCI sugeridas: peso de la capa × porcentaje de VCI ÷ 100, con seis decimales; editables.']
  },
  BOLSA_NATURAL: {
    productoSugerido: 'Bolsa con Fuelle',
    codigo: 'BOLSA_NATURAL', nombre: 'Bolsa Natural', plantilla: 'templates/bolsa-natural/bolsa-natural.template.html', imagenes: 'templates/bolsa-natural/images', perfil: 'bolsa-natural.profile.json',
    campos: [...BASE_ANTES, 'cantidad', 'cantidadUnidad', 'ancho', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo', 'largo', 'unidadDimensiones', ...BASE_DESPUES],
    requeridos: ([...OBLIGATORIOS_BASE, 'fuelleDerecho', 'fuelleIzquierdo'] as FieldKey[]).filter((k) => k !== 'composicion'),
    composiciones: ['NAT'], composicionFija: 'NAT', cantidad: true, fuelles: true, colorDibujo: true, colores: [NATURAL, AZUL, VERDE], colorSugerido: 'NATURAL', cotasInternasPorDefecto: '#000000',
    validador: { archivo: 'validate-bolsa-natural-data.mjs', funcion: 'validarDatosBolsaNatural' },
    notas: ['La composición es fija (PMG = NA, ESD = NA, Natural = X). No se asigna formulación VCI automáticamente. Confirma que el producto sea realmente una bolsa natural.']
  }
};

export const FAMILY_CODES = Object.keys(FAMILIAS) as FamilyCode[];

export const UNIT_MARKS: Record<UnitCode, string> = { IN: '"', MM: ' mm', CM: ' cm', M: ' m' };
export const UNIT_LABELS: Record<UnitCode, string> = { IN: 'Pulgadas (IN)', MM: 'Milímetros (MM)', CM: 'Centímetros (CM)', M: 'Metros (M)' };

const ROOT = resolve(__dirname, '..');

/** Modalidades autorizadas por el PERFIL de la familia (profiles/*.json). Devuelve [] si la familia no tiene modalidad. */
export function modalidadesDe(def: FamilyDef): ModalidadDef[] {
  if (!def.campos.includes('modalidad')) return [];
  const perfil = JSON.parse(readFileSync(resolve(ROOT, 'profiles', def.perfil), 'utf8')) as { modalidades?: Record<string, { soportada?: boolean; motivo?: string }> };
  return Object.entries(perfil.modalidades ?? {}).map(([valor, c]) => ({ valor, etiqueta: valor === 'DOBLADA' ? 'Doblada' : 'Extendida', habilitada: c.soportada !== false, ...(c.motivo ? { motivo: c.motivo } : {}) }));
}

/** Configuración serializable para el frontend (sin rutas internas de plantillas). */
export interface FamilyConfigDto {
  codigo: FamilyCode;
  nombre: string;
  productoSugerido: string;
  productoNota: string;
  pesosCapasRegla: FamilyDef['pesosCapasRegla'] | null;
  campos: FieldKey[];
  requeridos: FieldKey[];
  composiciones: Composition[];
  composicionFija: Composition | null;
  cantidad: boolean;
  fuelles: boolean;
  colorDibujo: boolean;
  colores: ColorPresetDef[];
  colorSugerido: string | null;
  modalidades: ModalidadDef[];
  variantes: VarianteDef[];
  capas: CapaDef[] | null;
  unidades: Array<{ valor: UnitCode; etiqueta: string }>;
  notas: string[];
}

export function configuracionFamilias(): FamilyConfigDto[] {
  return FAMILY_CODES.map((codigo) => {
    const d = FAMILIAS[codigo];
    return {
      codigo, nombre: d.nombre, productoSugerido: d.productoSugerido, productoNota: d.productoNota ?? 'Nombre sugerido desde el machote de la familia; editable y pendiente de revisión.', pesosCapasRegla: d.pesosCapasRegla ?? null, campos: d.campos, requeridos: d.requeridos, composiciones: d.composiciones, composicionFija: d.composicionFija, cantidad: d.cantidad, fuelles: d.fuelles,
      colorDibujo: d.colorDibujo, colores: d.colores, colorSugerido: d.colorSugerido, modalidades: modalidadesDe(d), variantes: d.variantes ?? [], capas: d.capas ?? null, unidades: (Object.keys(UNIT_LABELS) as UnitCode[]).map((valor) => ({ valor, etiqueta: UNIT_LABELS[valor] })), notas: d.notas
    };
  });
}
