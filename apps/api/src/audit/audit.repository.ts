import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AUDIT_ENTITIES, OPERATION_BY_ACTION, findEntityByKey, type AuditAction } from './audit-catalog';
import type { AuditSourceRow } from './audit-presenter';

export interface AuditEventFilter {
  from?: string;
  to?: string;
  userId?: string;
  entity?: string;
  action?: AuditAction;
}

const COLUMNS = `change.cambio_id::text AS cambio_id, change.fecha, change.esquema, change.tabla, change.registro_id,
  change.operacion, change.usuario_id, change.usuario_email, change.origen, change.request_id,
  change.datos_anteriores, change.datos_nuevos`;

// Read-only. Every query is restricted to the (schema, table) pairs declared in
// the audit catalog, so rows from any other table never leave the database.
@Injectable()
export class AuditRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(filter: AuditEventFilter, page: number, pageSize: number): Promise<{ rows: AuditSourceRow[]; total: number }> {
    const { where, values } = this.buildWhere(filter);
    const [countRow] = await this.database.query<{ total: number }>(`SELECT count(*)::int AS total FROM audit.cambios change WHERE ${where}`, values);
    const rows = await this.database.query<AuditSourceRow>(`
      SELECT ${COLUMNS}
      FROM audit.cambios change
      WHERE ${where}
      ORDER BY change.fecha DESC, change.cambio_id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize]);
    return { rows, total: countRow?.total ?? 0 };
  }

  async findById(id: string): Promise<AuditSourceRow | null> {
    const { where, values } = this.buildWhere({});
    const rows = await this.database.query<AuditSourceRow>(`
      SELECT ${COLUMNS}
      FROM audit.cambios change
      WHERE ${where} AND change.cambio_id = $${values.length + 1}::bigint`, [...values, id]);
    return rows[0] ?? null;
  }

  // Best-effort current display_name per actor id (security.users); a missing
  // user simply yields no entry — never a fabricated name.
  async findActorDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.database.query<{ id: string; display_name: string }>(`
      SELECT user_id::text AS id, display_name
      FROM security.users
      WHERE user_id = ANY($1::bigint[])`, [userIds]);
    return new Map(rows.map((row) => [row.id, row.display_name]));
  }

  private buildWhere(filter: AuditEventFilter): { where: string; values: unknown[] } {
    const entities = filter.entity ? [findEntityByKey(filter.entity)].filter((entity) => entity !== undefined) : AUDIT_ENTITIES;
    const values: unknown[] = [entities.map((entity) => entity.schema), entities.map((entity) => entity.table)];
    const conditions = ['(change.esquema, change.tabla) IN (SELECT * FROM unnest($1::text[], $2::text[]))'];
    if (filter.from) { values.push(filter.from); conditions.push(`change.fecha >= $${values.length}::timestamptz`); }
    if (filter.to) { values.push(filter.to); conditions.push(`change.fecha < $${values.length}::timestamptz`); }
    if (filter.userId) { values.push(filter.userId); conditions.push(`change.usuario_id = $${values.length}`); }
    if (filter.action) { values.push(OPERATION_BY_ACTION[filter.action]); conditions.push(`change.operacion = $${values.length}`); }
    return { where: conditions.join(' AND '), values };
  }
}
