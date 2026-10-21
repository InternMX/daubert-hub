import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adaptCaterpillarNormalizedItems as adapt } from '../src/automations/remisiones-caterpillar/caterpillar-operational-manifest.adapter';
import { buildCaterpillarOperationalManifest, type NormalizedCaterpillarLine } from '../src/automations/remisiones-caterpillar/caterpillar-operational-manifest';

type Item = { json: Record<string, unknown> };
const fixtures = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/caterpillar-normalized-items.json'), 'utf8')) as {
  normal: Item[]; torreonBeforeGrouping: Item[]; torreonAfterGrouping: Item[];
};
const patch = (items: Item[], changes: Record<string, unknown>) => items.map(item => ({ json: { ...item.json, ...changes } }));

describe('Caterpillar n8n pre-grouping manifest adapter (pure, synthetic fixtures)', () => {
  it('adapts normal programming through the existing canonicalizer without mutating input', () => {
    const before = JSON.stringify(fixtures.normal);
    const result = adapt(fixtures.normal);
    expect(result.manifest).toEqual(buildCaterpillarOperationalManifest(fixtures.normal.map(item => item.json) as unknown as NormalizedCaterpillarLine[]));
    expect(result).toMatchObject({ deliveryIdentity: 'UNCONFIRMED', manifest: {
      version: 'CAT_OPERATIONAL_CONTENT_V1', scope: ['CAT_P3_P4_P5_P6', 'P5', '', 'Cliente sintético', 'RFC-TEST'],
      deliveryDate: '2026-10-20', grouping: 'POR_ARTICULO', documents: [
        { purchaseOrder: '001-OC', lines: [['ABC', '0007-A', '001-OC', 10, 'PIEZAS']] },
        { purchaseOrder: '002-OC', lines: [['DEF', '0008', '002-OC', 2.5, 'ROLLOS']] }
      ]
    } });
    expect(JSON.stringify(fixtures.normal)).toBe(before);
  });
  it('uses raw normalized Torreon products/parts/quantities/units before grouping by OC', () => {
    expect(adapt(fixtures.torreonBeforeGrouping)).toMatchObject({ deliveryIdentity: 'UNCONFIRMED', manifest: {
      scope: ['CAT_TORREON', 'TORREON_PLANTA2', 'PLANTA2', 'Cliente Torreón sintético', ''], grouping: 'POR_OC',
      documents: [{ purchaseOrder: '00042', lines: [
        ['TOR-A', '0001-A', '00042', 1.234567, 'PIEZAS'], ['TOR-B', '', '00042', 3, 'PAQUETES']
      ] }]
    } });
  });
  it.each(['normal', 'torreonBeforeGrouping'] as const)('preserves repeated occurrences and ignores input order for %s', key => {
    const items = fixtures[key];
    const repeated = [...items, structuredClone(items[0]!)];
    const manifest = adapt(repeated).manifest;
    expect(manifest.documents.flatMap(document => document.lines)).toHaveLength(3);
    expect(manifest).not.toEqual(adapt(items).manifest);
    expect(adapt([...repeated].reverse()).manifest).toEqual(manifest);
  });
  it('ignores file renaming, paths, physical dates and execution metadata without claiming delivery identity', () => {
    expect(adapt(patch(fixtures.normal, { file_name: 'renamed.xlsx', file_path: 'synthetic/renamed.xlsx', output_dir: 'other',
      hash_archivo: 'different-physical-hash', fecha_archivo_iso: '2030-01-01', ejecucion_id: 'different-run', fecha: '01/01/2030' })))
      .toEqual(adapt(fixtures.normal));
  });
  it.each([{ cantidad_numerica: 11 }, { orden_compra: '1-OC' }, { fecha_entrega: '21/10/2026' },
    { numero_parte: '7-A' }, { unidad_remision: 'HOJAS' }])('retains operational content changes %j', changes => {
    expect(adapt(patch(fixtures.normal, changes)).manifest).not.toEqual(adapt(fixtures.normal).manifest);
  });
  it.each(['cliente_grupo', 'planta_codigo', 'subplanta_codigo', 'cliente', 'rfc', 'fecha_entrega', 'codigo',
    'numero_parte', 'orden_compra', 'cantidad_numerica', 'unidad_remision'])('rejects absent %s without deriving defaults', field => {
    const items = structuredClone(fixtures.normal);
    delete items[0]!.json[field];
    expect(() => adapt(items)).toThrow(field);
  });
  it.each([null, {}, [], [null], [{ json: null }], [{ json: [] }], [fixtures.normal[0]!.json]])('rejects malformed envelopes %j', items => {
    expect(() => adapt(items)).toThrow();
  });
  it.each(['10', null, 0, -1, NaN, Infinity])('does not coerce or reconstruct invalid quantity %s from display text', value => {
    expect(() => adapt(patch(fixtures.normal, { cantidad_numerica: value, cantidad_entregar: '10 piezas', cantidad_torreon: '10.0000' }))).toThrow();
  });
  it.each([{ fecha_entrega: '31/02/2026' }, { fecha_entrega: '2026-10-20' }, { orden_compra: '' },
    { cliente: null }, { subplanta_codigo: null }, { unidad_remision: 'PIEZA' }])('delegates canonical validation and rejects incomplete fields %j', changes => {
    expect(() => adapt(patch(fixtures.normal, changes))).toThrow();
  });
  it('rejects mixed scopes or F4 dates rather than partitioning or selecting the first row', () => {
    for (const changes of [{ planta_codigo: 'P6' }, { fecha_entrega: '21/10/2026' }]) {
      expect(() => adapt([fixtures.normal[0], ...patch([fixtures.normal[1]!], changes)])).toThrow(/Mixed/);
    }
  });
  it('rejects grouped Torreon even when the inherited first-row fields look complete', () => {
    expect(() => adapt(fixtures.torreonAfterGrouping)).toThrow(/pre-grouping salida/);
    const stripped = structuredClone(fixtures.torreonAfterGrouping);
    delete stripped[0]!.json.es_remision_torreon_agrupada;
    expect(() => adapt(stripped)).toThrow(/pre-grouping salida/);
    expect(() => adapt(patch(stripped, { es_remision_torreon_agrupada: false }))).toThrow(/pre-grouping salida/);
  });
  it.each([true, 'false', null])('rejects grouped/ambiguous marker %s', marker => {
    expect(() => adapt(patch(fixtures.torreonBeforeGrouping, { es_remision_torreon_agrupada: marker }))).toThrow(/pre-grouping/);
  });
});
