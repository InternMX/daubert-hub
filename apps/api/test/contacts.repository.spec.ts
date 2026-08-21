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
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '31', estatus: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [{ contacto_id: '9007199254740993', empresa_id: '31', tipo_contacto: 'PERSONA', nombre: 'María López', area: 'Compras', cargo: 'Compradora', observaciones: null, estatus: 'ACTIVO', es_contacto_principal: false }] })
      .mockResolvedValueOnce({ rows: [{ medio_id: '9007199254740994', contacto_id: '9007199254740993', tipo_medio: 'CORREO', valor: 'maria@example.test', estatus: 'ACTIVO', es_principal: false }] })
      .mockResolvedValueOnce({ rows: [{ medio_id: '9007199254740995', contacto_id: '9007199254740993', tipo_medio: 'TELEFONO', valor: '+52 449 123 4567', estatus: 'ACTIVO', es_principal: false }] })
      .mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.create(input, 'request-1')).resolves.toMatchObject({ contact: { estatus: 'ACTIVO', es_contacto_principal: false }, methods: [{ estatus: 'ACTIVO', es_principal: false }, { estatus: 'ACTIVO', es_principal: false }] });
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-1']);
    expect(query.mock.calls[3]).toEqual([expect.stringContaining('WHERE empresa_id = $1 FOR UPDATE'), ['31']]);
    expect(query.mock.calls[4]?.[0]).toContain("'ACTIVO', FALSE");
    expect(query.mock.calls[5]?.[0]).toContain("'ACTIVO', FALSE, FALSE, NULL");
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back the contact when a later method insertion fails', async () => {
    const failure = new Error('method insertion failed');
    const query = vi.fn()
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ empresa_id: '31', estatus: 'ACTIVO' }] })
      .mockResolvedValueOnce({ rows: [{ contacto_id: '121', empresa_id: '31', tipo_contacto: 'PERSONA', nombre: 'María López', area: 'Compras', cargo: 'Compradora', observaciones: null, estatus: 'ACTIVO', es_contacto_principal: false }] })
      .mockResolvedValueOnce({ rows: [{ medio_id: '122', contacto_id: '121', tipo_medio: 'CORREO', valor: 'maria@example.test', estatus: 'ACTIVO', es_principal: false }] })
      .mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const { repository, client } = repositoryWithClient(query);
    await expect(repository.create(input, 'request-1')).rejects.toBe(failure);
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
