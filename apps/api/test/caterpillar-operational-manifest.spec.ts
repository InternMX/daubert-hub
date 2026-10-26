import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCaterpillarOperationalManifest as build, compareCaterpillarOperationalContent as compare, type NormalizedCaterpillarLine } from '../src/automations/remisiones-caterpillar/caterpillar-operational-manifest';

const fixtures = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/caterpillar-manifest-v1.json'), 'utf8')) as {
  base: NormalizedCaterpillarLine[];
  canonicalJson: string;
  vectors: Array<{ name: string; patch: Partial<NormalizedCaterpillarLine>; equivalent: boolean }>;
};

describe('Caterpillar operational content V1 (no delivery identity claim)', () => {
  it('matches the language-neutral canonical byte vector', () => {
    expect(JSON.stringify(build(fixtures.base))).toBe(fixtures.canonicalJson);
  });
  it.each(fixtures.vectors)('$name', ({ patch, equivalent }) => {
    expect(compare(fixtures.base, fixtures.base.map((line) => ({ ...line, ...patch })) as NormalizedCaterpillarLine[]))
      .toEqual({ contentEquivalent: equivalent, deliveryIdentity: 'UNCONFIRMED' });
  });
  it('ignores order without mutating the input', () => {
    const original = JSON.stringify(fixtures.base);
    expect(compare(fixtures.base, [...fixtures.base].reverse()).contentEquivalent).toBe(true);
    expect(JSON.stringify(fixtures.base)).toBe(original);
  });
  it('keeps repeated occurrences rather than deduplicating or summing', () => {
    expect(compare(fixtures.base, [...fixtures.base, fixtures.base[0]!]).contentEquivalent).toBe(false);
    expect(build([...fixtures.base, fixtures.base[0]!]).documents).toHaveLength(3);
  });
  it('recognizes partial correction as a content difference', () => {
    const changed = fixtures.base.map((line, i) => i ? line : { ...line, cantidad_numerica: 12 });
    expect(compare(fixtures.base, changed).contentEquivalent).toBe(false);
  });
  it('cannot prove a common obligation for two legitimate deliveries with identical content', () => {
    expect(compare(fixtures.base, structuredClone(fixtures.base))).toEqual({ contentEquivalent: true, deliveryIdentity: 'UNCONFIRMED' });
  });
  it('groups Torreon before losing the raw product occurrences', () => {
    const lines = fixtures.base.map((line) => ({ ...line, cliente_grupo: 'CAT_TORREON', planta_codigo: 'TORREON', orden_compra: '001' }));
    const manifest = build(lines);
    expect(manifest.grouping).toBe('POR_OC');
    expect(manifest.documents).toHaveLength(1);
    expect(manifest.documents[0]?.lines).toHaveLength(2);
    expect(() => build(lines.map((line) => ({ ...line, es_remision_torreon_agrupada: true })))).toThrow(/Grouped Torreon/);
  });
  it.each([0, -1, NaN, Infinity])('rejects non-operational quantity %s', (quantity) => {
    expect(() => build([{ ...fixtures.base[0]!, cantidad_numerica: quantity }])).toThrow();
  });
  it.each(['31/02/2026', '2026-10-20', '29/02/2025'])('rejects ambiguous or invalid effective date %s', (date) => {
    expect(() => build([{ ...fixtures.base[0]!, fecha_entrega: date }])).toThrow();
  });
  it('rejects mixed delivery context and empty input', () => {
    expect(() => build([])).toThrow();
    expect(() => build([fixtures.base[0]!, { ...fixtures.base[1]!, planta_codigo: 'P6' }])).toThrow(/Mixed/);
  });
});
