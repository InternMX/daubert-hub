import { apiBaseUrl } from './api';

// Vista previa HTML de una hoja de manufactura: POST /api/manufacturing-sheets/previews. La composición (plantillas aprobadas) la hace NestJS; el navegador solo recibe el HTML
// resultante y lo muestra en un iframe aislado. No se guarda nada.

export type PreviewFamilyCode = 'BOLSA_PLANA_1' | 'HOJA_PAQ';

export interface SheetPreviewResponse {
  html: string;
  familia: PreviewFamilyCode;
  /** Siempre un borrador sin aprobar con firmas SIN FIRMA. */
  borrador: true;
  firmas: 'SIN_FIRMA';
  completo: boolean;
  faltantes: string[];
  advertencias: string[];
}

export type SheetPreviewErrorKind = 'INVALID_DATA' | 'UNAUTHENTICATED' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'NETWORK';

export class SheetPreviewError extends Error {
  constructor(public readonly kind: SheetPreviewErrorKind, public readonly status: number) {
    super('Sheet preview failed');
  }
}

function isPreview(body: unknown): body is { data: SheetPreviewResponse } {
  if (typeof body !== 'object' || body === null || !('data' in body)) return false;
  const d = (body as { data: unknown }).data as Record<string, unknown> | null;
  return typeof d === 'object' && d !== null && typeof d.html === 'string' && d.borrador === true && d.firmas === 'SIN_FIRMA'
    && Array.isArray(d.faltantes) && Array.isArray(d.advertencias) && typeof d.completo === 'boolean';
}

export async function previewManufacturingSheet(familia: PreviewFamilyCode, datos: Record<string, string>, signal?: AbortSignal): Promise<SheetPreviewResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/manufacturing-sheets/previews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ familia, datos }), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new SheetPreviewError('NETWORK', 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new SheetPreviewError(response.status === 400 ? 'INVALID_DATA' : response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE', response.status);
  if (!isPreview(body)) throw new SheetPreviewError('INVALID_RESPONSE', response.status);
  return body.data;
}
