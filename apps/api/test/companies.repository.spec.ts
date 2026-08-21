import { describe, expect, it, vi } from 'vitest';
import { CompaniesRepository } from '../src/companies/companies.repository';

describe('CompaniesRepository', () => {
  it('searches only active company identity fields and returns each company once', async () => {
    const query = vi.fn().mockResolvedValue([{ id: '9007199254740993', commercial_name: 'SILYM', company_type: 'SERVICIO', legal_name: 'RUBEN MARQUEZ CORTES', rfc: 'SIM010101AAA', matched_alias: 'SOLUCIONES INTEGRALES' }]);
    const repository = new CompaniesRepository({ query } as never);

    await expect(repository.search('soluciones')).resolves.toEqual([{ id: '9007199254740993', commercial_name: 'SILYM', company_type: 'SERVICIO', legal_name: 'RUBEN MARQUEZ CORTES', rfc: 'SIM010101AAA', matched_alias: 'SOLUCIONES INTEGRALES' }]);

    const sql = query.mock.calls[0]?.[0] as string;
    expect(query.mock.calls[0]?.[1]).toEqual(['soluciones']);
    expect(sql).toContain("company.estatus = 'ACTIVO'");
    expect(sql).toContain('company.nombre_comercial');
    expect(sql).toContain('fiscal.razon_social');
    expect(sql).toContain('fiscal.rfc');
    expect(sql).toContain("alias.estatus = 'ACTIVO'");
    expect(sql).toContain('CASE WHEN $1::text IS NULL OR lower(btrim(company.nombre_comercial))');
    expect(sql).not.toContain('core.contactos');
    expect(sql).not.toContain('core.medios_contacto');
    expect(sql).not.toContain('empresa_roles');
    expect(sql).toContain('LIMIT 20');
  });
});
