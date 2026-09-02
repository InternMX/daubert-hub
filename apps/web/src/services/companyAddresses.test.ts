import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompanyAddress, deactivateCompanyAddress, listCompanyAddresses, reactivateCompanyAddress, updateCompanyAddress, type CompanyAddressInput } from './companyAddresses';

const input: CompanyAddressInput = { tipoDireccion: 'FACTURACION', calle: 'Industria', numeroExterior: '10', numeroInterior: null, colonia: null, codigoPostal: '37000', municipio: 'León', estado: 'Guanajuato', pais: 'México', direccionCompleta: null, referencias: null, esPrincipal: false, fechaInicio: null, fechaFin: null };
const address = { id: '9007199254740993', companyId: '22', estatus: 'ACTIVA', ...input };

afterEach(() => vi.unstubAllGlobals());

describe('company address client', () => {
  it('lists addresses with an encoded company ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: [address] }) }); vi.stubGlobal('fetch', fetchMock);
    await expect(listCompanyAddresses('company/id')).resolves.toEqual([address]);
    expect(fetchMock).toHaveBeenCalledWith('/api/companies/company%2Fid/addresses', undefined);
  });

  it('uses create, update, and lifecycle endpoints without altering string IDs or payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: address }) }); vi.stubGlobal('fetch', fetchMock);
    await createCompanyAddress('22', input); await updateCompanyAddress(address.id, input); await deactivateCompanyAddress(address.id); await reactivateCompanyAddress(address.id);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/companies/22/addresses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/addresses/9007199254740993', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/addresses/9007199254740993/deactivate', { method: 'POST' });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/addresses/9007199254740993/reactivate', { method: 'POST' });
  });
});
