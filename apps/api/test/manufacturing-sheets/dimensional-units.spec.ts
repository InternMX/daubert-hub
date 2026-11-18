import { describe, expect, it } from 'vitest';
import { interpretarTitulo } from '../../src/manufacturing-sheets/bind-product-interpreter/title-parser';

describe('Unidades literales y orden dimensional conservador', () => {
  it.each([['"', 'IN'], ['IN', 'IN'], ['PULGADAS', 'IN'], ['MM', 'MM'], ['CM', 'CM'], ['CENTÍMETROS', 'CM'], ['M', 'M'], ['MT', 'M'], ['MTS', 'M'], ['METROS', 'M']])('%s se conserva como %s sin reescalar calibre ni medidas', (unidad, valor) => {
    const r = interpretarTitulo(`BOLSA PMG 120 X 2 ${unidad} CAL. 200`);
    expect(r.ancho.valor).toBe(120);
    expect(r.largo.valor).toBe(2);
    expect(r.unidadDimensiones).toMatchObject({ valor, origen: 'EXTRAIDO' });
    expect(r.calibre.valor?.textoLiteral).toBe('200');
  });
  it('fuelle total en centímetros: conserva ancho/total/largo y sugiere mitades', () => {
    const r = interpretarTitulo('BOLSA 120 X 40 X 200 CENTÍMETROS CAL. 3.5 MIL');
    expect([r.ancho.valor, r.fuelleTotal.valor, r.largo.valor, r.fuelleDerecho.valor]).toEqual([120, 40, 200, 20]);
    expect(r.unidadDimensiones.valor).toBe('CM');
    expect(r.calibre.valor?.textoLiteral).toBe('3.5 MIL');
  });
  it.each(['ROLLO CONTINUO', 'TERMOENCOGIBLE'])('%s no presupone orden ni confunde metros con MIL', (tipo) => {
    const ambiguo = interpretarTitulo(`${tipo} 120 CM X 2 MTS CAL. 2 MIL`);
    expect(ambiguo.ancho.valor).toBeNull();
    expect(ambiguo.largo.valor).toBeNull();
    expect(ambiguo.calibre.valor?.textoLiteral).toBe('2 MIL');
    const explicito = interpretarTitulo(`${tipo} LARGO 2 MTS ANCHO 1 METROS CAL. 2 MIL`);
    expect([explicito.ancho.valor, explicito.largo.valor, explicito.unidadDimensiones.valor]).toEqual([1, 2, 'M']);
    const mixto = interpretarTitulo(`${tipo} ANCHO 120 CM LARGO 2 MTS`);
    expect(mixto.ancho.valor).toBeNull();
    expect(mixto.unidadDimensiones.valor).toBeNull();
  });
  it('unidades mezcladas, medidas múltiples y tres dimensiones de hoja quedan pendientes', () => {
    for (const title of ['BOLSA 120 CM X 2 MTS', 'HOJA 1 X 2 X 3 M', 'BOLSA 1 X 2 CM / 3 X 4 CM']) {
      expect(interpretarTitulo(title).ancho.valor).toBeNull();
    }
  });
});
