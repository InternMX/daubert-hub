# Recuperación de ejecuciones Audi

**Integración n8n pendiente.** El contrato se limita a TEST.

## Estados y elegibilidad

Una ejecución `LEGACY` carece de reserva vinculada y requiere recuperación manual. Una ejecución `ATOMIC` tiene una reserva creada por `ops.fn_admitir_reservar_audi_test`. Los estados de ejecución son `PROCESANDO`, `COMPLETADA`, `ERROR` y `CANCELADA`. Los intentos usan `EN_CURSO`, `COMPLETADA`, `FALLIDA` y `EXPIRADA`. Un intento terminal rechaza cualquier actualización. Todos los intentos rechazan el borrado con `AUDI_RECOVERY_HISTORY_IMMUTABLE`.

| Acción | Condición | Códigos de rechazo |
| --- | --- | --- |
| `REPROCESS` | `ATOMIC` en `ERROR` o `CANCELADA`, sin remisión vigente, reserva `RESERVADA`, evidencia histórica, hija ni intento activo | `PENDING_RECONCILIATION`, `PARTIAL_ARTIFACTS`, `ALREADY_REPROCESSED`, `ACTION_IN_PROGRESS`, `NOT_ELIGIBLE_STATE`, `LEGACY_EXECUTION` |
| `RECONCILE` | `ATOMIC` en `ERROR` con reserva `RESERVADA` | `ALREADY_COMPLETED`, `NOT_ELIGIBLE_STATE`, `ACTION_IN_PROGRESS`, `STALE_REVISION`, `LEGACY_EXECUTION` |
| `STOP` | `PROCESANDO` con `n8n_execution_id` y sin intento activo | `NOT_ELIGIBLE_STATE`, `ACTION_IN_PROGRESS`, `LEGACY_EXECUTION` para legadas sin id de n8n |
| `CANCEL` | `ATOMIC` en `ERROR` o `PROCESANDO` con confirmación de detención, sin remisiones `GENERADA` ni evidencia `VERIFICADO` | `REMISSIONS_ISSUED`, `PARTIAL_ARTIFACTS_REQUIRE_RECONCILIATION`, `N8N_RUNNING`, `ALREADY_CANCELLED`, `STALE_REVISION`, `ACTION_IN_PROGRESS`, `LEGACY_EXECUTION` |

La cancelación limpia deja la ejecución y las remisiones pendientes en `CANCELADA` y la reserva en `ABANDONADA`. Una cancelación con archivos conserva el inventario, termina `FALLIDA` y deja intactas la ejecución, la reserva y las remisiones. Los folios siguen consumidos en ambos casos. Cualquier fila de evidencia, incluida `FALTANTE`, impide el reproceso automático.

## Arrendamiento, fencing e idempotencia

`ops.fn_autorizar_accion_audi_test` opera en READ COMMITTED y bloquea ejecución, reserva y remisiones en ese orden. Hay un solo intento `EN_CURSO` por ejecución. La función devuelve `(outcome, accion_id, revision, attempt_estado, claimed)`. Un `request_id` repetido devuelve la autorización y revisión originales con el estado y la reclamación actuales del intento. Otra solicitud durante el arrendamiento recibe `ACTION_IN_PROGRESS` con el identificador, estado y reclamación del intento activo. Para reconciliar o cancelar, `expectedRevision` debe coincidir con `<estado>:<last accion_id or 0>`.

`ops.fn_reclamar_accion_audi_test` genera `token_fencing` al reclamar y devuelve el mismo token al mismo worker. Otro worker recibe `ALREADY_CLAIMED`. El arrendamiento vence tras 15 minutos de inactividad medidos con `clock_timestamp()`. `ops.fn_latido_accion_audi_test` y las escrituras exitosas lo renuevan. El worker envía un latido al menos cada 5 minutos y conserva el token dentro de su ejecución. Cada escritura comprueba intento, worker, token y vigencia bajo bloqueo.

La expiración perezosa marca `EXPIRADA` con `LEASE_EXPIRED`. El Hub puede invocar `ops.fn_expirar_acciones_audi_test(p_limite int DEFAULT 100)` antes de autorizar. El operador puede ejecutar la misma función con aprobación. No hay programador. El worker se detiene al recibir `ATTEMPT_EXPIRED` o `STALE_ATTEMPT`. Un nuevo intento usa otra fila y otro token. Los datos registrados sobreviven a la expiración. Un nuevo RECONCILE puede finalizar una ejecución en `ERROR` con reserva `RESERVADA` aunque toda la evidencia ya esté verificada. Los reportes idénticos devuelven `ALREADY_RECORDED` sin crear versiones.

`ops.fn_cerrar_accion_audi_test` registra un fallo del worker. `ops.fn_fallar_despacho_accion_audi_test` cierra un intento sin reclamar cuando n8n rechaza definitivamente el despacho. Si la respuesta se pierde, el intento sigue vigente. El Hub puede volver a despachar el mismo `actionId` mientras siga sin reclamar. Si ya fue reclamado, devuelve `ACTION_IN_PROGRESS`.

## Evidencia y cierre

`operacion.fn_registrar_artefacto_audi_test` registra `REMISION_PDF` por remisión y un solo `HOJAS_IDENTIFICACION_PDF` por ejecución. El worker mide el archivo y calcula el SHA-256 desde disco. `VERIFICADO` exige tamaño positivo y hash hexadecimal en minúsculas. Una repetición idéntica devuelve `ALREADY_RECORDED`. Cualquier cambio de estado, ruta, tamaño o hash devuelve `NEW_VERSION` y enlaza la versión anterior con `reemplaza_artefacto_id`. Se conservan todas las versiones. Una remisión verificada pasa de `PENDIENTE` a `GENERADA` durante la emisión o reconciliación.

`ops.fn_finalizar_audi_test` exige una remisión `GENERADA` por folio reservado, el PDF vigente `VERIFICADO` con la misma ruta que `pdf_path` para cada una, las hojas vigentes `VERIFICADO` y ninguna evidencia asociada a remisiones ajenas. Si falta algo, devuelve `INCOMPLETE` con una lista y el intento permanece activo. Con evidencia completa, aplica la reserva (`APLICADA`) y completa la ejecución y el intento en la misma transacción. Una ejecución completa responde `EXECUTION_CLOSED` a nuevos reportes. PostgreSQL verifica la información registrada por el worker. El Hub muestra la evidencia y el nombre del archivo.

## Contrato del Hub

Ruta base `/api/automations/remissions/audi/executions/:executionId`. El identificador es un int8 positivo representado como cadena. El GET está disponible para GENERAL y ADMIN. GENERAL recibe todas las acciones deshabilitadas con `FORBIDDEN`. El detalle tolera los SQLSTATE `42883` y `42P01` con campos de recuperación nulos y `RECOVERY_NOT_INSTALLED`. La respuesta excluye rutas completas y tokens.
```json
{ "data": {
  "executionId": "31", "outcome": "FAILED", "startedAt": "…", "finishedAt": "…",
  "n8nExecutionId": "16061", "reprocessOfExecutionId": null, "childExecutionId": null,
  "model": "ATOMIC", "revision": "ERROR:0",
  "reservation": { "firstFolio": "988", "lastFolio": "990", "quantity": 3, "status": "RESERVADA" },
  "remittances": [{ "remissionId": "…", "seriesCode": "REMISION_AUDI", "folio": "988", "documentDate": "…", "status": "PENDIENTE" }],
  "artifacts": [{ "type": "REMISION_PDF", "folio": "988", "version": 2, "current": true, "fileName": "…pdf", "sizeBytes": 48211, "sha256": "…", "status": "VERIFICADO", "verifiedAt": "…", "actionId": "5" }],
  "recoveryAttempts": [{ "actionId": "5", "action": "RECONCILE", "status": "FALLIDA", "resultCode": "LEASE_EXPIRED", "reason": "…", "actorName": "…", "createdAt": "…", "lastHeartbeatAt": "…", "expiresAt": "…", "finishedAt": "…", "error": "…" }],
  "availableActions": [
    { "action": "RECONCILE", "enabled": false, "disabledReason": "INTEGRATION_NOT_CONFIGURED" },
    { "action": "REPROCESS", "enabled": false, "disabledReason": "PENDING_RECONCILIATION" },
    { "action": "STOP", "enabled": false, "disabledReason": "NOT_ELIGIBLE_STATE" },
    { "action": "CANCEL", "enabled": false, "disabledReason": "INTEGRATION_NOT_CONFIGURED" } ],
  "sourceDocument": {}, "latestErrorMessage": "…", "generatedCount": 0 } }
```

Cada POST exige ADMIN y `reason` recortado de 1 a 500 caracteres. La respuesta tiene forma `{ data: { accepted, status, actionId, executionId, childExecutionId? } }`.

| Ruta | Cuerpo | Respuestas |
| --- | --- | --- |
| `POST /reprocess` | `{ reason }` | 202 `DISPATCHED`, 200 `ACTION_IN_PROGRESS` o `ALREADY_REPROCESSED` |
| `POST /reconcile` | `{ reason, expectedRevision }` | 202 `DISPATCHED`, 200 `ACTION_IN_PROGRESS` o `ALREADY_COMPLETED` |
| `POST /stop` | `{ reason }` | 202 `STOP_REQUESTED`, 200 `NOT_RUNNING` o `ALREADY_FINISHED` |
| `POST /cancel` | `{ reason, expectedRevision }` | 202 `DISPATCHED`, 200 `ALREADY_CANCELLED` o `ACTION_IN_PROGRESS` |

400 para id o cuerpo inválido, 401 sin sesión, 403 sin rol, 404 fuera de Audi o inexistente y 409 para conflictos de elegibilidad. El Hub comprueba `INTEGRATION_NOT_CONFIGURED` y `RECOVERY_NOT_INSTALLED` antes de autorizar y devuelve 503. Devuelve 502 si n8n no está disponible o responde de forma inválida y 504 con `actionId` si el resultado es desconocido tras un timeout. Los mensajes salen en español por `SafeExceptionFilter`.

## Contrato n8n

`AUDI_RECOVERY_WEBHOOK_URL` y `AUDI_RECOVERY_WEBHOOK_TOKEN` son configuración nullable de servidor en `audiRecoveryWebhook: { url, token }`. Cabecera `X-Daubert-Automation-Token`, timeout de 10 segundos y validación de respuesta. Un código desconocido se trata como `INVALID_RESPONSE`.

Solicitud del Hub a n8n:
```json
{ "contractVersion": 1, "action": "RECONCILE", "actionId": "5", "executionId": "31", "reason": "…" }
```

Respuestas de n8n al Hub:
```json
{ "accepted": true,  "status": "DISPATCHED", "actionId": "5" }
{ "accepted": true,  "status": "ALREADY_DISPATCHED", "actionId": "5" }
{ "accepted": true,  "status": "STOP_REQUESTED" | "NOT_RUNNING" | "ALREADY_FINISHED", "actionId": "7", "n8nExecutionId": "16061" }
{ "accepted": false, "error": "NOT_FOUND" | "NOT_ELIGIBLE_STATE" | "STALE_ATTEMPT" | "OUTSIDE_TEST_SCOPE" | "OUTSIDE_ALLOWED_SCOPE" }
```

El worker deduplica por `actionId`, reclama el intento antes de trabajar y verifica o regenera sólo los PDF de los folios reservados y un PDF de hojas de identificación. El contenido nuevo se escribe en otro archivo para conservar el anterior. Usa `ops.fn_completar_cancelacion_audi_test` después de comprobar la detención e inventariar los archivos. Cada archivo se registra antes de cerrar. La admisión normal respeta `REQUIRES_RECOVERY` y la recuperación usa exclusivamente la reserva atómica.

La admisión normal recibe `p_remisiones` como arreglo en el orden de asignación de folios. Cada elemento contiene `fecha_documento` y un arreglo `detalle` con `codigo_interno`, `part_number`, `descripcion` y `cantidad_texto`. PostgreSQL toma `empresa_cliente_id` de la ruta activa. El inventario `p_inventario` es un arreglo de objetos con `tipo`, `remision_id`, `ruta`, `tamano_bytes`, `sha256` y `estado`. Un archivo que el worker no pueda asociar a una clave del inventario requiere revisión manual. El worker debe cerrar el intento como fallido en ese caso.

| Función SQL | Argumentos en orden |
| --- | --- |
| `ops.fn_admitir_reservar_audi_test` | `p_documento_id, p_worker, p_cantidad, p_remisiones, p_reproceso_de_id, p_accion_id, p_token` |
| `ops.fn_reclamar_accion_audi_test` | `p_accion_id, p_worker` |
| `ops.fn_latido_accion_audi_test` | `p_accion_id, p_worker, p_token` |
| `operacion.fn_registrar_artefacto_audi_test` | `p_ejecucion, p_worker, p_accion_id, p_token, p_tipo, p_remision_id, p_ruta, p_tamano, p_sha256, p_estado` |
| `ops.fn_finalizar_audi_test` | `p_ejecucion, p_worker, p_accion_id, p_token` |
| `ops.fn_cerrar_accion_audi_test` | `p_accion_id, p_worker, p_token, p_codigo, p_error` |
| `ops.fn_completar_cancelacion_audi_test` | `p_accion_id, p_worker, p_token, p_n8n_detenida, p_inventario` |

En la emisión normal, el worker coincide con `n8n_execution_id` y los argumentos `p_accion_id` y `p_token` van nulos en registro y cierre de ejecución. En recuperación se envían el identificador y el token devueltos por la autorización y la reclamación respectivamente. Los identificadores bigint se transportan como cadenas.

Para REPROCESS, la admisión exige los tres argumentos `p_reproceso_de_id`, `p_accion_id` y `p_token`. Una combinación parcial devuelve `STALE_ATTEMPT`. PostgreSQL vuelve a evaluar al padre bajo bloqueo y rechaza el reproceso si el documento tiene una ejecución `PROCESANDO`. Con `REPROCESS_CREATED`, la hija recibe folios nuevos y el intento queda `COMPLETADA` con el identificador de la hija. El padre y sus datos se conservan. El mismo worker y token reciben `OWNED_RETRY` si la hija sigue `PROCESANDO` y conserva la reserva `RESERVADA` de la misma cantidad.

### Ejemplos

1. **Reconciliación completa.** Para 988–990, el worker reclama la acción 5, calcula tamaño y hash de cada PDF y de las hojas, registra la evidencia y finaliza. La reserva pasa a `APLICADA` y la ejecución a `COMPLETADA`.
2. **Falta un PDF.** El PDF 989 se registra `FALTANTE`. El cierre devuelve `INCOMPLETE`. Si el worker no puede generarlo, cierra el intento `FALLIDA`. La ejecución queda en `ERROR`.
3. **Regeneración de un PDF.** El worker escribe un PDF nuevo para 989, calcula su hash y registra `VERIFICADO` como versión 2 enlazada a la versión 1. Con las demás evidencias completas, finaliza con los mismos folios.
4. **Caída del worker.** Pasan 15 minutos sin escrituras ni latidos. Se marca `EXPIRADA`. Un ADMIN autoriza otro intento, que vuelve a verificar los PDF válidos y recibe `ALREADY_RECORDED` al reportarlos sin cambios. El token anterior no permite escrituras.
5. **Cancelación limpia.** El worker confirma detención, reporta inventario vacío y completa la cancelación. Un reproceso posterior crea una hija con folios nuevos.
6. **Cancelación parcial.** El inventario encuentra el PDF 988. Se guarda la evidencia y el intento falla con `PARTIAL_ARTIFACTS_REQUIRE_RECONCILIATION`. Se mantienen los folios originales para reconciliación.
7. **Detención.** La acción 7 solicita detener la ejecución n8n 16061 y devuelve `STOP_REQUESTED`. STOP conserva el estado PostgreSQL. CANCEL requiere su propio intento e inventario.

## Procedimiento E2E futuro en TEST

Antes de aplicar 027 o integrar al worker, guardar la evidencia del precheck y obtener aprobación explícita para cada gate.

- **R2.** Verificar si el asignador legado bloquea la fila de serie con `FOR UPDATE` y acordar un corte con una sola versión del workflow. Ambos asignadores avanzan el contador de `REMISION_AUDI`.
- **R3.** Confirmar el rol real de n8n Audi TEST y validar los permisos mínimos para las funciones de worker.
- **R4.** Confirmar la serie `REMISION_AUDI` activa y enrutada a `REMISIONES_AUDI`. Si no existe la ruta activa, resolverla con el operador antes de continuar.

Verificar también que el Error Workflow deja la reserva `RESERVADA` al marcar `ERROR`. Con los gates aprobados, el operador aplica precheck, up y postcheck en `daubert_hub_test` y compara los baselines. Implementar el contrato en n8n TEST y configurar el webhook TEST. Probar reconciliación completa, PDF faltante, hojas faltantes, doble clic, timeout, expiración, detención activa, cancelación limpia y parcial y reproceso tras cancelación limpia. Validar de extremo a extremo que `Marcar ejecución ERROR PG` registra `ERROR` con reserva activa. Sólo después se planifica PROD.

El postcheck compara los valores `series_md5` y `cat_functions_md5` del precheck con los parámetros de sesión `audi_recovery.series_md5` y `audi_recovery.cat_functions_md5`. El operador conserva los dos valores del precheck y configura ambos parámetros en la sesión TEST que ejecutará el postcheck.

El alta del worker exige confirmar el rol de R3. Tras instalar 027 en TEST, el operador puede usar la [plantilla de permisos para el worker Audi TEST](../../../database/migrations/daubert_global/20261118_027_audi_worker_role_test.template.sql) con la variable `worker_role` y verificar los permisos efectivos.
