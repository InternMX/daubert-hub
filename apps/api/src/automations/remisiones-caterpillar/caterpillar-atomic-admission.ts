import type { QueryResultRow } from 'pg';

export interface CaterpillarAtomicAdmissionInput {
  documentId: string;
  workerId: string; // Server-owned n8n $execution.id, NEVER supplied by a browser.
  seriesCode: string;
  quantity: number;
}
export interface CaterpillarAtomicAdmissionRow extends QueryResultRow {
  decision: 'ADMIT' | 'BLOCK' | 'REVIEW';
  reason: string;
  can_emit: boolean;
  worker_id: string | null;
  ejecucion_id: string | null;
  reserva_id: string | null;
  folio_inicial: string | null;
  folio_final: string | null;
  cantidad: number | null;
  legacy_unverified: number;
}
export function assertAtomicAdmissionInput(input: CaterpillarAtomicAdmissionInput): void {
  if (!/^[1-9]\d*$/.test(input.documentId) || BigInt(input.documentId)>9223372036854775807n ||
    !input.workerId || input.workerId.trim()!==input.workerId || input.workerId.length>128 ||
    !input.seriesCode || !Number.isInteger(input.quantity) || input.quantity<1 || input.quantity>2147483647) throw new Error('Invalid atomic admission input');
}
export function assertAtomicAdmissionResult(row: CaterpillarAtomicAdmissionRow | undefined, input: CaterpillarAtomicAdmissionInput,
  emittingReasons: readonly string[] = ['ACQUIRED','OWNED_RETRY']): CaterpillarAtomicAdmissionRow {
  if (!row || !['ADMIT','BLOCK','REVIEW'].includes(row.decision) || typeof row.can_emit!=='boolean' ||
    !Number.isInteger(row.legacy_unverified) || row.legacy_unverified<0) throw new Error('Invalid atomic admission response');
  if (row.can_emit) {
    const ids=[row.ejecucion_id,row.reserva_id,row.folio_inicial,row.folio_final];
    if (row.decision!=='ADMIT' || !emittingReasons.includes(row.reason) || row.worker_id!==input.workerId ||
      !ids.every(id=>typeof id==='string' && /^[1-9]\d*$/.test(id) && BigInt(id)<=9223372036854775807n) ||
      row.cantidad!==input.quantity || BigInt(row.folio_final!) - BigInt(row.folio_inicial!) + 1n!==BigInt(input.quantity)) throw new Error('Atomic emission right not proven');
  } else if (row.decision==='ADMIT') throw new Error('Admission without atomic reservation');
  return row;
}
