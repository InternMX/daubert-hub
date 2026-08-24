import { describe, expect, it, vi } from 'vitest';
import { ContactsRepository, type ContactRow } from '../src/contacts/contacts.repository';
import { ContactType } from '../src/contacts/dto/create-contact.dto';
import type { UpdateContactDto } from '../src/contacts/dto/update-contact.dto';

type LockedContact = ContactRow & { company_status: string };
const base: LockedContact = { contacto_id: '9007199254740993', empresa_id: '31', tipo_contacto: ContactType.Person, nombre: 'María Lopez', area: 'Compras', cargo: 'Compradora', observaciones: 'Inicial', estatus: 'ACTIVO', es_contacto_principal: true, company_status: 'ACTIVO' };

function setup(row: LockedContact | null, updated: ContactRow = base) {
  const query = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ rows: row ? [row] : [] });
  if (row) query.mockResolvedValueOnce({ rows: [updated] });
  query.mockResolvedValueOnce(undefined);
  const client = { query, release: vi.fn() };
  return { repository: new ContactsRepository({ connect: vi.fn().mockResolvedValue(client) } as never), query, client };
}

async function successful(input: UpdateContactDto, row: LockedContact = base) {
  const updated = { ...row, nombre: input.name === undefined ? row.nombre : input.name, area: input.area === undefined ? row.area : input.area, cargo: input.position === undefined ? row.cargo : input.position, observaciones: input.notes === undefined ? row.observaciones : input.notes };
  const context = setup(row, updated);
  const result = await context.repository.update('9007199254740993', input, 'request-edit');
  return { ...context, result, updateCall: context.query.mock.calls[4]! };
}

describe('ContactsRepository update', () => {
  it.each([
    ['name', { name: 'María López' }, 'nombre'],
    ['area', { area: 'Compras y Abastecimiento' }, 'area'],
    ['clear area', { area: null }, 'area'],
    ['position', { position: 'Compradora Sr.' }, 'cargo'],
    ['clear position', { position: null }, 'cargo'],
    ['notes', { notes: 'Actualizada' }, 'observaciones'],
    ['clear notes', { notes: null }, 'observaciones']
  ])('updates PERSONA %s', async (_scenario, input, column) => {
    const { result, updateCall } = await successful(input);
    expect(updateCall[0]).toContain(`${column} = $1`);
    expect(result).toMatchObject({ contacto_id: '9007199254740993', empresa_id: '31', tipo_contacto: 'PERSONA', estatus: 'ACTIVO', es_contacto_principal: true });
  });

  it('preserves omitted fields in a partial PERSONA patch', async () => {
    const { updateCall } = await successful({ position: 'Compradora Sr.' });
    expect(updateCall[0]).toContain('SET cargo = $1');
    expect(updateCall[0]).not.toContain('nombre ='); expect(updateCall[0]).not.toContain('area ='); expect(updateCall[0]).not.toContain('observaciones =');
    expect(updateCall[1]).toEqual(['Compradora Sr.', '9007199254740993']);
  });

  it.each([null, ''])('rejects a cleared PERSONA name (%s)', async (name) => {
    const { repository } = setup(base);
    await expect(repository.update(base.contacto_id, { name }, 'request-edit')).rejects.toMatchObject({ code: 'PERSON_NAME_REQUIRED' });
  });

  it.each([ContactType.Area, ContactType.GenericMailbox])('updates required area and notes for %s without person fields', async (contactType) => {
    const row = { ...base, tipo_contacto: contactType, nombre: null, area: 'Compras', cargo: null };
    const { result, updateCall } = await successful({ area: 'Compras y Abastecimiento', notes: null }, row);
    expect(updateCall[0]).toContain('area = $1'); expect(updateCall[0]).toContain('observaciones = $2');
    expect(updateCall[0]).not.toContain('nombre ='); expect(updateCall[0]).not.toContain('cargo =');
    expect(result).toMatchObject({ tipo_contacto: contactType, nombre: null, cargo: null });
  });

  it.each([ContactType.Area, ContactType.GenericMailbox])('allows changing and clearing notes for %s', async (contactType) => {
    const row = { ...base, tipo_contacto: contactType, nombre: null, cargo: null };
    expect((await successful({ notes: 'Nueva nota' }, row)).updateCall[1]).toEqual(['Nueva nota', base.contacto_id]);
    expect((await successful({ notes: null }, row)).updateCall[1]).toEqual([null, base.contacto_id]);
  });

  it.each([ContactType.Area, ContactType.GenericMailbox])('protects required fields and person-only data for %s', async (contactType) => {
    const row = { ...base, tipo_contacto: contactType, nombre: null, cargo: null };
    for (const [input, code] of [[{ area: null }, 'CONTACT_AREA_REQUIRED'], [{ area: '' }, 'CONTACT_AREA_REQUIRED'], [{ name: 'María' }, 'CONTACT_NAME_NOT_ALLOWED'], [{ position: 'Compradora' }, 'CONTACT_POSITION_NOT_ALLOWED']] as const) {
      await expect(setup(row).repository.update(base.contacto_id, input, 'request-edit')).rejects.toMatchObject({ code });
    }
  });

  it.each([
    ['PENDIENTE contact', { ...base, estatus: 'PENDIENTE' }],
    ['INACTIVO contact', { ...base, estatus: 'INACTIVO' }],
    ['RECHAZADO contact', { ...base, estatus: 'RECHAZADO' }],
    ['inactive company', { ...base, company_status: 'INACTIVO' }],
    ['blocked company', { ...base, company_status: 'BLOQUEADO' }]
  ])('rejects %s before update', async (_scenario, row) => {
    const context = setup(row);
    await expect(context.repository.update(base.contacto_id, { notes: 'x' }, 'request-edit')).rejects.toMatchObject({ code: row.company_status === 'ACTIVO' ? 'CONTACT_NOT_ACTIVE' : 'COMPANY_NOT_ACTIVE' });
    expect(context.query.mock.calls.some((call) => String(call[0]).includes('UPDATE core.contactos'))).toBe(false);
  });

  it('returns null for a nonexistent contact', async () => {
    const { repository } = setup(null);
    await expect(repository.update('999999999999999', { notes: 'x' }, 'request-edit')).resolves.toBeNull();
  });

  it('sets audit context and updates only descriptive contact columns', async () => {
    const { query, client, updateCall } = await successful({ name: 'María López', area: null, position: null, notes: 'Editada' });
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    expect(query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.request_id', $1, true)", ['request-edit']);
    expect(updateCall[0]).toMatch(/UPDATE core\.contactos SET nombre = \$1, area = \$2, cargo = \$3, observaciones = \$4/);
    expect(updateCall[0]).not.toMatch(/empresa_id\s*=|tipo_contacto\s*=|estatus\s*=|es_contacto_principal\s*=/);
    expect(query.mock.calls.flat().join(' ')).not.toMatch(/medios_contacto|recibe_notificacion_pago|tipo_destinatario_pago/);
    expect(query).toHaveBeenLastCalledWith('COMMIT'); expect(client.release).toHaveBeenCalledOnce();
  });
});
