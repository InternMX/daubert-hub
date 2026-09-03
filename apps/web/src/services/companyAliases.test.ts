import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCompanyAliases, updateCompanyAliases } from './companyAliases';

afterEach(() => vi.unstubAllGlobals());

describe('company alias client', () => {
  it('reads aliases with an encoded company ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: { aliases: ['BMASC'], otherAliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }] } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getCompanyAliases('company/id')).resolves.toEqual({ aliases: ['BMASC'], otherAliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }] });
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/company%2Fid/aliases', undefined);
  });

  it('replaces aliases with a PATCH request and preserves the request ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'x-request-id': 'request-1' }), json: async () => ({ data: { aliases: ['BMASC', 'B+ASC'], otherAliases: [] } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateCompanyAliases('9007199254740993', ['BMASC', 'B+ASC'])).resolves.toEqual({ aliases: { aliases: ['BMASC', 'B+ASC'], otherAliases: [] }, requestId: 'request-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/9007199254740993/aliases', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aliases: ['BMASC', 'B+ASC'] }) });
  });

  it('maps a conflict without exposing raw response details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, headers: new Headers({ 'x-request-id': 'request-2' }), json: async () => ({ code: 'ALIAS_ALREADY_ASSOCIATED', message: 'do not expose' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateCompanyAliases('121', ['TAKEN'])).rejects.toMatchObject({ status: 409, code: 'ALIAS_ALREADY_ASSOCIATED', requestId: 'request-2' });
  });

  it('maps network failures to a safe API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network detail')));
    await expect(getCompanyAliases('121')).rejects.toMatchObject({ status: 0 });
  });
});
