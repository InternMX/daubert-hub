import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientApiError, getClient, updateClient } from '../services/clients';
import { EditClientPage } from './EditClientPage';

vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), getClient: vi.fn(), updateClient: vi.fn() }));

const getClientMock = vi.mocked(getClient);
const updateClientMock = vi.mocked(updateClient);
const client = { id: '121', commercialName: 'Acme', companyType: 'CLIENTE', roles: ['CLIENTE'], status: 'ACTIVO', clientStatus: 'ACTIVO' as const, notes: null, fiscal: { id: '122', legalName: 'Acme SA', rfc: 'ACM010101AA1', startDate: null, endDate: null } };

function renderPage() {
  return render(<MemoryRouter initialEntries={[{ pathname: '/clients/121/edit', state: { directoryPath: '/clients?search=Acme&page=2' } }]}><Routes><Route path="/clients/:clientId/edit" element={<EditClientPage />} /><Route path="/clients/:clientId" element={<div>Detalle</div>} /></Routes></MemoryRouter>);
}

afterEach(() => vi.clearAllMocks());

describe('EditClientPage', () => {
  it('loads client values with no alias or role controls, and keeps saving disabled when unchanged', async () => {
    getClientMock.mockResolvedValue(client);
    renderPage();
    expect(await screen.findByDisplayValue('Acme')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('href', '/clients?search=Acme&page=2');
    expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/clients/121');
    expect(screen.getByText('Editar')).toHaveAttribute('aria-current', 'page');
    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue('ACM010101AA1')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Escribe un alias y presiona Enter...')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('requires RFC change meaning and submits a correction through PATCH', async () => {
    getClientMock.mockResolvedValue(client);
    updateClientMock.mockResolvedValue({ client, requestId: 'update-1' });
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
    await waitFor(() => expect(updateClientMock).toHaveBeenCalledWith('121', expect.objectContaining({ fiscal: expect.objectContaining({ rfc: 'NEW010101AA1', changeMode: 'CORRECTION' }) })));
    expect(await screen.findByText('Detalle')).toBeInTheDocument();
  });

  it('requires an effective date for a new fiscal identity', async () => {
    getClientMock.mockResolvedValue(client);
    const user = userEvent.setup();
    renderPage();
    const rfc = await screen.findByLabelText('RFC');
    await user.clear(rfc);
    await user.type(rfc, 'NEW010101AA1');
    await user.click(screen.getByLabelText('Registrar una nueva identidad fiscal'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByText('Indica desde cuándo está vigente la nueva identidad fiscal.')).toBeInTheDocument();
    expect(updateClientMock).not.toHaveBeenCalled();
  });

  it('blocks removing existing fiscal data from this edit', async () => {
    getClientMock.mockResolvedValue(client);
    const user = userEvent.setup();
    renderPage();
    const legalName = await screen.findByLabelText('Razón social');
    await user.clear(legalName);
    await user.clear(screen.getByLabelText('RFC'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByText('La información fiscal existente no puede eliminarse desde esta edición.')).toBeInTheDocument();
    expect(updateClientMock).not.toHaveBeenCalled();
  });

  it.each([
    ['CLIENT_NAME_CONFLICT', 'Ya existe una empresa con ese nombre comercial.'],
    ['CLIENT_RFC_CONFLICT', 'Ya existe una empresa registrada con ese RFC.']
  ])('shows the safe conflict %s from the backend', async (code, message) => {
    getClientMock.mockResolvedValue(client);
    updateClientMock.mockRejectedValue({ code });
    const user = userEvent.setup();
    renderPage();
    await screen.findByDisplayValue('Acme');
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), ' Updated');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('shows a directory return for a missing client', async () => {
    getClientMock.mockRejectedValue(new ClientApiError(404, undefined, 'request-404'));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Cliente no encontrado' })).toBeInTheDocument();
  });
});
