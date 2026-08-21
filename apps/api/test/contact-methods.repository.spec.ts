import { describe, expect, it, vi } from 'vitest';
import { ContactMethodsRepository } from '../src/contact-methods/contact-methods.repository';

function repositoryWithClient(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() };
  return { repository: new ContactMethodsRepository({ connect: vi.fn().mockResolvedValue(client) } as never), client };
}

describe('ContactMethodsRepository', () => {
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
