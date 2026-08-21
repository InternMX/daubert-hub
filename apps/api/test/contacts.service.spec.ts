import { describe, expect, it, vi } from 'vitest';
import { ContactMethodType, ContactType, type CreateContactDto } from '../src/contacts/dto/create-contact.dto';
import { ContactsService } from '../src/contacts/contacts.service';

const email = { type: ContactMethodType.Email, value: 'maria@example.test' };
const baseInput: CreateContactDto = { companyId: '31', contactType: ContactType.Person, name: 'María López', area: 'Compras', position: 'Compradora', notes: null, methods: [email] };

function created(input: CreateContactDto) {
  return {
    contact: { contacto_id: '9007199254740993', empresa_id: input.companyId, tipo_contacto: input.contactType, nombre: input.contactType === ContactType.Person ? input.name ?? null : null, area: input.area ?? null, cargo: input.contactType === ContactType.Person ? input.position ?? null : null, observaciones: input.notes ?? null, estatus: 'ACTIVO', es_contacto_principal: false },
    methods: input.methods.map((method, index) => ({ medio_id: String(9007199254740994 + index), contacto_id: '9007199254740993', tipo_medio: method.type, valor: method.value, estatus: 'ACTIVO', es_principal: false }))
  };
}

describe('ContactsService', () => {
  it.each([
    [ContactType.Person, { name: 'María López', area: 'Compras', position: 'Compradora' }],
    [ContactType.Area, { area: 'Compras' }],
    [ContactType.GenericMailbox, { area: 'Pagos' }]
  ])('creates a valid %s contact', async (contactType, fields) => {
    const input = { ...baseInput, ...fields, contactType } as CreateContactDto;
    const create = vi.fn().mockResolvedValue(created(input));
    const service = new ContactsService({ create } as never);
    await expect(service.create(input, 'request-1')).resolves.toMatchObject({ data: { contactType, status: 'ACTIVO', isPrimary: false } });
    expect(create).toHaveBeenCalledWith(input, 'request-1');
  });

  it.each([
    ['PERSONA missing name', { ...baseInput, name: null }],
    ['AREA missing area', { ...baseInput, contactType: ContactType.Area, area: null }],
    ['BUZON_GENERICO missing area', { ...baseInput, contactType: ContactType.GenericMailbox, area: null }]
  ])('rejects %s', async (_scenario, input) => {
    const service = new ContactsService({ create: vi.fn() } as never);
    await expect(service.create(input as CreateContactDto, 'request-1')).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['one email', [email]],
    ['multiple emails', [email, { type: ContactMethodType.Email, value: 'compras@example.test' }]],
    ['multiple phones', [{ type: ContactMethodType.Phone, value: '+52 449 123 4567' }, { type: ContactMethodType.Phone, value: '449 987 6543 ext. 204' }]],
    ['WhatsApp', [{ type: ContactMethodType.WhatsApp, value: '+52 449 555 5555' }]],
    ['mixed methods', [email, { type: ContactMethodType.Phone, value: '+52 449 123 4567' }, { type: ContactMethodType.WhatsApp, value: '+52 449 555 5555' }]]
  ])('accepts %s', async (_scenario, methods) => {
    const input = { ...baseInput, methods } as CreateContactDto;
    const service = new ContactsService({ create: vi.fn().mockResolvedValue(created(input)) } as never);
    await expect(service.create(input, 'request-1')).resolves.toMatchObject({ data: { methods: expect.arrayContaining(methods.map((method) => expect.objectContaining({ type: method.type, value: method.value }))) } });
  });

  it('rejects duplicate email case-insensitively and invalid emails', async () => {
    const service = new ContactsService({ create: vi.fn() } as never);
    await expect(service.create({ ...baseInput, methods: [email, { type: ContactMethodType.Email, value: 'MARIA@EXAMPLE.TEST' }] }, 'request-1')).rejects.toMatchObject({ status: 400 });
    await expect(service.create({ ...baseInput, methods: [{ type: ContactMethodType.Email, value: 'not-an-email' }] }, 'request-1')).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['COMPANY_INACTIVE', 409],
    ['COMPANY_BLOCKED', 409],
    ['COMPANY_NOT_FOUND', 404]
  ])('rejects %s companies safely', async (code, status) => {
    const service = new ContactsService({ create: vi.fn().mockRejectedValue({ code }) } as never);
    await expect(service.create(baseInput, 'request-1')).rejects.toMatchObject({ status });
  });

  it('returns all methods with bigint identifiers as strings and omits payment routing', async () => {
    const input = { ...baseInput, methods: [email, { type: ContactMethodType.Phone, value: '449 123 4567' }] };
    const response = await new ContactsService({ create: vi.fn().mockResolvedValue(created(input)) } as never).create(input, 'request-1');
    expect(response.data.id).toBe('9007199254740993');
    expect(response.data.methods).toHaveLength(2);
    expect(response.data.methods.every((method) => typeof method.id === 'string')).toBe(true);
    expect(JSON.stringify(response)).not.toContain('recibe_notificacion_pago');
    expect(JSON.stringify(response)).not.toContain('tipo_destinatario_pago');
  });
});
