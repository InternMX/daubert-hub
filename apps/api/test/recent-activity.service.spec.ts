import { describe, expect, it, vi } from 'vitest';
import { RecentActivityCategoryFilter } from '../src/recent-activity/dto/list-recent-activity.dto';
import { RecentActivityService } from '../src/recent-activity/recent-activity.service';

const at = '2026-08-25T10:00:00.000Z';

function row(requestId: string, table: string, operation: string, after: Record<string, unknown> | null, before: Record<string, unknown> | null = null, occurredAt = at) {
  return { request_id: requestId, schema_name: 'core', table_name: table, operation, before_data: before, after_data: after, occurred_at: occurredAt };
}

function payment(overrides: Partial<{ execution_state: 'PROCESADO' | 'ERROR'; occurred_at: string; result_count: number; ready_count: number; manual_count: number; error_count: number; omitted_count: number }> = {}) {
  return { execution_state: 'PROCESADO' as const, occurred_at: at, result_count: 1, ready_count: 1, manual_count: 0, error_count: 0, omitted_count: 0, ...overrides };
}

function audi(overrides: Partial<{ execution_id: string; automation_name: string; execution_state: 'COMPLETADA' | 'ERROR' | 'CANCELADA' | 'PROCESANDO'; run_name: string | null; occurred_at: string; error_node: string | null; error_message: string | null; generated_count: number; minimum_folio: string | null; maximum_folio: string | null }> = {}) {
  return { execution_id: '1', automation_name: 'Remisiones Audi', execution_state: 'COMPLETADA' as const, run_name: null, occurred_at: at, error_node: null, error_message: null, generated_count: 1, minimum_folio: '969', maximum_folio: '969', ...overrides };
}

function setup(rows: ReturnType<typeof row>[], contacts: Array<[string, { id: string; company_id: string; contact_type: string; name: string | null; area: string | null }]> = [], companies: Array<[string, string]> = [], payments: ReturnType<typeof payment>[] = [], audiRows: ReturnType<typeof audi>[] = [], companyRoles: Array<[string, string[]]> = []) {
  const findRecent = vi.fn().mockResolvedValue({ rows, contacts: new Map(contacts), companies: new Map(companies), companyRoles: new Map(companyRoles.map(([companyId, roles]) => [companyId, new Set(roles)])) });
  const findPaymentNotifications = vi.fn().mockResolvedValue(payments);
  const findAudi = vi.fn().mockResolvedValue(audiRows);
  return { service: new RecentActivityService({ findRecent } as never, { findRecent: findPaymentNotifications } as never, { findRecent: findAudi } as never), findRecent, findPaymentNotifications, findAudi };
}

describe('RecentActivityService', () => {
  it.each([false, true])('collapses a provider create with fiscal=%s', async (withFiscal) => {
    const rows = [
      row('create', 'empresas', 'INSERT', { empresa_id: 1, nombre_comercial: 'Acme' }),
      row('create', 'empresa_roles', 'INSERT', { empresa_id: 1, rol: 'PROVEEDOR' }),
      ...(withFiscal ? [row('create', 'empresas_fiscales', 'INSERT', { empresa_id: 1, razon_social: 'Acme SA' })] : [])
    ];
    await expect(setup(rows).service.list({ limit: 6 })).resolves.toEqual({ data: [{ type: 'PROVIDER_CREATED', category: 'PROVIDER', title: 'Proveedor creado', entity: 'Acme', context: null, occurredAt: at }] });
  });

  it('groups requests and collapses corresponding provider update rows', async () => {
    const rows = [
      row('update', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme Nuevo' }, { empresa_id: '1', nombre_comercial: 'Acme' }, '2026-08-25T10:00:01Z'),
      row('update', 'empresa_roles', 'UPDATE', { empresa_id: '1', rol: 'SERVICIO' }, { empresa_id: '1', rol: 'PROVEEDOR' }),
      row('update', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme Final', observaciones: 'Nueva' }, { empresa_id: '1', nombre_comercial: 'Acme Nuevo', observaciones: null }),
      row('update', 'empresas_fiscales', 'UPDATE', { empresa_id: '1', rfc: 'NEW' }, { empresa_id: '1', rfc: 'OLD' })
    ];
    const result = await setup(rows).service.list({ limit: 6 });
    expect(result.data).toEqual([{ type: 'PROVIDER_UPDATED', category: 'PROVIDER', title: 'Proveedor actualizado', entity: 'Acme Final', context: null, occurredAt: '2026-08-25T10:00:01.000Z' }]);
  });

  it('classifies a fiscal-only provider edit through the current company label', async () => {
    const fiscal = row('fiscal-update', 'empresas_fiscales', 'UPDATE', { empresa_id: '1', razon_social: 'Acme Nueva', rfc: 'NEW' }, { empresa_id: '1', razon_social: 'Acme', rfc: 'OLD' });
    await expect(setup([fiscal], [], [['1', 'Acme Comercial']]).service.list({ limit: 6 })).resolves.toEqual({ data: [{ type: 'PROVIDER_UPDATED', category: 'PROVIDER', title: 'Proveedor actualizado', entity: 'Acme Comercial', context: null, occurredAt: at }] });
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
    expect(result.data).toEqual([{ type: 'CONTACT_CREATED', category: 'CONTACT', title: 'Contacto creado', entity: 'Snapshot Ana', context: 'Acme', occurredAt: at }]);
  });

  it('accepts only a standalone meaningful contact update and ignores updated_at', async () => {
    const update = row('contact-update', 'contactos', 'UPDATE', { contacto_id: 7, empresa_id: 1, tipo_contacto: 'BUZON_GENERICO', nombre: null, area: null, observaciones: 'Nueva', updated_at: 'later' }, { contacto_id: 7, empresa_id: 1, tipo_contacto: 'BUZON_GENERICO', nombre: null, area: null, observaciones: 'Anterior', updated_at: 'before' });
    const result = await setup([update], [], [['1', 'Acme']]).service.list({ limit: 6 });
    expect(result.data[0]).toMatchObject({ type: 'CONTACT_UPDATED', entity: 'Buzón general', context: 'Acme' });
  });

  it('keeps a labeled contact update when current context is unavailable', async () => {
    const update = row('contact-update', 'contactos', 'UPDATE', { nombre: 'Ana Nueva' }, { nombre: 'Ana' });
    await expect(setup([update]).service.list({ limit: 6 })).resolves.toEqual({ data: [{ type: 'CONTACT_UPDATED', category: 'CONTACT', title: 'Contacto actualizado', entity: 'Ana Nueva', context: null, occurredAt: at }] });
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
    const change = row('lifecycle', 'medios_contacto', 'UPDATE', { contacto_id: 7, valor: 'https://portal.example.test', tipo_medio: 'WEB', estatus: afterStatus }, { contacto_id: 7, valor: 'https://portal.example.test', tipo_medio: 'WEB', estatus: beforeStatus });
    const result = await setup([change], [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Ana', area: null }]]).service.list({ limit: 6 });
    expect(result.data[0]?.type).toBe(expected);
  });

  it('classifies WEB additions and edits through generic contact-method activity', async () => {
    const contacts: Parameters<typeof setup>[1] = [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Ana', area: null }]];
    const added = await setup([row('web-add', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'https://portal.example.test', tipo_medio: 'WEB' })], contacts).service.list({ limit: 6 });
    const edited = await setup([row('web-edit', 'medios_contacto', 'UPDATE', { contacto_id: 7, valor: 'https://portal.example.test/new', tipo_medio: 'WEB', estatus: 'ACTIVO' }, { contacto_id: 7, valor: 'https://portal.example.test', tipo_medio: 'WEB', estatus: 'ACTIVO' })], contacts).service.list({ limit: 6 });
    expect(added.data[0]).toMatchObject({ type: 'CONTACT_METHOD_ADDED', entity: 'https://portal.example.test' });
    expect(edited.data[0]).toMatchObject({ type: 'CONTACT_METHOD_UPDATED', entity: 'https://portal.example.test/new' });
  });

  it.each([
    { rows: [row('delete', 'contactos', 'DELETE', null, { contacto_id: 7, nombre: 'Ana' })] },
    { rows: [row('status', 'contactos', 'UPDATE', { contacto_id: 7, nombre: 'Ana', estatus: 'INACTIVO' }, { contacto_id: 7, nombre: 'Ana', estatus: 'ACTIVO' })] },
    { rows: [row('unsupported-transition', 'medios_contacto', 'UPDATE', { contacto_id: 7, valor: 'x', estatus: 'BLOQUEADO' }, { contacto_id: 7, valor: 'x', estatus: 'ACTIVO' })] },
    { rows: [row('missing-label', 'medios_contacto', 'INSERT', { contacto_id: 7 })] }
  ])('omits unsupported or incomplete activity %#', async ({ rows }) => {
    await expect(setup(rows).service.list({ limit: 6 })).resolves.toEqual({ data: [] });
  });

  it('classifies an alias-only company edit as a provider update', async () => {
    const alias = row('alias', 'alias_empresa', 'INSERT', { empresa_id: 1, alias: 'BMASC' });
    const result = await setup([alias], [], [['1', 'Acme']]).service.list({ limit: 6 });
    expect(result.data[0]).toMatchObject({ type: 'PROVIDER_UPDATED', entity: 'Acme' });
  });

  it('skips unsupported groups, enforces the requested output limit, and leaks no audit internals', async () => {
    const rows = [
      row('unknown', 'unknown_table', 'INSERT', { id: 1 }),
      row('one', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'one@test.mx' }),
      row('two', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'two@test.mx' })
    ];
    const { service, findRecent, findPaymentNotifications, findAudi } = setup(rows, [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Ana', area: null }]]);
    const result = await service.list({ limit: 1 });
    expect(findRecent).toHaveBeenCalledWith(1);
    expect(findPaymentNotifications).toHaveBeenCalledWith(1);
    expect(findAudi).toHaveBeenCalledWith(1);
    expect(result.data).toHaveLength(1);
    expect(Object.keys(result.data[0]!)).toEqual(['type', 'category', 'title', 'entity', 'context', 'occurredAt']);
    expect(result.data[0]?.occurredAt).toBe(at);
    expect(JSON.stringify(result)).not.toMatch(/request_id|schema_name|before_data|after_data|operation/);
  });

  it('filters provider activity before the final limit and skips the payment source', async () => {
    const rows = [
      row('new-contact', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'new@test.mx' }, null, '2026-08-25T12:00:00Z'),
      row('new-provider', 'empresas', 'UPDATE', { empresa_id: 1, nombre_comercial: 'Nuevo' }, { empresa_id: 1, nombre_comercial: 'Anterior' }, '2026-08-25T11:00:00Z'),
      row('old-provider', 'empresas', 'UPDATE', { empresa_id: 2, nombre_comercial: 'Antiguo' }, { empresa_id: 2, nombre_comercial: 'Original' }, '2026-08-25T09:00:00Z')
    ];
    const { service, findRecent, findPaymentNotifications, findAudi } = setup(rows, [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Ana', area: null }]], [['1', 'Nuevo'], ['2', 'Antiguo']], [payment({ occurred_at: '2026-08-25T13:00:00Z' })], [audi()]);

    const result = await service.list({ limit: 2, category: RecentActivityCategoryFilter.PROVIDER });

    expect(result.data.map((item) => item.entity)).toEqual(['Nuevo', 'Antiguo']);
    expect(result.data.every((item) => item.category === 'PROVIDER')).toBe(true);
    expect(findRecent).toHaveBeenCalledWith(2, 'PROVIDER');
    expect(findPaymentNotifications).not.toHaveBeenCalled();
    expect(findAudi).not.toHaveBeenCalled();
  });

  it('returns only contact activity and skips the payment source', async () => {
    const rows = [
      row('provider', 'empresas', 'UPDATE', { empresa_id: 1, nombre_comercial: 'Nuevo' }, { empresa_id: 1, nombre_comercial: 'Anterior' }),
      row('contact', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'contact@test.mx' })
    ];
    const { service, findRecent, findPaymentNotifications, findAudi } = setup(rows, [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Ana', area: null }]], [['1', 'Nuevo']], [payment()], [audi()]);

    const result = await service.list({ limit: 6, category: RecentActivityCategoryFilter.CONTACT });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.category).toBe('CONTACT');
    expect(findRecent).toHaveBeenCalledWith(6, 'CONTACT');
    expect(findPaymentNotifications).not.toHaveBeenCalled();
    expect(findAudi).not.toHaveBeenCalled();
  });

  it('returns only automation activity and skips the audit source', async () => {
    const { service, findRecent, findPaymentNotifications, findAudi } = setup([row('contact', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'contact@test.mx' })], [], [], [
      payment({ occurred_at: '2026-08-25T11:00:00Z' }),
      payment({ execution_state: 'ERROR', result_count: 0, ready_count: 0, occurred_at: '2026-08-25T12:00:00Z' })
    ], [audi({ occurred_at: '2026-08-25T10:00:00Z' })]);

    const result = await service.list({ limit: 1, category: RecentActivityCategoryFilter.AUTOMATION });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ category: 'AUTOMATION', type: 'AUTOMATION_FAILED' });
    expect(findRecent).not.toHaveBeenCalled();
    expect(findPaymentNotifications).toHaveBeenCalledWith(1);
    expect(findAudi).toHaveBeenCalledWith(1);
  });

  it('returns only client activity, scoped to CLIENT tables, and skips non-audit sources', async () => {
    const rows = [
      row('client-create', 'empresa_roles', 'INSERT', { empresa_id: 1, rol: 'CLIENTE' }),
      row('provider-update', 'empresas', 'UPDATE', { empresa_id: 2, nombre_comercial: 'Nuevo' }, { empresa_id: 2, nombre_comercial: 'Antiguo' })
    ];
    const { service, findRecent, findPaymentNotifications, findAudi } = setup(rows, [], [['1', 'Acme'], ['2', 'Otra']], [payment()], [audi()], [['2', ['PROVEEDOR']]]);

    const result = await service.list({ limit: 6, category: RecentActivityCategoryFilter.CLIENT });

    expect(result.data).toEqual([{ type: 'CLIENT_CREATED', category: 'CLIENT', title: 'Cliente creado', entity: 'Acme', context: null, occurredAt: at }]);
    expect(findRecent).toHaveBeenCalledWith(6, 'CLIENT');
    expect(findPaymentNotifications).not.toHaveBeenCalled();
    expect(findAudi).not.toHaveBeenCalled();
  });

  describe('client activity', () => {
    it('collapses a brand-new company acquiring the CLIENTE role, with fiscal', async () => {
      const rows = [
        row('create', 'empresas', 'INSERT', { empresa_id: 1, nombre_comercial: 'Acme' }),
        row('create', 'empresa_roles', 'INSERT', { empresa_id: 1, rol: 'CLIENTE' }),
        row('create', 'empresas_fiscales', 'INSERT', { empresa_id: 1, razon_social: 'Acme SA' })
      ];
      const result = await setup(rows).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'CLIENT_CREATED', category: 'CLIENT', title: 'Cliente creado', entity: 'Acme', context: null, occurredAt: at }]);
    });

    it('classifies an existing PROVEEDOR company gaining its first CLIENTE role as CLIENT_CREATED, not CLIENT_UPDATED', async () => {
      const rows = [row('gain-client', 'empresa_roles', 'INSERT', { empresa_id: 1, rol: 'CLIENTE' })];
      const result = await setup(rows, [], [['1', 'Acme']], [], [], [['1', ['PROVEEDOR', 'CLIENTE']]]).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'CLIENT_CREATED', category: 'CLIENT', title: 'Cliente creado', entity: 'Acme', context: null, occurredAt: at }]);
    });

    it('classifies an existing inactive CLIENTE role turning active as CLIENT_REACTIVATED, never CLIENT_CREATED', async () => {
      const rows = [row('reactivate', 'empresa_roles', 'UPDATE', { empresa_id: 1, rol: 'CLIENTE', estatus: 'ACTIVO' }, { empresa_id: 1, rol: 'CLIENTE', estatus: 'INACTIVO' })];
      const result = await setup(rows, [], [['1', 'Acme']]).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'CLIENT_REACTIVATED', category: 'CLIENT', title: 'Cliente reactivado', entity: 'Acme', context: null, occurredAt: at }]);
    });

    it('classifies an active CLIENTE role turning inactive as CLIENT_DEACTIVATED', async () => {
      const rows = [row('deactivate', 'empresa_roles', 'UPDATE', { empresa_id: 1, rol: 'CLIENTE', estatus: 'INACTIVO' }, { empresa_id: 1, rol: 'CLIENTE', estatus: 'ACTIVO' })];
      const result = await setup(rows, [], [['1', 'Acme']]).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'CLIENT_DEACTIVATED', category: 'CLIENT', title: 'Cliente desactivado', entity: 'Acme', context: null, occurredAt: at }]);
    });

    it('collapses a final-role deactivate (role + company status) into exactly one CLIENT_DEACTIVATED', async () => {
      const rows = [
        row('deactivate', 'empresa_roles', 'UPDATE', { empresa_id: 1, rol: 'CLIENTE', estatus: 'INACTIVO' }, { empresa_id: 1, rol: 'CLIENTE', estatus: 'ACTIVO' }),
        row('deactivate', 'empresas', 'UPDATE', { empresa_id: 1, estatus: 'INACTIVO' }, { empresa_id: 1, estatus: 'ACTIVO' })
      ];
      const result = await setup(rows, [], [['1', 'Acme']]).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'CLIENT_DEACTIVATED', category: 'CLIENT', title: 'Cliente desactivado', entity: 'Acme', context: null, occurredAt: at }]);
    });

    it('collapses a multi-role deactivate (company stays active) into exactly one CLIENT_DEACTIVATED', async () => {
      const rows = [row('deactivate', 'empresa_roles', 'UPDATE', { empresa_id: 1, rol: 'CLIENTE', estatus: 'INACTIVO' }, { empresa_id: 1, rol: 'CLIENTE', estatus: 'ACTIVO' })];
      const result = await setup(rows, [], [['1', 'Acme']], [], [], [['1', ['PROVEEDOR']]]).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'CLIENT_DEACTIVATED', category: 'CLIENT', title: 'Cliente desactivado', entity: 'Acme', context: null, occurredAt: at }]);
    });

    it('collapses a company-data PATCH into one CLIENT_UPDATED for a CLIENTE-only company', async () => {
      const rows = [row('update', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme Final', observaciones: 'Nueva' }, { empresa_id: '1', nombre_comercial: 'Acme', observaciones: null })];
      const result = await setup(rows, [], [['1', 'Acme']], [], [], [['1', ['CLIENTE']]]).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'CLIENT_UPDATED', category: 'CLIENT', title: 'Cliente actualizado', entity: 'Acme Final', context: null, occurredAt: at }]);
    });

    it('collapses a fiscal PATCH producing multiple audit rows (NEW_IDENTITY) into one CLIENT_UPDATED', async () => {
      const rows = [
        row('fiscal-update', 'empresas_fiscales', 'UPDATE', { empresa_id: '1', razon_social: 'Acme', rfc: 'OLD', es_vigente: false, fecha_fin: '2026-01-01' }, { empresa_id: '1', razon_social: 'Acme', rfc: 'OLD', es_vigente: true, fecha_fin: null }),
        row('fiscal-update', 'empresas_fiscales', 'INSERT', { empresa_id: '1', razon_social: 'Acme', rfc: 'NEW', es_vigente: true })
      ];
      const result = await setup(rows, [], [['1', 'Acme']], [], [], [['1', ['CLIENTE']]]).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'CLIENT_UPDATED', category: 'CLIENT', title: 'Cliente actualizado', entity: 'Acme', context: null, occurredAt: at }]);
    });

    it('does not classify a company-data PATCH as Client activity when role membership is unknown', async () => {
      const rows = [row('update', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme Final' }, { empresa_id: '1', nombre_comercial: 'Acme' })];
      const result = await setup(rows, [], [['1', 'Acme']]).service.list({ limit: 6 });
      expect(result.data.some((item) => item.category === 'CLIENT')).toBe(false);
    });

    it('shows neither CLIENT_UPDATED nor PROVIDER_UPDATED for a genuinely multi-role company update (documented ambiguity)', async () => {
      const rows = [row('update', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme Final' }, { empresa_id: '1', nombre_comercial: 'Acme' })];
      const result = await setup(rows, [], [['1', 'Acme']], [], [], [['1', ['CLIENTE', 'PROVEEDOR']]]).service.list({ limit: 6 });
      expect(result.data).toEqual([]);
    });

    it('does not generate Client activity for an address mutation', async () => {
      const rows = [row('address', 'direcciones', 'INSERT', { empresa_id: 1, calle: 'Calle 1' })];
      const result = await setup(rows, [], [['1', 'Acme']], [], [], [['1', ['CLIENTE']]]).service.list({ limit: 6 });
      expect(result.data).toEqual([]);
    });

    it('does not generate Client activity for an alias mutation', async () => {
      const rows = [row('alias', 'alias_empresa', 'INSERT', { empresa_id: 1, alias: 'BMASC' })];
      const result = await setup(rows, [], [['1', 'Acme']], [], [], [['1', ['CLIENTE']]]).service.list({ limit: 6 });
      expect(result.data.some((item) => item.category === 'CLIENT')).toBe(false);
    });

    it('leaves Provider activity for genuine provider-only companies unchanged', async () => {
      const rows = [row('update', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme Final' }, { empresa_id: '1', nombre_comercial: 'Acme' })];
      const result = await setup(rows, [], [['1', 'Acme']], [], [], [['1', ['PROVEEDOR']]]).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'PROVIDER_UPDATED', category: 'PROVIDER', title: 'Proveedor actualizado', entity: 'Acme Final', context: null, occurredAt: at }]);
    });

    it('leaves legacy Provider classification unchanged when role membership is unknown (no companyRoles data)', async () => {
      const rows = [row('update', 'empresas', 'UPDATE', { empresa_id: '1', nombre_comercial: 'Acme Final' }, { empresa_id: '1', nombre_comercial: 'Acme' })];
      const result = await setup(rows, [], [['1', 'Acme']]).service.list({ limit: 6 });
      expect(result.data).toEqual([{ type: 'PROVIDER_UPDATED', category: 'PROVIDER', title: 'Proveedor actualizado', entity: 'Acme Final', context: null, occurredAt: at }]);
    });
  });

  it.each([
    [payment({ result_count: 5, ready_count: 4, manual_count: 1 }), 'AUTOMATION_PARTIAL', '4 listos · 1 manual'],
    [payment({ result_count: 2, ready_count: 2 }), 'AUTOMATION_COMPLETED', '2 listos'],
    [payment({ result_count: 3, ready_count: 2, omitted_count: 1 }), 'AUTOMATION_COMPLETED', '2 listos · 1 omitido'],
    [payment({ result_count: 1, ready_count: 0, omitted_count: 1 }), 'AUTOMATION_COMPLETED', '1 omitido'],
    [payment({ result_count: 13, ready_count: 12, error_count: 1 }), 'AUTOMATION_PARTIAL', '12 listos · 1 con error'],
    [payment({ execution_state: 'ERROR', result_count: 2, ready_count: 1, error_count: 1 }), 'AUTOMATION_PARTIAL', '1 listo · 1 con error'],
    [payment({ execution_state: 'ERROR', result_count: 1, ready_count: 0, error_count: 1 }), 'AUTOMATION_FAILED', '1 con error'],
    [payment({ execution_state: 'ERROR', result_count: 0, ready_count: 0 }), 'AUTOMATION_FAILED', 'No fue posible completar la automatización']
  ])('maps payment execution %# to its business event', async (source, type, context) => {
    const result = await setup([], [], [], [source]).service.list({ limit: 6 });
    expect(result.data).toEqual([{
      type,
      category: 'AUTOMATION',
      title: type === 'AUTOMATION_COMPLETED' ? 'Automatización completada' : type === 'AUTOMATION_PARTIAL' ? 'Automatización con incidencias' : 'Automatización con error',
      entity: 'Notificaciones de pago',
      context,
      occurredAt: at
    }]);
  });

  it('omits a processed execution without result rows and all zero-count context pieces', async () => {
    const result = await setup([], [], [], [
      payment({ result_count: 0, ready_count: 0 }),
      payment({ result_count: 2, ready_count: 1, manual_count: 1 })
    ]).service.list({ limit: 6 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.context).toBe('1 listo · 1 manual');
  });

  it('omits pending executions and formats every plural count without zero pieces', async () => {
    const result = await setup([], [], [], [
      payment({ execution_state: 'PENDIENTE' as never }),
      payment({ result_count: 8, ready_count: 2, manual_count: 2, error_count: 2, omitted_count: 2 })
    ]).service.list({ limit: 6 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.context).toBe('2 listos · 2 manuales · 2 con error · 2 omitidos');
  });

  it('maps one generated Audi remission without exposing execution metadata', async () => {
    const result = await setup([], [], [], [], [audi({ run_name: 'internal-run', error_node: 'Node 1', error_message: 'raw failure' })]).service.list({ limit: 6 });

    expect(result.data).toEqual([{
      type: 'AUTOMATION_COMPLETED', category: 'AUTOMATION', title: 'Remisión 969 generada',
      entity: 'Remisiones Audi', context: null, occurredAt: at
    }]);
    expect(JSON.stringify(result)).not.toMatch(/internal-run|Node 1|raw failure|execution_id/i);
  });

  it.each([
    [970, 974, 'Folios 970–974'],
    [970, 980, null]
  ] as const)('maps multiple Audi remissions and includes only a contiguous range %#', async (minimum, maximum, context) => {
    const result = await setup([], [], [], [], [audi({ generated_count: 5, minimum_folio: String(minimum), maximum_folio: String(maximum) })]).service.list({ limit: 6 });

    expect(result.data[0]).toMatchObject({ type: 'AUTOMATION_COMPLETED', title: '5 remisiones generadas', entity: 'Remisiones Audi', context });
  });

  it('maps a completed Audi execution without generated remissions', async () => {
    const result = await setup([], [], [], [], [audi({ generated_count: 0, minimum_folio: null, maximum_folio: null })]).service.list({ limit: 6 });

    expect(result.data[0]).toMatchObject({ type: 'AUTOMATION_COMPLETED', title: 'Ejecución completada sin remisiones generadas', context: null });
  });

  it.each([
    ['ERROR', 'AUTOMATION_FAILED', 'Generación de remisiones con error', 'No fue posible completar la automatización'],
    ['CANCELADA', 'AUTOMATION_CANCELLED', 'Generación de remisiones cancelada', null]
  ] as const)('maps Audi state %s to its terminal activity', async (executionState, type, title, context) => {
    const result = await setup([], [], [], [], [audi({ execution_state: executionState, generated_count: 0, minimum_folio: null, maximum_folio: null })]).service.list({ limit: 6 });

    expect(result.data[0]).toMatchObject({ type, category: 'AUTOMATION', title, entity: 'Remisiones Audi', context });
  });

  it('does not represent a processing Audi execution', async () => {
    const result = await setup([], [], [], [], [audi({ execution_state: 'PROCESANDO' })]).service.list({ limit: 6 });
    expect(result.data).toEqual([]);
  });

  it('merges audit, payment, and Audi events, globally sorts them, then applies the final limit', async () => {
    const result = await setup([
      row('older-audit', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'old@test.mx' }, null, '2026-08-25T08:00:00Z'),
      row('newer-audit', 'medios_contacto', 'INSERT', { contacto_id: 7, valor: 'new@test.mx' }, null, '2026-08-25T12:00:00Z')
    ], [['7', { id: '7', company_id: '1', contact_type: 'PERSONA', name: 'Ana', area: null }]], [], [
      payment({ occurred_at: '2026-08-25T11:00:00Z' })
    ], [audi({ occurred_at: '2026-08-25T11:30:00Z' })]).service.list({ limit: 3 });

    expect(result.data.map((item) => item.entity)).toEqual(['new@test.mx', 'Remisiones Audi', 'Notificaciones de pago']);
    expect(result.data.map((item) => item.occurredAt)).toEqual(['2026-08-25T12:00:00.000Z', '2026-08-25T11:30:00.000Z', '2026-08-25T11:00:00.000Z']);
  });

  it('exposes no notification identifiers or sensitive source fields', async () => {
    const result = await setup([], [], [], [payment({ result_count: 5, ready_count: 4, manual_count: 1 })]).service.list({ limit: 6 });
    expect(Object.keys(result.data[0]!)).toEqual(['type', 'category', 'title', 'entity', 'context', 'occurredAt']);
    expect(JSON.stringify(result)).not.toMatch(/correo_id|outlook|recipient|destinatario|detalle_error|pago_id/i);
  });
});
