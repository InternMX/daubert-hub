import { describe, expect, it, vi } from 'vitest';
import { CompaniesService } from '../src/companies/companies.service';

describe('CompaniesService', () => {
  it('maps compact lookup results, preserving bigint IDs and direct-name alias behavior', async () => {
    const search = vi.fn().mockResolvedValue([
      { id: '9007199254740993', commercial_name: 'SILYM', company_type: 'SERVICIO', legal_name: 'RUBEN MARQUEZ CORTES', rfc: 'SIM010101AAA', matched_alias: 'SOLUCIONES INTEGRALES' },
      { id: '2', commercial_name: 'SOLUCIONES EN DESARROLLO', company_type: 'SERVICIO', legal_name: 'F7 SOLUCIONES EN DESARROLLO S.A. DE C.V.', rfc: 'FSD010101AAA', matched_alias: null }
    ]);
    const service = new CompaniesService({ search } as never);

    await expect(service.search({ search: 'soluciones' })).resolves.toEqual({ data: [
      { id: '9007199254740993', commercialName: 'SILYM', companyType: 'SERVICIO', legalName: 'RUBEN MARQUEZ CORTES', rfc: 'SIM010101AAA', matchedAlias: 'SOLUCIONES INTEGRALES' },
      { id: '2', commercialName: 'SOLUCIONES EN DESARROLLO', companyType: 'SERVICIO', legalName: 'F7 SOLUCIONES EN DESARROLLO S.A. DE C.V.', rfc: 'FSD010101AAA', matchedAlias: null }
    ] });
  });
});
