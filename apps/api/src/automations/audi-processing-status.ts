// Shared between the Automations overview (automations/overview) and the Remisiones Audi
// processing-history endpoint (automations/remisiones-audi) so both surfaces map
// ops.ejecuciones_automatizacion.estado to the same outcome vocabulary — never two divergent
// copies of this rule (Phase 10F §13).
export type AudiProcessingOutcome = 'COMPLETED' | 'FAILED' | 'PROCESSING' | 'CANCELLED';

const AUDI_EXECUTION_STATE_MAP: Readonly<Record<string, AudiProcessingOutcome>> = {
  COMPLETADA: 'COMPLETED',
  ERROR: 'FAILED',
  PROCESANDO: 'PROCESSING',
  CANCELADA: 'CANCELLED'
};

export function mapAudiExecutionState(estado: string): AudiProcessingOutcome | null {
  return AUDI_EXECUTION_STATE_MAP[estado] ?? null;
}
