import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configuracionFamilias } from '../src/manufacturing-sheets/preview/family-registry';

// El frontend prueba su formulario con una COPIA de la configuración del registro (apps/web/src/test/familyConfig.fixture.json). Esta prueba impide que la copia se desfase:
// si cambias el registro, regenera la copia con `UPDATE_FAMILY_FIXTURE=1 npx vitest run test/families-sync.spec.ts`.
const FIXTURE = resolve(__dirname, '../../web/src/test/familyConfig.fixture.json');

describe('configuración de familias: copia usada por las pruebas del frontend', () => {
  it('coincide con el registro del backend', () => {
    const actual = `${JSON.stringify(configuracionFamilias(), null, 2)}\n`;
    if (process.env.UPDATE_FAMILY_FIXTURE === '1') writeFileSync(FIXTURE, actual, 'utf8');
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(actual));
  });
});
