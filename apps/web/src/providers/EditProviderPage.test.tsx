import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProvider, updateProvider } from '../services/providers';
import { EditProviderPage } from './EditProviderPage';

vi.mock('../services/providers', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/providers')>()), getProvider: vi.fn(), updateProvider: vi.fn() }));

const getProviderMock = vi.mocked(getProvider);
const updateProviderMock = vi.mocked(updateProvider);
const provider = { id: '121', commercialName: 'Acme', providerType: 'SERVICIO' as const, roles: ['SERVICIO'], status: 'ACTIVO', notes: null, fiscal: { id: '122', legalName: 'Acme SA', rfc: 'ACM010101AA1' } };

function renderPage() {
  return render(<MemoryRouter initialEntries={[{ pathname: '/providers/121/edit', state: { directoryPath: '/providers?search=Acme&page=2' } }]}><Routes><Route path="/providers/:id/edit" element={<EditProviderPage />} /><Route path="/providers/:id" element={<div>Detalle</div>} /></Routes></MemoryRouter>);
}

afterEach(() => vi.clearAllMocks());

describe('EditProviderPage', () => {
  it('loads provider values and keeps saving disabled when unchanged', async () => {
    getProviderMock.mockResolvedValue(provider);
    renderPage();
    expect(await screen.findByDisplayValue('Acme')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Proveedores' })).toHaveAttribute('href', '/providers?search=Acme&page=2');
    expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/providers/121');
    expect(screen.getByText('Editar')).toHaveAttribute('aria-current', 'page');
    expect(getProviderMock).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue('ACM010101AA1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('requires RFC change meaning and submits a correction through PATCH', async () => {
    getProviderMock.mockResolvedValue(provider);
    updateProviderMock.mockResolvedValue({ provider, requestId: 'update-1' });
    const user = userEvent.setup();
    renderPage();
    const rfc = await screen.findByLabelText('RFC');
    await user.clear(rfc);
    await user.type(rfc, 'NEW010101AA1');
    expect(screen.getByText('El RFC actual cambió. ¿Qué representa este cambio?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByText('Indica qué representa el cambio de RFC.')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Corregir un dato capturado incorrectamente'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith('121', expect.objectContaining({ fiscal: expect.objectContaining({ rfc: 'NEW010101AA1', changeMode: 'CORRECTION' }) })));
    expect(await screen.findByText('Detalle')).toBeInTheDocument();
  });
});
