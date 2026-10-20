import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaterpillarReprocessWebhookClient } from '../src/automations/remisiones-caterpillar/caterpillar-reprocess-webhook.client';

function configWith(overrides: Partial<{ url: string | null; token: string | null }> = {}) {
  const value = { url: 'http://localhost:5678/webhook-test/cat-test-reprocess', token: 'secret-token', ...overrides };
  return { get: vi.fn().mockReturnValue(value) };
}

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: vi.fn().mockResolvedValue(body) };
}

describe('CaterpillarReprocessWebhookClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('triggerReprocess', () => {
    it('POSTs executionId/reason to the configured URL with the shared header token, nothing else', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { accepted: true, status: 'REPROCESS_CREATED', originalExecutionId: '153', executionId: '154' }));
      global.fetch = fetchMock as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);

      await client.triggerReprocess('153', 'motivo de prueba');

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://localhost:5678/webhook-test/cat-test-reprocess');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['X-Daubert-Automation-Token']).toBe('secret-token');
      expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({ executionId: '153', reason: 'motivo de prueba' });
    });

    it('never sends a file path, document id, series, plant, or automation code', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { accepted: true, status: 'REPROCESS_CREATED', originalExecutionId: '153', executionId: '154' }));
      global.fetch = fetchMock as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await client.triggerReprocess('153', 'motivo');
      const [, init] = fetchMock.mock.calls[0]!;
      const sentKeys = Object.keys(JSON.parse(init.body as string));
      expect(sentKeys.sort()).toEqual(['executionId', 'reason']);
    });

    it.each([
      ['REPROCESS_CREATED'],
      ['ALREADY_PROCESSING'],
      ['ALREADY_REPROCESSED']
    ] as const)('parses a 202 accepted response with status %s', async (status) => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(202, { accepted: true, status, originalExecutionId: '153', executionId: '154' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'ACCEPTED', status, originalExecutionId: '153', executionId: '154' });
    });

    it('returns INVALID_RESPONSE for a 202 with a malformed body (missing executionId)', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(202, { accepted: true, status: 'REPROCESS_CREATED', originalExecutionId: '153' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it('returns INVALID_RESPONSE for a 202 with an unrecognized status value', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(202, { accepted: true, status: 'SOMETHING_ELSE', originalExecutionId: '153', executionId: '154' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it.each([
      ['NOT_FOUND', 404],
      ['NOT_ELIGIBLE_STATE', 409],
      ['SOURCE_DOCUMENT_MISSING', 409],
      ['SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING', 422],
      ['SOURCE_FILE_MISSING', 409],
      ['OUTSIDE_TEST_SCOPE', 409],
      ['OUTSIDE_ALLOWED_SCOPE', 409]
    ] as const)('parses a rejected %s response at HTTP %d', async (reason, status) => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(status, { accepted: false, error: reason })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'REJECTED', reason });
    });

    it('treats an unrecognized rejection error code as an upstream contract break (INVALID_RESPONSE), never a fabricated domain rejection', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(400, { accepted: false, error: 'SOME_NEW_ERROR' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it.each(['OUTSIDE_SCOPE', 'OUTSIDE_ALLOWED_SCOPE_2', 'outside_allowed_scope', 'OUTSIDE_PROD_SCOPE'])('treats the near-miss scope code %s at HTTP 409 as INVALID_RESPONSE, not a rejection', async (error) => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(409, { accepted: false, error })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it('treats accepted=true with an unrecognized status as INVALID_RESPONSE', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(202, { accepted: true, status: 'UNKNOWN_STATUS', originalExecutionId: '153', executionId: '154' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it('treats a structurally incoherent body (accepted=true carrying an error field but no valid status/ids) as INVALID_RESPONSE', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(202, { accepted: true, error: 'NOT_FOUND' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it('treats a structurally incoherent rejection body (accepted=false carrying status/executionId instead of a valid error) as INVALID_RESPONSE', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(409, { accepted: false, status: 'REPROCESS_CREATED', executionId: '154' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it('treats a 500 (n8n internal error) as an upstream failure, never a domain rejection', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(500, { accepted: false, error: 'INTERNAL_ERROR' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'NETWORK_ERROR' });
    });

    // Regression: the real n8n TEST webhook's "Responder reproceso aceptado" node returns HTTP 200
    // for every ACCEPTED-kind outcome, not 202 — a real execution (#161 -> #162, REPROCESS_CREATED,
    // n8n genuinely created the child) was misclassified as NETWORK_ERROR -> 502 before this fix,
    // solely because the client required exactly 202. n8n's HTTP status is never the domain
    // contract; only the validated body is.
    it.each([
      ['REPROCESS_CREATED'],
      ['ALREADY_PROCESSING'],
      ['ALREADY_REPROCESSED']
    ] as const)('parses a valid ACCEPTED body with status %s delivered over HTTP 200 (not 202) — the exact #161/#162 regression', async (status) => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { accepted: true, originalExecutionId: '161', executionId: '162', status })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('161', 'motivo')).resolves.toEqual({ kind: 'ACCEPTED', status, originalExecutionId: '161', executionId: '162' });
    });

    it('still rejects a 200 response whose body is structurally invalid (accepted=true, unrecognized status)', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { accepted: true, status: 'NOT_A_REAL_STATUS', originalExecutionId: '161', executionId: '162' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('161', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it('still rejects a 200 response missing required accepted fields (no executionId)', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { accepted: true, status: 'REPROCESS_CREATED', originalExecutionId: '161' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('161', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it('treats a 201/204-style 2xx with no parseable accepted body as INVALID_RESPONSE, never a guessed success', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(201, {})) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('161', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it('treats a 3xx as an upstream failure, never attempts to parse it as accepted', async () => {
      global.fetch = vi.fn().mockResolvedValue(jsonResponse(302, { accepted: true, status: 'REPROCESS_CREATED', originalExecutionId: '161', executionId: '162' })) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('161', 'motivo')).resolves.toEqual({ kind: 'NETWORK_ERROR' });
    });

    it('returns INVALID_RESPONSE for a 202 whose body is not valid JSON, without leaking raw text', async () => {
      const response = { status: 202, ok: true, json: vi.fn().mockRejectedValue(new Error('Unexpected token < in JSON')) };
      global.fetch = vi.fn().mockResolvedValue(response) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'INVALID_RESPONSE' });
    });

    it('returns TIMEOUT when the request is aborted, without leaking the underlying error, URL, or token', async () => {
      global.fetch = vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('This operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as never;
      vi.useFakeTimers();
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      const promise = client.triggerReprocess('153', 'motivo');
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(promise).resolves.toEqual({ kind: 'TIMEOUT' });
      vi.useRealTimers();
    });

    it('returns NETWORK_ERROR on a non-timeout fetch failure (e.g. ECONNREFUSED), without leaking the underlying error, URL, or token', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5678')) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      const result = await client.triggerReprocess('153', 'motivo');
      expect(result).toEqual({ kind: 'NETWORK_ERROR' });
      expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|5678|secret-token/i);
    });

    it.each([202, 409])('keeps the original deadline through a stalled HTTP %d JSON body', async (status) => {
      vi.useFakeTimers();
      const json = vi.fn();
      let signal: AbortSignal | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
        signal = init.signal;
        return new Promise((resolve) => setTimeout(() => resolve({
          status,
          json: json.mockImplementation(() => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('private upstream body')), { once: true });
          }))
        }), 9_000));
      }) as never;
      const client = new CaterpillarReprocessWebhookClient(configWith() as never);
      let result: unknown;
      const promise = client.triggerReprocess('153', 'motivo').then((value) => { result = value; return value; });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(json).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      expect(result).toEqual({ kind: 'TIMEOUT' });
      await expect(promise).resolves.toEqual({ kind: 'TIMEOUT' });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('accepts a body completed before the deadline and clears the timeout', async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
        signal = init.signal;
        return Promise.resolve({ status: 200, json: () => new Promise((resolve) => setTimeout(() => resolve({
          accepted: true, status: 'REPROCESS_CREATED', originalExecutionId: '153', executionId: '154'
        }), 9_999)) });
      }) as never;
      const promise = new CaterpillarReprocessWebhookClient(configWith() as never).triggerReprocess('153', 'motivo');
      await vi.advanceTimersByTimeAsync(9_999);
      await expect(promise).resolves.toMatchObject({ kind: 'ACCEPTED', status: 'REPROCESS_CREATED' });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(false);
    });

    it('returns NOT_CONFIGURED without calling fetch when the URL is missing', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as never;
      const client = new CaterpillarReprocessWebhookClient(configWith({ url: null }) as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'NOT_CONFIGURED' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns NOT_CONFIGURED without calling fetch when the token is missing', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock as never;
      const client = new CaterpillarReprocessWebhookClient(configWith({ token: null }) as never);
      await expect(client.triggerReprocess('153', 'motivo')).resolves.toEqual({ kind: 'NOT_CONFIGURED' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never includes the token in any resolved outcome, on any code path', async () => {
      const outcomes = await Promise.all([
        (() => { global.fetch = vi.fn().mockResolvedValue(jsonResponse(202, { accepted: true, status: 'REPROCESS_CREATED', originalExecutionId: '1', executionId: '2' })) as never; return new CaterpillarReprocessWebhookClient(configWith() as never).triggerReprocess('1', 'x'); })(),
        (() => { global.fetch = vi.fn().mockResolvedValue(jsonResponse(409, { accepted: false, error: 'NOT_ELIGIBLE_STATE' })) as never; return new CaterpillarReprocessWebhookClient(configWith() as never).triggerReprocess('1', 'x'); })(),
        (() => { global.fetch = vi.fn().mockRejectedValue(new Error('secret-token leak attempt')) as never; return new CaterpillarReprocessWebhookClient(configWith() as never).triggerReprocess('1', 'x'); })()
      ]);
      for (const outcome of outcomes) {
        expect(JSON.stringify(outcome)).not.toMatch(/secret-token/i);
      }
    });
  });
});
