import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactApiError } from '../services/contacts';
import { PaymentNotificationSettingsApiError, type PaymentNotificationSettings } from '../services/paymentNotificationSettings';
import { CompanyPaymentNotificationSettingsSection } from './CompanyPaymentNotificationSettingsSection';

const api = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn(), getDirectory: vi.fn(), editMethod: vi.fn(), addMethod: vi.fn(), createContact: vi.fn() }));

vi.mock('../services/paymentNotificationSettings', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/paymentNotificationSettings')>()), getPaymentNotificationSettings: api.getSettings, updatePaymentNotificationSettings: api.updateSettings }));
vi.mock('../services/contactDirectory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contactDirectory')>()), getContactDirectoryCompany: api.getDirectory }));
vi.mock('../services/contactMethods', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contactMethods')>()), editContactMethod: api.editMethod, addContactMethod: api.addMethod }));
vi.mock('../services/contacts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contacts')>()), createContact: api.createContact }));

// BIGINT-sized id: it must reach the API as a string.
const COMPANY = '9007199254740993123';
const base: PaymentNotificationSettings = { companyId: COMPANY, dropboxPath: 'PROVEEDORES/NOVAPAK', processesPaymentReceipts: true, notificationsActive: false, destinationPath: 'PROVEEDORES\\NOVAPAK\\PAGOS', readiness: { ready: true, missingRequirements: [] } };
const incomplete: PaymentNotificationSettings = { ...base, processesPaymentReceipts: false, readiness: { ready: false, missingRequirements: ['PAYMENT_PROCESSING_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'] } };
const active: PaymentNotificationSettings = { ...base, notificationsActive: true };

const ACTIVATE = { name: 'Activar notificaciones' };
function renderSection() { return render(<CompanyPaymentNotificationSettingsSection companyId={COMPANY} />); }
async function confirm(user: ReturnType<typeof userEvent.setup>, label: 'Activar' | 'Desactivar') {
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: label }));
}

beforeEach(() => {
  api.getDirectory.mockResolvedValue({ company: { id: COMPANY, commercialName: 'Novapak', companyType: 'PROVEEDOR' }, contacts: [], inactiveContacts: [] });
});
afterEach(() => vi.clearAllMocks());

describe('Notificaciones de pago — tres estados (los decide el backend)', () => {
  it('Incompleta: muestra "Faltan requisitos", los pendientes y la acción para resolverlos, y NO muestra activar ni desactivar', async () => {
    api.getSettings.mockResolvedValue(incomplete);
    renderSection();
    expect(await screen.findByText('Faltan requisitos')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Requisitos pendientes' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Configurar destinatarios' })).toBeInTheDocument();
    expect(screen.queryByRole('button', ACTIVATE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar temporalmente' })).not.toBeInTheDocument();
    expect(screen.queryByText('Lista para activar')).not.toBeInTheDocument();
    expect(screen.queryByText('Notificaciones activas')).not.toBeInTheDocument();
  });

  it('el botón Activar aparece solo con readiness.ready=true y notificationsActive=false', async () => {
    api.getSettings.mockResolvedValue(base);
    const { unmount } = renderSection();
    expect(await screen.findByText('Lista para activar')).toBeInTheDocument();
    expect(screen.getByRole('button', ACTIVATE)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Requisitos pendientes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar destinatarios' })).not.toBeInTheDocument();
    unmount();
    // Falta configuración (aunque no falte PARA): no aparece.
    api.getSettings.mockResolvedValue({ ...base, readiness: { ready: false, missingRequirements: ['DROPBOX_PATH_REQUIRED'] } });
    const second = renderSection();
    await screen.findByText('Faltan requisitos');
    expect(screen.queryByRole('button', ACTIVATE)).not.toBeInTheDocument();
    second.unmount();
    // Ya activa: tampoco.
    api.getSettings.mockResolvedValue(active);
    renderSection();
    await screen.findByText('Notificaciones activas');
    expect(screen.queryByRole('button', ACTIVATE)).not.toBeInTheDocument();
  });

  it('Activa: muestra "Notificaciones activas" con "Desactivar temporalmente" y "Administrar destinatarios", sin requisitos ni activar', async () => {
    api.getSettings.mockResolvedValue(active);
    renderSection();
    expect(await screen.findByText('Notificaciones activas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar temporalmente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Administrar destinatarios' })).toBeInTheDocument();
    expect(screen.queryByRole('button', ACTIVATE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar destinatarios' })).not.toBeInTheDocument();
    expect(screen.queryByText('Faltan requisitos')).not.toBeInTheDocument();
  });

  it('"Administrar destinatarios" abre el panel de destinatarios existente', async () => {
    api.getSettings.mockResolvedValue(active);
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Administrar destinatarios' }));
    expect(await screen.findByRole('dialog', { name: 'Destinatarios de notificaciones de pago' })).toBeInTheDocument();
    expect(api.getDirectory).toHaveBeenCalledWith(COMPANY);
  });
});

describe('Activa pero incompleta (notificationsActive=true, readiness.ready=false)', () => {
  const activeIncomplete: PaymentNotificationSettings = { ...active, readiness: { ready: false, missingRequirements: ['PAYMENT_RECIPIENT_PARA_REQUIRED'] } };

  it('muestra "Activa pero incompleta", la explicación y los requisitos del backend; no afirma que esté lista ni activa completa', async () => {
    api.getSettings.mockResolvedValue(activeIncomplete);
    renderSection();
    expect(await screen.findByText('Activa pero incompleta')).toBeInTheDocument();
    expect(screen.getByText(/activas, pero falta completar requisitos de configuración/)).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Requisitos pendientes' })).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(/destinatario PARA/);
    expect(screen.queryByText('Notificaciones activas')).not.toBeInTheDocument();
    expect(screen.queryByText('Lista para activar')).not.toBeInTheDocument();
    expect(screen.queryByText('Faltan requisitos')).not.toBeInTheDocument();
  });

  it('NO muestra Activar; sí Desactivar temporalmente y Administrar destinatarios (sin duplicar con Configurar)', async () => {
    api.getSettings.mockResolvedValue(activeIncomplete);
    renderSection();
    await screen.findByText('Activa pero incompleta');
    expect(screen.queryByRole('button', ACTIVATE)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar temporalmente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Administrar destinatarios' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configurar destinatarios' })).not.toBeInTheDocument();
  });

  it('muestra solo lo que dice el backend: sin inventar requisitos aunque falten destinatarios o Dropbox en otros campos', async () => {
    api.getSettings.mockResolvedValue({ ...activeIncomplete, dropboxPath: null, processesPaymentReceipts: false, readiness: { ready: false, missingRequirements: ['DROPBOX_PATH_REQUIRED'] } });
    renderSection();
    await screen.findByText('Activa pero incompleta');
    const items = within(screen.getByRole('list', { name: 'Requisitos pendientes' })).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(/ruta de Dropbox/);
  });

  it('respeta readiness.ready=false aunque no haya requisitos listados (no se recalcula en React)', async () => {
    api.getSettings.mockResolvedValue({ ...activeIncomplete, readiness: { ready: false, missingRequirements: [] } });
    renderSection();
    expect(await screen.findByText('Activa pero incompleta')).toBeInTheDocument();
    expect(screen.queryByText('Notificaciones activas')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Requisitos pendientes' })).not.toBeInTheDocument();
  });

  it('Desactivar envía { notificationsActive: false } con id string, vuelve a consultar y no toca destinatarios ni Procesa comprobantes', async () => {
    api.getSettings.mockResolvedValueOnce(activeIncomplete).mockResolvedValue({ ...incomplete, processesPaymentReceipts: true });
    api.updateSettings.mockResolvedValue({ ...incomplete, processesPaymentReceipts: true });
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Desactivar temporalmente' }));
    await confirm(user, 'Desactivar');
    expect(await screen.findByText('Faltan requisitos')).toBeInTheDocument();
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
    expect(api.updateSettings).toHaveBeenCalledWith(COMPANY, { notificationsActive: false });
    expect(typeof api.updateSettings.mock.calls[0]![0]).toBe('string');
    expect(Object.keys(api.updateSettings.mock.calls[0]![1] as object)).toEqual(['notificationsActive']);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('switch', { name: 'Procesa comprobantes' })).toBeChecked();
    expect(api.editMethod).not.toHaveBeenCalled();
    expect(api.addMethod).not.toHaveBeenCalled();
    expect(api.createContact).not.toHaveBeenCalled();
  });

  it('un 409 ACTIVE_REQUIRES_PARA al desactivar mantiene el mensaje existente y sigue "Activa pero incompleta"', async () => {
    api.getSettings.mockResolvedValue(activeIncomplete);
    api.updateSettings.mockRejectedValue(new PaymentNotificationSettingsApiError(409, 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA', 'req-4'));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Desactivar temporalmente' }));
    await confirm(user, 'Desactivar');
    expect(await screen.findByText(/último destinatario PARA de una empresa con Notificaciones de Pago activas/)).toBeInTheDocument();
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Activa pero incompleta')).toBeInTheDocument();
  });

  it('"Administrar destinatarios" abre el panel existente con el id BIGINT como string', async () => {
    api.getSettings.mockResolvedValue(activeIncomplete);
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Administrar destinatarios' }));
    expect(await screen.findByRole('dialog', { name: 'Destinatarios de notificaciones de pago' })).toBeInTheDocument();
    expect(api.getDirectory).toHaveBeenCalledWith(COMPANY);
  });
});

describe('Activar notificaciones', () => {
  it('envía el PATCH existente con { notificationsActive: true } y el id BIGINT como string, y luego refresca settings', async () => {
    api.getSettings.mockResolvedValueOnce(base).mockResolvedValue(active);
    api.updateSettings.mockResolvedValue(active);
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', ACTIVATE));
    await confirm(user, 'Activar');
    expect(await screen.findByText('Notificaciones activas')).toBeInTheDocument();
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
    expect(api.updateSettings).toHaveBeenCalledWith(COMPANY, { notificationsActive: true });
    expect(typeof api.updateSettings.mock.calls[0]![0]).toBe('string');
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
    expect(api.getSettings.mock.calls.every(([id]) => id === COMPANY)).toBe(true);
  });

  it('lo que se muestra es lo último que dice el backend, no lo que respondió el PATCH', async () => {
    api.getSettings.mockResolvedValueOnce(base).mockResolvedValue(base); // el refresh dice que sigue sin activa
    api.updateSettings.mockResolvedValue(active);
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', ACTIVATE));
    await confirm(user, 'Activar');
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Lista para activar')).toBeInTheDocument();
    expect(screen.queryByText('Notificaciones activas')).not.toBeInTheDocument();
  });

  it('cancelar el diálogo no muta nada ni consulta de nuevo', async () => {
    api.getSettings.mockResolvedValue(base);
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', ACTIVATE));
    expect(await screen.findByRole('dialog', { name: 'Activar notificaciones de pago' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Lista para activar')).toBeInTheDocument();
  });

  it('409 PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA: mensaje seguro existente y el estado vuelve a lo que dice el backend (no activa)', async () => {
    api.getSettings.mockResolvedValueOnce(base).mockResolvedValue(base);
    api.updateSettings.mockRejectedValue(new PaymentNotificationSettingsApiError(409, 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA', 'req-1'));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', ACTIVATE));
    await confirm(user, 'Activar');
    expect(await screen.findByText(/último destinatario PARA de una empresa con Notificaciones de Pago activas/)).toBeInTheDocument();
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Notificaciones activas')).not.toBeInTheDocument();
    expect(screen.getByText('Lista para activar')).toBeInTheDocument();
    // El mensaje sobrevive al refresh de re-sincronización.
    expect(screen.getByText(/último destinatario PARA/)).toBeInTheDocument();
  });

  it('409 NOT_READY: muestra los requisitos del backend y re-sincroniza; nunca queda "activa"', async () => {
    api.getSettings.mockResolvedValueOnce(base).mockResolvedValue({ ...base, readiness: { ready: false, missingRequirements: ['PAYMENT_RECIPIENT_PARA_REQUIRED'] } });
    api.updateSettings.mockRejectedValue(new PaymentNotificationSettingsApiError(409, 'PAYMENT_NOTIFICATIONS_NOT_READY', 'req-2', ['PAYMENT_RECIPIENT_PARA_REQUIRED']));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', ACTIVATE));
    await confirm(user, 'Activar');
    expect(await screen.findByText(/No se pueden activar las notificaciones de pago todavía/)).toBeInTheDocument();
    expect(await screen.findByText('Faltan requisitos')).toBeInTheDocument();
    expect(screen.queryByText('Notificaciones activas')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', ACTIVATE)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Configurar destinatarios' })).toBeInTheDocument();
  });
});

describe('Desactivar temporalmente', () => {
  it('envía { notificationsActive: false } con el id como string, refresca y conserva toda la configuración', async () => {
    api.getSettings.mockResolvedValueOnce(active).mockResolvedValue(base);
    api.updateSettings.mockResolvedValue(base);
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Desactivar temporalmente' }));
    await confirm(user, 'Desactivar');
    expect(await screen.findByText('Lista para activar')).toBeInTheDocument();
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
    expect(api.updateSettings).toHaveBeenCalledWith(COMPANY, { notificationsActive: false });
    expect(typeof api.updateSettings.mock.calls[0]![0]).toBe('string');
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
    // Nada se borra: ruta Dropbox, destino, Procesa comprobantes y destinatarios siguen igual y no hubo otras mutaciones.
    expect(screen.getByText('PROVEEDORES/NOVAPAK')).toBeInTheDocument();
    expect(screen.getByText('PROVEEDORES\\NOVAPAK\\PAGOS')).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Procesa comprobantes' })).toBeChecked();
    expect(api.editMethod).not.toHaveBeenCalled();
    expect(api.addMethod).not.toHaveBeenCalled();
    expect(api.createContact).not.toHaveBeenCalled();
    expect(Object.keys(api.updateSettings.mock.calls[0]![1] as object)).toEqual(['notificationsActive']);
    expect(await screen.findByRole('button', ACTIVATE)).toBeInTheDocument(); // se puede volver a activar
  });

  it('cancelar el diálogo no muta nada', async () => {
    api.getSettings.mockResolvedValue(active);
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Desactivar temporalmente' }));
    expect(await screen.findByRole('dialog', { name: 'Desactivar notificaciones de pago' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Notificaciones activas')).toBeInTheDocument();
  });

  it('un 409 PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA no deja un estado falso: mensaje seguro y el estado vuelve a lo persistido (sigue activa)', async () => {
    api.getSettings.mockResolvedValueOnce(active).mockResolvedValue(active);
    api.updateSettings.mockRejectedValue(new ContactApiError(409, 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA', 'req-3'));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Desactivar temporalmente' }));
    await confirm(user, 'Desactivar');
    expect(await screen.findByText(/último destinatario PARA de una empresa con Notificaciones de Pago activas/)).toBeInTheDocument();
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Notificaciones activas')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Desactivar temporalmente' })).toBeInTheDocument();
  });

  it('un error genérico al desactivar muestra el aviso y re-sincroniza con el backend', async () => {
    api.getSettings.mockResolvedValue(active);
    api.updateSettings.mockRejectedValue(new PaymentNotificationSettingsApiError(500, undefined, 'req-9'));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Desactivar temporalmente' }));
    await confirm(user, 'Desactivar');
    expect(await screen.findByText(/No fue posible guardar la configuración.*req-9/)).toBeInTheDocument();
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Notificaciones activas')).toBeInTheDocument();
  });
});
