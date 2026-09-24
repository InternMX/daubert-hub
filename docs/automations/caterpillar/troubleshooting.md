# Caterpillar — Troubleshooting

Guía práctica. Cada caso: **síntoma → causa probable → qué revisar → qué NO hacer → acción segura**. Las causas son *probables* (derivadas del código/SQL y de la topología); confirma con la evidencia indicada. Guía general del sistema: [operations/troubleshooting](../../operations/troubleshooting.md).

## Reglas generales

1. **Primero lee, luego actúa.** Empieza por el detalle de la ejecución en el Hub (`latestErrorNode`, `latestErrorMessage`, `failedAttempts/maxAttempts`, reservas, remisiones, "Reproceso de").
2. **Nunca** edites a mano `ops.ejecuciones_automatizacion`, `operacion.reservas_folios`, `operacion.series_documentales.siguiente_folio` ni `core.documentos` para "destrabar". Rompe la idempotencia y puede duplicar folios.
3. **Nunca** pegues tokens/passwords en tickets, chats ni documentos.
4. **No llames al webhook de PROD "para probar"** con ejecuciones reales elegibles.
5. Distingue el **entorno** (`/api/health` → `environment`) antes de diagnosticar.
6. Toda consulta SQL de diagnóstico debe ser **de sólo lectura**:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT ejecucion_id, estado, iniciada_en, finalizada_en, intentos_fallidos, max_intentos,
       error_nodo, error_mensaje, n8n_execution_id, reproceso_de_id, documento_origen_id
FROM ops.ejecuciones_automatizacion
ORDER BY ejecucion_id DESC LIMIT 20;
ROLLBACK;
```

### Cómo distinguir el origen de un error de reproceso desde el Hub

| Código del Hub | Significa | Es… |
| --- | --- | --- |
| 404 | `NOT_FOUND` (respuesta de dominio de n8n) | Dominio |
| 409 | `NOT_ELIGIBLE_STATE`, `SOURCE_FILE_MISSING`, `OUTSIDE_*_SCOPE` | Dominio |
| 502 | n8n inaccesible, token incorrecto, webhook inactivo, respuesta inválida, no configurado | Infraestructura/contrato |
| 504 | n8n tardó más de 10 s | Infraestructura |

---

## 1. `Cannot POST …`

- **Síntoma:** un cliente HTTP ve `Cannot POST /…` (404).
- **Causa probable:** (a) ruta inexistente en la **API** (Nest responde `Cannot POST /api/...`): URL sin el prefijo `/api`, ID/ruta mal escritos, o una **imagen de API anterior** al endpoint de reproceso; (b) en **n8n**, una URL de webhook incorrecta o no registrada.
- **Qué revisar:** la ruta exacta (`POST /api/automations/remissions/caterpillar/executions/:executionId/reprocess`), `version`/`commit` en `/api/health`, y la ruta del webhook configurada (`/webhook/cat-reprocess` en PROD).
- **Qué NO hacer:** no "adivinar" rutas de webhook ni cambiar la URL por la de TEST en PROD.
- **Acción segura:** corregir la URL/redeployar la imagen correcta; para n8n, ver caso 3.

## 2. `502 upstream` / Bad Gateway

- **Síntoma:** el navegador muestra 502.
- **Causa probable:** hay **dos** tipos de 502. (a) **Nginx** no alcanza `api:3000` (contenedor caído/reiniciando/no saludable): cuerpo HTML "Bad Gateway". (b) La **API** respondió 502 JSON (`No se pudo iniciar el reproceso en este momento.`): falló el salto Hub→n8n (n8n caído, token incorrecto, webhook inactivo, respuesta inválida, variables sin configurar).
- **Qué revisar:** `docker compose … ps` (estado *healthy* de `api`), logs de `api`; cuerpo de la respuesta (HTML vs JSON); casos 3, 4, 13.
- **Qué NO hacer:** no reiniciar a ciegas PostgreSQL ni n8n; no relanzar el reproceso en bucle.
- **Acción segura:** si es (a), reiniciar sólo el contenedor `api` tras revisar logs; si es (b), resolver la causa en n8n/variables y reintentar **una vez** (el reproceso es idempotente).

## 3. Webhook inactivo

- **Síntoma:** reproceso devuelve 502; en n8n el webhook "no está registrado".
- **Causa probable:** en **PROD**, el workflow con la rama de reproceso no está **activo**; en **TEST**, la URL `webhook-test` sólo responde mientras el editor está en *Execute workflow*.
- **Qué revisar:** n8n → el workflow `Remisiones CAT Produccion PG` está activo (PROD); `CATERPILLAR_REPROCESS_WEBHOOK_URL` apunta a `/webhook/cat-reprocess` (PROD) o `/webhook-test/…` (TEST).
- **Qué NO hacer:** no activar además el workflow pre-12C (caso 15); no apuntar PROD a `webhook-test`.
- **Acción segura:** activar el workflow correcto (o poner el editor a escuchar en TEST) y reintentar.

## 4. Token incorrecto

- **Síntoma:** 502 constante aunque n8n esté activo; en n8n el rechazo es de autenticación (403). Si el token no está configurado en la API, el Hub responde 502 sin llamar a n8n (`NOT_CONFIGURED`).
- **Causa probable:** el valor de `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN` en `pilot.prod.env` no coincide con la credencial *Header Auth* de n8n; se usó la de TEST en PROD; variable vacía.
- **Qué revisar:** que la variable esté **definida** sin imprimirla, p. ej. `docker compose … exec api sh -c '[ -n "$CATERPILLAR_REPROCESS_WEBHOOK_TOKEN" ] && echo definido || echo vacio'`; que la credencial n8n usada por el webhook sea la de PROD y su header sea `X-Daubert-Automation-Token`.
- **Qué NO hacer:** no imprimir/pegar el token; no reutilizar el de TEST; no dejar el webhook sin autenticación "para probar".
- **Acción segura:** alinear ambos valores por el canal seguro habitual, recrear el contenedor `api` con el archivo de entorno corregido y reintentar.

## 5. `OUTSIDE_ALLOWED_SCOPE`

- **Síntoma:** 409 "La ejecución no pertenece al ámbito permitido para este entorno."
- **Causa probable:** la ejecución es de un proceso **no habilitado** en PROD (hoy sólo P2, P5, P6). Es el comportamiento esperado (fail closed). En TEST el equivalente es `OUTSIDE_TEST_SCOPE`.
- **Qué revisar:** en el detalle, la serie reservada / etiqueta de proceso; en la vista de Series, qué rutas/series están activas ([runbook](production-runbook.md#procesos-habilitados-hoy)).
- **Qué NO hacer:** no cambiar `estatus` de series ni editar la lista de procesos habilitados sólo para que "pase".
- **Acción segura:** si el negocio requiere habilitar el proceso, hacerlo como cambio controlado (lista del workflow + serie `ACTIVA` + contador verificado) y documentarlo; luego reintentar.

## 6. Serie inactiva

- **Síntoma:** la ejecución falla con un `error_mensaje` que menciona serie inactiva o "not an active route"; el Hub muestra la serie como *Inactiva*.
- **Causa probable:** `reservar_folios_para_ejecucion` rechaza series `INACTIVA` o que no son ruta **activa** de la automatización (SQLSTATE `55000`). Ocurre si el archivo es de un proceso no habilitado o se desactivó la serie/ruta a mitad de camino.
- **Qué revisar:** vista de Series (estado de ruta y de serie), `error_nodo`/`error_mensaje` de la ejecución.
- **Qué NO hacer:** no activar la serie sin confirmar el contador de folios con el negocio; no mover `siguiente_folio` por SQL.
- **Acción segura:** decidir si el proceso debe estar habilitado; si sí, seguir el cambio controlado del caso 5 y luego reprocesar (la ejecución quedó `ERROR` y sus reservas `ABANDONADA`).

## 7. Archivo faltante (`SOURCE_FILE_MISSING`)

- **Síntoma:** 409 "El archivo origen ya no está disponible para reprocesar."
- **Causa probable:** el archivo se movió, renombró o eliminó de la ruta guardada en `core.documentos.ruta_archivo` (o Dropbox aún no sincroniza en el equipo de n8n).
- **Qué revisar:** en el detalle, `sourceDocument.path`; comprobar en el equipo de n8n que el archivo exista en esa ruta exacta.
- **Qué NO hacer:** no crear un archivo "de reemplazo" con otro nombre (sería un documento nuevo → ejecución normal y **folios nuevos**); no editar `ruta_archivo` en la BD.
- **Acción segura:** restaurar el archivo original en su ruta original (p. ej. desde el historial de versiones de Dropbox) y reintentar el reproceso.

## 8. `source document missing`

- **Síntoma:** el brief de la fase menciona `SOURCE_DOCUMENT_MISSING`, pero el Hub no lo conoce.
- **Causa probable:** **ese código no existe en el Hub.** En la práctica, si el documento origen no existe, `ops.fn_resolver_ejecucion_para_reproceso` devuelve `encontrada = false` y el resultado es `NOT_FOUND` (404). Si algún workflow devolviera literalmente `SOURCE_DOCUMENT_MISSING`, el Hub lo trataría como respuesta inválida (502).
- **Qué revisar:** que la ejecución sea de Caterpillar; que exista la fila en `core.documentos` para su `documento_origen_id` (sólo lectura); el cuerpo real que devuelve el workflow (log de n8n).
- **Qué NO hacer:** no insertar documentos a mano.
- **Acción segura:** escalar como problema de integridad de datos; si se decide soportar el código, cambiar cliente, servicio, controlador, UI y tests, y actualizar [reprocessing](reprocessing.md#contrato).

## 9. El workflow responde pero el Hub muestra error

- **Síntoma:** en n8n el reproceso corre (o incluso termina), pero el Hub muestra error (502/504).
- **Causa probable:** (a) el Hub esperó más de **10 s** (504) mientras n8n siguió ejecutando; (b) la respuesta de n8n no cumple el contrato (2xx sin `accepted/status/executionId`, `error` desconocido, HTML, 3xx, 5xx); (c) el nodo de respuesta del webhook no devuelve JSON.
- **Qué revisar:** el log de la ejecución en n8n (¿qué respondió?); en el Hub, la lista de ejecuciones: **busca una fila con "Reproceso de" = id original** (la hija pudo crearse aunque el Hub mostró error).
- **Qué NO hacer:** no borrar la hija ni tocar la BD; no asumir que "no se creó".
- **Acción segura:** reintentar **una vez** (idempotente): devolverá `ALREADY_PROCESSING` o `ALREADY_REPROCESSED` con el `executionId` de la hija. Si es problema de contrato, corregir el nodo de respuesta del workflow.

## 10. Los folios no avanzan

- **Síntoma:** `siguiente_folio` de una serie no cambia.
- **Causa probable (normal):** no hay archivos nuevos; los archivos ya están `COMPLETADA` (`ALREADY_COMPLETED`); el proceso no está habilitado; la ejecución falló antes de reservar. **Causa probable (anómala):** workflow inactivo, automatización `INACTIVA`, ejecución atascada (caso 11).
- **Qué revisar:** Hub → Series (folio actual y ajustes), historial (¿hay `PROCESANDO`/`ERROR`?), estado del workflow y de `ops.automatizaciones.estatus`.
- **Qué NO hacer:** no hacer `UPDATE siguiente_folio`; no ejecutar el allocator a mano.
- **Acción segura:** si el valor realmente es incorrecto, usar el **ajuste seguro del Hub** (`ADMIN`, con motivo y control de concurrencia) — ver [document-series](../../database/document-series.md#ajuste-seguro-de-siguiente_folio-desde-el-hub).

## 11. Ejecución queda `PROCESANDO`

- **Síntoma:** una ejecución lleva mucho tiempo `PROCESANDO`.
- **Causa probable:** el run de n8n murió/reinició entre reservar y finalizar; quedan reintentos (`failedAttempts < maxAttempts`); el schedule está inactivo. Mientras esté `PROCESANDO`, el ciclo automático la reconoce como `ALREADY_PROCESSING` (no crea otra), y el reproceso responde `NOT_ELIGIBLE_STATE` (no es elegible).
- **Qué revisar:** `failedAttempts/maxAttempts`, `latestErrorNode/Message`, `n8nExecutionId` (buscar ese run en n8n), reservas `RESERVADA` en el detalle, si el workflow está activo.
- **Qué NO hacer:** no cambiar `estado` por SQL; no invocar funciones de finalización con `postgres` sin aprobación; no intentar reprocesar.
- **Acción segura:** dejar que el workflow reintente/termine; si n8n confirma que el run murió y no hay reintentos, escalar al equipo técnico. Existe la vía controlada de cerrar la ejecución con `ops.fn_finalizar_ejecucion_automatizacion` (`ERROR`/`CANCELADA`, que abandona reservas), pero **su procedimiento operativo formal está PENDIENTE**: sólo con aprobación y registro del cambio.

## 12. `ALREADY_REPROCESSED`

- **Síntoma:** mensaje "Esta ejecución ya fue reprocesada. Reproceso existente: #N".
- **Causa probable:** **no es un error.** El padre ya tiene su hijo directo (límite de uno por índice único); se pidió reprocesar de nuevo (doble clic, otro admin, reintento tras timeout).
- **Qué revisar:** abrir la ejecución `#N` (la hija) y ver su estado.
- **Qué NO hacer:** no intentar forzar otra hija ni eliminar la existente.
- **Acción segura:** trabajar con la hija. Si la hija terminó en `ERROR`, evaluar reprocesarla a ella (si el workflow lo permite: PENDIENTE de confirmar).

## 13. API *healthy* pero el webhook no responde

- **Síntoma:** `/api/health` da `database: connected`, pero el reproceso da 502/504.
- **Causa probable:** `/api/health` sólo prueba **la base de datos**, no a n8n. n8n caído, puerto/host incorrecto (`host.docker.internal:5678` en los ejemplos), firewall, workflow inactivo (caso 3), token (caso 4), o (TEST) el editor no está escuchando.
- **Qué revisar:** que n8n esté arriba y accesible desde el contenedor `api`; la URL configurada; el endpoint de salud de n8n si está habilitado.
- **Qué NO hacer:** no concluir "el Hub está bien" sólo por `/api/health`; no publicar el puerto de n8n a Internet para "probar".
- **Acción segura:** restablecer n8n/red y reintentar una vez.

## 14. Candidato n8n inactivo

- **Síntoma:** no se crean ejecuciones nuevas; en `/automations` la última revisión es antigua; o el reproceso da 502.
- **Causa probable:** el workflow candidato/nuevo (`Remisiones CAT Produccion PG`) **no está activo** en n8n, o la automatización está `INACTIVA` en `ops.automatizaciones` (`fn_crear_ejecucion_automatizacion` lo rechaza con `55000`). Son **dos hechos independientes**: workflow activo en n8n vs `estatus` en PostgreSQL vs `integrationStatus` del catálogo del Hub.
- **Qué revisar:** interruptor *Active* del workflow; `ops.automatizaciones.estatus` (sólo lectura); tarjeta en `/automations`.
- **Qué NO hacer:** no activar el workflow anterior "mientras tanto" sin desactivar el nuevo (caso 15); no cambiar `estatus` sin decisión de negocio.
- **Acción segura:** activar el workflow correcto y confirmar que el schedule corre a los 10 minutos.

## 15. Dos workflows activos accidentalmente

- **Síntoma:** ejecuciones duplicadas/conflictivas, fallos por `unique_violation`, PDFs sobrescritos, contadores de fallos que suben, o dos ejecuciones n8n disparadas en cada ciclo.
- **Causa probable:** el workflow pre-12C (rollback) y `Remisiones CAT Produccion PG` están activos a la vez; **comparten schedule** y archivos.
- **Qué revisar:** lista de workflows activos en n8n; en el log de n8n, dos runs por ciclo; en el Hub, ejecuciones del mismo archivo cercanas en el tiempo.
- **Qué NO hacer:** no borrar workflows ni filas de la BD; no "limpiar" reservas a mano.
- **Acción segura:** **desactivar el que no corresponda** (normalmente el pre-12C), esperar un ciclo, y auditar las últimas ejecuciones: PostgreSQL impide duplicar folios (única `PROCESANDO`, `ALREADY_COMPLETED`, reservas idempotentes), pero revisa que no queden ejecuciones `PROCESANDO` huérfanas ni PDFs inconsistentes (checklist de [testing](testing.md#validación-de-pdfs-manual)).
