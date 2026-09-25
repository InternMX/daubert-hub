import { describe, expect, it, vi } from 'vitest';
import { ContactMethodType, ContactType, type CreateContactDto } from '../src/contacts/dto/create-contact.dto';
import { ContactsRepository } from '../src/contacts/contacts.repository';

function repositoryWithClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  return { repository: new ContactsRepository({ connect: vi.fn().mockResolvedValue(client) } as never), client };
}

const input: CreateContactDto = { companyId: '31', contactType: ContactType.Person, name: 'María López', area: 'Compras', position: 'Compradora', notes: null, methods: [{ type: ContactMethodType.Email, value: 'maria@example.test' }, { type: ContactMethodType.Phone, value: '+52 449 123 4567' }] };

describe('ContactsRepository', () => {
  it('creates an active contact and methods with explicit non-payment defaults in one transaction', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '31', estatus: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [{ contacto_id: '9007199254740993', empresa_id: '31', tipo_contacto: 'PERSONA', nombre: 'María López', area: 'Compras', cargo: 'Compradora', observaciones: null, estatus: 'ACTIVO', es_contacto_principal: false }] })
      .mockResolvedValueOnce({ rows: [{ medio_id: '9007199254740994', contacto_id: '9007199254740993', tipo_medio: 'CORREO', valor: 'maria@example.test', estatus: 'ACTIVO', es_principal: false }] })
      .mockResolvedValueOnce({ rows: [{ medio_id: '9007199254740995', contacto_id: '9007199254740993', tipo_medio: 'TELEFONO', valor: '+52 449 123 4567', estatus: 'ACTIVO', es_principal: false }] })
      .mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.create(input, 'request-1', { userId: null, userEmail: null })).resolves.toMatchObject({ contact: { estatus: 'ACTIVO', es_contacto_principal: false }, methods: [{ estatus: 'ACTIVO', es_principal: false }, { estatus: 'ACTIVO', es_principal: false }] });
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-1']);
    expect(query.mock.calls[5]).toEqual([expect.stringContaining('WHERE empresa_id = $1 FOR UPDATE'), ['31']]);
    expect(query.mock.calls[6]?.[0]).toContain("'ACTIVO', FALSE");
    expect(query.mock.calls[7]?.[0]).toContain("'ACTIVO', FALSE, FALSE, NULL");
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back the contact when a later method insertion fails', async () => {
    const failure = new Error('method insertion failed');
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '31', estatus: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [{ contacto_id: '121', empresa_id: '31', tipo_contacto: 'PERSONA', nombre: 'María López', area: 'Compras', cargo: 'Compradora', observaciones: null, estatus: 'ACTIVO', es_contacto_principal: false }] })
      .mockResolvedValueOnce({ rows: [{ medio_id: '122', contacto_id: '121', tipo_medio: 'CORREO', valor: 'maria@example.test', estatus: 'ACTIVO', es_principal: false }] })
      .mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.create(input, 'request-1', { userId: null, userEmail: null })).rejects.toBe(failure);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it.each([
    ['INACTIVO', 'ACTIVO'],
    ['ACTIVO', 'INACTIVO']
  ] as const)('changes contact status from %s to %s using exact bigint strings and status-only SQL', async (currentStatus, targetStatus) => {
    const id = '9223372036854775807';
    const locked = { contacto_id: id, empresa_id: '31', tipo_contacto: 'PERSONA', nombre: 'María López', area: 'Compras', cargo: 'Compradora', observaciones: 'Conservar', estatus: currentStatus, es_contacto_principal: true, company_status: 'ACTIVO' };
    const updated = { ...locked, estatus: targetStatus };
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [locked] });
    // Deactivation first runs the read-only PARA invariant check (Payment Notifications inactive here).
    if (targetStatus === 'INACTIVO') query.mockResolvedValueOnce({ rows: [{ active: false, total: 0, remaining: 0 }] });
    query.mockResolvedValueOnce({ rows: [updated] }).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    const updateIndex = targetStatus === 'INACTIVO' ? 7 : 6;

    await expect(repository.changeStatus(id, targetStatus, 'request-status', { userId: null, userEmail: null })).resolves.toEqual(updated);
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-status']);
    expect(query.mock.calls[5]).toEqual([expect.stringContaining('FOR UPDATE OF contact, company'), [id]]);
    expect(query.mock.calls[updateIndex]).toEqual([expect.stringMatching(/UPDATE core\.contactos SET estatus = \$1[\s\S]*RETURNING contacto_id::text, empresa_id::text, tipo_contacto, nombre, area, cargo, observaciones, estatus, es_contacto_principal/), [targetStatus, id]]);
    // Never cascades to the contact's methods: no write touches medios_contacto (the invariant check only reads it).
    expect(query.mock.calls.flatMap((call) => String(call[0])).filter((sql) => !sql.includes('SELECT')).join(' ')).not.toMatch(/medios_contacto|CASCADE/i);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('returns null for a missing contact without issuing an update', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.changeStatus('9007199254740993', 'INACTIVO', 'request-status', { userId: null, userEmail: null })).resolves.toBeNull();
    expect(query.mock.calls.some((call) => String(call[0]).includes('UPDATE core.contactos'))).toBe(false);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
  });

  it.each([
    ['ACTIVO', 'ACTIVO', 'CONTACT_ALREADY_ACTIVE'],
    ['INACTIVO', 'INACTIVO', 'CONTACT_ALREADY_INACTIVE'],
    ['PENDIENTE', 'ACTIVO', 'CONTACT_STATUS_NOT_MANAGEABLE'],
    ['RECHAZADO', 'INACTIVO', 'CONTACT_STATUS_NOT_MANAGEABLE']
  ])('rejects contact status %s targeting %s with %s', async (currentStatus, targetStatus, code) => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ contacto_id: '121', estatus: currentStatus, company_status: 'ACTIVO' }] })
      .mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.changeStatus('121', targetStatus as 'ACTIVO' | 'INACTIVO', 'request-status', { userId: null, userEmail: null })).rejects.toMatchObject({ code });
    expect(query.mock.calls.some((call) => String(call[0]).includes('UPDATE core.contactos'))).toBe(false);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it.each([
    ['INACTIVO', 'COMPANY_INACTIVE'],
    ['BLOQUEADO', 'COMPANY_BLOCKED'],
    ['PENDIENTE', 'COMPANY_NOT_ACTIVE']
  ])('rejects parent company status %s safely', async (companyStatus, code) => {
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ contacto_id: '121', estatus: 'INACTIVO', company_status: companyStatus }] })
      .mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.changeStatus('121', 'ACTIVO', 'request-status', { userId: null, userEmail: null })).rejects.toMatchObject({ code });
    expect(query.mock.calls.some((call) => String(call[0]).includes('UPDATE core.contactos'))).toBe(false);
  });
});
