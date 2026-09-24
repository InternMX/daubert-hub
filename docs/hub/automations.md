# Cómo el Hub trabaja con automatizaciones

Principio ([ADR-005](../decisions/ADR-005-hub-consume-estado-automatizaciones.md)): el Hub **consume estado** que n8n deja en PostgreSQL y ofrece unas pocas **acciones administrativas acotadas**. No reconstruye la lógica de negocio de las automatizaciones.

## Catálogo estático

`apps/api/src/automations/overview/automation-catalog.ts` define, para cada automatización, código, nombre, descripción, intervalo de polling, `integrationStatus` y capacidades (`hasDashboard`, `hasHistory`, `hasDetail`). Es información **confirmada a mano**, no derivada de la BD. `integrationStatus` **no** es lo mismo que `ops.automatizaciones.estatus` (`ACTIVA`/`INACTIVA`, que se lee de la BD por separado).

| Código | Polling en catálogo | Nota |
| --- | --- | --- |
| `REMISIONES_AUDI` | 10 min | ⚠️ El workflow real corre cada **15 min** (export, D2). |
| `PAYMENT_NOTIFICATIONS` | 5 min | |
| `REMISIONES_CATERPILLAR` | **15 min** | ⚠️ Difiere del intervalo real de **10 min** (export y nota 12C). Ver [inconsistencia #1](../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración). |

## Funcionalidades

| Funcionalidad | Endpoint(s) | Notas |
| --- | --- | --- |
| Centro de automatizaciones | `GET /automations/overview` | Combina catálogo + BD + salud; si una fuente falla, falla toda la respuesta (no muestra tarjetas sanas con datos faltantes) |
| Historial y detalle | `…/remissions/audi/executions`, `…/remissions/caterpillar/*`, `…/payment-notifications/*` | Sólo lectura |
| Ajuste seguro de folio | `PATCH /automations/:automationCode/document-series/:seriesCode` (ADMIN) | [document-series](../database/document-series.md) |
| Reproceso manual Caterpillar | `POST …/caterpillar/executions/:executionId/reprocess` (ADMIN) | [reprocessing](../automations/caterpillar/reprocessing.md) |
| Reproceso Notificaciones de pago | `POST …/payment-notifications/:executionId/reprocess` | [payment-notifications](../automations/payment-notifications/README.md) (pendiente) |
| Acuses de revisión | `POST /automations/:automationCode/review-acknowledgements` | Tabla `ops.automation_review_acknowledgements`; el Hub calcula el "último problema pendiente" y sólo ese es reconocible |
| Actividad reciente | `GET /recent-activity` | Repositorios por fuente: Audi, Caterpillar, Notificaciones de pago y ajustes de series; presentación común en `remission-activity-presentation.ts` |

## Auditoría

| Mecanismo | Qué registra | Dónde |
| --- | --- | --- |
| Variables de sesión `app.origin`/`request_id`/`user_id`/`user_email` + trigger `audit.fn_registrar_cambio` | Cambios en tablas con trigger de auditoría, con el usuario del Hub | Esquema `audit` |
| `ops.automation_trigger_requests` | Cada intento de acción manual sobre n8n: `automation_code`, `action_type` (`RUN`/`REPROCESS`), usuario, `outcome` (`TRIGGERED`/`NOTHING_TO_REPROCESS`/`UPSTREAM_ERROR`), `target_reference` | El Hub sólo tiene `INSERT` (nunca lo lee). Escritura *best-effort*: si falla, no hace fallar la acción |
| `operacion.ajustes_series` | Cada ajuste manual de folio: folio anterior/nuevo, motivo, usuario | Escrito en la misma transacción que el cambio |
| `ops.automation_review_acknowledgements` | Quién y cuándo reconoció un problema | |

Nota: el `reason` de un reproceso Caterpillar **no** se guarda en el Hub (ver [inconsistencia #10](../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)).

## Lo que el Hub NO hace

- No ejecuta pipelines, no genera PDFs, no reserva folios (el rol `daubert_hub_app` **no** puede ejecutar el allocator de folios).
- No accede a Dropbox ni al filesystem.
- No envía rutas, series, documento, planta, `llave_proceso` ni código de automatización a n8n en el reproceso: sólo `executionId` y `reason`.
