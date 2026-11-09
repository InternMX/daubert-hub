import { apiBaseUrl } from './api';

export interface FolioRecoveryAssessment {
  enabled: boolean;
  databaseEligible: boolean;
  eligible: boolean;
  parentId?: string;
  plant?: string;
  reservationId?: string;
  reservationStatus?: string;
  firstFolio?: string;
  lastFolio?: string;
  codes: string[];
  quarantine?: { state: string; sha256: string | null; fileCount: number };
}

const url = (id: string) => `${apiBaseUrl}/automations/remissions/caterpillar/executions/${encodeURIComponent(id)}/folio-recovery`;

export async function assessFolioRecovery(id: string): Promise<FolioRecoveryAssessment> {
  const response = await fetch(url(id));
  if (!response.ok) throw new Error('No fue posible verificar la recuperación. La opción permanece bloqueada.');
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) throw new Error('Respuesta de recuperación inválida.');
  const a = body as Record<string, unknown>;
  if (typeof a.enabled !== 'boolean' || typeof a.databaseEligible !== 'boolean' || typeof a.eligible !== 'boolean'
    || !Array.isArray(a.codes) || !a.codes.every(c => typeof c === 'string')
    || !['parentId','plant','reservationId','reservationStatus','firstFolio','lastFolio'].every(k => a[k] === undefined || typeof a[k] === 'string')) {
    throw new Error('Respuesta de recuperación inválida.');
  }
  if (a.quarantine !== undefined) {
    if (typeof a.quarantine !== 'object' || a.quarantine === null) throw new Error('Evidencia de cuarentena inválida.');
    const q = a.quarantine as Record<string, unknown>;
    if (typeof q.state !== 'string' || (q.sha256 !== null && typeof q.sha256 !== 'string')
      || typeof q.fileCount !== 'number' || !Number.isSafeInteger(q.fileCount) || q.fileCount < 0) throw new Error('Evidencia de cuarentena inválida.');
  }
  return body as FolioRecoveryAssessment;
}

export async function prepareFolioRecovery(id: string, requestId: string, reason: string, confirmedNoDelivery: boolean) {
  const response = await fetch(url(id), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, reason, confirmedNoDelivery }) });
  if (!response.ok) throw new Error('No se pudo preparar la recuperación. Actualiza las comprobaciones; no se solicitó un reproceso convencional.');
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('requestId' in body) || body.requestId !== requestId
    || !('state' in body) || !['PREPARING','READY','RESERVED','REJECTED'].includes(String(body.state))) throw new Error('Respuesta de preparación inválida.');
  return body as { requestId: string; state: string };
}
