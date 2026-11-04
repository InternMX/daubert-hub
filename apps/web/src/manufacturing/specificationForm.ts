import type { BindProductLookup, CampoInterpretado, FuenteDato } from '../services/bindProducts';
import { consolidar, crearIncidencia, seccionDeCampo, type Incidencia } from './incidencias';
import type { CapaConfig, ColorPresetConfig, FamilyCode, FamilyConfig, FieldKey } from '../services/manufacturingFamilies';

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
export type BaseOrigin = 'BIND' | 'SUGERIDO' | 'CALCULADO' | 'PENDIENTE' | 'SIN_DATO';
/** Procedencia mostrada: lo recuperado de BIND, lo sugerido, lo modificado por el usuario o lo tomado del catálogo de clientes. */
export type DisplayOrigin = BaseOrigin | 'USUARIO' | 'CATALOGO' | 'PROVISIONAL';

export interface FieldState {
  value: string;
  /** Protecciones explícitas, incluso si el valor manual coincide con el sugerido. */
  manual?: boolean;
  confirmed?: boolean;
  /** Valor y procedencia con los que llegó (o con los que el sistema lo sugirió por última vez). */
  base: { value: string; origin: BaseOrigin; note?: string; /** Fuente de una interpretación conciliada con el código (Title, Code, ambos o contradicción). */ fuente?: FuenteDato };
  /** Solo para el cliente: tomado del catálogo del Hub o capturado como texto libre. */
  source?: 'CATALOGO' | 'PROVISIONAL';
  /** Solo para el cliente del catálogo: identificador del registro. Sin él no hay vínculo con el catálogo. */
  ref?: string;
}

export type FamilyOrigin = 'SUGERIDA' | 'USUARIO';

export const ALL_FIELDS: FieldKey[] = [
  'codigo', 'descripcion', 'producto', 'cliente', 'fechaEmision', 'resinaVci', 'colorPreset', 'colorConcentracion', 'colorNombre', 'colorHex', 'composicion', 'presentacion', 'cantidad', 'cantidadUnidad',
  'ancho', 'largo', 'unidadDimensiones', 'calibre', 'pesoLb', 'etiqueta', 'modalidad', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo',
  'anchoRollo', 'anchoDoblado', 'medidaPliegue', 'largoPresentacionFinal', 'anchoPresentacionFinal',
  'coexVariante', 'pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior', 'lbVciInterior', 'lbVciIntermedia', 'lbVciExterior'
];

export interface SpecificationForm {
  /** Familia seleccionada. Si `familyOrigin` es SUGERIDA, es provisional hasta que el usuario la confirme. */
  family: FamilyCode | null;
  familyOrigin: FamilyOrigin | null;
  /** Explicación de la sugerencia de familia o del motivo por el que quedó pendiente. */
  familyNote: string;
  /** Tabla de la regla «composición → resina VCI» entregada por el backend, para recalcular al cambiar la composición. */
  resinaRules: Record<string, string>;
  layerWeightRule?: FamilyConfig['pesosCapasRegla'];
  /** Capas COEX con su porcentaje de VCI (de la configuración): base del cálculo de libras de VCI. */
  layerVci?: CapaConfig[];
  /** BIND declaró un color en el Title: el color sugerido por la familia nunca lo reemplaza (si difieren, se advierte la contradicción). */
  colorDeBind: boolean;
  /** Concentración de color sugerida por BIND para el azul; el color natural (u otro) no la hereda. */
  colorConcentracionSugerida: string;
  /** Último color que el sistema sugirió (preset, dibujo, concentración y texto): a él vuelve «Restaurar». */
  colorSistema?: Partial<Record<FieldKey, FieldState>>;
  /** Todos los campos viven aquí aunque la familia no los muestre: cambiar de familia NO borra lo capturado (los que no aplican solo dejan de enviarse y se avisan). */
  fields: Record<FieldKey, FieldState>;
}

const field = (value = '', origin: BaseOrigin = 'SIN_DATO', note?: string, fuente?: FuenteDato): FieldState => ({ value, base: { value, origin, ...(note ? { note } : {}), ...(fuente ? { fuente } : {}) } });

/** Fuente que se muestra: la conciliada con el código o, si no hay código que la contradiga ni corrobore, el título. */
const fuenteDe = (campo: CampoInterpretado<unknown>): FuenteDato | undefined => campo.procedencia ?? (campo.origen === 'EXTRAIDO' ? 'TITLE' : undefined);

/** Solo los datos que vienen (o se corroboran) con Description muestran su fuente; el resto conserva su presentación de siempre. */
const fuenteDescription = (campo: CampoInterpretado<unknown>): FuenteDato | undefined => (campo.procedencia === 'DESCRIPTION' || campo.procedencia === 'TITLE_Y_DESCRIPTION' ? campo.procedencia : undefined);

const originOf = (campo: CampoInterpretado<unknown>): BaseOrigin => (campo.origen === 'EXTRAIDO' ? 'BIND' : campo.origen === 'SUGERIDO' ? 'SUGERIDO' : 'PENDIENTE');

function fromCampo<T>(campo: CampoInterpretado<T>, toValue: (valor: T) => string): FieldState {
  if (campo.valor === null) return field('', 'PENDIENTE', campo.nota);
  return field(toValue(campo.valor), originOf(campo), campo.nota, fuenteDescription(campo));
}

/** Fuelles: si el título no los sugiere no son un «pendiente» (la mayoría de los productos no los tiene): quedan para captura manual. */
function fuelleField(campo: CampoInterpretado<number> | undefined): FieldState {
  if (!campo || campo.valor === null) return field();
  return field(String(campo.valor), originOf(campo), campo.nota, fuenteDescription(campo));
}

const TIPO_LABEL: Record<string, string> = { BOLSA: 'Bolsa', HOJA: 'Hoja' };

// «Producto» no viene de BIND como campo propio: se sugiere el tipo (Bolsa/Hoja) que ya interpretó el backend; el usuario lo ajusta. Para papel no se sugiere nada.
function productoField(lookup: BindProductLookup): FieldState {
  if (lookup.sugerencias?.productoEspecifico) return field(lookup.sugerencias.productoEspecifico, 'BIND', 'Denominación técnica explícita de Title: se conserva al cambiar de familia.');
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
      calibre.valor.unidadOriginal === null ? 'BIND no indica unidad: se conserva el valor tal cual (sin MIL ni conversión). Puedes corregirlo.' : undefined, fuenteDescription(calibre));

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
    layerWeightRule: configOf(configs, family)?.pesosCapasRegla ?? null,
    layerVci: configOf(configs, family)?.capas ?? [],
    colorDeBind: color?.detectado != null,
    colorConcentracionSugerida: conc,
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
        ? field(resina.valor, originOf(resina), resina.nota, fuenteDe(resina))
        : field('', 'PENDIENTE', resina.valor === null ? resina.nota : `La resina ${resina.valor} no tiene casilla en estas familias: selecciona la composición.`, resina.procedencia),
      presentacion: fromCampo(campos.presentacion, (v) => v),
      cantidad: fromCampo(cantidad, (v) => String(v.cantidad)),
      cantidadUnidad: cantidad.valor?.unidad ? field(cantidad.valor.unidad, originOf(cantidad), cantidad.nota, fuenteDescription(cantidad)) : field('', 'PENDIENTE', cantidad.nota),
      ancho: fromCampo(campos.ancho, String),
      fuelleTotal: fuelleField(campos.fuelleTotal),
      fuelleDerecho: fuelleField(campos.fuelleDerecho),
      fuelleIzquierdo: fuelleField(campos.fuelleIzquierdo),
      largo: fromCampo(campos.largo, String),
      unidadDimensiones: unidad.valor !== null && unidad.origen !== 'PENDIENTE' ? field(unidad.valor, originOf(unidad), unidad.nota, fuenteDescription(unidad)) : field('', 'PENDIENTE', unidad.nota),
      calibre: calibreField,
      pesoLb: fromCampo(campos.pesoLb, String),
      // Etiqueta: Title completo de BIND, editable de forma independiente a la descripción.
      etiqueta: sug?.etiqueta?.valor ? field(sug.etiqueta.valor, 'BIND', sug.etiqueta.nota) : field(),
      modalidad: field('', 'PENDIENTE'),
      // Cotas técnicas independientes (Rollo Continuo y Termoencogible): BIND no las entrega y NO se calculan: las captura el usuario.
      anchoRollo: field(), anchoDoblado: field(), medidaPliegue: field(), largoPresentacionFinal: field(), anchoPresentacionFinal: field(),
      // COEX: la variante requiere color declarado. Los pesos y las libras de VCI de cada capa se calculan desde el total (suggestLayerWeights).
      coexVariante: sug?.coexVariante?.valor ? field(sug.coexVariante.valor, 'SUGERIDO', sug.coexVariante.nota) : field('', 'PENDIENTE', sug?.coexVariante?.nota),
      pesoCapaInterior: field(), pesoCapaIntermedia: field(), pesoCapaExterior: field(), lbVciInterior: field(), lbVciIntermedia: field(), lbVciExterior: field()
    }
  };
  // Si BIND no declara color, la familia sugerida aporta su color por defecto (p. ej. el natural en Bolsa Natural); nunca se pisa un color sugerido desde el título.
  const familyConfig = configOf(configs, family);
  if (familyConfig) form.fields.producto = suggestedProduct(form.fields.producto, familyConfig);
  // COEX: el color impreso sale de la variante aprobada (no del color predefinido de otras familias).
  if (familyConfig && familyConfig.variantes.length > 0) {
    const variante = familyConfig.variantes.find((v) => v.valor === form.fields.coexVariante.value);
    form.fields.colorNombre = variante ? field(variante.colorTexto, 'SUGERIDO', 'Texto del color según la variante COEX.') : field('', 'PENDIENTE', 'Elige la variante COEX para el texto del color.');
  }
  const next = familyConfig && familyConfig.colorDibujo && familyConfig.colorSugerido && form.fields.colorPreset.value === '' && !sug?.color?.detectado ? applyColor(form, familyConfig.colorSugerido, familyConfig) : form;
  return suggestLayerWeights(conColorDelSistema(next));
}

export function displayOrigin(state: FieldState): DisplayOrigin {
  if (state.source) return state.source;
  return state.manual || state.value !== state.base.value ? 'USUARIO' : state.base.origin;
}

export const isEdited = (state: FieldState): boolean => Boolean(state.manual) || state.value !== state.base.value || state.source !== undefined;

export function setFieldValue(form: SpecificationForm, key: FieldKey, value: string, source?: FieldState['source'], ref?: string): SpecificationForm {
  const current = form.fields[key];
  const protectedField = key === 'producto' || ['colorNombre', 'colorHex'].includes(key) || ['pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior', 'lbVciInterior', 'lbVciIntermedia', 'lbVciExterior'].includes(key);
  const next: FieldState = { ...current, value, source, ref: source === 'CATALOGO' ? ref : undefined, ...(protectedField ? { manual: true, confirmed: false } : {}) };
  const updated = { ...form, fields: { ...form.fields, [key]: next } };
  return key === 'pesoLb' || form.layerWeightRule?.campos.includes(key) ? suggestLayerWeights(updated) : updated;
}

const COLOR_GRUPO: FieldKey[] = ['colorPreset', 'colorHex', 'colorConcentracion', 'colorNombre'];

export function restoreField(form: SpecificationForm, key: FieldKey): SpecificationForm {
  if (key === 'colorPreset') {
    // El selector de color gobierna también el color del dibujo, la concentración y el texto impreso: se restauran juntos para no dejar un estado mezclado.
    const fields = { ...form.fields };
    for (const k of COLOR_GRUPO) {
      const sistema = form.colorSistema?.[k];
      fields[k] = sistema ? { ...sistema } : { ...fields[k], value: fields[k].base.value, source: undefined, ref: undefined, manual: false, confirmed: false };
    }
    return { ...form, fields };
  }
  const current = form.fields[key];
  const restored = { ...form, fields: { ...form.fields, [key]: { ...current, value: current.base.value, source: undefined, ref: undefined, manual: false, confirmed: false } } };
  return key === 'pesoLb' || form.layerWeightRule?.campos.includes(key) || form.layerVci?.some((c) => c.lbKey === key) ? suggestLayerWeights(restored) : restored;
}

/** Reemplaza el valor Y la procedencia de un campo que el SISTEMA derivó de otro (no cuenta como edición del usuario). */
function systemValue(value: string, origin: BaseOrigin, note?: string): FieldState {
  return { value, base: { value, origin, ...(note ? { note } : {}) } };
}

const isAuto = (state: FieldState): boolean => !state.manual && !state.confirmed && state.value === state.base.value && state.source === undefined;

function suggestedProduct(current: FieldState, config: FamilyConfig): FieldState {
  if (!isAuto(current) || current.base.origin === 'BIND') return current;
  return systemValue(config.productoSugerido, 'SUGERIDO', config.productoNota);
}

// ---------------------------------------------------------------- libras de VCI por capa
// libras_vci_capa = peso_capa_lb × (porcentaje_vci / 100). Aritmética decimal exacta sobre enteros (sin coma flotante binaria), redondeo half-up:
// el peso se redondea a cinco decimales (el valor que se muestra y se usa) y el VCI se entrega con seis. Debe coincidir con vci-calculation.ts de la API.
const DECIMAL = /^\d+(?:[.,]\d+)?$/;

/** Unidades de 10^-escala del texto decimal (half-up); null si no es un decimal no negativo. */
function scaleDecimal(text: string, scale: number): number | null {
  const t = text.trim();
  if (!DECIMAL.test(t)) return null;
  const [int = '0', frac = ''] = t.replace(',', '.').split('.');
  const units = Number(`${int}${frac.slice(0, scale).padEnd(scale, '0')}`) + (Number(frac[scale] ?? '0') >= 5 ? 1 : 0);
  return Number.isSafeInteger(units) ? units : null;
}

/** Libras de VCI de una capa con `vciDecimals` decimales, o null si el peso de la capa falta, no es numérico o no es positivo. */
export function computeVciPounds(layerWeight: string, vciPercent: number, weightDecimals = 5, vciDecimals = 6): string | null {
  const weight = scaleDecimal(layerWeight, weightDecimals);
  const step = weightDecimals + 4 - vciDecimals;
  if (weight === null || weight <= 0 || !Number.isFinite(vciPercent) || vciPercent < 0 || step < 0) return null;
  const raw = weight * Math.round(vciPercent * 100);
  if (!Number.isSafeInteger(raw)) return null;
  const divisor = 10 ** step;
  const s = String(Math.floor((raw + divisor / 2) / divisor)).padStart(vciDecimals + 1, '0');
  return `${s.slice(0, s.length - vciDecimals)}.${s.slice(s.length - vciDecimals)}`;
}

/** Regla recibida del registro: pesos de capas de variantes autorizadas y, a partir de ellos, las libras de VCI por capa (solo con un peso válido). */
export function suggestLayerWeights(form: SpecificationForm, replaceProtected = false): SpecificationForm {
  const rule = form.layerWeightRule;
  if (!rule || !rule.variantes.includes(form.fields.coexVariante.value)) return form;
  const text = form.fields.pesoLb.value.trim();
  const total = /^\d+(?:[.,]\d+)?$/.test(text) ? Number(text.replace(',', '.')) : NaN;
  const valid = Number.isFinite(total) && total > 0;
  const value = valid ? (total / rule.divisor).toFixed(rule.decimales) : '';
  const fields = { ...form.fields };
  for (const key of rule.campos) {
    const current = fields[key];
    if (!replaceProtected && !isAuto(current)) continue;
    // Un total ausente/incorrecto retira la sugerencia automática anterior; nunca borra capturas protegidas.
    if (!valid && current.base.origin !== 'CALCULADO') continue;
    fields[key] = systemValue(value, valid ? 'CALCULADO' : 'PENDIENTE', valid ? `Peso total ${text} lb ÷ ${rule.divisor}; sugerencia a ${rule.decimales} decimales, editable.` : 'Sin peso total válido y positivo: no se deriva peso por capa.');
  }
  // Libras de VCI: se derivan del peso de capa vigente (sugerido o capturado). Un valor capturado a mano se conserva; sin peso válido se retira el cálculo anterior.
  for (const capa of form.layerVci ?? []) {
    const current = fields[capa.lbKey];
    if (!isAuto(current)) continue;
    const weight = fields[capa.pesoKey].value;
    const calculated = computeVciPounds(weight, capa.porcentajeVci, rule.decimales, rule.decimalesVci);
    if (calculated === null) {
      if (current.base.origin === 'CALCULADO') fields[capa.lbKey] = systemValue('', 'PENDIENTE', 'Sin peso de capa válido y positivo: no se calculan libras de VCI.');
      continue;
    }
    const shown = scaleDecimal(weight, rule.decimales);
    const weight5 = shown === null ? weight : `${String(shown).padStart(rule.decimales + 1, '0').slice(0, -rule.decimales)}.${String(shown).padStart(rule.decimales + 1, '0').slice(-rule.decimales)}`;
    fields[capa.lbKey] = systemValue(calculated, 'CALCULADO', capa.porcentajeVci === 0 ? `${capa.resina}: ${weight5} lb × 0% = ${calculated} lb (editable).` : `${weight5} lb × ${capa.porcentajeVci}% = ${calculated} lb de VCI (${capa.resina}); editable.`);
  }
  return { ...form, fields };
}

/** Revisar el borrador fija los pesos actuales hasta una sustitución explícita. */
export function confirmLayerWeights(form: SpecificationForm): SpecificationForm {
  if (!form.layerWeightRule) return form;
  const fields = { ...form.fields };
  for (const key of form.layerWeightRule.campos) if (fields[key].value !== '') fields[key] = { ...fields[key], confirmed: true };
  return { ...form, fields };
}

/**
 * Selección de familia por el usuario: confirma (o corrige) la sugerencia. Los datos capturados NO se borran ni se transforman: los campos que la nueva familia no tiene
 * dejan de mostrarse y de enviarse a la vista previa, y `incompatibleValues` los informa. Solo si el color sigue sin elegir se sugiere el color por defecto de la familia.
 */
export function selectFamily(form: SpecificationForm, family: FamilyCode | null, configs: FamilyConfig[] = []): SpecificationForm {
  const config = configOf(configs, family);
  let next: SpecificationForm = { ...form, family, familyOrigin: family === null ? null : 'USUARIO', layerWeightRule: config?.pesosCapasRegla ?? null, layerVci: config?.capas ?? [] };
  if (config) next = { ...next, fields: { ...next.fields, producto: suggestedProduct(next.fields.producto, config) } };
  // El color automático sigue a la familia (Natural → NATURAL, las demás → su color por defecto); un color de BIND o editado por el usuario nunca se reemplaza.
  if (config && config.colorDibujo && config.colorSugerido && colorEsAutomatico(form)) {
    return applyColor(next, config.colorSugerido, config);
  }
  // COEX: si el color elegido antes equivale a una variante aprobada (Azul/Verde), se sugiere esa variante; un color personalizado no genera una tercera.
  if (config && config.variantes.length > 0 && form.fields.coexVariante.value === '') {
    const equivalente = config.variantes.find((v) => v.presetEquivalente === form.fields.colorPreset.value);
    if (equivalente) return setCoexVariante(next, equivalente.valor, config);
  }
  return suggestLayerWeights(next);
}

/**
 * Variante COEX (Azul o Verde): actualiza el texto impreso del color si no se editó a mano. Solo existen las variantes aprobadas; no hay color personalizado en COEX.
 */
export function setCoexVariante(form: SpecificationForm, valor: string, config: FamilyConfig): SpecificationForm {
  const f = form.fields;
  const anterior = config.variantes.find((v) => v.valor === f.coexVariante.value);
  const nueva = config.variantes.find((v) => v.valor === valor);
  const nombreAuto = f.colorNombre.value === '' || (anterior !== undefined && f.colorNombre.value === anterior.colorTexto) || isAuto(f.colorNombre);
  const fields = { ...f, coexVariante: { ...f.coexVariante, value: valor, source: undefined } };
  if (nueva && nombreAuto) fields.colorNombre = systemValue(nueva.colorTexto, 'SUGERIDO', 'Texto del color según la variante COEX.');
  return suggestLayerWeights({ ...form, fields });
}

/** Acepta explícitamente la familia sugerida. */
export const confirmFamily = (form: SpecificationForm): SpecificationForm => (form.family ? { ...form, familyOrigin: 'USUARIO' } : form);

/** Recuerda el color sugerido por el sistema (BIND o la familia) para restaurarlo íntegro. */
function conColorDelSistema(form: SpecificationForm): SpecificationForm {
  return { ...form, colorSistema: Object.fromEntries(COLOR_GRUPO.map((k) => [k, { ...form.fields[k], manual: false, confirmed: false, value: form.fields[k].base.value }])) };
}

/** El color se puede sugerir de nuevo: BIND no lo declaró y ningún campo de color fue editado por el usuario. */
function colorEsAutomatico(form: SpecificationForm): boolean {
  if (form.colorDeBind) return false;
  return COLOR_GRUPO.every((k) => form.fields[k].value === '' || isAuto(form.fields[k]));
}

function applyColor(form: SpecificationForm, preset: string, config: FamilyConfig): SpecificationForm {
  const f = form.fields;
  const def = config.colores.find((c) => c.id === preset);
  if (!def) return form;
  // La concentración de color sugerida es del azul: el natural y los demás colores no la heredan.
  const concAuto = f.colorConcentracion.value === '' || isAuto(f.colorConcentracion);
  const conc = concAuto ? (preset === 'DAUBERT_AZUL' ? form.colorConcentracionSugerida : '') : f.colorConcentracion.value;
  return conColorDelSistema({
    ...form,
    fields: {
      ...f,
      colorPreset: systemValue(preset, 'SUGERIDO', 'Color por defecto de la familia: BIND no declara otro color.'),
      colorHex: systemValue(def.hex, 'SUGERIDO'),
      colorConcentracion: !concAuto ? f.colorConcentracion : conc === '' ? systemValue('', 'SIN_DATO') : systemValue(conc, 'SUGERIDO', 'Concentración del color; es independiente del porcentaje de la resina VCI.'),
      colorNombre: isAuto(f.colorNombre) || f.colorNombre.value === '' ? systemValue(colorText(preset, conc, config.colores), 'SUGERIDO', 'Color por defecto de la familia.') : f.colorNombre
    }
  });
}

/**
 * Cambia el selector único de color: actualiza a la vez el preset, el hexadecimal del dibujo y (si el usuario no lo ha editado) el texto impreso.
 * Un texto de color que el usuario editó a mano no se reemplaza.
 */
export function setColorPreset(form: SpecificationForm, preset: ColorPreset, config: FamilyConfig): SpecificationForm {
  const f = form.fields;
  const nombreAuto = f.colorNombre.value === colorText(f.colorPreset.value, f.colorConcentracion.value, config.colores) || f.colorNombre.value === '';
  const concAuto = f.colorConcentracion.value === f.colorConcentracion.base.value;
  // El 2 % sugerido es del azul: se retira al pasar a OTRO predefinido, pero NUNCA al elegir «Otro color…» (un color personalizado no cambia automáticamente la concentración).
  const conc = preset !== 'DAUBERT_AZUL' && preset !== COLOR_OTRO && concAuto && f.colorConcentracion.base.origin === 'SUGERIDO' ? '' : f.colorConcentracion.value;
  const def = config.colores.find((c) => c.id === preset);
  const hex = def ? def.hex : preset === COLOR_OTRO ? f.colorHex.value : '';
  const fields = { ...f, colorPreset: { ...f.colorPreset, value: preset, manual: true }, colorHex: { ...f.colorHex, value: hex, source: undefined } };
  if (conc !== f.colorConcentracion.value) fields.colorConcentracion = { ...f.colorConcentracion, value: conc, base: { ...f.colorConcentracion.base, value: conc } };
  if (nombreAuto) fields.colorNombre = systemValue(colorText(preset, conc, config.colores), 'SUGERIDO', f.colorNombre.base.note);
  return { ...form, fields };
}

/**
 * Aplica un color PERSONALIZADO guardado (nombre + HEX): el nombre se imprime tal cual en el campo Color y el HEX pasa a los elementos visuales que usan el color seleccionado. Es una elección del
 * usuario (no se sobrescribe al cambiar de familia ni de campos) y NO toca la concentración de colorante ni la resina VCI. «Restaurar» vuelve a la sugerencia de BIND o de la familia.
 */
export function setCustomColor(form: SpecificationForm, nombre: string, hex: string): SpecificationForm {
  const f = form.fields;
  return {
    ...form,
    fields: {
      ...f,
      colorPreset: { ...f.colorPreset, value: COLOR_OTRO, source: undefined, manual: true, confirmed: false },
      colorHex: { ...f.colorHex, value: hex, source: undefined, manual: true, confirmed: false },
      colorNombre: { ...f.colorNombre, value: nombre, source: undefined, manual: true, confirmed: false }
    }
  };
}

/** Concentración del color (independiente de la resina VCI): si el texto impreso no se editó a mano, se regenera con la nueva concentración. */
export function setColorConcentracion(form: SpecificationForm, value: string, config: FamilyConfig): SpecificationForm {
  const f = form.fields;
  const nombreAuto = f.colorNombre.value === colorText(f.colorPreset.value, f.colorConcentracion.value, config.colores) && f.colorPreset.value !== COLOR_OTRO;
  const fields = { ...f, colorConcentracion: { ...f.colorConcentracion, value, manual: true } };
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
  fuelleTotal: 'Fuelle total', fuelleDerecho: 'Fuelle derecho', fuelleIzquierdo: 'Fuelle izquierdo', coexVariante: 'Variante COEX', pesoCapaInterior: 'Peso de la capa interior (lb)',
  lbVciInterior: 'Libras de VCI de la capa interior', pesoCapaIntermedia: 'Peso de la capa intermedia (lb)', lbVciIntermedia: 'Libras de VCI de la capa intermedia',
  pesoCapaExterior: 'Peso de la capa exterior (lb)', lbVciExterior: 'Libras de VCI de la capa exterior', anchoRollo: 'Ancho del rollo', anchoDoblado: 'Ancho doblado',
  medidaPliegue: 'Medida del pliegue', largoPresentacionFinal: 'Largo de la presentación final', anchoPresentacionFinal: 'Ancho de la presentación final'
};

const positive = (value: string): boolean => /^\d+([.,]\d+)?$/.test(value.trim()) && Number(value.trim().replace(',', '.')) > 0;

export interface SpecificationValidation {
  /** Errores TÉCNICOS de los datos que exige la familia (no incluye el cliente). */
  errors: Partial<Record<FieldKey | 'familia', string>>;
  /** Incidencias propias del formulario, una por causa (modelo único: ver incidencias.ts). Se combinan con las de BIND y las del backend para mostrarlas y resumirlas. */
  incidencias: Incidencia[];
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
export function incompatibleIncidencias(form: SpecificationForm, config: FamilyConfig | null): Incidencia[] {
  if (!config) return [];
  const f = form.fields;
  const lista: Incidencia[] = [];
  const ignorados: FieldKey[] = ['colorPreset', 'colorConcentracion', 'fuelleTotal', 'composicion', 'cliente'];
  for (const key of ALL_FIELDS) {
    if (config.campos.includes(key) || ignorados.includes(key)) continue;
    if (f[key].value.trim() !== '' && isEdited(f[key])) lista.push(crearIncidencia({ codigo: 'CAMPO_NO_APLICA', nivel: 'INFORMACION', campos: [key], seccion: 'familia', mensaje: `${FIELD_LABELS[key]} (${f[key].value.trim()}) no aplica a ${config.nombre}: se conserva, pero no se envía a la vista previa.` }));
  }
  if (!config.composicionFija && f.composicion.value !== '' && !config.composiciones.includes(f.composicion.value as never)) lista.push(crearIncidencia({ codigo: 'COMPOSICION_FAMILIA', nivel: 'CONTRADICCION', campos: ['composicion'], seccion: 'composicion', mensaje: `La composición ${f.composicion.value} no existe en ${config.nombre}: elige otra.` }));
  if (config.composicionFija && f.composicion.value !== '' && f.composicion.value !== config.composicionFija) lista.push(crearIncidencia({ codigo: 'COMPOSICION_FAMILIA', nivel: 'CONTRADICCION', campos: ['composicion'], seccion: 'composicion', mensaje: `La composición ${f.composicion.value} se ignora: ${config.nombre} tiene composición fija (${config.composicionFija}).` }));
  if (config.colorDibujo && f.colorPreset.value !== '' && f.colorPreset.value !== COLOR_OTRO && !config.colores.some((c) => c.id === f.colorPreset.value)) lista.push(crearIncidencia({ codigo: 'COLOR_NO_DISPONIBLE', nivel: 'PENDIENTE', campos: ['colorPreset'], seccion: 'color', mensaje: `El color «${f.colorPreset.value}» no está disponible en ${config.nombre}: elige otro o «Otro».` }));
  // La modalidad no autorizada ya es un error del campo (MODALIDAD_NO_AUTORIZADA): no se repite aquí.
  return lista;
}

export const incompatibleValues = (form: SpecificationForm, config: FamilyConfig | null): string[] => incompatibleIncidencias(form, config).map((i) => i.mensaje);

/** Valida los datos de la familia elegida con su configuración (backend). El cliente NO es un error técnico: es un requisito de emisión (incidencia informativa CLIENTE_SIN_IDENTIFICAR). */
export function validateSpecification(form: SpecificationForm, configs: FamilyConfig[], lookup?: BindProductLookup): SpecificationValidation {
  const errors: SpecificationValidation['errors'] = {};
  const incidencias: Incidencia[] = [];
  const config = configOf(configs, form.family);
  if (form.family === null || config === null) errors.familia = 'Falta elegir la familia de manufactura.';
  const f = form.fields;
  if (config) {
    for (const key of config.requeridos) {
      if (key === 'composicion' && config.composicionFija) continue;
      if (f[key].value.trim() === '') errors[key] = key === 'unidadDimensiones' ? 'La unidad dimensional no está identificada.' : `Falta ${FIELD_LABELS[key].toLowerCase()}.`;
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
    for (const key of ['pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior'] as const) checkNumber(key, `${FIELD_LABELS[key]} debe ser un número mayor que cero.`);
    for (const key of ['lbVciInterior', 'lbVciIntermedia', 'lbVciExterior'] as const) {
      if (!errors[key] && config.campos.includes(key) && !/^\d+([.,]\d+)?$/.test(f[key].value.trim())) errors[key] = `${FIELD_LABELS[key]} debe ser un número (puede ser 0).`;
    }
    if (!errors.coexVariante && config.variantes.length > 0 && !config.variantes.some((v) => v.valor === f.coexVariante.value)) errors.coexVariante = 'Elige COEX Azul o COEX Verde (no existen otras variantes aprobadas).';
    for (const key of ['anchoRollo', 'anchoDoblado', 'medidaPliegue', 'largoPresentacionFinal', 'anchoPresentacionFinal'] as const) checkNumber(key, `${FIELD_LABELS[key]} debe ser un número mayor que cero.`);

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
    incidencias.push(...incompatibleIncidencias(form, config));
  }

  // Cliente: requisito de la EMISIÓN futura; puede quedar vacío durante la demostración (informativa, nunca bloquea).
  const cliente = f.cliente;
  const clientIdentified = cliente.source === 'CATALOGO' && Boolean(cliente.ref);
  if (!clientIdentified) {
    incidencias.push(crearIncidencia({ codigo: 'CLIENTE_SIN_IDENTIFICAR', nivel: 'INFORMACION', campos: ['cliente'], seccion: 'datos', mensaje: cliente.value.trim() === '' ? 'Cliente sin identificar: se permite en la demostración, pero una emisión futura exigirá un cliente del catálogo.' : 'Cliente capturado como texto libre: no está vinculado al catálogo y una emisión futura exigirá un cliente identificado.' }));
  }

  if (form.family && config) {
    const incompatible = lookup?.sugerencias?.familia.incompatibles.find((i) => i.familia === form.family);
    if (incompatible) incidencias.push(crearIncidencia({ codigo: 'FAMILIA_INCOMPATIBLE', nivel: 'CONTRADICCION', seccion: 'familia', mensaje: `Familia incompatible con los datos de BIND: ${incompatible.motivo} Confirma la familia.`, origen: 'BIND' }));
    else if (lookup?.sugerencias?.familia.valor && lookup.sugerencias.familia.valor !== form.family) incidencias.push(crearIncidencia({ codigo: 'FAMILIA_DISTINTA_SUGERIDA', nivel: 'INFORMACION', seccion: 'familia', mensaje: `El sistema sugería ${familyName(configs, lookup.sugerencias.familia.valor)}, pero elegiste ${config.nombre}.` }));
    if (form.familyOrigin === 'SUGERIDA') incidencias.push(crearIncidencia({ codigo: 'FAMILIA_NO_CONFIRMADA', nivel: 'PENDIENTE', seccion: 'familia', mensaje: `Familia: ${config.nombre} es una sugerencia del sistema; confírmala.` }));
  }
  // Errores técnicos como incidencias: una por causa y campo (dato faltante, valor no válido o modalidad no autorizada).
  for (const [key, mensaje] of Object.entries(errors)) {
    if (key === 'familia') { incidencias.push(crearIncidencia({ codigo: 'FAMILIA_SIN_ELEGIR', nivel: 'ERROR', seccion: 'familia', mensaje })); continue; }
    const campo = key as FieldKey;
    const noAutorizada = campo === 'modalidad' && Boolean(config?.modalidades.some((m) => m.valor === f.modalidad.value && !m.habilitada));
    const codigo = noAutorizada ? 'MODALIDAD_NO_AUTORIZADA' : f[campo].value.trim() === '' ? 'FALTANTE' : 'VALOR_INVALIDO';
    const etiqueta = FIELD_LABELS[campo].replace(/ \(.+\)$/, '');
    const resumen = codigo === 'FALTANTE' ? `Falta ${etiqueta.toLowerCase()}.` : codigo === 'MODALIDAD_NO_AUTORIZADA' ? 'La modalidad elegida no está autorizada.' : `${etiqueta}: valor no válido (no se muestra).`;
    incidencias.push(crearIncidencia({ codigo, nivel: 'ERROR', campos: [campo], seccion: seccionDeCampo(campo), mensaje, resumen, afectaVistaPrevia: true }));
  }
  const technicalReady = Object.keys(errors).length === 0;
  const emissionReady = technicalReady && clientIdentified && form.familyOrigin === 'USUARIO';
  return { errors, incidencias: consolidar(incidencias), previewable: form.family !== null && config !== null, technicalReady, clientIdentified, emissionReady };
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
