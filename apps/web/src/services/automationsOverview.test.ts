import { afterEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeAutomationReview, AutomationsOverviewApiError, listAutomationsOverview, type AcknowledgeAutomationReviewResponse, type AutomationOverview } from './automationsOverview';

afterEach(() => vi.unstubAllGlobals());

function overview(overrides: Partial<AutomationOverview> = {}): AutomationOverview {
  return {
    code: 'REMISIONES_AUDI',
    name: 'Remisiones Audi',
    description: 'Generación y control de remisiones.',
    integrationStatus: 'INTEGRATED',
    environment: 'TEST',
    lifecycleStatus: 'ACTIVE',
    polling: { intervalMinutes: 10, label: 'Cada 10 minutos' },
    lastCheckAt: null,
    lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'COMPLETED' },
    nextCheckAt: null,
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: false },
    review: { required: false, problemOccurredAt: null, problemOutcome: null },
    ...overrides
  };
}

function acknowledgeResponse(overrides: Partial<AcknowledgeAutomationReviewResponse> = {}): AcknowledgeAutomationReviewResponse {
  return {
    automationCode: 'REMISIONES_AUDI',
    reviewRequired: false,
    reviewedAt: '2026-09-10T00:00:00.000Z',
    reviewedBy: { displayName: 'user@daubert.mx', email: 'user@daubert.mx' },
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('listAutomationsOverview', () => {
  it('requests the overview endpoint and returns its contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [overview()] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listAutomationsOverview()).resolves.toEqual([overview()]);
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/overview');
  });

  it('accepts every lifecycleStatus value: ACTIVE, INACTIVE, null', async () => {
    for (const lifecycleStatus of ['ACTIVE', 'INACTIVE', null] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [overview({ lifecycleStatus })] })));
      await expect(listAutomationsOverview()).resolves.toEqual([overview({ lifecycleStatus })]);
    }
  });

  it('accepts every lastProcessing.outcome value, including null', async () => {
    for (const outcome of ['COMPLETED', 'PARTIAL', 'FAILED', 'PROCESSING', 'CANCELLED', null] as const) {
      const item = overview({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [item] })));
      await expect(listAutomationsOverview()).resolves.toEqual([item]);
    }
  });

  it('accepts a null lastProcessing, lastCheckAt, and nextCheckAt', async () => {
    const item = overview({ lastProcessing: null, lastCheckAt: null, nextCheckAt: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [item] })));
    await expect(listAutomationsOverview()).resolves.toEqual([item]);
  });

  it('accepts real lastCheckAt/nextCheckAt timestamps when eventually provided', async () => {
    const item = overview({ lastCheckAt: '2026-09-08T14:00:00.000Z', nextCheckAt: '2026-09-08T14:10:00.000Z' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [item] })));
    await expect(listAutomationsOverview()).resolves.toEqual([item]);
  });

  it.each([
    ['non-array data', { data: 'nope' }],
    ['unknown environment', { data: [overview({ environment: 'STAGING' as never })] }],
    ['unknown integrationStatus', { data: [overview({ integrationStatus: 'MAYBE' as never })] }],
    ['unknown lifecycleStatus', { data: [overview({ lifecycleStatus: 'PAUSED' as never })] }],
    ['unknown outcome', { data: [overview({ lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'UNKNOWN' as never } })] }],
    ['zero intervalMinutes', { data: [overview({ polling: { intervalMinutes: 0, label: 'Cada 0 minutos' } })] }],
    ['negative intervalMinutes', { data: [overview({ polling: { intervalMinutes: -5, label: 'Cada -5 minutos' } })] }],
    ['non-integer intervalMinutes', { data: [overview({ polling: { intervalMinutes: 5.5, label: 'Cada 5.5 minutos' } })] }],
    ['unparsable lastCheckAt', { data: [overview({ lastCheckAt: 'not-a-date' })] }],
    ['unparsable lastProcessing.occurredAt', { data: [overview({ lastProcessing: { occurredAt: 'not-a-date', outcome: 'COMPLETED' } })] }],
    ['missing capabilities field', { data: [{ ...overview(), capabilities: { hasDashboard: true, hasHistory: true } }] }],
    ['empty code', { data: [overview({ code: '' })] }]
  ])('rejects malformed responses: %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    await expect(listAutomationsOverview()).rejects.toBeInstanceOf(AutomationsOverviewApiError);
  });

  it('surfaces the HTTP status on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 500, message: 'Error interno del servidor.' }, 500)));
    await expect(listAutomationsOverview()).rejects.toMatchObject({ status: 500 });
  });

  it('surfaces status 0 for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(listAutomationsOverview()).rejects.toMatchObject({ status: 0 });
  });

  it('never coerces a malformed intervalMinutes into a rounded/truncated number', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [overview({ polling: { intervalMinutes: '10' as never, label: 'Cada 10 minutos' } })] })));
    await expect(listAutomationsOverview()).rejects.toBeInstanceOf(AutomationsOverviewApiError);
  });

  describe('review contract (Phase 10I)', () => {
    it('accepts required=true with a problemOccurredAt/problemOutcome', async () => {
      const item = overview({ review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'FAILED' } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [item] })));
      await expect(listAutomationsOverview()).resolves.toEqual([item]);
    });

    it.each(['PARTIAL', 'FAILED', 'CANCELLED', null] as const)('accepts problemOutcome %s', async (problemOutcome) => {
      const item = overview({ review: { required: problemOutcome !== null, problemOccurredAt: problemOutcome ? '2026-08-27T22:40:01.933Z' : null, problemOutcome } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [item] })));
      await expect(listAutomationsOverview()).resolves.toEqual([item]);
    });

    it.each([
      ['missing review field', { ...overview(), review: undefined }],
      ['non-boolean required', { ...overview(), review: { required: 'yes', problemOccurredAt: null, problemOutcome: null } }],
      ['unknown problemOutcome', { ...overview(), review: { required: true, problemOccurredAt: '2026-08-27T22:40:01.933Z', problemOutcome: 'COMPLETED' } }],
      ['unparsable problemOccurredAt', { ...overview(), review: { required: true, problemOccurredAt: 'not-a-date', problemOutcome: 'FAILED' } }]
    ])('rejects malformed review: %s', async (_label, item) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [item] })));
      await expect(listAutomationsOverview()).rejects.toBeInstanceOf(AutomationsOverviewApiError);
    });
  });
});

describe('acknowledgeAutomationReview', () => {
  it('posts with no body and returns the safe business contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(acknowledgeResponse()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(acknowledgeAutomationReview('REMISIONES_AUDI')).resolves.toEqual(acknowledgeResponse());
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/REMISIONES_AUDI/review-acknowledgements', { method: 'POST' });
  });

  it('accepts reviewedAt=null / reviewedBy=null (idempotent no-op response)', async () => {
    const body = acknowledgeResponse({ reviewedAt: null, reviewedBy: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));
    await expect(acknowledgeAutomationReview('REMISIONES_AUDI')).resolves.toEqual(body);
  });

  it('URL-encodes the automation code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(acknowledgeResponse({ automationCode: 'A B' })));
    vi.stubGlobal('fetch', fetchMock);
    await acknowledgeAutomationReview('A B');
    expect(fetchMock).toHaveBeenCalledWith('/api/automations/A%20B/review-acknowledgements', { method: 'POST' });
  });

  it('rejects a malformed success body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ reviewRequired: 'no' })));
    await expect(acknowledgeAutomationReview('REMISIONES_AUDI')).rejects.toBeInstanceOf(AutomationsOverviewApiError);
  });

  it('surfaces the HTTP status on a failed request (e.g. 400 for Caterpillar)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 400, message: 'Esta automatización no admite revisión operativa.' }, 400)));
    await expect(acknowledgeAutomationReview('REMISIONES_CATERPILLAR')).rejects.toMatchObject({ status: 400 });
  });

  it('surfaces status 401 for an unauthenticated request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 401, message: 'Unauthorized' }, 401)));
    await expect(acknowledgeAutomationReview('REMISIONES_AUDI')).rejects.toMatchObject({ status: 401 });
  });

  it('surfaces status 0 for a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(acknowledgeAutomationReview('REMISIONES_AUDI')).rejects.toMatchObject({ status: 0 });
  });
});
