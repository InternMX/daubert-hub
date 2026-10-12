# Notificaciones de pago — Reproceso

Fuentes: export real anterior a la nueva lógica de OMITIDO/HASH (webhook `Hub - Reprocesar notificación`), y del Hub `payment-notifications.controller.ts`, `payment-notifications.service.ts`, `payment-notifications.repository.ts`, `payment-notifications-webhook.client.ts`, `payment-notification-status.ts`.

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
| Cuerpo que envía el Hub | `{ "correo_id": "<id>" }` — el Hub **sí** envía el `correo_id` (lo resuelve él mismo desde el `executionId`); no envía rutas, proveedores, empresas ni archivos. **No cambió** con la nueva elegibilidad |
| Timeout del Hub | 10 s |
| Respuesta de n8n | HTTP **202 inmediato** (`responseCode: 202`, sin nodo de respuesta): **no** informa resultado ni elegibilidad |
| Lo que n8n valida | `Preparar solicitud Hub reproceso`: `correo_id` entero > 0 (si no, error de ejecución, sin respuesta útil al Hub) |
| Lo que n8n resuelve | Todo lo demás desde PostgreSQL: empresas a reintentar, archivos con error (por `HASH=` en `detalle_error`), catálogo |
| Origen | Marca `origen_reproceso = "DAUBERT_HUB"` |

Resultados del Hub: `TRIGGERED` (202), `NOT_FOUND` (404), `NOT_ELIGIBLE` (409), `UPSTREAM_ERROR` (502) — ver [Respuestas HTTP](#respuestas-http). El cliente del Hub **no interpreta** el cuerpo de n8n: cualquier fallo (red, timeout, no-2xx) → `UPSTREAM_ERROR`. Auditoría: `ops.automation_trigger_requests` (`REPROCESS`; `TRIGGERED` / `NOTHING_TO_REPROCESS` / `UPSTREAM_ERROR`).

## Elegibilidad (Hub)

El Hub decide únicamente si **permite solicitar** el reproceso. Qué empresas y archivos se procesan lo decide n8n (ver [Qué hace el reproceso](#qué-hace-el-reproceso)); el Hub no duplica esa selección.

| Estado del correo | Condición adicional | ¿Reprocesable? |
| --- | --- | --- |
| `ERROR` | ninguna (cubre fallos técnicos y de alias/clasificación) | Sí |
| `PROCESADO` | algún resultado `MANUAL` | Sí |
| `PROCESADO` | algún resultado `ERROR` por empresa | Sí |
| `PROCESADO` | algún resultado `OMITIDO` cuya empresa tiene **hoy** `procesa_comprobantes_pago = true` **y** `notificaciones_activas = true` en `core.empresas_notificacion_pago` | Sí |
| `PROCESADO` | `detalle_error` contiene un `HASH=` válido (`HASH=[0-9A-Fa-f]{64}`, la misma expresión que usa n8n) | Sí |
| `PROCESADO` | solo resultados `LISTO`, `OMITIDO` de empresas aún no habilitadas, y sin `HASH=` válido | No |
| `PENDIENTE` | cualquiera (aunque tenga `MANUAL`, `OMITIDO` habilitado o `HASH=`) | No |

Detalles de la regla:

- **`OMITIDO` y configuración actual.** El resultado histórico no se toca: sigue siendo `OMITIDO`. Lo que cuenta es la configuración **actual** de la empresa. Una empresa sin fila en `core.empresas_notificacion_pago`, o con solo uno de los dos indicadores en `true`, no está habilitada. El Hub no filtra por el texto de `motivo`.
- **`HASH` pendiente.** Un `HASH=` sigue pendiente mientras esté presente en `detalle_error` (n8n lo limpia al tomar el correo para reprocesar). El Hub no intenta saber si el archivo terminará resuelto. Un `HASH=` incompleto (menos de 64 hexadecimales) o el texto libre no cuentan.
- **`LISTO` nunca habilita** el reproceso por sí solo, y el Hub no reprocesa resultados `LISTO`.
- **No se cambian estados históricos.** El Hub es de solo lectura sobre `core.resultados_notificacion_pago`: no convierte `OMITIDO` en `MANUAL` ni modifica estados para habilitar el botón.

### Dónde se comprueba

| Momento | Código | Qué hace |
| --- | --- | --- |
| Al generar el listado/detalle | `PaymentNotificationsRepository` (`EXECUTION_COLUMNS`) + `deriveReprocessAvailability` (`payment-notification-status.ts`) | Calcula `reprocessAvailable` por fila con los conteos y dos indicadores internos (OMITIDO habilitados, `HASH=` pendiente) |
| Al solicitar el reproceso | `findReprocessableCorreoByExecutionId` | Vuelve a evaluar la misma regla en SQL contra los datos **actuales**, incluida la configuración vigente de la empresa |

Ambas comprobaciones comparten los mismos fragmentos SQL. Si entre cargar el listado y pulsar **Reprocesar** la empresa se deshabilita (o el correo deja de cumplir la regla) y no hay otra causa elegible, el `POST` responde **409** y no se llama a n8n. Si sigue habilitada, se acepta.

### Qué consume el frontend

React usa únicamente `reprocessAvailable` (booleano) y oculta el botón si el correo está `PENDIENTE` (`ReprocessCell.tsx`). El contrato de la API no cambió: los indicadores internos no se exponen y no existe `canReprocess`.

### Respuestas HTTP

| Resultado | HTTP | Significado |
| --- | --- | --- |
| `TRIGGERED` | **202** | **Solicitud aceptada** y entregada a n8n. **No** significa que el reproceso haya terminado ni que n8n vaya a actuar sobre algo: el efecto se ve después en el listado |
| `NOT_FOUND` | 404 | El correo no existe |
| `NOT_ELIGIBLE` | 409 | Ya no cumple la regla (p. ej. la empresa se deshabilitó después de cargar el listado) |
| `UPSTREAM_ERROR` | 502 | Falló la entrega a n8n |

### Coordinación con n8n

La regla del Hub y la de n8n deben mantenerse alineadas: si el Hub permite solicitar algo que n8n no selecciona, el `POST` devuelve 202 y n8n termina sin efectos. n8n debe aceptar, al tomar el correo, los mismos casos (incluido `OMITIDO` de empresas habilitadas y `HASH=` pendiente en un correo `PROCESADO`) antes de desplegar cambios de elegibilidad en el Hub. Orden de despliegue: **n8n primero, después el Hub**. La nueva lógica de n8n está en producción; su export actualizado **no está versionado en este repositorio**, por lo que [workflow.md](workflow.md) y la descripción de abajo reflejan el export anterior.

> **Histórico:** hasta la v1.0.5 el Hub solo consideraba `ERROR`, `MANUAL` y `ERROR` por empresa, nunca `OMITIDO` ni `HASH=`, y trataba como elegible un correo `PENDIENTE` con resultados `MANUAL`/`ERROR` (la discrepancia con n8n que describía esta página). Ambas cosas quedaron corregidas.

## Qué hace el reproceso

> Descripción según el export anterior de n8n. La versión en producción también incorpora los `OMITIDO` de empresas habilitadas (ver [Coordinación con n8n](#coordinación-con-n8n)); la selección sigue siendo exclusiva de n8n.

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
3. **Respuesta 202 ciega:** el Hub no sabe si n8n actuó. Un `OMITIDO` de una empresa habilitada que n8n no logre procesar (o que vuelva a quedar `OMITIDO`) seguirá mostrando el botón.
4. **Docker:** `compose.pilot.yaml` no pasa las variables `PAYMENT_NOTIFICATIONS_*` a la API ([inconsistencia #13](../../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)): en el piloto Docker el reproceso responde `UPSTREAM_ERROR` salvo que se añadan.
5. **Mismo `path` de webhook en TEST y PROD:** activar ambos workflows (o publicar ambos) causa conflicto; TEST y PROD comparten instancia.
6. **`TEST` con la credencial de Outlook de PROD:** un reproceso en TEST opera sobre el mismo buzón.
