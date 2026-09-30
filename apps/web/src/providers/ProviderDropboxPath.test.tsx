import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProvider, ProviderApiError, updateProvider } from '../services/providers';
import { EditProviderPage } from './EditProviderPage';
import { ProviderForm } from './ProviderForm';

vi.mock('../services/providers', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/providers')>()), getProvider: vi.fn(), updateProvider: vi.fn() }));
const getProviderMock = vi.mocked(getProvider);
const updateProviderMock = vi.mocked(updateProvider);

afterEach(() => vi.clearAllMocks());

async function selectType(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: /Tipo de proveedor/ }));
  await user.click(screen.getByRole('option', { name: label }));
}

describe('ProviderForm — Ruta de Dropbox', () => {
  it('shows the field with an example once "Configurar ahora" is chosen, with the later-setup explanation always visible', async () => {
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'Configurar ahora' }));
    expect(screen.getByRole('textbox', { name: 'Ruta de Dropbox' })).toBeInTheDocument();
    expect(screen.getByText(/FLETES\/TRANSPORTES KARINA/)).toBeInTheDocument();
    expect(screen.getByText('Puedes configurar las notificaciones de pago más tarde desde la ficha del proveedor.')).toBeInTheDocument();
    // No client-side destination field: ruta_destino is derived by the backend.
    expect(screen.queryByLabelText(/Destino/i)).not.toBeInTheDocument();
  });

  it('submits the trimmed relative path with the new provider', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'Configurar ahora' }));
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'TRANSPORTES KARINA');
    await selectType(user, 'Flete');
    await user.type(screen.getByRole('textbox', { name: 'Ruta de Dropbox' }), '  FLETES/TRANSPORTES KARINA  ');
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(onSubmit).toHaveBeenCalledWith({ commercialName: 'TRANSPORTES KARINA', providerType: 'FLETE', fiscal: null, notes: null, rutaDropbox: 'FLETES/TRANSPORTES KARINA' }, { processesPaymentReceipts: false });
  }, 10000);

  it('omits rutaDropbox when the field is blank (defaults false/false, no path)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'Configurar ahora' }));
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'X');
    await selectType(user, 'Flete');
    await user.type(screen.getByRole('textbox', { name: 'Ruta de Dropbox' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('rutaDropbox');
  });

  it('shows the field error when the backend rejects the path (absolute, UNC, traversal…)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new ProviderApiError(400, 'DROPBOX_PATH_ABSOLUTE', 'req-1'));
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'Configurar ahora' }));
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'X');
    await selectType(user, 'Flete');
    await user.type(screen.getByRole('textbox', { name: 'Ruta de Dropbox' }), 'C:\\Users\\06\\Dropbox');
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByText(/ruta relativa a Dropbox válida/)).toBeInTheDocument();
  });
});

describe('EditProviderPage — Ruta de Dropbox', () => {
  const provider = { id: '121', commercialName: 'Acme', providerType: 'FLETE' as const, roles: ['FLETE'], status: 'ACTIVO', notes: null, rutaDropbox: 'FLETES/ACME', aliases: [], otherAliases: [], fiscal: null };

  function renderPage() {
    return render(<MemoryRouter initialEntries={['/providers/121/edit']}><Routes><Route path="/providers/:id/edit" element={<EditProviderPage />} /><Route path="/providers/:id" element={<div>Detalle</div>} /></Routes></MemoryRouter>);
  }

  it('preloads the current path and keeps saving disabled until something changes', async () => {
    getProviderMock.mockResolvedValue(provider);
    renderPage();
    expect(await screen.findByRole('textbox', { name: 'Ruta de Dropbox' })).toHaveValue('FLETES/ACME');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('sends only the changed path, then goes back to the detail', async () => {
    getProviderMock.mockResolvedValue(provider);
    updateProviderMock.mockResolvedValue({ provider: { ...provider, rutaDropbox: 'FLETES/ACME NUEVO' } as never, requestId: 'r' });
    const user = userEvent.setup();
    renderPage();
    const field = await screen.findByRole('textbox', { name: 'Ruta de Dropbox' });
    await user.clear(field);
    await user.type(field, 'FLETES\\ACME NUEVO');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledOnce());
    expect(updateProviderMock.mock.calls[0]![1]).toMatchObject({ rutaDropbox: 'FLETES\\ACME NUEVO' });
    expect(await screen.findByText('Detalle')).toBeInTheDocument();
  });

  it('does not send rutaDropbox when only other fields change', async () => {
    getProviderMock.mockResolvedValue(provider);
    updateProviderMock.mockResolvedValue({ provider, requestId: 'r' });
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByRole('textbox', { name: /Nombre comercial/ });
    await user.clear(name);
    await user.type(name, 'Acme 2');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledOnce());
    expect(updateProviderMock.mock.calls[0]![1]).not.toHaveProperty('rutaDropbox');
  });

  it('clearing the field sends rutaDropbox: null', async () => {
    getProviderMock.mockResolvedValue(provider);
    updateProviderMock.mockResolvedValue({ provider, requestId: 'r' });
    const user = userEvent.setup();
    renderPage();
    await user.clear(await screen.findByRole('textbox', { name: 'Ruta de Dropbox' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledOnce());
    expect(updateProviderMock.mock.calls[0]![1]).toMatchObject({ rutaDropbox: null });
  });

  it.each([
    ['DROPBOX_PATH_TRAVERSAL', /ruta relativa a Dropbox válida/],
    ['PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE', /mientras las notificaciones de pago estén activas/]
  ])('maps the backend code %s to a clear message', async (code, message) => {
    getProviderMock.mockResolvedValue(provider);
    updateProviderMock.mockRejectedValue(new ProviderApiError(code === 'PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE' ? 409 : 400, code, 'req-1'));
    const user = userEvent.setup();
    renderPage();
    const field = await screen.findByRole('textbox', { name: 'Ruta de Dropbox' });
    await user.clear(field);
    await user.type(field, 'x');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
