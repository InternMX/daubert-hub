# Troubleshooting general (plataforma)

Casos específicos de Caterpillar: [caterpillar/troubleshooting](../automations/caterpillar/troubleshooting.md). Aquí, síntomas de la plataforma. Fuentes: `docker/`, `compose.pilot.yaml`, `security/*`, `health.service.ts`.

Regla: diagnostica con **lecturas** (`/api/health`, `docker compose ps/logs`, consultas `READ ONLY`); no edites datos para "arreglar".

| Síntoma | Causa probable | Qué revisar | Qué NO hacer | Acción segura |
| --- | --- | --- | --- | --- |
| `/api/health` → `database: unavailable` (HTTP 200, `status: ok`) | PostgreSQL caído/inalcanzable desde el contenedor, credenciales o base incorrectas | Servicio PostgreSQL en el host; `DB_HOST/PORT/NAME/USER` del archivo de entorno; conectividad a `host.docker.internal:5432` | No publicar PostgreSQL a la red; no usar `postgres` como `DB_USER` | Restablecer PostgreSQL / corregir el archivo de entorno y recrear `api` |
| `environment: UNKNOWN` | La base conectada no es `daubert_hub_test` ni `daubert_global` | `DB_NAME` real | No operar hasta confirmar la base | Corregir `DB_NAME` |
| `environment` no es el esperado (PROD mostrando `TEST` o viceversa) | Stack levantado con el `--env-file` equivocado | `docker compose ls`, nombre de proyecto, puerto | No seguir usando esa URL | Bajar el stack equivocado (`down` con su mismo `--project-name`/`--env-file`) y levantar el correcto |
| Contenedor `api` *unhealthy* / reiniciándose | Falta una variable obligatoria (`DB_*`, o `CATERPILLAR_REPROCESS_*` en Compose), error de conexión | `docker compose … logs api` | No reiniciar en bucle | Corregir el archivo de entorno; recrear |
| `docker compose config/up` falla con "… is required" | Falta una variable `:?` (típico en PROD: `CATERPILLAR_REPROCESS_WEBHOOK_URL/TOKEN`) | Archivo de entorno vs [environments](../00-overview/environments.md#variables-de-entorno-de-la-api-sólo-nombres) | No pegar secretos en el ejemplo versionado | Añadir las variables al archivo real |
| 502 Bad Gateway en `/api/*` desde Nginx | `api` caído o no saludable | `ps`, logs de `api` | — | Ver [caterpillar/troubleshooting #2](../automations/caterpillar/troubleshooting.md#2-502-upstream--bad-gateway) |
| Login: `401` | Credenciales incorrectas, usuario `INACTIVE`, sesión expirada (12 h) | Estado del usuario en Hub (`ADMIN`) | No desactivar el rate limit | Reintentar / reset por `ADMIN` |
| Login: `429 LOGIN_RATE_LIMITED` | 10 fallos en 15 min para ese email → sólo una verificación por minuto (`Retry-After`) | Cabecera `Retry-After` | No reiniciar la API para "limpiar" el contador como rutina | Esperar; el propietario legítimo puede intentar una vez por minuto |
| `403 CSRF_ORIGIN_NOT_ALLOWED` en POST/PATCH desde el navegador | `Origin` no coincide con `Host` (proxy/túnel que reescribe el Host, acceso por otro nombre) | Que Nginx/túnel preserven el `Host`; acceder por el mismo host que sirve la SPA | No desactivar el guard | Corregir el proxy/URL de acceso |
| `403 PASSWORD_CHANGE_REQUIRED` | El usuario debe cambiar su contraseña | La web redirige a `/change-password` | — | Cambiarla |
| `403 ROLE_NOT_ALLOWED` | Acción sólo `ADMIN` (usuarios, ajuste de folio, reproceso Caterpillar) | Rol del usuario ([authorization](../hub/authorization.md)) | No dar `ADMIN` sin necesidad | Usar una cuenta `ADMIN` |
| Se perdió acceso del único `ADMIN` | Contraseña olvidada | — | No editar `security.users` a mano | Script `security:reset-admin-password[:prod]` ([authentication](../hub/authentication.md#creación-y-recuperación-del-admin)) |
| Cookies de sesión sin `Secure` bajo HTTPS | Compose no pasa `AUTH_COOKIE_SECURE` | [inconsistencia #12](../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración) | — | Tema de configuración pendiente |
| `/automations` muestra intervalo de 15 min para Caterpillar | Catálogo estático desalineado | [inconsistencia #1](../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración) | — | Corregir catálogo en una fase de código |
| Nada carga en `http://localhost:<HUB_PORT>` | Puerto ocupado, `web` no arrancó (depende de `api` *healthy*) | `ps`, logs de `web`/`api` | — | Resolver primero `api` |

## Desarrollo local

- `npm run dev` sale al arrancar: `TEST_DATABASE_URL` ausente o no apunta exactamente a `daubert_hub_test`. Es el comportamiento deseado; corrige la variable.
- La API arranca pero `/api/health` no dice `TEST`: no confíes en ese entorno de desarrollo.
