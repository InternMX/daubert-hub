import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listBindRecent, NovedadesApiError, type NovedadProducto, type NovedadesPagina } from '../services/bindRecent';
import { NovedadesCatalogo } from './NovedadesCatalogo';

vi.mock('../services/bindRecent', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/bindRecent')>()), listBindRecent: vi.fn() }));
const listMock = vi.mocked(listBindRecent);

const item = (code: string, over: Partial<NovedadProducto> = {}): NovedadProducto => ({ code, title: `BOLSA VCI PMG ${code}`, fechaAlta: '2026-10-22', familiaSugerida: 'BOLSA_PLANA_1', motivo: 'm', compatibilidad: 'COMPATIBLE', ...over });
const pagina = (items: NovedadProducto[], over: Partial<NovedadesPagina> = {}): NovedadesPagina => ({ items, skip: 0, limit: 30, nextSkip: null, generadoEn: '2026-10-29T18:00:00.000Z', desdeCache: false, ...over });
const sinFamilia = (code: string) => item(code, { familiaSugerida: null, compatibilidad: 'SIN_FAMILIA', fechaAlta: null });
const papel = (code: string) => item(code, { familiaSugerida: null, compatibilidad: 'SIN_PLANTILLA' });

function montar(over: Partial<Parameters<typeof NovedadesCatalogo>[0]> = {}) {
  const onPrepare = vi.fn();
  render(<NovedadesCatalogo familyName={(c) => ({ BOLSA_PLANA_1: 'Bolsa Plana 1', BOLSA_FUELLE: 'Bolsa Fuelle' } as Record<string, string>)[c] ?? c} activeCode={null} onPrepare={onPrepare} {...over} />);
  return { onPrepare, user: userEvent.setup() };
}
const desplegar = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /Novedades del catálogo de BIND/ }));
const codigos = () => screen.queryAllByTestId('novedad-item').map((e) => e.getAttribute('data-code'));

afterEach(() => { vi.clearAllMocks(); });

describe('NovedadesCatalogo', { timeout: 20_000 }, () => {
  it('no consulta BIND hasta que el usuario despliega la sección; al desplegar muestra tres candidatos con familia, fecha y compatibilidad', async () => {
    listMock.mockResolvedValue(pagina([item('A1'), sinFamilia('B1'), item('A2', { familiaSugerida: 'BOLSA_FUELLE', compatibilidad: 'POR_CONFIRMAR' }), item('A3'), item('A4')]));
    const { user } = montar();
    expect(listMock).not.toHaveBeenCalled();
    await desplegar(user);
    await waitFor(() => expect(codigos()).toEqual(['A1', 'A2', 'A3']));                         // solo candidatos con familia, solo tres
    expect(listMock).toHaveBeenCalledWith({ skip: 0, limit: 30, refresh: false }, expect.any(AbortSignal));
    const primero = screen.getAllByTestId('novedad-item')[0]!;
    expect(within(primero).getByTestId('novedad-compatibilidad')).toHaveTextContent('Compatible');
    expect(within(primero).getByTestId('novedad-familia')).toHaveTextContent('Familia sugerida: Bolsa Plana 1');
    expect(within(primero).getByTestId('novedad-fecha')).toHaveTextContent(/22 de octubre de 2026/);
    expect(within(screen.getAllByTestId('novedad-item')[1]!).getByTestId('novedad-compatibilidad')).toHaveTextContent('Por confirmar');
    expect(screen.queryByText(/pendiente de producci[oó]n|sin hoja/i)).not.toBeInTheDocument();      // no se afirma nada sobre el estado de producción
  });

  it('si la primera ventana no completa los tres candidatos consulta la siguiente (acotado), y solo muestra la fecha cuando BIND la entregó', async () => {
    listMock.mockResolvedValueOnce(pagina([item('A1'), sinFamilia('B1')], { nextSkip: 30 })).mockResolvedValueOnce(pagina([item('A2', { fechaAlta: null }), item('A3')], { skip: 30 }));
    const { user } = montar();
    await desplegar(user);
    await waitFor(() => expect(codigos()).toEqual(['A1', 'A2', 'A3']));
    expect(listMock.mock.calls.map((c) => c[0])).toEqual([{ skip: 0, limit: 30, refresh: false }, { skip: 30, limit: 30, refresh: false }]);
    expect(screen.getAllByTestId('novedad-fecha')).toHaveLength(2);                                  // A2 no tiene fecha confiable
  });

  it('«Ver más» amplía la vista; los productos sin familia o sin plantilla solo aparecen si se piden; «Consultar más novedades» pide la página siguiente', async () => {
    listMock.mockResolvedValueOnce(pagina([item('A1'), item('A2'), item('A3'), item('A4'), sinFamilia('B1'), papel('P1')], { nextSkip: 30 })).mockResolvedValueOnce(pagina([item('A5')], { skip: 30 }));
    const { user } = montar();
    await desplegar(user);
    await waitFor(() => expect(codigos()).toEqual(['A1', 'A2', 'A3']));
    await user.click(screen.getByRole('button', { name: 'Ver más' }));
    expect(codigos()).toEqual(['A1', 'A2', 'A3', 'A4']);
    await user.click(screen.getByRole('checkbox', { name: /Incluir productos sin familia identificada o sin plantilla \(2\)/ }));
    expect(codigos()).toEqual(['A1', 'A2', 'A3', 'A4', 'B1', 'P1']);
    const etiquetas = screen.getAllByTestId('novedad-compatibilidad').map((e) => e.textContent);
    expect(etiquetas).toContain('Sin familia identificada');
    expect(etiquetas).toContain('Sin plantilla compatible');
    await user.click(screen.getByRole('button', { name: 'Consultar más novedades' }));
    await waitFor(() => expect(codigos()).toContain('A5'));
    expect(listMock).toHaveBeenLastCalledWith({ skip: 30, limit: 30, refresh: false }, expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: 'Consultar más novedades' })).not.toBeInTheDocument();   // BIND ya no tiene más
    await user.click(screen.getByRole('button', { name: 'Ver menos' }));
    expect(codigos()).toEqual(['A1', 'A2', 'A3']);
  });

  it('estado vacío comprensible: sin productos, o productos sin familia identificada (sin inventar registros)', async () => {
    listMock.mockResolvedValueOnce(pagina([]));
    const { user } = montar();
    await desplegar(user);
    expect(await screen.findByTestId('novedades-vacio')).toHaveTextContent('BIND no devolvió productos recientes.');
    expect(codigos()).toEqual([]);
    listMock.mockResolvedValueOnce(pagina([sinFamilia('B1'), papel('P1')]));
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByText(/no tienen una familia de manufactura identificada/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ver los 2 productos consultados/ }));
    expect(codigos()).toEqual(['B1', 'P1']);
  });

  it('error de BIND: mensaje claro, reintento y sin lista inventada', async () => {
    listMock.mockRejectedValueOnce(new NovedadesApiError('BIND_UNAVAILABLE', 502)).mockResolvedValueOnce(pagina([item('A1')]));
    const { user } = montar();
    await desplegar(user);
    expect(await screen.findByText(/No se pudieron consultar las novedades de BIND/)).toBeInTheDocument();
    expect(codigos()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(codigos()).toEqual(['A1']));
    expect(screen.queryByText(/No se pudieron consultar/)).not.toBeInTheDocument();
  });

  it('orden no comprobable (respuesta inválida): se explica y no se muestran productos', async () => {
    listMock.mockRejectedValueOnce(new NovedadesApiError('INVALID_RESPONSE', 502));
    const { user } = montar();
    await desplegar(user);
    expect(await screen.findByText(/no se muestran novedades para no presentar productos antiguos como recientes/)).toBeInTheDocument();
  });

  it('actualización manual: pide refresh a BIND, deshabilita el botón mientras consulta y reemplaza la lista', async () => {
    let resolver: (p: NovedadesPagina) => void = () => undefined;
    listMock.mockResolvedValueOnce(pagina([item('A1')]));
    const { user } = montar();
    await desplegar(user);
    await waitFor(() => expect(codigos()).toEqual(['A1']));
    listMock.mockImplementationOnce(() => new Promise((resolve) => { resolver = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(listMock).toHaveBeenLastCalledWith({ skip: 0, limit: 30, refresh: true }, expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeDisabled();
    expect(codigos()).toEqual(['A1']);                                                              // lo anterior sigue visible mientras se consulta
    await act(async () => { resolver(pagina([item('N1'), item('N2')])); await Promise.resolve(); });
    await waitFor(() => expect(codigos()).toEqual(['N1', 'N2']));
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled();
  });

  it('«Preparar hoja» entrega el código al flujo de búsqueda existente y contrae la sección; marca el producto cargado', async () => {
    listMock.mockResolvedValue(pagina([item('A1'), item('A2')]));
    const { user, onPrepare } = montar({ activeCode: 'a2' });
    await desplegar(user);
    await waitFor(() => expect(codigos()).toEqual(['A1', 'A2']));
    expect(within(screen.getAllByTestId('novedad-item')[1]!).getByText('Cargado en el formulario')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preparar hoja de A1' }));
    expect(onPrepare).toHaveBeenCalledWith('A1');
    await waitFor(() => expect(screen.getByRole('button', { name: /Novedades del catálogo de BIND/ })).toHaveAttribute('aria-expanded', 'false'));
    await desplegar(user);                                                                            // reabrir no vuelve a consultar BIND
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('con la configuración de familias sin cargar, «Preparar hoja» está deshabilitado', async () => {
    listMock.mockResolvedValue(pagina([item('A1')]));
    const { user } = montar({ disabled: true });
    await desplegar(user);
    expect(await screen.findByRole('button', { name: 'Preparar hoja de A1' })).toBeDisabled();
  });
});
