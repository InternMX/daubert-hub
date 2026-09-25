import { describe, expect, it, vi } from 'vitest';
import { ContactMethodsRepository } from '../src/contact-methods/contact-methods.repository';
import { ContactMethodsService } from '../src/contact-methods/contact-methods.service';
import { ContactsRepository } from '../src/contacts/contacts.repository';
import { ContactsService } from '../src/contacts/contacts.service';
import { assertActiveCompanyKeepsPara } from '../src/payment-notification-settings/payment-notification-para-invariant';

const identity = { userId: null, userEmail: null };
type Invariant = { active: boolean | null; total: number; remaining: number };

// Fake transaction client dispatching on SQL text: the invariant query, the lock queries and writes.
function fakeClient(options: { invariant?: Invariant; methodRow?: object; contactRow?: object }) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('notificaciones_activas')) return { rows: [options.invariant ?? { active: false, total: 0, remaining: 0 }] };
    if (sql.includes('FOR UPDATE OF method')) return { rows: [options.methodRow] };
    if (sql.includes('FOR UPDATE OF contact, company')) return { rows: [options.contactRow] };
    if (sql.includes('RETURNING')) return { rows: [{ id: '5', contact_id: '31', type: 'CORREO', value: 'a@example.test', status: 'INACTIVO', is_primary: false, receives_payment_notifications: false, payment_recipient_type: null, contacto_id: '31', empresa_id: '77', estatus: 'INACTIVO' }] };
    return { rows: [] };
  });
  return { calls, client: { query, release: vi.fn() } };
}
const writes = (calls: Array<{ sql: string }>) => calls.filter((call) => /^\s*(UPDATE|INSERT|DELETE)/i.test(call.sql));
const invariantCalls = (calls: Array<{ sql: string; params?: unknown[] }>) => calls.filter((call) => call.sql.includes('notificaciones_activas'));

const BLOCKING: Invariant = { active: true, total: 1, remaining: 0 };
const TWO_PARA: Invariant = { active: true, total: 2, remaining: 1 };

const paraMethod = { id: '5', contact_id: '31', company_id: '77', type: 'CORREO', value: 'para@example.test', status: 'ACTIVO', is_primary: false, receives_payment_notifications: true, payment_recipient_type: 'PARA', contact_status: 'ACTIVO', company_status: 'ACTIVO' };
const ccMethod = { ...paraMethod, payment_recipient_type: 'CC' };
const ccoMethod = { ...paraMethod, payment_recipient_type: 'CCO' };
const contactRow = { contacto_id: '31', empresa_id: '77', tipo_contacto: 'AREA', nombre: null, area: 'Pagos', cargo: null, observaciones: null, estatus: 'ACTIVO', es_contacto_principal: false, company_status: 'ACTIVO' };

function methodsRepository(client: unknown) { return new ContactMethodsRepository({ connect: vi.fn().mockResolvedValue(client) } as never); }
function contactsRepository(client: unknown) { return new ContactsRepository({ connect: vi.fn().mockResolvedValue(client) } as never); }

describe('assertActiveCompanyKeepsPara (projected-state check)', () => {
  const run = async (row: Invariant | undefined, target: { methodId?: string; contactId?: string } = { methodId: '5' }) => {
    const query = vi.fn().mockResolvedValue({ rows: row ? [row] : [] });
    await assertActiveCompanyKeepsPara({ query } as never, '77', target);
    return query;
  };

  it('blocks when notifications are active and the affected target holds every operable PARA', async () => {
    await expect(run(BLOCKING)).rejects.toMatchObject({ code: 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA' });
  });

  it('allows the change when another operable PARA would remain (two PARA, remove one)', async () => {
    await expect(run(TWO_PARA)).resolves.toBeTypeOf('function');
  });

  it('allows any change when Payment Notifications are inactive (may remove every PARA)', async () => {
    await expect(run({ active: false, total: 1, remaining: 0 })).resolves.toBeTypeOf('function');
  });

  it('allows the change for a company with no settings row (historical) or no query result', async () => {
    await expect(run({ active: null, total: 1, remaining: 0 })).resolves.toBeTypeOf('function');
    await expect(run(undefined)).resolves.toBeTypeOf('function');
  });

  it('does not block when the affected target holds no operable PARA (nothing gets worse, legacy rows stay editable)', async () => {
    await expect(run({ active: true, total: 0, remaining: 0 })).resolves.toBeTypeOf('function');
  });

  it('is read-only, excludes the affected method/contact from the count and never touches es_principal', async () => {
    const query = await run(TWO_PARA, { methodId: '5', contactId: '31' });
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(sql).not.toContain('es_principal');
    expect(sql).toContain("method.tipo_destinatario_pago = 'PARA'");
    expect(sql).toContain("contact.estatus = 'ACTIVO'");
    expect(params).toEqual(['77', '5', '31']);
  });

  it('skips silently without a company id', async () => {
    const query = vi.fn();
    await assertActiveCompanyKeepsPara({ query } as never, undefined, { methodId: '5' });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('PATCH contact method — protected transitions of the only PARA', () => {
  it.each([
    ['receives true -> false', { receivesPaymentNotifications: false }, paraMethod],
    ['PARA -> CC', { paymentRecipientType: 'CC' }, paraMethod],
    ['PARA -> CCO', { paymentRecipientType: 'CCO' }, paraMethod],
    ['CORREO -> TELEFONO', { type: 'TELEFONO', value: '449 555 0100' }, paraMethod],
    ['CORREO -> WHATSAPP', { type: 'WHATSAPP', value: '449 555 0100' }, paraMethod]
  ])('%s is refused with 409-mapped code and no partial write (rolled back)', async (_label, input, row) => {
    const { client, calls } = fakeClient({ methodRow: row, invariant: BLOCKING });
    await expect(methodsRepository(client).edit('5', input as never, 'req', identity)).rejects.toMatchObject({ code: 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA' });
    expect(writes(calls)).toHaveLength(0);
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
    // The company row is locked (same lock as the settings PATCH) BEFORE the projected check runs.
    const lock = calls.findIndex((call) => call.sql.includes('FOR UPDATE OF method, contact, company'));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(calls.findIndex((call) => call.sql.includes('notificaciones_activas')));
  });

  it('two PARA: removing one is allowed and the update runs', async () => {
    const { client, calls } = fakeClient({ methodRow: paraMethod, invariant: TWO_PARA });
    await methodsRepository(client).edit('5', { receivesPaymentNotifications: false }, 'req', identity);
    expect(writes(calls).some((call) => call.sql.includes('UPDATE core.medios_contacto'))).toBe(true);
    expect(calls.at(-1)!.sql).toBe('COMMIT');
  });

  it('inactive settings: removing the last PARA is allowed', async () => {
    const { client, calls } = fakeClient({ methodRow: paraMethod, invariant: { active: false, total: 1, remaining: 0 } });
    await methodsRepository(client).edit('5', { paymentRecipientType: 'CCO' as never }, 'req', identity);
    expect(calls.at(-1)!.sql).toBe('COMMIT');
  });

  it.each([
    ['editing a CC', ccMethod, { value: 'cc2@example.test' }],
    ['editing a CCO', ccoMethod, { value: 'cco2@example.test' }],
    ['turning a CC into a CCO', ccMethod, { paymentRecipientType: 'CCO' }]
  ])('%s never triggers the check (cannot worsen readiness)', async (_label, row, input) => {
    const { client, calls } = fakeClient({ methodRow: row, invariant: BLOCKING });
    await methodsRepository(client).edit('5', input as never, 'req', identity);
    expect(invariantCalls(calls)).toHaveLength(0);
    expect(calls.at(-1)!.sql).toBe('COMMIT');
  });

  it('changing isPrimary on the only PARA is allowed: es_principal does not intervene', async () => {
    const { client, calls } = fakeClient({ methodRow: paraMethod, invariant: BLOCKING });
    await methodsRepository(client).edit('5', { isPrimary: true }, 'req', identity);
    expect(invariantCalls(calls)).toHaveLength(0);
    expect(calls.at(-1)!.sql).toBe('COMMIT');
  });

  it('editing only the value of the only PARA (it stays PARA) is allowed', async () => {
    const { client, calls } = fakeClient({ methodRow: paraMethod, invariant: BLOCKING });
    await methodsRepository(client).edit('5', { value: 'nuevo@example.test' }, 'req', identity);
    expect(invariantCalls(calls)).toHaveLength(0);
  });

  it('turning a CC into PARA (or adding a PARA) is never blocked', async () => {
    const { client, calls } = fakeClient({ methodRow: ccMethod, invariant: BLOCKING });
    await methodsRepository(client).edit('5', { paymentRecipientType: 'PARA' as never }, 'req', identity);
    expect(invariantCalls(calls)).toHaveLength(0);
  });
});

describe('POST /contact-methods/:id/deactivate|reactivate', () => {
  it('deactivating the only PARA method is refused and nothing is written', async () => {
    const { client, calls } = fakeClient({ methodRow: paraMethod, invariant: BLOCKING });
    await expect(methodsRepository(client).changeStatus('5', 'INACTIVO', 'req', identity)).rejects.toMatchObject({ code: 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA' });
    expect(writes(calls)).toHaveLength(0);
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
  });

  it('deactivating one of two PARA methods is allowed', async () => {
    const { client, calls } = fakeClient({ methodRow: paraMethod, invariant: TWO_PARA });
    await methodsRepository(client).changeStatus('5', 'INACTIVO', 'req', identity);
    expect(calls.at(-1)!.sql).toBe('COMMIT');
  });

  it('deactivating a CC/CCO or a plain email is not checked', async () => {
    for (const row of [ccMethod, ccoMethod, { ...paraMethod, receives_payment_notifications: false, payment_recipient_type: null }]) {
      const { client, calls } = fakeClient({ methodRow: row, invariant: BLOCKING });
      await methodsRepository(client).changeStatus('5', 'INACTIVO', 'req', identity);
      expect(invariantCalls(calls)).toHaveLength(0);
    }
  });

  it('reactivating a PARA is always allowed and never checked', async () => {
    const { client, calls } = fakeClient({ methodRow: { ...paraMethod, status: 'INACTIVO' }, invariant: BLOCKING });
    await methodsRepository(client).changeStatus('5', 'ACTIVO', 'req', identity);
    expect(invariantCalls(calls)).toHaveLength(0);
    expect(calls.at(-1)!.sql).toBe('COMMIT');
  });

  it('inactive settings: deactivating the last PARA method is allowed', async () => {
    const { client, calls } = fakeClient({ methodRow: paraMethod, invariant: { active: false, total: 1, remaining: 0 } });
    await methodsRepository(client).changeStatus('5', 'INACTIVO', 'req', identity);
    expect(calls.at(-1)!.sql).toBe('COMMIT');
  });
});

describe('POST /contacts/:id/deactivate', () => {
  it('refuses to deactivate the contact that holds the only operable PARA, with no partial write', async () => {
    const { client, calls } = fakeClient({ contactRow, invariant: BLOCKING });
    await expect(contactsRepository(client).changeStatus('31', 'INACTIVO', 'req', identity)).rejects.toMatchObject({ code: 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA' });
    expect(writes(calls)).toHaveLength(0);
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
    expect(invariantCalls(calls)[0]!.params).toEqual(['77', null, '31']);
  });

  it('allows it when another contact keeps a PARA, or when notifications are inactive', async () => {
    for (const invariant of [TWO_PARA, { active: false, total: 1, remaining: 0 }]) {
      const { client, calls } = fakeClient({ contactRow, invariant });
      await contactsRepository(client).changeStatus('31', 'INACTIVO', 'req', identity);
      expect(calls.at(-1)!.sql).toBe('COMMIT');
    }
  });

  it('reactivating a contact is never checked', async () => {
    const { client, calls } = fakeClient({ contactRow: { ...contactRow, estatus: 'INACTIVO' }, invariant: BLOCKING });
    await contactsRepository(client).changeStatus('31', 'ACTIVO', 'req', identity);
    expect(invariantCalls(calls)).toHaveLength(0);
  });
});

describe('HTTP mapping (409 PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA)', () => {
  const blocked = Object.assign(new Error('x'), { code: 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA' });
  const expected = { status: 409, response: { code: 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA', missingRequirements: ['PAYMENT_RECIPIENT_PARA_REQUIRED'] } };

  it('edit method', async () => {
    const service = new ContactMethodsService({ edit: vi.fn().mockRejectedValue(blocked) } as never);
    await expect(service.edit('5', { receivesPaymentNotifications: false }, 'req', identity)).rejects.toMatchObject(expected);
  });

  it('deactivate method', async () => {
    const service = new ContactMethodsService({ changeStatus: vi.fn().mockRejectedValue(blocked) } as never);
    await expect(service.deactivate('5', 'req', identity)).rejects.toMatchObject(expected);
  });

  it('deactivate contact', async () => {
    const service = new ContactsService({ changeStatus: vi.fn().mockRejectedValue(blocked) } as never);
    await expect(service.deactivate('31', 'req', identity)).rejects.toMatchObject(expected);
  });

  it('the message is the clear user-facing one and leaks no SQL or ids', async () => {
    const service = new ContactMethodsService({ changeStatus: vi.fn().mockRejectedValue(blocked) } as never);
    const failure = await service.deactivate('5', 'req', identity).catch((error: unknown) => error);
    const body = JSON.stringify((failure as { response: unknown }).response);
    expect(body).toContain('último destinatario PARA');
    expect(body).not.toMatch(/SELECT|core\.|medios_contacto|\b77\b/i);
  });
});
