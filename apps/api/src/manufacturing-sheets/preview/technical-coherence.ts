import { interpretarProductoBind } from '../bind-product-interpreter/bind-product-interpreter';
import { sugerirEspecificacion } from '../bind-product-interpreter/specification-suggestions';
import { cadenasDeMedidas, normalizarTitulo } from '../bind-product-interpreter/title-parser';
import { FAMILIAS, type FamilyCode, type FieldKey } from './family-registry';
import { incidencia, type Incidencia, type NivelIncidencia, type SeccionIncidencia } from './incidencias';
import type { PreviewFormData } from './sheet-data.mapper';
import { claseDenominacion } from './product-denomination';
import { calcularLibrasVci, mismaCantidad } from './vci-calculation';

export interface BindReviewContext {
  title: string;
  code: string;
  /** Información adicional de BIND (Description): se interpreta junto con el Title, igual que al buscar el producto. */
  description?: string;
  composicionSeleccionada?: string;
}

/** Incidencia de coherencia técnica: es el modelo único de incidencias (ver incidencias.ts). El backend es la autoridad de estas reglas. */
export type TechnicalNotice = Incidencia;

// Solo una declaración COLOR/COLOR: o COLOR= constituye evidencia para una contradicción.
// No se toman nombres sueltos de marcas, clientes ni «Natural» como color del producto.
export function coloresExplicitos(title: string): string[] {
  const t = normalizarTitulo(title);
  const aliases: Record<string, string> = { BLUE: 'AZUL', GREEN: 'VERDE', RED: 'ROJO', BLACK: 'NEGRO', WHITE: 'BLANCO', YELLOW: 'AMARILLO', CLEAR: 'TRANSPARENTE' };
  return [...new Set([...t.matchAll(/\bCOLOR\s*[:=]?\s*(AZUL|VERDE|ROJO|NEGRO|BLANCO|AMARILLO|TRANSPARENTE|NATURAL|BLUE|GREEN|RED|BLACK|WHITE|YELLOW|CLEAR)\b/g)].map((m) => aliases[m[1]!] ?? m[1]!))];
}

interface Extra { reconocible?: boolean; campos?: FieldKey[]; seccion?: SeccionIncidencia; id?: string; resumen?: string; afectaVistaPrevia?: boolean; origen?: TechnicalNotice['origen'] }

export function revisarCoherencia(family: FamilyCode, data: PreviewFormData, context?: BindReviewContext): TechnicalNotice[] {
  const def = FAMILIAS[family];
  const avisos: TechnicalNotice[] = [];
  const add = (codigo: string, mensaje: string, nivel: NivelIncidencia = 'CONTRADICCION', extra: Extra = {}): void => {
    avisos.push(incidencia({ codigo, nivel, mensaje, campos: extra.campos, seccion: extra.seccion ?? 'datos', id: extra.id, resumen: extra.resumen, afectaVistaPrevia: extra.afectaVistaPrevia, reconocible: extra.reconocible, origen: extra.origen ?? 'SISTEMA' }));
  };
  const claseProducto = claseDenominacion(data.producto ?? '');
  if (claseProducto && claseProducto !== claseDenominacion(def.productoSugerido)) add('PRODUCTO_FAMILIA', `La denominación explícita «${data.producto}» no coincide con el nombre sugerido de ${def.nombre}: «${def.productoSugerido}». Se conserva; revisa antes de reemplazarla.`, 'CONTRADICCION', { campos: ['producto'] });
  const regla = def.pesosCapasRegla;
  const numeroPositivo = (v: string | undefined): number | null => {
    const texto = (v ?? '').trim();
    const n = /^\d+(?:[.,]\d+)?$/.test(texto) ? Number(texto.replace(',', '.')) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  if (regla && regla.variantes.includes(data.coexVariante ?? '')) {
    const total = numeroPositivo(data.pesoLb);
    const capas = regla.campos.map((key) => numeroPositivo(data[key]));
    if (total !== null && capas.every((p): p is number => p !== null)) {
      const suma = capas.reduce((a, p) => a + p, 0);
      if (Math.abs(suma - total) > regla.toleranciaLb + Number.EPSILON * Math.max(1, total, suma)) {
        add('COEX_SUMA_PESOS', `Los pesos por capa suman ${suma.toFixed(regla.decimales)} lb, pero el peso total declarado es ${data.pesoLb} lb. La diferencia excede la tolerancia de ${regla.toleranciaLb} lb por redondeo a cinco decimales. Revisa los pesos; no se corrigen automáticamente.`,
          'CONTRADICCION', { id: 'COEX_SUMA_PESOS', campos: [...regla.campos], seccion: 'capas', resumen: 'Los pesos por capa no suman el peso total.' });
      }
    }
    // Libras de VCI capturadas que ya no coinciden con peso_capa × porcentaje / 100 (peso redondeado a cinco decimales): se conservan y solo se advierte.
    // La capa SIN VCI (0 %) la cubre COEX_EXTERIOR: la misma causa no se reporta dos veces.
    for (const capa of (def.capas ?? []).filter((c) => c.porcentajeVci > 0)) {
      const capturadas = (data[capa.lbKey] ?? '').trim();
      const esperadas = capturadas === '' ? null : calcularLibrasVci(data[capa.pesoKey] ?? '', capa.porcentajeVci, regla.decimales, regla.decimalesVci);
      if (esperadas !== null && !mismaCantidad(capturadas, esperadas, regla.decimalesVci)) {
        add('COEX_VCI', `Las libras de VCI de la ${capa.etiqueta.toLowerCase()} (${capturadas}) no coinciden con el cálculo esperado (${esperadas} lb = peso de la capa × ${capa.porcentajeVci}%). Se conserva el valor capturado; usa «Restaurar» para volver al cálculo.`,
          'CONTRADICCION', { campos: [capa.lbKey], seccion: 'capas' });
      }
    }
  }
  for (const campo of ['descripcion', 'etiqueta'] as const) {
    const valor = data[campo] ?? '';
    if (valor.length > 180 || /\S{60}/.test(valor)) {
      const nombre = campo === 'descripcion' ? 'La descripción' : 'La etiqueta';
      add('TEXTO_EXTENSO', `${nombre} contiene texto extenso: revisa la hoja ampliada y la paginación antes de la demostración. El texto se conserva íntegro; no se reducen los dibujos.`, 'PENDIENTE', { campos: [campo], afectaVistaPrevia: true, reconocible: true, resumen: `${nombre} es extensa: revisa la hoja ampliada.` });
    }
  }
  const seleccionada = context?.composicionSeleccionada ?? data.composicion ?? '';
  if (seleccionada && !def.composiciones.includes(seleccionada as never)) add('COMPOSICION_FAMILIA', `La composición ${seleccionada} no es compatible con ${def.nombre}${def.composicionFija ? `: el formato imprime ${def.composicionFija}` : ''}.`, 'CONTRADICCION', { campos: ['composicion'], seccion: 'composicion' });
  if (def.capas && data.lbVciExterior && Number(data.lbVciExterior.replace(',', '.')) !== 0) add('COEX_EXTERIOR', 'La capa exterior es SIN VCI, pero se capturaron libras de VCI distintas de cero.', 'CONTRADICCION', { campos: ['lbVciExterior'], seccion: 'capas' });
  if (!context) return avisos;
  const r = interpretarProductoBind({ ID: 'borrador', Code: context.code, Title: context.title, Description: context.description ?? null });
  const sug = sugerirEspecificacion(r);
  // UNA sola decisión sobre la interpretación dimensional (en lugar de varios avisos): una bolsa con tres medidas se lee como Ancho × Fuelle total × Largo y el fuelle total se reparte en dos mitades. Esa convención
  // aún no está validada por Manufactura y las mitades son DERIVADAS (no datos explícitos de BIND), así que la revisión no puede darla por confirmada en silencio: hasta que el usuario la reconozca (con estos
  // mismos valores) la finalización queda bloqueada, como cualquier contradicción. Si cambia alguna de las medidas, el reconocimiento deja de valer.
  if (def.fuelles && r.campos.fuelleTotal.valor !== null) {
    const tres = (texto: string): string[] => cadenasDeMedidas(normalizarTitulo(texto)).filter((c) => c.split(/\s*X\s*/).length === 3);
    const expresiones = [...new Set([...tres(context.title), ...tres(context.description ?? '')])];
    const varias = expresiones.length > 1;
    add('INTERPRETACION_DIMENSIONAL',
      `Interpretación dimensional por confirmar: ${expresiones.length > 0 ? `las medidas de BIND («${expresiones.join('» y «')}»)` : 'las tres medidas de BIND'} se leyeron como Ancho × Fuelle total × Largo y los fuelles derecho e izquierdo son la mitad del fuelle total (derivados, no datos explícitos). `
      + `Esa convención aún no está validada por Manufactura.${varias ? ' BIND expresa las medidas de más de una forma: compáralas, el sistema no convierte unidades.' : ''} Revisa las medidas y los fuelles y reconoce la interpretación para finalizar.`,
      'CONTRADICCION', { id: 'INTERPRETACION_DIMENSIONAL', campos: ['ancho', 'fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo', 'largo', 'unidadDimensiones'], seccion: 'medidas', resumen: 'Confirma la interpretación dimensional (Ancho × Fuelle × Largo).', origen: 'TITLE' });
  }
  const colores = coloresExplicitos(context.title);
  const variante = def.variantes?.find((v) => v.valor === data.coexVariante);
  const preset = def.colores.find((c) => c.hex.toLowerCase() === data.colorHex?.toLowerCase());
  const colorHoja = variante?.colorTexto ?? preset?.nombre ?? data.colorNombre ?? '';
  // Bolsa Natural sugiere NATURAL: si BIND declara otro color en el Title (aunque sin la palabra COLOR) la diferencia tampoco se oculta. Misma causa e id que COLOR_<color>.
  const colorBind = def.colorSugerido === 'NATURAL' && sug.color.regla === 'COLOR_EXPLICITO_EN_TITULO' && sug.color.detectado && sug.color.detectado !== 'NATURAL' ? sug.color.detectado : null;
  for (const color of colorBind && !colores.includes(colorBind) ? [...colores, colorBind] : colores) {
    if (colorHoja && color === colorBind && new RegExp(`\\b${color}\\b`).test(normalizarTitulo(colorHoja))) {
      add(`COLOR_${color}`, `BIND indica color ${color}, pero ${def.nombre} sugiere NATURAL. Se conserva el color de BIND en la hoja; corrígelo o revisa expresamente la diferencia para este borrador.`,
        'CONTRADICCION', { campos: ['colorPreset'], seccion: 'color', origen: 'TITLE', resumen: `${def.nombre} sugiere NATURAL y BIND indica ${color}.` });
    } else if (colorHoja && !new RegExp(`\\b${color}\\b`).test(normalizarTitulo(colorHoja))) {
      add(`COLOR_${color}`, `BIND menciona COLOR ${color}, pero la hoja utiliza ${colorHoja}. La descripción y la etiqueta se conservan; corrige el color o revisa expresamente la diferencia para este borrador.`,
        'CONTRADICCION', { campos: [def.variantes?.length ? 'coexVariante' : 'colorPreset'], seccion: 'color', origen: 'TITLE', resumen: `El color de la hoja no coincide con el COLOR ${color} de BIND.` });
    }
  }
  if (variante && data.colorNombre && normalizarTitulo(data.colorNombre) !== variante.colorTexto) add('COLOR_VARIANTE', `La variante ${variante.etiqueta} utiliza ${variante.colorTexto}, pero el texto del color dice ${data.colorNombre}.`, 'CONTRADICCION', { campos: ['colorNombre'], seccion: 'color' });
  // Title ↔ Code: la misma causa la reporta el interpretador de BIND con el mismo id (TITLE_CODE:…): se cuenta una sola vez.
  for (const campo of ['resina', 'material'] as const) {
    const c = r.campos[campo];
    const clave = campo === 'resina' ? 'composicion' : 'material';
    const extra: Extra = { campos: campo === 'resina' ? ['composicion'] : [], seccion: campo === 'resina' ? 'composicion' : 'bind', origen: 'CONCILIACION' };
    if (c.procedencia === 'CONTRADICCION') add('TITLE_CODE', c.nota ?? `Title y Code contradicen ${campo}.`, 'CONTRADICCION', { ...extra, id: `TITLE_CODE:${clave}` });
    else if (c.procedencia === 'TITLE_Y_CODE') add('CORROBORADO', `Title y Code corroboran ${campo}: ${c.valor}.`, 'INFORMACION', { ...extra, id: `CORROBORADO:${clave}` });
  }
  const resina = r.campos.resina.valor;
  const efectiva = def.composicionFija ?? seleccionada;
  if (resina === 'ESD' || resina === 'XOW') add('RESINA_SIN_CASILLA', `BIND indica ${resina}, sin composición compatible en ${def.nombre}. Requiere revisión técnica expresa.`, 'PENDIENTE', { id: 'RESINA_SIN_CASILLA:composicion', campos: ['composicion'], seccion: 'composicion', origen: 'BIND' });
  else if (resina && efectiva && resina !== efectiva) add('COMPOSICION_BIND', `BIND indica composición ${resina}, pero ${def.nombre} utiliza ${efectiva}. No se sobrescribe la corrección del usuario.`, 'CONTRADICCION', { campos: ['composicion'], seccion: 'composicion', origen: 'BIND' });
  const incompatible = sug.familia.incompatibles.find((i) => i.familia === family);
  if (incompatible) add('FAMILIA_INCOMPATIBLE', `${def.nombre} no coincide con BIND: ${incompatible.motivo}`, 'CONTRADICCION', { seccion: 'familia', origen: 'BIND' });
  if (def.fuelles && data.fuelleTotal) {
    const total = Number(data.fuelleTotal.replace(',', '.'));
    const suma = Number(data.fuelleDerecho?.replace(',', '.')) + Number(data.fuelleIzquierdo?.replace(',', '.'));
    if (Number.isFinite(total) && Number.isFinite(suma) && Math.abs(total - suma) > 0.0001) add('FUELLE_TOTAL', `El fuelle total (${data.fuelleTotal}) no coincide con la suma de los fuelles derecho e izquierdo (${suma}).`, 'CONTRADICCION', { id: 'FUELLE_TOTAL', campos: ['fuelleTotal', 'fuelleDerecho', 'fuelleIzquierdo'], seccion: 'medidas' });
  }
  return avisos;
}
