# Remisiones Audi

> **Estado documental: PENDIENTE (esqueleto).** En la Fase D1 no se documenta a profundidad. Sólo se registran hechos verificados en el repositorio y lo que falta.

## Resumen (verificado)

| | |
| --- | --- |
| Código | `REMISIONES_AUDI` |
| Nombre en el Hub | Remisiones Audi — "Generación y control de remisiones." |
| Polling en el catálogo del Hub | 10 minutos (`automation-catalog.ts`) |
| `integrationStatus` en el catálogo | `INTEGRATED`; capacidades: dashboard e historial (sin detalle) |
| Serie documental | `REMISION_AUDI` (piso `folio_minimo_ajustable` sembrado en 969 en la migración `20260922_003`) |
| Rol n8n en PROD | `n8n_app` (rol ya usado por Remisiones Audi; Caterpillar lo comparte) |
| Hub | `GET /api/automations/remissions/audi/executions` (historial), ajuste de folio (`ADMIN`), acuses de revisión, actividad reciente |
| Modelo de datos | Mismo modelo `ops`/`operacion` que Caterpillar; propiedad serie↔automatización registrada en `ops.automatizacion_series_proceso` con `llave_proceso = 'AUDI'` (migración `20260922_004`) |

## Estado actual

Automatización en operación en PROD según la existencia de sus migraciones (`20260827_002…005`) y del módulo del Hub. **Estado operativo actual, flujo del workflow, rutas de archivos y procedimientos de reproceso: no verificados en esta fase.**

## Fuentes a revisar en Fase D2

| Fuente | Ubicación |
| --- | --- |
| Código Hub | `apps/api/src/automations/remisiones-audi/`, `apps/api/src/recent-activity/remisiones-audi-activity.repository.ts`, `apps/web/src/automations/AudiRemissionsPage.tsx` |
| Migraciones | Directorio externo: `20260826_001_remisiones_audi_v1` (TEST), `20260827_002…005_*_prod`, `20260828_002/003`, `20260922_002…004` |
| Función de reserva legacy | `operacion.reservar_folios(text, integer)` (allocator específico de Audi; `n8n_cat_test` **no** puede ejecutarlo) |
| Workflow n8n | No versionado: export pendiente |
| Tests | `audi-executions.*.spec.ts`, `audi-processing-status.spec.ts`, `remisiones-audi-activity.repository.spec.ts` |

## Documentos pendientes (plantilla basada en Caterpillar)

- [ ] `architecture.md` — componentes y responsabilidades
- [ ] `workflow.md` — flujo lógico (Mermaid) y nodos clave
- [ ] `database-contract.md` — tablas/funciones (incluido el allocator legacy y por qué difiere del de Caterpillar)
- [ ] `testing.md` — pruebas y promoción TEST → PROD
- [ ] `production-runbook.md` — estado y verificación en PROD
- [ ] `troubleshooting.md` — síntoma / causa / revisar / NO hacer / acción segura
- [ ] `reprocessing.md` — sólo si existe reproceso (no verificado)

Plantilla: [automations/README.md](../README.md#plantilla-de-documentación-por-automatización).
