import { FAMILIAS, UNIT_LABELS, UNIT_MARKS, type FamilyCode, type FieldKey, type UnitCode } from './family-registry';

// Traduce los campos del formulario de especificación a los datos de las plantillas aprobadas. Función pura: sin plantillas, sin disco, sin base de datos.
// Nada se inventa: un dato ausente o no válido queda vacío y se informa como faltante o advertencia. Las reglas por familia salen del REGISTRO (family-registry.ts),
// no de condiciones repartidas aquí.

export type PreviewFamily = FamilyCode;

/** Campos del formulario (todos opcionales y en texto: el usuario puede estar a medias al escribir). */
export type PreviewFormData = Partial<Record<FieldKey, string>>;

export interface MappedSheetData {
  /** Valores de texto de la plantilla, por nombre de placeholder (sin escapar; el escape lo hace el compositor de la vista previa). */
  datos: Record<string, string>;
  /** Valores CSS de los placeholders visuales (`color_bolsa_hex`, `color_cotas_internas_hex`…): #RRGGBB o null si faltan/no son válidos (el placeholder queda sin resolver). */
  visual: Record<string, string | null>;
  /** Color del dibujo (#RRGGBB) o null; alias de `visual.color_bolsa_hex`. */
  colorBolsaHex: string | null;
  /** Datos TÉCNICOS obligatorios que faltan para que la vista previa sea completa. El cliente no cuenta aquí. */
  faltantes: string[];
  advertencias: string[];
  /** Requisitos de una emisión futura que NO impiden la demostración (hoy: el cliente identificado). */
  pendientesEmision: string[];
}

const LABELS: Partial<Record<FieldKey, string>> = {
  codigo: 'Código DCMX', descripcion: 'Descripción', cliente: 'Cliente', composicion: 'Composición', presentacion: 'Presentación', cantidad: 'Cantidad', cantidadUnidad: 'Unidad de la cantidad',
  ancho: 'Ancho', largo: 'Largo', unidadDimensiones: 'Unidad de las medidas', calibre: 'Calibre', pesoLb: 'Peso (lb)', colorNombre: 'Color', colorHex: 'Color del dibujo',
  modalidad: 'Hoja doblada o extendida', fuelleDerecho: 'Fuelle derecho', fuelleIzquierdo: 'Fuelle izquierdo', anchoRollo: 'Ancho del rollo', anchoDoblado: 'Ancho doblado',
  medidaPliegue: 'Medida del pliegue', largoPresentacionFinal: 'Largo de la presentación final', anchoPresentacionFinal: 'Ancho de la presentación final'
};
const FRONT_ONLY: FieldKey[] = ['colorPreset'];            // concepto de la interfaz: no tiene placeholder
const HEX = /^#[0-9A-Fa-f]{6}$/;

const text = (value: string | undefined): string => (value ?? '').trim();
const positive = (value: string): boolean => /^\d+([.,]\d+)?$/.test(value) && Number(value.replace(',', '.')) > 0;

function formatDate(value: string, advertencias: string[]): string {
  if (value === '') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m || Number.isNaN(Date.parse(value))) {
    advertencias.push('La fecha de emisión no es válida y no se muestra.');
    return '';
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function mapSheetData(family: PreviewFamily, form: PreviewFormData): MappedSheetData {
  const def = FAMILIAS[family];
  const advertencias: string[] = [];
  const v = (k: FieldKey): string => text(form[k]);
  const faltantes: string[] = [];
  for (const key of def.requeridos) {
    if (FRONT_ONLY.includes(key)) continue;
    if (key === 'composicion' && def.composicionFija) continue;
    if (v(key) === '') faltantes.push(LABELS[key] ?? key);
  }
  const pendientesEmision = v('cliente') === '' ? ['Cliente'] : [];

  const unidad = v('unidadDimensiones') as UnitCode | '';
  const marca = unidad !== '' && unidad in UNIT_MARKS ? UNIT_MARKS[unidad] : '';
  const medida = (valor: string, nombre: string): string => {
    if (valor === '') return '';
    if (!positive(valor)) { advertencias.push(`${nombre} no es un número válido y no se muestra.`); return ''; }
    return `${valor}${marca}`;
  };
  const cantidadValor = v('cantidad');
  let cantidad = '';
  if (cantidadValor !== '') {
    if (!/^\d+$/.test(cantidadValor) || Number(cantidadValor) <= 0) advertencias.push('La cantidad no es un número entero válido y no se muestra.');
    else cantidad = `${cantidadValor}${v('cantidadUnidad') === 'BOLSAS' ? ' Bolsas' : v('cantidadUnidad') === 'HOJAS' ? ' Hojas' : ''}`;
  }
  let peso = '';
  if (v('pesoLb') !== '') {
    if (positive(v('pesoLb'))) peso = Number(v('pesoLb').replace(',', '.')).toFixed(4);
    else advertencias.push('El peso no es un número válido y no se muestra.');
  }
  // El calibre se imprime EXACTAMENTE como lo confirmó el usuario (p. ej. «200», «2 MIL», «2.7»): no se convierte, no se reformatea y no se agrega ninguna unidad.
  const calibre = v('calibre');
  if (calibre !== '' && !/\d/.test(calibre)) advertencias.push('El calibre no contiene ningún número; se muestra tal como se capturó.');

  const composicion = def.composicionFija ?? v('composicion');
  const presentacion = v('presentacion');
  const mark = (selected: boolean, has: boolean): string => (has ? (selected ? 'X' : 'NA') : '');   // sin selección no se imprime NA
  const datos: Record<string, string> = {
    sufijo_titulo: '', cliente: v('cliente'), fecha_: formatDate(v('fechaEmision'), advertencias), resina_vci: v('resinaVci'), producto: v('producto'), color: v('colorNombre'),
    codigo: v('codigo'), descripcion: v('descripcion'),
    pres_rollo: mark(presentacion === 'ROLLO', presentacion !== ''), pres_paquete: mark(presentacion === 'PAQUETE', presentacion !== ''),
    cantidad, unidad_medidas: unidad !== '' && unidad in UNIT_LABELS ? UNIT_LABELS[unidad] : '',
    ancho: medida(v('ancho'), 'El ancho'), largo: medida(v('largo'), 'El largo'), calibre, peso_bolsa_lb: peso, etiqueta: v('etiqueta')
  };
  if (family === 'BOLSA_NATURAL') {
    // Composición fija del formato (PMG = NA, ESD = NA, Natural = X); el perfil la valida y CP5000 no existe en esta plantilla.
    Object.assign(datos, { comp_pmg: 'NA', comp_esd: 'NA', comp_natural: 'X' });
  } else {
    Object.assign(datos, { comp_pmg: mark(composicion === 'PMG', composicion !== ''), comp_cp5000: mark(composicion === 'CP5000', composicion !== ''), comp_natural: mark(composicion === 'NAT', composicion !== '') });
  }
  if (def.campos.includes('modalidad')) {
    datos.hoja_doblada = mark(v('modalidad') === 'DOBLADA', v('modalidad') !== '');
    datos.hoja_extendida = mark(v('modalidad') === 'EXTENDIDA', v('modalidad') !== '');
  }
  if (def.fuelles) {
    datos.fuelle_derecho = medida(v('fuelleDerecho'), 'El fuelle derecho');
    datos.fuelle_izquierdo = medida(v('fuelleIzquierdo'), 'El fuelle izquierdo');
  }

  const visual: Record<string, string | null> = {};
  const hex = v('colorHex');
  if (def.colorDibujo) {
    visual.color_bolsa_hex = HEX.test(hex) ? hex : null;
    if (hex !== '' && !HEX.test(hex)) advertencias.push('El color del dibujo debe tener el formato #RRGGBB; el dibujo se muestra sin color.');
  }
  if (def.fuelles) {
    const preset = def.colores.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
    visual.color_cotas_internas_hex = preset?.cotasInternasHex ?? def.cotasInternasPorDefecto;
  }
  // Cotas técnicas independientes (Rollo Continuo y Termoencogible): se imprimen con su unidad y NUNCA se calculan a partir de otras medidas.
  const cotas: Array<[FieldKey, string, string]> = [['anchoRollo', 'ancho_rollo', 'El ancho del rollo'], ['anchoDoblado', 'ancho_doblado', 'El ancho doblado'], ['medidaPliegue', 'medida_pliegue', 'La medida del pliegue'],
    ['largoPresentacionFinal', 'largo_presentacion_final', 'El largo de la presentación final'], ['anchoPresentacionFinal', 'ancho_presentacion_final', 'El ancho de la presentación final']];
  for (const [key, placeholder, nombre] of cotas) if (def.campos.includes(key)) datos[placeholder] = medida(v(key), nombre);
  if (!def.campos.includes('modalidad') && v('modalidad') !== '') advertencias.push('La modalidad no aplica a esta familia y se ignora.');
  if (!def.fuelles && (v('fuelleDerecho') !== '' || v('fuelleIzquierdo') !== '')) advertencias.push('Los fuelles no aplican a esta familia y se ignoran.');
  return { datos, visual, colorBolsaHex: visual.color_bolsa_hex ?? null, faltantes, advertencias, pendientesEmision };
}
