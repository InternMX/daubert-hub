import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProviders } from '../services/providers';
import { ProvidersPage } from './ProvidersPage';

vi.mock('../services/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/providers')>()),
  listProviders: vi.fn()
}));

const listProvidersMock = vi.mocked(listProviders);

function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderPage(path = '/providers') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/providers" element={<><ProvidersPage /><Location /></>} /></Routes></MemoryRouter>);
}

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('ProvidersPage', () => {
  it('renders provider rows with Spanish labels and a fiscal fallback', async () => {
    listProvidersMock.mockResolvedValue({ data: [
      { id: '1', commercialName: 'Transportes Acme', providerType: 'FLETE', status: 'ACTIVO', notes: null, fiscal: null },
      { id: '2', commercialName: 'Servicios Norte', providerType: 'SERVICIO', status: 'INACTIVO', notes: null, fiscal: { id: 'f2', legalName: 'Servicios Norte SA', rfc: 'SNX010101AA1' } }
    ], meta: { page: 1, pageSize: 25, total: 2, totalPages: 1 } });
    renderPage();
    expect(await screen.findByText('Transportes Acme')).toBeInTheDocument();
    expect(screen.getByText('Flete')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('Servicios Norte SA')).toBeInTheDocument();
    expect(screen.getByText('SNX010101AA1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Transportes Acme' })).toHaveAttribute('href', '/providers/1');
    expect(screen.getByRole('columnheader', { name: 'Nombre comercial' })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByText('RFC').closest('button')).toBeNull();
    expect(screen.getByText('Estado').closest('button')).toBeNull();
  });

  it('uses query parameters for the initial request and filter changes', async () => {
    listProvidersMock.mockResolvedValue({ data: [{ id: '1', commercialName: 'Acme', providerType: 'SERVICIO', status: 'ACTIVO', notes: null, fiscal: null }], meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 } });
    const user = userEvent.setup();
    renderPage('/providers?search=Acme&providerType=SERVICIO&page=2&pageSize=25');
    await waitFor(() => expect(listProvidersMock).toHaveBeenCalledWith({ search: 'Acme', providerType: 'SERVICIO', page: 2, pageSize: 25, sortBy: 'commercialName', sortOrder: 'asc' }));
    await user.click(screen.getByRole('button', { name: 'Nombre comercial' }));
    await waitFor(() => expect(listProvidersMock).toHaveBeenLastCalledWith({ search: 'Acme', providerType: 'SERVICIO', page: 1, pageSize: 25, sortBy: 'commercialName', sortOrder: 'desc' }));
    await user.click(screen.getByRole('button', { name: 'Tipo' }));
    await waitFor(() => {
      const location = screen.getByTestId('location').textContent ?? '';
      expect(location).toContain('page=1');
      expect(location).toContain('sortBy=providerType');
      expect(location).toContain('sortOrder=asc');
    });
    await waitFor(() => expect(listProvidersMock).toHaveBeenLastCalledWith({ search: 'Acme', providerType: 'SERVICIO', page: 1, pageSize: 25, sortBy: 'providerType', sortOrder: 'asc' }));
    await user.click(screen.getByRole('button', { name: 'Tipo' }));
    await waitFor(() => expect(listProvidersMock).toHaveBeenLastCalledWith({ search: 'Acme', providerType: 'SERVICIO', page: 1, pageSize: 25, sortBy: 'providerType', sortOrder: 'desc' }));
    await user.click(screen.getByRole('button', { name: 'Razón social' }));
    await waitFor(() => expect(listProvidersMock).toHaveBeenLastCalledWith({ search: 'Acme', providerType: 'SERVICIO', page: 1, pageSize: 25, sortBy: 'legalName', sortOrder: 'asc' }));
  });

  it('debounces search updates before requesting filtered results', async () => {
    vi.useFakeTimers();
    listProvidersMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    renderPage();
    await act(async () => {});
    listProvidersMock.mockClear();
    fireEvent.change(screen.getByLabelText('Buscar proveedor'), { target: { value: 'Acme' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(listProvidersMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(listProvidersMock).toHaveBeenCalledWith({ search: 'Acme', providerType: undefined, page: 1, pageSize: 25, sortBy: 'commercialName', sortOrder: 'asc' });
  });

  it('distinguishes database and filtered empty states', async () => {
    listProvidersMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    const { rerender } = renderPage();
    expect(await screen.findByText('Aún no hay proveedores registrados.')).toBeInTheDocument();
    rerender(<MemoryRouter key="filtered" initialEntries={['/providers?search=missing']}><Routes><Route path="/providers" element={<ProvidersPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('No se encontraron proveedores.')).toBeInTheDocument();
  });

  it('shows a safe error and retries the request', async () => {
    listProvidersMock.mockRejectedValueOnce(new Error('private network details')).mockResolvedValueOnce({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('No fue posible cargar los proveedores. Intenta nuevamente.')).toBeInTheDocument();
    expect(screen.queryByText('private network details')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(listProvidersMock).toHaveBeenCalledTimes(2));
  });
});
