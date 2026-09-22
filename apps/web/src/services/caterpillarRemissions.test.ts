import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CaterpillarApiError,
  getCaterpillarExecution,
  listCaterpillarExecutions,
  listCaterpillarSeries,
  type CaterpillarExecutionDetail,
  type CaterpillarExecutionSummary,
  type CaterpillarProcessRoute
} from './caterpillarRemissions';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function route(overrides: Partial<CaterpillarProcessRoute> = {}): CaterpillarProcessRoute {
  return {
    routeId: '1',
    processKey: 'CATERPILLAR_P2|P2|',
    processLabel: 'P2',
    routeStatus: 'ACTIVE',
    seriesId: '2',
    seriesCode: 'REMISION_CAT_P2',
    seriesStatus: 'ACTIVE',
    nextFolio: 85,
    clientCompanyId: '122',
    clientCompanyName: 'CATERPILLAR',
    ...overrides
  };
}

function executionSummary(overrides: Partial<CaterpillarExecutionSummary> = {}): CaterpillarExecutionSummary {
  return {
    executionId: '9007199254740993',
    outcome: 'COMPLETED',
    startedAt: '2026-09-20T10:00:00.000Z',
    finishedAt: '2026-09-20T10:05:00.000Z',
    failedAttempts: 0,
    maxAttempts: 2,
    latestErrorNode: null,
    latestErrorMessage: null,
    n8nExecutionId: 'wf-1',
    sourceDocumentId: '55',
    sourceFilename: 'remision.pdf',
    generatedRemissionCount: 3,
    minimumFolio: '85',
    maximumFolio: '87',
    processLabel: 'P2',
    ...overrides
  };
}

function executionDetail(overrides: Partial<CaterpillarExecutionDetail> = {}): CaterpillarExecutionDetail {
  return {
    executionId: '5',
    outcome: 'COMPLETED',
    startedAt: '2026-09-20T10:00:00.000Z',
    finishedAt: '2026-09-20T10:05:00.000Z',
    failedAttempts: 0,
    maxAttempts: 2,
    latestErrorNode: null,
    latestErrorMessage: null,
    n8nExecutionId: 'wf-5',
    reprocessOfExecutionId: null,
    sourceDocument: { documentId: '55', filename: 'archivo.pdf', path: '/dropbox/cat/archivo.pdf', hash: 'abc123', origin: 'DROPBOX', documentDate: '2026-09-19' },
    reservations: [{ reservationId: '1', seriesId: '2', seriesCode: 'REMISION_CAT_P2', folioInicial: '85', folioFinal: '87', quantity: 3, status: 'APLICADA' }],
    remittances: [{
      remissionId: '100', seriesId: '2', seriesCode: 'REMISION_CAT_P2', folio: '85', documentDate: '2026-09-19', pdfPath: '/dropbox/cat/85.pdf', status: 'GENERADA',
      details: [{ detailId: '1', internalCode: 'X1', partNumber: 'PN-1', description: 'Parte 1', quantityText: '2 PZA' }]
    }],
    ...overrides
  };
}

describe('listCaterpillarSeries', () => {
  it('requests the series endpoint and returns its contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [route()] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listCaterpillarSeries()).resolves.toEqual({ data: [route()] });
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/remissions/caterpillar/series');
    // GET only — no method/body ever passed for this read-only endpoint.
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('returns all nine configured routes, including Torreón and Torreón Planta 2 sharing one seriesId', async () => {
    const torreon = route({ routeId: '9', processKey: 'CAT_TORREON|TORREON|', processLabel: 'Torreón', seriesId: '9', seriesCode: 'REMISION_CAT_TORREON', seriesStatus: 'INACTIVE' });
    const torreonPlanta2 = route({ routeId: '8', processKey: 'CAT_TORREON|TORREON|PLANTA_2', processLabel: 'Torreón Planta 2', seriesId: '9', seriesCode: 'REMISION_CAT_TORREON', seriesStatus: 'INACTIVE' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [torreon, torreonPlanta2] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listCaterpillarSeries();
    expect(result.data).toHaveLength(2);
    expect(result.data.every((item) => item.seriesId === '9')).toBe(true);
  });

  it.each([
    ['non-array data', { data: 'nope' }],
    ['unknown routeStatus', { data: [{ ...route(), routeStatus: 'MAYBE' }] }],
    ['unknown seriesStatus', { data: [{ ...route(), seriesStatus: 'MAYBE' }] }],
    ['non-integer nextFolio', { data: [{ ...route(), nextFolio: 85.5 }] }],
    ['missing processKey', { data: [{ ...route(), processKey: undefined }] }]
  ])('rejects malformed responses: %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    await expect(listCaterpillarSeries()).rejects.toBeInstanceOf(CaterpillarApiError);
  });

  it('propagates a network failure as a CaterpillarApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(listCaterpillarSeries()).rejects.toBeInstanceOf(CaterpillarApiError);
  });
});

describe('listCaterpillarExecutions', () => {
  it('requests the executions endpoint with page/pageSize and returns its contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [executionSummary()], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listCaterpillarExecutions(1, 25)).resolves.toEqual({ data: [executionSummary()], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/remissions/caterpillar/executions?page=1&pageSize=25');
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('returns an empty list cleanly for zero executions (a normal valid state)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } })));
    await expect(listCaterpillarExecutions(1, 25)).resolves.toEqual({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
  });

  it('keeps a BIGINT executionId beyond Number.MAX_SAFE_INTEGER as a string, never coerced', async () => {
    const bigIntId = '9223372036854775807';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [executionSummary({ executionId: bigIntId })], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } })));
    const result = await listCaterpillarExecutions(1, 25);
    expect(result.data[0]?.executionId).toBe(bigIntId);
    expect(typeof result.data[0]?.executionId).toBe('string');
  });

  it('accepts a null processLabel (ambiguous route, e.g. Torreón)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [executionSummary({ processLabel: null })], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } })));
    const result = await listCaterpillarExecutions(1, 25);
    expect(result.data[0]?.processLabel).toBeNull();
  });

  it.each([
    ['non-array data', { data: 'nope', meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }],
    ['missing meta', { data: [] }],
    ['unknown outcome', { data: [{ ...executionSummary(), outcome: 'PARTIAL' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }],
    ['negative failedAttempts', { data: [{ ...executionSummary(), failedAttempts: -1 }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }]
  ])('rejects malformed responses: %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    await expect(listCaterpillarExecutions(1, 25)).rejects.toBeInstanceOf(CaterpillarApiError);
  });
});

describe('getCaterpillarExecution', () => {
  it('requests the execution by id, preserving the BIGINT id as a string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: executionDetail() }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCaterpillarExecution('5')).resolves.toEqual(executionDetail());
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/remissions/caterpillar/executions/5');
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('returns reservations, remittances, and their details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: executionDetail() })));
    const result = await getCaterpillarExecution('5');
    expect(result.reservations).toHaveLength(1);
    expect(result.remittances).toHaveLength(1);
    expect(result.remittances[0]?.details).toHaveLength(1);
  });

  it('keeps pdfPath as plain text, never transformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: executionDetail() })));
    const result = await getCaterpillarExecution('5');
    expect(typeof result.remittances[0]?.pdfPath).toBe('string');
    expect(result.remittances[0]?.pdfPath).toBe('/dropbox/cat/85.pdf');
  });

  it('accepts a null pdfPath and null hash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: executionDetail({ sourceDocument: { ...executionDetail().sourceDocument, hash: null }, remittances: [{ ...executionDetail().remittances[0]!, pdfPath: null }] })
    })));
    const result = await getCaterpillarExecution('5');
    expect(result.sourceDocument.hash).toBeNull();
    expect(result.remittances[0]?.pdfPath).toBeNull();
  });

  it('rejects a 404 as CaterpillarApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'not found' }, 404)));
    await expect(getCaterpillarExecution('999999')).rejects.toBeInstanceOf(CaterpillarApiError);
  });

  it.each([
    ['missing sourceDocument', { data: { ...executionDetail(), sourceDocument: undefined } }],
    ['non-array reservations', { data: { ...executionDetail(), reservations: 'nope' } }],
    ['non-array remittances', { data: { ...executionDetail(), remittances: 'nope' } }],
    ['unknown outcome', { data: { ...executionDetail(), outcome: 'PARTIAL' } }]
  ])('rejects malformed responses: %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    await expect(getCaterpillarExecution('5')).rejects.toBeInstanceOf(CaterpillarApiError);
  });
});
