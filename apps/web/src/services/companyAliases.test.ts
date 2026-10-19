import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCompanyAliases, managePaymentAlias, updateCompanyAliases } from './companyAliases';

afterEach(() => vi.unstubAllGlobals());

describe('company alias client', () => {
  it('sends the reviewed snapshot and explicit confirmation for reassignment and deactivation', async () => {
    const record = { aliasId: '9007199254740993', companyId: '121', companyName: 'Empresa TEST', alias: 'TEST', normalizedAlias: 'TEST', status: 'ACTIVO' as const, type: 'NOMBRE_ARCHIVO', updatedAt: '2026-10-19 10:00:00.123456+00' };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: record }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await managePaymentAlias(record, 'REASSIGN', '122');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/aliases/9007199254740993/payment-notifications', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'REASSIGN', expectedCompanyId: '121', expectedUpdatedAt: record.updatedAt, confirmed: true, companyId: '122' }) });
    await managePaymentAlias(record, 'DEACTIVATE');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/aliases/9007199254740993/payment-notifications', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'DEACTIVATE', expectedCompanyId: '121', expectedUpdatedAt: record.updatedAt, confirmed: true }) });
  });
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
