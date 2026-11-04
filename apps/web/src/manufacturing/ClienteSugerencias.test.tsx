import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as svc from '../services/clientAbbreviations';
import { ClienteSugerencias } from './ClienteSugerencias';

vi.mock('../services/clientAbbreviations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clientAbbreviations')>()), sugerirClientes: vi.fn(), crearAbreviatura: vi.fn() }));
const m = vi.mocked(svc);
afterEach(() => { vi.clearAllMocks(); });

const alt = (clienteId: string, cliente: string, abreviatura = 'AUD', nivelNombre = 'GENERAL') => ({ clienteId, cliente, nivel: nivelNombre === 'GENERAL' ? 3 : 1, nivelNombre, confirmada: true, respaldo: [{ id: `r${clienteId}`, abreviatura, alcance: 'GENERAL' as const, codigoPatron: null, estado: 'CONFIRMADA' as const, documentos: 12, codigos: 11 }] });
const base = { disponible: true, puedeResolver: false, codigo: 'AUDFCP5010', alternativas: [], relacionadas: [], sinConfirmar: [] };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- el rol ya lo informa el servidor (puedeResolver); se conserva la firma de las pruebas
function montar(actual = { value: '', source: undefined as string | undefined, ref: undefined as string | undefined }, _rol: 'ADMIN' | 'GENERAL' = 'GENERAL', codigo = 'AUDFCP5010') {
  const onUsar = vi.fn();
  render(<ClienteSugerencias codigo={codigo} actual={actual} onUsar={onUsar} />);
  return { onUsar };
}

describe('sugerencias de cliente por abreviatura (junto al campo Cliente)', () => {
  it('coincidencia exacta: se muestra como sugerencia, NO se asigna sola y solo se usa con «Usar este cliente»', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'EXACTA', alternativas: [alt('877', 'AUDI')] });
    const { onUsar } = montar();
    expect(await screen.findByText(/No se asignó ningún cliente/)).toBeInTheDocument();
    expect(onUsar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Usar este cliente: AUDI/ }));
    expect(onUsar).toHaveBeenCalledWith('877', 'AUDI');
    expect(m.sugerirClientes).toHaveBeenCalledWith('AUDFCP5010', expect.anything());
  });

  it('prefijo compartido / código ambiguo: muestra todas las alternativas y no asigna ninguna', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, codigo: 'CATFPMG001', estado: 'ELEGIR', alternativas: [alt('1207', 'CATERPILLAR', 'CAT'), alt('50', 'ELECINFMEX', 'CAT')] });
    const { onUsar } = montar(undefined, 'GENERAL', 'CATFPMG001');
    expect(await screen.findByText(/admite más de un cliente/)).toBeInTheDocument();
    expect(screen.getAllByTestId('alternativa-cliente')).toHaveLength(2);
    expect(onUsar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Usar este cliente: ELECINFMEX/ }));
    expect(onUsar).toHaveBeenCalledWith('50', 'ELECINFMEX');
  });

  it('la alternativa ya seleccionada se marca y no ofrece usarla de nuevo', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'EXACTA', alternativas: [alt('877', 'AUDI')] });
    montar({ value: 'AUDI', source: 'CATALOGO', ref: '877' });
    expect(await screen.findByText('Cliente seleccionado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Usar este cliente/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /para futuras hojas/ })).toBeNull();          // ya está asociado a este código: no hay nada que proponer
  });

  it('cliente sin asociación: «sin sugerencias» (distinto de «catálogo no habilitado») y se puede seguir con el buscador o texto manual', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    montar();
    expect(await screen.findByTestId('sin-sugerencias')).toHaveTextContent(/Elige el cliente con el buscador o escribe su nombre/);
    expect(screen.queryByTestId('catalogo-no-habilitado')).toBeNull();
  });

  it('catálogo no habilitado (migración 104 ausente): mensaje propio y discreto, sin error ni bloqueo', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, disponible: false, estado: 'NO_HABILITADO' });
    montar();
    expect(await screen.findByTestId('catalogo-no-habilitado')).toHaveTextContent(/no habilitado/);
    expect(screen.queryByTestId('sin-sugerencias')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('si la consulta falla, el formulario sigue: aviso discreto y sin romper nada; un código demasiado corto ni consulta', async () => {
    m.sugerirClientes.mockRejectedValue(new Error('x'));
    montar();
    expect(await screen.findByTestId('sugerencias-error')).toBeInTheDocument();
  });

  it('un código incompleto no consulta ni muestra nada', async () => {
    montar(undefined, 'GENERAL', 'AU');
    await new Promise((r) => setTimeout(r, 500));
    expect(m.sugerirClientes).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sugerencias-cliente')).toBeNull();
  });

  it('las propuestas sin confirmar se listan aparte y no cuentan como sugerencia', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS', sinConfirmar: [{ ...alt('9', 'NUEVO CLIENTE', 'AUD'), nivel: 9, confirmada: false }] });
    montar();
    expect(await screen.findByTestId('sin-confirmar')).toHaveTextContent(/NUEVO CLIENTE/);
    expect(screen.queryByRole('button', { name: /Usar este cliente/ })).toBeNull();
  });

  it('GENERAL propone (nada de «Registrar»); las partes del código son opciones, ninguna viene elegida', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    m.crearAbreviatura.mockResolvedValue({ id: 'n', abreviatura: 'AUD', cliente: 'AUDI', estado: 'PROPUESTA' } as never);
    montar({ value: 'AUDI', source: 'CATALOGO', ref: '877' });
    await userEvent.click(await screen.findByRole('button', { name: 'Proponer asociación para futuras hojas' }));
    expect(screen.queryByRole('button', { name: /Registrar asociación/ })).toBeNull();
    const enviar = screen.getByRole('button', { name: 'Proponer asociación' });
    expect(enviar).toBeDisabled();                                                     // hasta que el usuario elija la abreviatura
    await userEvent.click(screen.getByText('AUD'));
    expect(enviar).toBeEnabled();
    await userEvent.click(enviar);
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'AUD', clienteId: '877', alcance: 'GENERAL' })));
    expect(await screen.findByText(/un ADMIN debe confirmarla/)).toBeInTheDocument();
  });

  it('ADMIN registra desde la hoja con los mismos servicios (queda confirmada) y la excepción por código completo usa el código de la hoja', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, puedeResolver: true, estado: 'SIN_SUGERENCIAS' });
    m.crearAbreviatura.mockResolvedValue({ id: 'n', abreviatura: 'AUD', cliente: 'AUDI', estado: 'CONFIRMADA' } as never);
    montar({ value: 'AUDI', source: 'CATALOGO', ref: '877' }, 'ADMIN');
    await userEvent.click(await screen.findByRole('button', { name: 'Proponer asociación para futuras hojas' }));
    await userEvent.click(screen.getByText('AUD'));
    await userEvent.click(screen.getByLabelText(/Solo este código completo/));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar asociación' }));
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'AUD', alcance: 'CODIGO_COMPLETO', codigoPatron: 'AUDFCP5010' })));
    expect(await screen.findByText(/registrada y confirmada/)).toBeInTheDocument();
  });

  it('sin cliente del catálogo seleccionado se explica cómo asociar y no se ofrece el formulario', async () => {
    m.sugerirClientes.mockResolvedValue({ ...base, estado: 'SIN_SUGERENCIAS' });
    montar({ value: 'texto libre', source: 'PROVISIONAL', ref: undefined });
    expect(await screen.findByText(/podrás proponer su asociación para futuras hojas/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /para futuras hojas/ })).toBeNull();
  });
});
