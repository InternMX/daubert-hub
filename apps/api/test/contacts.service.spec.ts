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

  it('rejects an empty contact patch', async () => {
    await expect(new ContactsService({ update: vi.fn() } as never).update('121', {}, 'request-edit')).rejects.toMatchObject({ status: 400 });
  });

  it('returns updated contact data with string bigint IDs and no payment routing', async () => {
    const record = { contacto_id: '9007199254740993', empresa_id: '9007199254740994', tipo_contacto: 'PERSONA', nombre: 'María López', area: 'Compras', cargo: null, observaciones: 'Editada', estatus: 'ACTIVO', es_contacto_principal: false };
    const update = vi.fn().mockResolvedValue(record); const service = new ContactsService({ update } as never);
    const response = await service.update(record.contacto_id, { name: 'María López', position: null }, 'request-edit');
    expect(update).toHaveBeenCalledWith(record.contacto_id, { name: 'María López', position: null }, 'request-edit');
    expect(response).toEqual({ data: { id: record.contacto_id, companyId: record.empresa_id, contactType: 'PERSONA', name: 'María López', area: 'Compras', position: null, notes: 'Editada', status: 'ACTIVO', isPrimary: false } });
    expect(JSON.stringify(response)).not.toMatch(/recibe_notificacion_pago|tipo_destinatario_pago/);
  });

  it('returns 404 for a nonexistent contact edit', async () => {
    await expect(new ContactsService({ update: vi.fn().mockResolvedValue(null) } as never).update('999999999999999', { notes: 'x' }, 'request-edit')).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ['CONTACT_NOT_ACTIVE', 409], ['COMPANY_NOT_ACTIVE', 409], ['PERSON_NAME_REQUIRED', 400], ['CONTACT_AREA_REQUIRED', 400],
    ['CONTACT_NAME_NOT_ALLOWED', 400], ['CONTACT_POSITION_NOT_ALLOWED', 400], ['CONTACT_TYPE_NOT_EDITABLE', 409], ['CONTACT_NO_CHANGES', 400]
  ])('maps contact edit error %s safely', async (code, status) => {
    const service = new ContactsService({ update: vi.fn().mockRejectedValue({ code }) } as never);
    await expect(service.update('121', { notes: 'x' }, 'request-edit')).rejects.toMatchObject({ status, response: expect.not.stringContaining('SQL') });
  });

  it.each([
    ['deactivate', 'INACTIVO'],
    ['reactivate', 'ACTIVO']
  ] as const)('%s preserves all normal contact fields and the exact string ID', async (operation, status) => {
    const record = { contacto_id: '9223372036854775807', empresa_id: '9007199254740994', tipo_contacto: 'PERSONA', nombre: 'María López', area: 'Compras', cargo: 'Compradora', observaciones: 'Conservar', estatus: status, es_contacto_principal: true };
    const changeStatus = vi.fn().mockResolvedValue(record);
    const service = new ContactsService({ changeStatus } as never);
    const response = await service[operation](record.contacto_id, 'request-status');
    expect(changeStatus).toHaveBeenCalledWith(record.contacto_id, status, 'request-status');
    expect(response).toEqual({ data: { id: record.contacto_id, companyId: record.empresa_id, contactType: 'PERSONA', name: 'María López', area: 'Compras', position: 'Compradora', notes: 'Conservar', status, isPrimary: true } });
  });

  it.each(['deactivate', 'reactivate'] as const)('returns 404 when %s cannot find the contact', async (operation) => {
    const service = new ContactsService({ changeStatus: vi.fn().mockResolvedValue(null) } as never);
    await expect(service[operation]('9223372036854775807', 'request-status')).rejects.toMatchObject({ status: 404, message: 'Contacto no encontrado.' });
  });

  it.each([
    ['CONTACT_ALREADY_ACTIVE', 'El contacto ya está activo.'],
    ['CONTACT_ALREADY_INACTIVE', 'El contacto ya está inactivo.'],
    ['CONTACT_STATUS_NOT_MANAGEABLE', 'El estado actual del contacto no puede administrarse desde este flujo.'],
    ['COMPANY_INACTIVE', 'La empresa está inactiva.'],
    ['COMPANY_BLOCKED', 'La empresa está bloqueada.'],
    ['COMPANY_NOT_ACTIVE', 'La empresa no está activa.']
  ])('maps lifecycle conflict %s safely', async (code, message) => {
    const service = new ContactsService({ changeStatus: vi.fn().mockRejectedValue({ code, detail: 'SQL internals' }) } as never);
    await expect(service.reactivate('121', 'request-status')).rejects.toMatchObject({ status: 409, response: { code, message } });
  });
});
