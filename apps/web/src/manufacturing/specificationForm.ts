import type { BindProductLookup, CampoInterpretado } from '../services/bindProducts';

// Estado y validación del formulario de especificación de manufactura (Bolsa Plana 1 y Hoja Paq). SOLO transforma el resultado que ya calculó el backend
// (interpretador de NestJS) en campos editables y valida lo obligatorio: no interpreta títulos ni códigos.

export type FamilyCode = 'BOLSA_PLANA_1' | 'HOJA_PAQ';

export const FAMILY_LABELS: Record<FamilyCode, string> = { BOLSA_PLANA_1: 'Bolsa Plana 1', HOJA_PAQ: 'Hoja Paq' };

export type FieldKey =
  | 'codigo' | 'descripcion' | 'producto' | 'cliente' | 'fechaEmision' | 'resinaVci' | 'colorNombre' | 'colorHex'
  | 'composicion' | 'presentacion' | 'cantidad' | 'cantidadUnidad'
  | 'ancho' | 'largo' | 'unidadDimensiones' | 'calibreValor' | 'calibreUnidad' | 'pesoLb' | 'etiqueta' | 'modalidad';

/** Procedencia del valor INICIAL de un campo, tal como lo entregó el backend. SIN_DATO: BIND no lo proporciona (lo captura el usuario). */
export type BaseOrigin = 'BIND' | 'SUGERIDO' | 'PENDIENTE' | 'SIN_DATO';
/** Procedencia mostrada: lo recuperado de BIND, lo modificado por el usuario o lo tomado del catálogo de clientes. */
export type DisplayOrigin = BaseOrigin | 'USUARIO' | 'CATALOGO' | 'PROVISIONAL';

export interface FieldState {
  value: string;
  /** Valor y procedencia con los que llegó el campo (inmutables mientras dure la búsqueda). */
  base: { value: string; origin: BaseOrigin; note?: string };
  /** Solo para el cliente: tomado del catálogo del Hub o capturado de forma provisional. */
  source?: 'CATALOGO' | 'PROVISIONAL';
}

export interface SpecificationForm {
  family: FamilyCode | null;
  fields: Record<FieldKey, FieldState>;
}

const field = (value = '', origin: BaseOrigin = 'SIN_DATO', note?: string): FieldState => ({ value, base: { value, origin, ...(note ? { note } : {}) } });

const originOf = (campo: CampoInterpretado<unknown>): BaseOrigin => (campo.origen === 'EXTRAIDO' ? 'BIND' : campo.origen === 'SUGERIDO' ? 'SUGERIDO' : 'PENDIENTE');

function fromCampo<T>(campo: CampoInterpretado<T>, toValue: (valor: T) => string): FieldState {
  if (campo.valor === null) return field('', 'PENDIENTE', campo.nota);
  return field(toValue(campo.valor), originOf(campo), campo.nota);
}

const TIPO_LABEL: Record<string, string> = { BOLSA: 'Bolsa', HOJA: 'Hoja' };

// «Producto» no viene de BIND como campo propio: se sugiere el tipo (Bolsa/Hoja) que ya interpretó el backend; el usuario lo ajusta. Para papel no se sugiere nada.
function productoField(lookup: BindProductLookup): FieldState {
  const tipo = lookup.interpretacion.campos.tipo;
  const label = tipo.valor === null ? undefined : TIPO_LABEL[tipo.valor];
  return label ? field(label, 'SUGERIDO', 'Sugerido a partir del tipo de producto interpretado.') : field();
}

/** Construye el formulario inicial a partir de la respuesta del backend. No muta la respuesta. */
export function buildInitialForm(lookup: BindProductLookup): SpecificationForm {
  const { campos } = lookup.interpretacion;
  const composiciones = new Set(['PMG', 'CP5000', 'NAT']);
  const resina = campos.resina;
  const unidad = campos.unidadDimensiones;
  const calibre = campos.calibre;
  const cantidad = campos.cantidad;
  return {
    family: null,
    fields: {
      codigo: field(lookup.producto.Code, 'BIND'),
      descripcion: field(lookup.producto.Title, 'BIND'),
      producto: productoField(lookup),
      cliente: field(),
      fechaEmision: field(),
      resinaVci: field(),
      colorNombre: field(),
      colorHex: field(),
      composicion: resina.valor !== null && composiciones.has(resina.valor) && resina.origen !== 'PENDIENTE'
        ? field(resina.valor, originOf(resina), resina.nota)
        : field('', 'PENDIENTE', resina.valor === null ? resina.nota : `La resina ${resina.valor} no tiene casilla en estas familias: selecciona la composición.`),
      presentacion: fromCampo(campos.presentacion, (v) => v),
      cantidad: fromCampo(cantidad, (v) => String(v.cantidad)),
      cantidadUnidad: cantidad.valor?.unidad ? field(cantidad.valor.unidad, originOf(cantidad), cantidad.nota) : field('', 'PENDIENTE', cantidad.nota),
      ancho: fromCampo(campos.ancho, String),
      largo: fromCampo(campos.largo, String),
      unidadDimensiones: unidad.valor !== null && unidad.valor !== 'CM' && unidad.origen !== 'PENDIENTE' ? field(unidad.valor, originOf(unidad), unidad.nota) : field('', 'PENDIENTE', unidad.nota),
      calibreValor: fromCampo(calibre, (v) => v.valorOriginal),
      calibreUnidad: calibre.valor?.unidadOriginal ? field(calibre.valor.unidadOriginal, originOf(calibre), calibre.nota) : field('', 'PENDIENTE', calibre.nota),
      pesoLb: fromCampo(campos.pesoLb, String),
      etiqueta: field(),
      modalidad: field('', 'PENDIENTE')
    }
  };
}

export function displayOrigin(state: FieldState): DisplayOrigin {
  if (state.source) return state.source;
  return state.value !== state.base.value ? 'USUARIO' : state.base.origin;
}

export const isEdited = (state: FieldState): boolean => state.value !== state.base.value || state.source !== undefined;

export function setFieldValue(form: SpecificationForm, key: FieldKey, value: string, source?: FieldState['source']): SpecificationForm {
  const current = form.fields[key];
  return { ...form, fields: { ...form.fields, [key]: { ...current, value, ...(source ? { source } : { source: undefined }) } } };
}

export function restoreField(form: SpecificationForm, key: FieldKey): SpecificationForm {
  const current = form.fields[key];
  return { ...form, fields: { ...form.fields, [key]: { ...current, value: current.base.value, source: undefined } } };
}

export const selectFamily = (form: SpecificationForm, family: FamilyCode | null): SpecificationForm => ({ ...form, family });

export function isFieldVisible(key: FieldKey, family: FamilyCode | null): boolean {
  if (key === 'modalidad') return family === 'HOJA_PAQ';
  return true;
}

export const REQUIRED_COMMON: FieldKey[] = ['codigo', 'descripcion', 'composicion', 'presentacion', 'cantidad', 'cantidadUnidad', 'ancho', 'largo', 'unidadDimensiones', 'calibreValor', 'calibreUnidad', 'pesoLb', 'colorHex'];
export const REQUIRED_BY_FAMILY: Record<FamilyCode, FieldKey[]> = { BOLSA_PLANA_1: [], HOJA_PAQ: ['modalidad'] };

export const FIELD_LABELS: Record<FieldKey, string> = {
  codigo: 'Código DCMX', descripcion: 'Descripción', producto: 'Producto', cliente: 'Cliente', fechaEmision: 'Fecha de emisión de la hoja', resinaVci: 'Resina VCI', colorNombre: 'Color (nombre)',
  colorHex: 'Color del dibujo (#RRGGBB)', composicion: 'Composición', presentacion: 'Presentación', cantidad: 'Cantidad por rollo o paquete', cantidadUnidad: 'Unidad de la cantidad',
  ancho: 'Ancho', largo: 'Largo', unidadDimensiones: 'Unidad de las medidas', calibreValor: 'Calibre (valor)', calibreUnidad: 'Calibre (unidad)', pesoLb: 'Peso (lb)', etiqueta: 'Etiqueta', modalidad: 'Hoja doblada o extendida'
};

const positive = (value: string): boolean => /^\d+([.,]\d+)?$/.test(value.trim()) && Number(value.trim().replace(',', '.')) > 0;

export interface SpecificationValidation {
  errors: Partial<Record<FieldKey | 'familia', string>>;
  warnings: string[];
  complete: boolean;
}

/** Valida los datos obligatorios de la familia elegida. Una especificación con errores nunca se considera completa. */
export function validateSpecification(form: SpecificationForm, lookup?: BindProductLookup): SpecificationValidation {
  const errors: SpecificationValidation['errors'] = {};
  const warnings: string[] = [];
  if (form.family === null) errors.familia = 'Falta elegir la familia de manufactura (Bolsa Plana 1 u Hoja Paq).';
  const required = [...REQUIRED_COMMON, ...(form.family ? REQUIRED_BY_FAMILY[form.family] : [])];
  for (const key of required) {
    if (form.fields[key].value.trim() === '') errors[key] = `Falta ${FIELD_LABELS[key].toLowerCase()}.`;
  }
  const checkNumber = (key: FieldKey, message: string): void => {
    if (!errors[key] && !positive(form.fields[key].value)) errors[key] = message;
  };
  checkNumber('cantidad', 'La cantidad debe ser un número mayor que cero.');
  if (!errors.cantidad && !/^\d+$/.test(form.fields.cantidad.value.trim())) errors.cantidad = 'La cantidad debe ser un número entero.';
  checkNumber('ancho', 'El ancho debe ser un número mayor que cero.');
  checkNumber('largo', 'El largo debe ser un número mayor que cero.');
  checkNumber('calibreValor', 'El calibre debe ser un número mayor que cero.');
  checkNumber('pesoLb', 'El peso debe ser un número mayor que cero (libras).');
  if (!errors.colorHex && !/^#[0-9A-Fa-f]{6}$/.test(form.fields.colorHex.value.trim())) errors.colorHex = 'El color debe tener el formato #RRGGBB.';
  if (form.fields.fechaEmision.value.trim() !== '' && Number.isNaN(Date.parse(form.fields.fechaEmision.value))) errors.fechaEmision = 'La fecha de emisión no es válida.';
  if (lookup && form.family) {
    const tipo = lookup.interpretacion.campos.tipo.valor;
    if (tipo === 'BOLSA' && form.family === 'HOJA_PAQ') warnings.push('BIND describe una Bolsa, pero elegiste Hoja Paq. Confirma la familia.');
    if (tipo === 'HOJA' && form.family === 'BOLSA_PLANA_1') warnings.push('BIND describe una Hoja, pero elegiste Bolsa Plana 1. Confirma la familia.');
    if (tipo === 'PAPEL') warnings.push('BIND describe un producto de papel, fuera del alcance de estas familias.');
  }
  return { errors, warnings, complete: Object.keys(errors).length === 0 };
}

/** Campos cuyo valor difiere del que entregó BIND (para mostrar qué cambió el usuario). */
export const changedFields = (form: SpecificationForm): FieldKey[] => (Object.keys(form.fields) as FieldKey[]).filter((key) => isEdited(form.fields[key]) && isFieldVisible(key, form.family));

const PREVIEW_KEYS: FieldKey[] = ['codigo', 'descripcion', 'producto', 'cliente', 'fechaEmision', 'resinaVci', 'colorNombre', 'colorHex', 'composicion', 'presentacion', 'cantidad', 'cantidadUnidad',
  'ancho', 'largo', 'unidadDimensiones', 'calibreValor', 'calibreUnidad', 'pesoLb', 'etiqueta'];

/** Datos que se envían al backend para la vista previa: solo los valores ACTUALES del formulario (nunca el producto original de BIND). */
export function toPreviewData(form: SpecificationForm): Record<string, string> {
  const data: Record<string, string> = {};
  for (const key of PREVIEW_KEYS) data[key] = form.fields[key].value.trim();
  if (form.family === 'HOJA_PAQ') data.modalidad = form.fields.modalidad.value.trim();
  return data;
}
