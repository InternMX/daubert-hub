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
