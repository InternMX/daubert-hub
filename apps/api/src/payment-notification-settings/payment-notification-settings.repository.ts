import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import type { AuditIdentity } from '../common/authenticated-request';
import { DatabaseService } from '../database/database.service';
import { buildPaymentDestinationPath, resolveDestinationAfterDropboxChange, type DestinationChangeKind } from './dropbox-path';

export interface PaymentNotificationSettingsRow extends QueryResultRow {
  company_id: string;
  dropbox_path: string | null;
  has_settings_row: boolean;
  processes_payment_receipts: boolean;
  notifications_active: boolean;
  destination_path: string | null;
  has_operable_para_recipient: boolean;
}

// Historical companies may have no core.empresas_notificacion_pago row (no mass backfill in this
// phase): the LEFT JOIN + COALESCE below turn that into safe defaults (false/false) without writing.
// The PARA predicate is deliberately explicit and independent of es_principal:
// ACTIVE contact + ACTIVE CORREO method + recibe_notificacion_pago + tipo_destinatario_pago = 'PARA'.
const SETTINGS_SELECT = `
  SELECT
    company.empresa_id::text AS company_id,
    company.ruta_dropbox AS dropbox_path,
    settings.empresa_id IS NOT NULL AS has_settings_row,
    COALESCE(settings.procesa_comprobantes_pago, FALSE) AS processes_payment_receipts,
    COALESCE(settings.notificaciones_activas, FALSE) AS notifications_active,
    settings.ruta_destino AS destination_path,
    EXISTS (
      SELECT 1
      FROM core.contactos contact
      JOIN core.medios_contacto method ON method.contacto_id = contact.contacto_id
      WHERE contact.empresa_id = company.empresa_id
        AND contact.estatus = 'ACTIVO'
        AND method.estatus = 'ACTIVO'
        AND method.tipo_medio = 'CORREO'
        AND method.recibe_notificacion_pago = TRUE
        AND method.tipo_destinatario_pago = 'PARA'
    ) AS has_operable_para_recipient
  FROM core.empresas company
  LEFT JOIN core.empresas_notificacion_pago settings ON settings.empresa_id = company.empresa_id
  WHERE company.empresa_id = $1`;

export interface PaymentNotificationSettingsChange {
  processesPaymentReceipts?: boolean;
  notificationsActive?: boolean;
}

export type PaymentNotificationSettingsUpdateResult =
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_READY'; current: PaymentNotificationSettingsRow }
  | { status: 'UPDATED'; current: PaymentNotificationSettingsRow };

// Creates the row for a brand-new company: safe defaults (nothing processed, nothing active) and
// ruta_destino derived from ruta_dropbox (or the schema default when there is none). Runs in the
// caller's transaction so a failure here rolls the whole company creation back.
export async function insertPaymentNotificationSettings(client: PoolClient, companyId: string | number, dropboxPath: string | null): Promise<void> {
  await client.query(`
    INSERT INTO core.empresas_notificacion_pago (empresa_id, procesa_comprobantes_pago, notificaciones_activas, ruta_destino)
    VALUES ($1, FALSE, FALSE, $2)`, [companyId, buildPaymentDestinationPath(dropboxPath)]);
}

// Keeps ruta_destino coherent when ruta_dropbox changes, in the caller's transaction (the company row is
// already locked). Only the flags-free column ruta_destino is ever written, and only when it must move:
//   - no settings row yet: create it (false/false) with the standard destination — never activated as a side effect;
//   - standard destination: regenerated for the new path;
//   - historical destination (same prefix as the previous path, custom sub-path): prefix swapped, sub-path kept verbatim;
//   - unrelated / unchanged destination: left untouched.
// Returns what was decided so callers and tests can tell the cases apart.
export async function syncPaymentNotificationDestination(client: PoolClient, companyId: string | number, previousDropboxPath: string | null, nextDropboxPath: string | null): Promise<DestinationChangeKind> {
  const existing = await client.query<{ ruta_destino: string | null }>('SELECT ruta_destino FROM core.empresas_notificacion_pago WHERE empresa_id = $1 FOR UPDATE', [companyId]);
  const storedDestination = existing.rows[0]?.ruta_destino ?? null;
  const decision = resolveDestinationAfterDropboxChange({ previousDropboxPath, nextDropboxPath, currentDestination: storedDestination });
  if (existing.rows.length === 0) {
    await client.query(`
    INSERT INTO core.empresas_notificacion_pago (empresa_id, procesa_comprobantes_pago, notificaciones_activas, ruta_destino)
    VALUES ($1, FALSE, FALSE, $2)
    ON CONFLICT (empresa_id) DO NOTHING`, [companyId, decision.destination ?? buildPaymentDestinationPath(nextDropboxPath)]);
  } else if (decision.destination !== null && decision.destination !== storedDestination) {
    await client.query('UPDATE core.empresas_notificacion_pago SET ruta_destino = $2, updated_at = now() WHERE empresa_id = $1', [companyId, decision.destination]);
  }
  return decision.kind;
}

@Injectable()
export class PaymentNotificationSettingsRepository {
  constructor(private readonly database: DatabaseService) {}

  async find(companyId: string): Promise<PaymentNotificationSettingsRow | null> {
    const [row] = await this.database.query<PaymentNotificationSettingsRow>(SETTINGS_SELECT, [companyId]);
    return row ?? null;
  }

  // One transaction: lock the company row (same lock contact-method changes take, so a concurrent
  // change to a recipient cannot slip between the readiness check and the upsert), evaluate readiness
  // with the resulting state, then UPSERT. Deactivating is always allowed.
  async update(
    companyId: string,
    change: PaymentNotificationSettingsChange,
    isReady: (row: PaymentNotificationSettingsRow, next: { processesPaymentReceipts: boolean; notificationsActive: boolean }) => boolean,
    requestId: string,
    identity: AuditIdentity
  ): Promise<PaymentNotificationSettingsUpdateResult> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.setAuditContext(client, requestId, identity);
      const locked = await client.query('SELECT 1 FROM core.empresas WHERE empresa_id = $1 FOR UPDATE', [companyId]);
      if (locked.rows.length === 0) { await client.query('COMMIT'); return { status: 'NOT_FOUND' }; }
      const current = (await client.query<PaymentNotificationSettingsRow>(SETTINGS_SELECT, [companyId])).rows[0]!;
      const next = {
        processesPaymentReceipts: change.processesPaymentReceipts ?? current.processes_payment_receipts,
        notificationsActive: change.notificationsActive ?? current.notifications_active
      };
      if (next.notificationsActive && !isReady(current, next)) {
        await client.query('ROLLBACK');
        return { status: 'NOT_READY', current };
      }
      // ruta_destino on INSERT follows ruta_dropbox; on conflict it is left untouched (historical
      // rows keep their own template) — it only changes when ruta_dropbox changes.
      await client.query(`
        INSERT INTO core.empresas_notificacion_pago (empresa_id, procesa_comprobantes_pago, notificaciones_activas, ruta_destino)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (empresa_id) DO UPDATE SET
          procesa_comprobantes_pago = EXCLUDED.procesa_comprobantes_pago,
          notificaciones_activas = EXCLUDED.notificaciones_activas,
          updated_at = now()`, [companyId, next.processesPaymentReceipts, next.notificationsActive, buildPaymentDestinationPath(current.dropbox_path)]);
      const updated = (await client.query<PaymentNotificationSettingsRow>(SETTINGS_SELECT, [companyId])).rows[0]!;
      await client.query('COMMIT');
      return { status: 'UPDATED', current: updated };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the database error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async setAuditContext(client: PoolClient, requestId: string, identity: AuditIdentity): Promise<void> {
    await client.query("SELECT set_config('app.origin', $1, true)", ['DAUBERT_HUB']);
    await client.query("SELECT set_config('app.request_id', $1, true)", [requestId]);
    await client.query("SELECT set_config('app.user_id', COALESCE($1, ''), true)", [identity.userId]);
    await client.query("SELECT set_config('app.user_email', COALESCE($1, ''), true)", [identity.userEmail]);
  }
}
