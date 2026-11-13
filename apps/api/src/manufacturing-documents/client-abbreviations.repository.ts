import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

// Acceso a `manufactura.cliente_abreviaturas` y `fn_sugerir_cliente` (migración 104). Solo SQL: la identidad y la transacción las pone `DocumentsRepository.conSesion`; la base decide qué ve
// cada cuenta (RLS) y qué transiciones son válidas (triggers). La migración puede no estar aplicada: `disponible` lo comprueba sin fallar.

export interface FilaSugerencia {
  nivel: number; nivel_nombre: string; public_id: string; abreviatura: string; alcance: string; codigo_patron: string | null; estado: string;
  cliente_empresa_id: string; cliente_nombre: string; documentos_evidencia: number; codigos_evidencia: number; decisivo: boolean; requiere_eleccion: boolean;
}
export interface AbreviaturaVista {
  id: string; abreviatura: string; alcance: string; codigoPatron: string | null; estado: string; origen: string; clienteId: string; cliente: string;
  documentos: number; codigos: number; evidencia: string | null; fuente: string | null; propuestaPor: string; resueltaPor: string | null; resueltaEn: string | null;
  motivo: string | null; creadaEn: string; actualizadaEn: string;
}
interface FilaLista {
  id: string; abreviatura: string; alcance: string; codigo_patron: string | null; estado: string; origen: string; cliente_id: string; cliente: string; documentos: number; codigos: number;
  evidencia: string | null; fuente: string | null; propuesta_por: string; resuelta_por: string | null; resuelta_en: string | null; motivo: string | null; creada_en: string; actualizada_en: string;
}

const SELECT_VISTA = `SELECT a.public_id::text AS id, a.abreviatura, a.alcance, a.codigo_patron, a.estado, a.origen, a.cliente_empresa_id::text AS cliente_id, e.nombre_comercial AS cliente,
       a.documentos_evidencia AS documentos, a.codigos_evidencia AS codigos, a.evidencia, a.fuente, a.propuesta_por_email AS propuesta_por, a.resuelta_por_email AS resuelta_por,
       to_json(a.resuelta_en) #>> '{}' AS resuelta_en, a.motivo_resolucion AS motivo, to_json(a.created_at) #>> '{}' AS creada_en, to_json(a.updated_at) #>> '{}' AS actualizada_en
  FROM manufactura.cliente_abreviaturas a JOIN core.empresas e ON e.empresa_id = a.cliente_empresa_id`;
const vista = (f: FilaLista): AbreviaturaVista => ({
  id: f.id, abreviatura: f.abreviatura, alcance: f.alcance, codigoPatron: f.codigo_patron, estado: f.estado, origen: f.origen, clienteId: f.cliente_id, cliente: f.cliente,
  documentos: f.documentos, codigos: f.codigos, evidencia: f.evidencia, fuente: f.fuente, propuestaPor: f.propuesta_por, resueltaPor: f.resuelta_por, resueltaEn: f.resuelta_en,
  motivo: f.motivo, creadaEn: f.creada_en, actualizadaEn: f.actualizada_en
});

@Injectable()
export class ClientAbbreviationsRepository {
  /** La migración 104 puede no estar aplicada todavía: sin ella no hay catálogo (el formulario sigue funcionando). */
  async disponible(c: PoolClient): Promise<boolean> {
    const r = await c.query<{ ok: boolean }>("SELECT (to_regclass('manufactura.cliente_abreviaturas') IS NOT NULL AND to_regprocedure('manufactura.fn_sugerir_cliente(text, boolean)') IS NOT NULL) AS ok");
    return r.rows[0]?.ok === true;
  }

  sugerir(c: PoolClient, codigo: string): Promise<FilaSugerencia[]> {
    return c.query<FilaSugerencia>('SELECT * FROM manufactura.fn_sugerir_cliente($1, true)', [codigo]).then((r) => r.rows);
  }

  async crear(c: PoolClient, d: { abreviatura: string; clienteId: string; alcance: string; codigoPatron: string | null; estado: 'PROPUESTA' | 'CONFIRMADA'; origen: 'MANUAL_ADMIN' | 'PROPUESTA_USUARIO'; evidencia: string | null }): Promise<AbreviaturaVista> {
    const r = await c.query<{ public_id: string }>(
      `INSERT INTO manufactura.cliente_abreviaturas (abreviatura, cliente_empresa_id, alcance, codigo_patron, estado, origen, evidencia, propuesta_por_usuario_id, propuesta_por_email)
       VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, manufactura.fn_actor_id(), 'sesion') RETURNING public_id::text`, [d.abreviatura, d.clienteId, d.alcance, d.codigoPatron, d.estado, d.origen, d.evidencia]);
    return (await this.obtener(c, (r.rows[0] as { public_id: string }).public_id)) as AbreviaturaVista;
  }

  async obtener(c: PoolClient, publicId: string): Promise<AbreviaturaVista | null> {
    const r = await c.query<FilaLista>(`${SELECT_VISTA} WHERE a.public_id = $1::uuid`, [publicId]);
    return r.rows[0] ? vista(r.rows[0]) : null;
  }

  async listar(c: PoolClient, estado: string | undefined, q: string | undefined, clienteId?: string): Promise<AbreviaturaVista[]> {
    const r = await c.query<FilaLista>(
      `${SELECT_VISTA} WHERE ($1::text IS NULL OR a.estado = $1) AND ($2::text IS NULL OR a.abreviatura ILIKE $2 || '%' OR e.nombre_comercial ILIKE '%' || $2 || '%') AND ($3::bigint IS NULL OR a.cliente_empresa_id = $3::bigint)
        ORDER BY (a.estado = 'PROPUESTA') DESC, a.created_at DESC, a.abreviatura_id DESC LIMIT 300`, [estado ?? null, q ?? null, clienteId ?? null]);
    return r.rows.map(vista);
  }

  async cambiarEstado(c: PoolClient, publicId: string, estado: string, motivo: string | null): Promise<AbreviaturaVista | null> {
    const r = await c.query<{ public_id: string }>('UPDATE manufactura.cliente_abreviaturas SET estado = $2, motivo_resolucion = $3 WHERE public_id = $1::uuid RETURNING public_id::text', [publicId, estado, motivo]);
    return r.rows[0] ? this.obtener(c, r.rows[0].public_id) : null;
  }

  async contarPorEstado(c: PoolClient): Promise<Record<string, number>> {
    const r = await c.query<{ estado: string; n: string }>('SELECT estado, count(*)::text AS n FROM manufactura.cliente_abreviaturas GROUP BY estado');
    return Object.fromEntries(r.rows.map((x) => [x.estado, Number(x.n)]));
  }
}
