import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AuditIdentity } from '../../common/authenticated-request';
import { DatabaseService } from '../../database/database.service';
import type { PaymentFileAssignmentDto } from './dto/payment-file-assignment.dto';
import { parsePaymentNotificationFileErrors, type PaymentNotificationFileError } from './payment-notification-file-errors';

export interface PointAssignment {
  companyId: string;
  companyName: string;
  status: 'ACTIVA' | 'REVOCADA';
  version: number;
  updatedAt: string;
}

export interface PaymentFileAssignmentState {
  fileId: string | null;
  enabled: boolean;
  canManage: boolean;
  blockedReason: string | null;
  identityState: string | null;
  operationalState: string | null;
  assignment: PointAssignment | null;
  n8nReady: false;
}

export interface RegisteredPaymentFile {
  fileId: string;
  fileHash: string;
  fileName: string;
  errorCode: string | null;
  identityState: string;
  operationalState: string;
  safe: boolean;
  companyId: string | null;
  companyName: string | null;
  status: 'ACTIVA' | 'REVOCADA' | null;
  version: number | null;
  updatedAt: string | null;
}

const selectFiles = `SELECT f.archivo_id::text AS "fileId", f.file_sha256 AS "fileHash",
  f.nombre_archivo AS "fileName", f.codigo_error AS "errorCode", f.estado_identidad AS "identityState",
  f.estado_operativo AS "operationalState", core.fn_archivo_notificacion_asignable(f.archivo_id, f.correo_id) AS safe,
  a.empresa_id::text AS "companyId", e.nombre_comercial AS "companyName", a.estatus AS status,
  a.version, a.updated_at::text AS "updatedAt"
  FROM core.archivos_notificacion_pago f
  LEFT JOIN core.asignaciones_archivo_notificacion_pago a USING (archivo_id)
  LEFT JOIN core.empresas e ON e.empresa_id = a.empresa_id WHERE f.correo_id = $1`;

export function emptyPointState(reason: string, enabled: boolean): PaymentFileAssignmentState {
  return { fileId: null, enabled, canManage: false, blockedReason: reason, identityState: null, operationalState: null, assignment: null, n8nReady: false };
}

export function describePointFile(file: PaymentNotificationFileError, errors: PaymentNotificationFileError[], records: RegisteredPaymentFile[]): PaymentFileAssignmentState {
  const matches = (candidate: { fileHash: string; fileName: string }) => candidate.fileHash.toLowerCase() === file.fileHash.toLowerCase() && candidate.fileName === file.fileName;
  const matching = records.filter(matches);
  if (!matching.length) return emptyPointState('Este archivo no tiene una identidad individual registrada por el extractor confiable.', true);
  if (matching.length !== 1 || errors.filter(matches).length !== 1) return emptyPointState('Hay ocurrencias indistinguibles en el error histórico. La asignación puntual está bloqueada.', true);
  const record = matching[0]!;
  let blockedReason: string | null = null;
  if (record.identityState !== 'VERIFICADA') blockedReason = 'La identidad de este archivo no está verificada o es ambigua.';
  else if (record.operationalState !== 'SIN_EFECTOS' || !record.safe) blockedReason = 'No se pueden descartar efectos operativos previos o el correo está en proceso.';
  else if (record.errorCode !== file.errorCode || !['ALIAS_NO_CATALOGADO', 'ALIAS_AMBIGUO'].includes(file.errorCode)) blockedReason = 'La incidencia no coincide inequívocamente con el registro del extractor.';
  return {
    fileId: record.fileId, enabled: true, canManage: blockedReason === null, blockedReason,
    identityState: record.identityState, operationalState: record.operationalState, n8nReady: false,
    assignment: record.companyId && record.status && record.version !== null ? {
      companyId: record.companyId, companyName: record.companyName ?? 'Empresa no disponible', status: record.status,
      version: record.version, updatedAt: record.updatedAt!
    } : null
  };
}

@Injectable()
export class PaymentFileAssignmentsRepository {
  constructor(private readonly database: DatabaseService) {}

  async schemaAvailable(): Promise<boolean> {
    const [row] = await this.database.query<{ available: boolean }>(`SELECT
      to_regclass('core.archivos_notificacion_pago') IS NOT NULL
      AND to_regclass('core.asignaciones_archivo_notificacion_pago') IS NOT NULL AS available`);
    return row?.available === true;
  }

  async describe(correoId: string, errors: PaymentNotificationFileError[], enabled: boolean): Promise<PaymentFileAssignmentState[]> {
    const disabledReason = 'Asignación puntual deshabilitada. Disponible exclusivamente para validación en TEST.';
    if (!await this.schemaAvailable()) return errors.map(() => emptyPointState(enabled ? 'El registro de archivos aún no está instalado en TEST.' : disabledReason, enabled));
    const records = await this.database.query<RegisteredPaymentFile>(selectFiles, [correoId]);
    return errors.map((file) => {
      const state = describePointFile(file, errors, records);
      return { ...state, enabled, canManage: enabled && state.canManage, blockedReason: enabled ? state.blockedReason : disabledReason };
    });
  }

  async activeCorreoIds(ids: string[]): Promise<string[]> {
    if (!ids.length || !await this.schemaAvailable()) return [];
    const rows = await this.database.query<{ id: string }>(`SELECT DISTINCT f.correo_id::text AS id
      FROM core.archivos_notificacion_pago f JOIN core.asignaciones_archivo_notificacion_pago a USING (archivo_id)
      WHERE a.estatus = 'ACTIVA' AND f.correo_id = ANY($1::bigint[])`, [ids]);
    return rows.map((row) => row.id);
  }

  private async context(client: PoolClient, requestId: string, identity: AuditIdentity) {
    await client.query("SELECT set_config('app.origin', 'DAUBERT_HUB', true), set_config('app.request_id', $1, true), set_config('app.user_id', $2, true), set_config('app.user_email', $3, true)", [requestId, identity.userId ?? '', identity.userEmail ?? '']);
  }

  async mutate(correoId: string, fileId: string, input: PaymentFileAssignmentDto, requestId: string, identity: AuditIdentity): Promise<PointAssignment> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const live = await client.query<{ name: string }>('SELECT current_database() AS name');
      if (live.rows[0]?.name !== 'daubert_hub_test') throw new ForbiddenException('Las asignaciones puntuales solo están habilitadas en TEST.');
      await this.context(client, requestId, identity);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || $1::bigint::text, 0))", [correoId]);
      const mail = (await client.query<{ detail: string | null }>('SELECT detalle_error AS detail FROM core.correos_notificacion_pago WHERE correo_id = $1', [correoId])).rows[0];
      if (!mail) throw new NotFoundException('Correo no encontrado.');
      const records = (await client.query<RegisteredPaymentFile>(selectFiles, [correoId])).rows;
      const record = records.find((row) => row.fileId === fileId);
      if (!record) throw new NotFoundException('El archivo no pertenece a este correo.');
      const errors = parsePaymentNotificationFileErrors(mail.detail);
      const file = errors.find((error) => error.fileName === record.fileName && error.fileHash.toLowerCase() === record.fileHash);
      if (!file) throw new ConflictException({ code: 'POINT_FILE_UNSAFE', message: 'No hay una incidencia verificable para este archivo.' });
      const state = describePointFile(file, errors, records);
      const safe = (await client.query<{ safe: boolean }>('SELECT core.fn_archivo_notificacion_asignable($1, $2, true) AS safe', [fileId, correoId])).rows[0]?.safe;
      if (!state.canManage || !safe) throw new ConflictException({ code: 'POINT_FILE_UNSAFE', message: state.blockedReason ?? 'El estado operativo del archivo cambió.' });
      if ((record.version ?? 0) !== input.expectedVersion) throw new ConflictException({ code: 'POINT_ASSIGNMENT_CHANGED', message: 'La asignación cambió. Actualiza el detalle antes de confirmar.' });
      if (input.action === 'ASSIGN' && record.status === 'ACTIVA' || input.action !== 'ASSIGN' && record.status !== 'ACTIVA') {
        throw new ConflictException({ code: 'POINT_ASSIGNMENT_CHANGED', message: 'El estado de asignación ya no corresponde a la acción.' });
      }
      if (input.action !== 'REVOKE') {
        const company = await client.query("SELECT 1 FROM core.empresas WHERE empresa_id = $1 AND estatus = 'ACTIVO' FOR SHARE", [input.companyId]);
        if (!company.rows.length) throw new NotFoundException('Empresa activa no encontrada.');
        if (input.action === 'CHANGE' && input.companyId === record.companyId) throw new ConflictException('Selecciona otra empresa.');
      }
      if (!record.status) {
        await client.query(`INSERT INTO core.asignaciones_archivo_notificacion_pago
          (archivo_id, empresa_id, estatus, created_by, updated_by) VALUES ($1, $2, 'ACTIVA', $3, $3)`, [fileId, input.companyId, identity.userId]);
      } else {
        await client.query(`UPDATE core.asignaciones_archivo_notificacion_pago SET empresa_id = $2, estatus = $3,
          version = version + 1, updated_at = clock_timestamp(), updated_by = $4 WHERE archivo_id = $1`,
        [fileId, input.action === 'REVOKE' ? record.companyId : input.companyId, input.action === 'REVOKE' ? 'REVOCADA' : 'ACTIVA', identity.userId]);
      }
      const updated = (await client.query<RegisteredPaymentFile>(selectFiles, [correoId])).rows.find((row) => row.fileId === fileId)!;
      await client.query('COMMIT');
      return { companyId: updated.companyId!, companyName: updated.companyName!, status: updated.status!, version: updated.version!, updatedAt: updated.updatedAt! };
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async protectReprocess<T>(correoId: string, requestId: string, identity: AuditIdentity, dispatch: () => Promise<T>): Promise<T> {
    if (!await this.schemaAvailable()) return dispatch();
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await this.context(client, requestId, identity);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || $1::bigint::text, 0))", [correoId]);
      const active = await client.query(`SELECT 1 FROM core.asignaciones_archivo_notificacion_pago a
        JOIN core.archivos_notificacion_pago f USING (archivo_id) WHERE f.correo_id = $1 AND a.estatus = 'ACTIVA' LIMIT 1`, [correoId]);
      if (active.rows.length) throw new ConflictException({ code: 'POINT_FILE_N8N_NOT_READY', message: 'Este correo tiene asignaciones puntuales activas. La integración n8n aún no está habilitada.' });
      await client.query('SELECT core.fn_bloquear_archivos_reproceso_pago($1)', [correoId]);
      // Commit the freeze BEFORE contacting n8n: even an uncertain/throwing upstream cannot
      // reopen a window for assignment after a potentially accepted processing request.
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    return dispatch();
  }
}
