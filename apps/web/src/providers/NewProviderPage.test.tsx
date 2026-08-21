import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewProviderPage } from './NewProviderPage';

const api = vi.hoisted(() => ({ createProvider: vi.fn() }));

vi.mock('../services/providers', () => api);

function renderPage() {
  return render(<MemoryRouter initialEntries={['/providers/new']}><NewProviderPage /></MemoryRouter>);
}

function renderPageWithProvidersRoute() {
  return render(<MemoryRouter initialEntries={['/providers/new']}><Routes><Route path="/providers/new" element={<NewProviderPage />} /><Route path="/providers" element={<div>Providers route</div>} /></Routes></MemoryRouter>);
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'Novapak');
  await user.click(screen.getByRole('combobox', { name: /Tipo de proveedor/ }));
  await user.click(screen.getByRole('option', { name: 'Proveedor' }));
}

afterEach(() => vi.clearAllMocks());

describe('NewProviderPage', () => {
  it('shows a persistent success state and resets for another provider', async () => {
    api.createProvider.mockResolvedValue({ provider: { id: '121', commercialName: 'Novapak', providerType: 'PROVEEDOR', status: 'ACTIVO', notes: null, fiscal: { id: '122', legalName: 'Novapak SA', rfc: 'ABC123456XYZ' } }, requestId: 'request-1' });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(await screen.findByRole('heading', { name: 'Proveedor registrado' })).toBeInTheDocument();
    expect(screen.getByText('Novapak se registró correctamente.')).toBeInTheDocument();
    expect(screen.getByText('ABC123456XYZ')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar otro proveedor' }));
    expect(screen.getByRole('heading', { name: 'Información general' })).toBeInTheDocument();
  });

  it('shows pending fiscal data when the API returns no fiscal identity', async () => {
    api.createProvider.mockResolvedValue({ provider: { id: '121', commercialName: 'Without Fiscal', providerType: 'SERVICIO', status: 'ACTIVO', notes: null, fiscal: null }, requestId: 'request-2' });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(await screen.findByText('Pendientes')).toBeInTheDocument();
  });

  it('returns to providers after success', async () => {
    api.createProvider.mockResolvedValue({ provider: { id: '121', commercialName: 'Novapak', providerType: 'PROVEEDOR', status: 'ACTIVO', notes: null, fiscal: null }, requestId: 'request-back' });
    const user = userEvent.setup();
    renderPageWithProvidersRoute();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    await screen.findByRole('heading', { name: 'Proveedor registrado' });
    await user.click(screen.getAllByRole('button', { name: 'Volver a proveedores' })[1]!);
    expect(screen.getByText('Providers route')).toBeInTheDocument();
  });

  it.each([
    ['PROVIDER_NAME_ALREADY_EXISTS', 'Ya existe un proveedor o empresa con ese nombre comercial.'],
    ['RFC_ALREADY_EXISTS', 'Ya existe una empresa registrada con ese RFC.']
  ])('keeps form values and shows conflict %s', async (code, message) => {
    api.createProvider.mockRejectedValue({ code, requestId: 'request-3' });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    if (code === 'RFC_ALREADY_EXISTS') {
      await user.type(screen.getByLabelText('Razón social'), 'Novapak SA');
      await user.type(screen.getByLabelText('RFC'), 'ABC123456XYZ');
    }
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Nombre comercial/ })).toHaveValue('Novapak');
  });

  it('shows a safe generic failure with a support reference', async () => {
    api.createProvider.mockRejectedValue({ requestId: 'request-4' });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(await screen.findByText('No fue posible registrar el proveedor. Inténtalo nuevamente. Referencia: request-4')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Nombre comercial/ })).toHaveValue('Novapak');
  });
});
