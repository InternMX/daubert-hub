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
| Puerto Hub (ejemplo) | `HUB_PORT=8081` | `HUB_PORT=8080` |
| Proyecto Compose | `daubert-hub-test` | `daubert-hub-prod` |
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

Las rutas de archivos (carpetas Dropbox de origen y destino de PDFs) son configuración del workflow n8n y de `core.documentos.ruta_archivo`. El workflow TEST rechaza ejecuciones fuera de su ámbito de prueba (`OUTSIDE_TEST_SCOPE`) y el de PROD las que estén fuera de los procesos habilitados (`OUTSIDE_ALLOWED_SCOPE`). Las rutas concretas **no están en el repositorio**: PENDIENTE (documentar desde el export de cada workflow).

## Cómo saber en qué entorno estás

1. `GET /api/health` → campo `environment` (derivado de `current_database()`; nunca expone el nombre de la base).
2. En desarrollo, `npm run dev` **falla al arrancar** si `TEST_DATABASE_URL` no decodifica exactamente a `daubert_hub_test`, y la API re-verifica la base viva (`EXPECTED_DATABASE_NAME`).
3. Las migraciones PROD tienen guard `current_database() <> 'daubert_global'` ([migrations](../database/migrations.md)).

## Variables de entorno de la API (sólo nombres)

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Sí | Conexión a PostgreSQL |
| `API_PORT` | No (3000) | Puerto interno de la API |
| `AUTH_COOKIE_SECURE` | No (`false`) | Flag `Secure` de la cookie de sesión (`true` sólo bajo HTTPS). **`compose.pilot.yaml` no la pasa al contenedor** (ver inconsistencia #12) |
| `APP_VERSION`, `GIT_COMMIT` | No (`unknown`) | Metadatos de build expuestos en `/api/health` |
| `CATERPILLAR_REPROCESS_WEBHOOK_URL` | Opcional en la API; **obligatoria en `compose.pilot.yaml`** | URL del webhook n8n de reproceso Caterpillar |
| `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN` | Ídem | Valor del header `X-Daubert-Automation-Token` (secreto) |
| `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL` | Opcional | Webhook n8n de reproceso de Notificaciones de pago. **`compose.pilot.yaml` no la pasa al contenedor** (inconsistencia #13) |
| `PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN` | Opcional | Token de ese webhook (secreto). Ídem |
| `TEST_DATABASE_URL` (+ `_ADMIN_URL`, `_MIGRATOR`, `_N8N_CAT_TEST`) | Sólo pruebas de integración / dev | Deben apuntar a `daubert_hub_test` |
| `EXPECTED_DATABASE_NAME` | La fija el launcher de dev | Guard de base viva |

Los **valores** nunca se documentan ni se versionan.

## Inconsistencias detectadas (deuda documental y de configuración)

Registradas durante la Fase D1; no se corrigieron porque la fase es sólo documental.

| # | Inconsistencia | Evidencia | Impacto |
| --- | --- | --- | --- |
| 1 | Intervalo de polling de Caterpillar: el catálogo del Hub dice **15 min**; la nota de despliegue 12C y el proceso real indican **10 min**. | `apps/api/src/automations/overview/automation-catalog.ts` (`pollingIntervalMinutes: 15`) vs nota 12C | La tarjeta de `/automations` puede mostrar un intervalo distinto al real (y calcular mal la "próxima revisión"). |
| 2 | `deploy/pilot.prod.env.example` **no incluye** `CATERPILLAR_REPROCESS_WEBHOOK_URL/TOKEN`, pero `compose.pilot.yaml` las exige (`:?`). | `deploy/pilot.prod.env.example`, `compose.pilot.yaml` | `docker compose config/up` de PROD falla si el archivo real se creó desde el ejemplo sin añadirlas. |
| 3 | `README.md` raíz contiene afirmaciones desactualizadas: "Clients are planned next but NOT implemented" (ya existe módulo Clientes), "test Postgres container" (el compose no define Postgres), propósito centrado sólo en direcciones. | `README.md` vs `apps/api/src/clients/`, `compose.pilot.yaml` | Onboarding confuso. |
| 4 | `SOURCE_DOCUMENT_MISSING` **no existe** en el código del Hub. | `caterpillar-reprocess-webhook.client.ts` (`KNOWN_REJECTION_REASONS`) | Si n8n lo devolviera, el Hub lo trataría como `INVALID_RESPONSE` → 502. Ver [reprocessing](../automations/caterpillar/reprocessing.md). |
| 5 | Encabezados de las migraciones dicen "DO NOT APPLY TO daubert_global YET" aunque ya se aplicaron (incluida la 009 versionada). | Primera línea de `database/migrations/daubert_global/*009*.sql` | Riesgo de confusión sobre el estado real. Estado real: [migrations](../database/migrations.md). |
| 6 | Comentarios obsoletos en código: "the four known domain rejections" (ahora son cinco); comentario en `automations-overview.service.ts` sobre Caterpillar `INACTIVA`. | `caterpillar-executions.service.ts`, `automations-overview.service.ts` | Sólo documentación en código. |
| 7 | `npm run test:integration` **no incluye** los runners Caterpillar (`caterpillar-*`) ni `document-series-folio-adjustment`; sólo tienen script propio. | `apps/api/package.json` | `npm run validate` no los ejecuta. Ver [testing](../automations/caterpillar/testing.md). |
| 8 | No hay runner de integración en el repo para los objetos de la 009 (resolver, índice único, `ALREADY_REPROCESSED`). | búsqueda en `apps/api/test/*.runner.cjs` | La cobertura DB del reproceso depende de pruebas manuales/externas. |
| 9 | `DEFAULT_APP_VERSION` (`0.8.0-pilot.1`) difiere de `package.json` (`0.9.0-pilot.2`). | `apps/api/src/config/environment.ts` | Sólo afecta lanzamientos ad-hoc sin `APP_VERSION`; el propio comentario lo acepta. |
| 10 | El `reason` del reproceso **no se persiste** en el Hub: sólo se reenvía a n8n; la auditoría (`ops.automation_trigger_requests`) guarda resultado y `executionId`, no el motivo. | `caterpillar-executions.service.ts`, migración `20260911_003` | Si se requiere trazabilidad del motivo, hay que confirmarlo en n8n (PENDIENTE) o añadirlo en el futuro. |
| 11 | `PROCESOS_HABILITADOS_PROD` y la lógica de n8n no están en el repo. | búsqueda en repo: 0 resultados | Documentado como **Descripción de proyecto**. |
| 12 | `compose.pilot.yaml` no pasa `AUTH_COOKIE_SECURE` al contenedor `api` (nunca estuvo en el historial del archivo). | `compose.pilot.yaml` (sólo `DB_*`, `API_PORT`, `CATERPILLAR_REPROCESS_*`) | En el piloto Docker la cookie de sesión queda siempre sin `Secure`, aunque se sirva por HTTPS. |
| 13 | `compose.pilot.yaml` no pasa `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL/TOKEN`. | ídem | En el piloto Docker, el reproceso de Notificaciones de pago devuelve "upstream no disponible" (config ausente) salvo que se añadan. Confirmar si es intencional. |
| 14 | `compose.pilot.yaml` usa saltos de línea CRLF (resto de archivos según cada uno). | `file compose.pilot.yaml` | Puede producir ruido en diffs; sin impacto funcional. |
