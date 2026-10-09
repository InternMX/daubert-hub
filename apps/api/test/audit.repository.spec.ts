import { describe, expect, it, vi } from 'vitest';
import { AUDIT_ENTITIES } from '../src/audit/audit-catalog';
import { AuditRepository } from '../src/audit/audit.repository';

describe('AuditRepository', () => {
  it('restricts every list query to the catalog tables and orders newest first', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ total: 3 }]).mockResolvedValueOnce([]);
    const repository = new AuditRepository({ query } as never);

    await expect(repository.list({}, 2, 25)).resolves.toEqual({ rows: [], total: 3 });

    const [countSql, countValues] = query.mock.calls[0] as [string, unknown[]];
    const [listSql, listValues] = query.mock.calls[1] as [string, unknown[]];
    expect(countSql).toContain('FROM audit.cambios');
    expect(listSql).toContain('(change.esquema, change.tabla) IN (SELECT * FROM unnest($1::text[], $2::text[]))');
    expect(listSql).toContain('ORDER BY change.fecha DESC, change.cambio_id DESC');
    expect(listSql).toContain('LIMIT $3 OFFSET $4');
    expect(listValues.slice(-2)).toEqual([25, 25]);
    expect(countValues[0]).toEqual(AUDIT_ENTITIES.map((entity) => entity.schema));
    expect(countValues[1]).toEqual(AUDIT_ENTITIES.map((entity) => entity.table));
  });

  it('applies date, user, entity and action filters as bound parameters', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    const repository = new AuditRepository({ query } as never);

    await repository.list({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z', userId: '7', entity: 'USER', action: 'UPDATE' }, 1, 10);

    const [sql, values] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('change.fecha >= $3::timestamptz');
    expect(sql).toContain('change.fecha < $4::timestamptz');
    expect(sql).toContain('change.usuario_id = $5');
    expect(sql).toContain('change.operacion = $6');
    expect(values).toEqual([['security'], ['users'], '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', '7', 'UPDATE', 10, 0]);
    expect(sql).not.toContain('2026-10-01');
    expect(sql).not.toContain("'7'");
  });

  it('maps the CREATE action to the INSERT operation', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    await new AuditRepository({ query } as never).list({ action: 'CREATE' }, 1, 10);
    expect((query.mock.calls[1] as [string, unknown[]])[1]).toContain('INSERT');
  });

  it('looks events up by id inside the catalog restriction, and resolves actor names only for given ids', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new AuditRepository({ query } as never);

    await expect(repository.findById('42')).resolves.toBeNull();
    expect(query.mock.calls[0]![0]).toContain('change.cambio_id = $3::bigint');

    await expect(repository.findActorDisplayNames([])).resolves.toEqual(new Map());
    expect(query).toHaveBeenCalledTimes(1);
  });
});
