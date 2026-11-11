# Notas de despliegue

Registro puntual de promociones a PROD (qué se promovió, verificación, pendientes y rollback). **Sin secretos.** Al promover un cambio, añade una nota con el formato de la existente y enlázala aquí.

| Fecha | Nota | Tema |
| --- | --- | --- |
| 2026-10-28 | [hub-v1.1.0-prod](2026-10-28-hub-v1.1.0-prod.md) | Daubert Hub **v1.1.0** (commit `6909dc8`, tag `v1.1.0`; PR #19 y #20): formaliza la versión, añade el CI de pull requests y corrige las vulnerabilidades npm de producción de la API; solo la API se recreó; sin migraciones ni cambios en n8n; cierre de Nginx de ~2 min 11 s; siete verificaciones visuales aprobadas; validación de negocio de n8n sigue pendiente |
| 2026-10-27 | [hub-pagos-caterpillar-joint-prod](2026-10-27-hub-pagos-caterpillar-joint-prod.md) | Despliegue conjunto Hub + Pagos + Caterpillar (commit `f099e31`, tag `release-2026-10-27-hub-pagos-cat`): migraciones 019/013/rol/016, workflows `pagosProdAsignaciones01` (111), `pagosProdRecuperacion01` (106) y `catProd016Remisiones01` (62), respaldos, ejecuciones CAT protegidas y pendientes; el Hub mostró `1.0.6` porque no se subió la versión; `1.1.0` preparado |
| 2026-10-27 | [post-release-cleanup-plan](2026-10-27-post-release-cleanup-plan.md) | Auditoría de limpieza posdespliegue (solo inventario, nada eliminado) y plan de aplicación de `1.1.0` |
| 2026-10-27 | [npm-prod-vulnerabilities-proposal](2026-10-27-npm-prod-vulnerabilities-proposal.md) | Propuesta (no aplicada) para las 4 vulnerabilidades npm de producción de la API: `body-parser`, `qs`, `multer` y `@nestjs/platform-express`; opciones, exposición real y evidencia de una copia desechable |
| 2026-10-22 | [payment-file-assignments-prod](2026-10-22-payment-file-assignments-prod.md) | Asignación puntual de archivos de Notificaciones de pago: migraciones PROD 015–017, Hub `6370753` (PR #14), workflow de Pagos v2 (108 nodos) y fases A/B; primer ZIP real pendiente |
| 2026-10-12 | [hub-v1.0.6-prod](2026-10-12-hub-v1.0.6-prod.md) | Daubert Hub v1.0.6 (commit `f182c2a`): reproceso de Notificaciones de Pago para `OMITIDO` reactivado y `HASH=` pendiente, y dependencias de producción de la API actualizadas; solo la API se recreó (Web sin cambios efectivos), con `-AcknowledgeN8nAlreadyApplied`; sin migraciones ni cambios en n8n |
| 2026-10-09 | [hub-v1.0.5-prod](2026-10-09-hub-v1.0.5-prod.md) | Daubert Hub v1.0.5 (commit `909c37e`): Fase 1 de Auditoría administrativa (solo ADMIN) en Hub API + Web desde `main` con `-AcknowledgeN8nAlreadyApplied`; sin migraciones ni cambios en n8n |
| 2026-10-07 | [hub-v1.0.1-prod](2026-10-07-hub-v1.0.1-prod.md) | Daubert Hub v1.0.1 (commit `0814e94`): Hub API + Web desde `main` con `-AcknowledgeN8nAlreadyApplied`; sin migraciones ni cambios en n8n; `APP_VERSION` sigue en `0.9.0-pilot.2` |
| 2026-10-01 | [hub-v1-prod](2026-10-01-hub-v1-prod.md) | Daubert Hub V1 (`0.9.0-pilot.2`, commit `fbda7c6`): Hub API + Web desde `main`; sin migraciones ni cambios en n8n |
| 2026-09-25 | [payment-notification-config-prod](2026-09-25-payment-notification-config-prod.md) | Configuración de Notificaciones de pago por empresa desde el Hub (migración 011, API + Web; n8n sin cambios) |
| 2026-09-24 | [caterpillar-12c-prod](2026-09-24-caterpillar-12c-prod.md) | Reproceso manual de Caterpillar (migración 009, Hub, workflow n8n) |
| 2026-11-11 | [primer piloto CI/CD](2026-11-11-hub-cicd-pilot-prod.md) | Daubert Hub v1.1.1 (`de13370`): primer despliegue supervisado con CI/CD, cierre controlado y siete pruebas funcionales aprobadas. |

Contexto: [database/migrations](../database/migrations.md) · [caterpillar/production-runbook](../automations/caterpillar/production-runbook.md).
