# Despliegue del Hub

Fuentes: `deploy/README.md` (referencia de comandos, **no se duplica aquí**), `compose.pilot.yaml`, `docker/*`, `deploy/pilot.*.env.example`. Este documento aporta el orden, los chequeos y las trampas conocidas.

> **Documento genérico (TEST) + orden de PROD.** Los nombres `daubert-hub-prod` y puerto `8080` de los ejemplos **no son los de PROD real**. PROD corre como proyecto Compose `daubert-hub`, puerto `8082`, con `compose.pilot.yaml` + `compose.prod-temp.yaml`, y se despliega con `scripts/deploy/Deploy-DaubertHub.ps1`. El procedimiento vigente de PROD (preflight, deploy, rollback manual y operaciones prohibidas, entre ellas `docker compose down`) está en [deployment-checklist.md](deployment-checklist.md).

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
4. Ejecutar el preflight y `Deploy-DaubertHub.ps1 -Preflight` / `-WhatIf` según [deployment-checklist.md](deployment-checklist.md). Evitar `docker compose … config` a mano: imprime secretos interpolados.
5. `Deploy-DaubertHub.ps1 -Deploy` (recrea solo `api` y `web`; ver la checklist). Opcional: fijar `APP_VERSION` y `GIT_COMMIT` en el shell antes del build para que `/api/health` los muestre.
6. Verificar (abajo).
7. Registrar en `docs/deployments/`.

TEST es análogo, con un proyecto Compose y un puerto propios y `pilot.test.env`; sus comandos están en `deploy/README.md`.

## Verificación posterior

| Chequeo | Esperado |
| --- | --- |
| `docker compose … ps` | `api` *healthy*, `web` *running* |
| `GET /api/health` | `status: ok`, `database: connected`, `environment` = `PRODUCTION` (PROD) o `TEST`, `version`/`commit` esperados |
| Login en la web | Funciona. Nota: Compose no pasa `AUTH_COOKIE_SECURE` (cookie sin `Secure`; [inconsistencia #12](../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)) |
| `/automations` | Tarjetas cargan |
| Caterpillar | Historial carga; el reproceso **no** se prueba con ejecuciones reales (ver [runbook](../automations/caterpillar/production-runbook.md)) |

## Rollback del Hub

En PROD el rollback es **manual** y está en [deployment-checklist.md](deployment-checklist.md) (recrear `api` y `web` con las imágenes ancla anteriores; sin `down`). En TEST basta con volver a construir/levantar la versión anterior del código con el mismo `--project-name`/`--env-file`. Si el cambio incluyó migración o n8n, aplicar antes los rollbacks correspondientes con sus guards ([migrations](../database/migrations.md), [runbook Caterpillar](../automations/caterpillar/production-runbook.md#rollback)).

## Exposición externa (Cloudflare u otro)

Fuera de V1: el acceso es solo por LAN (TCP 8082). Cloudflare Quick Tunnel es historia de TEST; Cloudflare/Tailscale y HTTPS son mejoras posteriores y no hay procedimiento de PROD. Regla: sólo se publica el puerto `HUB_PORT` del contenedor `web`; ni la API, ni PostgreSQL, ni n8n.

## Arranque del host Windows

El arranque tras reiniciar el host está cubierto por la configuración del servidor: PostgreSQL arranca como servicio; Docker Desktop (los contenedores tienen `restart: unless-stopped`) y n8n (tarea `Daubert - n8n Supervisor`) arrancan cuando un usuario inicia sesión. Ver [configure-daubert-server.md](configure-daubert-server.md).

## PENDIENTE

- Rotación de secretos (`DB_PASSWORD`, tokens de webhooks) y coordinación con n8n.
- Estrategia de logs y retención.
