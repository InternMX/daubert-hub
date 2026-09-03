import type { PoolClient } from 'pg';

interface AliasRow {
  alias_id: string;
  alias: string;
}

export function normalizeAliasList(aliases: string[]): string[] {
  const trimmed = aliases.map((alias) => alias.trim());
  if (trimmed.some((alias) => !alias)) throw Object.assign(new Error('ALIASES_EMPTY'), { code: 'ALIASES_EMPTY' });
  if (new Set(trimmed.map((alias) => alias.toLowerCase())).size !== trimmed.length) {
    throw Object.assign(new Error('ALIASES_DUPLICATE'), { code: 'ALIASES_DUPLICATE' });
  }
  return trimmed;
}

export async function replaceCompanyAliases(client: PoolClient, companyId: string | number, aliases: string[]): Promise<void> {
  const current = await client.query<AliasRow>(`
    SELECT alias_id::text, alias
    FROM core.alias_empresa
    WHERE empresa_id = $1
      AND tipo_alias = 'NOMBRE_COMERCIAL_ALTERNATIVO'
      AND estatus = 'ACTIVO'
    ORDER BY alias_id
    FOR UPDATE`, [companyId]);
  const received = new Map(aliases.map((alias) => [alias.toLowerCase(), alias]));
  const currentByNormalized = new Map(current.rows.map((row) => [row.alias.trim().toLowerCase(), row]));
  const removedIds = current.rows
    .filter((row) => !received.has(row.alias.trim().toLowerCase()))
    .map((row) => row.alias_id);
  const additions = [...received]
    .filter(([normalized]) => !currentByNormalized.has(normalized))
    .map(([, alias]) => alias);

  if (additions.length > 0) {
    const conflict = await client.query(`
      SELECT 1
      FROM core.alias_empresa
      WHERE empresa_id <> $1
        AND estatus = 'ACTIVO'
        AND lower(btrim(alias_normalizado)) = ANY($2::text[])
      LIMIT 1`, [companyId, additions.map((alias) => alias.toLowerCase())]);
    if (conflict.rows.length > 0) throw Object.assign(new Error('ALIAS_ALREADY_ASSOCIATED'), { code: 'ALIAS_ALREADY_ASSOCIATED' });
  }
  if (removedIds.length > 0) {
    await client.query('DELETE FROM core.alias_empresa WHERE empresa_id = $1 AND alias_id = ANY($2::bigint[])', [companyId, removedIds]);
  }
  for (const alias of additions) {
    await client.query(`INSERT INTO core.alias_empresa (empresa_id, alias, alias_normalizado, tipo_alias, estatus)
      VALUES ($1, $2, $2, 'NOMBRE_COMERCIAL_ALTERNATIVO', 'ACTIVO')`, [companyId, alias]);
  }
}
