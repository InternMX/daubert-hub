import { afterEach, describe, expect, it, vi } from 'vitest';
import { deactivateContactMethod, reactivateContactMethod } from './contactMethods';

afterEach(() => vi.unstubAllGlobals());

describe('contact method lifecycle client', () => {
  it('uses the same-origin lifecycle endpoints and preserves string IDs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: { id: '9007199254740993', contactId: '2', type: 'CORREO', value: 'safe@example.test', status: 'INACTIVO', isPrimary: false } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deactivateContactMethod('9007199254740993')).resolves.toMatchObject({ id: '9007199254740993', status: 'INACTIVO' });
    await reactivateContactMethod('9007199254740993');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/contact-methods/9007199254740993/deactivate', { method: 'POST' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/contact-methods/9007199254740993/reactivate', { method: 'POST' });
  });
});
