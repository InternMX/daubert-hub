import { describe, expect, it, vi } from 'vitest';
import { AliasesRepository } from '../src/aliases/aliases.repository';

const identity = { userId: null, userEmail: null };

function harness(handler: (sql: string, values?: unknown[]) => unknown) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => handler(sql, values));
  const client = { query, release: vi.fn() };
  return { repository: new AliasesRepository({ connect: vi.fn().mockResolvedValue(client) } as never), query, client };
}

function result(rows: unknown[] = []) { return { rows }; }

describe('AliasesRepository', () => {
  it('checks company existence before listing aliases, grouping editable vs read-only types', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ alias: 'BMASC', tipo_alias: 'NOMBRE_COMERCIAL_ALTERNATIVO' }, { alias: 'ACME FILE', tipo_alias: 'NOMBRE_ARCHIVO' }]);
    const repository = new AliasesRepository({ query } as never);
    await expect(repository.list('9007199254740993')).resolves.toEqual({ aliases: ['BMASC'], otherAliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }] });
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT TRUE AS exists FROM core.empresas WHERE empresa_id = $1', ['9007199254740993']);
  });

  it('returns null for a missing company without reading aliases', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const repository = new AliasesRepository({ query } as never);
    await expect(repository.list('999')).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it('replaces aliases inside one audited transaction and re-reads the current set', async () => {
    const { repository, query, client } = harness((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id')) return result([{ empresa_id: '121' }]);
      if (sql.includes("tipo_alias = 'NOMBRE_COMERCIAL_ALTERNATIVO'")) return result([{ alias_id: '1', alias: 'BMASC' }, { alias_id: '2', alias: 'B ASC' }]);
      if (sql.includes('empresa_id <> $1')) return result();
      if (sql.startsWith('SELECT alias, tipo_alias')) return result([{ alias: 'B+ASC', tipo_alias: 'NOMBRE_COMERCIAL_ALTERNATIVO' }, { alias: 'BMASC', tipo_alias: 'NOMBRE_COMERCIAL_ALTERNATIVO' }]);
      return result();
    });
    await expect(repository.replace('121', ['BMASC', 'B+ASC'], 'request-1', identity)).resolves.toEqual({ aliases: ['B+ASC', 'BMASC'], otherAliases: [] });
    expect(query.mock.calls.slice(0, 5).map((call) => call[0])).toEqual([
      'BEGIN',
      "SELECT set_config('app.origin', $1, true)",
      "SELECT set_config('app.request_id', $1, true)",
      "SELECT set_config('app.user_id', COALESCE($1, ''), true)",
      "SELECT set_config('app.user_email', COALESCE($1, ''), true)"
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM core.alias_empresa'), ['121', ['2']]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO core.alias_empresa'), ['121', 'B+ASC']);
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('returns null and still commits when the company does not exist', async () => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id')) return result();
      return result();
    });
    await expect(repository.replace('999', ['BMASC'], 'request-2', identity)).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(query.mock.calls.some((call) => /^(INSERT|UPDATE|DELETE) /.test(String(call[0])))).toBe(false);
  });

  it('rolls back without mutating when an alias belongs to another company', async () => {
    const { repository, query } = harness((sql) => {
      if (sql.includes('FROM core.empresas WHERE empresa_id')) return result([{ empresa_id: '121' }]);
      if (sql.includes("tipo_alias = 'NOMBRE_COMERCIAL_ALTERNATIVO'")) return result([]);
      if (sql.includes('empresa_id <> $1')) return result([{ '?column?': 1 }]);
      return result();
    });
    await expect(repository.replace('121', ['TAKEN'], 'request-3', identity)).rejects.toMatchObject({ code: 'ALIAS_ALREADY_ASSOCIATED' });
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
    expect(query.mock.calls.some((call) => /^(INSERT|UPDATE|DELETE) /.test(String(call[0])))).toBe(false);
  });
});
