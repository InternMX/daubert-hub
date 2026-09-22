import { describe, expect, it } from 'vitest';
import { caterpillarProcessLabel } from '../src/automations/remisiones-caterpillar/caterpillar-process-labels';

describe('caterpillarProcessLabel', () => {
  it.each([
    ['CATERPILLAR_P2|P2|', 'P2'],
    ['CAT_P3_P4_P5_P6|P3|', 'P3'],
    ['CAT_P3_P4_P5_P6|P4|', 'P4'],
    ['CAT_P3_P4_P5_P6|P5|', 'P5'],
    ['CAT_P3_P4_P5_P6|P6|', 'P6'],
    ['CAT_NUEVO_LAREDO|NUEVO_LAREDO|FINSA_1', 'Nuevo Laredo FINSA 1'],
    ['CAT_NUEVO_LAREDO|NUEVO_LAREDO|FINSA_3', 'Nuevo Laredo FINSA 3'],
    ['CAT_TORREON|TORREON|', 'Torreón'],
    ['CAT_TORREON|TORREON|PLANTA_2', 'Torreón Planta 2']
  ])('translates the exact known key %s to %s', (key, label) => {
    expect(caterpillarProcessLabel(key)).toBe(label);
  });

  it('falls back to the raw key for an unrecognized llave_proceso, never dropping or crashing', () => {
    expect(caterpillarProcessLabel('SOME_FUTURE_PLANT|X|')).toBe('SOME_FUTURE_PLANT|X|');
  });
});
