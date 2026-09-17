import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentNotificationsWebhookClient } from '../src/automations/payment-notifications/payment-notifications-webhook.client';

function configWith(overrides: Partial<{ reprocessWebhookUrl: string | null; webhookToken: string | null }> = {}) {
  const value = { reprocessWebhookUrl: 'https://n8n.test/webhook/reprocess', webhookToken: 'secret-token', ...overrides };
  return { get: vi.fn().mockReturnValue(value) };
}

// PN1.2 final scope cleanup: triggerRun/RUN webhook coverage was removed along with "Ejecutar
// ahora" — the production n8n workflow already polls independently. Reprocesar is unaffected.
describe('PaymentNotificationsWebhookClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('triggerReprocess', () => {
    it('POSTs the correo_id to the reprocess webhook with the shared header token, server-to-server only', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as never;
      const client = new PaymentNotificationsWebhookClient(configWith() as never);

      await expect(client.triggerReprocess('77')).resolves.toBe('ACCEPTED');

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://n8n.test/webhook/reprocess');
      expect((init.headers as Record<string, string>)['X-Daubert-Automation-Token']).toBe('secret-token');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ correo_id: '77' });
    });

    it('returns UPSTREAM_ERROR on a non-2xx response, without throwing', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false }) as never;
      const client = new PaymentNotificationsWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('77')).resolves.toBe('UPSTREAM_ERROR');
    });

    it('returns UPSTREAM_ERROR on a network failure or timeout, without leaking the underlying error, correo_id, or URL', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED at https://n8n.internal/secret-path?token=abc')) as never;
      const client = new PaymentNotificationsWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('999999999999999')).resolves.toBe('UPSTREAM_ERROR');
    });

    it('returns NOT_CONFIGURED without calling fetch when the webhook URL is missing', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as never;
      const client = new PaymentNotificationsWebhookClient(configWith({ reprocessWebhookUrl: null }) as never);
      await expect(client.triggerReprocess('77')).resolves.toBe('NOT_CONFIGURED');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns NOT_CONFIGURED without calling fetch when the webhook token is missing', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as never;
      const client = new PaymentNotificationsWebhookClient(configWith({ webhookToken: null }) as never);
      await expect(client.triggerReprocess('77')).resolves.toBe('NOT_CONFIGURED');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('no longer exposes a triggerRun method', () => {
    const client = new PaymentNotificationsWebhookClient(configWith() as never);
    expect((client as unknown as Record<string, unknown>).triggerRun).toBeUndefined();
  });
});
