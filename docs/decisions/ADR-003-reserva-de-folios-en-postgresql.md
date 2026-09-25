# ADR-003 Reserva de folios en PostgreSQL

- **Status:** Aceptado (implementado). Registrado retroactivamente el 2026-09-24.

## Context

Cada remisión necesita un folio consecutivo y único por serie, y varios actores pueden tocar el contador: ciclos de n8n (potencialmente concurrentes), reintentos, reprocesos y ajustes manuales desde el Hub.

Evidencia:

- `operacion.reservar_folios_para_ejecucion(ejecucion, serie, cantidad)` reserva un rango contiguo **de forma atómica e idempotente** (advisory lock por ejecución+serie, `FOR UPDATE` de la serie, `UNIQUE(ejecucion_id, serie_id)`), y avanza `siguiente_folio` en la misma transacción.
- El ledger `operacion.reservas_folios` (`RESERVADA` → `APLICADA`/`ABANDONADA`) enlaza cada rango con su ejecución.
- `fn_finalizar_ejecucion_automatizacion` exige integridad de completitud antes de `COMPLETADA`.
- Existe un allocator anterior, `operacion.reservar_folios(text, integer)`, usado por Audi; el rol de TEST de Caterpillar tiene prohibido ejecutarlo (runner `caterpillar-model`).
- El Hub (`daubert_hub_app`) **no** puede ejecutar el allocator (verificado por el runner).

## Decision

Los folios se reservan **dentro de PostgreSQL**, por ejecución y serie, mediante una función `SECURITY DEFINER` que valida ownership (la serie debe ser ruta activa de la automatización) y estado (ejecución `PROCESANDO`, serie `ACTIVA`). n8n no calcula ni escribe folios por su cuenta. Los ajustes manuales pasan por un camino único, `ADMIN`-only, con concurrencia optimista y piso histórico ([document-series](../database/document-series.md)).

## Consequences

- Sin duplicados ni huecos por concurrencia; reintentos devuelven la misma reserva.
- **Pueden existir "huecos" administrativos**: las reservas `ABANDONADA` (ejecución en `ERROR`/`CANCELADA`) siguen ocupando su rango y nunca se reciclan silenciosamente.
- Un reproceso **siempre** reserva folios nuevos ([ADR-004](ADR-004-reproceso-ejecucion-hija-inmutable.md)).
- Editar `siguiente_folio` directamente en la base se salta todas estas defensas: no debe hacerse.
- Los folios también existen como PDFs fuera de la base, por lo que mover el contador hacia atrás exige confirmación operativa del filesystem.
- Convivencia de dos mecanismos (allocator legacy de Audi y reservas por ejecución de Caterpillar) hasta que se documente/decida su unificación (pendiente, [audi](../automations/audi/README.md)).

## Alternatives Considered

La evidencia sólo muestra el allocator anterior (`reservar_folios(text, integer)`), aún presente. No hay más alternativas documentadas.
