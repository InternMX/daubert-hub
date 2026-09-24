# Despliegue del Hub

Fuentes: `deploy/README.md` (referencia de comandos, **no se duplica aquí**), `compose.pilot.yaml`, `docker/*`, `deploy/pilot.*.env.example`. Este documento aporta el orden, los chequeos y las trampas conocidas.

## Qué se despliega

Dos contenedores por entorno: `api` (NestJS, healthcheck contra `/api/health` que exige `database: connected`) y `web` (Nginx + SPA, sólo éste publica puerto). PostgreSQL y n8n **no** se despliegan aquí.

## Prerrequisitos

- Docker Desktop con Compose y WSL habilitado; PostgreSQL alcanzable en `host.docker.internal:5432`.
- Base y rol de aplicación **ya existentes**; el despliegue no crea credenciales ni migra.
- Archivo de entorno real (no versionado) creado desde el ejemplo: `deploy/pilot.test.env` o `deploy/pilot.prod.env`.
- Variables obligatorias de Compose: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `CATERPILLAR_REPROCESS_WEBHOOK_URL`, `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN`. `API_PORT` debe seguir en 3000.

> ⚠️ **Trampa conocida:** `deploy/pilot.prod.env.example` no incluye las dos variables `CATERPILLAR_REPROCESS_*`, pero Compose las exige. Añádelas al `pilot.prod.env` real (los valores por el canal seguro) o `config/up` fallará ([inconsistencia #2](../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)).

## Orden recomendado (PROD)

1. Confirmar que el archivo de entorno apunta a `daubert_global` y a `daubert_hub_app`.
2. Si el cambio requiere BD: aplicar antes la migración con su proceso ([migrations](../database/migrations.md)).
3. Si el cambio requiere n8n (p. ej. webhook nuevo): preparar/activar el workflow y su credencial **antes** de desplegar el Hub que lo llama.
4. `docker compose --project-name daubert-hub-prod --env-file deploy/pilot.prod.env -f compose.pilot.yaml config` (**cuidado**: imprime secretos interpolados).
5. `… up -d --build` (ver `deploy/README.md`). Opcional: fijar `APP_VERSION` y `GIT_COMMIT` en el shell antes del build para que `/api/health` los muestre.
6. Verificar (abajo).
7. Registrar en `docs/deployments/`.

TEST es análogo con `daubert-hub-test` y `pilot.test.env`.

## Verificación posterior

| Chequeo | Esperado |
| --- | --- |
| `docker compose … ps` | `api` *healthy*, `web` *running* |
| `GET /api/health` | `status: ok`, `database: connected`, `environment` = `PRODUCTION` (PROD) o `TEST`, `version`/`commit` esperados |
| Login en la web | Funciona. Nota: Compose no pasa `AUTH_COOKIE_SECURE` (cookie sin `Secure`; [inconsistencia #12](../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)) |
| `/automations` | Tarjetas cargan |
| Caterpillar | Historial carga; el reproceso **no** se prueba con ejecuciones reales (ver [runbook](../automations/caterpillar/production-runbook.md)) |

## Rollback del Hub

Volver a construir/levantar la versión anterior del código con el mismo `--project-name`/`--env-file`. Si el cambio incluyó migración o n8n, aplicar antes los rollbacks correspondientes con sus guards ([migrations](../database/migrations.md), [runbook Caterpillar](../automations/caterpillar/production-runbook.md#rollback)).

## Exposición externa (Cloudflare u otro)

Documentado sólo lo que dice el código para TEST (Cloudflare Quick Tunnel temporal). Procedimiento de exposición y TLS de PROD: **PENDIENTE**. Regla: sólo se publica el puerto `HUB_PORT` del contenedor `web`; ni la API, ni PostgreSQL, ni n8n.

## PENDIENTE

- Procedimiento de arranque automático al reiniciar el host Windows.
- Rotación de secretos (`DB_PASSWORD`, tokens de webhooks) y coordinación con n8n.
- Estrategia de logs y retención.
