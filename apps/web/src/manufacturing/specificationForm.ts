import type { BindProductLookup, CampoInterpretado } from '../services/bindProducts';

// Estado y validación del formulario de especificación de manufactura (Bolsa Plana 1 y Hojas). SOLO transforma el resultado que ya calculó el backend
// (interpretador y sugerencias de NestJS) en campos editables y valida lo obligatorio: no interpreta títulos ni códigos.
//
// Cuatro capas de datos, siempre separadas:
//   1. Datos originales de BIND  → `lookup.producto` (nunca se modifica; el formulario guarda su valor en `base`).
//   2. Sugerencias del sistema   → `base.origin = 'SUGERIDO'` con su nota/regla.
//   3. Correcciones del usuario  → `value` distinto de `base.value` (procedencia USUARIO).
//   4. Datos confirmados         → solo `validateSpecification().confirmed` (todo completo + familia confirmada por el usuario). Nada se guarda todavía.

export type FamilyCode = 'BOLSA_PLANA_1' | 'HOJA_PAQ';

/** El identificador interno HOJA_PAQ se conserva (rutas, plantilla, regresiones); solo cambia el nombre visible. */
export const FAMILY_LABELS: Record<FamilyCode, string> = { BOLSA_PLANA_1: 'Bolsa Plana 1', HOJA_PAQ: 'Hojas' };

export type FieldKey =
  | 'codigo' | 'descripcion' | 'producto' | 'cliente' | 'fechaEmision' | 'resinaVci' | 'colorPreset' | 'colorConcentracion' | 'colorNombre' | 'colorHex'
  | 'composicion' | 'presentacion' | 'cantidad' | 'cantidadUnidad'
  | 'ancho' | 'largo' | 'unidadDimensiones' | 'calibre' | 'pesoLb' | 'etiqueta' | 'modalidad';

/** Procedencia del valor INICIAL de un campo, tal como lo entregó el backend. SIN_DATO: BIND no lo proporciona (lo captura el usuario). */
export type BaseOrigin = 'BIND' | 'SUGERIDO' | 'PENDIENTE' | 'SIN_DATO';
/** Procedencia mostrada: lo recuperado de BIND, lo sugerido, lo modificado por el usuario o lo tomado del catálogo de clientes. */
export type DisplayOrigin = BaseOrigin | 'USUARIO' | 'CATALOGO' | 'PROVISIONAL';

export interface FieldState {
  value: string;
  /** Valor y procedencia con los que llegó (o con los que el sistema lo sugirió por última vez). */
  base: { value: string; origin: BaseOrigin; note?: string };
  /** Solo para el cliente: tomado del catálogo del Hub o capturado de forma provisional. */
  source?: 'CATALOGO' | 'PROVISIONAL';
  /** Solo para el cliente del catálogo: identificador del registro. Sin él no hay vínculo con el catálogo. */
  ref?: string;
}

export type FamilyOrigin = 'SUGERIDA' | 'USUARIO';

export interface SpecificationForm {
  /** Familia seleccionada. Si `familyOrigin` es SUGERIDA, es provisional hasta que el usuario la confirme. */
  family: FamilyCode | null;
  familyOrigin: FamilyOrigin | null;
  /** Explicación de la sugerencia de familia o del motivo por el que quedó pendiente. */
  familyNote: string;
  /** Tabla de la regla «composición → resina VCI» entregada por el backend, para recalcular al cambiar la composición. */
  resinaRules: Record<string, string>;
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

// ---------------------------------------------------------------- color unificado
export type ColorPreset = 'DAUBERT_AZUL' | 'VERDE' | 'OTRO';

/** Catálogo de colores de las familias monocapa. Otras correspondencias (p. ej. COEX Azul #558ED5) se incorporarán con sus variantes. */
export const COLOR_PRESETS: Record<Exclude<ColorPreset, 'OTRO'>, { label: string; nombre: string; hex: string }> = {
  DAUBERT_AZUL: { label: 'Daubert Azul', nombre: 'DAUBERT AZUL', hex: '#538DD5' },
  VERDE: { label: 'Verde', nombre: 'VERDE', hex: '#00B050' }
};
export const COLOR_PRESET_LABELS: Record<ColorPreset, string> = { DAUBERT_AZUL: 'Daubert Azul', VERDE: 'Verde', OTRO: 'Otro' };
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Texto impreso por defecto en el campo Color del documento: nombre del color + concentración del color (independiente de la resina VCI). */
export function colorText(preset: string, concentracion: string): string {
  if (preset !== 'DAUBERT_AZUL' && preset !== 'VERDE') return '';
  const pct = concentracion.trim();
  return `${COLOR_PRESETS[preset].nombre}${pct === '' ? '' : ` AL ${pct}%`}`;
}

/** Fecha local (no UTC) en formato ISO yyyy-mm-dd. */
export function localIsoDate(date: Date = new Date()): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

const FAMILIES: FamilyCode[] = ['BOLSA_PLANA_1', 'HOJA_PAQ'];

/**
 * Construye el formulario inicial a partir de la respuesta del backend. No muta la respuesta.
 * `today` es la fecha local sugerida para la hoja (nunca la `CreationDate` de BIND).
 */
export function buildInitialForm(lookup: BindProductLookup, today: string = localIsoDate()): SpecificationForm {
  const { campos } = lookup.interpretacion;
  const sug = lookup.sugerencias;
  const composiciones = new Set(['PMG', 'CP5000', 'NAT']);
  const resina = campos.resina;
  const unidad = campos.unidadDimensiones;
  const calibre = campos.calibre;
  const cantidad = campos.cantidad;
  const sugFamilia = sug?.familia;
  const family = sugFamilia?.valor && FAMILIES.includes(sugFamilia.valor) ? sugFamilia.valor : null;

  // Calibre: valor literal de BIND. «CAL. 200» → «200», «CAL. 2 MIL» → «2 MIL», «CAL. 2.7» → «2.7». No se convierte ni se agrega unidad.
  const calibreField = calibre.valor === null
    ? field('', 'PENDIENTE', calibre.nota)
    : field(calibre.valor.textoLiteral ?? [calibre.valor.valorOriginal, calibre.valor.unidadOriginal].filter((x): x is string => Boolean(x)).join(' '), 'BIND',
      calibre.valor.unidadOriginal === null ? 'BIND no indica unidad: se conserva el valor tal cual (sin MIL ni conversión). Puedes corregirlo.' : undefined);

  const color = sug?.color;
  const preset = color?.preset ?? null;
  const conc = color?.concentracionPct ?? '';
  const colorSugerido = preset !== null;
  const colorNote = color?.nota;
  const resinaVci = sug?.resinaVci;

  return {
    family,
    familyOrigin: family ? 'SUGERIDA' : null,
    familyNote: sugFamilia?.motivo ?? '',
    resinaRules: sug?.resinaVciPorComposicion ?? {},
    fields: {
      codigo: field(lookup.producto.Code, 'BIND'),
      descripcion: field(lookup.producto.Title, 'BIND'),
      producto: productoField(lookup),
      cliente: field(),
      fechaEmision: field(today, 'SUGERIDO', 'Fecha local sugerida al iniciar el borrador; no es la fecha de alta de BIND ni la emisión definitiva.'),
      resinaVci: resinaVci?.valor ? field(resinaVci.valor, 'SUGERIDO', `${resinaVci.nota}${resinaVci.regla ? ` (regla ${resinaVci.regla})` : ''}`) : field('', 'PENDIENTE', resinaVci?.nota),
      colorPreset: colorSugerido ? field(preset as string, 'SUGERIDO', colorNote) : field('', 'PENDIENTE', colorNote),
      colorConcentracion: colorSugerido && conc !== '' ? field(conc, 'SUGERIDO', 'Concentración del color; es independiente del porcentaje de la resina VCI.') : field(),
      colorNombre: colorSugerido ? field(colorText(preset as string, conc), 'SUGERIDO', colorNote) : field('', 'PENDIENTE', colorNote),
      colorHex: colorSugerido && preset !== null && preset in COLOR_PRESETS ? field(COLOR_PRESETS[preset].hex, 'SUGERIDO') : field(),
      composicion: resina.valor !== null && composiciones.has(resina.valor) && resina.origen !== 'PENDIENTE'
        ? field(resina.valor, originOf(resina), resina.nota)
        : field('', 'PENDIENTE', resina.valor === null ? resina.nota : `La resina ${resina.valor} no tiene casilla en estas familias: selecciona la composición.`),
      presentacion: fromCampo(campos.presentacion, (v) => v),
      cantidad: fromCampo(cantidad, (v) => String(v.cantidad)),
      cantidadUnidad: cantidad.valor?.unidad ? field(cantidad.valor.unidad, originOf(cantidad), cantidad.nota) : field('', 'PENDIENTE', cantidad.nota),
      ancho: fromCampo(campos.ancho, String),
      largo: fromCampo(campos.largo, String),
      unidadDimensiones: unidad.valor !== null && unidad.valor !== 'CM' && unidad.origen !== 'PENDIENTE' ? field(unidad.valor, originOf(unidad), unidad.nota) : field('', 'PENDIENTE', unidad.nota),
      calibre: calibreField,
      pesoLb: fromCampo(campos.pesoLb, String),
      // Etiqueta: Title completo de BIND, editable de forma independiente a la descripción.
      etiqueta: sug?.etiqueta?.valor ? field(sug.etiqueta.valor, 'BIND', sug.etiqueta.nota) : field(),
      modalidad: field('', 'PENDIENTE')
    }
  };
}

export function displayOrigin(state: FieldState): DisplayOrigin {
  if (state.source) return state.source;
  return state.value !== state.base.value ? 'USUARIO' : state.base.origin;
}

export const isEdited = (state: FieldState): boolean => state.value !== state.base.value || state.source !== undefined;

export function setFieldValue(form: SpecificationForm, key: FieldKey, value: string, source?: FieldState['source'], ref?: string): SpecificationForm {
  const current = form.fields[key];
  const next: FieldState = { ...current, value, source, ref: source === 'CATALOGO' ? ref : undefined };
  return { ...form, fields: { ...form.fields, [key]: next } };
}

export function restoreField(form: SpecificationForm, key: FieldKey): SpecificationForm {
  const current = form.fields[key];
  return { ...form, fields: { ...form.fields, [key]: { ...current, value: current.base.value, source: undefined, ref: undefined } } };
}

/** Selección de familia por el usuario: confirma (o corrige) la sugerencia. */
export const selectFamily = (form: SpecificationForm, family: FamilyCode | null): SpecificationForm => ({ ...form, family, familyOrigin: family === null ? null : 'USUARIO' });

/** Acepta explícitamente la familia sugerida. */
export const confirmFamily = (form: SpecificationForm): SpecificationForm => (form.family ? { ...form, familyOrigin: 'USUARIO' } : form);

/** Reemplaza el valor Y la referencia de un campo que el SISTEMA derivó de otro (no cuenta como edición del usuario). */
function systemValue(value: string, origin: BaseOrigin, note?: string): FieldState {
  return { value, base: { value, origin, ...(note ? { note } : {}) } };
}

const isAuto = (state: FieldState): boolean => state.value === state.base.value && state.source === undefined;

/**
 * Cambia el selector único de color: actualiza a la vez el preset, el hexadecimal del dibujo y (si el usuario no lo ha editado) el texto impreso.
 * Un texto de color que el usuario editó a mano no se reemplaza.
 */
export function setColorPreset(form: SpecificationForm, preset: ColorPreset | ''): SpecificationForm {
  const f = form.fields;
  const nombreAuto = f.colorNombre.value === colorText(f.colorPreset.value, f.colorConcentracion.value) || f.colorNombre.value === '';
  const concAuto = f.colorConcentracion.value === f.colorConcentracion.base.value;
  const conc = preset !== 'DAUBERT_AZUL' && concAuto && f.colorConcentracion.base.origin === 'SUGERIDO' ? '' : f.colorConcentracion.value;   // el 2 % sugerido es del azul
  const hex = preset === 'DAUBERT_AZUL' || preset === 'VERDE' ? COLOR_PRESETS[preset].hex : preset === 'OTRO' ? f.colorHex.value : '';
  const fields = { ...f, colorPreset: { ...f.colorPreset, value: preset }, colorHex: { ...f.colorHex, value: hex, source: undefined } };
  if (conc !== f.colorConcentracion.value) fields.colorConcentracion = { ...f.colorConcentracion, value: conc, base: { ...f.colorConcentracion.base, value: conc } };
  if (nombreAuto) fields.colorNombre = systemValue(colorText(preset, conc), 'SUGERIDO', f.colorNombre.base.note);
  return { ...form, fields };
}

/** Concentración del color (independiente de la resina VCI): si el texto impreso no se editó a mano, se regenera con la nueva concentración. */
export function setColorConcentracion(form: SpecificationForm, value: string): SpecificationForm {
  const f = form.fields;
  const nombreAuto = f.colorNombre.value === colorText(f.colorPreset.value, f.colorConcentracion.value) && f.colorPreset.value !== 'OTRO';
  const fields = { ...f, colorConcentracion: { ...f.colorConcentracion, value } };
  if (nombreAuto) fields.colorNombre = systemValue(colorText(f.colorPreset.value, value), 'SUGERIDO', f.colorNombre.base.note);
  return { ...form, fields };
}

/** Cambia la composición; si la Resina VCI sigue siendo la sugerida (no editada), se recalcula con la regla del backend. Natural u otras no reciben formulación VCI. */
export function setComposition(form: SpecificationForm, value: string): SpecificationForm {
  const f = form.fields;
  const next = { ...form, fields: { ...f, composicion: { ...f.composicion, value, source: undefined } } };
  if (!isAuto(f.resinaVci)) return next;
  const rule = form.resinaRules[value];
  next.fields.resinaVci = rule
    ? systemValue(rule, 'SUGERIDO', `Sugerida para composición ${value}; el 3 % es la concentración histórica más frecuente, no una obligación.`)
    : systemValue('', 'PENDIENTE', value === 'NAT' ? 'Composición Natural: no se asigna una formulación VCI automáticamente.' : 'Sin regla confirmada para esta composición.');
  return next;
}

export function isFieldVisible(key: FieldKey, family: FamilyCode | null): boolean {
  if (key === 'modalidad') return family === 'HOJA_PAQ';
  return true;
}

export const REQUIRED_COMMON: FieldKey[] = ['codigo', 'descripcion', 'cliente', 'composicion', 'presentacion', 'cantidad', 'cantidadUnidad', 'ancho', 'largo', 'unidadDimensiones', 'calibre', 'pesoLb', 'colorPreset', 'colorNombre', 'colorHex'];
export const REQUIRED_BY_FAMILY: Record<FamilyCode, FieldKey[]> = { BOLSA_PLANA_1: [], HOJA_PAQ: ['modalidad'] };

export const FIELD_LABELS: Record<FieldKey, string> = {
  codigo: 'Código DCMX', descripcion: 'Descripción', producto: 'Producto', cliente: 'Cliente', fechaEmision: 'Fecha de emisión de la hoja', resinaVci: 'Resina VCI',
  colorPreset: 'Color', colorConcentracion: 'Concentración del color (%)', colorNombre: 'Texto del color en el documento', colorHex: 'Color del dibujo (#RRGGBB)',
  composicion: 'Composición', presentacion: 'Presentación', cantidad: 'Cantidad por rollo o paquete', cantidadUnidad: 'Unidad de la cantidad',
  ancho: 'Ancho', largo: 'Largo', unidadDimensiones: 'Unidad de las medidas', calibre: 'Calibre', pesoLb: 'Peso (lb)', etiqueta: 'Etiqueta', modalidad: 'Hoja doblada o extendida'
};

const positive = (value: string): boolean => /^\d+([.,]\d+)?$/.test(value.trim()) && Number(value.trim().replace(',', '.')) > 0;

export interface SpecificationValidation {
  errors: Partial<Record<FieldKey | 'familia', string>>;
  warnings: string[];
  /** Pendientes legibles, siempre visibles (aunque el usuario no pulse «Validar»). */
  pending: string[];
  /** Se puede mostrar el borrador HTML (hay familia, aunque sea la sugerida). */
  previewable: boolean;
  /** Todos los datos obligatorios están presentes y son válidos (incluye un cliente vinculado al catálogo). */
  complete: boolean;
  /** Completa Y con la familia confirmada por el usuario. Aún no se guarda ni se emite nada. */
  confirmed: boolean;
}

/** Valida los datos obligatorios de la familia elegida. Una especificación con errores nunca se considera completa. */
export function validateSpecification(form: SpecificationForm, lookup?: BindProductLookup): SpecificationValidation {
  const errors: SpecificationValidation['errors'] = {};
  const warnings: string[] = [];
  const pending: string[] = [];
  if (form.family === null) errors.familia = 'Falta elegir la familia de manufactura (Bolsa Plana 1 u Hojas).';
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
  checkNumber('pesoLb', 'El peso debe ser un número mayor que cero (libras).');

  // Calibre: texto literal (p. ej. «200», «2 MIL», «2.7»). Solo se exige que contenga un número mayor que cero; no se convierte ni se completa con unidades.
  if (!errors.calibre) {
    const n = /\d+(?:[.,]\d+)?|\.\d+/.exec(form.fields.calibre.value);
    if (!n || !(Number(n[0].replace(',', '.')) > 0)) errors.calibre = 'El calibre debe incluir un número mayor que cero (se conserva tal como se escribe).';
  }

  // Cliente: debe estar vinculado a un registro del catálogo; el texto libre no basta.
  const cliente = form.fields.cliente;
  if (!(cliente.source === 'CATALOGO' && cliente.ref)) errors.cliente = 'Selecciona un cliente del catálogo: el texto libre no queda vinculado a un registro.';
  if (cliente.value.trim() === '') pending.push('Cliente: selecciona un cliente del catálogo.');
  else if (errors.cliente) pending.push('Cliente: confirma el cliente eligiéndolo del catálogo.');

  // Color unificado.
  const preset = form.fields.colorPreset.value;
  if (!errors.colorPreset && !['DAUBERT_AZUL', 'VERDE', 'OTRO'].includes(preset)) errors.colorPreset = 'Elige un color: Daubert Azul, Verde u Otro.';
  if (preset === 'OTRO' && form.fields.colorNombre.value.trim() === '') errors.colorNombre = 'Escribe el nombre del color.';
  if (!errors.colorHex && !HEX_COLOR.test(form.fields.colorHex.value.trim())) errors.colorHex = 'El color debe tener el formato #RRGGBB.';
  const conc = form.fields.colorConcentracion.value.trim();
  if (conc !== '' && !(positive(conc) && Number(conc.replace(',', '.')) <= 100)) errors.colorConcentracion = 'La concentración del color debe ser un número entre 0 y 100.';
  if (form.fields.fechaEmision.value.trim() !== '' && Number.isNaN(Date.parse(form.fields.fechaEmision.value))) errors.fechaEmision = 'La fecha de emisión no es válida.';

  if (form.family) {
    const incompatible = lookup?.sugerencias?.familia.incompatibles.find((i) => i.familia === form.family);
    if (incompatible) warnings.push(`Familia incompatible con los datos de BIND: ${incompatible.motivo} Confirma la familia.`);
    else if (lookup?.sugerencias?.familia.valor && lookup.sugerencias.familia.valor !== form.family) warnings.push(`El sistema sugería ${FAMILY_LABELS[lookup.sugerencias.familia.valor]}, pero elegiste ${FAMILY_LABELS[form.family]}.`);
    if (form.familyOrigin === 'SUGERIDA') pending.push(`Familia: ${FAMILY_LABELS[form.family]} es una sugerencia del sistema; confírmala.`);
  } else {
    pending.push('Familia: elige Bolsa Plana 1 u Hojas.');
  }
  const complete = Object.keys(errors).length === 0;
  return { errors, warnings, pending, previewable: form.family !== null, complete, confirmed: complete && form.familyOrigin === 'USUARIO' };
}

/** Campos cuyo valor difiere del que entregó BIND o del sistema (para mostrar qué cambió el usuario). */
export const changedFields = (form: SpecificationForm): FieldKey[] => (Object.keys(form.fields) as FieldKey[]).filter((key) => isEdited(form.fields[key]) && isFieldVisible(key, form.family));

const PREVIEW_KEYS: FieldKey[] = ['codigo', 'descripcion', 'producto', 'cliente', 'fechaEmision', 'resinaVci', 'colorNombre', 'colorHex', 'composicion', 'presentacion', 'cantidad', 'cantidadUnidad',
  'ancho', 'largo', 'unidadDimensiones', 'calibre', 'pesoLb', 'etiqueta'];

/** Datos que se envían al backend para la vista previa: solo los valores ACTUALES del formulario (nunca el producto original de BIND). */
export function toPreviewData(form: SpecificationForm): Record<string, string> {
  const data: Record<string, string> = {};
  for (const key of PREVIEW_KEYS) data[key] = form.fields[key].value.trim();
  if (form.family === 'HOJA_PAQ') data.modalidad = form.fields.modalidad.value.trim();
  return data;
}
