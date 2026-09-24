# ADR-005 El Hub consume estado de automatizaciones y no reconstruye lógica de negocio

- **Status:** Aceptado (implementado). Registrado retroactivamente el 2026-09-24.

## Context

El Hub necesita mostrar y operar automatizaciones cuyo motor es n8n. La evidencia en el código muestra una postura consistente:

- El ruteo se lee **exclusivamente** de `ops.automatizacion_series_proceso`; nunca se deriva parseando `series_documentales.codigo` ni rutas de archivos.
- Cuando el proceso de una ejecución no puede determinarse sin ambigüedad (Torreón comparte serie), el Hub muestra "Proceso no determinado" en lugar de adivinar.
- `integrationStatus` y capacidades son un **catálogo estático confirmado a mano**, independiente de `ops.automatizaciones.estatus` y del estado de ejecuciones.
- La idempotencia del reproceso "no se reimplementa" en el Hub: se delega a n8n/PostgreSQL; el Hub sólo traduce el contrato.
- "React never calls n8n": el navegador sólo habla con la API; la API llama a n8n server-to-server y valida la forma de la respuesta.
- El Hub no toca Dropbox ni el filesystem; `pdf_path` es texto plano.
- El Hub sólo envía `executionId` y `reason` al webhook de reproceso.

## Decision

El Hub **consume el estado** que las automatizaciones dejan en PostgreSQL y expone acciones **administrativas acotadas** (ajuste de folio, reproceso, acuses de revisión). No reimplementa reglas de negocio de las automatizaciones (ruteo, folios, idempotencia, elegibilidad). Ante ambigüedad o contrato desconocido, **falla cerrado** y no adivina.

## Consequences

- El Hub puede fallar o reiniciarse sin afectar el procesamiento; n8n puede evolucionar sin reescribir el Hub, siempre que el contrato (tablas, funciones, webhook) se mantenga.
- Los cambios de contrato exigen actualizar cliente, servicio, controlador, UI y tests del Hub (p. ej. añadir un nuevo código de rechazo) además de la documentación.
- Algunos datos se muestran "incompletos" a propósito (proceso no determinado, catálogo estático) en lugar de inferirse.
- Existe riesgo de **desalineación** entre catálogo y realidad (p. ej. intervalo de 15 min en el catálogo vs 10 min real: [inconsistencia #1](../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)).
- La lógica real de las automatizaciones sólo es auditable en los workflows n8n, que **no** están versionados en este repositorio (deuda documental).

## Alternatives Considered

No hay evidencia documentada de alternativas evaluadas.
