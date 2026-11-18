import { FAMILIAS, UNIT_LABELS, UNIT_MARKS, type FamilyCode, type FieldKey, type UnitCode } from './family-registry';
import { incidencia, type Incidencia, type NivelIncidencia, type SeccionIncidencia } from './incidencias';

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
  /** Las mismas causas que `faltantes`, `advertencias` y `pendientesEmision`, con identidad estable, campo afectado y severidad (modelo único de incidencias). Las listas de texto son proyecciones de esta. */
  incidencias: Incidencia[];
  /** Requisitos de una emisión futura que NO impiden la demostración (hoy: el cliente identificado). */
  pendientesEmision: string[];
}

const LABELS: Partial<Record<FieldKey, string>> = {
  codigo: 'Código DCMX', descripcion: 'Descripción', cliente: 'Cliente', composicion: 'Composición', presentacion: 'Presentación', cantidad: 'Cantidad', cantidadUnidad: 'Unidad de la cantidad',
  ancho: 'Ancho', largo: 'Largo', unidadDimensiones: 'Unidad de las medidas', calibre: 'Calibre', pesoLb: 'Peso (lb)', colorNombre: 'Color', colorHex: 'Color del dibujo',
  modalidad: 'Hoja doblada o extendida', fuelleDerecho: 'Fuelle derecho', fuelleIzquierdo: 'Fuelle izquierdo', coexVariante: 'Variante COEX', pesoCapaInterior: 'Peso de la capa interior', lbVciInterior: 'Libras de VCI de la capa interior',
  pesoCapaIntermedia: 'Peso de la capa intermedia', lbVciIntermedia: 'Libras de VCI de la capa intermedia', pesoCapaExterior: 'Peso de la capa exterior', lbVciExterior: 'Libras de VCI de la capa exterior', anchoRollo: 'Ancho del rollo', anchoDoblado: 'Ancho doblado',
  medidaPliegue: 'Medida del pliegue', largoPresentacionFinal: 'Largo de la presentación final', anchoPresentacionFinal: 'Ancho de la presentación final'
};
const FRONT_ONLY: FieldKey[] = ['colorPreset'];            // concepto de la interfaz: no tiene placeholder
const HEX = /^#[0-9A-Fa-f]{6}$/;

const text = (value: string | undefined): string => (value ?? '').trim();
const positive = (value: string): boolean => /^\d+([.,]\d+)?$/.test(value) && Number(value.replace(',', '.')) > 0;

type Avisar = (codigo: string, campos: FieldKey[], mensaje: string, nivel?: NivelIncidencia, afectaVistaPrevia?: boolean, seccion?: SeccionIncidencia) => void;

function formatDate(value: string, avisar: Avisar): string {
  if (value === '') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m || Number.isNaN(Date.parse(value))) {
    avisar('VALOR_INVALIDO', ['fechaEmision'], 'La fecha de emisión no es válida y no se muestra.');
    return '';
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Luminancia relativa (WCAG) de un #RRGGBB; > 0.5 se considera un fondo claro, sobre el que el texto o las flechas blancas no se leen. */
function esColorClaro(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

export function mapSheetData(family: PreviewFamily, form: PreviewFormData): MappedSheetData {
  const def = FAMILIAS[family];
  const advertencias: string[] = [];
  const incidencias: Incidencia[] = [];
  // Un único punto de emisión: el texto y la incidencia salen de la misma llamada. Un valor no numérico impide mostrar el dato (ERROR que afecta la hoja) salvo que se indique otro nivel.
  const avisar: Avisar = (codigo, campos, mensaje, nivel = 'ERROR', afectaVistaPrevia = true, seccion = 'datos') => {
    advertencias.push(mensaje);
    incidencias.push(incidencia({ codigo, nivel, campos, seccion, mensaje, origen: 'PLANTILLA', afectaVistaPrevia }));
  };
  const v = (k: FieldKey): string => text(form[k]);
  const faltantes: string[] = [];
  for (const key of def.requeridos) {
    if (FRONT_ONLY.includes(key)) continue;
    if (key === 'composicion' && def.composicionFija) continue;
    if (v(key) === '') {
      faltantes.push(LABELS[key] ?? key);
      incidencias.push(incidencia({ codigo: 'FALTANTE', nivel: 'ERROR', campos: [key], seccion: 'datos', mensaje: `Falta ${(LABELS[key] ?? key).toLowerCase()}.`, origen: 'FORMULARIO', afectaVistaPrevia: true }));
    }
  }
  const pendientesEmision = v('cliente') === '' ? ['Cliente'] : [];
  if (pendientesEmision.length > 0) incidencias.push(incidencia({ codigo: 'CLIENTE_SIN_IDENTIFICAR', nivel: 'INFORMACION', campos: ['cliente'], seccion: 'datos', mensaje: 'Cliente sin identificar: se permite en la demostración; una emisión futura lo exigirá.', origen: 'FORMULARIO' }));

  const unidad = v('unidadDimensiones') as UnitCode | '';
  const marca = unidad !== '' && unidad in UNIT_MARKS ? UNIT_MARKS[unidad] : '';
  const medida = (valor: string, nombre: string, key: FieldKey): string => {
    if (valor === '') return '';
    if (!positive(valor)) { avisar('VALOR_INVALIDO', [key], `${nombre} no es un número válido y no se muestra.`); return ''; }
    return `${valor}${marca}`;
  };
  const cantidadValor = v('cantidad');
  let cantidad = '';
  if (cantidadValor !== '') {
    if (!/^\d+$/.test(cantidadValor) || Number(cantidadValor) <= 0) avisar('VALOR_INVALIDO', ['cantidad'], 'La cantidad no es un número entero válido y no se muestra.');
    else cantidad = `${cantidadValor}${v('cantidadUnidad') === 'BOLSAS' ? ' Bolsas' : v('cantidadUnidad') === 'HOJAS' ? ' Hojas' : ''}`;
  }
  let peso = '';
  if (v('pesoLb') !== '') {
    if (positive(v('pesoLb'))) peso = Number(v('pesoLb').replace(',', '.')).toFixed(4);
    else avisar('VALOR_INVALIDO', ['pesoLb'], 'El peso no es un número válido y no se muestra.');
  }
  // El calibre se imprime EXACTAMENTE como lo confirmó el usuario (p. ej. «200», «2 MIL», «2.7»): no se convierte, no se reformatea y no se agrega ninguna unidad.
  const calibre = v('calibre');
  if (calibre !== '' && !/\d/.test(calibre)) avisar('CALIBRE_SIN_NUMERO', ['calibre'], 'El calibre no contiene ningún número; se muestra tal como se capturó.', 'PENDIENTE', false);

  const composicion = def.composicionFija ?? v('composicion');
  const presentacion = v('presentacion');
  const mark = (selected: boolean, has: boolean): string => (has ? (selected ? 'X' : 'NA') : '');   // sin selección no se imprime NA
  const datos: Record<string, string> = {
    sufijo_titulo: '', cliente: v('cliente'), fecha_: formatDate(v('fechaEmision'), avisar), resina_vci: v('resinaVci'), producto: v('producto'), color: v('colorNombre'),
    codigo: v('codigo'), descripcion: v('descripcion'),
    pres_rollo: mark(presentacion === 'ROLLO', presentacion !== ''), pres_paquete: mark(presentacion === 'PAQUETE', presentacion !== ''),
    cantidad, unidad_medidas: unidad !== '' && unidad in UNIT_LABELS ? UNIT_LABELS[unidad] : '',
    ancho: medida(v('ancho'), 'El ancho', 'ancho'), largo: medida(v('largo'), 'El largo', 'largo'), calibre, peso_bolsa_lb: peso, etiqueta: v('etiqueta')
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
    datos.fuelle_derecho = medida(v('fuelleDerecho'), 'El fuelle derecho', 'fuelleDerecho');
    datos.fuelle_izquierdo = medida(v('fuelleIzquierdo'), 'El fuelle izquierdo', 'fuelleIzquierdo');
  }

  // COEX: tres capas con formulación fija; se imprimen los pesos actuales (sugeridos o capturados) y las libras de VCI capturadas. Este mapeador no recalcula datos.
  const variante = def.variantes?.find((x) => x.valor === v('coexVariante'));
  if (def.capas) {
    datos.sufijo_titulo = ' - COEXTRUSIÓN';
    for (const capa of def.capas) {
      const peso = v(capa.pesoKey);
      const lb = v(capa.lbKey);
      if (peso !== '' && !positive(peso)) avisar('VALOR_INVALIDO', [capa.pesoKey], `${LABELS[capa.pesoKey]} no es un número válido y no se muestra.`, 'ERROR', true, 'capas');
      if (lb !== '' && !/^\d+([.,]\d+)?$/.test(lb)) avisar('VALOR_INVALIDO', [capa.lbKey], `${LABELS[capa.lbKey]} no es un número válido y no se muestra.`, 'ERROR', true, 'capas');
      datos[`peso_capa_${capa.id}`] = positive(peso) ? peso : '';
      datos[`lb_vci_${capa.id}`] = /^\d+([.,]\d+)?$/.test(lb) ? lb : '';
      datos[`resina_capa_${capa.id}`] = capa.resina;
      datos[`resaltar_resina_capa_${capa.id}`] = 'SI';
    }
    if (variante && v('colorNombre') !== '' && !v('colorNombre').toUpperCase().includes(variante.colorTexto)) avisar('COLOR_VARIANTE', ['colorNombre'], `El texto del color no menciona ${variante.colorTexto}: la geometría usa los colores aprobados de ${variante.etiqueta}.`, 'CONTRADICCION', false, 'color');
  }

  const visual: Record<string, string | null> = {};
  const hex = v('colorHex');
  if (def.colorDibujo) {
    visual.color_bolsa_hex = HEX.test(hex) ? hex : null;
    if (hex !== '' && !HEX.test(hex)) avisar('VALOR_INVALIDO', ['colorHex'], 'El color del dibujo debe tener el formato #RRGGBB; el dibujo se muestra sin color.', 'ERROR', true, 'color');
  }
  if (def.variantes?.length) {
    // Solo las variantes aprobadas: un color personalizado no genera una tercera variante.
    visual.color_bolsa_hex = variante?.colorCuerpo ?? null;
    visual.color_capa_interior = variante?.colorCapaInterior ?? null;
    visual.color_capa_intermedia = variante?.colorCapaIntermedia ?? null;
    visual.color_capa_exterior = variante?.colorCapaExterior ?? null;
    visual.color_cotas_internas_hex = variante?.cotasInternasHex ?? null;
  } else if (def.fuelles) {
    const preset = def.colores.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
    // Color que no es un predefinido (p. ej. uno personalizado): las flechas internas blancas no se verían sobre un color claro, así que se usa negro; los predefinidos conservan su decisión aprobada.
    visual.color_cotas_internas_hex = preset?.cotasInternasHex ?? (def.cotasInternasPorDefecto.toUpperCase() === '#FFFFFF' && HEX.test(hex) && esColorClaro(hex) ? '#000000' : def.cotasInternasPorDefecto);
  }
  // Cotas técnicas independientes (Rollo Continuo y Termoencogible): se imprimen con su unidad y NUNCA se calculan a partir de otras medidas.
  const cotas: Array<[FieldKey, string, string]> = [['anchoRollo', 'ancho_rollo', 'El ancho del rollo'], ['anchoDoblado', 'ancho_doblado', 'El ancho doblado'], ['medidaPliegue', 'medida_pliegue', 'La medida del pliegue'],
    ['largoPresentacionFinal', 'largo_presentacion_final', 'El largo de la presentación final'], ['anchoPresentacionFinal', 'ancho_presentacion_final', 'El ancho de la presentación final']];
  for (const [key, placeholder, nombre] of cotas) if (def.campos.includes(key)) datos[placeholder] = medida(v(key), nombre, key);
  if (!def.campos.includes('modalidad') && v('modalidad') !== '') avisar('CAMPO_NO_APLICA', ['modalidad'], 'La modalidad no aplica a esta familia y se ignora.', 'INFORMACION', false);
  if (!def.fuelles && (v('fuelleDerecho') !== '' || v('fuelleIzquierdo') !== '')) avisar('CAMPO_NO_APLICA', ['fuelleDerecho', 'fuelleIzquierdo'], 'Los fuelles no aplican a esta familia y se ignoran.', 'INFORMACION', false, 'medidas');
  return { datos, visual, colorBolsaHex: visual.color_bolsa_hex ?? null, faltantes, advertencias, incidencias, pendientesEmision };
}
