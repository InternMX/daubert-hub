# Caterpillar — Reproceso manual

Fuentes: `caterpillar.controller.ts`, `caterpillar-executions.service.ts`, `caterpillar-reprocess-webhook.client.ts`, `reprocess-caterpillar-execution.dto.ts`, `CaterpillarReprocessDialog.tsx`, migración 009, nota de despliegue 12C y (Fase D2) el export real del workflow: [prod/workflow.json](../../../n8n/workflows/remisiones-caterpillar/prod/workflow.json). Flujo detallado: [workflow.md](workflow.md#flujo-de-reproceso-webhook).

## Qué es y por qué existe

Si una ejecución termina en `ERROR` o `CANCELADA`, el ciclo automático **no** la reintenta: `fn_crear_ejecucion_automatizacion` devuelve `ALREADY_ERROR`/`ALREADY_CANCELLED` para ese documento. El **reproceso manual** permite a un `ADMIN` pedir, desde el Hub, un nuevo intento controlado.

## Reglas

| Regla | Detalle |
| --- | --- |
| Quién | Sólo `ADMIN` (`@Roles('ADMIN')` en la API). La UI sólo muestra **Reprocesar** a `ADMIN` y sobre ejecuciones `FAILED`/`CANCELLED`; eso es UX, la autoridad es la API y n8n/PostgreSQL. |
| Ejecución original **inmutable** | No se reabre, no se modifica su estado, reservas ni remisiones. |
| Se crea una **ejecución hija** | Fila nueva en `ops.ejecuciones_automatizacion` con `reproceso_de_id = <id original>`. |
| **Máximo un hijo directo** | Índice único parcial `uq_ejecuciones_automatizacion_reproceso_unico` sobre `reproceso_de_id`. |
| **Folios nuevos** | La hija reserva folios nuevos; **nunca** reutiliza los de la original (las reservas de una original en `ERROR` quedan `ABANDONADA`). La UI evita decir que se reutilizan folios. |
| **Idempotente** | Repetir la solicitud no crea más hijas (ver contrato). |
| La original **no se reutiliza** | Ni siquiera aunque el reproceso falle: se reintenta a través de su hija. |
| Motivo obligatorio | `reason`: texto recortado, no vacío, **máx. 500 caracteres**. |

## Contrato

### Solicitud del Hub a n8n

`POST` a la URL configurada (`CATERPILLAR_REPROCESS_WEBHOOK_URL`). En PROD: **`POST /webhook/cat-reprocess`**.

| Elemento | Valor |
| --- | --- |
| Header de autenticación | `X-Daubert-Automation-Token: <token>` (credencial *Header Auth* de n8n; **el valor nunca se documenta**) |
| Cuerpo | `{ "executionId": "<id>", "reason": "<motivo>" }` — **únicamente** esos dos campos |
| Timeout | 10 s (`WEBHOOK_TIMEOUT_MS`) |

El Hub **no envía**: rutas, series, documento, planta, `llave_proceso` ni código de automatización. **Todo se resuelve internamente** (n8n + `fn_resolver_ejecucion_para_reproceso`). Esto está cubierto por el test `never sends a file path, document id, series, plant, or automation code`.

### Respuestas aceptadas (`accepted: true`)

`{ accepted: true, status, originalExecutionId, executionId }` con:

| `status` | Significado | HTTP del Hub |
| --- | --- | --- |
| `REPROCESS_CREATED` | Se creó la ejecución hija y se inició su pipeline | 202 |
| `ALREADY_PROCESSING` | Ya hay un reproceso en curso | 202 |
| `ALREADY_REPROCESSED` | El padre ya tiene hijo; nada nuevo ocurrió | 200 |

Respuesta del Hub al navegador: `{ accepted: true, originalExecutionId, executionId, status }`. La UI se guía por `status`, **no** por el código HTTP (202 también cubre `ALREADY_PROCESSING`).

### Rechazos (`accepted: false`, `error`) soportados por el código

Lista **cerrada** (`KNOWN_REJECTION_REASONS`):

| `error` | Causa | HTTP del Hub |
| --- | --- | --- |
| `NOT_FOUND` | La ejecución no existe **o** no es de Caterpillar **o** su documento origen no existe (indistinguibles por diseño) | 404 |
| `NOT_ELIGIBLE_STATE` | La ejecución no está en estado elegible (p. ej. `COMPLETADA`) | 409 |
| `SOURCE_FILE_MISSING` | El archivo origen ya no está disponible | 409 |
| `OUTSIDE_TEST_SCOPE` | Fuera del ámbito de prueba (workflow **TEST**) | 409 |
| `OUTSIDE_ALLOWED_SCOPE` | Fuera de los procesos habilitados (workflow **PROD**) | 409 |

n8n devuelve los rechazos con HTTP 400/404/409/422; el Hub sólo intenta interpretar como rechazo esos cuatro códigos HTTP.

> **`SOURCE_DOCUMENT_MISSING` no está soportado por el Hub**, pero **sí existe en el workflow n8n** (PROD y TEST): `Validar elegibilidad reproceso CAT` lo devuelve (HTTP 409) cuando la fila resuelta no trae `documento_origen_id`, ruta o nombre. Como no está en `KNOWN_REJECTION_REASONS`, el Hub lo trata como *ruptura de contrato* → `INVALID_RESPONSE` → **502**. En la práctica es casi inalcanzable (el resolver hace `JOIN` interno con `core.documentos`, así que un documento inexistente ya produce `NOT_FOUND`), pero es una inconsistencia real: ver la sección siguiente.

### Discrepancias Hub ↔ n8n (verificadas en D2)

Comparación del contrato del Hub (`caterpillar-reprocess-webhook.client.ts`) con las respuestas reales del workflow (`Responder …` en el export):

| Respuesta real de n8n | HTTP n8n | ¿Soportada por el Hub? | Qué ve el Hub |
| --- | --- | --- | --- |
| `accepted:true` + `REPROCESS_CREATED` / `ALREADY_PROCESSING` / `ALREADY_REPROCESSED` | **202** (los tres) | Sí (acepta cualquier 2xx) | 202 (o 200 para `ALREADY_REPROCESSED`, decidido por el Hub) |
| `NOT_FOUND`, `NOT_ELIGIBLE_STATE`, `SOURCE_FILE_MISSING`, `OUTSIDE_ALLOWED_SCOPE` (`OUTSIDE_TEST_SCOPE` en TEST) | **409** | Sí | 404 / 409 / 409 / 409 |
| `SOURCE_DOCUMENT_MISSING` | 409 | **No** | 502 (`INVALID_RESPONSE`) |
| `SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING` (falla de `Detectar archivo REPROCESS CAT1`) | 422 | **No** | 502 (`INVALID_RESPONSE`) |
| `INVALID_EXECUTION_ID` / `INVALID_REASON` | 400 | **No** (el Hub ya valida antes, prácticamente inalcanzable) | 502 |
| `INTERNAL_ERROR` (falla de `Resolver ejecución original PG`) | 500 | No (5xx = upstream) | 502 |
| `UNEXPECTED_EXECUTION_STATE` | 500 | No | 502 |

Notas: (1) `SOURCE_FILE_MISSING` lo detecta `Validar elegibilidad…` (archivo ausente al momento de validar); si el archivo desaparece **después**, lo captura `Detectar archivo REPROCESS CAT1` y el resultado es `SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING` (422), no `SOURCE_FILE_MISSING`. (2) El texto de la respuesta 202 llega **antes** de que termine el pipeline. (3) No se corrigió nada: son hallazgos para una fase de código.

### Fallos que el Hub genera (no vienen de n8n)

| Resultado interno | Causa | HTTP | `outcome` en `ops.automation_trigger_requests` |
| --- | --- | --- | --- |
| `UPSTREAM_TIMEOUT` | n8n no respondió en 10 s | 504 | `UPSTREAM_ERROR` |
| `UPSTREAM_UNAVAILABLE` | Sin URL/token configurados (`NOT_CONFIGURED`), error de red, o HTTP de n8n fuera de 2xx/400/404/409/422 (p. ej. 5xx, 3xx) | 502 | `UPSTREAM_ERROR` |
| `UPSTREAM_INVALID_RESPONSE` | 2xx con cuerpo inválido, rechazo con `error` desconocido o `accepted` incoherente | 502 | `UPSTREAM_ERROR` |

Errores previos al webhook: `400` (ID no entero positivo ≤ int8 o `reason` inválido/campo extra), `401` (sin sesión), `403` (`ROLE_NOT_ALLOWED` / CSRF / cambio de contraseña pendiente), `400` si no hay email de usuario autenticado.

### Auditoría del intento

Tras resolver la llamada, el Hub inserta (best-effort) en `ops.automation_trigger_requests`: `automation_code = REMISIONES_CATERPILLAR`, `action_type = REPROCESS`, usuario, `target_reference = executionId` y un `outcome` **colapsado** a tres valores:

| Resultado | `outcome` |
| --- | --- |
| `REPROCESS_CREATED`, `ALREADY_PROCESSING`, `ALREADY_REPROCESSED` | `TRIGGERED` |
| Cualquier rechazo de dominio | `NOTHING_TO_REPROCESS` |
| Fallos upstream | `UPSTREAM_ERROR` |

Si la escritura de auditoría falla, **no** hace fallar el reproceso (se registra en logs). El `reason` **no** se persiste en el Hub ([inconsistencia #10](../../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)).

## Idempotencia

| Situación | Resultado | Quién lo garantiza |
| --- | --- | --- |
| Primera solicitud válida | `REPROCESS_CREATED` | `fn_crear_ejecucion_automatizacion` (insert de la hija) |
| Repetida mientras la hija está `PROCESANDO` | `ALREADY_PROCESSING` | Conflicto de única `PROCESANDO` por documento |
| Repetida después de que la hija existe | `ALREADY_REPROCESSED` | Índice único por padre + rama `ALREADY_REPROCESSED` (009) — nunca se propaga un `23505` crudo |
| Doble clic / concurrentes | Una sola hija | El índice único es la garantía; el Hub **no** tiene lock ni clave de idempotencia propios |

Nada en PostgreSQL impide que una hija que termine en `ERROR` sea a su vez reprocesada (nieta, `reproceso_de_id` = la hija). El workflow **tampoco lo impide**: `Validar elegibilidad reproceso CAT` sólo exige estado `ERROR`/`CANCELADA`, ruta real, proceso habilitado y archivo existente; una hija en `ERROR` es reprocesable (crea una nieta con `reproceso_de_id` = la hija).

## Seguridad

| Control | Descripción |
| --- | --- |
| `ADMIN` | `@Roles('ADMIN')` en el endpoint del Hub. |
| Token **server-side** | `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN` sólo existe en el entorno de la API; nunca en frontend, respuestas, logs ni errores (test `never includes the token in any resolved outcome`). |
| Header Auth en n8n | Credencial distinta para TEST y PROD. |
| `n8n_app` en PROD | El workflow usa el rol compartido de mínimo privilegio; `EXECUTE` sobre el resolver concedido sólo a `n8n_app`. |
| `SECURITY DEFINER` + `REVOKE PUBLIC` | El resolver y `fn_crear_ejecucion_automatizacion` tienen `search_path` fijo y no son ejecutables por `PUBLIC`; el Hub (`daubert_hub_app`) **no** tiene `EXECUTE` sobre el resolver. |
| **PostgreSQL es la fuente de verdad** | Estado, ownership e idempotencia se deciden en la BD, no en el Hub ni en el frontend. |
| **Scope por rutas reales** | El resolver sólo ve ejecuciones `REMISIONES_CATERPILLAR`; el ámbito de rutas/procesos lo aplica el workflow (`OUTSIDE_*_SCOPE`). |
| `PROCESOS_HABILITADOS_PROD` | Lista de procesos permitidos en el workflow PROD (P2, P5, P6 hoy): constante en dos nodos Code del workflow ([workflow.md](workflow.md#puntos-verificados)); no está en el Hub ni en PostgreSQL. |
| Series inactivas | Aunque una ruta existiera, `reservar_folios_para_ejecucion` rechaza series `INACTIVA` (`55000`). |
| **Fail closed** | Cualquier respuesta desconocida, ruta inactiva, serie inactiva, ámbito no permitido o resolución ambigua termina en rechazo/502, nunca en una acción "adivinada". |
| Respuestas sanitizadas | El Hub nunca reenvía el cuerpo crudo de n8n, la URL ni el token; los 5xx llevan mensaje genérico. |

## Mensajes en la UI

`caterpillarReprocessErrorMessage`: 404 "ya no existe o no está disponible"; 409 muestra el mensaje específico del backend (estado no elegible / archivo no disponible / fuera del ámbito); 502 y 504 mensajes fijos genéricos; el resto, "No fue posible solicitar el reproceso. Intenta nuevamente." Los tres estados aceptados **no** se presentan como error.

## Qué NO hacer

- No llamar al webhook de PROD "para probar" con una ejecución real elegible: crearía un reproceso real y consumiría folios ([runbook](production-runbook.md#primer-reproceso-real-diferido)).
- No editar filas de `ops.ejecuciones_automatizacion` ni `siguiente_folio` a mano para "destrabar" un reproceso.
- No enviar campos extra al webhook ni documentar/registrar el token.
