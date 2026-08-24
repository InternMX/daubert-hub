import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateContact } from './contacts';

afterEach(() => vi.unstubAllGlobals());

describe('contact editing client', () => {
  it('PATCHes only the supplied fields to the same-origin contact endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'x-request-id': 'request-edit' }), json: async () => ({ data: { id: '9007199254740993', companyId: '31', contactType: 'PERSONA', name: 'María', area: null, position: 'Compradora Sr.', notes: null, status: 'ACTIVO', isPrimary: false } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateContact('9007199254740993', { area: null, position: 'Compradora Sr.' })).resolves.toMatchObject({ contact: { id: '9007199254740993', area: null }, requestId: 'request-edit' });
    expect(fetchMock).toHaveBeenCalledWith('/api/contacts/9007199254740993', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ area: null, position: 'Compradora Sr.' }) });
  });
});
