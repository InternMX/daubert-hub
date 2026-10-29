import { apiBaseUrl } from './api';
import type { FamilyCode, FieldKey } from './manufacturingFamilies';

// Vista previa HTML de una hoja de manufactura: POST /api/manufacturing-sheets/previews. La composición (plantillas aprobadas) la hace NestJS; el navegador solo recibe el HTML
// resultante y lo muestra en un iframe aislado. No se guarda nada.

export type PreviewFamilyCode = FamilyCode;
export interface BindReviewContext { title: string; code: string; composicionSeleccionada?: string }
export type NivelIncidencia = 'INFORMACION' | 'PENDIENTE' | 'CONTRADICCION' | 'ERROR';
export type SeccionIncidencia = 'familia' | 'bind' | 'datos' | 'color' | 'capas' | 'composicion' | 'medidas' | 'vista-previa';

/**
 * Modelo único de incidencias (lo define y autoriza el backend; ver preview/incidencias.ts en la API). El `id` describe la CAUSA (código + campo): dos orígenes que
 * describen el mismo problema comparten id y se cuentan una sola vez.
 */
export interface Incidencia {
  id: string;
  codigo: string;
  nivel: NivelIncidencia;
  /** Campos afectados (vacío si es de sección). Con un solo campo visible se muestra en el campo; con varios, en la sección. */
  campos: FieldKey[];
  seccion: SeccionIncidencia;
  mensaje: string;
  /** Texto breve para resúmenes y para la vista previa. */
  resumen?: string;
  origen: 'TITLE' | 'CODE' | 'CONCILIACION' | 'BIND' | 'SISTEMA' | 'FORMULARIO' | 'PLANTILLA';
  afectaVistaPrevia: boolean;
  reconocible: boolean;
}

export interface SheetPreviewResponse {
  html: string;
  familia: PreviewFamilyCode;
  /** Siempre un borrador sin aprobar con firmas SIN FIRMA. */
  borrador: true;
  firmas: 'SIN_FIRMA';
  /** Datos TÉCNICOS completos para la familia (el cliente no cuenta). */
  completo: boolean;
  faltantes: string[];
  advertencias: string[];
  /** Requisitos de una emisión futura que no impiden la demostración (p. ej. «Cliente»). */
  pendientesEmision: string[];
  /** Motivo por el que no se muestra el documento (p. ej. modalidad no autorizada); null si se muestra. */
  bloqueado: string | null;
  /** Lista única de incidencias de esta vista previa (sin duplicados por causa). `faltantes`, `advertencias` y `pendientesEmision` son proyecciones de ella. */
  incidencias?: Incidencia[];
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
    && Array.isArray(d.faltantes) && Array.isArray(d.advertencias) && Array.isArray(d.pendientesEmision) && typeof d.completo === 'boolean' && (d.bloqueado === null || typeof d.bloqueado === 'string');
}

export async function previewManufacturingSheet(familia: PreviewFamilyCode, datos: Record<string, string>, signal?: AbortSignal, contexto?: BindReviewContext): Promise<SheetPreviewResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/manufacturing-sheets/previews`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ familia, datos, ...(contexto ? { contexto } : {}) }), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new SheetPreviewError('NETWORK', 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new SheetPreviewError(response.status === 400 ? 'INVALID_DATA' : response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE', response.status);
  if (!isPreview(body)) throw new SheetPreviewError('INVALID_RESPONSE', response.status);
  return body.data;
}

// ---------------------------------------------------------------- PDF de borrador
// POST /api/manufacturing-sheets/previews/pdf: el backend recompone el MISMO documento de la vista previa (mismo DTO, plantilla y validaciones), le añade la identificación de borrador y lo
// imprime. El navegador solo envía los datos actuales y entrega el archivo; no genera ni modifica el documento.

export type SheetPdfErrorKind = 'BLOCKED' | 'NOT_AVAILABLE' | 'BUSY' | 'TIMEOUT' | 'INVALID_DATA' | 'UNAUTHENTICATED' | 'FAILED' | 'INVALID_RESPONSE' | 'NETWORK';

export class SheetPdfError extends Error {
  constructor(public readonly kind: SheetPdfErrorKind, public readonly status: number, public readonly detail?: string) {
    super('Sheet PDF failed');
  }
}

export interface DraftPdf { blob: Blob; filename: string; completo: boolean }

const SAFE_FILENAME = /^[A-Za-z0-9._-]{1,120}\.pdf$/;

function pdfKindForStatus(status: number): SheetPdfErrorKind {
  if (status === 400) return 'INVALID_DATA';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 422) return 'BLOCKED';
  if (status === 429) return 'BUSY';
  if (status === 501) return 'NOT_AVAILABLE';
  if (status === 504) return 'TIMEOUT';
  return 'FAILED';
}

export async function downloadDraftPdf(familia: PreviewFamilyCode, datos: Record<string, string>, signal?: AbortSignal, contexto?: BindReviewContext): Promise<DraftPdf> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/manufacturing-sheets/previews/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ familia, datos, ...(contexto ? { contexto } : {}) }), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new SheetPdfError('NETWORK', 0);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new SheetPdfError(pdfKindForStatus(response.status), response.status, response.status === 422 && typeof body?.message === 'string' ? body.message : undefined);
  }
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/pdf')) throw new SheetPdfError('INVALID_RESPONSE', response.status);
  const blob = await response.blob().catch(() => null);
  if (blob === null || blob.size === 0) throw new SheetPdfError('INVALID_RESPONSE', response.status);
  const nombre = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? '';
  return { blob, filename: SAFE_FILENAME.test(nombre) ? nombre : 'BORRADOR.pdf', completo: response.headers.get('x-draft-complete') !== '0' };
}

