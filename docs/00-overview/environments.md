# Entornos: TEST y PROD

Fuentes: `README.md` (raíz), `deploy/README.md`, `deploy/pilot.*.env.example`, `compose.pilot.yaml`, `scripts/dev-test-only.cjs`, `apps/api/src/health/health.service.ts`, `apps/api/src/config/environment.ts`, nota de despliegue 12C, paquetes de migración externos.

## Regla general

**No hay base de datos compartida entre entornos.** Cada entorno tiene su base, su rol de aplicación, su stack Docker y sus credenciales n8n.

## Tabla de diferencias

| Aspecto | TEST | PROD |
| --- | --- | --- |
| Base PostgreSQL | `daubert_hub_test` | `daubert_global` |
| Rol de la API (Hub) | `daubert_hub_test_user` (ejemplo en `pilot.test.env.example`) | `daubert_hub_app` (mínimo privilegio) |
| Rol de n8n para Caterpillar | `n8n_cat_test` (ver runner `caterpillar-model.integration.runner.cjs`) | `n8n_app` (rol compartido con Remisiones Audi; no se creó rol dedicado) — [ADR-002](../decisions/ADR-002-n8n-app-rol-compartido-prod.md) |
| `/api/health` → `environment` | `TEST` | `PRODUCTION` |
| Puerto Hub (`HUB_PORT`) | `8081` (ejemplo de `pilot.test.env.example`) | `8082` real (el ejemplo genérico `pilot.prod.env.example` usa `8080`) |
| Proyecto Compose | `daubert-hub-test` (ejemplo genérico) | `daubert-hub` real (`daubert-hub-prod` es solo el nombre del ejemplo genérico) |
| Archivo de entorno (no versionado) | `deploy/pilot.test.env` | `deploy/pilot.prod.env` |
| Webhook de reproceso Caterpillar | `/webhook-test/cat-test-reprocess` (URL de prueba de n8n, ver abajo) | `POST /webhook/cat-reprocess` (URL de producción, workflow activo) |
| Credencial Header Auth del webhook | Credencial n8n propia de TEST | Credencial n8n **distinta**, específica de PROD |
| Rechazo por ámbito | `OUTSIDE_TEST_SCOPE` | `OUTSIDE_ALLOWED_SCOPE` |
| Series/folios | Valores de prueba (fixtures) | Contadores reales; ver [document-series](../database/document-series.md) |
| Desarrollo local | `npm run dev` **sólo** contra `daubert_hub_test` | Nunca desde el runner de pruebas ni desde `npm run dev` |
| Migraciones | Aplicadas manualmente | Aplicadas manualmente, con precheck/postcheck ([migrations](../database/migrations.md)) |

### `webhook-test` vs `webhook` (n8n)

- **`/webhook-test/<path>`**: URL de prueba de n8n. Sólo responde mientras el editor está escuchando (en el piloto, ejecutando manualmente **Execute workflow**). Si no está escuchando, n8n devuelve un error tipo `404` y el Hub lo verá como fallo upstream (`502`).
- **`/webhook/<path>`**: URL de producción. Sólo responde si el workflow está **activo**.

El ejemplo `deploy/pilot.test.env.example` apunta a `http://host.docker.internal:5678/webhook-test/cat-test-reprocess`. El valor de PROD vive en `deploy/pilot.prod.env` (no versionado); su ruta es `/webhook/cat-reprocess`.

### Fuente de verdad funcional durante el desarrollo

Regla de proyecto documentada en el paquete de despliegue Caterpillar (`README_DEPLOY.md`, externo al repo): **TEST es la fuente de verdad del comportamiento funcional**; PROD recibe el estado final y correcto, no necesariamente cada paso histórico de TEST. Ejemplo real: la función `operacion.fn_registrar_remision_generada` se desplegó en PROD directamente en su forma corregida, sin instalar nunca la versión con el bug histórico de columna ambigua.

### Rutas TEST vs rutas reales

Las rutas de archivos (carpetas Dropbox de origen y destino de PDFs) son configuración del workflow n8n y de `core.documentos.ruta_archivo`. El workflow TEST rechaza ejecuciones fuera de su ámbito de prueba (`OUTSIDE_TEST_SCOPE`) y el de PROD las que estén fuera de los procesos habilitados (`OUTSIDE_ALLOWED_SCOPE`). Las rutas concretas por workflow están documentadas en [n8n-paths](../automations/n8n-paths.md) (Fase D2).

## Cómo saber en qué entorno estás

1. `GET /api/health` → campo `environment` (derivado de `current_database()`; nunca expone el nombre de la base).
2. En desarrollo, `npm run dev` **falla al arrancar** si `TEST_DATABASE_URL` no decodifica exactamente a `daubert_hub_test`, y la API re-verifica la base viva (`EXPECTED_DATABASE_NAME`).
3. Las migraciones PROD tienen guard `current_database() <> 'daubert_global'` ([migrations](../database/migrations.md)).
4. **Guarda de arranque de la API (independiente del lanzador):** antes de escuchar peticiones, un proceso que **no** sea el runtime de producción rechaza `daubert_global` (y el rol `daubert_hub_app`) tanto en `DB_NAME`/`DB_USER` como en la base realmente conectada (`SELECT current_database(), current_user`, solo lectura). El runtime de producción es `NODE_ENV=production` **dentro de un contenedor** (`/.dockerenv` o `/run/.containerenv`); `NODE_ENV` solo no basta. En el contenedor de PROD no añade consultas ni modos de fallo. Si falla o no puede verificar, la API cierra sin escuchar y el mensaje solo incluye nombres, nunca credenciales (código: `apps/api/src/config/production-database-guard.ts`). **Limitación:** no distingue el contenedor de PROD de otro contenedor al que se le den deliberadamente `NODE_ENV=production` y credenciales de PROD; esa última defensa es la propia base de datos (credenciales separadas, `CONNECT`).

## Variables de entorno de la API (sólo nombres)

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Sí | Conexión a PostgreSQL |
| `API_PORT` | No (3000) | Puerto interno de la API |
| `AUTH_COOKIE_SECURE` | No (`false`) | Flag `Secure` de la cookie de sesión (`true` sólo bajo HTTPS). **`compose.pilot.yaml` no la pasa al contenedor** (ver inconsistencia #12) |
| `APP_VERSION`, `GIT_COMMIT` | No (`unknown`) | Metadatos de build expuestos en `/api/health` |
| `CATERPILLAR_REPROCESS_WEBHOOK_URL` | Opcional en la API; **obligatoria en `compose.pilot.yaml`** | URL del webhook n8n de reproceso Caterpillar |
| `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN` | Ídem | Valor del header `X-Daubert-Automation-Token` (secreto) |
| `N8N_HEALTH_WEBHOOK_URL` | Opcional | URL del webhook del workflow n8n **Daubert Hub - n8n Health Check** (`…/webhook/daubert-hub/health`). Desde el contenedor API: `http://host.docker.internal:5678/webhook/daubert-hub/health`. Sin ella, `GET /api/system/status` reporta `NOT_CONFIGURED` |
| `N8N_HEALTH_WEBHOOK_TOKEN` | Opcional | Valor del header `X-Daubert-Automation-Token` de la credencial Header Auth de n8n (secreto; sólo en el env file sin versionar) |
| `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL` | Opcional | Webhook n8n de reproceso de Notificaciones de pago. **`compose.pilot.yaml` no la pasa al contenedor** (inconsistencia #13) |
| `PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN` | Opcional | Token de ese webhook (secreto). Ídem |
| `PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED` | No (`false`) | **PRODUCCION.** Habilita la asignacion puntual por archivo solo en `daubert_global` (requiere migraciones 015-017). Independiente de `PAYMENT_FILE_ASSIGNMENTS_TEST_ENABLED` (que solo aplica a `daubert_hub_test`). Con `false` el Hub no consulta las tablas nuevas |
| `PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_READY` | No (`false`) | **PRODUCCION.** Declara que el workflow de n8n ya consume las asignaciones. Efectiva solo si ademas el webhook es exactamente `http://<host>:5678/webhook/daubert-hub/notificaciones-pago/reprocesar` y su origen coincide con la variable siguiente |
| `PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_ORIGIN` | No | Origen (sin ruta) del n8n productivo, p. ej. `http://host.docker.internal:5678` |
| `TEST_DATABASE_URL` (+ `_ADMIN_URL`, `_MIGRATOR`, `_N8N_CAT_TEST`) | Sólo pruebas de integración / dev | Deben apuntar a `daubert_hub_test` |
| `EXPECTED_DATABASE_NAME` | La fija el launcher de dev | Guard de base viva |

Los **valores** nunca se documentan ni se versionan.

## Inconsistencias detectadas (deuda documental y de configuración)

Registradas durante la Fase D1; no se corrigieron porque la fase es sólo documental.

| # | Inconsistencia | Evidencia | Impacto |
| --- | --- | --- | --- |
| 1 | Intervalos de polling: el catálogo del Hub dice **15 min** para Caterpillar y **10 min** para Audi; los exports reales dicen **10 min** (Caterpillar, coincide con la nota 12C) y **15 min** (Audi). Notificaciones: 5 min en el catálogo, intervalo no explícito en el export. | `apps/api/src/automations/overview/automation-catalog.ts` (`pollingIntervalMinutes: 15`) vs nota 12C | La tarjeta de `/automations` puede mostrar un intervalo distinto al real (y calcular mal la "próxima revisión"). |
| 2 | `deploy/pilot.prod.env.example` **no incluye** `CATERPILLAR_REPROCESS_WEBHOOK_URL/TOKEN`, pero `compose.pilot.yaml` las exige (`:?`). | `deploy/pilot.prod.env.example`, `compose.pilot.yaml` | `docker compose config/up` de PROD falla si el archivo real se creó desde el ejemplo sin añadirlas. |
| 3 | *(Resuelta)* El `README.md` raíz tenía afirmaciones desactualizadas (Clientes "no implementado", contenedor Postgres de prueba, propósito centrado en direcciones). | `README.md` | Se reescribió el README raíz como punto de entrada. |
| 4 | `SOURCE_DOCUMENT_MISSING` **no está soportado por el Hub**, pero **sí lo devuelve el workflow n8n** (PROD y TEST); además el workflow devuelve `SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING` (422), `INVALID_EXECUTION_ID`/`INVALID_REASON` (400), `INTERNAL_ERROR` y `UNEXPECTED_EXECUTION_STATE` (500) que el Hub tampoco reconoce. | `caterpillar-reprocess-webhook.client.ts` (`KNOWN_REJECTION_REASONS`) vs export `Remisiones CAT Produccion PG` (D2) | El Hub los trata como `INVALID_RESPONSE`/upstream → 502. Ver [reprocessing](../automations/caterpillar/reprocessing.md#discrepancias-hub--n8n-verificadas-en-d2). |
| 5 | Encabezados de las migraciones dicen "DO NOT APPLY TO daubert_global YET" aunque ya se aplicaron (incluida la 009 versionada). | Primera línea de `database/migrations/daubert_global/*009*.sql` | Riesgo de confusión sobre el estado real. Estado real: [migrations](../database/migrations.md). |
| 6 | Comentarios obsoletos en código: "the four known domain rejections" (ahora son cinco); comentario en `automations-overview.service.ts` sobre Caterpillar `INACTIVA`. | `caterpillar-executions.service.ts`, `automations-overview.service.ts` | Sólo documentación en código. |
| 7 | `npm run test:integration` **no incluye** los runners Caterpillar (`caterpillar-*`) ni `document-series-folio-adjustment`; sólo tienen script propio. | `apps/api/package.json` | `npm run validate` no los ejecuta. Ver [testing](../automations/caterpillar/testing.md). |
| 8 | No hay runner de integración en el repo para los objetos de la 009 (resolver, índice único, `ALREADY_REPROCESSED`). | búsqueda en `apps/api/test/*.runner.cjs` | La cobertura DB del reproceso depende de pruebas manuales/externas. |
| 9 | `DEFAULT_APP_VERSION` (`0.8.0-pilot.1`) difiere de `package.json` (`1.0.3` desde el release v1.0.3; antes `1.0.2`). | `apps/api/src/config/environment.ts` | Sólo afecta lanzamientos ad-hoc sin `APP_VERSION`; el propio comentario lo acepta. |
| 10 | El `reason` del reproceso **no se persiste** en el Hub: sólo se reenvía a n8n; la auditoría (`ops.automation_trigger_requests`) guarda resultado y `executionId`, no el motivo. | `caterpillar-executions.service.ts`, migración `20260911_003` | Si se requiere trazabilidad del motivo, hay que confirmarlo en n8n (PENDIENTE) o añadirlo en el futuro. |
| 11 | *(Resuelta en D2)* `PROCESOS_HABILITADOS_PROD` y la lógica de n8n no estaban en el repo. | Ahora: [`n8n/workflows/`](../../n8n/README.md) | `PROCESOS_HABILITADOS_PROD` está **duplicada** en dos nodos Code de Caterpillar (P2, P5, P6). |
| 12 | `compose.pilot.yaml` no pasa `AUTH_COOKIE_SECURE` al contenedor `api` (nunca estuvo en el historial del archivo). | `compose.pilot.yaml` (sólo `DB_*`, `API_PORT`, `CATERPILLAR_REPROCESS_*`) | En el piloto Docker la cookie de sesión queda siempre sin `Secure`, aunque se sirva por HTTPS. |
| 13 | `compose.pilot.yaml` no pasa `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL/TOKEN`. | ídem | En el piloto Docker, el reproceso de Notificaciones de pago devuelve "upstream no disponible" (config ausente) salvo que se añadan. Confirmar si es intencional. |
| 14 | `compose.pilot.yaml` usa saltos de línea CRLF (resto de archivos según cada uno). | `file compose.pilot.yaml` | Puede producir ruido en diffs; sin impacto funcional. |

## Instancia n8n compartida (verificado en D2)

Los 12 exports n8n (TEST y PROD) traen el **mismo `instanceId`**: TEST y PROD **viven en la misma instancia n8n**. Consecuencias observadas: el workflow TEST de Audi usa el manejador de errores y los subworkflows de PROD; TEST y PROD de Notificaciones comparten la credencial de Outlook y el mismo `path` de webhook; hay que distinguir siempre por nombre de workflow y credencial. Detalle: [n8n-test-prod-drift](../automations/n8n-test-prod-drift.md) y [n8n-dependencies](../automations/n8n-dependencies.md).
