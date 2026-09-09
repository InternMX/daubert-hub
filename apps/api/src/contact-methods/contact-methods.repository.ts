import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { AuditIdentity } from '../common/authenticated-request';
import type { AddContactMethodDto } from './dto/add-contact-method.dto';
import type { EditContactMethodDto } from './dto/edit-contact-method.dto';
import { validateContactMethod } from './contact-method-validation';

interface LockedContactRow extends QueryResultRow {
  id: string;
  status: string;
  company_status: string;
}

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

  async add(contactId: string, input: AddContactMethodDto, requestId: string, identity: AuditIdentity): Promise<ContactMethodRecord | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, identity);
      const contact = await this.lockContact(client, contactId);
      if (!contact) { await client.query('COMMIT'); return null; }
      if (contact.company_status !== 'ACTIVO') throw Object.assign(new Error('COMPANY_NOT_ACTIVE'), { code: 'COMPANY_NOT_ACTIVE' });
      if (contact.status !== 'ACTIVO') throw Object.assign(new Error('CONTACT_NOT_ACTIVE'), { code: 'CONTACT_NOT_ACTIVE' });
      if (await this.methodExists(client, contactId, input)) throw Object.assign(new Error('CONTACT_METHOD_DUPLICATE'), { code: 'CONTACT_METHOD_DUPLICATE' });
      const result = await client.query<ContactMethodRecord>(`
        INSERT INTO core.medios_contacto
          (contacto_id, tipo_medio, valor, estatus, es_principal, recibe_notificacion_pago, tipo_destinatario_pago)
        VALUES ($1, $2, $3, 'ACTIVO', FALSE, FALSE, NULL)
        RETURNING medio_id::text AS id, contacto_id::text AS contact_id, tipo_medio AS type,
          valor AS value, estatus AS status, es_principal AS is_primary`, [contactId, input.type, input.value]);
      await client.query('COMMIT');
      return result.rows[0]!;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async changeStatus(id: string, targetStatus: 'ACTIVO' | 'INACTIVO', requestId: string, identity: AuditIdentity): Promise<ContactMethodRecord | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, identity);
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

  async edit(id: string, input: EditContactMethodDto, requestId: string, identity: AuditIdentity): Promise<ContactMethodRecord | null> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, identity);
      const method = await this.lockMethod(client, id);
      if (!method) { await client.query('COMMIT'); return null; }
      if (method.company_status !== 'ACTIVO') throw Object.assign(new Error('COMPANY_NOT_ACTIVE'), { code: 'COMPANY_NOT_ACTIVE' });
      if (method.contact_status !== 'ACTIVO') throw Object.assign(new Error('CONTACT_NOT_ACTIVE'), { code: 'CONTACT_NOT_ACTIVE' });
      if (method.status !== 'ACTIVO' && method.status !== 'INACTIVO') throw Object.assign(new Error('METHOD_STATUS_NOT_MANAGEABLE'), { code: 'METHOD_STATUS_NOT_MANAGEABLE' });
      const resulting = { type: input.type ?? method.type, value: input.value ?? method.value };
      validateContactMethod(resulting.type, resulting.value);
      if (await this.methodExists(client, method.contact_id, resulting, method.id)) throw Object.assign(new Error('CONTACT_METHOD_DUPLICATE'), { code: 'CONTACT_METHOD_DUPLICATE' });
      const result = await client.query<ContactMethodRecord>(`
        UPDATE core.medios_contacto
        SET tipo_medio = $1, valor = $2
        WHERE medio_id = $3
        RETURNING medio_id::text AS id, contacto_id::text AS contact_id, tipo_medio AS type,
          valor AS value, estatus AS status, es_principal AS is_primary`, [resulting.type, resulting.value, id]);
      await client.query('COMMIT');
      return result.rows[0]!;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockMethod(client: PoolClient, id: string): Promise<LockedMethodRow | null> {
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

  private async lockContact(client: PoolClient, id: string): Promise<LockedContactRow | null> {
    const result = await client.query<LockedContactRow>(`
      SELECT contact.contacto_id::text AS id, contact.estatus AS status, company.estatus AS company_status
      FROM core.contactos contact
      JOIN core.empresas company ON company.empresa_id = contact.empresa_id
      WHERE contact.contacto_id = $1
      FOR UPDATE OF contact, company`, [id]);
    return result.rows[0] ?? null;
  }

  private async methodExists(client: PoolClient, contactId: string, input: { type: string; value: string }, excludedMethodId?: string): Promise<boolean> {
    const comparison = input.type === 'CORREO' ? 'LOWER(BTRIM(valor)) = LOWER($3)' : 'BTRIM(valor) = $3';
    const result = await client.query(`
      SELECT 1 FROM core.medios_contacto
      WHERE contacto_id = $1 AND tipo_medio = $2 AND ${comparison}
        AND ($4::bigint IS NULL OR medio_id <> $4::bigint)
      LIMIT 1`, [contactId, input.type, input.value, excludedMethodId ?? null]);
    return result.rows.length > 0;
  }

  private async setAuditContext(client: PoolClient, requestId: string, identity: AuditIdentity): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [identity.userId]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [identity.userEmail]);
  }
}
