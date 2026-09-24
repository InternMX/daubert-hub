# Notificaciones de pago

> **Estado documental: PENDIENTE (esqueleto).** En la Fase D1 no se documenta a profundidad. Sólo se registran hechos verificados en el repositorio y lo que falta.

## Resumen (verificado)

| | |
| --- | --- |
| Código | `PAYMENT_NOTIFICATIONS` |
| Nombre en el Hub | Notificaciones de pago — "Revisa periódicamente nuevas notificaciones de pago." |
| Polling en el catálogo del Hub | 5 minutos |
| `integrationStatus` | `INTEGRATED`; capacidades: dashboard, historial y detalle |
| Modelo de datos (lo que lee el Hub) | `core.correos_notificacion_pago` y `core.resultados_notificacion_pago` (con `core.empresas` para el nombre); **no** usa el modelo de series/folios de las remisiones |
| Hub | `GET /api/automations/payment-notifications`, `GET …/:executionId`, `POST …/:executionId/reprocess` (**sin** restricción de rol: ADMIN y GENERAL), acuses de revisión |
| Reproceso | El Hub llama a un webhook n8n (`PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL`) con header `X-Daubert-Automation-Token` (`PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN`). Este cliente es deliberadamente más simple que el de Caterpillar: **no interpreta el cuerpo** de la respuesta de n8n; todo fallo se colapsa en un resultado saneado (`UPSTREAM_ERROR`). Resultados del Hub: `TRIGGERED`, `NOT_FOUND`, `NOT_ELIGIBLE`, `UPSTREAM_ERROR`. |
| Auditoría | `ops.automation_trigger_requests` (`action_type = REPROCESS`; el control "Ejecutar ahora" (`RUN`) se retiró porque el workflow ya hace polling por sí mismo) |
| Variables (sólo nombres) | `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL`, `PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN` — opcionales; si faltan, el reproceso devuelve un resultado saneado de "upstream no disponible". ⚠️ `compose.pilot.yaml` **no** las pasa al contenedor ([inconsistencia #13](../../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)) |

## Estado actual

Módulo del Hub implementado (dashboard, detalle, reproceso con controles seguros: commit `a2e21f4`). **Estado operativo, flujo del workflow, reglas de elegibilidad de reproceso (las decide n8n) y credenciales n8n: no verificados en esta fase.**

## Fuentes a revisar en Fase D2

| Fuente | Ubicación |
| --- | --- |
| Código Hub | `apps/api/src/automations/payment-notifications/`, `apps/api/src/recent-activity/payment-notification-activity.repository.ts`, `apps/web/src/automations/PaymentNotifications*.tsx` |
| Reglas de estado/elegibilidad | `payment-notification-status.ts`, `payment-notification-reason.ts` |
| Tests | `payment-notifications.*.spec.ts`, `payment-notifications.integration.runner.cjs` (incluido en `test:integration`) |
| Migraciones | Directorio externo (tablas `core.correos_notificacion_pago`/`resultados_notificacion_pago` y permisos del Hub): por localizar |
| Workflow n8n | No versionado: export pendiente |

## Documentos pendientes (plantilla basada en Caterpillar)

- [ ] `architecture.md`
- [ ] `workflow.md` (flujo lógico, cuándo se marca correo/resultado, envío de resumen)
- [ ] `database-contract.md` (tablas propias; sin folios)
- [ ] `reprocessing.md` (elegibilidad y contrato real del webhook; hoy sólo se conoce el lado Hub)
- [ ] `testing.md`
- [ ] `production-runbook.md`
- [ ] `troubleshooting.md`

Plantilla: [automations/README.md](../README.md#plantilla-de-documentación-por-automatización).
