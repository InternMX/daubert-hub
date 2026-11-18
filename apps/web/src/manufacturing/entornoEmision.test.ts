import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fijarEntornoEmision, useEntornoEmision } from './entornoEmision';

describe('entorno de emisión de Manufactura (rótulos PRUEBA / PRODUCCIÓN)', () => {
  afterEach(() => { act(() => fijarEntornoEmision('PRUEBA')); });

  it('por omisión (y mientras el servidor no responda) asume PRUEBA, el rótulo más cauteloso', () => {
    const { result } = renderHook(() => useEntornoEmision());
    expect(result.current).toEqual({ entorno: 'PRUEBA', esPrueba: true, texto: 'PRUEBA' });
  });

  it('adopta PRODUCCIÓN cuando el servidor lo informa y vuelve a PRUEBA ante un valor desconocido', () => {
    const { result } = renderHook(() => useEntornoEmision());
    act(() => fijarEntornoEmision('PRODUCCION'));
    expect(result.current).toEqual({ entorno: 'PRODUCCION', esPrueba: false, texto: 'PRODUCCIÓN' });
    act(() => fijarEntornoEmision(undefined));
    expect(result.current.esPrueba).toBe(true);
  });
});
