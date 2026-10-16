// Traduce los campos del formulario de especificación (Bolsa Plana 1 y Hoja Paq) a los datos de las plantillas aprobadas. Función pura: sin plantillas, sin disco,
// sin base de datos. Nada se inventa: un dato ausente o no válido queda vacío y se informa como faltante o advertencia.

export type PreviewFamily = 'BOLSA_PLANA_1' | 'HOJA_PAQ';

/** Campos del formulario (todos opcionales y en texto: el usuario puede estar a medias al escribir). */
export interface PreviewFormData {
  codigo?: string; descripcion?: string; producto?: string; cliente?: string; fechaEmision?: string; resinaVci?: string; colorNombre?: string; colorHex?: string;
  composicion?: string; presentacion?: string; cantidad?: string; cantidadUnidad?: string;
  ancho?: string; largo?: string; unidadDimensiones?: string; calibreValor?: string; calibreUnidad?: string; pesoLb?: string;
  etiqueta?: string; modalidad?: string;
}

export interface MappedSheetData {
  /** Valores de texto de la plantilla, por nombre de placeholder (sin escapar; el escape lo hace el compositor de la vista previa). */
  datos: Record<string, string>;
  /** Color del dibujo (#RRGGBB) o null si falta o no es válido: el placeholder queda sin resolver y la plantilla lo muestra en gris. */
  colorBolsaHex: string | null;
  faltantes: string[];
  advertencias: string[];
}

const LABELS: Record<string, string> = {
  codigo: 'Código DCMX', descripcion: 'Descripción', composicion: 'Composición', presentacion: 'Presentación', cantidad: 'Cantidad', cantidadUnidad: 'Unidad de la cantidad',
  ancho: 'Ancho', largo: 'Largo', unidadDimensiones: 'Unidad de las medidas', calibreValor: 'Calibre (valor)', calibreUnidad: 'Calibre (unidad)', pesoLb: 'Peso (lb)',
  colorHex: 'Color del dibujo', modalidad: 'Hoja doblada o extendida'
};
const REQUIRED_COMMON = ['codigo', 'descripcion', 'composicion', 'presentacion', 'cantidad', 'cantidadUnidad', 'ancho', 'largo', 'unidadDimensiones', 'calibreValor', 'calibreUnidad', 'pesoLb', 'colorHex'];

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
  const advertencias: string[] = [];
  const v = (k: keyof PreviewFormData): string => text(form[k]);
  const faltantes: string[] = [];
  const required = [...REQUIRED_COMMON, ...(family === 'HOJA_PAQ' ? ['modalidad'] : [])] as Array<keyof PreviewFormData>;
  for (const key of required) if (v(key) === '') faltantes.push(LABELS[key] ?? key);

  const unidad = v('unidadDimensiones');
  const marca = unidad === 'IN' ? '"' : unidad === 'MM' ? ' mm' : '';
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
  const calibreValor = v('calibreValor');
  if (calibreValor !== '' && !positive(calibreValor)) advertencias.push('El calibre no es un número válido; se muestra tal como se capturó.');
  const calibre = [calibreValor, v('calibreUnidad')].filter((x) => x !== '').join(' ');

  const composicion = v('composicion');
  const presentacion = v('presentacion');
  const mark = (selected: boolean, has: boolean): string => (has ? (selected ? 'X' : 'NA') : '');   // sin selección no se imprime NA
  const datos: Record<string, string> = {
    sufijo_titulo: '', cliente: v('cliente'), fecha_: formatDate(v('fechaEmision'), advertencias), resina_vci: v('resinaVci'), producto: v('producto'), color: v('colorNombre'),
    codigo: v('codigo'), descripcion: v('descripcion'),
    comp_pmg: mark(composicion === 'PMG', composicion !== ''), comp_cp5000: mark(composicion === 'CP5000', composicion !== ''), comp_natural: mark(composicion === 'NAT', composicion !== ''),
    pres_rollo: mark(presentacion === 'ROLLO', presentacion !== ''), pres_paquete: mark(presentacion === 'PAQUETE', presentacion !== ''),
    cantidad, unidad_medidas: unidad === 'IN' ? 'Pulgadas (IN)' : unidad === 'MM' ? 'Milímetros (MM)' : '',
    ancho: medida(v('ancho'), 'El ancho'), largo: medida(v('largo'), 'El largo'), calibre, peso_bolsa_lb: peso, etiqueta: v('etiqueta')
  };
  if (family === 'HOJA_PAQ') {
    datos.hoja_doblada = mark(v('modalidad') === 'DOBLADA', v('modalidad') !== '');
    datos.hoja_extendida = mark(v('modalidad') === 'EXTENDIDA', v('modalidad') !== '');
  }
  const hex = v('colorHex');
  let colorBolsaHex: string | null = null;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) colorBolsaHex = hex;
  else if (hex !== '') advertencias.push('El color del dibujo debe tener el formato #RRGGBB; el dibujo se muestra sin color.');
  if (family === 'BOLSA_PLANA_1' && v('modalidad') !== '') advertencias.push('La modalidad no aplica a Bolsa Plana 1 y se ignora.');
  return { datos, colorBolsaHex, faltantes, advertencias };
}
