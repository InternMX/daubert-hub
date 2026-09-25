import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { resolvePaymentNotificationFlags } from '../src/contact-methods/contact-method-validation';
import { ContactMethodsRepository } from '../src/contact-methods/contact-methods.repository';
import { ContactMethodsService } from '../src/contact-methods/contact-methods.service';
import { AddContactMethodDto } from '../src/contact-methods/dto/add-contact-method.dto';
import { EditContactMethodDto } from '../src/contact-methods/dto/edit-contact-method.dto';
import { ContactMethodType } from '../src/contacts/dto/create-contact.dto';

const identity = { userId: null, userEmail: null };

describe('resolvePaymentNotificationFlags', () => {
  it('receives=false normalizes the recipient type to null (whatever was sent)', () => {
    expect(resolvePaymentNotificationFlags('CORREO', { receivesPaymentNotifications: false, paymentRecipientType: 'PARA' as never })).toEqual({ receivesPaymentNotifications: false, paymentRecipientType: null });
  });

  it('omitting everything on a new method means "does not receive" / null', () => {
    expect(resolvePaymentNotificationFlags('CORREO', {})).toEqual({ receivesPaymentNotifications: false, paymentRecipientType: null });
  });

  it('receives=true without a recipient type is an error (PAYMENT_RECIPIENT_TYPE_REQUIRED)', () => {
    expect(() => resolvePaymentNotificationFlags('CORREO', { receivesPaymentNotifications: true })).toThrowError(expect.objectContaining({ status: 400, response: expect.objectContaining({ code: 'PAYMENT_RECIPIENT_TYPE_REQUIRED' }) }));
    expect(() => resolvePaymentNotificationFlags('CORREO', { receivesPaymentNotifications: true, paymentRecipientType: null })).toThrow();
  });

  it.each([ContactMethodType.Phone, ContactMethodType.WhatsApp, ContactMethodType.Web])('receives=true on %s is an error (PAYMENT_NOTIFICATION_REQUIRES_EMAIL)', (type) => {
    expect(() => resolvePaymentNotificationFlags(type, { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' as never })).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: 'PAYMENT_NOTIFICATION_REQUIRES_EMAIL' }) }));
  });

  it.each(['PARA', 'CC', 'CCO'] as const)('accepts CORREO + %s', (recipientType) => {
    expect(resolvePaymentNotificationFlags('CORREO', { receivesPaymentNotifications: true, paymentRecipientType: recipientType as never })).toEqual({ receivesPaymentNotifications: true, paymentRecipientType: recipientType });
  });

  it('non-CORREO methods stay false/null when nothing is requested', () => {
    expect(resolvePaymentNotificationFlags('TELEFONO', {})).toEqual({ receivesPaymentNotifications: false, paymentRecipientType: null });
  });

  describe('edit (current values)', () => {
    const current = { receivesPaymentNotifications: true, paymentRecipientType: 'CC' };

    it('keeps the current pair when the request omits both fields', () => {
      expect(resolvePaymentNotificationFlags('CORREO', {}, current)).toEqual({ receivesPaymentNotifications: true, paymentRecipientType: 'CC' });
    });

    it('turning receives off clears the recipient type', () => {
      expect(resolvePaymentNotificationFlags('CORREO', { receivesPaymentNotifications: false }, current)).toEqual({ receivesPaymentNotifications: false, paymentRecipientType: null });
    });

    it('changing only the recipient type keeps receives=true', () => {
      expect(resolvePaymentNotificationFlags('CORREO', { paymentRecipientType: 'PARA' as never }, current)).toEqual({ receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    });

    it('editing an email into a phone number normalizes to false/null instead of failing', () => {
      expect(resolvePaymentNotificationFlags('TELEFONO', {}, current)).toEqual({ receivesPaymentNotifications: false, paymentRecipientType: null });
    });

    it('explicitly requesting receives=true on the resulting phone number is still an error', () => {
      expect(() => resolvePaymentNotificationFlags('TELEFONO', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' as never }, current)).toThrow();
    });

    it('turning receives on for a method with no stored type requires one', () => {
      expect(() => resolvePaymentNotificationFlags('CORREO', { receivesPaymentNotifications: true }, { receivesPaymentNotifications: false, paymentRecipientType: null })).toThrow();
    });
  });
});

describe('contact method DTOs', () => {
  async function errorsFor<T extends object>(cls: new () => T, payload: object): Promise<number> {
    return (await validate(plainToInstance(cls, payload), { whitelist: true, forbidNonWhitelisted: true })).length;
  }

  it('AddContactMethodDto accepts the new camelCase fields', async () => {
    expect(await errorsFor(AddContactMethodDto, { type: 'CORREO', value: 'a@b.co', isPrimary: true, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' })).toBe(0);
    expect(await errorsFor(AddContactMethodDto, { type: 'CORREO', value: 'a@b.co', receivesPaymentNotifications: false, paymentRecipientType: null })).toBe(0);
  });

  it('EditContactMethodDto accepts the new fields on their own', async () => {
    expect(await errorsFor(EditContactMethodDto, { isPrimary: false })).toBe(0);
    expect(await errorsFor(EditContactMethodDto, { receivesPaymentNotifications: true, paymentRecipientType: 'CCO' })).toBe(0);
  });

  it.each([{ paymentRecipientType: 'TO' }, { paymentRecipientType: 'para' }, { receivesPaymentNotifications: 'yes' }, { isPrimary: 'true' }])('rejects invalid payload %j', async (payload) => {
    expect(await errorsFor(EditContactMethodDto, payload)).toBeGreaterThan(0);
    expect(await errorsFor(AddContactMethodDto, { type: 'CORREO', value: 'a@b.co', ...payload })).toBeGreaterThan(0);
  });

  it('still rejects snake_case column names and status', async () => {
    for (const field of ['recibe_notificacion_pago', 'tipo_destinatario_pago', 'es_principal', 'status']) {
      expect(await errorsFor(EditContactMethodDto, { value: 'a@b.co', [field]: true })).toBeGreaterThan(0);
    }
  });
});

describe('ContactMethodsService (payment flags)', () => {
  const record = { id: '205', contact_id: '31', type: 'CORREO', value: 'pagos@example.test', status: 'ACTIVO', is_primary: false, receives_payment_notifications: true, payment_recipient_type: 'PARA' };

  it('add rejects receives=true without a recipient type before any DB access', async () => {
    const add = vi.fn();
    const service = new ContactMethodsService({ add } as never);
    await expect(service.add('31', { type: ContactMethodType.Email, value: 'pagos@example.test', receivesPaymentNotifications: true }, 'req', identity)).rejects.toMatchObject({ status: 400, response: { code: 'PAYMENT_RECIPIENT_TYPE_REQUIRED' } });
    expect(add).not.toHaveBeenCalled();
  });

  it('add rejects receives=true on a phone number before any DB access', async () => {
    const add = vi.fn();
    const service = new ContactMethodsService({ add } as never);
    await expect(service.add('31', { type: ContactMethodType.Phone, value: '449 555 0100', receivesPaymentNotifications: true, paymentRecipientType: 'PARA' as never }, 'req', identity)).rejects.toMatchObject({ response: { code: 'PAYMENT_NOTIFICATION_REQUIRES_EMAIL' } });
    expect(add).not.toHaveBeenCalled();
  });

  it.each(['PARA', 'CC', 'CCO'])('add + %s returns the camelCase payment fields', async (recipient) => {
    const add = vi.fn().mockResolvedValue({ ...record, payment_recipient_type: recipient });
    const service = new ContactMethodsService({ add } as never);
    const { data } = await service.add('31', { type: ContactMethodType.Email, value: 'pagos@example.test', receivesPaymentNotifications: true, paymentRecipientType: recipient as never }, 'req', identity);
    expect(data).toMatchObject({ receivesPaymentNotifications: true, paymentRecipientType: recipient, isPrimary: false });
    expect(JSON.stringify(data)).not.toMatch(/recibe_notificacion_pago|tipo_destinatario_pago|es_principal/);
  });

  it('a payload with only payment fields is a valid edit (not "empty")', async () => {
    const edit = vi.fn().mockResolvedValue(record);
    const service = new ContactMethodsService({ edit } as never);
    await expect(service.edit('205', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' as never }, 'req', identity)).resolves.toBeTruthy();
    await expect(service.edit('205', { isPrimary: true }, 'req', identity)).resolves.toBeTruthy();
    await expect(service.edit('205', {}, 'req', identity)).rejects.toMatchObject({ status: 400 });
  });
});

describe('ContactMethodsRepository (payment flags / primary)', () => {
  function clientWith(handler: (sql: string, params?: unknown[]) => unknown) {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => { calls.push({ sql, params }); return handler(sql, params) ?? { rows: [] }; });
    const client = { query, release: vi.fn() };
    return { calls, repository: new ContactMethodsRepository({ connect: vi.fn().mockResolvedValue(client) } as never) };
  }

  const lockedContact = { rows: [{ id: '31', status: 'ACTIVO', company_status: 'ACTIVO' }] };
  const insertedRow = { rows: [{ id: '205', contact_id: '31', type: 'CORREO', value: 'pagos@example.test', status: 'ACTIVO', is_primary: false, receives_payment_notifications: true, payment_recipient_type: 'PARA' }] };

  it('add persists CORREO + PARA without marking the method primary (isPrimary is independent)', async () => {
    const { repository, calls } = clientWith((sql) => sql.includes('FOR UPDATE OF contact') ? lockedContact : sql.includes('INSERT INTO core.medios_contacto') ? insertedRow : undefined);
    await repository.add('31', { type: ContactMethodType.Email, value: 'pagos@example.test', receivesPaymentNotifications: true, paymentRecipientType: 'PARA' as never }, 'req', identity);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO core.medios_contacto'))!;
    expect(insert.params).toEqual(['31', 'CORREO', 'pagos@example.test', false, true, 'PARA']);
    expect(calls.some((call) => call.sql.includes('SET es_principal = FALSE'))).toBe(false);
  });

  it('add with isPrimary=true and no payment flags does not turn it into PARA', async () => {
    const { repository, calls } = clientWith((sql) => sql.includes('FOR UPDATE OF contact') ? lockedContact : sql.includes('INSERT INTO core.medios_contacto') ? insertedRow : undefined);
    await repository.add('31', { type: ContactMethodType.Email, value: 'pagos@example.test', isPrimary: true }, 'req', identity);
    expect(calls.find((call) => call.sql.includes('INSERT INTO core.medios_contacto'))!.params).toEqual(['31', 'CORREO', 'pagos@example.test', true, false, null]);
    // The previous primary of the same type is demoted first (uq_medio_principal_por_tipo).
    const demote = calls.findIndex((call) => call.sql.includes('SET es_principal = FALSE'));
    const insert = calls.findIndex((call) => call.sql.includes('INSERT INTO core.medios_contacto'));
    expect(demote).toBeGreaterThan(-1);
    expect(demote).toBeLessThan(insert);
  });

  it('add rejects receives=true without a recipient type inside the transaction and rolls back', async () => {
    const { repository, calls } = clientWith((sql) => sql.includes('FOR UPDATE OF contact') ? lockedContact : undefined);
    await expect(repository.add('31', { type: ContactMethodType.Email, value: 'pagos@example.test', receivesPaymentNotifications: true }, 'req', identity)).rejects.toMatchObject({ status: 400 });
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
    expect(calls.some((call) => call.sql.includes('INSERT INTO core.medios_contacto'))).toBe(false);
  });

  const lockedMethod = (overrides: object = {}) => ({ rows: [{ id: '205', contact_id: '31', type: 'CORREO', value: 'pagos@example.test', status: 'ACTIVO', is_primary: true, receives_payment_notifications: true, payment_recipient_type: 'PARA', contact_status: 'ACTIVO', company_status: 'ACTIVO', ...overrides }] });

  it('edit: receives=false clears the recipient type; isPrimary is left exactly as it was', async () => {
    const { repository, calls } = clientWith((sql) => sql.includes('FOR UPDATE OF method') ? lockedMethod() : sql.includes('UPDATE core.medios_contacto') ? insertedRow : undefined);
    await repository.edit('205', { receivesPaymentNotifications: false }, 'req', identity);
    expect(calls.find((call) => call.sql.includes('UPDATE core.medios_contacto') && call.sql.includes('SET tipo_medio'))!.params).toEqual(['CORREO', 'pagos@example.test', true, false, null, '205']);
  });

  it('edit: PARA does not make the method primary, and primary does not make it PARA', async () => {
    const { repository, calls } = clientWith((sql) => sql.includes('FOR UPDATE OF method') ? lockedMethod({ is_primary: false, receives_payment_notifications: false, payment_recipient_type: null }) : sql.includes('UPDATE core.medios_contacto') ? insertedRow : undefined);
    await repository.edit('205', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' as never }, 'req', identity);
    expect(calls.find((call) => call.sql.includes('SET tipo_medio'))!.params).toEqual(['CORREO', 'pagos@example.test', false, true, 'PARA', '205']);

    const second = clientWith((sql) => sql.includes('FOR UPDATE OF method') ? lockedMethod({ is_primary: false, receives_payment_notifications: false, payment_recipient_type: null }) : sql.includes('UPDATE core.medios_contacto') ? insertedRow : undefined);
    await second.repository.edit('205', { isPrimary: true }, 'req', identity);
    expect(second.calls.find((call) => call.sql.includes('SET tipo_medio'))!.params).toEqual(['CORREO', 'pagos@example.test', true, false, null, '205']);
    expect(second.calls.some((call) => call.sql.includes('SET es_principal = FALSE'))).toBe(true);
  });

  it('edit: rejects receives=true when the resulting method is not an email (rolls back, no update)', async () => {
    const { repository, calls } = clientWith((sql) => sql.includes('FOR UPDATE OF method') ? lockedMethod({ type: 'TELEFONO', value: '449 555 0100', receives_payment_notifications: false, payment_recipient_type: null }) : undefined);
    await expect(repository.edit('205', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' as never }, 'req', identity)).rejects.toMatchObject({ response: { code: 'PAYMENT_NOTIFICATION_REQUIRES_EMAIL' } });
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
    expect(calls.some((call) => call.sql.includes('SET tipo_medio'))).toBe(false);
  });

  it('edit: turning an email that receives notifications into a phone number normalizes it to false/null', async () => {
    const { repository, calls } = clientWith((sql) => sql.includes('FOR UPDATE OF method') ? lockedMethod() : sql.includes('UPDATE core.medios_contacto') ? insertedRow : undefined);
    await repository.edit('205', { type: ContactMethodType.Phone, value: '449 555 0100' }, 'req', identity);
    expect(calls.find((call) => call.sql.includes('SET tipo_medio'))!.params).toEqual(['TELEFONO', '449 555 0100', true, false, null, '205']);
  });
});
