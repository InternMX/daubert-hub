import { describe, expect, it, vi } from 'vitest';
import { ContactDirectoryService } from '../src/contact-directory/contact-directory.service';

describe('ContactDirectoryService', () => {
  it('maps company list counts and preserves bigint IDs as strings', async () => {
    const list = vi.fn().mockResolvedValue({ total: 1, companies: [{ id: '9007199254740993', commercial_name: 'Acme', company_type: 'SERVICIO', contact_count: '2' }] });
    const service = new ContactDirectoryService({ list } as never);
    await expect(service.list({ page: 1, pageSize: 25 })).resolves.toEqual({ data: [{ id: '9007199254740993', commercialName: 'Acme', companyType: 'SERVICIO', contactCount: 2 }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
  });
  it('partitions contacts and preserves methods, notes, and the active contact contract', async () => {
    const contacts = [
      { id: '2', name: null, contact_type: 'BUZON_GENERICO', area: 'Pagos', position: null, notes: 'Buzón principal', status: 'ACTIVO', is_primary: false, methods: [{ id: '3', contact_id: '2', type: 'CORREO', value: 'safe@example.test', is_primary: true, recibe_notificacion_pago: true }], inactiveMethods: [] },
      { id: '5', name: 'Inactive', contact_type: 'PERSONA', area: 'Compras', position: 'Buyer', notes: 'Keep note', status: 'INACTIVO', is_primary: true, methods: [{ id: '6', contact_id: '5', type: 'TELEFONO', value: '5550000000', is_primary: false }], inactiveMethods: [{ id: '7', contact_id: '5', type: 'CORREO', value: 'old@example.test', is_primary: false, tipo_destinatario_pago: 'PAGO' }] }
    ];
    const service = new ContactDirectoryService({ findById: vi.fn().mockResolvedValue({ company: { id: '1', commercial_name: 'Acme', company_type: 'PROVEEDOR' }, contacts }) } as never);
    const response = await service.get('9007199254740993');
    expect(response.data.contacts).toEqual([{ id: '2', name: null, contactType: 'BUZON_GENERICO', area: 'Pagos', position: null, notes: 'Buzón principal', isPrimary: false, methods: [{ id: '3', type: 'CORREO', value: 'safe@example.test', isPrimary: true }], inactiveMethods: [] }]);
    expect(response.data.inactiveContacts).toEqual([{ id: '5', name: 'Inactive', contactType: 'PERSONA', area: 'Compras', position: 'Buyer', notes: 'Keep note', status: 'INACTIVO', isPrimary: true, methods: [{ id: '6', type: 'TELEFONO', value: '5550000000', isPrimary: false }], inactiveMethods: [{ id: '7', type: 'CORREO', value: 'old@example.test', isPrimary: false }] }]);
    expect(JSON.stringify(response)).not.toMatch(/recibe_notificacion_pago|tipo_destinatario_pago/);
  });
});
