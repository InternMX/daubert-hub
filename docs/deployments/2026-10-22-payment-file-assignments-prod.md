# Asignación puntual de archivos de Notificaciones de pago – despliegue a PROD (2026-10-21/22)

Commit del Hub: **`6370753`** (merge del PR #14, `637075315918e732510d1a5ed903ca5937a6da23`; versión `1.0.6`). Estado: desplegado y verificado; **primer ZIP real pendiente de validar**. Sin secretos. Documento principal: [production-rollout](../automations/payment-notifications/production-rollout.md).

## Cronología

| Fecha (hora local) | Paso | Resultado |
| --- | --- | --- |
| 2026-10-21 | Migraciones PROD 015, 016 y 017 en `daubert_global` (manuales, administrador; precheck → up → postcheck cada una) | Correcto; permisos verificados en solo lectura |
| 2026-10-21 | Merge del PR #14 y despliegue del Hub (`api` y `web`) con banderas apagadas | Correcto; `/api/health` `ok`, commit `6370753` |
| 2026-10-22 | Cambio del workflow de Pagos: despublicar `3Dh72JJYROHtaw1X` (100 nodos) y publicar `pagosProdAsignaciones01` (108 nodos) | Correcto; un solo workflow de Pagos activo; webhook productivo en el nuevo (403 sin token) |
| 2026-10-22 | Primera ejecución programada del workflow nuevo (n8n 9716) | `success` (sin correos nuevos: no valida una notificación real) |
| 2026-10-22 | Fase A del Hub: `PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED=true` (recreación solo del `api`) | Correcto |
| 2026-10-22 | Fase B del Hub: `PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_READY=true` + `…_N8N_ORIGIN` | Correcto |

## Datos del release

| Elemento | Valor |
| --- | --- |
| Commit en PROD antes | `cbcb6f3` |
| Método Hub | Comandos manuales del [deployment-checklist](../operations/deployment-checklist.md) (`docker compose … up -d --build api web`; fases A/B: `up -d --no-build api`); `Deploy-DaubertHub.ps1 -Deploy` no se usó porque bloquea los releases con migraciones |
| Migraciones | `20261022_015`, `016`, `017` (`_prod`) |
| n8n | Workflow nuevo `pagosProdAsignaciones01`; el anterior `3Dh72JJYROHtaw1X` inactivo |
| Rollback ejecutado | **No** |

## Rollback disponible

- Hub: anclas `daubert-hub-api:rollback-cbcb6f3` / `daubert-hub-web:rollback-cbcb6f3` y `docker save` en `_hub_rollback\`; copias del `pilot.prod.env` previas a cada fase.
- Workflow: despublicar el nuevo y publicar el anterior sin editarlo (< 1 min, sin reiniciar n8n).
- Asignaciones: banderas del Hub (`…_N8N_READY=false`, luego `…_ENABLED=false`) sin detener Pagos.
- No se revierten las migraciones 015–017.

## Pendiente

Primer ZIP real procesado por el workflow nuevo: ejecutar el checklist de [production-rollout §E](../automations/payment-notifications/production-rollout.md#e-validación-y-pendientes) antes de usar la asignación y el reproceso puntual con datos reales.
