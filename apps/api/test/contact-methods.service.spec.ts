import { describe, expect, it, vi } from 'vitest';
import { ContactMethodsService } from '../src/contact-methods/contact-methods.service';
import { ContactMethodType } from '../src/contacts/dto/create-contact.dto';

const method = { id: '9007199254740993', contact_id: '121', type: 'CORREO', value: 'safe@example.test', status: 'INACTIVO', is_primary: false };

describe('ContactMethodsService', () => {
  it.each([
    [ContactMethodType.Email, 'second@example.test'],
    [ContactMethodType.Phone, '+52 449 222 2222'],
    [ContactMethodType.WhatsApp, '449 123 4567 ext. 204'],
    [ContactMethodType.Web, 'https://portal.example.test:8443/access?company=31#login']
  ] as const)('adds %s and returns only safe creation fields', async (type, value) => {
    const add = vi.fn().mockResolvedValue({ ...method, id: '205', type, value, status: 'ACTIVO' });
    const service = new ContactMethodsService({ add } as never);
    const response = await service.add('121', { type, value }, 'request-add', { userId: null, userEmail: null });
    expect(response).toEqual({ data: { id: '205', type, value, status: 'ACTIVO' } });
    expect(response.data).not.toHaveProperty('contactId');
    expect(response.data).not.toHaveProperty('isPrimary');
    expect(JSON.stringify(response)).not.toMatch(/recibe_notificacion_pago|tipo_destinatario_pago/);
    expect(add).toHaveBeenCalledWith('121', { type, value }, 'request-add', { userId: null, userEmail: null });
  });

  it.each([
    [{ type: ContactMethodType.Email, value: '' }, 'obligatorio'],
    [{ type: ContactMethodType.Email, value: 'not-an-email' }, 'no es válido'],
    [{ type: ContactMethodType.Email, value: `${'a'.repeat(310)}@example.test` }, 'longitud máxima'],
    [{ type: ContactMethodType.Phone, value: 'call me' }, 'no es válido'],
    [{ type: ContactMethodType.WhatsApp, value: '1'.repeat(101) }, 'longitud máxima'],
    [{ type: ContactMethodType.Web, value: 'portal.example.test' }, 'URL'],
    [{ type: ContactMethodType.Web, value: 'javascript:alert(1)' }, 'URL']
  ] as const)('rejects invalid method value %#', async (input, message) => {
    const add = vi.fn();
    const service = new ContactMethodsService({ add } as never);
    await expect(service.add('121', input, 'request-add', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 400, response: { message: expect.stringContaining(message) } });
    expect(add).not.toHaveBeenCalled();
  });

  it.each(['CONTACT_METHOD_DUPLICATE', '23505'])('maps duplicate error %s to a safe conflict', async (code) => {
    const service = new ContactMethodsService({ add: vi.fn().mockRejectedValue({ code }) } as never);
    await expect(service.add('121', { type: ContactMethodType.Email, value: 'safe@example.test' }, 'request-add', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 409, response: { code: 'CONTACT_METHOD_DUPLICATE' } });
  });

  it.each(['CONTACT_NOT_ACTIVE', 'COMPANY_NOT_ACTIVE'])('rejects unsafe parent state %s', async (code) => {
    const service = new ContactMethodsService({ add: vi.fn().mockRejectedValue({ code }) } as never);
    await expect(service.add('121', { type: ContactMethodType.Email, value: 'safe@example.test' }, 'request-add', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 409, response: { code } });
  });

  it('returns a safe 404 for a missing contact', async () => {
    const service = new ContactMethodsService({ add: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.add('121', { type: ContactMethodType.Email, value: 'safe@example.test' }, 'request-add', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    [ContactMethodType.Email, 'corrected@example.test', 'ACTIVO'],
    [ContactMethodType.Phone, '+52 449 555 0200 ext. 4', 'ACTIVO'],
    [ContactMethodType.WhatsApp, '449 555 0201', 'ACTIVO'],
    [ContactMethodType.Web, 'https://portal.example.test/new-path', 'ACTIVO'],
    [ContactMethodType.Phone, '449 555 0202', 'INACTIVO']
  ] as const)('edits %s in place and returns only safe fields', async (type, value, status) => {
    const edit = vi.fn().mockResolvedValue({ ...method, id: '205', type, value, status });
    const service = new ContactMethodsService({ edit } as never);
    await expect(service.edit('205', { type, value }, 'request-edit', { userId: null, userEmail: null })).resolves.toEqual({ data: { id: '205', type, value, status } });
    expect(edit).toHaveBeenCalledWith('205', { type, value }, 'request-edit', { userId: null, userEmail: null });
  });

  it.each([{ value: 'corrected@example.test' }, { type: ContactMethodType.Phone }])('passes partial edit payload %# to the repository', async (input) => {
    const edit = vi.fn().mockResolvedValue(method);
    const service = new ContactMethodsService({ edit } as never);
    await service.edit('205', input, 'request-edit', { userId: null, userEmail: null });
    expect(edit).toHaveBeenCalledWith('205', input, 'request-edit', { userId: null, userEmail: null });
  });

  it('rejects an empty edit before accessing the repository', async () => {
    const edit = vi.fn();
    const service = new ContactMethodsService({ edit } as never);
    await expect(service.edit('205', {}, 'request-edit', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 400 });
    expect(edit).not.toHaveBeenCalled();
  });

  it.each(['METHOD_STATUS_NOT_MANAGEABLE', 'CONTACT_NOT_ACTIVE', 'COMPANY_NOT_ACTIVE', 'CONTACT_METHOD_DUPLICATE', '23505'])('maps edit conflict %s safely', async (code) => {
    const service = new ContactMethodsService({ edit: vi.fn().mockRejectedValue({ code }) } as never);
    const expectedCode = code === '23505' ? 'CONTACT_METHOD_DUPLICATE' : code;
    await expect(service.edit('205', { value: 'corrected@example.test' }, 'request-edit', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 409, response: { code: expectedCode } });
  });

  it('returns a safe 404 for a missing method edit', async () => {
    const service = new ContactMethodsService({ edit: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.edit('205', { value: 'corrected@example.test' }, 'request-edit', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 404 });
  });

  it('changes a method lifecycle status without exposing payment-routing data', async () => {
    const changeStatus = vi.fn().mockResolvedValue(method);
    const service = new ContactMethodsService({ changeStatus } as never);
    await expect(service.deactivate('121', 'request-status', { userId: null, userEmail: null })).resolves.toEqual({ data: { id: method.id, contactId: '121', type: 'CORREO', value: 'safe@example.test', status: 'INACTIVO', isPrimary: false } });
    expect(changeStatus).toHaveBeenCalledWith('121', 'INACTIVO', 'request-status', { userId: null, userEmail: null });
  });

  it.each(['METHOD_ALREADY_INACTIVE', 'METHOD_ALREADY_ACTIVE', 'METHOD_STATUS_NOT_MANAGEABLE', 'CONTACT_NOT_ACTIVE', 'COMPANY_NOT_ACTIVE'])('maps %s to a safe conflict response', async (code) => {
    const service = new ContactMethodsService({ changeStatus: vi.fn().mockRejectedValue({ code }) } as never);
    await expect(service.deactivate('121', 'request-status', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 409, response: { code } });
  });

  it('returns a safe 404 for a missing method', async () => {
    const service = new ContactMethodsService({ changeStatus: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.reactivate('121', 'request-status', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 404 });
  });
});
