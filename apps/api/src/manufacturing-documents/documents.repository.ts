import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { ActorDocumental, ConfirmacionRow, EspecificacionDocumento, EstadoRevision, RevisionRow, UsuarioRevisorRow } from './documents.types';

/** Zona con la que se imprime la fecha de finalización en el PDF (la base guarda el instante). */
export const ZONA_DOCUMENTAL = 'America/Mexico_City';

const iso = (columna: string): string => `to_json(${columna}) #>> '{}'`;

// Consulta ÚNICA de revisiones (con su documento, revisor, revisión de origen y metadatos del PDF). La visibilidad la decide la base (RLS) según la identidad de la transacción.
export const REVISION_SELECT = `
  SELECT r.revision_id::text, r.public_id::text, d.public_id::text AS documento_public_id, d.creado_por_usuario_id::text AS documento_creado_por, d.codigo_dcmx, d.variante,
         r.revision, r.revision_prevista, r.estado, r.version, r.familia, r.especificacion, r.especificacion_sha256,
         r.elaboro_nombre, r.elaboro_confirmado, r.autorizo_nombre,
         r.revisor_usuario_id::text, rv.display_name AS revisor_nombre,
         r.cliente_empresa_id::text, r.cliente_nombre, r.cliente_verificado, r.entorno_emision,
         r.basada_en_revision_id::text, b.revision AS basada_en_revision,
         r.creado_por_usuario_id::text, r.creado_por_email, cu.display_name AS creado_por_nombre, ${iso('r.created_at')} AS created_at, r.actualizado_por_email, ${iso('r.updated_at')} AS updated_at,
         r.finalizando_token::text, ${iso('r.finalizando_desde')} AS finalizando_desde, r.finalizando_por_usuario_id::text,
         r.finalizado_por_email, ${iso('r.finalizado_en')} AS finalizado_en,
         p.pdf_sha256, p.bytes AS pdf_bytes, p.nombre_archivo AS pdf_nombre
    FROM manufactura.revisiones r
    JOIN manufactura.documentos d ON d.documento_id = r.documento_id
    LEFT JOIN security.users rv ON rv.user_id = r.revisor_usuario_id
    LEFT JOIN security.users cu ON cu.user_id = r.creado_por_usuario_id
    LEFT JOIN manufactura.revisiones b ON b.revision_id = r.basada_en_revision_id
    LEFT JOIN manufactura.pdfs p ON p.revision_id = r.revision_id`;

export interface CambiosBorrador {
  familia: string;
  especificacion: EspecificacionDocumento;
  elaboroNombre: string | null;
  elaboroConfirmado: boolean;
  autorizoNombre: string | null;
  clienteEmpresaId: string | null;
  clienteNombre: string | null;
  clienteVerificado: boolean;
  revisorUsuarioId: string | null;
}

export interface InicioFinalizacion {
  revision_id: string;
  revision_prevista: number;
  finalizando_token: string;
  fecha: string;
}

export interface PdfAGuardar {
  revisionId: string;
  token: string;
  version: number;
  nombreArchivo: string;
  sha256: string;
  contenido: Buffer;
  especificacionSha256: string;
}

export interface PdfGuardado {
  nombre_archivo: string;
  pdf_sha256: string;
  bytes: number;
  contenido: Buffer;
}

/**
 * Acceso a `manufactura.*`. Toda operación ocurre en una transacción cuya IDENTIDAD (`app.user_id`, `app.user_email`, `app.request_id`) la fija este repositorio desde el `ActorDocumental`
 * construido por el backend a partir de la sesión autenticada. La base toma el actor de ahí (ignora columnas enviadas) y aplica la visibilidad por filas (RLS).
 * No importa nada de la generación de hojas.
 */
@Injectable()
export class DocumentsRepository {
  constructor(private readonly database: DatabaseService) {}

  async conSesion<T>(actor: ActorDocumental, trabajo: (cliente: PoolClient) => Promise<T>): Promise<T> {
    const cliente = await this.database.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query("SELECT set_config('app.origin', $1, true), set_config('app.request_id', $2, true), set_config('app.user_id', $3, true), set_config('app.user_email', $4, true)",
        ['DAUBERT_HUB', actor.requestId, actor.userId, actor.email]);
      const resultado = await trabajo(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      try { await cliente.query('ROLLBACK'); } catch { /* se conserva el error original */ }
      throw error;
    } finally {
      cliente.release();
    }
  }

  async buscarDocumento(c: PoolClient, codigo: string, variante: string | null): Promise<{ documento_id: string; public_id: string } | null> {
    const r = await c.query<{ documento_id: string; public_id: string }>(
      "SELECT documento_id::text, public_id::text FROM manufactura.documentos WHERE codigo_clave = lower($1) AND variante_clave = lower(coalesce($2::text, ''))", [codigo, variante]);
    return r.rows[0] ?? null;
  }

  /** Documento propio (o de cualquiera si es ADMIN) cuyas revisiones fueron TODAS descartadas: puede abrirse un borrador nuevo en él sin duplicar el documento. */
  async documentoReanudable(c: PoolClient, codigo: string, variante: string | null): Promise<{ documento_id: string } | null> {
    const r = await c.query<{ documento_id: string }>(
      `SELECT d.documento_id::text FROM manufactura.documentos d
        WHERE d.codigo_clave = lower($1) AND d.variante_clave = lower(coalesce($2::text, ''))
          AND (d.creado_por_usuario_id = manufactura.fn_actor_id() OR manufactura.fn_actor_es_admin())
          AND NOT EXISTS (SELECT 1 FROM manufactura.revisiones r WHERE r.documento_id = d.documento_id AND r.estado <> 'DESCARTADA')`, [codigo, variante]);
    return r.rows[0] ?? null;
  }

  async crearDocumento(c: PoolClient, codigo: string, variante: string | null): Promise<{ documento_id: string; public_id: string }> {
    const r = await c.query<{ documento_id: string; public_id: string }>(
      'INSERT INTO manufactura.documentos (codigo_dcmx, variante) VALUES ($1, $2) RETURNING documento_id::text, public_id::text', [codigo, variante]);
    return r.rows[0] as { documento_id: string; public_id: string };
  }

  /** Inserta un BORRADOR. Actor, huella, versión y fechas las fija la base (triggers); lo que se envíe en esas columnas se ignora. */
  async crearBorrador(c: PoolClient, documentoId: string, datos: CambiosBorrador, basadaEnRevisionId: string | null = null): Promise<string> {
    const r = await c.query<{ public_id: string }>(
      `INSERT INTO manufactura.revisiones (documento_id, familia, especificacion, elaboro_nombre, elaboro_confirmado, autorizo_nombre, cliente_empresa_id, cliente_nombre, cliente_verificado, revisor_usuario_id, basada_en_revision_id)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING public_id::text`,
      [documentoId, datos.familia, JSON.stringify(datos.especificacion), datos.elaboroNombre, datos.elaboroConfirmado, datos.autorizoNombre, datos.clienteEmpresaId, datos.clienteNombre, datos.clienteVerificado, datos.revisorUsuarioId, basadaEnRevisionId]);
    return (r.rows[0] as { public_id: string }).public_id;
  }

  async obtenerRevision(c: PoolClient, publicId: string, paraActualizar = false): Promise<RevisionRow | null> {
    const r = await c.query<RevisionRow>(`${REVISION_SELECT} WHERE r.public_id = $1${paraActualizar ? ' FOR UPDATE OF r' : ''}`, [publicId]);
    return r.rows[0] ?? null;
  }

  /**
   * Borradores y finalizaciones en curso, SEPARADOS en el servidor para que no haya duplicados entre «Mis borradores» y «Borradores del equipo»:
   * `propios` = creados por la sesión; `equipo` = de otras cuentas (consultables en solo lectura; la RLS de la migración 105 es quien los deja ver; sin ella la base solo entrega los asignados como revisor o, a un ADMIN, todos).
   */
  async listarAbiertas(c: PoolClient, ambito: 'propios' | 'equipo' = 'propios', codigo?: string): Promise<RevisionRow[]> {
    const filtroAmbito = ambito === 'propios' ? 'r.creado_por_usuario_id = manufactura.fn_actor_id()' : 'r.creado_por_usuario_id <> manufactura.fn_actor_id()';
    const r = await c.query<RevisionRow>(
      `${REVISION_SELECT} WHERE r.estado IN ('BORRADOR', 'FINALIZANDO') AND ${filtroAmbito} AND ($1::text IS NULL OR d.codigo_clave = lower($1::text)) ORDER BY r.updated_at DESC, r.revision_id DESC LIMIT 100`, [codigo ?? null]);
    return r.rows;
  }

  async revisionAbiertaDelDocumento(c: PoolClient, documentoPublicId: string): Promise<RevisionRow | null> {
    const r = await c.query<RevisionRow>(`${REVISION_SELECT} WHERE d.public_id = $1 AND r.estado IN ('BORRADOR', 'FINALIZANDO')`, [documentoPublicId]);
    return r.rows[0] ?? null;
  }

  async historialPorCodigo(c: PoolClient, codigo: string): Promise<RevisionRow[]> {
    const r = await c.query<RevisionRow>(
      `${REVISION_SELECT} WHERE d.codigo_clave = lower($1) AND (r.estado = 'FINALIZADA' OR (r.estado IN ('BORRADOR', 'FINALIZANDO') AND r.creado_por_usuario_id = manufactura.fn_actor_id())) ORDER BY d.variante_clave, r.revision DESC NULLS FIRST, r.revision_id DESC LIMIT 300`, [codigo]);
    return r.rows;
  }

  /** Última versión FINALIZADA de un documento (base de una nueva revisión). */
  async ultimaFinalizada(c: PoolClient, documentoPublicId: string): Promise<RevisionRow | null> {
    const r = await c.query<RevisionRow>(`${REVISION_SELECT} WHERE d.public_id = $1 AND r.estado = 'FINALIZADA' ORDER BY r.revision DESC LIMIT 1`, [documentoPublicId]);
    return r.rows[0] ?? null;
  }

  /** Edición con bloqueo optimista: 0 filas = no existe / no es visible / ya no es borrador / la versión cambió (el servicio lo distingue). El trigger incrementa y valida. */
  async actualizarBorrador(c: PoolClient, publicId: string, versionEsperada: number, datos: CambiosBorrador): Promise<boolean> {
    const r = await c.query(
      `UPDATE manufactura.revisiones SET familia = $3, especificacion = $4::jsonb, elaboro_nombre = $5, elaboro_confirmado = $6, autorizo_nombre = $7,
              cliente_empresa_id = $8, cliente_nombre = $9, cliente_verificado = $10, revisor_usuario_id = $11, version = version + 1
        WHERE public_id = $1 AND version = $2 AND estado = 'BORRADOR'`,
      [publicId, versionEsperada, datos.familia, JSON.stringify(datos.especificacion), datos.elaboroNombre, datos.elaboroConfirmado, datos.autorizoNombre, datos.clienteEmpresaId, datos.clienteNombre, datos.clienteVerificado, datos.revisorUsuarioId]);
    return r.rowCount === 1;
  }

  async descartarBorrador(c: PoolClient, publicId: string, versionEsperada: number): Promise<boolean> {
    const r = await c.query("UPDATE manufactura.revisiones SET estado = 'DESCARTADA' WHERE public_id = $1 AND version = $2 AND estado = 'BORRADOR'", [publicId, versionEsperada]);
    return r.rowCount === 1;
  }

  async buscarCliente(c: PoolClient, empresaId: string): Promise<{ id: string; nombre: string } | null> {
    const r = await c.query<{ id: string; nombre: string }>(
      `SELECT e.empresa_id::text AS id, e.nombre_comercial AS nombre FROM core.empresas e
        WHERE e.empresa_id = $1 AND e.estatus = 'ACTIVO'
          AND EXISTS (SELECT 1 FROM core.empresa_roles r WHERE r.empresa_id = e.empresa_id AND r.rol = 'CLIENTE' AND r.estatus = 'ACTIVO')`, [empresaId]);
    return r.rows[0] ?? null;
  }

  async usuariosRevisores(c: PoolClient): Promise<UsuarioRevisorRow[]> {
    const r = await c.query<UsuarioRevisorRow>("SELECT user_id::text AS id, display_name AS \"displayName\" FROM security.users WHERE status = 'ACTIVE' ORDER BY display_name, user_id");
    return r.rows;
  }

  /** Registra la revisión del usuario de la sesión sobre EXACTAMENTE la versión indicada. Usuario, nombre, versión y huella los fija la base. Devuelve false si ya existía (idempotente). */
  async registrarConfirmacion(c: PoolClient, publicId: string, versionEsperada: number): Promise<boolean> {
    const r = await c.query(
      `INSERT INTO manufactura.confirmaciones_revision (revision_id)
       SELECT revision_id FROM manufactura.revisiones WHERE public_id = $1 AND version = $2 AND estado = 'BORRADOR'
       ON CONFLICT (revision_id, usuario_id, especificacion_sha256) DO NOTHING`, [publicId, versionEsperada]);
    return r.rowCount === 1;
  }

  async confirmaciones(c: PoolClient, publicId: string): Promise<ConfirmacionRow[]> {
    const r = await c.query<ConfirmacionRow>(
      `SELECT k.confirmacion_id::text, k.usuario_id::text, k.usuario_email, k.usuario_nombre, k.version, k.especificacion_sha256, k.es_autorrevision, k.como_revisor_asignado,
              ${iso('k.created_at')} AS created_at, (k.especificacion_sha256 = r.especificacion_sha256) AS vigente
         FROM manufactura.confirmaciones_revision k JOIN manufactura.revisiones r ON r.revision_id = k.revision_id
        WHERE r.public_id = $1 ORDER BY k.confirmacion_id`, [publicId]);
    return r.rows;
  }

  // ------------------------------------------------------------------ finalización (protocolo A / render / B)
  /** Transacción A: BORRADOR → FINALIZANDO (la base genera el token, reserva la revisión y congela el contenido). 0 filas = otra finalización ganó o la versión cambió. */
  async iniciarFinalizacion(c: PoolClient, publicId: string, versionEsperada: number): Promise<InicioFinalizacion | null> {
    const r = await c.query<InicioFinalizacion>(
      `UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE public_id = $1 AND version = $2 AND estado = 'BORRADOR'
       RETURNING revision_id::text, revision_prevista, finalizando_token::text, to_char(finalizando_desde AT TIME ZONE '${ZONA_DOCUMENTAL}', 'YYYY-MM-DD') AS fecha`, [publicId, versionEsperada]);
    return r.rows[0] ?? null;
  }

  /** Reclama una finalización abandonada: la base solo lo permite pasados 10 minutos (55P03 si no) y emite un token nuevo, con lo que el proceso original deja de poder finalizar. */
  async reclamarFinalizacion(c: PoolClient, publicId: string, versionEsperada: number): Promise<InicioFinalizacion | null> {
    const r = await c.query<InicioFinalizacion>(
      `UPDATE manufactura.revisiones SET estado = 'FINALIZANDO' WHERE public_id = $1 AND version = $2 AND estado = 'FINALIZANDO'
       RETURNING revision_id::text, revision_prevista, finalizando_token::text, to_char(finalizando_desde AT TIME ZONE '${ZONA_DOCUMENTAL}', 'YYYY-MM-DD') AS fecha`, [publicId, versionEsperada]);
    return r.rows[0] ?? null;
  }

  /** Transacción B: PDF + contenido + FINALIZANDO → FINALIZADA, con token y versión como predicados. La base verifica hash, tamaño, nombre y revisión. Devuelve false si el token ya no es el vigente. */
  async completarFinalizacion(c: PoolClient, pdf: PdfAGuardar): Promise<boolean> {
    await c.query(
      'INSERT INTO manufactura.pdfs (revision_id, pdf_sha256, bytes, especificacion_sha256, nombre_archivo) VALUES ($1, $2, $3, $4, $5)',
      [pdf.revisionId, pdf.sha256, pdf.contenido.length, pdf.especificacionSha256, pdf.nombreArchivo]);
    await c.query('INSERT INTO manufactura.pdf_contenidos (revision_id, contenido) VALUES ($1, $2)', [pdf.revisionId, pdf.contenido]);
    const r = await c.query(
      "UPDATE manufactura.revisiones SET estado = 'FINALIZADA' WHERE revision_id = $1 AND estado = 'FINALIZANDO' AND finalizando_token = $2::uuid AND version = $3",
      [pdf.revisionId, pdf.token, pdf.version]);
    return r.rowCount === 1;
  }

  /** Falla del render: FINALIZANDO → BORRADOR solo si el token sigue siendo el nuestro (si alguien la reclamó, no se toca). */
  async revertirFinalizacion(c: PoolClient, revisionId: string, token: string): Promise<boolean> {
    const r = await c.query("UPDATE manufactura.revisiones SET estado = 'BORRADOR' WHERE revision_id = $1 AND estado = 'FINALIZANDO' AND finalizando_token = $2::uuid", [revisionId, token]);
    return r.rowCount === 1;
  }

  /** Cancelación por el creador/ADMIN de una finalización (idempotente: 0 filas si ya no está finalizando). */
  async cancelarFinalizacion(c: PoolClient, publicId: string, versionEsperada: number): Promise<boolean> {
    const r = await c.query("UPDATE manufactura.revisiones SET estado = 'BORRADOR' WHERE public_id = $1 AND version = $2 AND estado = 'FINALIZANDO'", [publicId, versionEsperada]);
    return r.rowCount === 1;
  }

  async obtenerPdf(c: PoolClient, publicId: string): Promise<PdfGuardado | null> {
    const r = await c.query<PdfGuardado>(
      `SELECT p.nombre_archivo, p.pdf_sha256, p.bytes, k.contenido
         FROM manufactura.revisiones r JOIN manufactura.pdfs p ON p.revision_id = r.revision_id JOIN manufactura.pdf_contenidos k ON k.revision_id = r.revision_id
        WHERE r.public_id = $1 AND r.estado = 'FINALIZADA'`, [publicId]);
    return r.rows[0] ?? null;
  }
}

export type { EstadoRevision };
