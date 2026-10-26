import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelCaterpillarRemission } from './caterpillarRemissions';
const revision = '2026-10-20T12:00:00.123456Z';
describe('Caterpillar cancellation HTTP client (mock fetch)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends only reason and revision, preserving bigint IDs', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {
      status: 'ALREADY_CANCELLED', remissionId: '9007199254740993', cancellationReason: 'Original', cancellation: null
    } }) });
    vi.stubGlobal('fetch', fetch);
    await expect(cancelCaterpillarRemission('14','9007199254740993','Motivo',revision)).resolves.toMatchObject({ status: 'ALREADY_CANCELLED' });
    expect(fetch.mock.calls[0]?.[0]).toContain('/14/remittances/9007199254740993/cancel');
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({ reason: 'Motivo', expectedRevision: revision });
  });
  it.each([
    { status: ['ALREADY_CANCELLED'], remissionId: '100', cancellationReason: 'X', cancellation: null },
    { status: 'COMPLETED', remissionId: '100', cancellationReason: 'X', cancellation: null },
    { status: 'CANCELLED', remissionId: '100', cancellationReason: 'X', cancellation: null },
    { status: 'ALREADY_CANCELLED', remissionId: '101', cancellationReason: 'X', cancellation: null },
    { status: 'ALREADY_CANCELLED', remissionId: '100', cancellationReason: 'X', cancellation: { cancellationId: '1' } }
  ])('rejects malformed success without optimistic cancellation (%j)', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data }) }));
    await expect(cancelCaterpillarRemission('14','100','Motivo',revision)).rejects.toMatchObject({ status: 200 });
  });
  it('does not expose raw server or transport details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: 'private SQL credential' }) }));
    await expect(cancelCaterpillarRemission('14','100','Motivo',revision)).rejects.not.toThrow(/SQL|credential/);
  });
});
