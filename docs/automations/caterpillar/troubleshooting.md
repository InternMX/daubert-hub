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

- **Síntoma:** el reproceso devuelve 502 y en n8n el rechazo fue `SOURCE_DOCUMENT_MISSING` (HTTP 409).
- **Causa probable:** ese código **sí lo emite el workflow** (`Validar elegibilidad reproceso CAT`, cuando la fila resuelta no trae `documento_origen_id`, ruta o nombre) pero **el Hub no lo soporta** y lo trata como respuesta inválida (502). Si el documento origen no existe en `core.documentos`, el resolver (`JOIN` interno) devuelve `encontrada = false` y el resultado es `NOT_FOUND` (404).
- **Qué revisar:** el log de la ejecución del webhook en n8n (el cuerpo devuelto); que la ejecución sea de Caterpillar; la fila de `core.documentos` de su `documento_origen_id` (sólo lectura).
- **Qué NO hacer:** no insertar ni editar documentos a mano.
- **Acción segura:** escalar como problema de integridad de datos. Corregir la discrepancia requiere cambio de código (añadir el rechazo en cliente, servicio, controlador, UI y tests): ver [reprocessing](reprocessing.md#discrepancias-hub--n8n-verificadas-en-d2).

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
- **Acción segura:** trabajar con la hija. Si la hija terminó en `ERROR`, reprocesarla a ella es posible (el workflow sólo exige estado `ERROR`/`CANCELADA`; crea una nieta).

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

## 16. Reproceso responde 502 pero n8n devolvió 422 `SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING`

- **Síntoma:** el Hub muestra 502 ("No fue posible comunicarse correctamente con la automatización"); en n8n la respuesta fue 422.
- **Causa probable:** `Detectar archivo REPROCESS CAT1` falló: el archivo dejó de existir entre la validación y la detección, no es un Excel válido, o el ítem no llegó validado. El Hub no reconoce ese código.
- **Qué revisar:** el error del nodo en la ejecución de n8n; la ruta `sourceDocument.path` del detalle.
- **Qué NO hacer:** no editar `ruta_archivo`; no crear un archivo con otro nombre.
- **Acción segura:** restaurar el archivo original en su ruta y reintentar.

## 17. Una ejecución falla en un nodo distinto de `Normalizar datos CAT` / `Convertir PDF CAT`

- **Síntoma:** ejecución n8n en error pero la ejecución de PostgreSQL queda `PROCESANDO` sin `intentos_fallidos` ni `error_nodo`.
- **Causa probable:** sólo esos dos nodos tienen salida de error hacia `Registrar fallo PG`; **no hay Error Workflow**. Un fallo en otro nodo (p. ej. `Renderizar HTML`, `Registrar remisión PG`, un nodo de lectura de archivo) aborta la ejecución sin registrar el fallo. El siguiente ciclo recibirá `ALREADY_PROCESSING` y **reintentará** el archivo sobre la misma ejecución.
- **Qué revisar:** historial de ejecuciones de n8n (nodo en rojo); si el reintento del siguiente ciclo tuvo éxito.
- **Qué NO hacer:** no marcar la ejecución como `ERROR` por SQL; no borrar reservas.
- **Acción segura:** corregir la causa (plantilla ausente, archivo bloqueado por Dropbox, script PowerShell) y dejar que el ciclo reintente.

## 18. Se editó `PROCESOS_HABILITADOS_PROD` y el reproceso no coincide con el escaneo

- **Síntoma:** un proceso se procesa automáticamente pero su reproceso responde `OUTSIDE_ALLOWED_SCOPE` (o al revés).
- **Causa probable:** la lista (y `RUTAS_REALES`) está **copiada** en `Detectar archivos CAT1` y en `Validar elegibilidad reproceso CAT`; sólo se editó una.
- **Qué revisar:** ambas constantes en el workflow.
- **Qué NO hacer:** no dejar copias distintas.
- **Acción segura:** editar las dos copias en el mismo cambio y versionar el nuevo export.

## 19. Un archivo nuevo de Programación de Entrega no se procesa

- **Síntoma:** el archivo está en la carpeta pero no genera ejecución.
- **Causa probable (verificada en el detector):** el nombre no contiene `PROGRAMACION DE ENTREGA`; no es Excel o es temporal (`~$`); el proceso no está habilitado (P3, P4, Nuevo Laredo, Torreón); FINSA distinta de 1/3 o planta no detectada en el nombre; el archivo es anterior al corte (2026-09-22) o su fecha de modificación no es confiable; está en una carpeta de año que no se escanea (sólo el año actual; en enero también el anterior); está en una subcarpeta (el escaneo no es recursivo).
- **Qué revisar:** el nombre y la carpeta contra las reglas de [workflow.md](workflow.md#puntos-verificados).
- **Qué NO hacer:** no renombrar/mover masivamente archivos históricos: se procesarían si cumplen el patrón y son posteriores al corte.
- **Acción segura:** corregir el nombre/ubicación de ese archivo y esperar el siguiente ciclo (10 min).
