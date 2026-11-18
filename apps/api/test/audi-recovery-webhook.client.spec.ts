import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudiRecoveryWebhookClient } from '../src/automations/remisiones-audi/audi-recovery-webhook.client';
import { validateEnvironment } from '../src/config/environment';

const input = { action: 'RECONCILE', actionId: '9007199254740994', executionId: '9007199254740993', reason: 'Motivo' } as const;
const url = 'https://example.invalid/webhook';
const token = 'fake-token';

function client(config = { url, token }) {
  return new AudiRecoveryWebhookClient({ get: () => config } as never);
}

function respond(status: number, body: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('AudiRecoveryWebhookClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads and trims either optional webhook setting independently', () => {
    const env = { DB_HOST: 'example.invalid', DB_PORT: '5432', DB_NAME: 'daubert_hub_test', DB_USER: 'test', DB_PASSWORD: 'dummy' };
    expect(validateEnvironment(env).audiRecoveryWebhook).toEqual({ url: null, token: null });
    expect(validateEnvironment({ ...env, AUDI_RECOVERY_WEBHOOK_URL: ` ${url} `, AUDI_RECOVERY_WEBHOOK_TOKEN: '  ' }).audiRecoveryWebhook)
      .toEqual({ url, token: null });
    expect(validateEnvironment({ ...env, AUDI_RECOVERY_WEBHOOK_TOKEN: ` ${token} ` }).audiRecoveryWebhook)
      .toEqual({ url: null, token });
  });

  it('sends the versioned body and header auth with redirects disabled', async () => {
    const fetch = respond(200, { accepted: true, status: 'ALREADY_DISPATCHED', actionId: input.actionId, privateBody: 'hidden' });
    await expect(client().dispatch(input)).resolves.toEqual({ kind: 'ACCEPTED', status: 'ALREADY_DISPATCHED' });
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'X-Daubert-Automation-Token': token },
      body: JSON.stringify({ contractVersion: 1, ...input }), signal: expect.any(AbortSignal)
    }));
  });

  it('does not call fetch when either setting is missing', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const config of [{ url: '', token }, { url, token: '' }]) {
      const webhook = client(config);
      expect(webhook.isConfigured()).toBe(false);
      await expect(webhook.dispatch(input)).resolves.toEqual({ kind: 'NOT_CONFIGURED' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['STOP_REQUESTED', 'NOT_RUNNING', 'ALREADY_FINISHED'])('accepts the validated STOP status %s', async (status) => {
    respond(200, { accepted: true, status, actionId: input.actionId, n8nExecutionId: '16061' });
    await expect(client().dispatch({ ...input, action: 'STOP' })).resolves.toEqual({ kind: 'ACCEPTED', status });
    await expect(client().dispatch(input)).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
  });

  it.each([
    [200, { accepted: 'true', status: 'DISPATCHED', actionId: input.actionId }],
    [200, { accepted: true, status: 'DISPATCHED', actionId: '7' }],
    [200, { accepted: true, status: 'RAW_SECRET', actionId: input.actionId }],
    [200, { accepted: true, status: 'STOP_REQUESTED', actionId: input.actionId, n8nExecutionId: 16061 }],
    [409, { accepted: false, error: 'RAW_SECRET' }],
    [409, { accepted: true, status: 'DISPATCHED', actionId: input.actionId }],
    [200, []],
    [200, null]
  ])('rejects invalid responses with HTTP status %s', async (status, body) => {
    respond(status, body);
    await expect(client().dispatch({ ...input, action: 'STOP' })).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
  });

  it('rejects malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<private file path>')));
    await expect(client().dispatch(input)).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
  });

  it.each([200, 409])('recognizes only the domain code on a known rejection (%s)', async (status) => {
    respond(status, { accepted: false, error: 'NOT_ELIGIBLE_STATE', stack: 'private' });
    await expect(client().dispatch(input)).resolves.toEqual({ kind: 'REJECTED', reason: 'NOT_ELIGIBLE_STATE' });
  });

  it('does not disclose the network error or an upstream 5xx body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private')));
    await expect(client().dispatch(input)).resolves.toEqual({ kind: 'NETWORK_ERROR' });
    respond(500, { accepted: false, error: 'NOT_FOUND', stack: 'private' });
    await expect(client().dispatch(input)).resolves.toEqual({ kind: 'NETWORK_ERROR' });
  });

  it.each(['headers', 'body'])('aborts when the webhook stalls at %s for 10 seconds', async (stage) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, { signal }: RequestInit) => {
      const stalled = new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('private')));
      });
      return stage === 'headers' ? stalled : Promise.resolve({ ok: true, json: () => stalled });
    }));
    const response = client().dispatch(input);
    await vi.advanceTimersByTimeAsync(9999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(response).resolves.toEqual({ kind: 'TIMEOUT' });
  });
});
