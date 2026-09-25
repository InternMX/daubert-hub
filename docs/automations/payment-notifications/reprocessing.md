# Notificaciones de pago — Reproceso

Fuentes: export real (webhook `Hub - Reprocesar notificación`), y del Hub `payment-notifications.controller.ts`, `payment-notifications.service.ts`, `payment-notifications.repository.ts`, `payment-notifications-webhook.client.ts`, `payment-notification-status.ts`.

## Tres vías de reproceso

| Vía | Cómo | Quién |
| --- | --- | --- |
| Hub | `POST /api/automations/payment-notifications/:executionId/reprocess` → webhook n8n | Cualquier usuario **autenticado** (ADMIN o GENERAL) |
| Manual en n8n | `Reprocesar correo manual` → `Seleccionar correo a reprocesar` (editar el `correo_id` en el nodo y ejecutar) | Quien tenga acceso al editor de n8n |
| Automática | No existe reproceso automático de correos en `ERROR`: el sondeo sólo toma correos **nuevos** (no registrados) | — |

En este módulo `executionId` (Hub) **es** el `correo_id` del correo en PostgreSQL.

## Contrato Hub → n8n

| Elemento | Valor |
| --- | --- |
| Endpoint n8n | `POST daubert-hub/notificaciones-pago/reprocesar` (`/webhook/…` en PROD; el **mismo `path`** existe en TEST) |
| Autenticación | Header `X-Daubert-Automation-Token` (credencial *Header Auth* `Daubert Hub - n8n PROD` / `… TEST`). Valor **nunca** documentado |
| Cuerpo que envía el Hub | `{ "correo_id": "<id>" }` — el Hub **sí** envía el `correo_id` (lo resuelve él mismo desde el `executionId`); no envía rutas ni proveedores |
| Timeout del Hub | 10 s |
| Respuesta de n8n | HTTP **202 inmediato** (`responseCode: 202`, sin nodo de respuesta): **no** informa resultado ni elegibilidad |
| Lo que n8n valida | `Preparar solicitud Hub reproceso`: `correo_id` entero > 0 (si no, error de ejecución, sin respuesta útil al Hub) |
| Lo que n8n resuelve | Todo lo demás desde PostgreSQL: empresas a reintentar, archivos con error (por `HASH=` en `detalle_error`), catálogo |
| Origen | Marca `origen_reproceso = "DAUBERT_HUB"` |

Resultados del Hub: `TRIGGERED` (202), `NOT_FOUND` (404), `NOT_ELIGIBLE` (409), `UPSTREAM_ERROR` (502). El cliente del Hub **no interpreta** el cuerpo de n8n: cualquier fallo (red, timeout, no-2xx) → `UPSTREAM_ERROR`. Auditoría: `ops.automation_trigger_requests` (`REPROCESS`; `TRIGGERED` / `NOTHING_TO_REPROCESS` / `UPSTREAM_ERROR`).

## Elegibilidad: dos reglas que no coinciden

| Quién | Regla |
| --- | --- |
| **Hub** (`findReprocessableCorreoByExecutionId`) | El correo existe y (`estado = 'ERROR'` **o** existe algún resultado `MANUAL`/`ERROR`) |
| **n8n** (`Preparar correo para reproceso`) | `estado = 'ERROR'` **o** (`estado = 'PROCESADO'` **y** existe resultado `MANUAL`/`ERROR`); bloquea la fila con `FOR UPDATE SKIP LOCKED` y la pasa a `PENDIENTE` |

**Discrepancia:** un correo en `PENDIENTE` (en curso) con resultados `MANUAL`/`ERROR` es elegible para el Hub pero **no** para n8n. El Hub responde `TRIGGERED` (202), n8n no encuentra filas y **termina sin hacer nada**, sin avisar. Además, como n8n contesta 202 antes de evaluar, **`TRIGGERED` no garantiza que se haya iniciado un reproceso** (p. ej. si dos solicitudes llegan a la vez, la segunda no obtiene la fila por `SKIP LOCKED`). La idempotencia real es la transición atómica de n8n.

## Qué hace el reproceso

1. `Preparar correo para reproceso` (PG) deja el correo en `PENDIENTE`, limpia `detalle_error`, `resumen_enviado` y fechas, y devuelve `empresas_reintentar` (resultados `MANUAL`/`ERROR`) y `archivos_reintentar` (hashes de PDFs con error).
2. Reejecuta el pipeline principal **sólo** para esas empresas/archivos ([workflow](workflow.md#reproceso-hub-o-manual)).
3. Si ya hay borrador: se **actualiza** (si estaba completo) o se **elimina y recrea** (si estaba en error) vía Graph.
4. `Registrar resultado reproceso` actualiza el resultado; `Evaluar cierre del correo` recalcula el estado del correo; se vuelve a generar el resumen.

## Seguridad

Preguntas de la fase, verificadas:

| Pregunta | Respuesta |
| --- | --- |
| ¿Quién puede disparar el reproceso? | **Cualquier usuario autenticado del Hub** (ADMIN y GENERAL): la ruta no declara `@Roles`. En n8n, cualquiera con acceso al editor. |
| ¿Existe restricción `ADMIN`? | **No.** A diferencia de Caterpillar, donde el reproceso es `@Roles('ADMIN')`. |
| ¿El workflow confía sólo en Header Auth? | **Sí.** No recibe identidad de usuario ni firma; cualquier portador del token puede llamar al webhook con cualquier `correo_id`. |
| ¿El Hub protege el endpoint? | Sí, con sesión, protección CSRF por Origin y validación del `executionId` (BIGINT); pero **sin rol**. |
| ¿Qué credenciales usa? | Hub: token del entorno de la API (`PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN`, sólo el nombre) y URL (`PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL`). n8n: `Daubert Hub - n8n PROD`/`TEST`, `Postgres produccion`/`pruebas`, `Outlook LOGIN OAUT2`. |
| ¿Qué información recibe n8n del Hub? | Sólo `correo_id`. |
| ¿Qué resuelve internamente? | Empresas y archivos a reintentar, catálogo, rutas, destinatarios, estado. |

### Riesgos (no se corrigió nada)

1. **Sin restricción de rol:** un usuario `GENERAL` puede provocar que se recreen/eliminen borradores de Outlook y se reenvíe un resumen. Si se requiere restringir, añadir `@Roles('ADMIN')` (cambio de código, fuera de D2).
2. **Confianza sólo en el token:** si el token se filtra, el reproceso puede dispararse para cualquier correo.
3. **Respuesta 202 ciega:** el Hub no sabe si n8n actuó.
4. **Docker:** `compose.pilot.yaml` no pasa las variables `PAYMENT_NOTIFICATIONS_*` a la API ([inconsistencia #13](../../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)): en el piloto Docker el reproceso responde `UPSTREAM_ERROR` salvo que se añadan.
5. **Mismo `path` de webhook en TEST y PROD:** activar ambos workflows (o publicar ambos) causa conflicto; TEST y PROD comparten instancia.
6. **`TEST` con la credencial de Outlook de PROD:** un reproceso en TEST opera sobre el mismo buzón.
