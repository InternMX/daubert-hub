import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewProviderPage } from './NewProviderPage';

const api = vi.hoisted(() => ({ createProvider: vi.fn(), updatePaymentNotificationSettings: vi.fn() }));

vi.mock('../services/providers', () => ({ createProvider: api.createProvider }));
vi.mock('../services/paymentNotificationSettings', () => ({ updatePaymentNotificationSettings: api.updatePaymentNotificationSettings }));

// Stand-in for the existing provider detail: exposes the id from the route and the navigation state it receives.
function DetailProbe() {
  const { id } = useParams();
  const { state } = useLocation();
  return <div><span data-testid="id">{id}</span><span data-testid="state">{JSON.stringify(state)}</span></div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/providers/new']}>
      <Routes>
        <Route path="/providers/new" element={<NewProviderPage />} />
        <Route path="/providers" element={<div>Providers route</div>} />
        <Route path="/providers/:id" element={<DetailProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

const BIG_ID = '9007199254740993123';
const created = (over: Record<string, unknown> = {}) => ({ provider: { id: BIG_ID, commercialName: 'Novapak', providerType: 'PROVEEDOR', status: 'ACTIVO', notes: null, fiscal: null, ...over }, requestId: 'r-1' });

async function fillAndChooseNow(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'Novapak');
  await user.click(screen.getByRole('combobox', { name: /Tipo de proveedor/ }));
  await user.click(screen.getByRole('option', { name: 'Proveedor' }));
  await user.click(screen.getByRole('radio', { name: 'Configurar ahora' }));
}

afterEach(() => vi.clearAllMocks());

describe('NewProviderPage — Notificaciones de pago (Configurar ahora / después)', () => {
  it('"Configurar después" mantiene el flujo de siempre: estado de éxito, sin llamar a notificaciones y sin rutaDropbox', async () => {
    api.createProvider.mockResolvedValue(created());
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'Novapak');
    await user.click(screen.getByRole('combobox', { name: /Tipo de proveedor/ }));
    await user.click(screen.getByRole('option', { name: 'Proveedor' }));
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(await screen.findByRole('heading', { name: 'Proveedor registrado' })).toBeInTheDocument();
    expect(api.createProvider).toHaveBeenCalledWith({ commercialName: 'Novapak', providerType: 'PROVEEDOR', fiscal: null, notes: null });
    expect(api.updatePaymentNotificationSettings).not.toHaveBeenCalled();
  });

  it('"Guardar y continuar" crea primero el proveedor con rutaDropbox y continúa en la ficha usando el id del backend como string', async () => {
    api.createProvider.mockResolvedValue(created());
    const user = userEvent.setup();
    renderPage();
    await fillAndChooseNow(user);
    await user.type(screen.getByRole('textbox', { name: 'Ruta de Dropbox' }), 'PROVEEDORES/NOVAPAK');
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByTestId('id')).toHaveTextContent(BIG_ID);
    expect(api.createProvider).toHaveBeenCalledTimes(1);
    expect(api.createProvider).toHaveBeenCalledWith({ commercialName: 'Novapak', providerType: 'PROVEEDOR', fiscal: null, notes: null, rutaDropbox: 'PROVEEDORES/NOVAPAK' });
    const state = JSON.parse(screen.getByTestId('state').textContent ?? '{}') as Record<string, unknown>;
    expect(state).toMatchObject({ directoryPath: '/providers', paymentNotificationSetup: true, processesReceiptsSaved: true });
    expect(state.successMessage).toBe('Novapak se registró correctamente.');
    expect(JSON.stringify(state)).not.toMatch(/NOW|LATER/);
    // Sin "Procesa comprobantes" no hay ninguna llamada extra y no se crean contactos.
    expect(api.updatePaymentNotificationSettings).not.toHaveBeenCalled();
  });

  it('con "Procesa comprobantes": primero se crea el proveedor y luego se usa el PATCH existente con el id string', async () => {
    api.createProvider.mockResolvedValue(created());
    api.updatePaymentNotificationSettings.mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();
    await fillAndChooseNow(user);
    await user.click(screen.getByRole('switch', { name: 'Procesa comprobantes' }));
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByTestId('id')).toHaveTextContent(BIG_ID);
    expect(api.updatePaymentNotificationSettings).toHaveBeenCalledTimes(1);
    expect(api.updatePaymentNotificationSettings).toHaveBeenCalledWith(BIG_ID, { processesPaymentReceipts: true });
    expect(typeof api.updatePaymentNotificationSettings.mock.calls[0]![0]).toBe('string');
    expect(api.createProvider.mock.invocationCallOrder[0]!).toBeLessThan(api.updatePaymentNotificationSettings.mock.invocationCallOrder[0]!);
  });

  it('si el PATCH falla, el proveedor NO se revierte: se continúa en la ficha con un aviso', async () => {
    api.createProvider.mockResolvedValue(created());
    api.updatePaymentNotificationSettings.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderPage();
    await fillAndChooseNow(user);
    await user.click(screen.getByRole('switch', { name: 'Procesa comprobantes' }));
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByTestId('id')).toHaveTextContent(BIG_ID);
    expect(JSON.parse(screen.getByTestId('state').textContent ?? '{}')).toMatchObject({ paymentNotificationSetup: true, processesReceiptsSaved: false });
    expect(api.createProvider).toHaveBeenCalledTimes(1);
  });

  it('un error de creación NO avanza: se queda en el formulario, conserva los datos y no toca notificaciones', async () => {
    api.createProvider.mockRejectedValue({ requestId: 'r-err' });
    const user = userEvent.setup();
    renderPage();
    await fillAndChooseNow(user);
    await user.click(screen.getByRole('switch', { name: 'Procesa comprobantes' }));
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByText('No fue posible registrar el proveedor. Inténtalo nuevamente. Referencia: r-err')).toBeInTheDocument();
    expect(screen.queryByTestId('id')).not.toBeInTheDocument();
    expect(api.updatePaymentNotificationSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Nombre comercial/ })).toHaveValue('Novapak');
    expect(screen.getByRole('radio', { name: 'Configurar ahora' })).toBeChecked();
  });

  it('un conflicto de nombre tampoco avanza', async () => {
    api.createProvider.mockRejectedValue({ code: 'PROVIDER_NAME_ALREADY_EXISTS', requestId: 'r-2' });
    const user = userEvent.setup();
    renderPage();
    await fillAndChooseNow(user);
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByText('Ya existe un proveedor o empresa con ese nombre comercial.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('id')).not.toBeInTheDocument());
  });

  it('Cancelar sigue volviendo a proveedores, también con "Configurar ahora"', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Configurar ahora' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Providers route')).toBeInTheDocument();
    expect(api.createProvider).not.toHaveBeenCalled();
  });
});
