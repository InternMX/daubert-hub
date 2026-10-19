import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPaymentNotificationExecution, listPaymentNotificationExecutions, PaymentNotificationApiError, reprocessPaymentNotifications } from './paymentNotifications';

afterEach(() => vi.unstubAllGlobals());

const summary = {
  executionId: '32',
  createdAt: '2026-08-19T19:31:49.884Z',
  processedAt: '2026-08-19T19:31:49.919Z',
  processingStatus: 'PROCESADO',
  outcomeStatus: 'PARTIAL',
  totalResults: 5,
  readyCount: 4,
  manualCount: 1,
  errorCount: 0,
  omittedCount: 0,
  fileErrors: 0,
  summarySent: false,
  summarySentAt: null,
  reviewStatus: null,
  reprocessAvailable: false
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('listPaymentNotificationExecutions', () => {
  it('requests the API with page/pageSize and returns its contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [summary], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listPaymentNotificationExecutions(1, 25)).resolves.toEqual({ data: [summary], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/payment-notifications?page=1&pageSize=25');
  });

  it.each([
    ['non-array data', { data: 'not-an-array', meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }],
    ['missing meta', { data: [] }],
    ['negative count', { data: [{ ...summary, readyCount: -1 }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['unknown outcomeStatus', { data: [{ ...summary, outcomeStatus: 'UNKNOWN' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['unknown processingStatus', { data: [{ ...summary, processingStatus: 'UNKNOWN' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['non-finite total', { data: [], meta: { page: 1, pageSize: 25, total: Number.NaN, totalPages: 0 } }],
    ['unparsable createdAt', { data: [{ ...summary, createdAt: 'not-a-date' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['unknown reviewStatus', { data: [{ ...summary, reviewStatus: 'ACKNOWLEDGED' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['missing reviewStatus', { data: [Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'reviewStatus'))], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['missing reprocessAvailable', { data: [Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'reprocessAvailable'))], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['non-boolean reprocessAvailable', { data: [{ ...summary, reprocessAvailable: 'true' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }]
  ])('rejects malformed responses: %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    await expect(listPaymentNotificationExecutions(1, 25)).rejects.toBeInstanceOf(PaymentNotificationApiError);
  });

  it('accepts a null outcomeStatus and null processedAt/summarySentAt', async () => {
    const zeroResult = { ...summary, outcomeStatus: null, processedAt: null, summarySentAt: null, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0, totalResults: 0 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [zeroResult], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } })));
    await expect(listPaymentNotificationExecutions(1, 25)).resolves.toEqual({ data: [zeroResult], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
  });

  it('surfaces the HTTP status on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 500, message: 'Error interno del servidor.' }, 500)));
    await expect(listPaymentNotificationExecutions(1, 25)).rejects.toMatchObject({ status: 500 });
  });

  it('surfaces status 0 for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(listPaymentNotificationExecutions(1, 25)).rejects.toMatchObject({ status: 0 });
  });
});

describe('getPaymentNotificationExecution', () => {
  const detail = { ...summary, results: [{ companyId: '7', companyName: 'NOVAPAK', status: 'MANUAL', attentionReason: 'Faltan destinatarios principales configurados.' }], fileErrorDetails: [] as unknown[] };

  it('preserves current assignment alongside the historical error on every fresh GET', async () => {
    const assignment = { aliasId: '5', companyId: '121', companyName: 'Empresa TEST', alias: 'TEST ALIAS', normalizedAlias: 'TEST ALIAS', status: 'ACTIVO', type: 'NOMBRE_ARCHIVO', updatedAt: 'version' };
    const aliasResolution = { alias: 'TEST ALIAS', normalizedAlias: 'TEST ALIAS', state: 'ACTIVE', assignment, company: { id: '121', name: 'Empresa TEST' } };
    const enriched = { ...detail, fileErrorDetails: [{ fileName: 'test.pdf', fileHash: 'a'.repeat(64), errorCode: 'ALIAS_NO_CATALOGADO', detail: 'TEST ALIAS', aliasResolution }] };
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ data: enriched }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await getPaymentNotificationExecution('32')).fileErrorDetails[0]?.aliasResolution?.state).toBe('ACTIVE');
    expect((await getPaymentNotificationExecution('32')).fileErrorDetails[0]?.errorCode).toBe('ALIAS_NO_CATALOGADO');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed current assignment instead of showing it as unassigned', async () => {
    const malformed = { ...detail, fileErrorDetails: [{ fileName: 'test.pdf', fileHash: 'a'.repeat(64), errorCode: 'ALIAS_NO_CATALOGADO', detail: 'TEST ALIAS', aliasResolution: { state: 'ACTIVE', assignment: null } }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: malformed })));
    await expect(getPaymentNotificationExecution('32')).rejects.toBeInstanceOf(PaymentNotificationApiError);
  });

  it('requests the detail endpoint with the exact executionId string, never Number()', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: detail }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPaymentNotificationExecution('9007199254740993')).resolves.toEqual(detail);
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/payment-notifications/9007199254740993', { cache: 'no-store' });
  });

  it('accepts a null companyName and a null attentionReason', async () => {
    const withNulls = { ...detail, results: [{ companyId: '9', companyName: null, status: 'ERROR', attentionReason: null }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: withNulls })));
    await expect(getPaymentNotificationExecution('9')).resolves.toEqual(withNulls);
  });

  it('accepts an execution with zero provider results', async () => {
    const empty = { ...detail, results: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: empty })));
    await expect(getPaymentNotificationExecution('32')).resolves.toEqual(empty);
  });

  it('rejects a malformed provider result (unknown status)', async () => {
    const malformed = { ...detail, results: [{ companyId: '7', companyName: 'NOVAPAK', status: 'UNKNOWN', attentionReason: null }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: malformed })));
    await expect(getPaymentNotificationExecution('32')).rejects.toBeInstanceOf(PaymentNotificationApiError);
  });

  it('accepts structured file errors (fileErrors + fileErrorDetails), including a null detail', async () => {
    const hash = 'a'.repeat(64);
    const withFileErrors = {
      ...detail,
      fileErrors: 2,
      fileErrorDetails: [
        { fileName: '13.-KARINA MEZA.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: 'KARINA MEZA', fileHash: hash },
        { fileName: 'x.pdf', errorCode: 'NUEVO_ERROR', detail: null, fileHash: hash }
      ]
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: withFileErrors })));
    await expect(getPaymentNotificationExecution('32')).resolves.toEqual(withFileErrors);
  });

  it('rejects a malformed file error entry and a response without fileErrorDetails/fileErrors', async () => {
    const malformed = { ...detail, fileErrors: 1, fileErrorDetails: [{ fileName: 'x.pdf', errorCode: 42, detail: null, fileHash: 'h' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: malformed })));
    await expect(getPaymentNotificationExecution('32')).rejects.toBeInstanceOf(PaymentNotificationApiError);

    const { fileErrorDetails: _omitted, ...withoutDetails } = detail;
    void _omitted;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: withoutDetails })));
    await expect(getPaymentNotificationExecution('32')).rejects.toBeInstanceOf(PaymentNotificationApiError);

    const { fileErrors: _count, ...withoutCount } = summary;
    void _count;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [withoutCount], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } })));
    await expect(listPaymentNotificationExecutions(1, 25)).rejects.toBeInstanceOf(PaymentNotificationApiError);
  });

  it('propagates a 404 status for an unknown execution', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 404, message: 'Ejecución de notificaciones de pago no encontrada.' }, 404)));
    await expect(getPaymentNotificationExecution('999999')).rejects.toMatchObject({ status: 404 });
  });

  it('propagates a 400 status for an invalid executionId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 400, message: 'El identificador de la ejecución debe ser un entero positivo.' }, 400)));
    await expect(getPaymentNotificationExecution('not-a-number')).rejects.toMatchObject({ status: 400 });
  });
});

// PN1.2 final scope cleanup: "Ejecutar ahora" (runPaymentNotifications / POST .../run) was
// removed — the production n8n workflow already polls independently, so a manual run trigger
// added no value. Reprocesar (below) is unaffected.
it('no longer exports a runPaymentNotifications function', async () => {
  const module = await import('./paymentNotifications');
  expect((module as unknown as Record<string, unknown>).runPaymentNotifications).toBeUndefined();
});

describe('reprocessPaymentNotifications (PN1.2 targeting fix §4)', () => {
  it('POSTs with no request body (no correo_id) to the per-execution reprocess endpoint, using the exact executionId string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'TRIGGERED' }, 202));
    vi.stubGlobal('fetch', fetchMock);
    await expect(reprocessPaymentNotifications('9007199254740993')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/payment-notifications/9007199254740993/reprocess', { method: 'POST' });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it('rejects with 404 when the requested executionId does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 404 }, 404)));
    await expect(reprocessPaymentNotifications('32')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects with 409 when the requested execution is no longer eligible for reprocess', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 409 }, 409)));
    await expect(reprocessPaymentNotifications('32')).rejects.toMatchObject({ status: 409 });
  });

  it('rejects with the HTTP status on a non-2xx response (e.g. 502 upstream failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 502 }, 502)));
    await expect(reprocessPaymentNotifications('32')).rejects.toMatchObject({ status: 502 });
  });

  it('surfaces status 0 for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(reprocessPaymentNotifications('32')).rejects.toMatchObject({ status: 0 });
  });
});
