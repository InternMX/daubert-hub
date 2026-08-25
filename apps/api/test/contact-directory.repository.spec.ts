import { describe, expect, it, vi } from 'vitest';
import { ContactDirectoryRepository } from '../src/contact-directory/contact-directory.repository';

describe('ContactDirectoryRepository', () => {
  it('queries only manageable contacts and groups methods for active and inactive contacts', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: '99', commercial_name: 'ADHECINTAS', company_type: 'PROVEEDOR' }])
      .mockResolvedValueOnce([{ id: '87', name: 'Person', contact_type: 'PERSONA', area: null, position: null, notes: 'Internal note', status: 'ACTIVO', is_primary: false }, { id: '88', name: null, contact_type: 'AREA', area: 'Pagos', position: null, notes: 'Inactive note', status: 'INACTIVO', is_primary: false }])
      .mockResolvedValueOnce([{ id: '9007199254740993', contact_id: '87', type: 'CORREO', value: 'active@example.test', is_primary: true }, { id: '9007199254740994', contact_id: '88', type: 'TELEFONO', value: '5550000000', is_primary: false }])
      .mockResolvedValueOnce([{ id: '9007199254740995', contact_id: '88', type: 'CORREO', value: 'inactive@example.test', is_primary: false }]);
    const repository = new ContactDirectoryRepository({ query } as never);
    await expect(repository.findById('9007199254740993')).resolves.toMatchObject({ contacts: [{ id: '87', status: 'ACTIVO', methods: [{ id: '9007199254740993' }], inactiveMethods: [] }, { id: '88', status: 'INACTIVO', notes: 'Inactive note', methods: [{ id: '9007199254740994', type: 'TELEFONO' }], inactiveMethods: [{ id: '9007199254740995', type: 'CORREO' }] }] });
    expect(query.mock.calls[0]?.[1]).toEqual(['9007199254740993']);
    expect(query.mock.calls[1]?.[0]).toContain('observaciones AS notes');
    expect(query.mock.calls[1]?.[0]).toContain('estatus AS status');
    expect(query.mock.calls[1]?.[0]).toContain("estatus IN ('ACTIVO', 'INACTIVO')");
    expect(query.mock.calls[1]?.[0]).not.toMatch(/PENDIENTE|RECHAZADO/);
    expect(query.mock.calls[2]?.[0]).toContain('contacto_id::text AS contact_id');
    expect(query.mock.calls[2]?.[0]).toContain('valor AS value');
    expect(query.mock.calls[2]?.[0]).toContain("estatus = 'ACTIVO'");
    expect(query.mock.calls[3]?.[0]).toContain("estatus = 'INACTIVO'");
    expect(query.mock.calls[2]?.[1]).toEqual([['87', '88']]);
    expect(query.mock.calls[3]?.[1]).toEqual([['87', '88']]);
  });

  it('keeps list search and contact counts active-only', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ total: '1' }]).mockResolvedValueOnce([]);
    await new ContactDirectoryRepository({ query } as never).list({ page: 1, pageSize: 25 });
    const sql = query.mock.calls.map((call) => String(call[0])).join(' ');
    expect(sql).toContain("contact.estatus = 'ACTIVO'");
    expect(sql).toContain("WHERE contact.empresa_id = company.empresa_id AND contact.estatus = 'ACTIVO'");
    expect(sql).not.toContain("contact.estatus IN ('ACTIVO', 'INACTIVO')");
  });
});
