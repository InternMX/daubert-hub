import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudiExecutionsApiError, listAudiExecutions } from './audiExecutions';

afterEach(() => vi.unstubAllGlobals());

const summary = {
  occurredAt: '2026-08-27T22:40:01.933Z',
  outcome: 'COMPLETED',
  generatedCount: 5,
  firstFolio: '9000',
  lastFolio: '9004',
  reviewStatus: null
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('listAudiExecutions', () => {
  it('requests the API with page/pageSize and returns its contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [summary], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listAudiExecutions(1, 25)).resolves.toEqual({ data: [summary], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/remissions/audi/executions?page=1&pageSize=25');
  });

  it.each(['REQUIRED', 'REVIEWED', null] as const)('accepts reviewStatus %s', async (reviewStatus) => {
    const item = { ...summary, reviewStatus };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [item], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } })));
    await expect(listAudiExecutions(1, 25)).resolves.toEqual({ data: [item], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
  });

  it.each([
    ['non-array data', { data: 'not-an-array', meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }],
    ['missing meta', { data: [] }],
    ['unknown outcome', { data: [{ ...summary, outcome: 'UNKNOWN' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['unparsable occurredAt', { data: [{ ...summary, occurredAt: 'not-a-date' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['unknown reviewStatus', { data: [{ ...summary, reviewStatus: 'ACKNOWLEDGED' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['missing reviewStatus', { data: [Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'reviewStatus'))], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }]
  ])('rejects malformed responses: %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    await expect(listAudiExecutions(1, 25)).rejects.toBeInstanceOf(AudiExecutionsApiError);
  });

  it('surfaces the HTTP status on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 500, message: 'Error interno del servidor.' }, 500)));
    await expect(listAudiExecutions(1, 25)).rejects.toMatchObject({ status: 500 });
  });

  it('surfaces status 0 for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(listAudiExecutions(1, 25)).rejects.toMatchObject({ status: 0 });
  });
});
