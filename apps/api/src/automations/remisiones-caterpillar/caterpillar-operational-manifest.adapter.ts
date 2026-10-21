import { buildCaterpillarOperationalManifest, type NormalizedCaterpillarLine } from './caterpillar-operational-manifest';

const textFields = [
  'cliente_grupo', 'planta_codigo', 'subplanta_codigo', 'cliente', 'rfc', 'fecha_entrega',
  'codigo', 'numero_parte', 'orden_compra', 'unidad_remision'
] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const owns = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

// Accept n8n's `salida` items BEFORE agruparTorreonPorOC, not Excel rows or grouped output.
// Project only the V1 contract: never parse display quantities, infer fields or flatten articulos.
export function adaptCaterpillarNormalizedItems(input: unknown) {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Expected non-empty pre-grouping n8n items');
  const lines = Array.from(input, (item: unknown, index): NormalizedCaterpillarLine => {
    if (!record(item) || !owns(item, 'json') || !record(item.json)) throw new Error(`Invalid normalized item at index ${index}`);
    const data = item.json;
    if (owns(data, 'articulos') || owns(data, 'total_articulos_torreon') ||
      (owns(data, 'es_remision_torreon_agrupada') && data.es_remision_torreon_agrupada !== false)) {
      throw new Error(`Grouped or ambiguous Torreon item at index ${index}; provide pre-grouping salida`);
    }
    const fields = {} as Pick<NormalizedCaterpillarLine, typeof textFields[number]>;
    for (const key of textFields) {
      if (!owns(data, key) || typeof data[key] !== 'string') throw new Error(`Missing or invalid ${key} at index ${index}`);
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
    deliveryIdentity: 'UNCONFIRMED' as const
  };
}
