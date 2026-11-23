import { AudiExecutionsApiError, type AudiRecoveryAction } from '../services/audiExecutions';

// Min/max display only — never proof that every folio in the interval exists (Phase 10F §15).
export function folioRangeLabel(firstFolio: string | null, lastFolio: string | null): string {
  if (firstFolio === null || lastFolio === null) return '—';
  if (firstFolio === lastFolio) return firstFolio;
  return `${firstFolio}–${lastFolio}`;
}

export const audiActionLabel: Record<AudiRecoveryAction, string> = {
  REPROCESS: 'Reprocesar', RECONCILE: 'Reconciliar', STOP: 'Detener', CANCEL: 'Cancelar'
};

const recoveryMessages: ReadonlyMap<string, string> = new Map([
  ['INTEGRATION_NOT_CONFIGURED', 'Integración con n8n pendiente'],
  ['RECOVERY_NOT_INSTALLED', 'La recuperación de Audi aún no está instalada.'],
  ['PENDING_RECONCILIATION', 'La reserva o las remisiones pendientes requieren reconciliación.'],
  ['PARTIAL_ARTIFACTS', 'La evidencia registrada impide el reproceso.'],
  ['PARTIAL_ARTIFACTS_REQUIRE_RECONCILIATION', 'Los archivos encontrados requieren reconciliación.'],
  ['LEGACY_EXECUTION', 'Esta ejecución histórica requiere recuperación manual.'],
  ['ACTION_IN_PROGRESS', 'Ya hay una acción en curso. Consulta el historial.'],
  ['ALREADY_REPROCESSED', 'Esta ejecución ya tiene un reproceso.'],
  ['ALREADY_COMPLETED', 'La ejecución ya está completada.'],
  ['ALREADY_CANCELLED', 'La ejecución ya está cancelada.'],
  ['NOT_ELIGIBLE_STATE', 'El estado actual de la ejecución impide esta acción.'],
  ['REMISSIONS_ISSUED', 'La ejecución tiene remisiones emitidas y no se puede cancelar.'],
  ['N8N_RUNNING', 'La ejecución de n8n sigue en curso.'],
  ['STALE_REVISION', 'La ejecución cambió. Revisa el detalle actualizado antes de reintentar.'],
  ['STALE_ATTEMPT', 'El intento ya no está vigente. Consulta el historial.'],
  ['NOT_FOUND', 'La ejecución no existe o no está disponible para Audi.'],
  ['FORBIDDEN', 'La acción requiere permisos de administrador.'],
  ['ROLE_NOT_ALLOWED', 'Tu rol actual no permite ejecutar acciones de recuperación.'],
  ['PASSWORD_CHANGE_REQUIRED', 'Cambia tu contraseña antes de continuar.'],
  ['CSRF_ORIGIN_NOT_ALLOWED', 'El origen de la solicitud no está permitido.'],
  ['INVALID_REQUEST', 'El identificador, el motivo o la revisión de la solicitud no son válidos.'],
  ['OUTSIDE_TEST_SCOPE', 'La integración de recuperación solo está habilitada en TEST.'],
  ['OUTSIDE_ALLOWED_SCOPE', 'La ejecución está fuera del alcance autorizado de la integración.'],
  ['NETWORK_ERROR', 'No se pudo confirmar el despacho a n8n. Consulta el historial antes de reintentar.'],
  ['INVALID_RESPONSE', 'n8n devolvió una respuesta no válida. Consulta el historial antes de reintentar.'],
  ['NOT_RUNNING', 'La ejecución de n8n ya no está en curso.'],
  ['ALREADY_FINISHED', 'La ejecución de n8n ya terminó.'],
  ['COMPLETADA', 'La acción ya está completada.'],
  ['FALLIDA', 'La acción falló. Consulta el historial.'],
  ['EXPIRADA', 'La acción venció. Consulta el historial.'],
  ['DISPATCHED', 'Acción enviada a n8n. Consulta el historial para ver el resultado.'],
  ['STOP_REQUESTED', 'Se solicitó la detención a n8n. Consulta el historial para ver el resultado.']
]);

export function audiRecoveryMessage(code: string | null): string {
  return recoveryMessages.get(code ?? '') ?? 'La acción no está disponible. Consulta el historial.';
}

const statusMessages: ReadonlyMap<number, string> = new Map([
  [0, 'No se pudo comunicar con el Hub. Consulta el historial antes de reintentar.'],
  [400, audiRecoveryMessage('INVALID_REQUEST')],
  [401, 'Tu sesión venció. Vuelve a iniciar sesión.'],
  [403, audiRecoveryMessage('FORBIDDEN')],
  [404, audiRecoveryMessage('NOT_FOUND')],
  [409, 'La acción entró en conflicto con el estado de la ejecución. Consulta el historial.'],
  [429, 'Se enviaron demasiadas solicitudes. Consulta el historial antes de reintentar.'],
  [500, 'Ocurrió un error interno. Consulta el historial antes de reintentar.'],
  [502, 'No se pudo confirmar la comunicación con n8n. Consulta el historial antes de reintentar.'],
  [503, 'El servicio de recuperación de Audi no está disponible.'],
  [504, 'No se pudo confirmar el resultado; revisa el historial antes de reintentar.']
]);

export function audiRecoveryErrorMessage(error: unknown): string {
  if (error instanceof AudiExecutionsApiError) {
    if (error.status === 504) return statusMessages.get(504)!;
    return recoveryMessages.get(error.code ?? '') ?? statusMessages.get(error.status)
      ?? 'No se pudo confirmar la acción. Consulta el historial antes de reintentar.';
  }
  return 'No se pudo confirmar la acción. Consulta el historial antes de reintentar.';
}
