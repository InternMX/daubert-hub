# Notas de despliegue

Registro puntual de promociones a PROD (qué se promovió, verificación, pendientes y rollback). **Sin secretos.** Al promover un cambio, añade una nota con el formato de la existente y enlázala aquí.

| Fecha | Nota | Tema |
| --- | --- | --- |
| 2026-10-07 | [hub-v1.0.1-prod](2026-10-07-hub-v1.0.1-prod.md) | Daubert Hub v1.0.1 (commit `0814e94`): Hub API + Web desde `main` con `-AcknowledgeN8nAlreadyApplied`; sin migraciones ni cambios en n8n; `APP_VERSION` sigue en `0.9.0-pilot.2` |
| 2026-10-01 | [hub-v1-prod](2026-10-01-hub-v1-prod.md) | Daubert Hub V1 (`0.9.0-pilot.2`, commit `fbda7c6`): Hub API + Web desde `main`; sin migraciones ni cambios en n8n |
| 2026-09-25 | [payment-notification-config-prod](2026-09-25-payment-notification-config-prod.md) | Configuración de Notificaciones de pago por empresa desde el Hub (migración 011, API + Web; n8n sin cambios) |
| 2026-09-24 | [caterpillar-12c-prod](2026-09-24-caterpillar-12c-prod.md) | Reproceso manual de Caterpillar (migración 009, Hub, workflow n8n) |

Contexto: [database/migrations](../database/migrations.md) · [caterpillar/production-runbook](../automations/caterpillar/production-runbook.md).
