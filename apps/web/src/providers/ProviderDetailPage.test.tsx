import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderApiError, getProvider } from '../services/providers';
import { ProviderDetailPage } from './ProviderDetailPage';

vi.mock('../services/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/providers')>()),
  getProvider: vi.fn()
}));

const getProviderMock = vi.mocked(getProvider);

function renderPage(path = '/providers/121', state?: { directoryPath: string }) {
  return render(<MemoryRouter initialEntries={[{ pathname: path, state }]}><Routes><Route path="/providers/:id" element={<ProviderDetailPage />} /><Route path="/providers" element={<div>Directorio de proveedores</div>} /></Routes></MemoryRouter>);
}

afterEach(() => vi.clearAllMocks());

describe('ProviderDetailPage', () => {
  it('shows read-only provider data, Spanish roles, notes fallback, and no fiscal state', async () => {
    getProviderMock.mockResolvedValue({ id: '121', commercialName: 'Transportes Acme', providerType: 'FLETE', roles: ['PROVEEDOR', 'FLETE'], status: 'ACTIVO', notes: null, aliases: [], otherAliases: [], fiscal: null });
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Transportes Acme' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proveedores' })).toHaveAttribute('href', '/providers');
    expect(within(screen.getByLabelText('Migas de pan')).getByText('Transportes Acme')).toHaveAttribute('aria-current', 'page');
    expect(getProviderMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Flete')).toHaveLength(2);
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Proveedor')).toBeInTheDocument();
    expect(screen.getByText('Sin notas registradas.')).toBeInTheDocument();
    expect(screen.getByText('No hay datos fiscales registrados.')).toBeInTheDocument();
  });

  it('shows fiscal data and returns to the filtered directory path', async () => {
    getProviderMock.mockResolvedValue({ id: '121', commercialName: 'Acme', providerType: 'PROVEEDOR', roles: ['PROVEEDOR'], status: 'INACTIVO', notes: 'Pago a 30 días.', aliases: [], otherAliases: [], fiscal: { id: 'f1', legalName: 'Acme SA de CV', rfc: 'ACM010101AA1' } });
    const user = userEvent.setup();
    renderPage('/providers/121', { directoryPath: '/providers?search=Acme&page=2' });

    expect(await screen.findByText('Acme SA de CV')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proveedores' })).toHaveAttribute('href', '/providers?search=Acme&page=2');
    expect(screen.getByText('ACM010101AA1')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Volver a proveedores' }));
    expect(screen.getByText('Directorio de proveedores')).toBeInTheDocument();
  });

  it('shows a directory return for a missing provider', async () => {
    getProviderMock.mockRejectedValue(new ProviderApiError(404, undefined, 'request-404'));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Proveedor no encontrado' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a proveedores' })).toHaveAttribute('href', '/providers');
  });

  it('retries a generic error without exposing error details', async () => {
    getProviderMock.mockRejectedValueOnce(new ProviderApiError(500, undefined, 'request-500')).mockResolvedValueOnce({ id: '121', commercialName: 'Acme', providerType: 'SERVICIO', roles: ['SERVICIO'], status: 'ACTIVO', notes: null, aliases: [], otherAliases: [], fiscal: null });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('No fue posible cargar el proveedor. Intenta nuevamente.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(getProviderMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument();
  });
});
