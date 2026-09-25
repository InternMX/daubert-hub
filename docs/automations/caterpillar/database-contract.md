# Caterpillar — Contrato de base de datos

Fuentes: migración 009 (repo), paquete Caterpillar 2026-09-21 y `20260911_001/003` (externos), consultas de `caterpillar-*.repository.ts`, runner `caterpillar-model`. Explica **responsabilidades**, no copia funciones. Esquema general: [database/architecture](../../database/architecture.md).

## Tablas

| Tabla | Rol en Caterpillar | Claves/restricciones relevantes |
| --- | --- | --- |
| `ops.automatizaciones` | Fila `REMISIONES_CATERPILLAR`. Si su `estatus` no es `ACTIVA`, no se crean ejecuciones (SQLSTATE `55000`). | `codigo` |
| `ops.ejecuciones_automatizacion` | Un intento sobre un documento origen. | Estado ∈ `PROCESANDO`/`COMPLETADA`/`ERROR`/`CANCELADA`. `reproceso_de_id` (FK a sí misma). Índice único parcial `uq_ejecuciones_automatizacion_completada_original` (una `COMPLETADA` original por automatización+documento). Índice único parcial `uq_ejecuciones_automatizacion_reproceso_unico` (un hijo directo por padre). Sólo una `PROCESANDO` por automatización+documento (conflicto → `ALREADY_PROCESSING`). Contadores `intentos_fallidos`/`max_intentos` con CHECK. |
| `ops.automatizacion_series_proceso` | Nueve rutas `llave_proceso` → serie + cliente, con `estatus`. | `UNIQUE(automatizacion_id, llave_proceso)`; trigger de dueño único de serie |
| `ops.automation_trigger_requests` | Auditoría de los reprocesos pedidos desde el Hub (`action_type = 'REPROCESS'`). | `outcome` ∈ `TRIGGERED`/`NOTHING_TO_REPROCESS`/`UPSTREAM_ERROR`; Hub sólo `INSERT` |
| `core.documentos` | Documento origen. Su `ruta_archivo` y `nombre_archivo` son los que usa el reproceso. | Índices únicos por empresa + ruta normalizada, con y sin hash (versionado de archivo) |
| `operacion.series_documentales` | Contadores de folio. | `siguiente_folio`, `estatus`, `folio_minimo_ajustable` |
| `operacion.reservas_folios` | Reserva por (ejecución, serie). | `UNIQUE(ejecucion_id, serie_id)`; `RESERVADA`/`APLICADA`/`ABANDONADA`; rango coherente `final = inicial + cantidad − 1` |
| `operacion.remisiones` | Remisión generada. | Estados vistos en el Hub: `PENDIENTE`, `GENERADA`, `CANCELADA`. `ejecucion_id`, `serie_id`, `folio`, `fecha_documento`, `pdf_path`, `empresa_cliente_id` (derivado en servidor, nunca aceptado del llamador) |
| `operacion.remision_detalle` | Renglones: `codigo_interno`, `part_number`, `descripcion`, `cantidad_texto`. | |
| `operacion.ajustes_series` | Historial del ajuste manual de folio. | |

## Funciones

Todas `SECURITY DEFINER`, con `search_path` fijo, `REVOKE … FROM PUBLIC` y `EXECUTE` a `n8n_app` (PROD). El Hub **no** tiene `EXECUTE` sobre ellas.

| Función | Responsabilidad | Resultados / errores destacados |
| --- | --- | --- |
| `ops.fn_resolver_ruta_automatizacion(codigo, llave)` | Dado el código de automatización y la `llave_proceso`, devuelve ruta, serie (código/estatus) y cliente **sólo si la ruta está `ACTIVA`**. | Cero filas = desconocida/inactiva (falla cerrado) |
| `core.fn_crear_o_resolver_documento(empresa, tipo, nombre, ruta, origen, fecha, hash)` | Crea el documento origen o devuelve el existente (mismo empresa + ruta normalizada [+ hash]). | `ya_existia` |
| `ops.fn_crear_ejecucion_automatizacion(codigo, documento, n8n_execution_id, run_name, reproceso_de_id)` | Crea o recupera la ejecución. **Ruta normal** (`reproceso_de_id` nulo): reutiliza una `PROCESANDO`; si no, devuelve el estado terminal más reciente del documento (reprocesos incluidos). **Reproceso**: inserta una hija `PROCESANDO`; si ya hay `PROCESANDO` → `ALREADY_PROCESSING`; si el padre ya tiene hijo → `ALREADY_REPROCESSED`. | `motivo` ∈ `CREATED`, `REPROCESS_CREATED`, `ALREADY_PROCESSING`, `ALREADY_COMPLETED`, `ALREADY_ERROR`, `ALREADY_CANCELLED`, `ALREADY_REPROCESSED`; `22023` (documento requerido), `P0002` (automatización inexistente), `55000` (automatización inactiva) |
| `operacion.reservar_folios_para_ejecucion(ejecucion, serie_codigo, cantidad)` | Reserva un rango contiguo atómico e idempotente. Valida ejecución `PROCESANDO`, serie ruta **activa** de la automatización y serie `ACTIVA`. Bloqueo advisory + `FOR UPDATE` de la serie. | Reintento igual → misma reserva; cantidad distinta → `23505`; `55000` inactiva/ajena |
| `operacion.fn_registrar_remision_generada(ejecucion, serie, folio, fecha, pdf_path, detalles jsonb)` | Persiste remisión + renglones. Valida ejecución `PROCESANDO`, ruta y **que el folio esté dentro de la reserva**. Idempotente: mismo folio+mismos datos → `ya_existia`; datos distintos o folio de otra ejecución → `23505` (nunca sobrescribe). | `remision_id`, `ya_existia` |
| `ops.fn_finalizar_ejecucion_automatizacion(ejecucion, estado_final, error_nodo, error_mensaje)` | Cierra la ejecución. Estados finales válidos: `COMPLETADA`, `ERROR`, `CANCELADA`. `ERROR` exige mensaje; los otros no admiten metadatos de error. **Integridad de completitud**: para `COMPLETADA`, cada reserva `RESERVADA` debe tener exactamente `cantidad` remisiones `GENERADA` en su rango. `COMPLETADA` → reservas `APLICADA`; `ERROR`/`CANCELADA` → `ABANDONADA`. Idempotente. | `ya_estaba_finalizada`, `reservas_aplicadas`, `reservas_abandonadas` |
| `ops.fn_registrar_fallo_ejecucion(ejecucion, n8n_execution_id, error_nodo, error_mensaje)` | Registra un fallo de intento (sin doble conteo del mismo `n8n_execution_id`). Bajo `max_intentos` deja `PROCESANDO`; al alcanzarlo finaliza en `ERROR` y abandona reservas. | `intentos_fallidos`, `error_final`, `estado_actual` |
| `ops.fn_resolver_ejecucion_para_reproceso(ejecucion_id)` | **Lectura mínima** para el webhook. Une ejecución ↔ automatización `REMISIONES_CATERPILLAR` ↔ `core.documentos`. Devuelve `encontrada`, `estado`, `documento_origen_id`, `ruta_archivo`, `nombre_archivo`. Una ejecución de otra automatización, inexistente o sin documento origen es **indistinguible**: `encontrada = false`. | Ver nota abajo |

> **Nota — `SOURCE_DOCUMENT_MISSING`.** Como el `JOIN` con `core.documentos` es interno, una ejecución cuyo documento origen no exista devuelve `encontrada = false` (→ `NOT_FOUND`). En el código del Hub **no existe** el rechazo `SOURCE_DOCUMENT_MISSING`. Si un workflow lo devolviera, el Hub lo trataría como respuesta inválida (502). Ver [reprocessing](reprocessing.md#contrato).

## Estados y su significado

| Estado de ejecución | Significado | Reservas |
| --- | --- | --- |
| `PROCESANDO` | En curso o pendiente de reintento | `RESERVADA` (si ya reservó) |
| `COMPLETADA` | Terminó y pasó la verificación de integridad | `APLICADA` |
| `ERROR` | Agotó reintentos o falló definitivamente | `ABANDONADA` |
| `CANCELADA` | Cancelada | `ABANDONADA` |

Traducción en API/Web: `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`.

## Reglas clave (invariantes)

1. **Idempotencia en PostgreSQL**: repetir cualquier paso devuelve el mismo resultado (`ya_existia`, `ALREADY_*`) y no duplica folios.
2. **Propiedad serie↔automatización** sólo por `ops.automatizacion_series_proceso`.
3. **Ejecución original inmutable** ante un reproceso; la hija es otra fila.
4. **Máximo un hijo directo** por padre (índice único parcial + `ALREADY_REPROCESSED`).
5. **Folios nunca se reciclan** automáticamente: una reserva `ABANDONADA` sigue ocupando su rango.
6. **Lo que el Hub puede ver**: `SELECT` sobre rutas, reservas, detalle y documentos; `INSERT` (sólo) sobre `automation_trigger_requests`.

## Mapeo de campos hacia la API del Hub

| Columna | Campo en la API |
| --- | --- |
| `ejecucion_id` | `executionId` (string) |
| `estado` | `outcome` |
| `iniciada_en` / `finalizada_en` | `startedAt` / `finishedAt` |
| `intentos_fallidos` / `max_intentos` | `failedAttempts` / `maxAttempts` |
| `error_nodo` / `error_mensaje` | `latestErrorNode` / `latestErrorMessage` |
| `n8n_execution_id` | `n8nExecutionId` |
| `reproceso_de_id` | `reprocessOfExecutionId` |
| `documentos.*` | `sourceDocument` |
| `reservas_folios` | `reservations` |
| `remisiones` + `remision_detalle` | `remittances[].details` |

## Contrato desde n8n (verificado en el export, Fase D2)

Workflow PROD `Remisiones CAT Produccion PG` — credencial `Postgres produccion`; TEST `MANUAL TEST REMISIONES CAT` — credencial `cat_test`. D3 documentará PostgreSQL objeto por objeto; aquí sólo lo que el workflow usa.

| Nodo `postgres` | Función / consulta | Argumentos |
| --- | --- | --- |
| `Resolver documento origen PG` | `SELECT * FROM core.fn_crear_o_resolver_documento($1::bigint,$2::text,$3::text,$4::text,$5::text,$6::date,$7::text)` | empresa (**constante en el nodo**: distinta en TEST y PROD), `PROGRAMACION_ENTREGA`, nombre, ruta, `DROPBOX`, fecha, hash SHA-256 |
| `Crear o recuperar ejecución PG` | `ops.fn_crear_ejecucion_automatizacion($1::text,$2::bigint,$3::text,$4::text,$5::bigint)` | `REMISIONES_CATERPILLAR`, documento, id de ejecución n8n, `run_name`, `reproceso_de_id` o `null` |
| `Reservar folios PG` | `operacion.reservar_folios_para_ejecucion($1::bigint,$2::text,$3::integer)` | ejecución, serie, cantidad |
| `Registrar remisión PG` | `operacion.fn_registrar_remision_generada($1::bigint,$2::text,$3::bigint,$4::date,$5::text,$6::jsonb)` | ejecución, serie, folio, fecha, `pdf_path`, detalles |
| `Finalizar ejecución PG` | `ops.fn_finalizar_ejecucion_automatizacion($1::bigint,$2::text,$3::text,$4::text)` | ejecución, `COMPLETADA`, `null`, `null` |
| `Registrar fallo PG` | `ops.fn_registrar_fallo_ejecucion($1::bigint,$2::text,$3::text,$4::text)` | ejecución, id de ejecución n8n, nodo, mensaje |
| `Resolver ejecución original PG` | `ops.fn_resolver_ejecucion_para_reproceso($1::bigint)` | `executionId` |

| Concepto | Resultado |
| --- | --- |
| Tablas leídas directamente | **Ninguna** (todo por funciones) |
| Tablas escritas directamente | **Ninguna** |
| Consultas directas (`SELECT` sobre tablas) | Ninguna |
| Funciones llamadas | Las 7 de arriba |
| `ops.fn_resolver_ruta_automatizacion` | **No se usa**: el ruteo planta → serie está **hardcodeado** en `Preparar reserva folios PG` (el catálogo de rutas de PostgreSQL no es consultado por el workflow) |
| Base TEST / PROD | `daubert_hub_test` (credencial `cat_test`) / `daubert_global` (`Postgres produccion`); el JSON no contiene el nombre de la base, se infiere del nombre de la credencial |

> **Observación:** como el workflow no consulta `ops.automatizacion_series_proceso`, agregar/activar una ruta en PostgreSQL **no** basta para habilitar un proceso: hay que editar el workflow (detector, `PROCESOS_HABILITADOS_PROD`, mapeo de serie). Por el contrario, PostgreSQL sigue rechazando reservar de una serie `INACTIVA` o que no sea ruta activa de la automatización.

## Verificación contra PostgreSQL (Fase D3)

Contrastado el 2026-09-24 con el catálogo real de PROD (`daubert_global`) y TEST (`daubert_hub_test`), solo lectura (`daubert_docs_ro`). Detalle por objeto: [tablas](../../database/tables/README.md), [funciones](../../database/functions/README.md), [folios](../../database/folios.md), [n8n-contract](../../database/n8n-contract.md#caterpillar-prod-rol-n8n_app-base-daubert_global).

### Confirmado (D2/D1 coinciden con la base)

| Afirmación previa | Resultado en PostgreSQL |
| --- | --- |
| Las 7 funciones existen, son `SECURITY DEFINER` con `search_path` fijo y `EXECUTE` revocado a `PUBLIC` | **CONFIRMED** (además existe `ops.fn_resolver_ruta_automatizacion`, 8.ª función definer, **sin uso** en el workflow) |
| `EXECUTE` solo a `n8n_app` en PROD | **CONFIRMED** (`daubert_hub_app`: sin `EXECUTE` de negocio, como exige el postcheck 009) |
| Índice único parcial de reproceso (`uq_ejecuciones_automatizacion_reproceso_unico`) | **CONFIRMED** en PROD y TEST |
| Migración 009 aplicada | **CONFIRMED**: `md5` del cuerpo de `fn_crear_ejecucion_automatizacion` = `929939dc…` (el de la 009), índice y función nueva presentes |
| Estados de ejecución/reserva/remisión | **CONFIRMED** por `CHECK` (`PROCESANDO/COMPLETADA/ERROR/CANCELADA`; `RESERVADA/APLICADA/ABANDONADA`; `PENDIENTE/GENERADA/CANCELADA`) |
| El Hub solo puede `INSERT` en `ops.automation_trigger_requests` y `SELECT` en rutas, reservas, detalle, documentos | **CONFIRMED** |
| En TEST `n8n_cat_test` no tiene grants directos | **CONFIRMED**: 0 privilegios de tabla; `USAGE` de `core/operacion/ops` y `EXECUTE` de las 8 funciones definer; sin `reservar_folios` |
| El workflow no lee/escribe tablas directamente | **CONFIRMED** (el nombre `core.documentos` en los nodos Code aparece solo en comentarios) |

### Amplía o precisa lo anterior

1. **Elegibilidad de reproceso fuera de la base.** `fn_crear_ejecucion_automatizacion` no valida el padre (`p_reproceso_de_id`): no exige que esté en estado terminal, ni que sea de la misma automatización o documento. Solo la FK, `ck_ejecuciones_automatizacion_reproceso` (no apunta a sí mismo) y el índice único (un hijo por padre) protegen la cadena. La elegibilidad la aplican los nodos `Validar elegibilidad reproceso CAT` del workflow ([reprocessing](reprocessing.md)). Clasificación de seguridad: `REVIEW` ([security-definer](../../database/security-definer.md)).
2. **Resolución de ejecución acotada por código.** `fn_resolver_ejecucion_para_reproceso` tiene `REMISIONES_CATERPILLAR` fijo en el `JOIN`; Audi no puede usarla.
3. **Las funciones aceptan cualquier ejecución.** `fn_finalizar_ejecucion_automatizacion`/`fn_registrar_fallo_ejecucion` operan sobre cualquier `ejecucion_id`, no solo Caterpillar; con `n8n_app` compartido el aislamiento entre Audi y Caterpillar es **por convención**, no por privilegios ([n8n-app-audit](../../database/n8n-app-audit.md)).
4. **PROD corre con `n8n_app`; TEST con `n8n_cat_test`.** El contrato mínimo (solo funciones) está probado en TEST; en PROD el rol conserva 12 privilegios de tabla que Caterpillar no necesita. `PERMISSION_DRIFT` esperado ([test-prod-drift](../../database/test-prod-drift.md#permisos)).
5. **TEST y PROD tienen el mismo código de funciones**: seis de las siete funciones de Caterpillar (todas salvo `fn_registrar_fallo_ejecucion`) difieren de texto solo por **comentarios/CRLF** (sin drift funcional; ver [test-prod-drift](../../database/test-prod-drift.md#funciones)).
6. **Concurrencia (verificada en las definiciones):** `pg_advisory_xact_lock` por (ejecución, serie) en la reserva y por (serie, folio) en el registro; `FOR UPDATE` de la serie y de la ejecución ([folios](../../database/folios.md#concurrencia-y-bloqueos-verificado-en-las-definiciones)).
7. **FK `ON DELETE RESTRICT`** en todo el dominio (reservas, remisiones, detalle, rutas → ejecuciones/series/empresas): nada se puede borrar en cascada; los folios abandonados permanecen.
8. **`operacion.remisiones` con estado `CANCELADA`**: ningún camino conocido (función, Hub, workflow) lo asigna (UNKNOWN cómo se cancela hoy).
9. **Rutas y mapeos:** la tabla `ops.automatizacion_series_proceso` (9 rutas Caterpillar según D1) y el mapeo llave→serie son **datos**; no se pudieron leer con `daubert_docs_ro` (**UNKNOWN**). Estructura confirmada: `UNIQUE (automatizacion_id, llave_proceso)`, trigger de dueño único de serie, FK `RESTRICT`.

### No verificable con `daubert_docs_ro`

Ejecuciones/reservas/remisiones existentes, series y `siguiente_folio`, piso de folio, `automation_trigger_requests`, si hay ejecuciones `PROCESANDO`. Ver [troubleshooting](../../database/troubleshooting.md#ejecución-en-procesando) para los chequeos con un rol autorizado.
