# ADR-001 PostgreSQL como fuente de verdad operativa

- **Status:** Aceptado (implementado). Registrado retroactivamente el 2026-09-24.

## Context

Las automatizaciones (n8n) y el Hub necesitan compartir estado: qué archivos se procesaron, qué folios se emitieron, qué falló. La evidencia del sistema:

- El `README.md` describe PostgreSQL como persistente y **fuera de Docker**; n8n también queda fuera y es "orchestration-only".
- La migración `20260922_003` documenta que "PostgreSQL became authoritative" para Audi en un *cutover* y que la ausencia de filas en PostgreSQL **no** prueba que folios anteriores al corte no se usaran (había historial fuera de PostgreSQL).
- El Hub nunca infiere estado de negocio: por ejemplo, el ruteo sale exclusivamente de `ops.automatizacion_series_proceso`, no de parsear códigos de serie.

## Decision

PostgreSQL es la **fuente de verdad operativa**. El estado de ejecuciones, folios, reservas, remisiones y rutas vive ahí, y las reglas de integridad (idempotencia, ownership, integridad de completitud) se implementan en la base mediante restricciones, índices únicos y funciones `SECURITY DEFINER`, no en el workflow ni en el frontend.

## Consequences

- n8n y el Hub son intercambiables/reiniciables sin perder estado; un workflow puede repetir un paso de forma segura.
- Los cambios de reglas requieren migraciones y su proceso (precheck/backup/aplicar/postcheck).
- La base es un **punto único de fallo** y de recuperación: el plan de backup/restore es crítico y hoy está **pendiente** ([backup-restore](../operations/backup-restore.md)).
- Lo que está fuera de PostgreSQL (archivos, PDFs, workflows n8n) debe respaldarse por separado.
- Los folios anteriores a un corte pueden existir fuera de la base: por eso existe `folio_minimo_ajustable` explícito.

## Alternatives Considered

No hay evidencia documentada de alternativas evaluadas.
