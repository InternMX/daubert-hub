import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPaymentNotificationSettings, PaymentNotificationSettingsApiError, updatePaymentNotificationSettings } from './paymentNotificationSettings';

afterEach(() => vi.unstubAllGlobals());

const settings = {
  companyId: '9007199254740993',
  dropboxPath: 'FLETES/TRANSPORTES KARINA',
  processesPaymentReceipts: true,
  notificationsActive: false,
  destinationPath: 'FLETES\\TRANSPORTES KARINA\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}',
  readiness: { ready: true, missingRequirements: [] as string[] }
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('getPaymentNotificationSettings', () => {
  it('requests the company endpoint with the exact id string (BIGINT-safe) and returns the camelCase contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: settings }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await getPaymentNotificationSettings('9007199254740993');
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/9007199254740993/payment-notification-settings', undefined);
    expect(result).toEqual(settings);
    expect(typeof result.companyId).toBe('string');
  });

  it('accepts null path/destination and a list of known requirement codes', async () => {
    const incomplete = { ...settings, dropboxPath: null, destinationPath: null, processesPaymentReceipts: false, readiness: { ready: false, missingRequirements: ['DROPBOX_PATH_REQUIRED', 'PAYMENT_PROCESSING_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: incomplete })));
    await expect(getPaymentNotificationSettings('7')).resolves.toEqual(incomplete);
  });

  it.each([
    ['a missing flag', { ...settings, notificationsActive: undefined }],
    ['a numeric company id', { ...settings, companyId: 7 }],
    ['an unknown requirement code', { ...settings, readiness: { ready: false, missingRequirements: ['SELECT * FROM x'] } }],
    ['no readiness', { ...settings, readiness: undefined }]
  ])('rejects a malformed response (%s)', async (_label, data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data })));
    await expect(getPaymentNotificationSettings('7')).rejects.toBeInstanceOf(PaymentNotificationSettingsApiError);
  });

  it('surfaces the HTTP status and status 0 for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ statusCode: 404, message: 'Empresa no encontrada.' }, 404)));
    await expect(getPaymentNotificationSettings('9')).rejects.toMatchObject({ status: 404 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(getPaymentNotificationSettings('9')).rejects.toMatchObject({ status: 0 });
  });
});

describe('updatePaymentNotificationSettings', () => {
  it('PATCHes only the supplied flags as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { ...settings, notificationsActive: true } }));
    vi.stubGlobal('fetch', fetchMock);
    await updatePaymentNotificationSettings('7', { notificationsActive: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/companies/7/payment-notification-settings');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ notificationsActive: true });
  });

  it('exposes the backend PAYMENT_NOTIFICATIONS_NOT_READY code and requirement list on a 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ statusCode: 409, code: 'PAYMENT_NOTIFICATIONS_NOT_READY', message: 'x', missingRequirements: ['DROPBOX_PATH_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'] }, 409, { 'x-request-id': 'req-9' })));
    const failure = await updatePaymentNotificationSettings('7', { notificationsActive: true }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PaymentNotificationSettingsApiError);
    expect(failure).toMatchObject({ status: 409, code: 'PAYMENT_NOTIFICATIONS_NOT_READY', requestId: 'req-9', missingRequirements: ['DROPBOX_PATH_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED'] });
  });
});
