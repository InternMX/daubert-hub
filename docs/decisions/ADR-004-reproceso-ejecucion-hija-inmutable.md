# ADR-004 Reproceso mediante ejecución hija inmutable

- **Status:** Aceptado (implementado; en PROD desde 2026-09-24). Registrado retroactivamente.

## Context

Una ejecución en `ERROR` o `CANCELADA` no se reintenta automáticamente (el ciclo devuelve `ALREADY_ERROR`/`ALREADY_CANCELLED`). Un administrador necesita reintentar de forma controlada, sin perder el historial ni arriesgar folios duplicados.

Evidencia: migración 009 (`reproceso_de_id`, índice único parcial, `ALREADY_REPROCESSED`), `CaterpillarReprocessDialog` ("Se creará una nueva ejecución vinculada a la original. La ejecución original no será modificada."), nota de despliegue 12C, comentarios del servicio/controlador.

## Decision

Un reproceso **crea una ejecución hija nueva** (`reproceso_de_id` = id del padre) y la procesa con el pipeline normal. La ejecución original permanece **inmutable** y no se reutiliza. Un padre tiene **como máximo un hijo directo**, garantizado por el índice único parcial `uq_ejecuciones_automatizacion_reproceso_unico`; una solicitud repetida se resuelve de forma idempotente (`ALREADY_PROCESSING` / `ALREADY_REPROCESSED`) sin propagar `23505`. La hija reserva **folios nuevos**. El Hub sólo envía `executionId` y `reason`; n8n y PostgreSQL resuelven todo lo demás.

## Consequences

- Historial íntegro: original y hija coexisten; la UI muestra "Reproceso de #N".
- Idempotencia fuerte por restricción de base, no por locks del Hub: doble clic o reintentos tras timeout son seguros.
- Los folios de la original (reservas `ABANDONADA`) **no** se reutilizan; el reproceso consume folios nuevos.
- No hay reapertura de ejecuciones: para "corregir" una original se necesita siempre otra ejecución.
- La 009 restringe su propio rollback: el `down` aborta si existe cualquier reproceso.
- El primer `REPROCESS_CREATED` real en PROD está diferido hasta que exista un `ERROR`/`CANCELADA` real.
- Abierto: si una hija en `ERROR` puede a su vez reprocesarse (PostgreSQL no lo impide; depende del workflow).

## Alternatives Considered

No hay evidencia documentada de alternativas evaluadas. (El diálogo y los comentarios sólo afirman que la original nunca se muta ni se reabre.)
