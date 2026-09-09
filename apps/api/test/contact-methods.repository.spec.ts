import { describe, expect, it, vi } from 'vitest';
import { ContactMethodsRepository } from '../src/contact-methods/contact-methods.repository';
import { ContactMethodType } from '../src/contacts/dto/create-contact.dto';

function repositoryWithClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  return { repository: new ContactMethodsRepository({ connect: vi.fn().mockResolvedValue(client) } as never), client };
}

describe('ContactMethodsRepository', () => {
  it('adds an explicit active, non-primary, non-payment method in an audited transaction', async () => {
    const created = { id: '205', contact_id: '31', type: 'TELEFONO', value: '+52 449 222 2222', status: 'ACTIVO', is_primary: false };
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: '31', status: 'ACTIVO', company_status: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [created] }).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.add('31', { type: ContactMethodType.Phone, value: '+52 449 222 2222' }, 'request-add', { userId: null, userEmail: null })).resolves.toEqual(created);
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-add']);
    expect(query.mock.calls[5]?.[0]).toContain('FOR UPDATE OF contact');
    expect(query.mock.calls[6]?.[0]).toContain('BTRIM(valor) = $3');
    expect(query.mock.calls[7]?.[0]).toContain("VALUES ($1, $2, $3, 'ACTIVO', FALSE, FALSE, NULL)");
    expect(query.mock.calls[7]?.[1]).toEqual(['31', 'TELEFONO', '+52 449 222 2222']);
    expect(query).toHaveBeenNthCalledWith(9, 'COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('checks email duplicates case-insensitively while holding the contact lock', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: '31', status: 'ACTIVO', company_status: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.add('31', { type: ContactMethodType.Email, value: 'Test@Empresa.com' }, 'request-add', { userId: null, userEmail: null })).rejects.toMatchObject({ code: 'CONTACT_METHOD_DUPLICATE' });
    expect(query.mock.calls[6]?.[0]).toContain('LOWER(BTRIM(valor)) = LOWER($3)');
    expect(query).toHaveBeenNthCalledWith(8, 'ROLLBACK');
  });

  it.each([
    [{ id: '31', status: 'PENDIENTE', company_status: 'ACTIVO' }, 'CONTACT_NOT_ACTIVE'],
    [{ id: '31', status: 'INACTIVO', company_status: 'ACTIVO' }, 'CONTACT_NOT_ACTIVE'],
    [{ id: '31', status: 'RECHAZADO', company_status: 'ACTIVO' }, 'CONTACT_NOT_ACTIVE'],
    [{ id: '31', status: 'ACTIVO', company_status: 'INACTIVO' }, 'COMPANY_NOT_ACTIVE'],
    [{ id: '31', status: 'ACTIVO', company_status: 'BLOQUEADO' }, 'COMPANY_NOT_ACTIVE']
  ])('rejects unsafe contact/company state %#', async (row, code) => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.add('31', { type: ContactMethodType.Email, value: 'safe@example.test' }, 'request-add', { userId: null, userEmail: null })).rejects.toMatchObject({ code });
  });

  it('updates only the status in an audited transaction', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: '121', contact_id: '31', type: 'CORREO', value: 'safe@example.test', status: 'ACTIVO', is_primary: false, contact_status: 'ACTIVO', company_status: 'ACTIVO' }] })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.changeStatus('121', 'INACTIVO', 'request-1', { userId: null, userEmail: null })).resolves.toEqual({ id: '121', contact_id: '31', type: 'CORREO', value: 'safe@example.test', status: 'INACTIVO', is_primary: false });
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-1']);
    expect(query.mock.calls[5]?.[0]).toContain('FOR UPDATE OF method, contact, company');
    expect(query).toHaveBeenNthCalledWith(7, 'UPDATE core.medios_contacto SET estatus = $1 WHERE medio_id = $2', ['INACTIVO', '121']);
    expect(query).toHaveBeenNthCalledWith(8, 'COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back if a parent is inactive', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: '121', contact_id: '31', type: 'CORREO', value: 'safe@example.test', status: 'ACTIVO', is_primary: false, contact_status: 'ACTIVO', company_status: 'INACTIVO' }] })
      .mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.changeStatus('121', 'INACTIVO', 'request-1', { userId: null, userEmail: null })).rejects.toMatchObject({ code: 'COMPANY_NOT_ACTIVE' });
    expect(query).toHaveBeenNthCalledWith(7, 'ROLLBACK');
  });

  it.each([
    [{ value: 'corrected@example.test' }, 'CORREO', 'corrected@example.test', 'ACTIVO'],
    [{ type: ContactMethodType.Phone }, 'TELEFONO', '449 555 0200', 'ACTIVO'],
    [{ type: ContactMethodType.WhatsApp, value: '+52 449 555 0201' }, 'WHATSAPP', '+52 449 555 0201', 'INACTIVO']
  ] as const)('updates only the resulting type/value in place for partial payload %#', async (input, type, value, status) => {
    const locked = { id: '205', contact_id: '31', type: 'CORREO', value: '449 555 0200', status, is_primary: true, contact_status: 'ACTIVO', company_status: 'ACTIVO' };
    const updated = { id: '205', contact_id: '31', type, value, status, is_primary: true };
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [locked] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [updated] }).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.edit('205', input, 'request-edit', { userId: null, userEmail: null })).resolves.toEqual(updated);
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-edit']);
    expect(query.mock.calls[5]?.[0]).toContain('FOR UPDATE OF method, contact, company');
    expect(query.mock.calls[6]?.[0]).toContain('medio_id <> $4::bigint');
    expect(query.mock.calls[6]?.[1]).toEqual(['31', type, value, '205']);
    expect(query.mock.calls[7]?.[0]).toContain('SET tipo_medio = $1, valor = $2');
    expect(query.mock.calls[7]?.[0]).not.toMatch(/estatus\s*=|es_principal\s*=|recibe_notificacion_pago\s*=|tipo_destinatario_pago\s*=|observaciones\s*=/);
    expect(query.mock.calls[7]?.[1]).toEqual([type, value, '205']);
    expect(query).toHaveBeenNthCalledWith(9, 'COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('excludes the edited row while checking case-insensitive email duplicates', async () => {
    const locked = { id: '205', contact_id: '31', type: 'CORREO', value: 'same@example.test', status: 'ACTIVO', is_primary: false, contact_status: 'ACTIVO', company_status: 'ACTIVO' };
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [locked] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [locked] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.edit('205', { value: 'same@example.test' }, 'request-edit', { userId: null, userEmail: null })).resolves.toEqual(locked);
    expect(query.mock.calls[6]?.[0]).toContain('LOWER(BTRIM(valor)) = LOWER($3)');
    expect(query.mock.calls[6]?.[1]).toEqual(['31', 'CORREO', 'same@example.test', '205']);
  });

  it('rejects a duplicate resulting value and rolls back without updating', async () => {
    const locked = { id: '205', contact_id: '31', type: 'TELEFONO', value: '449 555 0200', status: 'ACTIVO', is_primary: false, contact_status: 'ACTIVO', company_status: 'ACTIVO' };
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [locked] }).mockResolvedValueOnce({ rows: [{}] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.edit('205', { value: '449 555 0201' }, 'request-edit', { userId: null, userEmail: null })).rejects.toMatchObject({ code: 'CONTACT_METHOD_DUPLICATE' });
    expect(query).toHaveBeenNthCalledWith(8, 'ROLLBACK');
    expect(query.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes('UPDATE core.medios_contacto'))).toBe(false);
  });

  it('validates the final pair after applying a type-only patch', async () => {
    const locked = { id: '205', contact_id: '31', type: 'CORREO', value: 'safe@example.test', status: 'ACTIVO', is_primary: false, contact_status: 'ACTIVO', company_status: 'ACTIVO' };
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [locked] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.edit('205', { type: ContactMethodType.Phone }, 'request-edit', { userId: null, userEmail: null })).rejects.toMatchObject({ status: 400 });
    expect(query).toHaveBeenNthCalledWith(7, 'ROLLBACK');
  });

  it.each([
    ['PENDIENTE', 'ACTIVO', 'ACTIVO', 'METHOD_STATUS_NOT_MANAGEABLE'],
    ['RECHAZADO', 'ACTIVO', 'ACTIVO', 'METHOD_STATUS_NOT_MANAGEABLE'],
    ['ACTIVO', 'INACTIVO', 'ACTIVO', 'CONTACT_NOT_ACTIVE'],
    ['ACTIVO', 'PENDIENTE', 'ACTIVO', 'CONTACT_NOT_ACTIVE'],
    ['ACTIVO', 'RECHAZADO', 'ACTIVO', 'CONTACT_NOT_ACTIVE'],
    ['ACTIVO', 'ACTIVO', 'INACTIVO', 'COMPANY_NOT_ACTIVE'],
    ['ACTIVO', 'ACTIVO', 'BLOQUEADO', 'COMPANY_NOT_ACTIVE']
  ])('rejects unsafe method/contact/company states %#', async (status, contactStatus, companyStatus, code) => {
    const locked = { id: '205', contact_id: '31', type: 'CORREO', value: 'safe@example.test', status, is_primary: false, contact_status: contactStatus, company_status: companyStatus };
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [locked] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.edit('205', { value: 'corrected@example.test' }, 'request-edit', { userId: null, userEmail: null })).rejects.toMatchObject({ code });
  });

  it('returns null for a nonexistent method without attempting an update', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.edit('999999999999999', { value: 'corrected@example.test' }, 'request-edit', { userId: null, userEmail: null })).resolves.toBeNull();
    expect(query).toHaveBeenNthCalledWith(7, 'COMMIT');
  });
});
