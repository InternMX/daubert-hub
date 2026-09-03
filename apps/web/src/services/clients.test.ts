import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, deactivateClient, getClient, listClients, reactivateClient, updateClient } from './clients';

afterEach(() => vi.unstubAllGlobals());

describe('createClient', () => {
  it('posts the create contract and preserves the request ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: '9007199254740993', commercialName: 'Acme', companyType: 'CLIENTE', status: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: null } }), { status: 201, headers: { 'x-request-id': 'request-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createClient({ commercialName: 'Acme', fiscal: null, notes: null })).resolves.toMatchObject({ client: { id: '9007199254740993' }, requestId: 'request-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/clients', expect.objectContaining({ method: 'POST', body: JSON.stringify({ commercialName: 'Acme', fiscal: null, notes: null }) }));
  });

  it('maps API conflict codes without exposing raw response details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'CLIENT_RFC_CONFLICT', detail: 'do not expose' }), { status: 409, headers: { 'x-request-id': 'request-2' } })));
    await expect(createClient({ commercialName: 'Acme', fiscal: { legalName: 'Acme SA', rfc: 'ACM010101AA1' }, notes: null })).rejects.toMatchObject({ status: 409, code: 'CLIENT_RFC_CONFLICT', requestId: 'request-2' });
  });

  it('maps network failures to a safe API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network detail')));
    await expect(createClient({ commercialName: 'Acme', fiscal: null, notes: null })).rejects.toMatchObject({ status: 0 });
  });
});

describe('listClients', () => {
  it('serializes search and pagination, preserving BIGINT string IDs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: '9007199254740993', commercialName: 'Acme', companyType: 'CLIENTE', status: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: null }], meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await listClients({ search: 'Acme', page: 2, pageSize: 25, sortOrder: 'desc' });
    expect(result).toMatchObject({ meta: { total: 1 } });
    expect(typeof result.data[0]!.id).toBe('string');
    expect(fetchMock).toHaveBeenCalledWith('/api/clients?page=2&pageSize=25&search=Acme&sortOrder=desc');
  });

  it('omits sortOrder when it is the default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listClients({ page: 1, pageSize: 25, sortOrder: 'asc' });
    expect(fetchMock).toHaveBeenCalledWith('/api/clients?page=1&pageSize=25');
  });

  it('maps network failures to a safe API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network detail')));
    await expect(listClients({ page: 1, pageSize: 25, sortOrder: 'asc' })).rejects.toMatchObject({ status: 0 });
  });
});

describe('getClient', () => {
  it('gets client detail and preserves the request ID on errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: '9007199254740993', commercialName: 'Acme', companyType: 'CLIENTE', status: 'ACTIVO', notes: null, roles: ['CLIENTE', 'PROVEEDOR'], fiscal: { id: 'f1', legalName: 'Acme SA', rfc: 'ACM010101AA1', startDate: null, endDate: null } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CLIENT_NOT_FOUND' }), { status: 404, headers: { 'x-request-id': 'request-5' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getClient('9007199254740993')).resolves.toMatchObject({ id: '9007199254740993', roles: ['CLIENTE', 'PROVEEDOR'], fiscal: { rfc: 'ACM010101AA1' } });
    expect(fetchMock.mock.calls[0]).toEqual(['/api/clients/9007199254740993', undefined]);
    await expect(getClient('404')).rejects.toMatchObject({ status: 404, code: 'CLIENT_NOT_FOUND', requestId: 'request-5' });
  });
});

describe('updateClient', () => {
  it('patches the paired fiscal contract without altering the string ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: '9007199254740993', commercialName: 'Acme Updated', companyType: 'CLIENTE', status: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: { id: 'f1', legalName: 'Acme SA', rfc: 'NEW010101AA1', startDate: null, endDate: null } } }), { status: 200, headers: { 'x-request-id': 'request-6' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateClient('9007199254740993', { fiscal: { legalName: 'Acme SA', rfc: 'NEW010101AA1', changeMode: 'CORRECTION' } })).resolves.toMatchObject({ client: { commercialName: 'Acme Updated' }, requestId: 'request-6' });
    expect(fetchMock).toHaveBeenCalledWith('/api/clients/9007199254740993', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ fiscal: { legalName: 'Acme SA', rfc: 'NEW010101AA1', changeMode: 'CORRECTION' } }) }));
  });
});

describe('client lifecycle', () => {
  it('posts lifecycle actions and returns the updated client', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: { id: '121', commercialName: 'Acme', companyType: 'CLIENTE', status: 'INACTIVO', notes: null, roles: [], fiscal: null } }), { status: 200, headers: { 'x-request-id': 'request-7' } })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(deactivateClient('121')).resolves.toMatchObject({ client: { status: 'INACTIVO' }, requestId: 'request-7' });
    await reactivateClient('121');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/clients/121/deactivate', { method: 'POST' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/clients/121/reactivate', { method: 'POST' });
  });
});
