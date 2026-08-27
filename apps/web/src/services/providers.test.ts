import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider, deactivateProvider, getProvider, listProviders, reactivateProvider, resolveApiBaseUrl } from './providers';

afterEach(() => vi.unstubAllGlobals());

describe('createProvider', () => {
  it.each([
    [undefined, '/api'],
    ['', '/api'],
    ['  ', '/api'],
    ['undefined', '/api'],
    ['null', '/api'],
    ['/custom-api/', '/custom-api'],
    ['https://api.example.test/api/', 'https://api.example.test/api']
  ])('resolves API base %j as %s', (configured, expected) => {
    expect(resolveApiBaseUrl(configured)).toBe(expected);
  });

  it('posts the existing API contract and preserves the request ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: '121', commercialName: 'Acme', providerType: 'PROVEEDOR', status: 'ACTIVO', notes: null, fiscal: null } }), { status: 201, headers: { 'x-request-id': 'request-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createProvider({ commercialName: 'Acme', providerType: 'PROVEEDOR', fiscal: null, notes: null })).resolves.toMatchObject({ provider: { id: '121' }, requestId: 'request-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/providers', expect.objectContaining({ method: 'POST', body: JSON.stringify({ commercialName: 'Acme', providerType: 'PROVEEDOR', fiscal: null, notes: null }) }));
  });

  it('maps API conflict codes without exposing raw response details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'RFC_ALREADY_EXISTS', detail: 'do not expose' }), { status: 409, headers: { 'x-request-id': 'request-2' } })));
    await expect(createProvider({ commercialName: 'Acme', providerType: 'PROVEEDOR', fiscal: null, notes: null })).rejects.toMatchObject({ status: 409, code: 'RFC_ALREADY_EXISTS', requestId: 'request-2' });
  });
});

describe('listProviders', () => {
  it('serializes listing filters and pagination to the existing API endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], meta: { page: 2, pageSize: 25, total: 0, totalPages: 0 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listProviders({ search: 'Acme', providerType: 'SERVICIO', page: 2, pageSize: 25, sortBy: 'legalName', sortOrder: 'desc' })).resolves.toMatchObject({ meta: { total: 0 } });
    expect(fetchMock).toHaveBeenCalledWith('/api/providers?page=2&pageSize=25&search=Acme&providerType=SERVICIO&sortBy=legalName&sortOrder=desc');
  });

  it('maps network failures to a safe API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network detail')));
    await expect(listProviders({ page: 1, pageSize: 25, sortBy: 'commercialName', sortOrder: 'asc' })).rejects.toMatchObject({ status: 0 });
  });

  it('serializes non-default status filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await listProviders({ status: 'INACTIVO', page: 1, pageSize: 25, sortBy: 'commercialName', sortOrder: 'asc' });
    expect(fetchMock).toHaveBeenCalledWith('/api/providers?page=1&pageSize=25&status=INACTIVO');
  });
});

describe('provider lifecycle', () => {
  it('posts lifecycle actions and returns the updated provider', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: { id: '121', commercialName: 'Acme', providerType: 'PROVEEDOR', roles: ['PROVEEDOR'], status: 'INACTIVO', notes: null, aliases: [], otherAliases: [], fiscal: null } }), { status: 200, headers: { 'x-request-id': 'request-6' } })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(deactivateProvider('121')).resolves.toMatchObject({ provider: { status: 'INACTIVO' }, requestId: 'request-6' });
    await reactivateProvider('121');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/providers/121/deactivate', { method: 'POST' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/providers/121/reactivate', { method: 'POST' });
  });
});

describe('getProvider', () => {
  it('gets provider detail and preserves the request ID on errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: '121', commercialName: 'Acme', providerType: 'PROVEEDOR', roles: ['PROVEEDOR', 'FLETE'], status: 'ACTIVO', notes: null, aliases: ['BMASC'], otherAliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }], fiscal: null } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PROVIDER_NOT_FOUND' }), { status: 404, headers: { 'x-request-id': 'request-5' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getProvider('121')).resolves.toMatchObject({ id: '121', roles: ['PROVEEDOR', 'FLETE'], aliases: ['BMASC'], otherAliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }] });
    expect(fetchMock.mock.calls[0]).toEqual(['/api/providers/121']);
    await expect(getProvider('404')).rejects.toMatchObject({ status: 404, code: 'PROVIDER_NOT_FOUND', requestId: 'request-5' });
  });
});
