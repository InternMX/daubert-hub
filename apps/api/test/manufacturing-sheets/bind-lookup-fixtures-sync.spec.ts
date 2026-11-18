import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BindProductsService } from '../../src/manufacturing-sheets/bind/bind-products.service';

// El frontend prueba su formulario (prellenado desde BIND) con respuestas REALES del backend guardadas en apps/web/src/test/bindLookups.fixture.json. Esta prueba impide que se desincronicen:
// si cambia una regla del intérprete, falla hasta regenerar la copia a propósito (UPDATE_BIND_FIXTURES=1 npx vitest run test/manufacturing-sheets/bind-lookup-fixtures-sync.spec.ts).
const FIXTURE = resolve(__dirname, '../../../web/src/test/bindLookups.fixture.json');
const base = { ID: 'fixture', CreationDate: '2026-01-01T00:00:00Z' };
const MUESTRAS: Record<string, { Code: string; Title: string; Description: string | null; Weight: number | null }> = {
  DANFPMGOC04: { Code: 'DANFPMGOC04', Title: 'GPN034000021 BOLSA VCI PMG 69 x 43 x 66 cm (27 x 17 x 26.4") (MINI)', Description: 'Bolsa PMG 27 x 17 x 26.4" CAL. 200 PAQUETE 200/B', Weight: 0.155 },
  BOLSA_PLANA_SOLO_DESCRIPTION: { Code: 'XXXFPMG01', Title: 'BOLSA VCI PMG', Description: 'PAQUETE C/100 BOLSAS CAL. 3 MIL 20 X 30 IN', Weight: 0.05 },
  HOJAS_SOLO_DESCRIPTION: { Code: 'HOJFPMG01', Title: 'HOJA VCI PMG', Description: 'PAQUETE C/100 HOJAS CAL. 3 MIL 40 X 40 IN', Weight: 0.2 },
  ROLLO_CONTINUO_CON_ETIQUETAS: { Code: 'ROCFPMG01', Title: 'ROLLO CONTINUO VCI PMG CAL. 3 MIL', Description: 'ANCHO 40 IN LARGO 100 IN', Weight: 5 },
  CONTRADICCION_TITLE_DESCRIPTION: { Code: 'CCCFPMG01', Title: 'BOLSA PMG 20 X 30 IN CAL. 3 MIL PAQUETE C/100 BOLSAS', Description: 'Bolsa PMG 25 x 35 IN CAL. 2 MIL PAQUETE C/200 BOLSAS', Weight: 0.05 },
  SIN_DESCRIPTION_CON_DOS_SISTEMAS: { Code: 'FFFFPMG01', Title: 'BOLSA VCI PMG 69 x 43 x 66 cm (27 x 17 x 26.4")', Description: null, Weight: 0.1 }
};

function respuesta(m: (typeof MUESTRAS)[string]): unknown {
  const servicio = Object.create(BindProductsService.prototype) as unknown as { fromProducts: (p: unknown[]) => { data: unknown } };
  return JSON.parse(JSON.stringify(servicio.fromProducts([{ ...base, ...m }]).data));
}

describe('fixtures del frontend sincronizadas con el intérprete real', () => {
  it('bindLookups.fixture.json coincide con la salida actual del backend para las muestras', () => {
    const actual = Object.fromEntries(Object.entries(MUESTRAS).map(([k, m]) => [k, respuesta(m)]));
    if (process.env.UPDATE_BIND_FIXTURES === '1') writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(actual);
  });
});
