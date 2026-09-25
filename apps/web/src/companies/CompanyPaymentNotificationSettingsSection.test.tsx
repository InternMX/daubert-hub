import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPaymentNotificationSettings,
  PaymentNotificationSettingsApiError,
  updatePaymentNotificationSettings,
  type PaymentNotificationSettings
} from '../services/paymentNotificationSettings';
import { CompanyPaymentNotificationSettingsSection } from './CompanyPaymentNotificationSettingsSection';

vi.mock('../services/paymentNotificationSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/paymentNotificationSettings')>()),
  getPaymentNotificationSettings: vi.fn(),
  updatePaymentNotificationSettings: vi.fn()
}));

const getMock = vi.mocked(getPaymentNotificationSettings);
const updateMock = vi.mocked(updatePaymentNotificationSettings);

const DESTINATION = 'FLETES\\TRANSPORTES KARINA\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}';
const incomplete: PaymentNotificationSettings = {
  companyId: '9007199254740993',
  dropboxPath: null,
  processesPaymentReceipts: false,
  notificationsActive: false,
  destinationPath: null,
  readiness: { ready: false, missingRequirements: ['DROPBOX_PATH_REQUIRED', 'PAYMENT_PROCESSING_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'] }
};
const complete: PaymentNotificationSettings = {
  ...incomplete,
  dropboxPath: 'FLETES/TRANSPORTES KARINA',
  processesPaymentReceipts: true,
  destinationPath: DESTINATION,
  readiness: { ready: true, missingRequirements: [] }
};

afterEach(() => vi.clearAllMocks());

function section() { return screen.getByRole('region', { name: 'Notificaciones de pago' }); }

describe('CompanyPaymentNotificationSettingsSection', () => {
  it('loads with the BIGINT company id as a string and shows safe defaults (both switches off)', async () => {
    getMock.mockResolvedValue(incomplete);
    render(<CompanyPaymentNotificationSettingsSection companyId="9007199254740993" />);
    expect(await screen.findByRole('switch', { name: 'Procesa comprobantes' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Generar borradores' })).not.toBeChecked();
    expect(getMock).toHaveBeenCalledWith('9007199254740993');
    expect(within(section()).getByText('Sin ruta registrada.')).toBeInTheDocument();
    expect(within(section()).getByText('Faltan requisitos')).toBeInTheDocument();
  });

  it('lists the missing requirements exactly as the backend reports them', async () => {
    getMock.mockResolvedValue(incomplete);
    render(<CompanyPaymentNotificationSettingsSection companyId="7" />);
    const list = await screen.findByRole('list', { name: 'Requisitos pendientes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText(/ruta de Dropbox/)).toBeInTheDocument();
    expect(within(list).getByText(/Procesa comprobantes/)).toBeInTheDocument();
    expect(within(list).getByText(/destinatario PARA/)).toBeInTheDocument();
  });

  it('shows only what the backend says is missing (React never recomputes readiness)', async () => {
    getMock.mockResolvedValue({ ...incomplete, dropboxPath: 'A/B', destinationPath: 'A\\B\\x', processesPaymentReceipts: true, readiness: { ready: false, missingRequirements: ['PAYMENT_RECIPIENT_PARA_REQUIRED'] } });
    render(<CompanyPaymentNotificationSettingsSection companyId="7" />);
    const list = await screen.findByRole('list', { name: 'Requisitos pendientes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(/destinatario PARA/)).toBeInTheDocument();
  });

  it('a ready company shows the calculated destination read-only and no requirement list', async () => {
    getMock.mockResolvedValue(complete);
    render(<CompanyPaymentNotificationSettingsSection companyId="7" />);
    expect(await screen.findByText('Lista para activar')).toBeInTheDocument();
    expect(screen.getByText('FLETES/TRANSPORTES KARINA')).toBeInTheDocument();
    expect(screen.getByText(DESTINATION)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Requisitos pendientes' })).not.toBeInTheDocument();
    // Destination and path are display-only: there is no field to type them into here.
    expect(within(section()).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('activating an incomplete company shows the backend requirements, keeps the switch off and does not claim success', async () => {
    getMock.mockResolvedValue({ ...incomplete, readiness: { ready: false, missingRequirements: [] } });
    updateMock.mockRejectedValue(new PaymentNotificationSettingsApiError(409, 'PAYMENT_NOTIFICATIONS_NOT_READY', 'req-1', ['DROPBOX_PATH_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED']));
    const user = userEvent.setup();
    render(<CompanyPaymentNotificationSettingsSection companyId="7" />);
    await user.click(await screen.findByRole('switch', { name: 'Generar borradores' }));
    expect(updateMock).toHaveBeenCalledWith('7', { notificationsActive: true });
    expect(await screen.findByText(/No se pueden activar las notificaciones de pago todavía/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Requisitos pendientes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('switch', { name: 'Generar borradores' })).not.toBeChecked();
  });

  it('activating a complete company sends the flag and shows the persisted state', async () => {
    getMock.mockResolvedValue(complete);
    updateMock.mockResolvedValue({ ...complete, notificationsActive: true });
    const user = userEvent.setup();
    render(<CompanyPaymentNotificationSettingsSection companyId="7" />);
    await user.click(await screen.findByRole('switch', { name: 'Generar borradores' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Generar borradores' })).toBeChecked());
    expect(updateMock).toHaveBeenCalledWith('7', { notificationsActive: true });
    expect(screen.queryByText(/No se pueden activar/)).not.toBeInTheDocument();
  });

  it('toggling "Procesa comprobantes" sends only that flag', async () => {
    getMock.mockResolvedValue(incomplete);
    updateMock.mockResolvedValue({ ...incomplete, processesPaymentReceipts: true, readiness: { ready: false, missingRequirements: ['DROPBOX_PATH_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'] } });
    const user = userEvent.setup();
    render(<CompanyPaymentNotificationSettingsSection companyId="7" />);
    await user.click(await screen.findByRole('switch', { name: 'Procesa comprobantes' }));
    expect(updateMock).toHaveBeenCalledWith('7', { processesPaymentReceipts: true });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Procesa comprobantes' })).toBeChecked());
    expect(within(await screen.findByRole('list', { name: 'Requisitos pendientes' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('deactivating is a plain request with no readiness gating in the UI', async () => {
    getMock.mockResolvedValue({ ...complete, notificationsActive: true });
    updateMock.mockResolvedValue(complete);
    const user = userEvent.setup();
    render(<CompanyPaymentNotificationSettingsSection companyId="7" />);
    await user.click(await screen.findByRole('switch', { name: 'Generar borradores' }));
    expect(updateMock).toHaveBeenCalledWith('7', { notificationsActive: false });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Generar borradores' })).not.toBeChecked());
  });

  it('shows a generic error (with the request reference, never internals) for any other failure', async () => {
    getMock.mockResolvedValue(complete);
    updateMock.mockRejectedValue(new PaymentNotificationSettingsApiError(500, undefined, 'req-77'));
    const user = userEvent.setup();
    render(<CompanyPaymentNotificationSettingsSection companyId="7" />);
    await user.click(await screen.findByRole('switch', { name: 'Generar borradores' }));
    expect(await screen.findByText(/No fue posible guardar la configuración.*req-77/)).toBeInTheDocument();
  });

  it('a load failure shows a retryable, section-scoped error', async () => {
    getMock.mockRejectedValueOnce(new PaymentNotificationSettingsApiError(500, undefined, null)).mockResolvedValueOnce(complete);
    const user = userEvent.setup();
    render(<CompanyPaymentNotificationSettingsSection companyId="7" />);
    expect(await screen.findByText('No fue posible cargar la configuración de notificaciones de pago.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Lista para activar')).toBeInTheDocument();
  });

  it('a historical company (defaults from the backend) renders like any other', async () => {
    getMock.mockResolvedValue({ ...incomplete, companyId: '120' });
    render(<CompanyPaymentNotificationSettingsSection companyId="120" />);
    expect(await screen.findByRole('switch', { name: 'Generar borradores' })).not.toBeChecked();
  });
});
