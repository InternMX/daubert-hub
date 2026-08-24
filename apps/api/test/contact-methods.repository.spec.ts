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
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: '31', status: 'ACTIVO', company_status: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [created] }).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.add('31', { type: ContactMethodType.Phone, value: '+52 449 222 2222' }, 'request-add')).resolves.toEqual(created);
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-add']);
    expect(query.mock.calls[3]?.[0]).toContain('FOR UPDATE OF contact');
    expect(query.mock.calls[4]?.[0]).toContain('BTRIM(valor) = $3');
    expect(query.mock.calls[5]?.[0]).toContain("VALUES ($1, $2, $3, 'ACTIVO', FALSE, FALSE, NULL)");
    expect(query.mock.calls[5]?.[1]).toEqual(['31', 'TELEFONO', '+52 449 222 2222']);
    expect(query).toHaveBeenNthCalledWith(7, 'COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('checks email duplicates case-insensitively while holding the contact lock', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: '31', status: 'ACTIVO', company_status: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.add('31', { type: ContactMethodType.Email, value: 'Test@Empresa.com' }, 'request-add')).rejects.toMatchObject({ code: 'CONTACT_METHOD_DUPLICATE' });
    expect(query.mock.calls[4]?.[0]).toContain('LOWER(BTRIM(valor)) = LOWER($3)');
    expect(query).toHaveBeenNthCalledWith(6, 'ROLLBACK');
  });

  it.each([
    [{ id: '31', status: 'PENDIENTE', company_status: 'ACTIVO' }, 'CONTACT_NOT_ACTIVE'],
    [{ id: '31', status: 'INACTIVO', company_status: 'ACTIVO' }, 'CONTACT_NOT_ACTIVE'],
    [{ id: '31', status: 'RECHAZADO', company_status: 'ACTIVO' }, 'CONTACT_NOT_ACTIVE'],
    [{ id: '31', status: 'ACTIVO', company_status: 'INACTIVO' }, 'COMPANY_NOT_ACTIVE'],
    [{ id: '31', status: 'ACTIVO', company_status: 'BLOQUEADO' }, 'COMPANY_NOT_ACTIVE']
  ])('rejects unsafe contact/company state %#', async (row, code) => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.add('31', { type: ContactMethodType.Email, value: 'safe@example.test' }, 'request-add')).rejects.toMatchObject({ code });
  });

  it('updates only the status in an audited transaction', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: '121', contact_id: '31', type: 'CORREO', value: 'safe@example.test', status: 'ACTIVO', is_primary: false, contact_status: 'ACTIVO', company_status: 'ACTIVO' }] })
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.changeStatus(121, 'INACTIVO', 'request-1')).resolves.toEqual({ id: '121', contact_id: '31', type: 'CORREO', value: 'safe@example.test', status: 'INACTIVO', is_primary: false });
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-1']);
    expect(query.mock.calls[3]?.[0]).toContain('FOR UPDATE OF method, contact, company');
    expect(query).toHaveBeenNthCalledWith(5, 'UPDATE core.medios_contacto SET estatus = $1 WHERE medio_id = $2', ['INACTIVO', 121]);
    expect(query).toHaveBeenNthCalledWith(6, 'COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back if a parent is inactive', async () => {
    const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: '121', contact_id: '31', type: 'CORREO', value: 'safe@example.test', status: 'ACTIVO', is_primary: false, contact_status: 'ACTIVO', company_status: 'INACTIVO' }] })
      .mockResolvedValueOnce(undefined);
    const { repository } = repositoryWithClient(query);
    await expect(repository.changeStatus(121, 'INACTIVO', 'request-1')).rejects.toMatchObject({ code: 'COMPANY_NOT_ACTIVE' });
    expect(query).toHaveBeenNthCalledWith(5, 'ROLLBACK');
  });
});
