import { interpretarProductoBind } from '../bind-product-interpreter/bind-product-interpreter';
import { sugerirEspecificacion } from '../bind-product-interpreter/specification-suggestions';
import { normalizarTitulo } from '../bind-product-interpreter/title-parser';
import { FAMILIAS, type FamilyCode } from './family-registry';
import type { PreviewFormData } from './sheet-data.mapper';

export interface BindReviewContext {
  title: string;
  code: string;
  composicionSeleccionada?: string;
}

export interface TechnicalNotice {
  id: string;
  nivel: 'INFORMACION' | 'PENDIENTE' | 'CONTRADICCION' | 'ERROR';
  mensaje: string;
}

// Solo una declaración COLOR/COLOR: o COLOR= constituye evidencia para una contradicción.
// No se toman nombres sueltos de marcas, clientes ni «Natural» como color del producto.
export function coloresExplicitos(title: string): string[] {
  const t = normalizarTitulo(title);
  const aliases: Record<string, string> = { BLUE: 'AZUL', GREEN: 'VERDE', RED: 'ROJO', BLACK: 'NEGRO', WHITE: 'BLANCO', YELLOW: 'AMARILLO', CLEAR: 'TRANSPARENTE' };
  return [...new Set([...t.matchAll(/\bCOLOR\s*[:=]?\s*(AZUL|VERDE|ROJO|NEGRO|BLANCO|AMARILLO|TRANSPARENTE|NATURAL|BLUE|GREEN|RED|BLACK|WHITE|YELLOW|CLEAR)\b/g)].map((m) => aliases[m[1]!] ?? m[1]!))];
}

export function revisarCoherencia(family: FamilyCode, data: PreviewFormData, context?: BindReviewContext): TechnicalNotice[] {
  const def = FAMILIAS[family];
  const avisos: TechnicalNotice[] = [];
  const add = (id: string, mensaje: string, nivel: TechnicalNotice['nivel'] = 'CONTRADICCION'): void => { avisos.push({ id, nivel, mensaje }); };
  const seleccionada = context?.composicionSeleccionada ?? data.composicion ?? '';
  if (seleccionada && !def.composiciones.includes(seleccionada as never)) add('COMPOSICION_FAMILIA', `La composición ${seleccionada} no es compatible con ${def.nombre}${def.composicionFija ? `: el formato imprime ${def.composicionFija}` : ''}.`);
  if (def.capas && data.lbVciExterior && Number(data.lbVciExterior.replace(',', '.')) !== 0) add('COEX_EXTERIOR', 'La capa exterior es SIN VCI, pero se capturaron libras de VCI distintas de cero.');
  if (!context) return avisos;
  const r = interpretarProductoBind({ ID: 'borrador', Code: context.code, Title: context.title });
  const sug = sugerirEspecificacion(r);
  if (def.fuelles && r.campos.fuelleTotal.valor !== null && !data.fuelleTotal) add('CONFIRMAR_FUELLE_TOTAL', 'Falta confirmar el fuelle total sugerido por las tres medidas de BIND.', 'PENDIENTE');
  const colores = coloresExplicitos(context.title);
  const variante = def.variantes?.find((v) => v.valor === data.coexVariante);
  const preset = def.colores.find((c) => c.hex.toLowerCase() === data.colorHex?.toLowerCase());
  const colorHoja = variante?.colorTexto ?? preset?.nombre ?? data.colorNombre ?? '';
  for (const color of colores) {
    if (colorHoja && !new RegExp(`\\b${color}\\b`).test(normalizarTitulo(colorHoja))) add(`COLOR_${color}`, `BIND menciona COLOR ${color}, pero la hoja utiliza ${colorHoja}. La descripción y la etiqueta se conservan; corrige el color o revisa expresamente la diferencia para este borrador.`);
  }
  if (variante && data.colorNombre && normalizarTitulo(data.colorNombre) !== variante.colorTexto) add('COLOR_VARIANTE', `La variante ${variante.etiqueta} utiliza ${variante.colorTexto}, pero el texto del color dice ${data.colorNombre}.`);
  for (const campo of ['resina', 'material'] as const) {
    const c = r.campos[campo];
    if (c.procedencia === 'CONTRADICCION') add(`TITLE_CODE_${campo}`, c.nota ?? `Title y Code contradicen ${campo}.`);
    else if (c.procedencia === 'TITLE_Y_CODE') add(`CORROBORADO_${campo}`, `Title y Code corroboran ${campo}: ${c.valor}.`, 'INFORMACION');
  }
  const resina = r.campos.resina.valor;
  const efectiva = def.composicionFija ?? seleccionada;
  if (resina === 'ESD' || resina === 'XOW') add('RESINA_SIN_COMPOSICION', `BIND indica ${resina}, sin composición compatible en ${def.nombre}. Requiere revisión técnica expresa.`);
  else if (resina && efectiva && resina !== efectiva) add('COMPOSICION_BIND', `BIND indica composición ${resina}, pero ${def.nombre} utiliza ${efectiva}. No se sobrescribe la corrección del usuario.`);
  const incompatible = sug.familia.incompatibles.find((i) => i.familia === family);
  if (incompatible) add('FAMILIA_BIND', `${def.nombre} no coincide con BIND: ${incompatible.motivo}`);
  if (def.fuelles && data.fuelleTotal) {
    const total = Number(data.fuelleTotal.replace(',', '.'));
    const suma = Number(data.fuelleDerecho?.replace(',', '.')) + Number(data.fuelleIzquierdo?.replace(',', '.'));
    if (Number.isFinite(total) && Number.isFinite(suma) && Math.abs(total - suma) > 0.0001) add('FUELLE_TOTAL', `El fuelle total (${data.fuelleTotal}) no coincide con la suma de los fuelles derecho e izquierdo (${suma}).`);
  }
  return avisos;
}
