import { describe, expect, it, vi } from 'vitest';
import { RecentActivityService } from '../src/recent-activity/recent-activity.service';

const at = '2026-08-25T10:00:00.000Z';

function row(requestId: string, table: string, operation: string, after: Record<string, unknown> | null, before: Record<string, unknown> | null = null, occurredAt = at) {
  return { request_id: requestId, schema_name: 'core', table_name: table, operation, before_data: before, after_data: after, occurred_at: occurredAt };
}

function setup(rows: ReturnType<typeof row>[], contacts: Array<[string, { id: string; company_id: string; contact_type: string; name: string | null; area: string | null }]> = [], companies: Array<[string, string]> = []) {
  const findRecent = vi.fn().mockResolvedValue({ rows, contacts: new Map(contacts), companies: new Map(companies) });
  return { service: new RecentActivityService({ findRecent } as never), findRecent };
}

describe('RecentActivityService', () => {
  it.each([false, true])('collapses a provider create with fiscal=%s', async (withFiscal) => {
    const rows = [
      row('create', 'empresas', 'INSERT', { empresa_id: 1, nombre_comercial: 'Acme' }),
      row('create', 'empresa_roles', 'INSERT', { empresa_id: 1, rol: 'PROVEEDOR' }),
      ...(withFiscal ? [row('create', 'empresas_fiscales', 'INSERT', { empresa_id: 1, razon_social: 'Acme SA' })] : [])
    ];
    await expect(setup(rows).service.list({ limit: 6 })).resolves.toEqual({ data: [{ type: 'PROVIDER_CREATED', title: 'Proveedor creado', entity: 'Acme', context: null, occurredAt: at }] });
  });

  it('groups requests and collapses corresponding provider update rows', async () => {
    const rows = [
      row('update', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme Nuevo' }, { empresa_id: '1', nombre_comercial: 'Acme' }, '2026-08-25T10:00:01Z'),
      row('update', 'empresa_roles', 'UPDATE', { empresa_id: '1', rol: 'SERVICIO' }, { empresa_id: '1', rol: 'PROVEEDOR' }),
      row('update', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme Final', observaciones: 'Nueva' }, { empresa_id: '1', nombre_comercial: 'Acme Nuevo', observaciones: null }),
      row('update', 'empresas_fiscales', 'UPDATE', { empresa_id: '1', rfc: 'NEW' }, { empresa_id: '1', rfc: 'OLD' })
    ];
    const result = await setup(rows).service.list({ limit: 6 });
    expect(result.data).toEqual([{ type: 'PROVIDER_UPDATED', title: 'Proveedor actualizado', entity: 'Acme Final', context: null, occurredAt: '2026-08-25T10:00:01.000Z' }]);
  });

  it('classifies a fiscal-only provider edit through the current company label', async () => {
    const fiscal = row('fiscal-update', 'empresas_fiscales', 'UPDATE', { empresa_id: '1', razon_social: 'Acme Nueva', rfc: 'NEW' }, { empresa_id: '1', razon_social: 'Acme', rfc: 'OLD' });
    await expect(setup([fiscal], [], [['1', 'Acme Comercial']]).service.list({ limit: 6 })).resolves.toEqual({ data: [{ type: 'PROVIDER_UPDATED', title: 'Proveedor actualizado', entity: 'Acme Comercial', context: null, occurredAt: at }] });
  });

  it('does not relabel provider lifecycle changes as provider updates', async () => {
    const lifecycle = row('provider-lifecycle', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme', estatus: 'INACTIVO' }, { empresa_id: '1', nombre_comercial: 'Acme', estatus: 'ACTIVO' });
    await expect(setup([lifecycle], [], [['1', 'Acme']]).service.list({ limit: 6 })).resolves.toEqual({ data: [] });
  });

  it('collapses initial methods into contact creation and uses snapshot labels before current labels', async () => {
    const rows = [
      row('contact', 'contactos', 'INSERT', { contacto_id: 7, empresa_id: 1, tipo_contacto: 'PERSONA', nombre: 'Snapshot Ana' }),
      row('contact', 'medios_contacto', 'INSERT', { medio_id: 8, contacto_id: 7, valor: 'ana@test.mx' }),
      row('contact', 'medios_contacto', 'INSERT', { medio_id: 9, contacto_id: 7, valor: '4490000000' })
    ];
    const result = await setup(rows, [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Current Ana', area: null }]], [['1', 'Acme']]).service.list({ limit: 6 });
    expect(result.data).toEqual([{ type: 'CONTACT_CREATED', title: 'Contacto creado', entity: 'Snapshot Ana', context: 'Acme', occurredAt: at }]);
  });

  it('accepts only a standalone meaningful contact update and ignores updated_at', async () => {
    const update = row('contact-update', 'contactos', 'UPDATE', { contacto_id: 7, empresa_id: 1, tipo_contacto: 'BUZON_GENERICO', nombre: null, area: null, observaciones: 'Nueva', updated_at: 'later' }, { contacto_id: 7, empresa_id: 1, tipo_contacto: 'BUZON_GENERICO', nombre: null, area: null, observaciones: 'Anterior', updated_at: 'before' });
    const result = await setup([update], [], [['1', 'Acme']]).service.list({ limit: 6 });
    expect(result.data[0]).toMatchObject({ type: 'CONTACT_UPDATED', entity: 'Buzón general', context: 'Acme' });
  });

  it('keeps a labeled contact update when current context is unavailable', async () => {
    const update = row('contact-update', 'contactos', 'UPDATE', { nombre: 'Ana Nueva' }, { nombre: 'Ana' });
    await expect(setup([update]).service.list({ limit: 6 })).resolves.toEqual({ data: [{ type: 'CONTACT_UPDATED', title: 'Contacto actualizado', entity: 'Ana Nueva', context: null, occurredAt: at }] });
  });

  it('classifies a standalone method insert and value or type edits', async () => {
    const contacts: Parameters<typeof setup>[1] = [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Ana', area: null }]];
    const companies: Parameters<typeof setup>[2] = [['1', 'Acme']];
    const added = await setup([row('add', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'ana@test.mx', tipo_medio: 'CORREO' })], contacts, companies).service.list({ limit: 6 });
    const editedValue = await setup([row('edit-value', 'medios_contacto', 'UPDATE', { contacto_id: 7, valor: 'new@test.mx', tipo_medio: 'CORREO', estatus: 'ACTIVO' }, { contacto_id: 7, valor: 'old@test.mx', tipo_medio: 'CORREO', estatus: 'ACTIVO' })], contacts).service.list({ limit: 6 });
    const editedType = await setup([row('edit-type', 'medios_contacto', 'UPDATE', { contacto_id: 7, valor: '4490', tipo_medio: 'WHATSAPP', estatus: 'ACTIVO' }, { contacto_id: 7, valor: '4490', tipo_medio: 'TELEFONO', estatus: 'ACTIVO' })], contacts).service.list({ limit: 6 });
    expect(added.data[0]).toMatchObject({ type: 'CONTACT_METHOD_ADDED', entity: 'ana@test.mx', context: 'Acme' });
    expect(editedValue.data[0]).toMatchObject({ type: 'CONTACT_METHOD_UPDATED', entity: 'new@test.mx' });
    expect(editedType.data[0]).toMatchObject({ type: 'CONTACT_METHOD_UPDATED', entity: '4490' });
  });

  it.each([
    ['ACTIVO', 'INACTIVO', 'CONTACT_METHOD_DEACTIVATED'],
    ['INACTIVO', 'ACTIVO', 'CONTACT_METHOD_REACTIVATED']
  ])('classifies lifecycle transition %s to %s with precedence', async (beforeStatus, afterStatus, expected) => {
    const change = row('lifecycle', 'medios_contacto', 'UPDATE', { contacto_id: 7, valor: 'new@test.mx', estatus: afterStatus }, { contacto_id: 7, valor: 'old@test.mx', estatus: beforeStatus });
    const result = await setup([change], [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Ana', area: null }]]).service.list({ limit: 6 });
    expect(result.data[0]?.type).toBe(expected);
  });

  it.each([
    { rows: [row('delete', 'contactos', 'DELETE', null, { contacto_id: 7, nombre: 'Ana' })] },
    { rows: [row('unknown', 'alias_empresa', 'INSERT', { empresa_id: 1, alias: 'X' })] },
    { rows: [row('status', 'contactos', 'UPDATE', { contacto_id: 7, nombre: 'Ana', estatus: 'INACTIVO' }, { contacto_id: 7, nombre: 'Ana', estatus: 'ACTIVO' })] },
    { rows: [row('unsupported-transition', 'medios_contacto', 'UPDATE', { contacto_id: 7, valor: 'x', estatus: 'BLOQUEADO' }, { contacto_id: 7, valor: 'x', estatus: 'ACTIVO' })] },
    { rows: [row('missing-label', 'medios_contacto', 'INSERT', { contacto_id: 7 })] }
  ])('omits unsupported or incomplete activity %#', async ({ rows }) => {
    await expect(setup(rows).service.list({ limit: 6 })).resolves.toEqual({ data: [] });
  });

  it('skips unsupported groups, enforces the requested output limit, and leaks no audit internals', async () => {
    const rows = [
      row('unknown', 'unknown_table', 'INSERT', { id: 1 }),
      row('one', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'one@test.mx' }),
      row('two', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'two@test.mx' })
    ];
    const { service, findRecent } = setup(rows, [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Ana', area: null }]]);
    const result = await service.list({ limit: 1 });
    expect(findRecent).toHaveBeenCalledWith(1);
    expect(result.data).toHaveLength(1);
    expect(Object.keys(result.data[0]!)).toEqual(['type', 'title', 'entity', 'context', 'occurredAt']);
    expect(result.data[0]?.occurredAt).toBe(at);
    expect(JSON.stringify(result)).not.toMatch(/request_id|schema_name|before_data|after_data|operation/);
  });
});
