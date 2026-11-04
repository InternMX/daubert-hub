import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRoute } from '../auth/RouteGuards';
import * as svc from '../services/clientAbbreviations';
import { TestAuthProvider, testAdminUser, testGeneralUser } from '../test/authTestUtils';
import { AdministracionAbreviaturas } from './AbreviaturasClientesPage';

vi.mock('../services/clientAbbreviations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clientAbbreviations')>()), listarAbreviaturas: vi.fn(), resolverAbreviatura: vi.fn(), crearAbreviatura: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), listClients: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }) }));
const m = vi.mocked(svc);
afterEach(() => { vi.clearAllMocks(); });

const fila = (o: Partial<svc.AbreviaturaVista>): svc.AbreviaturaVista => ({ id: 'a1', abreviatura: 'AUD', alcance: 'GENERAL', codigoPatron: null, estado: 'PROPUESTA', origen: 'PROPUESTA_USUARIO', clienteId: '877', cliente: 'AUDI', documentos: 0, codigos: 0,
  evidencia: null, fuente: null, propuestaPor: 'general@example.invalid', resueltaPor: null, resueltaEn: null, motivo: null, creadaEn: '2026-11-04T10:00:00Z', actualizadaEn: '2026-11-04T10:00:00Z', ...o });
const montar = (usuario = testAdminUser) => render(<TestAuthProvider value={{ user: usuario }}><MemoryRouter initialEntries={['/client-abbreviations']}><Routes><Route element={<AdminRoute />}><Route path="/client-abbreviations" element={<AdministracionAbreviaturas />} /></Route><Route path="*" element={<p>Fuera</p>} /></Routes></MemoryRouter></TestAuthProvider>);

describe('administración de abreviaturas de clientes', () => {
  it('solo un ADMIN entra a la página; una cuenta GENERAL es redirigida', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [], conteos: {} });
    montar(testGeneralUser);
    expect(await screen.findByText('Fuera')).toBeInTheDocument();
    expect(m.listarAbreviaturas).not.toHaveBeenCalled();
  });

  it('catálogo no habilitado: mensaje claro, sin tabla ni formulario; el resto de la app no se ve afectado', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: false, puedeResolver: false, data: [], conteos: {} });
    montar();
    expect(await screen.findByTestId('catalogo-no-habilitado')).toHaveTextContent(/aún no está habilitado/);
    expect(screen.queryByRole('button', { name: 'Registrar abreviatura' })).toBeNull();
  });

  it('muestra por omisión las propuestas por revisar con procedencia; el ADMIN confirma con una acción explícita', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [fila({})], conteos: { PROPUESTA: 1, CONFIRMADA: 3 } });
    m.resolverAbreviatura.mockResolvedValue(fila({ estado: 'CONFIRMADA' }));
    montar();
    const f = await screen.findByTestId('abreviatura-fila');
    expect(within(f).getByText('AUDI')).toBeInTheDocument();
    expect(within(f).getByText('Propuesta de usuario')).toBeInTheDocument();
    expect(within(f).queryByText(/general@example.invalid/)).toBeNull();                // el correo no estira la tabla: está en «Ver detalles»
    expect(m.listarAbreviaturas).toHaveBeenCalledWith({ estado: 'PROPUESTA', q: '' }, expect.anything());
    expect(m.resolverAbreviatura).not.toHaveBeenCalled();                              // nada se confirma solo
    await userEvent.click(within(f).getByRole('button', { name: 'Confirmar AUD de AUDI' }));
    await waitFor(() => expect(m.resolverAbreviatura).toHaveBeenCalledWith('a1', 'CONFIRMAR', undefined));
    expect(await screen.findByText(/AUD → AUDI: confirmada/)).toBeInTheDocument();
  });

  it('rechazar exige un motivo', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [fila({})], conteos: {} });
    m.resolverAbreviatura.mockResolvedValue(fila({ estado: 'RECHAZADA' }));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: 'Rechazar AUD de AUDI' }));
    const enviar = screen.getByRole('button', { name: 'Rechazar' });
    expect(enviar).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Motivo/), 'Es un prefijo de producto');
    await userEvent.click(enviar);
    await waitFor(() => expect(m.resolverAbreviatura).toHaveBeenCalledWith('a1', 'RECHAZAR', 'Es un prefijo de producto'));
  });

  it('una confirmada se puede inactivar y una inactiva reactivar; una rechazada no ofrece acciones', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [fila({ id: 'c', estado: 'CONFIRMADA' }), fila({ id: 'i', abreviatura: 'XYZ', estado: 'INACTIVA' }), fila({ id: 'r', abreviatura: 'RRR', estado: 'RECHAZADA', motivo: 'no aplica', resueltaPor: 'admin' })], conteos: {} });
    montar();
    await screen.findAllByTestId('abreviatura-fila');
    expect(screen.getByRole('button', { name: 'Inactivar AUD de AUDI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivar XYZ de AUDI' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /(Confirmar|Rechazar|Inactivar|Reactivar) RRR/ })).toBeNull();
  });

  it('un error del servidor se muestra en español y no rompe la lista', async () => {
    m.listarAbreviaturas.mockResolvedValue({ disponible: true, puedeResolver: true, data: [fila({})], conteos: {} });
    m.resolverAbreviatura.mockRejectedValue(new svc.AbbreviationApiError('CLIENTE_INVALIDO', 422));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar AUD de AUDI' }));
    expect(await screen.findByText(/empresa activa con rol CLIENTE/)).toBeInTheDocument();
    expect(screen.getByTestId('abreviatura-fila')).toBeInTheDocument();
  });
});
