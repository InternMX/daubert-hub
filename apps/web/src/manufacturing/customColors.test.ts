import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_COLORS_KEY, CUSTOM_COLORS_MAX, idDeColor, leerCatalogo, useCustomColors, validarColor } from './customColors';

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

const guardado = (): unknown => JSON.parse(window.localStorage.getItem(CUSTOM_COLORS_KEY) ?? 'null');

describe('validarColor', () => {
  it('normaliza el nombre (espacios) y el HEX (mayúsculas) y deriva una identidad estable', () => {
    const r = validarColor('  Azul   especial  cliente ', ' #3778c8 ');
    expect(r).toMatchObject({ ok: true, color: { nombre: 'Azul especial cliente', hex: '#3778C8' } });
    expect(validarColor('AZUL ESPECIAL CLIENTE', '#3778C8')).toMatchObject({ ok: true, color: { id: (r as { color: { id: string } }).color.id } });   // mismo color, aunque cambien mayúsculas
    expect(idDeColor('A', '#000000')).not.toBe(idDeColor('A', '#000001'));
  });
  it('los saltos de línea y tabulaciones se normalizan a un espacio (no pasan como caracteres de control)', () => {
    expect(validarColor('AZUL\n\tESPECIAL', '#3778C8')).toMatchObject({ ok: true, color: { nombre: 'AZUL ESPECIAL' } });
  });
  it.each([['', '#3778C8', 'NOMBRE_VACIO'], ['   ', '#3778C8', 'NOMBRE_VACIO'], ['X'.repeat(41), '#3778C8', 'NOMBRE_LARGO'], ['<b>AZUL</b>', '#3778C8', 'NOMBRE_INVALIDO'], ['AZUL\u0007X', '#3778C8', 'NOMBRE_INVALIDO'], ['AZUL', '', 'HEX_INVALIDO'], ['AZUL', '3778C8', 'HEX_INVALIDO'], ['AZUL', '#37C', 'HEX_INVALIDO'], ['AZUL', '#GG78C8', 'HEX_INVALIDO'], ['AZUL', 'rgb(1,2,3)', 'HEX_INVALIDO']])('rechaza «%s» / «%s» → %s', (nombre, hex, error) => {
    expect(validarColor(nombre, hex)).toEqual({ ok: false, error });
  });
});

describe('leerCatalogo (lectura estricta)', () => {
  const guardar = (valor: unknown) => window.localStorage.setItem(CUSTOM_COLORS_KEY, typeof valor === 'string' ? valor : JSON.stringify(valor));
  it('sin datos, con JSON dañado o de otra versión devuelve vacío sin lanzar', () => {
    expect(leerCatalogo()).toEqual([]);
    for (const malo of ['no es json', '{"version":2,"colores":[]}', '{"version":1}', '[]', 'null', '{"version":1,"colores":"x"}']) { guardar(malo); expect(leerCatalogo()).toEqual([]); }
    guardar('x'.repeat(30_000)); expect(leerCatalogo()).toEqual([]);
  });
  it('descarta entradas inválidas, con campos extra de otros datos o duplicadas; no deja pasar nada que no sea nombre + HEX', () => {
    guardar({ version: 1, colores: [
      { nombre: 'AZUL ESPECIAL', hex: '#3778C8', cliente: 'Schneider', token: 'secreto' }, { nombre: 'azul especial', hex: '#3778c8' }, { nombre: '', hex: '#3778C8' }, { nombre: 'X', hex: 'rojo' },
      { nombre: '<script>', hex: '#000000' }, { nombre: 5, hex: '#000000' }, null, 'texto', { nombre: 'VERDE OSCURO', hex: '#006400' }
    ] });
    const lista = leerCatalogo();
    expect(lista.map((c) => [c.nombre, c.hex])).toEqual([['AZUL ESPECIAL', '#3778C8'], ['VERDE OSCURO', '#006400']]);
    expect(Object.keys(lista[0]!).sort()).toEqual(['hex', 'id', 'nombre']);                         // los campos extra nunca llegan a la interfaz
  });
  it('respeta el límite de entradas aunque el almacenamiento traiga más', () => {
    guardar({ version: 1, colores: Array.from({ length: 50 }, (_, i) => ({ nombre: `COLOR ${i}`, hex: `#00${String(i).padStart(2, '0')}00` })) });
    expect(leerCatalogo()).toHaveLength(CUSTOM_COLORS_MAX);
  });
  it('un localStorage que lanza (modo privado, bloqueado) no rompe la lectura', () => {
    expect(leerCatalogo({ getItem: () => { throw new Error('bloqueado'); } })).toEqual([]);
  });
});

describe('useCustomColors', () => {
  it('agrega, persiste SOLO nombre y HEX y los recupera en una instancia nueva (recarga del navegador)', () => {
    const { result } = renderHook(() => useCustomColors());
    let r: ReturnType<typeof result.current.agregar> | undefined;
    act(() => { r = result.current.agregar('AZUL ESPECIAL CLIENTE', '#3778c8'); });
    expect(r).toMatchObject({ ok: true, persistido: true, color: { nombre: 'AZUL ESPECIAL CLIENTE', hex: '#3778C8' } });
    expect(guardado()).toEqual({ version: 1, colores: [{ nombre: 'AZUL ESPECIAL CLIENTE', hex: '#3778C8' }] });          // sin id, cliente, documento ni credenciales
    const recarga = renderHook(() => useCustomColors());
    expect(recarga.result.current.colores.map((c) => c.nombre)).toEqual(['AZUL ESPECIAL CLIENTE']);
  });
  it('no duplica el mismo nombre y HEX (ni con otras mayúsculas) y no confunde nombres distintos con el mismo HEX', () => {
    const { result } = renderHook(() => useCustomColors());
    act(() => { result.current.agregar('AZUL ESPECIAL', '#3778C8'); });
    act(() => { result.current.agregar('azul especial', '#3778c8'); });
    act(() => { result.current.agregar('OTRO NOMBRE', '#3778C8'); });
    act(() => { result.current.agregar('AZUL ESPECIAL', '#3778C9'); });
    expect(result.current.colores.map((c) => `${c.nombre} ${c.hex}`)).toEqual(['AZUL ESPECIAL #3778C8', 'OTRO NOMBRE #3778C8', 'AZUL ESPECIAL #3778C9']);
  });
  it('rechaza nombre vacío y HEX inválido sin guardar nada, y respeta el límite razonable', () => {
    const { result } = renderHook(() => useCustomColors());
    let vacio: unknown; let malo: unknown;
    act(() => { vacio = result.current.agregar('', '#3778C8'); malo = result.current.agregar('AZUL', '#12'); });
    expect(vacio).toEqual({ ok: false, error: 'NOMBRE_VACIO' });
    expect(malo).toEqual({ ok: false, error: 'HEX_INVALIDO' });
    expect(window.localStorage.getItem(CUSTOM_COLORS_KEY)).toBeNull();
    for (let i = 0; i < CUSTOM_COLORS_MAX; i += 1) act(() => { result.current.agregar(`COLOR ${i}`, `#00${String(i).padStart(2, '0')}00`); });
    let exceso: unknown;
    act(() => { exceso = result.current.agregar('UNO MAS', '#FFFFFF'); });
    expect(exceso).toEqual({ ok: false, error: 'LIMITE' });
    expect(result.current.colores).toHaveLength(CUSTOM_COLORS_MAX);
  });
  it('elimina del catálogo local y la eliminación persiste', () => {
    const { result } = renderHook(() => useCustomColors());
    act(() => { result.current.agregar('A', '#111111'); result.current.agregar('B', '#222222'); });
    const id = result.current.colores[0]!.id;
    act(() => { result.current.eliminar(id); });
    expect(result.current.colores.map((c) => c.nombre)).toEqual(['B']);
    expect(renderHook(() => useCustomColors()).result.current.colores.map((c) => c.nombre)).toEqual(['B']);
  });
  it('si el navegador no permite guardar, el color queda disponible en esta sesión y se avisa (persistido = false)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cuota'); });
    const { result } = renderHook(() => useCustomColors());
    let r: ReturnType<typeof result.current.agregar> | undefined;
    act(() => { r = result.current.agregar('AZUL', '#3778C8'); });
    expect(r).toMatchObject({ ok: true, persistido: false });
    act(() => { result.current.agregar('VERDE', '#00B050'); });
    expect(result.current.colores).toHaveLength(2);
  });
});
