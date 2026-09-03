import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listClients } from '../services/clients';
import { ClientsPage } from './ClientsPage';

vi.mock('../services/clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/clients')>()),
  listClients: vi.fn()
}));

const listClientsMock = vi.mocked(listClients);

function renderPage(path = '/clients') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/clients" element={<ClientsPage />} /><Route path="/clients/:clientId" element={<div>Client detail route</div>} /></Routes></MemoryRouter>);
}

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('ClientsPage', () => {
  it('renders client rows with Spanish column labels and a fiscal fallback', async () => {
    listClientsMock.mockResolvedValue({ data: [
      { id: '9007199254740993', commercialName: 'Transportes Acme', companyType: 'CLIENTE', status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: null },
      { id: '2', commercialName: 'Servicios Norte', companyType: 'CLIENTE', status: 'INACTIVO', clientStatus: 'INACTIVO', notes: null, roles: ['CLIENTE'], fiscal: { id: 'f2', legalName: 'Servicios Norte SA', rfc: 'SNX010101AA1', startDate: null, endDate: null } }
    ], meta: { page: 1, pageSize: 25, total: 2, totalPages: 1 } });
    renderPage();
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/');
    expect(within(screen.getByLabelText('Migas de pan')).getByText('Clientes')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Transportes Acme')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nombre, razón social o RFC')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Nombre comercial' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Razón social' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'RFC' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Estatus' })).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('Servicios Norte SA')).toBeInTheDocument();
    expect(screen.getByText('SNX010101AA1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Transportes Acme' })).toHaveAttribute('href', '/clients/9007199254740993');
  });

  it('shows the CLIENTE lifecycle status, not the company status, for a multi-role client', async () => {
    // company stays ACTIVO (still has another role) while CLIENTE itself is inactive.
    listClientsMock.mockResolvedValue({ data: [{ id: '9007199254740993', commercialName: 'Acme', companyType: 'PROVEEDOR', status: 'ACTIVO', clientStatus: 'INACTIVO', notes: null, roles: ['PROVEEDOR'], fiscal: null }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
    renderPage();
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.queryByText('Activo')).not.toBeInTheDocument();
  });

  it.each([
    ['ACTIVO'],
    ['INACTIVO']
  ])('shows Bloqueado, not clientStatus %s, when the company itself is BLOQUEADO', async (clientStatus) => {
    listClientsMock.mockResolvedValue({ data: [{ id: '9007199254740993', commercialName: 'Acme', companyType: 'CLIENTE', status: 'BLOQUEADO', clientStatus: clientStatus as 'ACTIVO' | 'INACTIVO', notes: null, roles: clientStatus === 'ACTIVO' ? ['CLIENTE'] : [], fiscal: null }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
    renderPage();
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.queryByText('Activo')).not.toBeInTheDocument();
    expect(screen.queryByText('Inactivo')).not.toBeInTheDocument();
  });

  it('navigates to the client detail route while preserving the BIGINT string ID', async () => {
    listClientsMock.mockResolvedValue({ data: [{ id: '9007199254740993', commercialName: 'Acme', companyType: 'CLIENTE', status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: null }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('link', { name: 'Acme' }));
    expect(screen.getByText('Client detail route')).toBeInTheDocument();
  });

  it('uses query parameters for the initial request and sort toggling', async () => {
    listClientsMock.mockResolvedValue({ data: [{ id: '1', commercialName: 'Acme', companyType: 'CLIENTE', status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: null }], meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 } });
    const user = userEvent.setup();
    renderPage('/clients?search=Acme&page=2&pageSize=25');
    await waitFor(() => expect(listClientsMock).toHaveBeenCalledWith({ search: 'Acme', page: 2, pageSize: 25, sortOrder: 'asc' }));
    await user.click(screen.getByRole('button', { name: 'Nombre comercial' }));
    await waitFor(() => expect(listClientsMock).toHaveBeenLastCalledWith({ search: 'Acme', page: 1, pageSize: 25, sortOrder: 'desc' }));
  });

  it('debounces search updates before requesting filtered results', async () => {
    vi.useFakeTimers();
    listClientsMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    renderPage();
    await act(async () => {});
    listClientsMock.mockClear();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'Acme' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(listClientsMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(listClientsMock).toHaveBeenCalledWith({ search: 'Acme', page: 1, pageSize: 25, sortOrder: 'asc' });
  });

  it('shows an intentional empty state for a database with no clients yet', async () => {
    listClientsMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    renderPage();
    expect(await screen.findByText('Aún no hay clientes registrados.')).toBeInTheDocument();
    expect(screen.getByText('Registra el primer cliente para comenzar.')).toBeInTheDocument();
  });

  it('distinguishes the filtered empty state', async () => {
    listClientsMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    renderPage('/clients?search=missing');
    expect(await screen.findByText('No se encontraron clientes.')).toBeInTheDocument();
  });

  it('shows a safe error and retries the request', async () => {
    listClientsMock.mockRejectedValueOnce(new Error('private network details')).mockResolvedValueOnce({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('No fue posible cargar los clientes. Intenta nuevamente.')).toBeInTheDocument();
    expect(screen.queryByText('private network details')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(listClientsMock).toHaveBeenCalledTimes(2));
  });

  it('shows a loading indicator while the request is pending', () => {
    listClientsMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByLabelText('Cargando clientes')).toBeInTheDocument();
  });
});
