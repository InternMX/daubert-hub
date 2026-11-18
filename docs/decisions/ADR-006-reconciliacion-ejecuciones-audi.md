# ADR-006 Reconciliación de ejecuciones Audi

- **Status:** Propuesto
- **Fecha:** 2026-11-18

## Context

Audi reserva folios con el asignador legado y registra las remisiones después de generar los PDF. Si el proceso falla entre ambos pasos, el Hub carece de evidencia para distinguir un rango sin archivos de una emisión parcial. El modelo atómico vincula cada reserva y sus remisiones pendientes a la ejecución.

El 18 de noviembre de 2026, la ejecución Audi 30 (n8n 16050) reservó los folios 983–987 y generó los PDF, pero las remisiones quedaron sin registrar. La recuperación manual dejó la ejecución en `COMPLETADA`. Los datos de este incidente deben preservarse sin modificaciones y quedan fuera de las pruebas y del procedimiento de integración.

[ADR-004](ADR-004-reproceso-ejecucion-hija-inmutable.md) sigue vigente para Caterpillar y para REPROCESS de Audi.

- Los folios consumidos no se reutilizan.
- Los archivos y la evidencia no se eliminan.
- Las ejecuciones `LEGACY` requieren recuperación manual. STOP puede solicitar la detención de una ejecución en curso con ID de n8n.
- Las acciones quedan deshabilitadas sin integración con n8n.

## Decision

Para Audi, RECONCILE es una excepción explícita a la regla de inmutabilidad de [ADR-004](ADR-004-reproceso-ejecucion-hija-inmutable.md). PostgreSQL conserva la ejecución en `ERROR` durante el intento y sólo permite `ERROR → COMPLETADA` con los folios originales y evidencia vigente de todos los PDF, incluidas las hojas de identificación. Si el intento vence antes del cierre, otro RECONCILE puede finalizar la ejecución mientras siga en `ERROR` con reserva `RESERVADA`, incluso con toda la evidencia ya registrada.

REPROCESS conserva el modelo de ejecución hija con folios nuevos. Requiere un padre sin remisiones vigentes, sin reserva activa y sin evidencia histórica. La admisión valida el token del intento, conserva intacto al padre y vincula una única hija al intento completado. CANCEL exige verificar que la emisión se detuvo y que el inventario está vacío. STOP solicita detener n8n y deja el estado de PostgreSQL intacto.

## Consequences

- Cada intento conserva su propio estado, historial y arrendamiento renovable. El token de fencing impide escrituras de un intento vencido. Se prohíbe actualizar intentos terminales y borrar cualquier intento.
- La evidencia se conserva por versión. Una cancelación que descubre archivos conserva esa evidencia y falla.
- La migración 027 es exclusiva de TEST y sigue sin aplicarse. R2, R3 y R4 bloquean tanto su aplicación en `daubert_hub_test` como la integración del worker. Cada gate requiere evidencia y aprobación explícita. [Recuperación Audi](../automations/audi/recovery.md)

## Alternatives Considered

Crear siempre una ejecución hija sigue siendo apropiado para un reproceso limpio. Una emisión parcial requiere reconciliar la ejecución que posee los folios y los archivos ya generados. Mantener la asignación legada deja los casos históricos sujetos al procedimiento manual.
