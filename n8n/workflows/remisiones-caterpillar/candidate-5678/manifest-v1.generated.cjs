// GENERATED from unchanged V1 TypeScript sources. Do not edit by hand.
// Source SHA-256: {"caterpillar-operational-manifest.ts":"d417b7f4723276fd4bb82ec4cfa1813d343848521e1b56c8adb8315a02ed3c49","caterpillar-operational-manifest.adapter.ts":"4c3a7fe68b6cdadff6efdc69c26dadc6ba04d943d25b73a158e23c8b671fb9b8"}
function createCaterpillarManifestV1() {
const exports = {};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATERPILLAR_MANIFEST_VERSION = void 0;
exports.buildCaterpillarOperationalManifest = buildCaterpillarOperationalManifest;
exports.compareCaterpillarOperationalContent = compareCaterpillarOperationalContent;
exports.adaptCaterpillarNormalizedItems = adaptCaterpillarNormalizedItems;
exports.CATERPILLAR_MANIFEST_VERSION = 'CAT_OPERATIONAL_CONTENT_V1';
const text = (value) => {
    if (typeof value !== 'string')
        throw new Error('Expected normalized text');
    return value.trim();
};
const required = (value) => {
    const result = text(value);
    if (!result)
        throw new Error('Missing normalized operational field');
    return result;
};
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function dateOnly(value) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(required(value));
    if (!match)
        throw new Error('Expected effective F4 date as DD/MM/YYYY');
    const [, dd, mm, yyyy] = match;
    const year = Number(yyyy), month = Number(mm), day = Number(dd);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1])
        throw new Error('Invalid effective date');
    return `${yyyy}-${mm}-${dd}`;
}
function buildCaterpillarOperationalManifest(input) {
    if (!input.length)
        throw new Error('No normalized lines');
    const first = input[0];
    const scopeOf = (line) => [required(line.cliente_grupo), required(line.planta_codigo), text(line.subplanta_codigo), required(line.cliente), text(line.rfc)];
    const scope = scopeOf(first);
    const deliveryDate = dateOnly(first.fecha_entrega);
    const grouping = scope[0] === 'CAT_TORREON' ? 'POR_OC' : 'POR_ARTICULO';
    const documents = [];
    for (const line of input) {
        if (line.es_remision_torreon_agrupada)
            throw new Error('Grouped Torreon loses product/part/quantity provenance; provide pre-grouping salida');
        if (JSON.stringify(scopeOf(line)) !== JSON.stringify(scope) || dateOnly(line.fecha_entrega) !== deliveryDate)
            throw new Error('Mixed scope or delivery dates');
        if (typeof line.cantidad_numerica !== 'number' || !Number.isFinite(line.cantidad_numerica) || line.cantidad_numerica <= 0)
            throw new Error('Expected positive normalized numeric quantity');
        // Codes use the pipeline rule; OC and part only trim. Do NOT strip punctuation/leading zeros,
        // case-fold references, reparse localized quantities, aggregate or deduplicate repeated rows.
        const code = required(line.codigo).toUpperCase().replace(/\s+/g, '');
        const unit = required(line.unidad_remision);
        if (!['BOLSAS', 'HOJAS', 'ROLLOS', 'PAQUETES', 'PIEZAS'].includes(unit))
            throw new Error('Expected canonical pipeline unit');
        const purchaseOrder = required(line.orden_compra);
        const tuple = [code, text(line.numero_parte), purchaseOrder, line.cantidad_numerica, unit];
        let document = grouping === 'POR_OC' ? documents.find((item) => item.purchaseOrder === purchaseOrder) : undefined;
        if (!document) {
            document = { purchaseOrder, lines: [] };
            documents.push(document);
        }
        document.lines.push(tuple);
    }
    for (const document of documents)
        document.lines.sort((a, b) => lexical(JSON.stringify(a), JSON.stringify(b)));
    documents.sort((a, b) => lexical(JSON.stringify(a), JSON.stringify(b)));
    return { version: exports.CATERPILLAR_MANIFEST_VERSION, scope, deliveryDate, grouping, documents };
}
function compareCaterpillarOperationalContent(left, right) {
    return {
        contentEquivalent: JSON.stringify(buildCaterpillarOperationalManifest(left)) === JSON.stringify(buildCaterpillarOperationalManifest(right)),
        // Equality is NOT proof that both manifests describe the same delivery obligation.
        deliveryIdentity: 'UNCONFIRMED'
    };
}
const textFields = [
    'cliente_grupo', 'planta_codigo', 'subplanta_codigo', 'cliente', 'rfc', 'fecha_entrega',
    'codigo', 'numero_parte', 'orden_compra', 'unidad_remision'
];
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
// Accept n8n's `salida` items BEFORE agruparTorreonPorOC, not Excel rows or grouped output.
// Project only the V1 contract: never parse display quantities, infer fields or flatten articulos.
function adaptCaterpillarNormalizedItems(input) {
    if (!Array.isArray(input) || input.length === 0)
        throw new Error('Expected non-empty pre-grouping n8n items');
    const lines = Array.from(input, (item, index) => {
        if (!record(item) || !owns(item, 'json') || !record(item.json))
            throw new Error(`Invalid normalized item at index ${index}`);
        const data = item.json;
        if (owns(data, 'articulos') || owns(data, 'total_articulos_torreon') ||
            (owns(data, 'es_remision_torreon_agrupada') && data.es_remision_torreon_agrupada !== false)) {
            throw new Error(`Grouped or ambiguous Torreon item at index ${index}; provide pre-grouping salida`);
        }
        const fields = {};
        for (const key of textFields) {
            if (!owns(data, key) || typeof data[key] !== 'string')
                throw new Error(`Missing or invalid ${key} at index ${index}`);
            fields[key] = data[key];
        }
        if (!owns(data, 'cantidad_numerica') || typeof data.cantidad_numerica !== 'number') {
            throw new Error(`Missing or invalid cantidad_numerica at index ${index}`);
        }
        return { ...fields, cantidad_numerica: data.cantidad_numerica };
    });
    return {
        manifest: buildCaterpillarOperationalManifest(lines),
        // Content equality cannot establish that two files describe the same delivery obligation.
        deliveryIdentity: 'UNCONFIRMED'
    };
}

return exports;
}
module.exports = { createCaterpillarManifestV1 };
