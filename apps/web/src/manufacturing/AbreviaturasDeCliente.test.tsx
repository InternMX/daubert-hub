import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as svc from '../services/clientAbbreviations';
import { AbreviaturasDeCliente } from './AbreviaturasDeCliente';

vi.mock('../services/clientAbbreviations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clientAbbreviations')>()), listarAbreviaturas: vi.fn(), resolverAbreviatura: vi.fn(), crearAbreviatura: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), listClients: vi.fn() }));
const m = vi.mocked(svc);
afterEach(() => { vi.clearAllMocks(); });

const CLIENTE = { id: '877', nombre: 'AUDI' };
const fila = (o: Partial<svc.AbreviaturaVista>): svc.AbreviaturaVista => ({ id: 'a1', abreviatura: 'AUD', alcance: 'GENERAL', codigoPatron: null, estado: 'CONFIRMADA', origen: 'MANUAL_ADMIN', clienteId: '877', cliente: 'AUDI', documentos: 12, codigos: 11,
  evidencia: null, fuente: null, propuestaPor: 'admin@example.invalid', resueltaPor: 'admin@example.invalid', resueltaEn: '2026-11-04T10:00:00Z', motivo: null, creadaEn: '2026-11-04T10:00:00Z', actualizadaEn: '2026-11-04T10:00:00Z', ...o });
const montar = () => render(<MemoryRouter><AbreviaturasDeCliente cliente={CLIENTE} /></MemoryRouter>);

describe('abreviaturas en la ficha del cliente (mismo catálogo, filtrado por empresa)', () => {
  it('consulta las abreviaturas de ESE cliente por empresa_id (el mismo endpoint de la administración) y las muestra todas por omisión', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [fila({}), fila({ id: 'a2', abreviatura: 'AUDF', alcance: 'CONTEXTO', codigoPatron: 'AUDF', estado: 'PROPUESTA', resueltaPor: null })], conteos: {} });
    montar();
    expect(await screen.findAllByTestId('abreviatura-fila')).toHaveLength(2);
    expect(m.listarAbreviaturas).toHaveBeenCalledWith({ estado: undefined, q: '', clienteId: '877' }, expect.anything());
    expect(screen.getByText(/Son distintas de los alias de pago/)).toBeInTheDocument();
  });

  it('ADMIN: confirma, inactiva y registra sin elegir cliente (queda fijo el de la ficha)', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [fila({ estado: 'PROPUESTA', resueltaPor: null }), fila({ id: 'a2', abreviatura: 'AUDF', estado: 'CONFIRMADA' })], conteos: {} });
    m.resolverAbreviatura.mockResolvedValue(fila({}));
    m.crearAbreviatura.mockResolvedValue(fila({ id: 'n' }));
    montar();
    await screen.findAllByTestId('abreviatura-fila');
    expect(screen.getByRole('button', { name: 'Confirmar AUD de AUDI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inactivar AUDF de AUDI' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar abreviatura' }));
    const form = screen.getByRole('region', { name: 'Registrar abreviatura' });
    expect(within(form).getByText('AUDI')).toBeInTheDocument();
    expect(within(form).queryByLabelText(/Cliente \(empresa/)).toBeNull();            // el cliente no se vuelve a elegir
    await userEvent.type(within(form).getByLabelText(/Abreviatura \(2 a 5/), 'aud');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar y confirmar' }));
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'AUD', clienteId: '877', alcance: 'GENERAL', soloProponer: false })));
  });

  it('GENERAL: consulta lo confirmado sin acciones de resolución y solo puede PROPONER', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: false, data: [fila({})], conteos: {} });
    m.crearAbreviatura.mockResolvedValue(fila({ id: 'p', estado: 'PROPUESTA' }));
    montar();
    await screen.findByTestId('abreviatura-fila');
    expect(screen.queryByRole('button', { name: /Confirmar|Rechazar|Inactivar|Reactivar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Registrar abreviatura' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Proponer abreviatura' }));
    const form = screen.getByRole('region', { name: 'Registrar abreviatura' });
    expect(within(form).queryByRole('button', { name: 'Registrar y confirmar' })).toBeNull();
    await userEvent.type(within(form).getByLabelText(/Abreviatura \(2 a 5/), 'AUDF');
    await userEvent.click(within(form).getByRole('button', { name: 'Proponer' }));
    await waitFor(() => expect(m.crearAbreviatura).toHaveBeenCalledWith(expect.objectContaining({ abreviatura: 'AUDF', clienteId: '877', soloProponer: true })));
  });

  it('sin la migración 104: aviso claro dentro de la ficha, sin formulario ni error', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: false, puedeResolver: false, data: [], conteos: {} });
    montar();
    expect(await screen.findByTestId('catalogo-no-habilitado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /abreviatura/i })).toBeNull();
  });

  it('un cliente sin abreviaturas lo dice sin confundirlo con «no habilitado»', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [], conteos: {} });
    montar();
    expect(await screen.findByTestId('sin-resultados')).toBeInTheDocument();
    expect(screen.queryByTestId('catalogo-no-habilitado')).toBeNull();
  });
});
