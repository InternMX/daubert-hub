import { ForbiddenException, HttpException, HttpStatus, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { InfoFinalizada } from '../manufacturing-sheets/preview/draft-layer';
import type { BindReviewContext } from '../manufacturing-sheets/preview/technical-coherence';
import type { AssignReviewerDto, ClienteDocumentoDto, CreateDraftDto, ResponsableDto, UpdateDraftDto } from './documents.dto';
import { DocumentsRepository, type CambiosBorrador, type InicioFinalizacion } from './documents.repository';
import { construirEspecificacion, incidenciasQueBloquean } from './documents.spec-model';
import type { ActorDocumental, ConfirmacionRow, EspecificacionDocumento, RevisionRow } from './documents.types';
import { ResponsablesRepository, type AutorizacionVista, type FirmaAdministrativa, type FirmaVista, type ResponsableAGuardar, type ResponsableFila } from './responsables.repository';
import { procesarFirma } from './signature-image';
import { SheetEngine } from './sheet-engine.port';

type Cliente = Pick<CambiosBorrador, 'clienteEmpresaId' | 'clienteNombre' | 'clienteVerificado'>;

export interface MotivoNoLista {
  codigo: 'ELABORO_SIN_CONFIRMAR' | 'CLIENTE_REQUERIDO' | 'HOJA_INCOMPLETA' | 'HOJA_BLOQUEADA' | 'INCIDENCIAS_SIN_RECONOCER';
  mensaje: string;
  detalle?: string[];
}

const http = (status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}): HttpException => new HttpException({ code, message, ...extra }, status);

/** Mismo cuerpo para toda colisión de (código, variante): no distingue entre un documento visible y uno que esta cuenta no puede ver. */
const documentoYaExiste = (): HttpException => http(HttpStatus.CONFLICT, 'DOCUMENT_EXISTS', 'Ya existe un documento con ese código y variante. Si es tuyo, búscalo en tus borradores o en el historial del código; si no lo ves, pertenece a otra cuenta.');

/** Traduce los errores de la base (triggers/restricciones del esquema `manufactura`) a respuestas claras. Nunca reenvía texto de la base a quien consulta salvo las reglas de negocio ya redactadas. */
function traducirErrorBd(error: unknown): unknown {
  if (error instanceof HttpException) return error;
  const e = error as { code?: string; constraint?: string; message?: string };
  switch (e.code) {
    case '23505':
      if (e.constraint === 'uq_manufactura_documentos_codigo_variante') return documentoYaExiste();
      if (e.constraint === 'uq_manufactura_revisiones_abierta') return http(HttpStatus.CONFLICT, 'OPEN_DRAFT_EXISTS', 'El documento ya tiene un borrador o una finalización en curso.');
      return http(HttpStatus.CONFLICT, 'DUPLICATE', 'La operación ya se había registrado.');
    case '42501':
      return new ForbiddenException({ code: 'FORBIDDEN', message: 'No tienes permiso para esta operación.' });
    case '55P03':
      return http(HttpStatus.CONFLICT, 'FINALIZACION_EN_CURSO', 'Hay una finalización en curso (menos de 10 minutos). Espera o pide a su autor que la cancele.');
    case '23514':
      return http(HttpStatus.UNPROCESSABLE_ENTITY, 'SPEC_INVALID', 'Los datos guardados no cumplen las restricciones del documento.');
    case '23000':
      return http(HttpStatus.UNPROCESSABLE_ENTITY, 'INTEGRITY', e.message && e.message.length < 200 ? e.message : 'La operación no cumple las reglas de integridad del documento.');
    case '23503':
      return http(HttpStatus.UNPROCESSABLE_ENTITY, 'REFERENCE_INVALID', 'Una referencia (usuario o cliente) no es válida.');
    default:
      return error;
  }
}

const textoONulo = (valor: string | undefined | null): string | null => {
  const t = (valor ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

/**
 * Lógica documental del gestor (TEST): borradores, control de versiones, responsables, revisiones, finalización con PDF, historial y nuevas revisiones. NO compone hojas: lo hace el
 * `SheetEngine`. La identidad (`ActorDocumental`) proviene siempre de la sesión autenticada; ningún método acepta usuario, correo, fechas ni estado desde el cliente.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(private readonly repo: DocumentsRepository, private readonly engine: SheetEngine, private readonly resp: ResponsablesRepository = new ResponsablesRepository()) {}

  // ================================================================== 1. crear / recuperar borradores
  async crearBorrador(actor: ActorDocumental, dto: CreateDraftDto): Promise<unknown> {
    const variante = textoONulo(dto.variante);
    const entrada = { datos: { ...dto.datos } as Record<string, unknown>, bind: dto.bind, procedencia: dto.procedencia, colorPersonalizado: dto.colorPersonalizado, incidenciasReconocidas: dto.incidenciasReconocidas };
    try {
      return await this.repo.conSesion(actor, async (c) => {
        const cliente = await this.resolverCliente(c, dto.cliente);
        const especificacion = construirEspecificacion(this.conClienteImpreso(entrada, cliente), dto.codigo);
        // Respuesta ÚNICA: sea cual sea el motivo del choque (versión finalizada, borrador propio o borrador de otra cuenta que esta no puede ver), el cuerpo es idéntico y sin
        // identificadores; no revela quién ni qué hay detrás. Para continuar un borrador propio se usa `GET open` / `GET history?codigo=`, que la base filtra por permisos.
        const existente = await this.repo.buscarDocumento(c, dto.codigo, variante);
        // Único caso en que un documento existente admite un borrador nuevo: es del propio creador (o ADMIN) y todas sus revisiones fueron descartadas. En cualquier otro, respuesta uniforme.
        const reanudable = existente ? await this.repo.documentoReanudable(c, dto.codigo, variante) : null;
        if (existente && !reanudable) throw documentoYaExiste();
        const documento = reanudable ?? await this.repo.crearDocumento(c, dto.codigo, variante);
        // «Elaboró» se SUGIERE desde la cuenta autenticada, queda editable y sin confirmar: debe confirmarse expresamente antes de finalizar.
        // «Generó» (campo documental `Elaboró`): se sugiere desde la cuenta autenticada y es editable; con `responsables` la primera posición manda.
        const resp = dto.responsables ? await this.prepararResponsables(c, dto.responsables, null) : null;
        const id = await this.repo.crearBorrador(c, documento.documento_id, { familia: dto.familia, especificacion, elaboroNombre: resp ? resp.nombrePrincipal : actor.displayName, elaboroConfirmado: false, autorizoNombre: null, ...cliente, revisorUsuarioId: null });
        if (resp?.dispo) await this.resp.guardarResponsables(c, (await this.revisionInterna(c, id)), resp.aGuardar);
        return this.vistaDe(c, actor, id);
      });
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  /** Borradores y finalizaciones en curso que la base deja ver a esta cuenta (propios, asignados como revisor, o todos si es ADMIN). */
  async listarAbiertas(actor: ActorDocumental): Promise<{ data: unknown[] }> {
    return this.repo.conSesion(actor, async (c) => ({ data: (await this.repo.listarAbiertas(c, 'propios')).map((r) => this.resumen(r, actor)) }));
  }

  /** Borradores y finalizaciones en curso de OTRAS cuentas: consulta en solo lectura (el filtro por propietario se hace aquí, no en el navegador). `codigo` opcional. */
  async listarDelEquipo(actor: ActorDocumental, codigo?: string): Promise<{ data: unknown[] }> {
    return this.repo.conSesion(actor, async (c) => ({ data: (await this.repo.listarAbiertas(c, 'equipo', codigo)).map((r) => this.resumen(r, actor)) }));
  }

  async obtener(actor: ActorDocumental, id: string): Promise<unknown> {
    return this.repo.conSesion(actor, (c) => this.vistaDe(c, actor, id));
  }

  async usuariosRevisores(actor: ActorDocumental): Promise<{ data: unknown[] }> {
    return this.repo.conSesion(actor, async (c) => ({ data: await this.repo.usuariosRevisores(c) }));
  }

  // ================================================================== 2-3. actualizar con control de versiones; «Elaboró»
  async actualizarBorrador(actor: ActorDocumental, id: string, dto: UpdateDraftDto): Promise<unknown> {
    try {
      return await this.repo.conSesion(actor, async (c) => {
        const fila = await this.editable(c, actor, id, dto.version);
        const cliente = dto.cliente !== undefined ? await this.resolverCliente(c, dto.cliente) : this.clienteDe(fila);
        const previa = fila.especificacion;
        const entrada = {
          datos: (dto.datos ? { ...dto.datos } : previa.datos) as Record<string, unknown>,
          bind: dto.bind !== undefined ? dto.bind : previa.bind,
          procedencia: dto.procedencia !== undefined ? dto.procedencia : previa.procedencia,
          colorPersonalizado: dto.colorPersonalizado !== undefined ? dto.colorPersonalizado : previa.colorPersonalizado,
          incidenciasReconocidas: dto.incidenciasReconocidas !== undefined ? dto.incidenciasReconocidas : previa.incidenciasReconocidas
        };
        const especificacion = construirEspecificacion(dto.cliente !== undefined ? this.conClienteImpreso(entrada, cliente) : entrada, fila.codigo_dcmx);

        const resp = dto.responsables !== undefined ? await this.prepararResponsables(c, dto.responsables, fila.revision_id) : null;
        const nombre = resp ? resp.nombrePrincipal : dto.elaboroNombre !== undefined ? textoONulo(dto.elaboroNombre) : fila.elaboro_nombre;
        const cambioNombre = nombre !== fila.elaboro_nombre;
        // Cambiar el nombre impreso retira la confirmación, salvo que la misma petición confirme expresamente el nombre nuevo.
        const confirmado = cambioNombre ? dto.elaboroConfirmado === true : (dto.elaboroConfirmado ?? fila.elaboro_confirmado);
        if (confirmado && !nombre) throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'ELABORO_REQUERIDO', 'Indica el nombre de quien elaboró antes de confirmarlo.');

        const cambios: CambiosBorrador = {
          familia: dto.familia ?? fila.familia, especificacion, elaboroNombre: nombre, elaboroConfirmado: confirmado,
          autorizoNombre: dto.autorizoNombre !== undefined ? textoONulo(dto.autorizoNombre) : fila.autorizo_nombre, ...cliente, revisorUsuarioId: fila.revisor_usuario_id
        };
        if (!(await this.repo.actualizarBorrador(c, id, dto.version, cambios))) throw await this.conflictoDeVersion(c, id, dto.version);
        if (resp?.dispo) await this.resp.guardarResponsables(c, fila.revision_id, resp.aGuardar);
        return this.vistaDe(c, actor, id);
      });
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  async descartarBorrador(actor: ActorDocumental, id: string, version: number): Promise<unknown> {
    try {
      return await this.repo.conSesion(actor, async (c) => {
        await this.editable(c, actor, id, version);
        if (!(await this.repo.descartarBorrador(c, id, version))) throw await this.conflictoDeVersion(c, id, version);
        return this.vistaDe(c, actor, id);
      });
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  // ================================================================== 5. revisor opcional y revisión autenticada
  async asignarRevisor(actor: ActorDocumental, id: string, dto: AssignReviewerDto): Promise<unknown> {
    try {
      return await this.repo.conSesion(actor, async (c) => {
        const fila = await this.editable(c, actor, id, dto.version);
        const cambios: CambiosBorrador = { familia: fila.familia, especificacion: fila.especificacion, elaboroNombre: fila.elaboro_nombre, elaboroConfirmado: fila.elaboro_confirmado, autorizoNombre: fila.autorizo_nombre, ...this.clienteDe(fila), revisorUsuarioId: dto.revisorUsuarioId };
        if (!(await this.repo.actualizarBorrador(c, id, dto.version, cambios))) throw await this.conflictoDeVersion(c, id, dto.version);
        return this.vistaDe(c, actor, id);
      });
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  /**
   * El usuario de la SESIÓN registra su revisión sobre la versión exacta que vio. No se captura ningún nombre: usuario, nombre y huella los fija la base. Solo procede si la hoja está
   * completa y sin errores ni contradicciones sin reconocer (con los datos GUARDADOS). Cualquier cambio técnico posterior la deja sin vigencia.
   */
  async registrarRevision(actor: ActorDocumental, id: string, version: number): Promise<unknown> {
    try {
      return await this.repo.conSesion(actor, async (c) => {
        const fila = await this.repo.obtenerRevision(c, id);
        if (!fila) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado.' });
        if (fila.estado !== 'BORRADOR') throw http(HttpStatus.CONFLICT, 'NOT_EDITABLE', 'Solo se revisa un borrador vigente.');
        const esRevisorAsignado = fila.revisor_usuario_id === actor.userId;
        if (!esRevisorAsignado && fila.creado_por_usuario_id !== actor.userId && actor.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo el revisor asignado, el creador o un ADMIN pueden registrar la revisión.' });
        if (fila.version !== version) throw this.errorDeVersion(fila.version);
        const bloqueos = await this.motivosDeBloqueo(fila);
        if (bloqueos.length > 0) throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'REVISION_BLOQUEADA', 'No se puede registrar la revisión mientras la hoja tenga datos faltantes, errores o contradicciones sin reconocer.', { motivos: bloqueos });
        if (!(await this.repo.registrarConfirmacion(c, id, version))) {
          // Ya existía la misma confirmación (misma cuenta, mismo contenido): operación idempotente.
          const actual = await this.repo.obtenerRevision(c, id);
          if (!actual || actual.version !== version) throw await this.conflictoDeVersion(c, id, version);
        }
        return this.vistaDe(c, actor, id);
      });
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  // ================================================================== utilidades de evaluación
  /** Evalúa la copia GUARDADA con el motor de hojas. Devuelve lo que impide revisar o finalizar (errores, hoja incompleta o bloqueada, contradicciones sin reconocer). */
  private async motivosDeBloqueo(fila: RevisionRow): Promise<MotivoNoLista[]> {
    const spec = fila.especificacion;
    const evaluacion = await this.engine.evaluar(fila.familia, spec.datos, this.contextoBind(spec));
    const motivos: MotivoNoLista[] = [];
    if (evaluacion.bloqueado) motivos.push({ codigo: 'HOJA_BLOQUEADA', mensaje: evaluacion.bloqueado });
    if (!evaluacion.completo) motivos.push({ codigo: 'HOJA_INCOMPLETA', mensaje: 'Faltan datos técnicos para esta familia.', detalle: evaluacion.faltantes });
    const sinReconocer = incidenciasQueBloquean(evaluacion.incidencias, spec.datos, spec.incidenciasReconocidas);
    if (sinReconocer.length > 0) motivos.push({ codigo: 'INCIDENCIAS_SIN_RECONOCER', mensaje: 'Hay errores o contradicciones sin reconocer.', detalle: sinReconocer.map((i) => i.mensaje) });
    return motivos;
  }

  private contextoBind(spec: EspecificacionDocumento): BindReviewContext | undefined {
    if (!spec.bind || (!spec.bind.Title && !spec.bind.Code)) return undefined;
    return { title: spec.bind.Title ?? '', code: spec.bind.Code ?? '', ...(spec.bind.Description ? { description: spec.bind.Description } : {}), ...(spec.datos.composicion ? { composicionSeleccionada: spec.datos.composicion } : {}) };
  }

  // ================================================================== soporte
  /** Carga la revisión visible, comprueba que sea un borrador editable por esta cuenta (creador o ADMIN) y que la versión sea la que el usuario vio. */
  private async editable(c: PoolClient, actor: ActorDocumental, id: string, version: number): Promise<RevisionRow> {
    const fila = await this.repo.obtenerRevision(c, id);
    if (!fila) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado.' });
    if (fila.estado !== 'BORRADOR') throw http(HttpStatus.CONFLICT, 'NOT_EDITABLE', fila.estado === 'FINALIZADA' ? 'Una revisión finalizada no se modifica: crea una nueva revisión.' : 'Esta revisión ya no admite cambios.');
    if (fila.creado_por_usuario_id !== actor.userId && actor.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo el creador del borrador o un ADMIN pueden modificarlo.' });
    if (fila.version !== version) throw this.errorDeVersion(fila.version);
    return fila;
  }

  private errorDeVersion(versionActual: number): HttpException {
    return http(HttpStatus.CONFLICT, 'VERSION_CONFLICT', 'El borrador cambió desde que lo abriste. Recárgalo para ver la versión vigente.', { versionActual });
  }

  /** La actualización afectó 0 filas: se vuelve a mirar para decir por qué (no existe / ya no es borrador / otra persona lo modificó). */
  private async conflictoDeVersion(c: PoolClient, id: string, version: number): Promise<HttpException> {
    const actual = await this.repo.obtenerRevision(c, id);
    if (!actual) return new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado.' });
    if (actual.estado !== 'BORRADOR') return http(HttpStatus.CONFLICT, 'NOT_EDITABLE', 'Esta revisión ya no admite cambios.');
    return actual.version !== version ? this.errorDeVersion(actual.version) : http(HttpStatus.CONFLICT, 'NOT_UPDATED', 'No se pudo aplicar el cambio. Intenta de nuevo.');
  }

  private clienteDe(fila: RevisionRow): Cliente {
    return { clienteEmpresaId: fila.cliente_empresa_id, clienteNombre: fila.cliente_nombre, clienteVerificado: fila.cliente_verificado };
  }

  /** Cliente vinculado a core.empresas (rol CLIENTE, activo) o identificación manual SIN verificar (queda marcada y visible). La política vigente la permite en TEST y en PROD (decisión D3 del diagnóstico: restringirla en PROD está pendiente y requiere autorización). */
  private async resolverCliente(c: PoolClient, cliente: ClienteDocumentoDto | undefined): Promise<Cliente> {
    if (!cliente || (!cliente.empresaId && !cliente.nombre)) return { clienteEmpresaId: null, clienteNombre: null, clienteVerificado: false };
    if (cliente.empresaId) {
      const empresa = await this.repo.buscarCliente(c, cliente.empresaId);
      if (!empresa) throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'CLIENTE_NO_VALIDO', 'El cliente indicado no existe o no está activo.');
      return { clienteEmpresaId: empresa.id, clienteNombre: empresa.nombre, clienteVerificado: true };
    }
    return { clienteEmpresaId: null, clienteNombre: textoONulo(cliente.nombre), clienteVerificado: false };
  }

  /** El cliente impreso en la hoja es el identificado en el documento (no un texto aparte que pueda divergir). */
  private conClienteImpreso<T extends { datos: Record<string, unknown> }>(entrada: T, cliente: Cliente): T {
    return cliente.clienteNombre ? { ...entrada, datos: { ...entrada.datos, cliente: cliente.clienteNombre } } : entrada;
  }

  // ================================================================== vistas
  private permisos(fila: RevisionRow, actor: ActorDocumental): Record<string, boolean> {
    const admin = actor.role === 'ADMIN';
    const creador = fila.creado_por_usuario_id === actor.userId;
    const abierta = fila.estado === 'BORRADOR';
    return {
      editar: abierta && (creador || admin),
      finalizar: (abierta || fila.estado === 'FINALIZANDO') && (creador || admin),
      asignarRevisor: abierta && (creador || admin),
      registrarRevision: abierta && (creador || admin || fila.revisor_usuario_id === actor.userId),
      crearRevisionNueva: fila.estado === 'FINALIZADA' && (admin || fila.documento_creado_por === actor.userId),
      descargarPdf: fila.estado === 'FINALIZADA'
    };
  }

  private resumen(fila: RevisionRow, actor: ActorDocumental): Record<string, unknown> {
    return {
      id: fila.public_id, documentoId: fila.documento_public_id, codigo: fila.codigo_dcmx, variante: fila.variante, familia: fila.familia, estado: fila.estado,
      revision: fila.revision, revisionPrevista: fila.revision_prevista, version: fila.version,
      cliente: fila.cliente_nombre ? { empresaId: fila.cliente_empresa_id, nombre: fila.cliente_nombre, verificado: fila.cliente_verificado } : null,
      creadoPor: fila.creado_por_email, propietario: { nombre: fila.creado_por_nombre ?? fila.creado_por_email, email: fila.creado_por_email }, actualizadoEn: fila.updated_at, finalizadoEn: fila.finalizado_en, finalizadoPor: fila.finalizado_por_email,
      entorno: fila.entorno_emision, propio: fila.creado_por_usuario_id === actor.userId, asignadoComoRevisor: fila.revisor_usuario_id === actor.userId,
      pdf: fila.pdf_nombre ? { nombre: fila.pdf_nombre, sha256: fila.pdf_sha256, bytes: fila.pdf_bytes } : null
    };
  }

  private async vistaDe(c: PoolClient, actor: ActorDocumental, id: string): Promise<unknown> {
    const fila = await this.repo.obtenerRevision(c, id);
    if (!fila) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado.' });
    const confirmaciones = await this.repo.confirmaciones(c, id);
    return { ...this.vista(fila, actor, confirmaciones), responsables: await this.responsablesVista(c, fila) };
  }

  /** Responsables que se muestran: los guardados (con la miniatura de la imagen si esta cuenta puede verla) o, sin ellos, «Generó» con el nombre documental `Elaboró`. */
  private async responsablesVista(c: PoolClient, fila: RevisionRow): Promise<Array<Record<string, unknown>>> {
    let filas: ResponsableFila[] = [];
    if (await this.resp.disponible(c)) filas = await this.resp.responsablesDe(c, fila.public_id);
    const lista = filas.map((r) => ({
      posicion: r.posicion, funcion: r.funcion, nombre: r.nombre, conFirma: r.con_firma,
      firma: r.firma_id && r.firma_b64 && r.firma_mime ? { id: r.firma_id, propietario: r.firma_propietario, miniatura: `data:${r.firma_mime};base64,${r.firma_b64.replace(/\s+/g, '')}` } : null
    }));
    if (!lista.some((r) => r.posicion === 1)) lista.unshift({ posicion: 1, funcion: 'GENERO', nombre: fila.elaboro_nombre ?? '', conFirma: false, firma: null });
    return lista;
  }

  // ================================================================== responsables y catálogo de firmas
  async capacidades(actor: ActorDocumental): Promise<{ firmas: boolean }> {
    return this.repo.conSesion(actor, async (c) => ({ firmas: await this.resp.disponible(c) }));
  }

  private async revisionInterna(c: PoolClient, publicId: string): Promise<string> {
    const r = await this.repo.obtenerRevision(c, publicId);
    if (!r) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado.' });
    return r.revision_id;
  }

  /**
   * Valida y resuelve los responsables (1 a 3): la primera posición es «Generó»; una firma solo se acepta si esta cuenta puede usarla (propia, con autorización vigente, o ya asignada a esta
   * revisión); con firma, el nombre impreso es el de su propietaria (no se puede atribuir la imagen a otra persona). Sin la migración 102 solo existe «Generó» y no hay firmas.
   */
  private async prepararResponsables(c: PoolClient, items: ResponsableDto[], revisionInternaId: string | null): Promise<{ aGuardar: ResponsableAGuardar[]; nombrePrincipal: string | null; dispo: boolean }> {
    if (items.length < 1 || items.length > 3) throw http(HttpStatus.BAD_REQUEST, 'RESPONSABLES_INVALIDOS', 'Una hoja lleva de uno a tres responsables.');
    if (items[0]?.funcion !== 'GENERO') throw http(HttpStatus.BAD_REQUEST, 'RESPONSABLES_INVALIDOS', 'El primer responsable es siempre «Generó».');
    const dispo = await this.resp.disponible(c);
    const conFirma = items.filter((i) => i.firmaId);
    if (!dispo && (items.length > 1 || conFirma.length > 0)) {
      throw http(HttpStatus.CONFLICT, 'FIRMAS_NO_DISPONIBLES', 'Los responsables adicionales y las firmas requieren la migración de firmas, que aún no está aplicada en este entorno.');
    }
    const resueltas = await this.resp.resolverFirmas(c, conFirma.map((i) => i.firmaId as string), revisionInternaId ?? '0');
    for (const i of conFirma) {
      const f = resueltas.get(i.firmaId as string);
      if (!f || !f.permitido) throw http(HttpStatus.FORBIDDEN, 'FIRMA_NO_AUTORIZADA', 'No tienes autorización para usar una de las firmas seleccionadas.');
    }
    const aGuardar: ResponsableAGuardar[] = [];
    let nombrePrincipal: string | null = null;
    items.forEach((i, idx) => {
      const f = i.firmaId ? resueltas.get(i.firmaId) : undefined;
      const nombre = textoONulo(f ? f.propietario : i.nombre);
      if (idx === 0) nombrePrincipal = nombre;
      if (nombre) aGuardar.push({ posicion: idx + 1, funcion: idx === 0 ? 'GENERO' : i.funcion, nombre, firmaInternaId: f?.internoId ?? null });
    });
    return { aGuardar, nombrePrincipal, dispo };
  }

  async listarFirmas(actor: ActorDocumental): Promise<{ data: FirmaVista[] }> {
    return this.repo.conSesion(actor, async (c) => ({ data: (await this.resp.disponible(c)) ? await this.resp.listarUtilizables(c, actor.userId) : [] }));
  }

  /** Alta de una firma: el archivo se valida y se normaliza (nunca se guarda tal cual). Sin propietario indicado es de la cuenta; solo un ADMIN incorpora la de otra persona. */
  async subirFirma(actor: ActorDocumental, archivo: Buffer | undefined, propietarioUsuarioId: string | undefined, propietarioNombre: string | undefined): Promise<FirmaVista & { utilizable: boolean }> {
    if (!archivo) throw http(HttpStatus.BAD_REQUEST, 'FIRMA_INVALIDA', 'No se recibió ninguna imagen.');
    const firma = procesarFirma(archivo);
    try {
      return await this.repo.conSesion(actor, async (c) => {
        if (!(await this.resp.disponible(c))) throw http(HttpStatus.CONFLICT, 'FIRMAS_NO_DISPONIBLES', 'El catálogo de firmas requiere la migración de firmas, que aún no está aplicada en este entorno.');
        const ajena = propietarioUsuarioId !== undefined && propietarioUsuarioId !== actor.userId;
        const sinCuenta = propietarioUsuarioId === undefined && propietarioNombre !== undefined && textoONulo(propietarioNombre) !== null;
        if ((ajena || sinCuenta) && actor.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo un ADMIN autorizado puede incorporar la firma de otra persona.' });
        let propietarioId: string | null = propietarioUsuarioId ?? (sinCuenta ? null : actor.userId);
        let nombre: string;
        if (propietarioId !== null) {
          const n = await this.resp.nombreDeUsuarioActivo(c, propietarioId);
          if (!n) throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'REFERENCE_INVALID', 'El usuario propietario no existe o no está activo.');
          nombre = n;
        } else {
          propietarioId = null;
          nombre = textoONulo(propietarioNombre) as string;
        }
        const publicId = await this.resp.insertarFirma(c, propietarioId, nombre, firma);
        const lista = await this.resp.listarUtilizables(c, actor.userId);
        const creada = lista.find((f) => f.id === publicId);
        // Quien sube la firma de otra persona NO recibe permiso de uso: `utilizable` dice si esta cuenta puede usarla ya (propia, o custodio de una persona sin cuenta).
        if (creada) return { ...creada, utilizable: true };
        return { utilizable: false, id: publicId, propietario: nombre, propia: propietarioId === actor.userId, ancho: firma.ancho, alto: firma.alto, miniatura: `data:${firma.tipoMime};base64,${firma.contenido.toString('base64')}`, creadaEn: new Date().toISOString() };
      });
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  /** Autorizar o revocar el USO de una imagen por otra persona (acceso al recurso; no aprueba ningún documento). Lo decide la base: propietaria, o su ADMIN custodio si no tiene cuenta. */
  async cambiarUsoFirma(actor: ActorDocumental, firmaId: string, usuarioId: string, autorizar: boolean): Promise<{ ok: true }> {
    try {
      await this.repo.conSesion(actor, async (c) => {
        if (autorizar) {
          if ((await this.resp.autorizar(c, firmaId, usuarioId)) === 'sin_acceso') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo la propietaria de la firma puede autorizar su uso.' });
        }
        else if ((await this.resp.revocar(c, firmaId, usuarioId)) === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'No hay una autorización vigente para ese usuario.' });
      });
      return { ok: true };
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  /** Quién puede usar una firma (vigentes). Sin nombres de cuentas ajenas para quien no es propietaria: la base filtra las filas. */
  async autorizacionesDeFirma(actor: ActorDocumental, firmaId: string): Promise<{ data: AutorizacionVista[] }> {
    return this.repo.conSesion(actor, async (c) => ({ data: await this.resp.autorizacionesDe(c, firmaId) }));
  }

  /** Gestión administrativa (solo ADMIN): descripción de las firmas de un usuario o de personas sin cuenta, sin imágenes y sin ampliar lo que la base deja ver. */
  async listarFirmasAdministrativas(actor: ActorDocumental, propietarioUsuarioId: string | undefined, sinCuenta: boolean): Promise<{ data: FirmaAdministrativa[]; alcance: string }> {
    if (actor.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo un ADMIN puede consultar la gestión administrativa de firmas.' });
    if ((propietarioUsuarioId === undefined) === !sinCuenta) throw http(HttpStatus.BAD_REQUEST, 'CONSULTA_INVALIDA', 'Indica un usuario o la consulta de personas sin cuenta (solo una).');
    return this.repo.conSesion(actor, async (c) => {
      if (!(await this.resp.disponible(c))) return { data: [], alcance: 'El catálogo de firmas no está disponible en este entorno.' };
      const { data, completo } = await this.resp.firmasAdministrativas(c, sinCuenta ? null : (propietarioUsuarioId as string));
      return {
        data,
        alcance: completo
          ? 'Inventario administrativo: solo descripción y estados. Ser ADMIN no da acceso a la imagen ni permiso de uso de las firmas de otras personas.'
          : 'Solo se listan las firmas que esta cuenta registró o cuyo uso tiene autorizado: ser ADMIN no da acceso a las firmas de otras personas.'
      };
    });
  }

  async retirarFirma(actor: ActorDocumental, firmaId: string): Promise<{ ok: true }> {
    try {
      await this.repo.conSesion(actor, async (c) => {
        if ((await this.resp.retirar(c, firmaId)) === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'La firma no existe, no es tuya o ya está retirada.' });
      });
      return { ok: true };
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  private vista(fila: RevisionRow, actor: ActorDocumental, confirmaciones: ConfirmacionRow[]): Record<string, unknown> {
    return {
      ...this.resumen(fila, actor),
      huella: fila.especificacion_sha256,
      especificacion: fila.especificacion,
      elaboro: { nombre: fila.elaboro_nombre, confirmado: fila.elaboro_confirmado, sugerido: actor.displayName },
      autorizo: fila.autorizo_nombre,
      revisor: fila.revisor_usuario_id ? { id: fila.revisor_usuario_id, nombre: fila.revisor_nombre } : null,
      confirmaciones: confirmaciones.map((k) => ({ usuario: k.usuario_nombre, correo: k.usuario_email, version: k.version, vigente: k.vigente, autorrevision: k.es_autorrevision, comoRevisorAsignado: k.como_revisor_asignado, registradaEn: k.created_at })),
      basadaEnRevision: fila.basada_en_revision,
      creadoEn: fila.created_at, actualizadoPor: fila.actualizado_por_email,
      permisos: this.permisos(fila, actor)
    };
  }

  private sha256(datos: Buffer): string {
    return createHash('sha256').update(datos).digest('hex');
  }

  // ================================================================== 6. finalizar desde la copia guardada y producir el PDF
  /** Lo que falta para finalizar (sin escribir nada). Lista vacía = lista. El motor de PDF se verifica aparte (501), antes de tocar el estado. */
  async motivosNoLista(fila: RevisionRow): Promise<MotivoNoLista[]> {
    const motivos: MotivoNoLista[] = [];
    // «Generó» es opcional (como las firmas): sin nombre su espacio queda en blanco. Si hay nombre, debe estar confirmado (finalizar lo confirma).
    if (fila.elaboro_nombre && !fila.elaboro_confirmado) motivos.push({ codigo: 'ELABORO_SIN_CONFIRMAR', mensaje: 'Confirma expresamente el nombre de quien elaboró.' });
    if (!fila.cliente_nombre) motivos.push({ codigo: 'CLIENTE_REQUERIDO', mensaje: 'Identifica al cliente (vinculado a la lista de clientes o escrito manualmente).' });
    motivos.push(...(await this.motivosDeBloqueo(fila)));
    return motivos;
  }

  /**
   * Protocolo de finalización (el PDF se genera FUERA de cualquier transacción):
   *  1. Verificaciones sin escribir (permiso, versión, requisitos, Chrome disponible).
   *  2. Transacción A corta: BORRADOR → FINALIZANDO (la base reserva el número, congela el contenido y emite el token; una segunda petición recibe 409).
   *  3. Render del PDF desde la copia GUARDADA, con el motor de hojas.
   *  4. Transacción B corta: PDF + contenido + FINALIZANDO → FINALIZADA, atada a token y versión; la base verifica hash, tamaño, nombre y revisión.
   *  Si el render o el registro fallan, la revisión vuelve a BORRADOR (solo si el token sigue siendo el nuestro) y no queda ningún PDF.
   */
  async finalizar(actor: ActorDocumental, id: string, version: number): Promise<unknown> {
    let inicio: InicioFinalizacion;
    let fila: RevisionRow;
    let confirmaciones: ConfirmacionRow[];
    let versionFinal = version;
    let responsablesPdf: InfoFinalizada['responsables'];
    try {
      ({ inicio, fila, confirmaciones, versionFinal, responsablesPdf } = await this.repo.conSesion(actor, async (c) => {
        const actual = await this.repo.obtenerRevision(c, id);
        if (!actual) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado.' });
        if (actual.estado === 'FINALIZADA') throw http(HttpStatus.CONFLICT, 'ALREADY_FINAL', 'Esta revisión ya está finalizada.');
        if (actual.estado !== 'BORRADOR' && actual.estado !== 'FINALIZANDO') throw http(HttpStatus.CONFLICT, 'NOT_EDITABLE', 'Esta revisión ya no admite cambios.');
        if (actual.creado_por_usuario_id !== actor.userId && actor.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo el creador o un ADMIN pueden finalizar.' });
        if (actual.version !== version) throw this.errorDeVersion(actual.version);
        // El cliente vinculado debe seguir activo y con el mismo nombre que se va a imprimir: el catálogo puede cambiar entre el borrador y la finalización. Una vez finalizada, la
        // revisión conserva su propio nombre e identificador (inmutables), pase lo que pase después con la empresa.
        if (actual.estado === 'BORRADOR' && actual.cliente_verificado && actual.cliente_empresa_id) {
          const empresa = await this.repo.buscarCliente(c, actual.cliente_empresa_id);
          if (!empresa) throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'CLIENTE_NO_VALIDO', 'El cliente vinculado ya no está activo. Identifica otro cliente antes de finalizar.');
          if (empresa.nombre !== actual.cliente_nombre) throw http(HttpStatus.CONFLICT, 'CLIENTE_ACTUALIZADO', 'El nombre del cliente cambió en el catálogo. Vuelve a seleccionarlo para actualizar la hoja antes de finalizar.', { nombreActual: empresa.nombre });
        }
        // Chrome es obligatorio: sin él no se toca el estado, no se genera nada y se informa con claridad.
        if (!this.engine.disponible) throw http(HttpStatus.NOT_IMPLEMENTED, 'PDF_NOT_AVAILABLE', 'No se puede finalizar: la generación de PDF no está disponible en este entorno.');
        // Pulsar «Finalizar y generar PDF» ES la confirmación expresa del nombre de «Generó» que se ve en el formulario (no hay casilla aparte). Se registra con la sesión autenticada y la versión
        // vigente DENTRO de esta misma transacción: si falta algún requisito o algo falla, se revierte todo y la hoja no queda parcialmente confirmada.
        let trabajo = actual;
        let v = version;
        if (actual.estado === 'BORRADOR' && actual.elaboro_nombre && !actual.elaboro_confirmado) {
          const cambios: CambiosBorrador = { familia: actual.familia, especificacion: actual.especificacion, elaboroNombre: actual.elaboro_nombre, elaboroConfirmado: true, autorizoNombre: actual.autorizo_nombre, ...this.clienteDe(actual), revisorUsuarioId: actual.revisor_usuario_id };
          if (!(await this.repo.actualizarBorrador(c, id, version, cambios))) throw await this.conflictoDeVersion(c, id, version);
          v = version + 1;
          trabajo = (await this.repo.obtenerRevision(c, id)) ?? actual;
        }
        const motivos = await this.motivosNoLista(trabajo);
        if (motivos.length > 0) throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'FINALIZACION_NO_LISTA', 'La revisión todavía no cumple los requisitos para finalizar.', { motivos });
        // Responsables e imágenes que se imprimirán: si una imagen asignada ya no es legible/utilizable por esta cuenta, no se finaliza (nunca se omite en silencio).
        let responsables: InfoFinalizada['responsables'];
        if (await this.resp.disponible(c)) {
          const rp = await this.resp.responsablesParaPdf(c, trabajo.revision_id);
          if (rp.faltantes > 0) throw http(HttpStatus.UNPROCESSABLE_ENTITY, 'FIRMA_NO_DISPONIBLE', 'Una firma asignada ya no está disponible para esta cuenta (autorización retirada o firma retirada). Cámbiala o quítala antes de finalizar.');
          if (rp.responsables.length > 0) responsables = rp.responsables;
        }
        // Toda finalización nueva usa la composición de responsables: sin filas guardadas se imprime «Generó» con el nombre documental (espacio de firma vacío), nunca el marcador «SIN FIRMA».
        responsables ??= [{ posicion: 1, funcion: 'GENERO', nombre: trabajo.elaboro_nombre ?? '', firma: null }];
        // Sin «Generó» guardado (nombre en blanco) pero con otros responsables: su recuadro se conserva vacío para que Revisó/Aprobó no ocupen el primer espacio.
        if (!responsables.some((r) => r.posicion === 1)) responsables = [{ posicion: 1, funcion: 'GENERO', nombre: '', firma: null }, ...responsables];
        const iniciada = actual.estado === 'BORRADOR' ? await this.repo.iniciarFinalizacion(c, id, v) : await this.repo.reclamarFinalizacion(c, id, v);
        if (!iniciada) throw http(HttpStatus.CONFLICT, 'FINALIZACION_EN_CURSO', 'Otra finalización de esta revisión está en curso o la revisión cambió.');
        return { inicio: iniciada, fila: trabajo, confirmaciones: await this.repo.confirmaciones(c, id), versionFinal: v, responsablesPdf: responsables };
      }));
    } catch (error) {
      throw traducirErrorBd(error);
    }

    try {
      const vigente = [...confirmaciones].reverse().find((k) => k.vigente);
      const info: InfoFinalizada = {
        revision: inicio.revision_prevista,
        finalizadoEn: inicio.fecha,
        elaboro: fila.elaboro_nombre ?? '',
        reviso: vigente ? `${vigente.usuario_nombre}${vigente.es_autorrevision && !vigente.como_revisor_asignado ? ' (autorrevisión)' : ''}` : null,
        autorizo: fila.autorizo_nombre,
        huella: fila.especificacion_sha256,
        ...(responsablesPdf ? { responsables: responsablesPdf } : {})
      };
      const spec = fila.especificacion;
      const documento = await this.engine.generarFinalizada(fila.familia, spec.datos, this.contextoBind(spec), info, fila.variante);
      const sha = this.sha256(documento.pdf);
      await this.repo.conSesion(actor, async (c) => {
        const ok = await this.repo.completarFinalizacion(c, { revisionId: inicio.revision_id, token: inicio.finalizando_token, version: versionFinal, nombreArchivo: documento.filename, sha256: sha, contenido: documento.pdf, especificacionSha256: fila.especificacion_sha256 });
        if (!ok) throw http(HttpStatus.CONFLICT, 'FINALIZACION_PERDIDA', 'La finalización fue cancelada o reclamada por otra sesión; no se registró ningún PDF.');
      });
    } catch (error) {
      await this.revertir(actor, inicio);
      throw traducirErrorBd(error);
    }
    return this.repo.conSesion(actor, (c) => this.vistaDe(c, actor, id));
  }

  /** Falla tras iniciar: FINALIZANDO → BORRADOR (token propio). Si no se pudiera revertir, la revisión se recupera por el reclamo pasados 10 minutos. */
  private async revertir(actor: ActorDocumental, inicio: InicioFinalizacion): Promise<void> {
    try {
      await this.repo.conSesion(actor, (c) => this.repo.revertirFinalizacion(c, inicio.revision_id, inicio.finalizando_token));
    } catch {
      this.logger.warn(`No se pudo revertir la finalización de la revisión ${inicio.revision_id}; quedará reclamable pasados 10 minutos.`);
    }
  }

  /** Cancela una finalización en curso o abandonada (creador o ADMIN). Idempotente. */
  async cancelarFinalizacion(actor: ActorDocumental, id: string, version: number): Promise<unknown> {
    try {
      return await this.repo.conSesion(actor, async (c) => {
        const fila = await this.repo.obtenerRevision(c, id);
        if (!fila) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado.' });
        if (fila.creado_por_usuario_id !== actor.userId && actor.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo el creador o un ADMIN pueden cancelar la finalización.' });
        if (fila.estado === 'FINALIZANDO') {
          if (fila.version !== version) throw this.errorDeVersion(fila.version);
          await this.repo.cancelarFinalizacion(c, id, version);
        }
        return this.vistaDe(c, actor, id);
      });
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  // ================================================================== 7. historial y descarga
  async historial(actor: ActorDocumental, codigo: string): Promise<{ data: unknown[] }> {
    return this.repo.conSesion(actor, async (c) => ({ data: (await this.repo.historialPorCodigo(c, codigo)).map((r) => this.resumen(r, actor)) }));
  }

  /** Descarga una versión FINALIZADA verificando que los bytes siguen coincidiendo con el SHA-256 registrado (si no, no se entrega y se registra el incidente sin contenido). */
  async descargarPdf(actor: ActorDocumental, id: string): Promise<{ nombre: string; contenido: Buffer; sha256: string }> {
    const pdf = await this.repo.conSesion(actor, (c) => this.repo.obtenerPdf(c, id));
    if (!pdf) throw new NotFoundException({ code: 'NOT_FOUND', message: 'No hay un PDF finalizado con ese identificador.' });
    if (this.sha256(pdf.contenido) !== pdf.pdf_sha256 || pdf.contenido.length !== pdf.bytes) {
      this.logger.error(`Integridad del PDF no verificada (revisión ${id}).`);
      throw new InternalServerErrorException({ code: 'PDF_INTEGRITY', message: 'No se pudo verificar la integridad del PDF.' });
    }
    return { nombre: pdf.nombre_archivo, contenido: pdf.contenido, sha256: pdf.pdf_sha256 };
  }

  // ================================================================== 8. nueva revisión (sin modificar las anteriores)
  /** Crea un BORRADOR nuevo a partir de la última versión FINALIZADA del documento. La base impide dos abiertos y solo permite al creador del documento o a un ADMIN. */
  async crearRevisionNueva(actor: ActorDocumental, documentoId: string): Promise<unknown> {
    try {
      return await this.repo.conSesion(actor, async (c) => {
        const base = await this.repo.ultimaFinalizada(c, documentoId);
        if (!base) throw new NotFoundException({ code: 'NOT_FOUND', message: 'El documento no existe o no tiene una versión finalizada.' });
        const abierta = await this.repo.revisionAbiertaDelDocumento(c, documentoId);
        if (abierta) throw http(HttpStatus.CONFLICT, 'OPEN_DRAFT_EXISTS', 'El documento ya tiene un borrador o una finalización en curso.', { borradorId: abierta.public_id });
        const id = await this.repo.crearBorrador(c, await this.documentoIdInterno(c, documentoId), {
          familia: base.familia, especificacion: base.especificacion, elaboroNombre: actor.displayName, elaboroConfirmado: false, autorizoNombre: null,
          clienteEmpresaId: base.cliente_empresa_id, clienteNombre: base.cliente_nombre, clienteVerificado: base.cliente_verificado, revisorUsuarioId: null
        }, base.revision_id);
        // Los nombres y funciones se recuperan como referencia editable; las imágenes de firma NO se heredan (cada revisión se firma por separado).
        if (await this.resp.disponible(c)) await this.resp.copiarNombres(c, base.revision_id, id);
        return this.vistaDe(c, actor, id);
      });
    } catch (error) {
      throw traducirErrorBd(error);
    }
  }

  private async documentoIdInterno(c: PoolClient, documentoPublicId: string): Promise<string> {
    const r = await c.query<{ documento_id: string }>('SELECT documento_id::text FROM manufactura.documentos WHERE public_id = $1', [documentoPublicId]);
    const fila = r.rows[0];
    if (!fila) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Documento no encontrado.' });
    return fila.documento_id;
  }
}
