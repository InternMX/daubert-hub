import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

interface LockedMethodRow extends QueryResultRow {
  id: string;
  contact_id: string;
  type: string;
  value: string;
  status: string;
  is_primary: boolean;
  contact_status: string;
  company_status: string;
}

export interface ContactMethodRecord {
  id: string;
  contact_id: string;
  type: string;
  value: string;
  status: string;
  is_primary: boolean;
}

@Injectable()
export class ContactMethodsRepository {
  constructor(private readonly database: DatabaseService) {}

  async changeStatus(id: number, targetStatus: 'ACTIVO' | 'INACTIVO', requestId: string): Promise<ContactMethodRecord | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId);
      const method = await this.lockMethod(client, id);
      if (!method) { await client.query('COMMIT'); return null; }
      if (method.company_status !== 'ACTIVO') throw Object.assign(new Error('COMPANY_NOT_ACTIVE'), { code: 'COMPANY_NOT_ACTIVE' });
      if (method.contact_status !== 'ACTIVO') throw Object.assign(new Error('CONTACT_NOT_ACTIVE'), { code: 'CONTACT_NOT_ACTIVE' });
      if (method.status !== 'ACTIVO' && method.status !== 'INACTIVO') throw Object.assign(new Error('METHOD_STATUS_NOT_MANAGEABLE'), { code: 'METHOD_STATUS_NOT_MANAGEABLE' });
      if (method.status === targetStatus) throw Object.assign(new Error(targetStatus === 'ACTIVO' ? 'METHOD_ALREADY_ACTIVE' : 'METHOD_ALREADY_INACTIVE'), { code: targetStatus === 'ACTIVO' ? 'METHOD_ALREADY_ACTIVE' : 'METHOD_ALREADY_INACTIVE' });
      await client.query('UPDATE core.medios_contacto SET estatus = $1 WHERE medio_id = $2', [targetStatus, id]);
      await client.query('COMMIT');
      return { id: method.id, contact_id: method.contact_id, type: method.type, value: method.value, status: targetStatus, is_primary: method.is_primary };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockMethod(client: PoolClient, id: number): Promise<LockedMethodRow | null> {
    const result = await client.query<LockedMethodRow>(`
      SELECT method.medio_id::text AS id, method.contacto_id::text AS contact_id, method.tipo_medio AS type,
        method.valor AS value, method.estatus AS status, method.es_principal AS is_primary,
        contact.estatus AS contact_status, company.estatus AS company_status
      FROM core.medios_contacto method
      JOIN core.contactos contact ON contact.contacto_id = method.contacto_id
      JOIN core.empresas company ON company.empresa_id = contact.empresa_id
      WHERE method.medio_id = $1
      FOR UPDATE OF method, contact, company`, [id]);
    return result.rows[0] ?? null;
  }

  private async setAuditContext(client: PoolClient, requestId: string): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
  }
}
