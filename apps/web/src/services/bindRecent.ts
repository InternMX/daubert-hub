import { apiBaseUrl } from './api';
import type { FamilyCode } from './manufacturingFamilies';

// Novedades del catálogo de BIND: GET /api/manufacturing-sheets/bind-products/recent. El navegador SOLO habla con el backend de Daubert Hub; la consulta a BIND, el orden por fecha de alta
// y la clasificación (Title/Code) los hace NestJS. Aquí no se interpreta ningún título.

/** COMPATIBLE: familia sugerida sin contradicciones · POR_CONFIRMAR: familia sugerida con Title/Code contradictorios · SIN_PLANTILLA: papel, tubo… · SIN_FAMILIA: no identificable. */
export type CompatibilidadNovedad = 'COMPATIBLE' | 'POR_CONFIRMAR' | 'SIN_PLANTILLA' | 'SIN_FAMILIA';

export interface NovedadProducto {
  code: string;
  title: string;
  /** yyyy-mm-dd, solo si BIND entregó una fecha de alta confiable. */
  fechaAlta: string | null;
  familiaSugerida: FamilyCode | null;
  motivo: string;
  compatibilidad: CompatibilidadNovedad;
}

export interface NovedadesPagina {
  items: NovedadProducto[];
  skip: number;
  limit: number;
  nextSkip: number | null;
  generadoEn: string;
  desdeCache: boolean;
}

export type NovedadesErrorKind = 'RATE_LIMITED' | 'BIND_UNAVAILABLE' | 'TIMEOUT' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_RESPONSE' | 'NETWORK';

export class NovedadesApiError extends Error {
  constructor(public readonly kind: NovedadesErrorKind, public readonly status: number) {
    super('BIND recent products failed');
  }
}

const COMPATIBILIDADES: readonly string[] = ['COMPATIBLE', 'POR_CONFIRMAR', 'SIN_PLANTILLA', 'SIN_FAMILIA'];

function kindForStatus(status: number): NovedadesErrorKind {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 503) return 'RATE_LIMITED';
  if (status === 504) return 'TIMEOUT';
  return 'BIND_UNAVAILABLE';
}

function isItem(value: unknown): value is NovedadProducto {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return typeof o.code === 'string' && typeof o.title === 'string' && (o.fechaAlta === null || typeof o.fechaAlta === 'string') && (o.familiaSugerida === null || typeof o.familiaSugerida === 'string')
    && typeof o.motivo === 'string' && typeof o.compatibilidad === 'string' && COMPATIBILIDADES.includes(o.compatibilidad);
}

function isPagina(body: unknown): body is { data: NovedadesPagina } {
  if (typeof body !== 'object' || body === null || !('data' in body)) return false;
  const d = (body as { data: unknown }).data as Record<string, unknown> | null;
  return typeof d === 'object' && d !== null && Array.isArray(d.items) && d.items.every(isItem) && typeof d.skip === 'number' && typeof d.limit === 'number'
    && (d.nextSkip === null || typeof d.nextSkip === 'number') && typeof d.generadoEn === 'string' && typeof d.desdeCache === 'boolean';
}

export async function listBindRecent(options: { skip?: number; limit?: number; refresh?: boolean } = {}, signal?: AbortSignal): Promise<NovedadesPagina> {
  const params = new URLSearchParams({ skip: String(options.skip ?? 0), limit: String(options.limit ?? 30) });
  if (options.refresh) params.set('refresh', '1');
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/manufacturing-sheets/bind-products/recent?${params.toString()}`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NovedadesApiError('NETWORK', 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new NovedadesApiError(kindForStatus(response.status), response.status);
  if (!isPagina(body)) throw new NovedadesApiError('INVALID_RESPONSE', response.status);
  return body.data;
}
