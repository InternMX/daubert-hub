import { describe, expect, it } from 'vitest';
import { AUDIT_ENTITIES, findEntityByTable, isSensitiveFieldName } from '../src/audit/audit-catalog';
import { buildChanges } from '../src/audit/audit-presenter';

describe('audit catalog', () => {
  it('covers exactly the 10 audited tables, each once', () => {
    const tables = AUDIT_ENTITIES.map((entity) => `${entity.schema}.${entity.table}`).sort();
    expect(tables).toEqual([
      'core.alias_empresa', 'core.contactos', 'core.direcciones', 'core.empresa_roles', 'core.empresas', 'core.empresas_fiscales',
      'core.medios_contacto', 'ops.automation_review_acknowledgements', 'ops.automation_trigger_requests', 'security.users'
    ]);
    expect(new Set(AUDIT_ENTITIES.map((entity) => entity.key)).size).toBe(AUDIT_ENTITIES.length);
  });

  it('does not read the specialized ledger operacion.ajustes_series (it is its own source)', () => {
    expect(findEntityByTable('operacion', 'ajustes_series')).toBeUndefined();
  });

  it('never allowlists a credential-looking column', () => {
    for (const entity of AUDIT_ENTITIES) {
      for (const field of entity.fields) expect(isSensitiveFieldName(field.key), `${entity.key}.${field.key}`).toBe(false);
    }
    const users = findEntityByTable('security', 'users')!;
    expect(users.fields.map((field) => field.key)).not.toContain('password_hash');
  });

  it.each(['password_hash', 'token_hash', 'api_key', 'client_secret', 'session_id', 'cookie', 'webhook_token'])('treats %s as sensitive', (name) => {
    expect(isSensitiveFieldName(name)).toBe(true);
  });

  it('allows the non-secret password flags', () => {
    expect(isSensitiveFieldName('password_changed')).toBe(false);
    expect(isSensitiveFieldName('must_change_password')).toBe(false);
  });
});

describe('buildChanges', () => {
  const users = findEntityByTable('security', 'users')!;
  const company = findEntityByTable('core', 'empresas')!;

  it('drops password_hash and unknown columns even if present in the snapshot', () => {
    const changes = buildChanges(users, 'UPDATE', { email: 'a@x.mx', password_hash: 'OLD-HASH', role: 'GENERAL', extra: 'x' }, { email: 'a@x.mx', password_hash: 'NEW-HASH', role: 'ADMIN', password_changed: true, extra: 'y' });
    expect(JSON.stringify(changes)).not.toContain('HASH');
    expect(changes).toEqual([
      { field: 'role', label: 'Rol', before: 'GENERAL', after: 'ADMIN' },
      { field: 'password_changed', label: 'Contraseña modificada', before: null, after: 'Sí' }
    ]);
  });

  it('shows only changed fields on UPDATE, all present fields on CREATE and DELETE', () => {
    expect(buildChanges(company, 'UPDATE', { nombre_comercial: 'A', estatus: 'ACTIVO' }, { nombre_comercial: 'B', estatus: 'ACTIVO' })).toEqual([{ field: 'nombre_comercial', label: 'Nombre comercial', before: 'A', after: 'B' }]);
    expect(buildChanges(company, 'CREATE', null, { nombre_comercial: 'A', estatus: 'ACTIVO' })).toEqual([
      { field: 'nombre_comercial', label: 'Nombre comercial', before: null, after: 'A' },
      { field: 'estatus', label: 'Estatus', before: null, after: 'ACTIVO' }
    ]);
    expect(buildChanges(company, 'DELETE', { nombre_comercial: 'A' }, null)).toEqual([{ field: 'nombre_comercial', label: 'Nombre comercial', before: 'A', after: null }]);
  });

  it('never presents structured values and truncates very long text', () => {
    const changes = buildChanges(company, 'CREATE', null, { nombre_comercial: { nested: 'secret' }, observaciones: 'x'.repeat(900) });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.after!.length).toBeLessThanOrEqual(501);
  });
});
