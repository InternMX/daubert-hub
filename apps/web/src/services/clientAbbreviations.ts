import { apiBaseUrl } from './api';

// Abreviaturas de cliente de las hojas de manufactura (TEST): /api/manufacturing-sheets/client-abbreviations/… El navegador NUNCA envía usuario, correo ni estado de resolución: la sesión lo fija.
// Una sugerencia jamás asigna un cliente: la interfaz exige la confirmación del usuario.

export type Alcance = 'GENERAL' | 'CONTEXTO' | 'CODIGO_COMPLETO';
export type EstadoAbreviatura = 'CANDIDATA' | 'PROPUESTA' | 'CONFIRMADA' | 'RECHAZADA' | 'INACTIVA';
export type AccionAbreviatura = 'CONFIRMAR' | 'RECHAZAR' | 'INACTIVAR' | 'REACTIVAR' | 'RETIRAR';
export type EstadoSugerencia = 'NO_HABILITADO' | 'SIN_SUGERENCIAS' | 'EXACTA' | 'ELEGIR';

export interface RespaldoSugerencia { id: string; abreviatura: string; alcance: Alcance; codigoPatron: string | null; estado: EstadoAbreviatura; documentos: number; codigos: number }
export interface AlternativaCliente { clienteId: string; cliente: string; nivel: number; nivelNombre: string; confirmada: boolean; respaldo: RespaldoSugerencia[] }
export interface Sugerencias { disponible: boolean; /** La cuenta es ADMIN: registra confirmado; si no, solo propone. */ puedeResolver: boolean; estado: EstadoSugerencia; codigo: string; alternativas: AlternativaCliente[]; relacionadas: AlternativaCliente[]; sinConfirmar: AlternativaCliente[] }
export interface AbreviaturaVista {
  id: string; abreviatura: string; alcance: Alcance; codigoPatron: string | null; estado: EstadoAbreviatura; origen: string; clienteId: string; cliente: string; documentos: number; codigos: number;
  evidencia: string | null; fuente: string | null; propuestaPor: string; resueltaPor: string | null; resueltaEn: string | null; motivo: string | null; creadaEn: string; actualizadaEn: string;
}
export interface NuevaAbreviatura { abreviatura: string; clienteId: string; alcance?: Alcance; codigoPatron?: string; evidencia?: string; soloProponer?: boolean }

export type AbbreviationErrorKind = 'CATALOGO_NO_HABILITADO' | 'ABREVIATURA_DUPLICADA' | 'ABREVIATURA_INVALIDA' | 'CLIENTE_INVALIDO' | 'TRANSICION_NO_PERMITIDA' | 'PATRON_REQUERIDO' | 'FORBIDDEN' | 'NOT_FOUND' | 'UNAUTHENTICATED' | 'INACTIVE' | 'NETWORK' | 'FAILED';
const KNOWN: ReadonlySet<string> = new Set(['CATALOGO_NO_HABILITADO', 'ABREVIATURA_DUPLICADA', 'ABREVIATURA_INVALIDA', 'CLIENTE_INVALIDO', 'TRANSICION_NO_PERMITIDA', 'PATRON_REQUERIDO', 'FORBIDDEN', 'NOT_FOUND']);

export class AbbreviationApiError extends Error {
  constructor(public readonly kind: AbbreviationErrorKind, public readonly status: number) { super('Client abbreviation request failed'); }
}
export const abbreviationErrorText: Record<AbbreviationErrorKind, string> = {
  CATALOGO_NO_HABILITADO: 'El catálogo de abreviaturas aún no está habilitado en este entorno.',
  ABREVIATURA_DUPLICADA: 'Esa abreviatura ya está registrada para ese cliente con el mismo alcance.',
  ABREVIATURA_INVALIDA: 'La abreviatura o su patrón no cumplen el formato (2 a 5 caracteres; el contexto y el código completo empiezan con la abreviatura) o falta el motivo.',
  CLIENTE_INVALIDO: 'El cliente debe ser una empresa activa con rol CLIENTE.',
  TRANSICION_NO_PERMITIDA: 'Esa acción no es posible en el estado actual de la abreviatura.',
  PATRON_REQUERIDO: 'Indica el código o el prefijo de contexto.',
  FORBIDDEN: 'No tienes permiso para esta acción.',
  NOT_FOUND: 'No se encontró la abreviatura.',
  UNAUTHENTICATED: 'Tu sesión terminó. Inicia sesión de nuevo.',
  INACTIVE: 'Esta función no está activa en este entorno.',
  NETWORK: 'No se pudo conectar con el servidor. Reintenta.',
  FAILED: 'No se pudo completar la operación.'
};

const base = `${apiBaseUrl}/manufacturing-sheets/client-abbreviations`;
async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AbbreviationApiError('NETWORK', 0);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof json === 'object' && json !== null && typeof (json as { code?: unknown }).code === 'string' ? (json as { code: string }).code : '';
    if (response.status === 401) throw new AbbreviationApiError('UNAUTHENTICATED', 401);
    if (response.status === 404 && code === '') throw new AbbreviationApiError('INACTIVE', 404);
    throw new AbbreviationApiError(KNOWN.has(code) ? (code as AbbreviationErrorKind) : response.status === 403 ? 'FORBIDDEN' : 'FAILED', response.status);
  }
  if (typeof json !== 'object' || json === null) throw new AbbreviationApiError('FAILED', response.status);
  return json as T;
}

const enc = encodeURIComponent;
export const estadoCatalogoAbreviaturas = (signal?: AbortSignal): Promise<{ disponible: boolean; puedeResolver: boolean }> => call('GET', '/status', undefined, signal);
export const sugerirClientes = (codigo: string, signal?: AbortSignal): Promise<Sugerencias> => call('GET', `/suggestions?codigo=${enc(codigo)}`, undefined, signal);
export const crearAbreviatura = (cuerpo: NuevaAbreviatura): Promise<AbreviaturaVista> => call('POST', '', cuerpo);
export const resolverAbreviatura = (id: string, accion: AccionAbreviatura, motivo?: string): Promise<AbreviaturaVista> => call('POST', `/${enc(id)}/resolve`, motivo ? { accion, motivo } : { accion });
export const listarAbreviaturas = (filtro: { estado?: EstadoAbreviatura; q?: string }, signal?: AbortSignal): Promise<{ disponible: boolean; data: AbreviaturaVista[]; conteos: Record<string, number> }> => {
  const p = new URLSearchParams();
  if (filtro.estado) p.set('estado', filtro.estado);
  if (filtro.q?.trim()) p.set('q', filtro.q.trim());
  const s = p.toString();
  return call('GET', s ? `?${s}` : '', undefined, signal);
};
