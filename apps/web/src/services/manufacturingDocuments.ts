import { apiBaseUrl } from './api';
import type { FamilyCode } from './manufacturingFamilies';

// Gestor documental de Hojas de Instrucción (TEST): /api/manufacturing-sheets/documents/… El navegador NUNCA envía usuario, correo, estado, revisión, huella ni fechas: la identidad sale de la
// sesión en el backend y la base de datos fija el resto. Todo documento de este módulo es de PRUEBA (no válido para producción).

export type EstadoRevision = 'BORRADOR' | 'FINALIZANDO' | 'FINALIZADA' | 'DESCARTADA';

export interface IncidenciaReconocida { id: string; huella: string }
export interface EspecificacionGuardada {
  datos: Record<string, string>;
  bind?: { Code?: string; Title?: string; Description?: string; Weight?: number; CreationDate?: string };
  procedencia?: Record<string, string>;
  colorPersonalizado?: { nombre?: string; hex?: string };
  incidenciasReconocidas?: IncidenciaReconocida[];
}

/** Cliente de un documento: `empresaId` solo si está vinculado al catálogo (verificado); el manual (TEST o PROD) queda marcado como no verificado. */
export interface ClienteDocumento { empresaId?: string; nombre?: string }

export interface PermisosDocumento {
  editar: boolean; finalizar: boolean; asignarRevisor: boolean; registrarRevision: boolean; crearRevisionNueva: boolean; descargarPdf: boolean;
}
export interface PdfDocumento { nombre: string; sha256: string; bytes: number }
export interface ResumenDocumento {
  id: string; documentoId: string; codigo: string; variante: string | null; familia: FamilyCode; estado: EstadoRevision;
  revision: number | null; revisionPrevista: number | null; version: number;
  cliente: { empresaId: string | null; nombre: string; verificado: boolean } | null;
  creadoPor: string; actualizadoEn: string; finalizadoEn: string | null; finalizadoPor: string | null;
  entorno: 'PRUEBA' | 'PRODUCCION'; propio: boolean; asignadoComoRevisor: boolean; pdf: PdfDocumento | null;
  /** Propietario (quien creó el borrador); ausente en respuestas anteriores a la consulta compartida. */
  propietario?: { nombre: string; email: string };
}
export interface ConfirmacionDocumento { usuario: string; correo: string; version: number; vigente: boolean; autorrevision: boolean; comoRevisorAsignado: boolean; registradaEn: string }
export interface DocumentoVista extends ResumenDocumento {
  huella: string;
  especificacion: EspecificacionGuardada;
  elaboro: { nombre: string | null; confirmado: boolean; sugerido: string };
  autorizo: string | null;
  revisor: { id: string; nombre: string | null } | null;
  confirmaciones: ConfirmacionDocumento[];
  basadaEnRevision: number | null;
  creadoEn: string; actualizadoPor: string;
  permisos: PermisosDocumento;
  /** Responsables impresos (siempre incluye «Generó»). */
  responsables: ResponsableVista[];
}
export type FuncionResponsable = 'GENERO' | 'REVISO' | 'APROBO';
export const FUNCIONES: ReadonlyArray<{ valor: FuncionResponsable; etiqueta: string }> = [{ valor: 'GENERO', etiqueta: 'Generó' }, { valor: 'REVISO', etiqueta: 'Revisó' }, { valor: 'APROBO', etiqueta: 'Aprobó' }];
/** Imagen de firma que esta cuenta puede usar (la miniatura viaja como data URI ya procesada por el servidor). */
export interface FirmaVista { id: string; propietario: string; propia: boolean; ancho: number; alto: number; miniatura: string; creadaEn: string; /** Solo al subirla: false = quedó a nombre de otra persona y esta cuenta aún no puede usarla (necesita su autorización). */ utilizable?: boolean }
/** Persona con autorización de USO vigente de una firma. */
export interface AutorizacionFirma { usuarioId: string; nombre: string; otorgadaEn: string; otorgadaPor: string | null }
export interface FirmaDeResponsable { id: string; propietario: string | null; miniatura: string }
export interface ResponsableVista { posicion: number; funcion: FuncionResponsable; nombre: string; conFirma: boolean; firma: FirmaDeResponsable | null }
/** Responsable que se envía al guardar: la posición es el orden; la primera es siempre «Generó». Con `firmaId` el nombre impreso es el de la propietaria de la imagen. */
export interface ResponsableEnvio { funcion: FuncionResponsable; nombre: string; firmaId?: string | null }
export interface UsuarioRevisor { id: string; displayName: string }
export interface MotivoNoLista { codigo: string; mensaje: string; detalle?: string[] }

export interface BorradorNuevo {
  codigo: string; variante?: string; familia: FamilyCode; datos: Record<string, string>;
  bind?: EspecificacionGuardada['bind']; procedencia?: Record<string, string>; colorPersonalizado?: EspecificacionGuardada['colorPersonalizado'];
  incidenciasReconocidas?: IncidenciaReconocida[]; cliente?: ClienteDocumento; responsables?: ResponsableEnvio[];
}
export interface CambiosBorrador extends Partial<Omit<BorradorNuevo, 'codigo' | 'variante'>> {
  version: number; elaboroNombre?: string; elaboroConfirmado?: boolean; autorizoNombre?: string;
}

export type DocumentErrorKind =
  | 'INACTIVE' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'DOCUMENT_EXISTS' | 'OPEN_DRAFT_EXISTS' | 'NOT_EDITABLE' | 'ALREADY_FINAL'
  | 'FINALIZACION_NO_LISTA' | 'REVISION_BLOQUEADA' | 'PDF_NOT_AVAILABLE' | 'FINALIZACION_EN_CURSO' | 'FINALIZACION_PERDIDA' | 'CLIENTE_NO_VALIDO' | 'CLIENTE_ACTUALIZADO' | 'ELABORO_REQUERIDO' | 'FIRMA_INVALIDA' | 'FIRMA_NO_AUTORIZADA' | 'FIRMAS_NO_DISPONIBLES' | 'FIRMA_NO_DISPONIBLE' | 'RESPONSABLES_INVALIDOS' | 'SPEC_INVALID'
  | 'INVALID_DATA' | 'INVALID_RESPONSE' | 'PDF_INTEGRITY' | 'NETWORK' | 'FAILED';

const KNOWN: ReadonlySet<string> = new Set(['NOT_FOUND', 'VERSION_CONFLICT', 'DOCUMENT_EXISTS', 'OPEN_DRAFT_EXISTS', 'NOT_EDITABLE', 'ALREADY_FINAL', 'FINALIZACION_NO_LISTA', 'REVISION_BLOQUEADA', 'PDF_NOT_AVAILABLE', 'FINALIZACION_EN_CURSO', 'FINALIZACION_PERDIDA', 'CLIENTE_NO_VALIDO', 'CLIENTE_ACTUALIZADO', 'ELABORO_REQUERIDO', 'PDF_INTEGRITY', 'FORBIDDEN', 'FIRMA_INVALIDA', 'FIRMA_NO_AUTORIZADA', 'FIRMAS_NO_DISPONIBLES', 'FIRMA_NO_DISPONIBLE', 'RESPONSABLES_INVALIDOS', 'SPEC_INVALID']);

export class DocumentApiError extends Error {
  constructor(public readonly kind: DocumentErrorKind, public readonly status: number, public readonly body: Record<string, unknown> = {}) {
    super('Manufacturing document request failed');
  }
  /** Versión vigente que informa un 409 VERSION_CONFLICT. */
  get versionActual(): number | null { return typeof this.body.versionActual === 'number' ? this.body.versionActual : null; }
  get motivos(): MotivoNoLista[] { return Array.isArray(this.body.motivos) ? (this.body.motivos as MotivoNoLista[]) : []; }
  get nombreActual(): string | null { return typeof this.body.nombreActual === 'string' ? this.body.nombreActual : null; }
  get borradorId(): string | null { return typeof this.body.borradorId === 'string' ? this.body.borradorId : null; }
  /** Motivo de rechazo de una imagen de firma: texto redactado por el servidor (sin datos del usuario). */
  get mensajeFirma(): string | null { return this.kind === 'FIRMA_INVALIDA' && typeof this.body.message === 'string' && this.body.message.length <= 300 ? this.body.message : null; }
  /** Campos que el servidor rechazó en un 400 de validación (solo nombres; nunca valores). */
  get campos(): string[] { return Array.isArray(this.body.fields) ? (this.body.fields as unknown[]).filter((c): c is string => typeof c === 'string' && /^[A-Za-z][A-Za-z0-9_.[\]]{0,80}$/.test(c)).slice(0, 10) : []; }
}

function errorFor(status: number, body: unknown): DocumentApiError {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const code = typeof b.code === 'string' ? b.code : '';
  if (status === 401) return new DocumentApiError('UNAUTHENTICATED', status, b);
  // 404 sin código propio = la ruta no existe (módulo aún no activado en la API): no es «documento no encontrado».
  if (status === 404 && code === '') return new DocumentApiError('INACTIVE', status, b);
  if (KNOWN.has(code)) return new DocumentApiError(code as DocumentErrorKind, status, b);
  if (status === 400) return new DocumentApiError('INVALID_DATA', status, b);
  if (status === 403) return new DocumentApiError('FORBIDDEN', status, b);
  if (status === 501) return new DocumentApiError('PDF_NOT_AVAILABLE', status, b);
  return new DocumentApiError('FAILED', status, b);
}

const base = `${apiBaseUrl}/manufacturing-sheets/documents`;

async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new DocumentApiError('NETWORK', 0);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorFor(response.status, json);
  if (typeof json !== 'object' || json === null) throw new DocumentApiError('INVALID_RESPONSE', response.status);
  return json as T;
}

const enc = encodeURIComponent;

export const crearBorrador = (cuerpo: BorradorNuevo, signal?: AbortSignal): Promise<DocumentoVista> => call('POST', '/drafts', cuerpo, signal);
export const obtenerDocumento = (id: string, signal?: AbortSignal): Promise<DocumentoVista> => call('GET', `/revisions/${enc(id)}`, undefined, signal);
export const actualizarBorrador = (id: string, cambios: CambiosBorrador, signal?: AbortSignal): Promise<DocumentoVista> => call('PATCH', `/revisions/${enc(id)}`, cambios, signal);
export const descartarBorrador = (id: string, version: number): Promise<DocumentoVista> => call('POST', `/revisions/${enc(id)}/discard`, { version });
export const listarAbiertos = (signal?: AbortSignal): Promise<{ data: ResumenDocumento[] }> => call('GET', '/open', undefined, signal);
/** Borradores y finalizaciones en curso de OTRAS cuentas (consulta en solo lectura); el servidor ya los separa de los propios. */
export const listarDelEquipo = (codigo?: string, signal?: AbortSignal): Promise<{ data: ResumenDocumento[] }> => call('GET', codigo ? `/team?codigo=${enc(codigo)}` : '/team', undefined, signal);
export const historialPorCodigo = (codigo: string, signal?: AbortSignal): Promise<{ data: ResumenDocumento[] }> => call('GET', `/history?codigo=${enc(codigo)}`, undefined, signal);
export const listarRevisores = (signal?: AbortSignal): Promise<{ data: UsuarioRevisor[] }> => call('GET', '/reviewers', undefined, signal);
export const asignarRevisor = (id: string, version: number, revisorUsuarioId: string | null): Promise<DocumentoVista> => call('PUT', `/revisions/${enc(id)}/reviewer`, { version, revisorUsuarioId });
export const registrarRevision = (id: string, version: number): Promise<DocumentoVista> => call('POST', `/revisions/${enc(id)}/review`, { version });
export const finalizarDocumento = (id: string, version: number): Promise<DocumentoVista> => call('POST', `/revisions/${enc(id)}/finalize`, { version });
export const cancelarFinalizacion = (id: string, version: number): Promise<DocumentoVista> => call('POST', `/revisions/${enc(id)}/cancel-finalization`, { version });
export const crearRevisionNueva = (documentoId: string): Promise<DocumentoVista> => call('POST', `/${enc(documentoId)}/revisions`, {});

const SAFE_FILENAME = /^[A-Za-z0-9._-]{1,120}\.pdf$/;
export interface PdfFinalizado { blob: Blob; filename: string; sha256: string | null }

/** Descarga el PDF de una versión FINALIZADA (el backend verifica su SHA-256 antes de entregarlo). */
export async function descargarPdfFinalizado(id: string, signal?: AbortSignal): Promise<PdfFinalizado> {
  let response: Response;
  try {
    response = await fetch(`${base}/revisions/${enc(id)}/pdf`, { method: 'GET', signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new DocumentApiError('NETWORK', 0);
  }
  if (!response.ok) throw errorFor(response.status, await response.json().catch(() => null));
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/pdf')) throw new DocumentApiError('INVALID_RESPONSE', response.status);
  const blob = await response.blob().catch(() => null);
  if (blob === null || blob.size === 0) throw new DocumentApiError('INVALID_RESPONSE', response.status);
  const nombre = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? '';
  return { blob, filename: SAFE_FILENAME.test(nombre) ? nombre : 'HOJA_FINALIZADA.pdf', sha256: response.headers.get('x-pdf-sha256') };
}

/** Textos para el usuario (nunca se muestra el cuerpo de la respuesta del servidor tal cual). */
export const documentErrorText: Record<DocumentErrorKind, string> = {
  INACTIVE: 'El gestor documental todavía no está activo en este entorno.',
  UNAUTHENTICATED: 'Tu sesión expiró. Inicia sesión de nuevo.',
  FORBIDDEN: 'No tienes permiso para esta operación.',
  NOT_FOUND: 'No se encontró el documento (o no tienes acceso a él).',
  VERSION_CONFLICT: 'El borrador cambió desde que lo abriste. Recárgalo para ver la versión vigente; tus cambios no guardados siguen en pantalla.',
  DOCUMENT_EXISTS: 'Ya existe un documento con ese código y variante. Si es tuyo, ábrelo desde «Mis borradores e historial»; si no lo ves, pertenece a otra cuenta.',
  OPEN_DRAFT_EXISTS: 'Este documento ya tiene un borrador o una finalización en curso.',
  NOT_EDITABLE: 'Esta revisión ya no admite cambios. Una revisión finalizada se corrige con una nueva revisión.',
  ALREADY_FINAL: 'Esta revisión ya está finalizada.',
  FINALIZACION_NO_LISTA: 'La revisión todavía no cumple los requisitos para finalizar.',
  REVISION_BLOQUEADA: 'No se puede registrar la revisión mientras la hoja tenga datos faltantes, errores o contradicciones sin reconocer. Guarda tus reconocimientos y vuelve a intentar.',
  PDF_NOT_AVAILABLE: 'No se puede finalizar: la generación de PDF no está disponible en este entorno. La revisión sigue como borrador.',
  FINALIZACION_EN_CURSO: 'Hay una finalización en curso (menos de 10 minutos). Espera o cancélala si la iniciaste tú.',
  FINALIZACION_PERDIDA: 'La finalización fue cancelada o reclamada por otra sesión; no se registró ningún PDF.',
  CLIENTE_NO_VALIDO: 'El cliente vinculado ya no está activo. Identifica otro cliente antes de finalizar.',
  CLIENTE_ACTUALIZADO: 'El nombre del cliente cambió en el catálogo. Vuelve a seleccionarlo y guarda antes de finalizar.',
  ELABORO_REQUERIDO: 'Indica el nombre de quien elaboró antes de confirmarlo.',
  INVALID_DATA: 'Algún dato no es válido para guardar (revisa longitudes y opciones).',
  INVALID_RESPONSE: 'La respuesta del servidor no tiene el formato esperado.',
  FIRMA_INVALIDA: 'La imagen de la firma no es válida.',
  FIRMA_NO_AUTORIZADA: 'No tienes autorización para usar una de las firmas seleccionadas. Elige otra o «Sin firma».',
  FIRMAS_NO_DISPONIBLES: 'Los responsables adicionales y las firmas todavía no están disponibles en este entorno.',
  FIRMA_NO_DISPONIBLE: 'Una firma asignada ya no está disponible para tu cuenta (autorización retirada o firma retirada). Cámbiala o quítala antes de finalizar.',
  RESPONSABLES_INVALIDOS: 'Los responsables no son válidos: el primero es siempre «Generó» y puede haber hasta tres.',
  SPEC_INVALID: 'El servidor rechazó los datos del documento porque no cumplen las reglas de la base de datos; la hoja no se finalizó y sigue como borrador. Avisa al administrador del Hub: puede faltar una actualización del entorno.',
  PDF_INTEGRITY: 'No se pudo verificar la integridad del PDF; no se entregó.',
  NETWORK: 'No se pudo comunicar con el servidor de Daubert Hub.',
  FAILED: 'La operación no se pudo completar. Intenta de nuevo.'
};

// ---------------------------------------------------------------- catálogo de firmas
export const capacidadesDocumentales = (signal?: AbortSignal): Promise<{ firmas: boolean; entorno?: 'PRUEBA' | 'PRODUCCION' }> => call('GET', '/capabilities', undefined, signal);
export const listarFirmas = (signal?: AbortSignal): Promise<{ data: FirmaVista[] }> => call('GET', '/signatures', undefined, signal);
export interface FirmaNueva { archivo: File; propietarioUsuarioId?: string; propietarioNombre?: string }

/** Sube una imagen JPG/PNG: el servidor valida su contenido real, la reduce y la vuelve a codificar (el cliente solo hace una comprobación previa para avisar pronto). */
export async function subirFirma(nueva: FirmaNueva): Promise<FirmaVista> {
  const form = new FormData();
  form.append('archivo', nueva.archivo);
  if (nueva.propietarioUsuarioId) form.append('propietarioUsuarioId', nueva.propietarioUsuarioId);
  if (nueva.propietarioNombre) form.append('propietarioNombre', nueva.propietarioNombre);
  let response: Response;
  try {
    response = await fetch(`${base}/signatures`, { method: 'POST', body: form });
  } catch {
    throw new DocumentApiError('NETWORK', 0);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorFor(response.status, json);
  if (typeof json !== 'object' || json === null) throw new DocumentApiError('INVALID_RESPONSE', response.status);
  return json as FirmaVista;
}
export const autorizacionesDeFirma = (firmaId: string, signal?: AbortSignal): Promise<{ data: AutorizacionFirma[] }> => call('GET', `/signatures/${enc(firmaId)}/authorizations`, undefined, signal);
export const autorizarUsoDeFirma = (firmaId: string, usuarioId: string): Promise<{ ok: true }> => call('POST', `/signatures/${enc(firmaId)}/authorize`, { usuarioId });
export const revocarUsoDeFirma = (firmaId: string, usuarioId: string): Promise<{ ok: true }> => call('POST', `/signatures/${enc(firmaId)}/revoke`, { usuarioId });

// ---------------------------------------------------------------- gestión administrativa (solo descripción; nunca la imagen)
export interface FirmaAdministrativa {
  id: string; propietarioUsuarioId: string | null; propietario: string; cuenta: 'ACTIVE' | 'INACTIVE' | 'SIN_CUENTA'; estado: 'ACTIVA' | 'RETIRADA';
  creadaEn: string; retiradaEn: string | null; subidaPor: string | null; incorporadaPor: string | null; autorizaciones: number | null; registradaPorMi: boolean;
}
export const listarFirmasAdministrativas = (consulta: { propietarioUsuarioId: string } | { sinCuenta: true }, signal?: AbortSignal): Promise<{ data: FirmaAdministrativa[]; alcance: string }> =>
  call('GET', `/signatures-admin?${'sinCuenta' in consulta ? 'sinCuenta=true' : `propietarioUsuarioId=${enc(consulta.propietarioUsuarioId)}`}`, undefined, signal);
export const retirarFirma = (firmaId: string): Promise<{ ok: true }> => call('POST', `/signatures/${enc(firmaId)}/retire`, {});
