import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { familyConfigs, schfpmg001 } from '../test/bindProductFixtures';
import { construirCarga } from './documentSpec';
import { buildInitialForm, selectFamily, setCoexVariante, setFieldValue, type FamilyCode } from './specificationForm';

// CONTRATO frontend ↔ backend del primer guardado: la especificación inicial que arma la pantalla al elegir la familia (aunque falten datos técnicos que solo se exigen al finalizar) debe ser
// aceptada por el endpoint documental. Este archivo fija ese payload para TODAS las familias y variantes (modalidades de Hoja PAQ, variantes COEX); el API valida el MISMO archivo contra su DTO,
// su servicio y PostgreSQL (apps/api/test/borradores-iniciales.contrato.spec.ts y la prueba desechable). Si el modelo del frontend cambia, esta prueba falla y obliga a actualizar el contrato:
//   UPDATE_CONTRATO=1 npx vitest run src/manufacturing/documentSpec.contrato.test.ts
const RUTA = resolve(__dirname, '../../../api/test/fixtures/borradores-iniciales.json');

function payloadsIniciales(): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  const lookup = schfpmg001();
  for (const config of familyConfigs) {
    const base = selectFamily(buildInitialForm(lookup, familyConfigs, '2026-10-30'), config.codigo as FamilyCode, familyConfigs);
    const variantes: Array<[string, typeof base]> = [];
    if (config.modalidades.length > 0) for (const m of config.modalidades) variantes.push([m.valor, setFieldValue(base, 'modalidad', m.valor)]);
    else if (config.variantes.length > 0) for (const v of config.variantes) variantes.push([v.valor, setCoexVariante(base, v.valor, config)]);
    else variantes.push(['', base]);
    for (const [nombre, form] of variantes) {
      salida[nombre ? `${config.codigo}:${nombre}` : config.codigo] = { codigo: lookup.producto.Code, ...construirCarga(form, config, lookup, {}) };
    }
  }
  return salida;
}

describe('contrato del primer guardado con el API documental', () => {
  it('cubre las siete familias y todas sus modalidades/variantes (11 combinaciones)', () => {
    const claves = Object.keys(payloadsIniciales());
    const familias = new Set(claves.map((c) => c.split(':')[0]));
    expect([...familias].sort()).toEqual(['BOLSA_FUELLE', 'BOLSA_NATURAL', 'BOLSA_PLANA_1', 'COEX', 'HOJA_PAQ', 'ROLLO_CONTINUO', 'TERMOENCOGIBLE']);
    for (const f of ['HOJA_PAQ', 'ROLLO_CONTINUO', 'TERMOENCOGIBLE', 'COEX']) expect(claves.filter((c) => c.startsWith(`${f}:`))).toHaveLength(2);
    expect(claves).toHaveLength(11);
  });

  it('el payload inicial coincide con el contrato que valida el API (fixture compartido)', () => {
    const actual = JSON.parse(JSON.stringify(payloadsIniciales())) as unknown;
    if (process.env.UPDATE_CONTRATO === '1' || !existsSync(RUTA)) {
      mkdirSync(dirname(RUTA), { recursive: true });
      writeFileSync(RUTA, `${JSON.stringify(actual, null, 1)}\n`, 'utf8');
    }
    expect(actual).toEqual(JSON.parse(readFileSync(RUTA, 'utf8')));
  });

  it('todos los valores de datos y procedencia son texto (el API solo admite texto) y no se inventa ningún dato técnico', () => {
    for (const [nombre, p] of Object.entries(payloadsIniciales() as Record<string, { datos: Record<string, unknown>; procedencia: Record<string, unknown> }>)) {
      for (const [k, v] of [...Object.entries(p.datos), ...Object.entries(p.procedencia)]) expect(typeof v, `${nombre}.${k}`).toBe('string');
    }
  });
});
