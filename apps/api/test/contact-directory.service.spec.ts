import { describe, expect, it, vi } from 'vitest';
import { ContactDirectoryService } from '../src/contact-directory/contact-directory.service';

describe('ContactDirectoryService', () => {
  it('maps company list counts and preserves bigint IDs as strings', async () => {
    const list = vi.fn().mockResolvedValue({ total: 1, companies: [{ id: '9007199254740993', commercial_name: 'Acme', company_type: 'SERVICIO', contact_count: '2' }] });
    const service = new ContactDirectoryService({ list } as never);
    await expect(service.list({ page: 1, pageSize: 25 })).resolves.toEqual({ data: [{ id: '9007199254740993', commercialName: 'Acme', companyType: 'SERVICIO', contactCount: 2 }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
  });
  it('maps active and inactive methods without payment routing fields', async () => {
    const service = new ContactDirectoryService({ findById: vi.fn().mockResolvedValue({ company: { id: '1', commercial_name: 'Acme', company_type: 'PROVEEDOR' }, contacts: [{ id: '2', name: null, contact_type: 'BUZON_GENERICO', area: 'Pagos', position: null, is_primary: false, methods: [{ id: '3', contact_id: '2', type: 'CORREO', value: 'safe@example.test', is_primary: true, recibe_notificacion_pago: true }], inactiveMethods: [{ id: '4', contact_id: '2', type: 'TELEFONO', value: '5550000000', is_primary: false, tipo_destinatario_pago: 'PAGO' }] }] }) } as never);
    await expect(service.get(1)).resolves.toEqual({ data: { company: { id: '1', commercialName: 'Acme', companyType: 'PROVEEDOR' }, contacts: [{ id: '2', name: null, contactType: 'BUZON_GENERICO', area: 'Pagos', position: null, isPrimary: false, methods: [{ id: '3', type: 'CORREO', value: 'safe@example.test', isPrimary: true }], inactiveMethods: [{ id: '4', type: 'TELEFONO', value: '5550000000', isPrimary: false }] }] } });
  });
});
