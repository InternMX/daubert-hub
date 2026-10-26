// Pure portable contract. No Node/n8n/DB APIs, dates, filesystem, hashing or authorization.
// Input: Normalizar datos CAT's `salida` BEFORE agruparTorreonPorOC (see contract documentation).
export interface NormalizedCaterpillarLine {
  cliente_grupo: string;
  planta_codigo: string;
  subplanta_codigo: string;
  cliente: string;
  rfc: string;
  fecha_entrega: string;
  codigo: string;
  numero_parte: string;
  orden_compra: string;
  cantidad_numerica: number;
  unidad_remision: string;
  es_remision_torreon_agrupada?: boolean;
}

export const CATERPILLAR_MANIFEST_VERSION = 'CAT_OPERATIONAL_CONTENT_V1';
type LineTuple = readonly [code: string, part: string, purchaseOrder: string, quantity: number, unit: string];
export interface CaterpillarOperationalManifest {
  version: typeof CATERPILLAR_MANIFEST_VERSION;
  scope: readonly [clientGroup: string, plant: string, subplant: string, client: string, rfc: string];
  deliveryDate: string;
  grouping: 'POR_ARTICULO' | 'POR_OC';
  documents: Array<{ purchaseOrder: string; lines: LineTuple[] }>;
}
const text = (value: string): string => {
  if (typeof value !== 'string') throw new Error('Expected normalized text');
  return value.trim();
};
const required = (value: string): string => {
  const result = text(value);
  if (!result) throw new Error('Missing normalized operational field');
  return result;
};
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function dateOnly(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(required(value));
  if (!match) throw new Error('Expected effective F4 date as DD/MM/YYYY');
  const [, dd, mm, yyyy] = match;
  const year = Number(yyyy), month = Number(mm), day = Number(dd);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) throw new Error('Invalid effective date');
  return `${yyyy}-${mm}-${dd}`;
}

export function buildCaterpillarOperationalManifest(input: readonly NormalizedCaterpillarLine[]): CaterpillarOperationalManifest {
  if (!input.length) throw new Error('No normalized lines');
  const first = input[0]!;
  const scopeOf = (line: NormalizedCaterpillarLine) => [required(line.cliente_grupo), required(line.planta_codigo), text(line.subplanta_codigo), required(line.cliente), text(line.rfc)] as const;
  const scope = scopeOf(first);
  const deliveryDate = dateOnly(first.fecha_entrega);
  const grouping = scope[0] === 'CAT_TORREON' ? 'POR_OC' : 'POR_ARTICULO';
  const documents: CaterpillarOperationalManifest['documents'] = [];
  for (const line of input) {
    if (line.es_remision_torreon_agrupada) throw new Error('Grouped Torreon loses product/part/quantity provenance; provide pre-grouping salida');
    if (JSON.stringify(scopeOf(line)) !== JSON.stringify(scope) || dateOnly(line.fecha_entrega) !== deliveryDate) throw new Error('Mixed scope or delivery dates');
    if (typeof line.cantidad_numerica !== 'number' || !Number.isFinite(line.cantidad_numerica) || line.cantidad_numerica <= 0) throw new Error('Expected positive normalized numeric quantity');
    // Codes use the pipeline rule; OC and part only trim. Do NOT strip punctuation/leading zeros,
    // case-fold references, reparse localized quantities, aggregate or deduplicate repeated rows.
    const code = required(line.codigo).toUpperCase().replace(/\s+/g, '');
    const unit = required(line.unidad_remision);
    if (!['BOLSAS', 'HOJAS', 'ROLLOS', 'PAQUETES', 'PIEZAS'].includes(unit)) throw new Error('Expected canonical pipeline unit');
    const purchaseOrder = required(line.orden_compra);
    const tuple: LineTuple = [code, text(line.numero_parte), purchaseOrder, line.cantidad_numerica, unit];
    let document = grouping === 'POR_OC' ? documents.find((item) => item.purchaseOrder === purchaseOrder) : undefined;
    if (!document) { document = { purchaseOrder, lines: [] }; documents.push(document); }
    document.lines.push(tuple);
  }
  for (const document of documents) document.lines.sort((a, b) => lexical(JSON.stringify(a), JSON.stringify(b)));
  documents.sort((a, b) => lexical(JSON.stringify(a), JSON.stringify(b)));
  return { version: CATERPILLAR_MANIFEST_VERSION, scope, deliveryDate, grouping, documents };
}

export function compareCaterpillarOperationalContent(left: readonly NormalizedCaterpillarLine[], right: readonly NormalizedCaterpillarLine[]) {
  return {
    contentEquivalent: JSON.stringify(buildCaterpillarOperationalManifest(left)) === JSON.stringify(buildCaterpillarOperationalManifest(right)),
    // Equality is NOT proof that both manifests describe the same delivery obligation.
    deliveryIdentity: 'UNCONFIRMED' as const
  };
}
