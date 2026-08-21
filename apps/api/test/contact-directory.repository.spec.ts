import { describe, expect, it, vi } from 'vitest';
import { ContactDirectoryRepository } from '../src/contact-directory/contact-directory.repository';

describe('ContactDirectoryRepository', () => {
  it('groups active methods by contact without exposing payment-routing columns', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: '99', commercial_name: 'ADHECINTAS', company_type: 'PROVEEDOR' }])
      .mockResolvedValueOnce([{ id: '87', name: 'Person', contact_type: 'PERSONA', area: null, position: null, is_primary: false }])
      .mockResolvedValueOnce([{ id: '9007199254740993', contact_id: '87', type: 'CORREO', value: 'redacted@example.test', is_primary: true }, { id: '9007199254740994', contact_id: '87', type: 'TELEFONO', value: '5550000000', is_primary: false }]);
    const repository = new ContactDirectoryRepository({ query } as never);
    await expect(repository.findById(99)).resolves.toMatchObject({ contacts: [{ id: '87', methods: [{ id: '9007199254740993', type: 'CORREO', value: 'redacted@example.test' }, { id: '9007199254740994', type: 'TELEFONO', value: '5550000000' }] }] });
    expect(query.mock.calls[2]?.[0]).toContain('contacto_id::text AS contact_id');
    expect(query.mock.calls[2]?.[0]).toContain('valor AS value');
    expect(query.mock.calls[2]?.[0]).toContain("estatus = 'ACTIVO'");
  });
});
