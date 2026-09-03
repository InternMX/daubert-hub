import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewClientPage } from './NewClientPage';

const api = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('../services/clients', () => api);

function renderPage() {
  return render(<MemoryRouter initialEntries={['/clients/new']}><NewClientPage /></MemoryRouter>);
}

function renderPageWithClientsRoute() {
  return render(<MemoryRouter initialEntries={['/clients/new']}><Routes><Route path="/clients/new" element={<NewClientPage />} /><Route path="/clients" element={<div>Clients route</div>} /></Routes></MemoryRouter>);
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'Novapak');
}

afterEach(() => vi.clearAllMocks());

describe('NewClientPage', () => {
  it('shows a persistent success state and resets for another client', async () => {
    api.createClient.mockResolvedValue({ client: { id: '121', commercialName: 'Novapak', companyType: 'CLIENTE', status: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: { id: '122', legalName: 'Novapak SA', rfc: 'ABC123456XYZ', startDate: null, endDate: null } }, requestId: 'request-1' });
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('href', '/clients');
    expect(within(screen.getByLabelText('Migas de pan')).getByText('Nuevo cliente')).toHaveAttribute('aria-current', 'page');
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(await screen.findByRole('heading', { name: 'Cliente registrado' })).toBeInTheDocument();
    expect(screen.getByText('Novapak se registró correctamente.')).toBeInTheDocument();
    expect(screen.getByText('ABC123456XYZ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar otro cliente' }));
    expect(screen.getByRole('heading', { name: 'Información general' })).toBeInTheDocument();
  });

  it('shows pending fiscal data when the API returns no fiscal identity', async () => {
    api.createClient.mockResolvedValue({ client: { id: '121', commercialName: 'Without Fiscal', companyType: 'CLIENTE', status: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: null }, requestId: 'request-2' });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(await screen.findByText('Pendientes')).toBeInTheDocument();
  });

  it('returns to clients after success', async () => {
    api.createClient.mockResolvedValue({ client: { id: '121', commercialName: 'Novapak', companyType: 'CLIENTE', status: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: null }, requestId: 'request-back' });
    const user = userEvent.setup();
    renderPageWithClientsRoute();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    await screen.findByRole('heading', { name: 'Cliente registrado' });
    await user.click(screen.getAllByRole('button', { name: 'Volver a clientes' })[1]!);
    expect(screen.getByText('Clients route')).toBeInTheDocument();
  });

  it.each([
    ['CLIENT_ALREADY_ACTIVE', 'Ya existe un cliente activo con ese nombre comercial.'],
    ['CLIENT_RFC_CONFLICT', 'Ya existe una empresa registrada con ese RFC.']
  ])('keeps form values and shows conflict %s', async (code, message) => {
    api.createClient.mockRejectedValue({ code, requestId: 'request-3' });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    if (code === 'CLIENT_RFC_CONFLICT') {
      await user.type(screen.getByLabelText('Razón social'), 'Novapak SA');
      await user.type(screen.getByLabelText('RFC'), 'ABC123456XYZ');
    }
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Nombre comercial/ })).toHaveValue('Novapak');
  });

  it('shows a safe generic failure with a support reference', async () => {
    api.createClient.mockRejectedValue({ requestId: 'request-4' });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(await screen.findByText('No fue posible registrar el cliente. Inténtalo nuevamente. Referencia: request-4')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Nombre comercial/ })).toHaveValue('Novapak');
  });
});
