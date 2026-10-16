import type { BindProductLookup, CampoInterpretado } from '../services/bindProducts';
import type { ColorPresetConfig, FamilyCode, FamilyConfig, FieldKey } from '../services/manufacturingFamilies';

// Estado y validación del formulario de especificación de manufactura. SOLO transforma el resultado que ya calculó el backend (intérprete, sugerencias y REGISTRO DE FAMILIAS de
// NestJS) en campos editables y valida lo obligatorio según la configuración de la familia: no interpreta títulos ni códigos y no contiene reglas por familia propias.
//
// Cuatro capas de datos, siempre separadas:
//   1. Datos originales de BIND → `lookup.producto` (nunca se modifica; el formulario guarda su valor en `base`).
//   2. Sugerencias del sistema  → `base.origin = 'SUGERIDO'` con su nota/regla.
//   3. Correcciones del usuario → `value` distinto de `base.value` (procedencia USUARIO).
//   4. Niveles de validación    → borrador previsualizable · datos técnicos suficientes · apto para emisión futura. «Aprobado» está fuera de alcance: nada se guarda.

export type { FamilyCode, FieldKey };

/** Procedencia del valor INICIAL de un campo, tal como lo entregó el backend. SIN_DATO: BIND no lo proporciona (lo captura el usuario). */
export type BaseOrigin = 'BIND' | 'SUGERIDO' | 'PENDIENTE' | 'SIN_DATO';
/** Procedencia mostrada: lo recuperado de BIND, lo sugerido, lo modificado por el usuario o lo tomado del catálogo de clientes. */
export type DisplayOrigin = BaseOrigin | 'USUARIO' | 'CATALOGO' | 'PROVISIONAL';

export interface FieldState {
  value: string;
  /** Valor y procedencia con los que llegó (o con los que el sistema lo sugirió por última vez). */
  base: { value: string; origin: BaseOrigin; note?: string };
  /** Solo para el cliente: tomado del catálogo del Hub o capturado como texto libre. */
  source?: 'CATALOGO' | 'PROVISIONAL';
  /** Solo para el cliente del catálogo: identificador del registro. Sin él no hay vínculo con el catálogo. */
  ref?: string;
}

export type FamilyOrigin = 'SUGERIDA' | 'USUARIO';

export const ALL_FIELDS: FieldKey[] = [
  'codigo', 'descripcion', 'producto', 'cliente', 'fechaEmision', 'resinaVci', 'colorPreset', 'colorConcentracion', 'colorNombre', 'colorHex', 'composicion', 'presentacion', 'cantidad', 'cantidadUnidad',
  'ancho', 'largo', 'unidadDimensiones', 'calibre', 'pesoLb', 'etiqueta', 'modalidad', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo'
];

export interface SpecificationForm {
  /** Familia seleccionada. Si `familyOrigin` es SUGERIDA, es provisional hasta que el usuario la confirme. */
  family: FamilyCode | null;
  familyOrigin: FamilyOrigin | null;
  /** Explicación de la sugerencia de familia o del motivo por el que quedó pendiente. */
  familyNote: string;
  /** Tabla de la regla «composición → resina VCI» entregada por el backend, para recalcular al cambiar la composición. */
  resinaRules: Record<string, string>;
  /** Todos los campos viven aquí aunque la familia no los muestre: cambiar de familia NO borra lo capturado (los que no aplican solo dejan de enviarse y se avisan). */
  fields: Record<FieldKey, FieldState>;
}

const field = (value = '', origin: BaseOrigin = 'SIN_DATO', note?: string): FieldState => ({ value, base: { value, origin, ...(note ? { note } : {}) } });

const originOf = (campo: CampoInterpretado<unknown>): BaseOrigin => (campo.origen === 'EXTRAIDO' ? 'BIND' : campo.origen === 'SUGERIDO' ? 'SUGERIDO' : 'PENDIENTE');

function fromCampo<T>(campo: CampoInterpretado<T>, toValue: (valor: T) => string): FieldState {
  if (campo.valor === null) return field('', 'PENDIENTE', campo.nota);
  return field(toValue(campo.valor), originOf(campo), campo.nota);
}

/** Fuelles: si el título no los sugiere no son un «pendiente» (la mayoría de los productos no los tiene): quedan para captura manual. */
function fuelleField(campo: CampoInterpretado<number> | undefined): FieldState {
  if (!campo || campo.valor === null) return field();
  return field(String(campo.valor), originOf(campo), campo.nota);
}

const TIPO_LABEL: Record<string, string> = { BOLSA: 'Bolsa', HOJA: 'Hoja' };

// «Producto» no viene de BIND como campo propio: se sugiere el tipo (Bolsa/Hoja) que ya interpretó el backend; el usuario lo ajusta. Para papel no se sugiere nada.
function productoField(lookup: BindProductLookup): FieldState {
  const tipo = lookup.interpretacion.campos.tipo;
  const label = tipo.valor === null ? undefined : TIPO_LABEL[tipo.valor];
  return label ? field(label, 'SUGERIDO', 'Sugerido a partir del tipo de producto interpretado.') : field();
}

// ---------------------------------------------------------------- color unificado
export type ColorPreset = string;
export const COLOR_OTRO = 'OTRO';
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Texto impreso por defecto en el campo Color del documento: nombre del color + concentración del color (independiente de la resina VCI). */
export function colorText(preset: string, concentracion: string, colores: ColorPresetConfig[]): string {
  const def = colores.find((c) => c.id === preset);
  if (!def) return '';
  const pct = concentracion.trim();
  return `${def.nombre}${pct === '' ? '' : ` AL ${pct}%`}`;
}

/** Fecha local (no UTC) en formato ISO yyyy-mm-dd. */
export function localIsoDate(date: Date = new Date()): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export const configOf = (configs: FamilyConfig[], code: FamilyCode | null): FamilyConfig | null => (code ? configs.find((c) => c.codigo === code) ?? null : null);
export const familyName = (configs: FamilyConfig[], code: FamilyCode): string => configOf(configs, code)?.nombre ?? code;

const formatHalf = (n: number): string => String(Number((n / 2).toFixed(4)));

/**
 * Construye el formulario inicial a partir de la respuesta del backend. No muta la respuesta.
 * `today` es la fecha local sugerida para la hoja (nunca la `CreationDate` de BIND). Solo se preselecciona una familia que el backend sugiere Y que existe en la configuración.
 */
export function buildInitialForm(lookup: BindProductLookup, configs: FamilyConfig[], today: string = localIsoDate()): SpecificationForm {
  const { campos } = lookup.interpretacion;
  const sug = lookup.sugerencias;
  const composiciones = new Set(['PMG', 'CP5000', 'NAT']);
  const resina = campos.resina;
  const unidad = campos.unidadDimensiones;
  const calibre = campos.calibre;
  const cantidad = campos.cantidad;
  const sugFamilia = sug?.familia;
  const family = sugFamilia?.valor && configOf(configs, sugFamilia.valor) ? sugFamilia.valor : null;

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
  const colores = configOf(configs, family)?.colores ?? configs.flatMap((c) => c.colores);
  const presetDef = colores.find((c) => c.id === preset);

  const form: SpecificationForm = {
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
      colorNombre: colorSugerido ? field(colorText(preset as string, conc, colores), 'SUGERIDO', colorNote) : field('', 'PENDIENTE', colorNote),
      colorHex: presetDef ? field(presetDef.hex, 'SUGERIDO') : field(),
      composicion: resina.valor !== null && composiciones.has(resina.valor) && resina.origen !== 'PENDIENTE'
        ? field(resina.valor, originOf(resina), resina.nota)
        : field('', 'PENDIENTE', resina.valor === null ? resina.nota : `La resina ${resina.valor} no tiene casilla en estas familias: selecciona la composición.`),
      presentacion: fromCampo(campos.presentacion, (v) => v),
      cantidad: fromCampo(cantidad, (v) => String(v.cantidad)),
      cantidadUnidad: cantidad.valor?.unidad ? field(cantidad.valor.unidad, originOf(cantidad), cantidad.nota) : field('', 'PENDIENTE', cantidad.nota),
      ancho: fromCampo(campos.ancho, String),
      fuelleTotal: fuelleField(campos.fuelleTotal),
      fuelleDerecho: fuelleField(campos.fuelleDerecho),
      fuelleIzquierdo: fuelleField(campos.fuelleIzquierdo),
      largo: fromCampo(campos.largo, String),
      unidadDimensiones: unidad.valor !== null && unidad.valor !== 'CM' && unidad.origen !== 'PENDIENTE' ? field(unidad.valor, originOf(unidad), unidad.nota) : field('', 'PENDIENTE', unidad.nota),
      calibre: calibreField,
      pesoLb: fromCampo(campos.pesoLb, String),
      // Etiqueta: Title completo de BIND, editable de forma independiente a la descripción.
      etiqueta: sug?.etiqueta?.valor ? field(sug.etiqueta.valor, 'BIND', sug.etiqueta.nota) : field(),
      modalidad: field('', 'PENDIENTE')
    }
  };
  // Si BIND no declara color, la familia sugerida aporta su color por defecto (p. ej. el natural en Bolsa Natural); nunca se pisa un color sugerido desde el título.
  const familyConfig = configOf(configs, family);
  if (familyConfig && familyConfig.colorDibujo && familyConfig.colorSugerido && form.fields.colorPreset.value === '' && !sug?.color?.detectado) return applyColor(form, familyConfig.colorSugerido, familyConfig);
  return form;
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

/** Reemplaza el valor Y la procedencia de un campo que el SISTEMA derivó de otro (no cuenta como edición del usuario). */
function systemValue(value: string, origin: BaseOrigin, note?: string): FieldState {
  return { value, base: { value, origin, ...(note ? { note } : {}) } };
}

const isAuto = (state: FieldState): boolean => state.value === state.base.value && state.source === undefined;

/**
 * Selección de familia por el usuario: confirma (o corrige) la sugerencia. Los datos capturados NO se borran ni se transforman: los campos que la nueva familia no tiene
 * dejan de mostrarse y de enviarse a la vista previa, y `incompatibleValues` los informa. Solo si el color sigue sin elegir se sugiere el color por defecto de la familia.
 */
export function selectFamily(form: SpecificationForm, family: FamilyCode | null, configs: FamilyConfig[] = []): SpecificationForm {
  const next: SpecificationForm = { ...form, family, familyOrigin: family === null ? null : 'USUARIO' };
  const config = configOf(configs, family);
  if (config && config.colorDibujo && config.colorSugerido && form.fields.colorPreset.value === '' && form.fields.colorHex.value === '') {
    return applyColor(next, config.colorSugerido, config);
  }
  return next;
}

/** Acepta explícitamente la familia sugerida. */
export const confirmFamily = (form: SpecificationForm): SpecificationForm => (form.family ? { ...form, familyOrigin: 'USUARIO' } : form);

function applyColor(form: SpecificationForm, preset: string, config: FamilyConfig): SpecificationForm {
  const f = form.fields;
  const def = config.colores.find((c) => c.id === preset);
  if (!def) return form;
  const conc = f.colorConcentracion.value;
  return {
    ...form,
    fields: {
      ...f,
      colorPreset: systemValue(preset, 'SUGERIDO', 'Color por defecto de la familia: BIND no declara otro color.'),
      colorHex: systemValue(def.hex, 'SUGERIDO'),
      colorNombre: isAuto(f.colorNombre) || f.colorNombre.value === '' ? systemValue(colorText(preset, conc, config.colores), 'SUGERIDO', 'Color por defecto de la familia.') : f.colorNombre
    }
  };
}

/**
 * Cambia el selector único de color: actualiza a la vez el preset, el hexadecimal del dibujo y (si el usuario no lo ha editado) el texto impreso.
 * Un texto de color que el usuario editó a mano no se reemplaza.
 */
export function setColorPreset(form: SpecificationForm, preset: ColorPreset, config: FamilyConfig): SpecificationForm {
  const f = form.fields;
  const nombreAuto = f.colorNombre.value === colorText(f.colorPreset.value, f.colorConcentracion.value, config.colores) || f.colorNombre.value === '';
  const concAuto = f.colorConcentracion.value === f.colorConcentracion.base.value;
  const conc = preset !== 'DAUBERT_AZUL' && concAuto && f.colorConcentracion.base.origin === 'SUGERIDO' ? '' : f.colorConcentracion.value;   // el 2 % sugerido es del azul
  const def = config.colores.find((c) => c.id === preset);
  const hex = def ? def.hex : preset === COLOR_OTRO ? f.colorHex.value : '';
  const fields = { ...f, colorPreset: { ...f.colorPreset, value: preset }, colorHex: { ...f.colorHex, value: hex, source: undefined } };
  if (conc !== f.colorConcentracion.value) fields.colorConcentracion = { ...f.colorConcentracion, value: conc, base: { ...f.colorConcentracion.base, value: conc } };
  if (nombreAuto) fields.colorNombre = systemValue(colorText(preset, conc, config.colores), 'SUGERIDO', f.colorNombre.base.note);
  return { ...form, fields };
}

/** Concentración del color (independiente de la resina VCI): si el texto impreso no se editó a mano, se regenera con la nueva concentración. */
export function setColorConcentracion(form: SpecificationForm, value: string, config: FamilyConfig): SpecificationForm {
  const f = form.fields;
  const nombreAuto = f.colorNombre.value === colorText(f.colorPreset.value, f.colorConcentracion.value, config.colores) && f.colorPreset.value !== COLOR_OTRO;
  const fields = { ...f, colorConcentracion: { ...f.colorConcentracion, value } };
  if (nombreAuto) fields.colorNombre = systemValue(colorText(f.colorPreset.value, value, config.colores), 'SUGERIDO', f.colorNombre.base.note);
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

/** Fuelle total: si los fuelles derecho e izquierdo siguen siendo derivados (no editados), se recalculan como la mitad; los editados a mano no se tocan. */
export function setFuelleTotal(form: SpecificationForm, value: string): SpecificationForm {
  const f = form.fields;
  const total = Number(value.trim().replace(',', '.'));
  const mitad = /^\d+([.,]\d+)?$/.test(value.trim()) && total > 0 ? formatHalf(total) : null;
  const fields = { ...f, fuelleTotal: { ...f.fuelleTotal, value } };
  for (const key of ['fuelleDerecho', 'fuelleIzquierdo'] as const) {
    if (mitad !== null && (isAuto(f[key]) || f[key].value === '')) fields[key] = systemValue(mitad, 'SUGERIDO', 'Fuelle total ÷ 2 (derivado; editable).');
  }
  return { ...form, fields };
}

export function isFieldVisible(key: FieldKey, config: FamilyConfig | null): boolean {
  return config === null ? true : config.campos.includes(key);
}

export const FIELD_LABELS: Record<FieldKey, string> = {
  codigo: 'Código DCMX', descripcion: 'Descripción', producto: 'Producto', cliente: 'Cliente', fechaEmision: 'Fecha de emisión de la hoja', resinaVci: 'Resina VCI',
  colorPreset: 'Color', colorConcentracion: 'Concentración del color (%)', colorNombre: 'Texto del color en el documento', colorHex: 'Color del dibujo (#RRGGBB)',
  composicion: 'Composición', presentacion: 'Presentación', cantidad: 'Cantidad por rollo o paquete', cantidadUnidad: 'Unidad de la cantidad',
  ancho: 'Ancho', largo: 'Largo', unidadDimensiones: 'Unidad de las medidas', calibre: 'Calibre', pesoLb: 'Peso (lb)', etiqueta: 'Etiqueta', modalidad: 'Hoja doblada o extendida',
  fuelleTotal: 'Fuelle total', fuelleDerecho: 'Fuelle derecho', fuelleIzquierdo: 'Fuelle izquierdo'
};

const positive = (value: string): boolean => /^\d+([.,]\d+)?$/.test(value.trim()) && Number(value.trim().replace(',', '.')) > 0;

export interface SpecificationValidation {
  /** Errores TÉCNICOS de los datos que exige la familia (no incluye el cliente). */
  errors: Partial<Record<FieldKey | 'familia', string>>;
  warnings: string[];
  /** Pendientes legibles, siempre visibles (aunque el usuario no pulse «Validar»). */
  pending: string[];
  /** Pendientes de una emisión FUTURA que no impiden la demostración (cliente identificado, familia confirmada). */
  emissionPending: string[];
  /** Nivel 1 · Borrador previsualizable: hay familia (aunque sea la sugerida) y se puede mostrar el documento; puede no tener cliente. */
  previewable: boolean;
  /** Nivel 2 · Datos técnicos suficientes para la vista previa: no falta ni es inválido ningún dato técnico de la familia. */
  technicalReady: boolean;
  /** Hay un cliente vinculado al catálogo (requisito de la emisión futura; opcional en la demostración). */
  clientIdentified: boolean;
  /** Nivel 3 · Apto para emisión futura: datos técnicos suficientes + cliente del catálogo + familia confirmada por el usuario. Aún no se guarda ni se emite nada. */
  emissionReady: boolean;
}

/** Valores capturados que la familia ELEGIDA no admite o no tiene: se conservan (no se borran) pero no se envían a la vista previa. */
export function incompatibleValues(form: SpecificationForm, config: FamilyConfig | null): string[] {
  if (!config) return [];
  const f = form.fields;
  const avisos: string[] = [];
  const ignorados: FieldKey[] = ['colorPreset', 'colorConcentracion', 'fuelleTotal', 'composicion', 'cliente'];
  for (const key of ALL_FIELDS) {
    if (config.campos.includes(key) || ignorados.includes(key)) continue;
    if (f[key].value.trim() !== '' && isEdited(f[key])) avisos.push(`${FIELD_LABELS[key]} (${f[key].value.trim()}) no aplica a ${config.nombre}: se conserva, pero no se envía a la vista previa.`);
  }
  if (!config.composicionFija && f.composicion.value !== '' && !config.composiciones.includes(f.composicion.value as never)) avisos.push(`La composición ${f.composicion.value} no existe en ${config.nombre}: elige otra.`);
  if (config.composicionFija && f.composicion.value !== '' && f.composicion.value !== config.composicionFija) avisos.push(`La composición ${f.composicion.value} se ignora: ${config.nombre} tiene composición fija (${config.composicionFija}).`);
  if (config.colorDibujo && f.colorPreset.value !== '' && f.colorPreset.value !== COLOR_OTRO && !config.colores.some((c) => c.id === f.colorPreset.value)) avisos.push(`El color «${f.colorPreset.value}» no está disponible en ${config.nombre}: elige otro o «Otro».`);
  const modalidad = config.modalidades.find((m) => m.valor === f.modalidad.value);
  if (modalidad && !modalidad.habilitada) avisos.push(`${modalidad.etiqueta} no está autorizada en ${config.nombre}.`);
  return avisos;
}

/** Valida los datos de la familia elegida con su configuración (backend). El cliente NO es un error técnico: es un requisito de emisión (ver `emissionPending`). */
export function validateSpecification(form: SpecificationForm, configs: FamilyConfig[], lookup?: BindProductLookup): SpecificationValidation {
  const errors: SpecificationValidation['errors'] = {};
  const warnings: string[] = [];
  const pending: string[] = [];
  const emissionPending: string[] = [];
  const config = configOf(configs, form.family);
  if (form.family === null || config === null) errors.familia = 'Falta elegir la familia de manufactura.';
  const f = form.fields;
  if (config) {
    for (const key of config.requeridos) {
      if (key === 'composicion' && config.composicionFija) continue;
      if (f[key].value.trim() === '') errors[key] = `Falta ${FIELD_LABELS[key].toLowerCase()}.`;
    }
    const checkNumber = (key: FieldKey, message: string, optional = false): void => {
      if (errors[key] || !config.campos.includes(key)) return;
      if (optional && f[key].value.trim() === '') return;
      if (!positive(f[key].value)) errors[key] = message;
    };
    checkNumber('cantidad', 'La cantidad debe ser un número mayor que cero.');
    if (!errors.cantidad && config.campos.includes('cantidad') && !/^\d+$/.test(f.cantidad.value.trim())) errors.cantidad = 'La cantidad debe ser un número entero.';
    checkNumber('ancho', 'El ancho debe ser un número mayor que cero.');
    checkNumber('largo', 'El largo debe ser un número mayor que cero.');
    checkNumber('pesoLb', 'El peso debe ser un número mayor que cero (libras).');
    checkNumber('fuelleDerecho', 'El fuelle derecho debe ser un número mayor que cero.');
    checkNumber('fuelleIzquierdo', 'El fuelle izquierdo debe ser un número mayor que cero.');
    checkNumber('fuelleTotal', 'El fuelle total debe ser un número mayor que cero.', true);

    // Calibre: texto literal (p. ej. «200», «2 MIL», «2.7»). Solo se exige que contenga un número mayor que cero; no se convierte ni se completa con unidades.
    if (!errors.calibre) {
      const n = /\d+(?:[.,]\d+)?|\.\d+/.exec(f.calibre.value);
      if (!n || !(Number(n[0].replace(',', '.')) > 0)) errors.calibre = 'El calibre debe incluir un número mayor que cero (se conserva tal como se escribe).';
    }
    if (!errors.unidadDimensiones && !config.unidades.some((u) => u.valor === f.unidadDimensiones.value)) errors.unidadDimensiones = 'La unidad de las medidas no es válida.';

    // Composición y modalidad según la configuración de la familia.
    if (!errors.composicion && !config.composicionFija && !config.composiciones.includes(f.composicion.value as never)) errors.composicion = `La composición no es válida para ${config.nombre}.`;
    if (!errors.modalidad && config.campos.includes('modalidad')) {
      const m = config.modalidades.find((x) => x.valor === f.modalidad.value);
      if (!m) errors.modalidad = 'Elige la modalidad.';
      else if (!m.habilitada) errors.modalidad = `${m.etiqueta} no está autorizada: ${m.motivo ?? 'sin variante gráfica confirmada por Manufactura.'}`;
    }

    // Color unificado (solo familias con dibujo en color).
    if (config.colorDibujo) {
      const preset = f.colorPreset.value;
      if (!errors.colorPreset && preset !== COLOR_OTRO && !config.colores.some((c) => c.id === preset)) errors.colorPreset = `Elige un color disponible en ${config.nombre}.`;
      if (preset === COLOR_OTRO && f.colorNombre.value.trim() === '') errors.colorNombre = 'Escribe el nombre del color.';
      if (!errors.colorHex && !HEX_COLOR.test(f.colorHex.value.trim())) errors.colorHex = 'El color debe tener el formato #RRGGBB.';
    }
    const conc = f.colorConcentracion.value.trim();
    if (conc !== '' && !(positive(conc) && Number(conc.replace(',', '.')) <= 100)) errors.colorConcentracion = 'La concentración del color debe ser un número entre 0 y 100.';
    if (f.fechaEmision.value.trim() !== '' && Number.isNaN(Date.parse(f.fechaEmision.value))) errors.fechaEmision = 'La fecha de emisión no es válida.';
    for (const aviso of incompatibleValues(form, config)) warnings.push(aviso);
  }

  // Cliente: requisito de la EMISIÓN futura; puede quedar vacío durante la demostración.
  const cliente = f.cliente;
  const clientIdentified = cliente.source === 'CATALOGO' && Boolean(cliente.ref);
  if (!clientIdentified) {
    emissionPending.push(cliente.value.trim() === '' ? 'Cliente sin identificar: se permite en la demostración, pero una emisión futura exigirá un cliente del catálogo.' : 'Cliente capturado como texto libre: no está vinculado al catálogo y una emisión futura exigirá un cliente identificado.');
  }

  if (form.family && config) {
    const incompatible = lookup?.sugerencias?.familia.incompatibles.find((i) => i.familia === form.family);
    if (incompatible) warnings.push(`Familia incompatible con los datos de BIND: ${incompatible.motivo} Confirma la familia.`);
    else if (lookup?.sugerencias?.familia.valor && lookup.sugerencias.familia.valor !== form.family) warnings.push(`El sistema sugería ${familyName(configs, lookup.sugerencias.familia.valor)}, pero elegiste ${config.nombre}.`);
    if (form.familyOrigin === 'SUGERIDA') {
      pending.push(`Familia: ${config.nombre} es una sugerencia del sistema; confírmala.`);
      emissionPending.push('Familia sin confirmar por el usuario.');
    }
  } else {
    pending.push('Familia: elige una familia de manufactura.');
  }
  const technicalReady = Object.keys(errors).length === 0;
  const emissionReady = technicalReady && clientIdentified && form.familyOrigin === 'USUARIO';
  return { errors, warnings, pending, emissionPending, previewable: form.family !== null && config !== null, technicalReady, clientIdentified, emissionReady };
}

/** Campos cuyo valor difiere del que entregó BIND o del sistema (para mostrar qué cambió el usuario). */
export const changedFields = (form: SpecificationForm, config: FamilyConfig | null): FieldKey[] => ALL_FIELDS.filter((key) => isEdited(form.fields[key]) && isFieldVisible(key, config));

// Campos que viajan al backend (los de interfaz como el preset o el fuelle total no tienen placeholder).
const NO_ENVIAR: FieldKey[] = ['colorPreset', 'colorConcentracion', 'fuelleTotal'];

/** Datos que se envían al backend para la vista previa: solo los valores ACTUALES de los campos que la familia tiene (nunca el producto original de BIND ni valores de otra familia). */
export function toPreviewData(form: SpecificationForm, config: FamilyConfig): Record<string, string> {
  const data: Record<string, string> = {};
  for (const key of config.campos) {
    if (NO_ENVIAR.includes(key)) continue;
    data[key] = form.fields[key].value.trim();
  }
  if (config.composicionFija) data.composicion = config.composicionFija;
  else if (!config.composiciones.includes(form.fields.composicion.value as never)) data.composicion = '';      // una composición incompatible no se arrastra
  if (!config.colorDibujo) delete data.colorHex;
  if (config.campos.includes('modalidad')) {
    const m = config.modalidades.find((x) => x.valor === form.fields.modalidad.value);
    data.modalidad = m ? m.valor : '';
  }
  return data;
}
