import { describe, expect, it } from 'vitest';
import { CAPAS_COEX, FAMILIAS } from '../src/manufacturing-sheets/preview/family-registry';
import { revisarCoherencia } from '../src/manufacturing-sheets/preview/technical-coherence';
import { calcularLibrasVci, escalarDecimal, mismaCantidad } from '../src/manufacturing-sheets/preview/vci-calculation';

// libras_vci_capa = peso_capa_lb × (porcentaje_vci / 100); peso a 5 decimales, VCI a 6; aritmética decimal exacta.
describe('cálculo de libras de VCI por capa', () => {
  it('los porcentajes de las capas salen del registro: 4 %, 2 % y SIN VCI', () => {
    expect(CAPAS_COEX.map((c) => [c.id, c.porcentajeVci])).toEqual([['interior', 4], ['intermedia', 2], ['exterior', 0]]);
    expect(FAMILIAS.COEX.pesosCapasRegla?.decimalesVci).toBe(6);
  });

  it.each([
    ['COEX Azul 0.3929', '0.13097', ['0.005239', '0.002619', '0.000000']],
    ['COEX Verde 0.7540', '0.25133', ['0.010053', '0.005027', '0.000000']]
  ])('ejemplo obligatorio %s', (_n, peso, esperado) => {
    expect(CAPAS_COEX.map((c) => calcularLibrasVci(peso, c.porcentajeVci))).toEqual(esperado);
  });

  it.each([
    ['0.130965', 4, '0.005239'], ['0.130964', 4, '0.005238'], ['1.005', 50, '0.502500'], ['0.07', 50, '0.035000'], ['0,25133', 4, '0.010053'],
    ['0.00001', 50, '0.000005'], ['0.00001', 60, '0.000006'], ['0.00001', 4, '0.000000']
  ])('%s lb × %s%% = %s (half-up decimal exacto)', (peso, pct, esperado) => expect(calcularLibrasVci(peso, pct)).toBe(esperado));

  it.each(['', ' ', '0', '0.000001', '-1', 'abc', '1e3', 'Infinity', 'NaN', '1..2'])('el peso «%s» no genera un resultado', (peso) => expect(calcularLibrasVci(peso, 4)).toBeNull());
  it('porcentajes inválidos no generan un resultado', () => {
    expect(calcularLibrasVci('0.13097', -1)).toBeNull();
    expect(calcularLibrasVci('0.13097', Number.NaN)).toBeNull();
  });

  it('comparación decimal exacta', () => {
    expect(escalarDecimal('0.0052390', 6)).toBe(5239);
    expect(mismaCantidad('0', '0.000000', 6)).toBe(true);
    expect(mismaCantidad('0.006', '0.005239', 6)).toBe(false);
    expect(mismaCantidad('abc', '0.005239', 6)).toBe(false);
  });
});

describe('aviso técnico: libras de VCI que no coinciden con el cálculo', () => {
  const base = { coexVariante: 'AZUL', pesoLb: '0.3929', pesoCapaInterior: '0.13097', pesoCapaIntermedia: '0.13097', pesoCapaExterior: '0.13097' };
  const ids = (extra: Record<string, string>): string[] => revisarCoherencia('COEX', { ...base, ...extra }).map((a) => a.id);

  it('no avisa con los valores calculados', () => expect(ids({ lbVciInterior: '0.005239', lbVciIntermedia: '0.002619', lbVciExterior: '0.000000' }).filter((i) => i.startsWith('COEX_VCI'))).toEqual([]));
  it('no avisa por formato equivalente (0, 0.0052390)', () => expect(ids({ lbVciInterior: '0.0052390', lbVciExterior: '0' }).filter((i) => i.startsWith('COEX_VCI'))).toEqual([]));
  it('avisa y conserva el valor capturado por capa', () => {
    const avisos = revisarCoherencia('COEX', { ...base, lbVciInterior: '0.006', lbVciIntermedia: '0.002619', lbVciExterior: '0.1' });
    expect(avisos.filter((a) => a.codigo === 'COEX_VCI').map((a) => a.id)).toEqual(['COEX_VCI:lbVciInterior']);
    expect(avisos.filter((a) => a.codigo === 'COEX_EXTERIOR')).toHaveLength(1);                  // la capa SIN VCI la cubre COEX_EXTERIOR: una sola incidencia
    expect(avisos.find((a) => a.id === 'COEX_VCI:lbVciInterior')?.mensaje).toMatch(/\(0\.006\).*\(0\.005239 lb/);
  });
  it('no avisa sin peso de capa válido ni sin libras capturadas', () => {
    expect(ids({ pesoCapaInterior: '', lbVciInterior: '0.006' }).filter((i) => i === 'COEX_VCI:lbVciInterior')).toEqual([]);
    expect(ids({ lbVciInterior: '' }).filter((i) => i.startsWith('COEX_VCI'))).toEqual([]);
  });
  it('solo aplica a las variantes autorizadas', () => expect(ids({ coexVariante: '', lbVciInterior: '0.006' }).filter((i) => i.startsWith('COEX_VCI'))).toEqual([]));
});
