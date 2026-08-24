import { afterEach, describe, expect, it, vi } from 'vitest';
import { addContactMethod, deactivateContactMethod, editContactMethod, reactivateContactMethod } from './contactMethods';

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

  it('POSTs one method to the existing contact without forbidden fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, headers: new Headers(), json: async () => ({ data: { id: '205', type: 'CORREO', value: 'second@example.test', status: 'ACTIVO' } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(addContactMethod('9007199254740993', { type: 'CORREO', value: 'second@example.test' })).resolves.toMatchObject({ id: '205', status: 'ACTIVO' });
    expect(fetchMock).toHaveBeenCalledWith('/api/contacts/9007199254740993/methods', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'CORREO', value: 'second@example.test' }) });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ type: 'CORREO', value: 'second@example.test' });
  });

  it.each([{ value: 'corrected@example.test' }, { type: 'TELEFONO' as const }, { type: 'WHATSAPP' as const, value: '+52 449 555 0200' }])('PATCHes only changed method fields %#', async (input) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: { id: '9007199254740993', type: input.type ?? 'CORREO', value: input.value ?? 'safe@example.test', status: 'ACTIVO' } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(editContactMethod('9007199254740993', input)).resolves.toMatchObject({ id: '9007199254740993' });
    expect(fetchMock).toHaveBeenCalledWith('/api/contact-methods/9007199254740993', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual(input);
  });
});
