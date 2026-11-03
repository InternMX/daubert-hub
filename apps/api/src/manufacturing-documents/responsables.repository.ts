import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { FuncionResponsable } from './documents.dto';
import type { FirmaProcesada } from './signature-image';

// Acceso a `manufactura.firmas`, `firma_autorizaciones` y `revision_responsables` (migración 102). Solo SQL: la identidad y la transacción las pone `DocumentsRepository.conSesion`.
// La base decide qué puede ver y usar cada cuenta (RLS + funciones); aquí nunca se filtra por un usuario recibido del cliente.

export interface FirmaVista { id: string; propietario: string; propia: boolean; ancho: number; alto: number; miniatura: string; creadaEn: string }
export interface ResponsableFila {
  posicion: number; funcion: FuncionResponsable; nombre: string; con_firma: boolean;
  firma_id: string | null; firma_propietario: string | null; firma_mime: string | null; firma_b64: string | null; firma_sha256: string | null;
}
export interface ResponsablePdf { posicion: number; funcion: FuncionResponsable; nombre: string; firma: { tipoMime: string; contenido: Buffer; sha256: string } | null }
export interface ResponsableAGuardar { posicion: number; funcion: FuncionResponsable; nombre: string; firmaInternaId: string | null }
export interface FirmaResuelta { id: string; internoId: string; propietario: string; permitido: boolean }

@Injectable()
export class ResponsablesRepository {
  /** La migración 102 puede no estar aplicada todavía: sin ella solo existe «Generó» (campo documental `Elaboró`) y no hay catálogo de firmas. */
  async disponible(c: PoolClient): Promise<boolean> {
    const r = await c.query<{ ok: boolean }>("SELECT (to_regclass('manufactura.revision_responsables') IS NOT NULL AND to_regclass('manufactura.firmas') IS NOT NULL) AS ok");
    return r.rows[0]?.ok === true;
  }

  async insertarFirma(c: PoolClient, propietarioUsuarioId: string | null, propietarioNombre: string, f: FirmaProcesada): Promise<string> {
    const r = await c.query<{ public_id: string }>(
      `INSERT INTO manufactura.firmas (propietario_usuario_id, propietario_nombre, subida_por_usuario_id, subida_por_email, incorporada_por_usuario_id, incorporada_por_email, tipo_mime, ancho, alto, bytes, sha256, contenido)
       VALUES ($1, $2, manufactura.fn_actor_id(), 'sesion', manufactura.fn_actor_id(), 'sesion', $3, $4, $5, $6, $7, $8) RETURNING public_id::text`,
      [propietarioUsuarioId, propietarioNombre, f.tipoMime, f.ancho, f.alto, f.bytes, f.sha256, f.contenido]);
    return (r.rows[0] as { public_id: string }).public_id;
  }

  /** Firmas que esta cuenta puede USAR (propias o con autorización vigente, ACTIVAS). Nunca el catálogo completo de la empresa. */
  async listarUtilizables(c: PoolClient, usuarioId: string): Promise<FirmaVista[]> {
    const r = await c.query<{ id: string; propietario: string; propia: boolean; ancho: number; alto: number; tipo_mime: string; b64: string; creada_en: string }>(
      `SELECT f.public_id::text AS id, f.propietario_nombre AS propietario, COALESCE(f.propietario_usuario_id = $1::bigint, false) AS propia, f.ancho, f.alto, f.tipo_mime,
              encode(f.contenido, 'base64') AS b64, to_json(f.created_at) #>> '{}' AS creada_en
         FROM manufactura.firmas f
        WHERE manufactura.fn_firma_utilizable(f.firma_id, $1::bigint)
        ORDER BY (f.propietario_usuario_id = $1::bigint) DESC, f.propietario_nombre, f.firma_id LIMIT 60`, [usuarioId]);
    return r.rows.map((x) => ({ id: x.id, propietario: x.propietario, propia: x.propia, ancho: x.ancho, alto: x.alto, miniatura: `data:${x.tipo_mime};base64,${x.b64.replace(/\s+/g, '')}`, creadaEn: x.creada_en }));
  }

  /** Resuelve identificadores públicos a internos. `permitido` = utilizable por esta cuenta o ya asignada a esta revisión (se conserva aunque después se retire o se revoque). */
  async resolverFirmas(c: PoolClient, publicIds: string[], revisionId: string): Promise<Map<string, FirmaResuelta>> {
    if (publicIds.length === 0) return new Map();
    const r = await c.query<{ id: string; interno: string; propietario: string; permitido: boolean }>(
      `SELECT f.public_id::text AS id, f.firma_id::text AS interno, f.propietario_nombre AS propietario,
              (manufactura.fn_firma_utilizable(f.firma_id, manufactura.fn_actor_id())
               OR EXISTS (SELECT 1 FROM manufactura.revision_responsables rr WHERE rr.revision_id = $2::bigint AND rr.firma_id = f.firma_id)) AS permitido
         FROM manufactura.firmas f WHERE f.public_id = ANY($1::uuid[])`, [publicIds, revisionId]);
    return new Map(r.rows.map((x) => [x.id, { id: x.id, internoId: x.interno, propietario: x.propietario, permitido: x.permitido }]));
  }

  /** Sustituye los responsables de un BORRADOR: inserta, actualiza solo lo que cambió y quita los que sobran. La base valida firma, nombre y estado. */
  async guardarResponsables(c: PoolClient, revisionId: string, items: ResponsableAGuardar[]): Promise<void> {
    const actuales = await c.query<{ posicion: number; funcion: string; nombre: string; firma_id: string | null }>(
      'SELECT posicion, funcion, nombre, firma_id::text FROM manufactura.revision_responsables WHERE revision_id = $1::bigint', [revisionId]);
    const porPosicion = new Map(actuales.rows.map((x) => [x.posicion, x]));
    const posiciones = items.map((i) => i.posicion);
    await c.query('DELETE FROM manufactura.revision_responsables WHERE revision_id = $1::bigint AND NOT (posicion = ANY($2::int[]))', [revisionId, posiciones]);
    for (const i of items) {
      const previo = porPosicion.get(i.posicion);
      if (!previo) {
        await c.query('INSERT INTO manufactura.revision_responsables (revision_id, posicion, funcion, nombre, firma_id) VALUES ($1::bigint, $2, $3, $4, $5::bigint)', [revisionId, i.posicion, i.funcion, i.nombre, i.firmaInternaId]);
      } else if (previo.funcion !== i.funcion || previo.nombre !== i.nombre || (previo.firma_id ?? null) !== (i.firmaInternaId ?? null)) {
        await c.query('UPDATE manufactura.revision_responsables SET funcion = $3, nombre = $4, firma_id = $5::bigint WHERE revision_id = $1::bigint AND posicion = $2', [revisionId, i.posicion, i.funcion, i.nombre, i.firmaInternaId]);
      }
    }
  }

  async responsablesDe(c: PoolClient, revisionPublicId: string): Promise<ResponsableFila[]> {
    const r = await c.query<ResponsableFila>(
      `SELECT rr.posicion::int, rr.funcion, rr.nombre, (rr.firma_id IS NOT NULL) AS con_firma, f.public_id::text AS firma_id, f.propietario_nombre AS firma_propietario,
              f.tipo_mime AS firma_mime, encode(f.contenido, 'base64') AS firma_b64, rr.firma_sha256
         FROM manufactura.revision_responsables rr JOIN manufactura.revisiones r ON r.revision_id = rr.revision_id LEFT JOIN manufactura.firmas f ON f.firma_id = rr.firma_id
        WHERE r.public_id = $1 ORDER BY rr.posicion`, [revisionPublicId]);
    return r.rows;
  }

  /** Responsables con el CONTENIDO de la imagen para componer el PDF. Si una imagen asignada ya no es legible para esta cuenta, devuelve `faltantes` > 0 (no se finaliza con una firma que no se pueda imprimir). */
  async responsablesParaPdf(c: PoolClient, revisionId: string): Promise<{ responsables: ResponsablePdf[]; faltantes: number }> {
    const r = await c.query<{ posicion: number; funcion: FuncionResponsable; nombre: string; con_firma: boolean; tipo_mime: string | null; contenido: Buffer | null; firma_sha256: string | null }>(
      `SELECT rr.posicion::int, rr.funcion, rr.nombre, (rr.firma_id IS NOT NULL) AS con_firma, f.tipo_mime, f.contenido, rr.firma_sha256
         FROM manufactura.revision_responsables rr LEFT JOIN manufactura.firmas f ON f.firma_id = rr.firma_id WHERE rr.revision_id = $1::bigint ORDER BY rr.posicion`, [revisionId]);
    let faltantes = 0;
    const responsables = r.rows.map((x): ResponsablePdf => {
      if (x.con_firma && (!x.contenido || !x.tipo_mime)) faltantes += 1;
      return { posicion: x.posicion, funcion: x.funcion, nombre: x.nombre, firma: x.con_firma && x.contenido && x.tipo_mime ? { tipoMime: x.tipo_mime, contenido: x.contenido, sha256: x.firma_sha256 ?? '' } : null };
    });
    return { responsables, faltantes };
  }

  /** Nueva revisión: se recuperan funciones y nombres como referencia editable; las imágenes NO se heredan. */
  async copiarNombres(c: PoolClient, deRevisionId: string, aRevisionPublicId: string): Promise<void> {
    await c.query(
      `INSERT INTO manufactura.revision_responsables (revision_id, posicion, funcion, nombre, firma_id)
       SELECT n.revision_id, rr.posicion, rr.funcion, rr.nombre, NULL FROM manufactura.revision_responsables rr, manufactura.revisiones n
        WHERE rr.revision_id = $1::bigint AND n.public_id = $2`, [deRevisionId, aRevisionPublicId]);
  }

  /** 'sin_acceso' = la firma no existe o esta cuenta ni siquiera la ve (la base no revela cuál de las dos). */
  async autorizar(c: PoolClient, firmaPublicId: string, usuarioId: string): Promise<'creada' | 'ya_autorizada' | 'sin_acceso'> {
    const visible = await c.query('SELECT 1 FROM manufactura.firmas WHERE public_id = $1::uuid', [firmaPublicId]);
    if (visible.rowCount === 0) return 'sin_acceso';
    const r = await c.query(
      `INSERT INTO manufactura.firma_autorizaciones (firma_id, usuario_id) SELECT f.firma_id, $2::bigint FROM manufactura.firmas f WHERE f.public_id = $1::uuid
       ON CONFLICT DO NOTHING`, [firmaPublicId, usuarioId]);
    return (r.rowCount ?? 0) > 0 ? 'creada' : 'ya_autorizada';
  }

  async revocar(c: PoolClient, firmaPublicId: string, usuarioId: string): Promise<number> {
    const r = await c.query(
      `UPDATE manufactura.firma_autorizaciones a SET revocada_en = now() FROM manufactura.firmas f WHERE f.firma_id = a.firma_id AND f.public_id = $1::uuid AND a.usuario_id = $2::bigint AND a.revocada_en IS NULL`, [firmaPublicId, usuarioId]);
    return r.rowCount ?? 0;
  }

  async retirar(c: PoolClient, firmaPublicId: string): Promise<number> {
    const r = await c.query("UPDATE manufactura.firmas SET estado = 'RETIRADA' WHERE public_id = $1::uuid AND estado = 'ACTIVA'", [firmaPublicId]);
    return r.rowCount ?? 0;
  }

  async nombreDeUsuarioActivo(c: PoolClient, usuarioId: string): Promise<string | null> {
    const r = await c.query<{ n: string }>("SELECT display_name AS n FROM security.users WHERE user_id = $1::bigint AND status = 'ACTIVE'", [usuarioId]);
    return r.rows[0]?.n ?? null;
  }
}
