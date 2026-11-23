import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessFolioRecovery, prepareFolioRecovery } from './caterpillarFolioRecovery';
afterEach(() => vi.unstubAllGlobals());
describe('Caterpillar recovery transport', () => {
  it('validates a disabled assessment without inventing eligibility', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false, eligible: false, databaseEligible: false, codes: ['FEATURE_DISABLED'] }))));
    expect((await assessFolioRecovery('10000')).enabled).toBe(false);
  });
  it.each([
    { enabled: true, eligible: true, databaseEligible: true, codes: 'not-an-array' },
    { enabled: true, eligible: true, databaseEligible: true, codes: [], quarantine: { state: 'READY', sha256: null, fileCount: -1 } },
    { enabled: 'true', eligible: true, databaseEligible: true, codes: [] }
  ])('rejects malformed safety/evidence data (%j)', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(assessFolioRecovery('10000')).rejects.toThrow();
  });
  it('sends only request identity, reason and confirmation to the separate preparation route', async () => {
    const requestId = '264d0c3c-a917-4104-8c0e-9f01b818c2db';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId, state: 'PREPARING' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await prepareFolioRecovery('10000', requestId, 'Synthetic reason', true);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/10000/folio-recovery'), expect.objectContaining({ body: JSON.stringify({ requestId, reason: 'Synthetic reason', confirmedNoDelivery: true }) }));
  });
  it('rejects another request id or an HTTP error without retrying a conventional endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ requestId: 'other', state: 'PREPARING' })))
      .mockResolvedValueOnce(new Response('internal secret', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(prepareFolioRecovery('10000', 'expected', 'Synthetic', true)).rejects.toThrow();
    await expect(prepareFolioRecovery('10000', 'expected', 'Synthetic', true)).rejects.not.toThrow(/internal secret/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
