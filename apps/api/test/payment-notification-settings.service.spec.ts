import { describe, expect, it, vi } from 'vitest';
import { PaymentNotificationSettingsService } from '../src/payment-notification-settings/payment-notification-settings.service';
import type { PaymentNotificationSettingsRow } from '../src/payment-notification-settings/payment-notification-settings.repository';

const identity = { userId: '5', userEmail: 'user@daubert.mx' };

function row(overrides: Partial<PaymentNotificationSettingsRow> = {}): PaymentNotificationSettingsRow {
  return {
    company_id: '9007199254740993',
    dropbox_path: 'FLETES/TRANSPORTES KARINA',
    has_settings_row: true,
    processes_payment_receipts: true,
    notifications_active: false,
    destination_path: 'FLETES\\TRANSPORTES KARINA\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
    has_operable_para_recipient: true,
    ...overrides
  };
}

describe('PaymentNotificationSettingsService', () => {
  describe('get', () => {
    it('maps to camelCase without exposing snake_case columns, keeping the BIGINT id as a string', async () => {
      const service = new PaymentNotificationSettingsService({ find: vi.fn().mockResolvedValue(row()) } as never);
      const { data } = await service.get('9007199254740993');
      expect(data).toEqual({
        companyId: '9007199254740993',
        dropboxPath: 'FLETES/TRANSPORTES KARINA',
        processesPaymentReceipts: true,
        notificationsActive: false,
        destinationPath: 'FLETES\\TRANSPORTES KARINA\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
        readiness: { ready: true, missingRequirements: [] }
      });
      expect(JSON.stringify(data)).not.toMatch(/procesa_|notificaciones_activas|ruta_|has_settings_row/);
    });

    it('historical company without a settings row: safe defaults and everything missing, no destination', async () => {
      const service = new PaymentNotificationSettingsService({
        find: vi.fn().mockResolvedValue(row({ dropbox_path: null, has_settings_row: false, processes_payment_receipts: false, notifications_active: false, destination_path: null, has_operable_para_recipient: false }))
      } as never);
      const { data } = await service.get('120');
      expect(data.processesPaymentReceipts).toBe(false);
      expect(data.notificationsActive).toBe(false);
      expect(data.destinationPath).toBeNull();
      expect(data.readiness).toEqual({ ready: false, missingRequirements: ['DROPBOX_PATH_REQUIRED', 'PAYMENT_PROCESSING_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'] });
    });

    it('never exposes the schema-default destination when there is no dropbox path', async () => {
      const service = new PaymentNotificationSettingsService({
        find: vi.fn().mockResolvedValue(row({ dropbox_path: null, destination_path: 'PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}' }))
      } as never);
      expect((await service.get('7')).data.destinationPath).toBeNull();
    });

    it.each([
      ['missing path', { dropbox_path: null }, ['DROPBOX_PATH_REQUIRED']],
      ['processing off', { processes_payment_receipts: false }, ['PAYMENT_PROCESSING_REQUIRED']],
      ['no operable PARA (CC/CCO only, inactive contact or method, non-email, recibe=false)', { has_operable_para_recipient: false }, ['PAYMENT_RECIPIENT_PARA_REQUIRED']]
    ])('readiness: %s', async (_label, overrides, missing) => {
      const service = new PaymentNotificationSettingsService({ find: vi.fn().mockResolvedValue(row(overrides)) } as never);
      const { readiness } = (await service.get('7')).data;
      expect(readiness).toEqual({ ready: false, missingRequirements: missing });
    });

    it('readiness: several valid PARA recipients are still just "ready" (a single boolean from the backend)', async () => {
      const service = new PaymentNotificationSettingsService({ find: vi.fn().mockResolvedValue(row()) } as never);
      expect((await service.get('7')).data.readiness.ready).toBe(true);
    });

    it('throws 404 for an unknown company', async () => {
      const service = new PaymentNotificationSettingsService({ find: vi.fn().mockResolvedValue(null) } as never);
      await expect(service.get('999')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('update', () => {
    it('rejects an empty body before touching the repository', async () => {
      const update = vi.fn();
      const service = new PaymentNotificationSettingsService({ update } as never);
      await expect(service.update('7', {}, 'req-1', identity)).rejects.toMatchObject({ status: 400 });
      expect(update).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown company', async () => {
      const service = new PaymentNotificationSettingsService({ update: vi.fn().mockResolvedValue({ status: 'NOT_FOUND' }) } as never);
      await expect(service.update('999', { notificationsActive: false }, 'req-1', identity)).rejects.toMatchObject({ status: 404 });
    });

    it('activation of an incomplete company: structured PAYMENT_NOTIFICATIONS_NOT_READY (409) with safe requirement codes', async () => {
      const current = row({ dropbox_path: null, processes_payment_receipts: false, has_operable_para_recipient: false });
      const service = new PaymentNotificationSettingsService({ update: vi.fn().mockResolvedValue({ status: 'NOT_READY', current }) } as never);
      const failure = await service.update('7', { notificationsActive: true }, 'req-1', identity).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        status: 409,
        response: { code: 'PAYMENT_NOTIFICATIONS_NOT_READY', missingRequirements: ['DROPBOX_PATH_REQUIRED', 'PAYMENT_PROCESSING_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'] }
      });
      expect(JSON.stringify((failure as { response: unknown }).response)).not.toMatch(/SELECT|INSERT|core\.|constraint/i);
    });

    it('activation error reflects a processing flag requested in the same PATCH', async () => {
      const current = row({ processes_payment_receipts: false });
      const service = new PaymentNotificationSettingsService({ update: vi.fn().mockResolvedValue({ status: 'NOT_READY', current }) } as never);
      // processesPaymentReceipts=true is requested together with the activation, so it is not "missing".
      await expect(service.update('7', { processesPaymentReceipts: true, notificationsActive: true }, 'req-1', identity)).rejects.toMatchObject({ response: { missingRequirements: [] } });
    });

    it('activation of a complete company succeeds and returns the persisted state', async () => {
      const updated = row({ notifications_active: true });
      const update = vi.fn().mockResolvedValue({ status: 'UPDATED', current: updated });
      const service = new PaymentNotificationSettingsService({ update } as never);
      const { data } = await service.update('7', { notificationsActive: true }, 'req-1', identity);
      expect(data.notificationsActive).toBe(true);
      expect(update).toHaveBeenCalledWith('7', { notificationsActive: true }, expect.any(Function), 'req-1', identity);
    });

    it('passes a readiness callback that uses the RESULTING processing flag', async () => {
      const update = vi.fn().mockResolvedValue({ status: 'UPDATED', current: row({ notifications_active: true }) });
      const service = new PaymentNotificationSettingsService({ update } as never);
      await service.update('7', { notificationsActive: true }, 'req-1', identity);
      const isReady = update.mock.calls[0]![2] as (r: PaymentNotificationSettingsRow, n: { processesPaymentReceipts: boolean; notificationsActive: boolean }) => boolean;
      expect(isReady(row(), { processesPaymentReceipts: true, notificationsActive: true })).toBe(true);
      expect(isReady(row(), { processesPaymentReceipts: false, notificationsActive: true })).toBe(false);
      expect(isReady(row({ has_operable_para_recipient: false }), { processesPaymentReceipts: true, notificationsActive: true })).toBe(false);
      expect(isReady(row({ dropbox_path: null }), { processesPaymentReceipts: true, notificationsActive: true })).toBe(false);
    });

    it('deactivation is always allowed, whatever the readiness', async () => {
      const current = row({ dropbox_path: null, processes_payment_receipts: false, has_operable_para_recipient: false, notifications_active: false });
      const update = vi.fn().mockResolvedValue({ status: 'UPDATED', current });
      const service = new PaymentNotificationSettingsService({ update } as never);
      await expect(service.update('7', { notificationsActive: false }, 'req-1', identity)).resolves.toMatchObject({ data: { notificationsActive: false } });
    });
  });
});
