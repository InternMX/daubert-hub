import { apiBaseUrl } from './api';

// Consulta de productos de BIND ERP para manufactura. El navegador SOLO habla con el backend de Daubert Hub
// (GET /api/manufacturing-sheets/bind-products/by-code/:code): nunca con BIND, y ninguna credencial de BIND existe en el frontend.
// El frontend no interpreta títulos: consume el resultado (campos, pendientes y advertencias) calculado por NestJS.

export type Origen = 'EXTRAIDO' | 'SUGERIDO' | 'PENDIENTE';

export interface CampoInterpretado<T> {
  valor: T | null;
  origen: Origen;
  fuente: string | null;
  nota?: string;
}

export interface BindProductoOriginal {
  ID: string;
  Code: string;
  Title: string;
  Description: string | null;
  Weight: number | string | null;
  /** Fecha de alta en BIND; NO es la fecha de emisión de la hoja. */
  CreationDate: string | null;
}

export interface AdvertenciaBind {
  codigo: string;
  mensaje: string;
  campos: string[];
}

export interface CalibreInterpretado {
  valorOriginal: string;
  unidadOriginal: string | null;
}

export interface CantidadInterpretada {
  cantidad: number;
  unidad: 'BOLSAS' | 'HOJAS' | null;
}

export interface InterpretacionBind {
  campos: {
    codigoDcmx: CampoInterpretado<string>;
    tipo: CampoInterpretado<'BOLSA' | 'HOJA' | 'PAPEL'>;
    resina: CampoInterpretado<'PMG' | 'CP5000' | 'NAT' | 'ESD' | 'XOW'>;
    ancho: CampoInterpretado<number>;
    largo: CampoInterpretado<number>;
    unidadDimensiones: CampoInterpretado<'IN' | 'MM' | 'CM'>;
    calibre: CampoInterpretado<CalibreInterpretado>;
    presentacion: CampoInterpretado<'ROLLO' | 'PAQUETE'>;
    cantidad: CampoInterpretado<CantidadInterpretada>;
    pesoLb: CampoInterpretado<number>;
  };
  familia: { valor: null; estado: 'PENDIENTE_CONFIRMACION'; posiblesEstaFase: string[] };
  pendientes: string[];
  advertencias: AdvertenciaBind[];
}

export interface BindProductLookup {
  origen: 'BIND';
  producto: BindProductoOriginal;
  interpretacion: InterpretacionBind;
  datosSugeridosPlantilla: Record<string, string>;
  familiaSugerida: string[];
  pendientes: string[];
  advertencias: AdvertenciaBind[];
  /** La especificación todavía no está confirmada: nada se ha guardado ni aprobado. */
  especificacionConfirmada: false;
}

export type BindProductErrorKind = 'INVALID_CODE' | 'NOT_FOUND' | 'MULTIPLE_MATCHES' | 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'BIND_UNAVAILABLE' | 'TIMEOUT' | 'FORBIDDEN' | 'UNAUTHENTICATED' | 'INVALID_RESPONSE' | 'NETWORK';

export class BindProductApiError extends Error {
  constructor(public readonly kind: BindProductErrorKind, public readonly status: number) {
    super('BIND product lookup failed');
  }
}

// Mismas reglas que valida el backend: letras, dígitos, punto, guion y guion bajo; máximo 64.
export const BIND_CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function kindForStatus(status: number): BindProductErrorKind {
  if (status === 400) return 'INVALID_CODE';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'MULTIPLE_MATCHES';
  if (status === 503) return 'RATE_LIMITED';
  if (status === 504) return 'TIMEOUT';
  return 'BIND_UNAVAILABLE';
}

function isLookup(body: unknown): body is { data: BindProductLookup } {
  if (typeof body !== 'object' || body === null || !('data' in body)) return false;
  const data = (body as { data: unknown }).data;
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  const producto = d.producto as Record<string, unknown> | undefined;
  const interpretacion = d.interpretacion as { campos?: unknown; familia?: unknown } | undefined;
  return d.origen === 'BIND'
    && typeof producto === 'object' && producto !== null && typeof producto.Code === 'string' && typeof producto.Title === 'string' && typeof producto.ID === 'string'
    && typeof interpretacion === 'object' && interpretacion !== null && typeof interpretacion.campos === 'object' && interpretacion.campos !== null
    && Array.isArray(d.advertencias) && Array.isArray(d.pendientes);
}

// 503 puede ser «BIND sin configurar» o «límite de BIND»: el filtro global del Hub oculta el código en las respuestas 5xx, así que ambos se presentan como no disponible.
export async function lookupBindProductByCode(code: string, signal?: AbortSignal): Promise<BindProductLookup> {
  const limpio = code.trim();
  if (!BIND_CODE_PATTERN.test(limpio)) throw new BindProductApiError('INVALID_CODE', 0);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/manufacturing-sheets/bind-products/by-code/${encodeURIComponent(limpio)}`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new BindProductApiError('NETWORK', 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new BindProductApiError(kindForStatus(response.status), response.status);
  if (!isLookup(body)) throw new BindProductApiError('INVALID_RESPONSE', response.status);
  return body.data;
}
