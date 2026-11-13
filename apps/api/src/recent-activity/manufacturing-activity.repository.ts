import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

// Actividad de Hojas de manufactura para «Actividad reciente». Fuente de verdad: las tablas `manufactura.*` (NO el autoguardado ni audit.cambios, que registran cada edición). Eventos fiables del esquema:
//   · DOCUMENTO_CREADO     — manufactura.documentos.created_at: se creó el documento inicial (su primera revisión siempre nace como borrador). NO describe el estado actual de la hoja.
//   · REVISION_CREADA      — manufactura.revisiones.created_at de una revisión con `basada_en_revision_id` (nueva revisión sobre una finalizada: «basada en REV0n»).
//   · REVISION_FINALIZADA  — manufactura.revisiones.finalizado_en (REV01, REV02…).
// Cada evento describe lo que ocurrió EN SU FECHA. No se reconstruye nada que la base no demuestre (p. ej. no se infiere una «creación» a partir de la última revisión ni del estado actual).
// PERMISOS: se consulta con la identidad de la sesión (RLS de la base) y, además, con el mismo predicado de visibilidad de forma explícita (el de la consulta compartida, migración 105): las revisiones
// FINALIZADAS, los BORRADORES y las finalizaciones en curso (FINALIZANDO) de cualquier cuenta son consultables (el enlace los abre en solo lectura si no son propios). Las DESCARTADAS no aparecen.
// Si la 105 aún no está aplicada, la RLS de la base sigue ocultando los borradores ajenos. No registra autoguardados. Sin el esquema `manufactura` (otros entornos) no devuelve nada.

export interface ManufacturingActivityRow {
  tipo: 'DOCUMENTO_CREADO' | 'REVISION_CREADA' | 'REVISION_FINALIZADA';
  codigo: string;
  variante: string | null;
  /** REVISION_FINALIZADA: la revisión que se finalizó. Otros eventos: null. */
  revision: number | null;
  /** REVISION_CREADA: número de la revisión finalizada sobre la que se basa. */
  revision_base: number | null;
  revision_public_id: string;
  occurred_at: Date | string;
  actor_id: string | null;
  actor_nombre: string | null;
  actor_email: string | null;
}

@Injectable()
export class ManufacturingActivityRepository {
  private readonly logger = new Logger(ManufacturingActivityRepository.name);

  constructor(private readonly database: DatabaseService) {}

  async findRecent(limit: number, actor: { userId: string; role: string }): Promise<ManufacturingActivityRow[]> {
    if (!/^[1-9]\d{0,17}$/.test(actor.userId)) return [];
    let client;
    try {
      client = await this.database.connect();
      await client.query('BEGIN READ ONLY');
      const existe = await client.query<{ ok: boolean }>("SELECT (to_regclass('manufactura.revisiones') IS NOT NULL AND to_regclass('manufactura.documentos') IS NOT NULL) AS ok");
      if (existe.rows[0]?.ok !== true) { await client.query('ROLLBACK'); return []; }
      await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.user_email', 'actividad-reciente', true), set_config('app.origin', 'DAUBERT_HUB', true)", [actor.userId]);
      const r = await client.query<ManufacturingActivityRow>(
        `WITH visibles AS (
           SELECT r.documento_id, r.public_id, r.estado, r.revision, r.created_at, r.finalizado_en, r.finalizado_por_usuario_id, r.creado_por_usuario_id, r.basada_en_revision_id
             FROM manufactura.revisiones r
            WHERE r.estado IN ('BORRADOR', 'FINALIZANDO', 'FINALIZADA')   -- consultables por cualquier cuenta (la RLS de la 105 es quien lo permite); DESCARTADA nunca
         ), eventos AS (
           SELECT 'REVISION_FINALIZADA'::text AS tipo, d.codigo_dcmx AS codigo, d.variante, v.revision, NULL::int AS revision_base, v.public_id::text AS revision_public_id, v.finalizado_en AS occurred_at, v.finalizado_por_usuario_id AS actor_id
             FROM visibles v JOIN manufactura.documentos d ON d.documento_id = v.documento_id
            WHERE v.estado = 'FINALIZADA' AND v.finalizado_en IS NOT NULL
           UNION ALL
           SELECT 'REVISION_CREADA', d.codigo_dcmx, d.variante, NULL::int, b.revision, v.public_id::text, v.created_at, v.creado_por_usuario_id
             FROM visibles v JOIN manufactura.documentos d ON d.documento_id = v.documento_id
             JOIN manufactura.revisiones b ON b.documento_id = v.documento_id AND b.revision_id = v.basada_en_revision_id
            WHERE b.revision IS NOT NULL
           UNION ALL
           -- Creación del documento: el enlace apunta a la PRIMERA revisión que esta cuenta puede ver (no al estado actual).
           SELECT 'DOCUMENTO_CREADO', d.codigo_dcmx, d.variante, NULL::int, NULL::int, prim.public_id::text, d.created_at, d.creado_por_usuario_id
             FROM manufactura.documentos d
             JOIN LATERAL (SELECT v.* FROM visibles v WHERE v.documento_id = d.documento_id ORDER BY v.created_at ASC, v.public_id LIMIT 1) prim ON true
         )
         SELECT e.tipo, e.codigo, e.variante, e.revision, e.revision_base, e.revision_public_id, e.occurred_at, e.actor_id::text AS actor_id, u.display_name AS actor_nombre, u.email AS actor_email
           FROM eventos e LEFT JOIN security.users u ON u.user_id = e.actor_id
          ORDER BY e.occurred_at DESC LIMIT $1`, [limit]);
      await client.query('ROLLBACK');
      return r.rows;
    } catch (error) {
      // La actividad de manufactura nunca debe romper la actividad reciente de lo demás.
      this.logger.warn(`No se pudo leer la actividad de manufactura: ${(error as Error).message}`);
      try { await client?.query('ROLLBACK'); } catch { /* conserva el aviso original */ }
      return [];
    } finally {
      client?.release();
    }
  }
}
