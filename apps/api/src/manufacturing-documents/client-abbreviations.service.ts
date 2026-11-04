import { ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { Accion, CreateAbbreviationDto } from './client-abbreviations.dto';
import { ClientAbbreviationsRepository, type AbreviaturaVista, type FilaSugerencia } from './client-abbreviations.repository';
import { DocumentsRepository } from './documents.repository';
import type { ActorDocumental } from './documents.types';

const http = (status: HttpStatus, code: string, message: string): HttpException => new HttpException({ code, message }, status);

/** Un cliente candidato para el código: agrupa las abreviaturas que lo respaldan en ese nivel. */
export interface AlternativaCliente {
  clienteId: string; cliente: string; nivel: number; nivelNombre: string; confirmada: boolean;
  respaldo: Array<{ id: string; abreviatura: string; alcance: string; codigoPatron: string | null; estado: string; documentos: number; codigos: number }>;
}
/**
 * Estados de la respuesta (la interfaz los distingue):
 *  · NO_HABILITADO     — la migración 104 no está aplicada: no hay catálogo (no es «sin sugerencias»).
 *  · SIN_SUGERENCIAS   — hay catálogo pero ninguna abreviatura confirmada coincide: el usuario elige o escribe el cliente.
 *  · EXACTA            — una sola coincidencia confirmada en el nivel que decide; el usuario debe CONFIRMARLA (nunca se asigna sola).
 *  · ELEGIR            — varios clientes en el nivel que decide (ambigüedad o contradicción): se muestran todas las alternativas.
 */
export type EstadoSugerencia = 'NO_HABILITADO' | 'SIN_SUGERENCIAS' | 'EXACTA' | 'ELEGIR';
export interface Sugerencias { disponible: boolean; puedeResolver: boolean; estado: EstadoSugerencia; codigo: string; alternativas: AlternativaCliente[]; relacionadas: AlternativaCliente[]; sinConfirmar: AlternativaCliente[] }

function agrupar(filas: FilaSugerencia[]): AlternativaCliente[] {
  const mapa = new Map<string, AlternativaCliente>();
  for (const f of filas) {
    const prev = mapa.get(f.cliente_empresa_id);
    const respaldo = { id: f.public_id, abreviatura: f.abreviatura, alcance: f.alcance, codigoPatron: f.codigo_patron, estado: f.estado, documentos: f.documentos_evidencia, codigos: f.codigos_evidencia };
    if (prev) { prev.respaldo.push(respaldo); prev.nivel = Math.min(prev.nivel, f.nivel); continue; }
    mapa.set(f.cliente_empresa_id, { clienteId: f.cliente_empresa_id, cliente: f.cliente_nombre, nivel: f.nivel, nivelNombre: f.nivel_nombre, confirmada: f.nivel < 9, respaldo: [respaldo] });
  }
  return [...mapa.values()].sort((a, b) => a.nivel - b.nivel || a.cliente.localeCompare(b.cliente, 'es'));
}

function traducir(error: unknown): unknown {
  const e = error as { code?: string; message?: string; constraint?: string };
  switch (e.code) {
    case '23505': return http(HttpStatus.CONFLICT, 'ABREVIATURA_DUPLICADA', 'Esa abreviatura ya está registrada para ese cliente con el mismo alcance.');
    case '23514': return http(HttpStatus.UNPROCESSABLE_ENTITY, 'ABREVIATURA_INVALIDA', e.constraint?.endsWith('motivo') ? 'Indica el motivo del rechazo.' : 'La abreviatura o su patrón no cumplen el formato (2–5 caracteres; el contexto y el código completo empiezan con la abreviatura).');
    case '23503': return http(HttpStatus.UNPROCESSABLE_ENTITY, 'CLIENTE_INVALIDO', 'El cliente indicado no existe.');
    case '23000': return http(HttpStatus.UNPROCESSABLE_ENTITY, /Transición/.test(e.message ?? '') ? 'TRANSICION_NO_PERMITIDA' : 'CLIENTE_INVALIDO', e.message && e.message.length < 220 ? e.message : 'La operación no cumple las reglas del catálogo.');
    case '42501': return new ForbiddenException({ code: 'FORBIDDEN', message: 'No tienes permiso para esta operación.' });
    default: return error;
  }
}

@Injectable()
export class ClientAbbreviationsService {
  constructor(private readonly repo: DocumentsRepository, private readonly abrev: ClientAbbreviationsRepository) {}

  /** ¿Está habilitado el catálogo en este entorno? (migración 104). */
  estado(actor: ActorDocumental): Promise<{ disponible: boolean; puedeResolver: boolean }> {
    return this.repo.conSesion(actor, async (c) => ({ disponible: await this.abrev.disponible(c), puedeResolver: actor.role === 'ADMIN' }));
  }

  /** Sugiere clientes para un código DCMX. SOLO sugiere: nunca asigna ni modifica nada; la interfaz exige la confirmación del usuario. */
  async sugerir(actor: ActorDocumental, codigoEntrada: string): Promise<Sugerencias> {
    const codigo = codigoEntrada.trim().toUpperCase();
    return this.repo.conSesion(actor, async (c) => {
      if (!(await this.abrev.disponible(c))) return { disponible: false, puedeResolver: actor.role === 'ADMIN', estado: 'NO_HABILITADO' as const, codigo, alternativas: [], relacionadas: [], sinConfirmar: [] };
      const filas = await this.abrev.sugerir(c, codigo);
      const decisivas = filas.filter((f) => f.decisivo);
      const alternativas = agrupar(decisivas);
      const relacionadas = agrupar(filas.filter((f) => f.nivel < 9 && !f.decisivo)).filter((r) => !alternativas.some((a) => a.clienteId === r.clienteId));
      const sinConfirmar = agrupar(filas.filter((f) => f.nivel === 9));
      const estado: EstadoSugerencia = alternativas.length === 0 ? 'SIN_SUGERENCIAS' : decisivas.some((f) => f.requiere_eleccion) || alternativas.length > 1 ? 'ELEGIR' : 'EXACTA';
      return { disponible: true, puedeResolver: actor.role === 'ADMIN', estado, codigo, alternativas, relacionadas, sinConfirmar };
    });
  }

  /** Una cuenta GENERAL PROPONE; un ADMIN la registra confirmada (salvo que pida solo proponerla). Quién propone lo fija la sesión, no el navegador. */
  async crear(actor: ActorDocumental, dto: CreateAbbreviationDto): Promise<AbreviaturaVista> {
    const admin = actor.role === 'ADMIN';
    try {
      return await this.repo.conSesion(actor, async (c) => {
        if (!(await this.abrev.disponible(c))) throw http(HttpStatus.CONFLICT, 'CATALOGO_NO_HABILITADO', 'El catálogo de abreviaturas no está habilitado en este entorno.');
        const alcance = dto.alcance ?? 'GENERAL';
        const patron = alcance === 'GENERAL' ? null : (dto.codigoPatron ?? '').trim().toUpperCase();
        if (alcance !== 'GENERAL' && !patron) throw http(HttpStatus.BAD_REQUEST, 'PATRON_REQUERIDO', 'Indica el código o prefijo de contexto.');
        if (alcance === 'GENERAL' && dto.codigoPatron) throw http(HttpStatus.BAD_REQUEST, 'PATRON_NO_APLICA', 'Una asociación general no lleva patrón.');
        return this.abrev.crear(c, {
          abreviatura: dto.abreviatura.trim().toUpperCase(), clienteId: dto.clienteId, alcance, codigoPatron: patron,
          estado: admin && !dto.soloProponer ? 'CONFIRMADA' : 'PROPUESTA', origen: admin ? 'MANUAL_ADMIN' : 'PROPUESTA_USUARIO', evidencia: dto.evidencia?.trim() || null
        });
      });
    } catch (error) { throw traducir(error); }
  }

  /** Solo un ADMIN confirma, rechaza, inactiva o reactiva. Cualquier cuenta puede RETIRAR su propia propuesta (la base lo comprueba). */
  async resolver(actor: ActorDocumental, id: string, accion: Accion, motivo: string | undefined): Promise<AbreviaturaVista> {
    if (accion !== 'RETIRAR' && actor.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo un ADMIN resuelve abreviaturas.' });
    const estado = { CONFIRMAR: 'CONFIRMADA', RECHAZAR: 'RECHAZADA', INACTIVAR: 'INACTIVA', REACTIVAR: 'CONFIRMADA', RETIRAR: 'INACTIVA' }[accion];
    if (accion === 'RECHAZAR' && (motivo ?? '').trim().length < 3) throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'ABREVIATURA_INVALIDA', 'Indica el motivo del rechazo.');
    try {
      return await this.repo.conSesion(actor, async (c) => {
        if (!(await this.abrev.disponible(c))) throw http(HttpStatus.CONFLICT, 'CATALOGO_NO_HABILITADO', 'El catálogo de abreviaturas no está habilitado en este entorno.');
        const r = await this.abrev.cambiarEstado(c, id, estado, motivo?.trim() || null);
        if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Abreviatura no encontrada.' });
        return r;
      });
    } catch (error) { throw traducir(error); }
  }

  /** Administración (solo ADMIN): lista y conteos por estado. */
  async listar(actor: ActorDocumental, estado: string | undefined, q: string | undefined): Promise<{ disponible: boolean; data: AbreviaturaVista[]; conteos: Record<string, number> }> {
    if (actor.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo un ADMIN administra el catálogo de abreviaturas.' });
    return this.repo.conSesion(actor, async (c) => {
      if (!(await this.abrev.disponible(c))) return { disponible: false, data: [], conteos: {} };
      return { disponible: true, data: await this.abrev.listar(c, estado, q?.trim() || undefined), conteos: await this.abrev.contarPorEstado(c) };
    });
  }
}
