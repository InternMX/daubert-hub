# Caterpillar — Referencia de nodos

Workflow PROD: `Remisiones CAT Produccion PG` (58 nodos; [export](../../../n8n/workflows/remisiones-caterpillar/prod/workflow.json)). Los nombres son **exactos** (incluidas tildes y sufijos como `CAT1`). No se copia JavaScript: los nodos *Code* se resumen. Los nodos triviales se agrupan. Flujo general: [workflow.md](workflow.md). Credencial PostgreSQL de todos los nodos `postgres`: `Postgres produccion`.

## 1. Disparadores

| Nodo | Tipo | Propósito | Salida → |
| --- | --- | --- | --- |
| `Schedule Trigger` | scheduleTrigger | Cada 10 minutos | `Detectar archivos CAT1` |
| `When clicking ‘Execute workflow’` | manualTrigger | Ejecución manual del flujo normal | `Detectar archivos CAT1` |
| `Webhook Reproceso CAT (PROD)` | webhook | `POST /webhook/cat-reprocess`, autenticación Header Auth (credencial `Daubert Hub - n8n PROD`), respuesta por nodo | `Normalizar y validar entrada reproceso CAT` |

## 2. Detección y filtrado (flujo normal)

| Nodo | Tipo | Propósito / notas | Salida → |
| --- | --- | --- | --- |
| `Detectar archivos CAT1` | code | Escanea las `RUTAS_REALES` de Dropbox (`…\CLIENTES\<planta>\…\SOLICITUD DE MATERIAL[\<año>]`), filtra Excel/patrón, clasifica por modo (FIJO/FINSA/P3P6/TORREON/LEGACY), aplica `PROCESOS_HABILITADOS_PROD` y emite ítems `ARCHIVO_DETECTADO` con rutas de trabajo. Flags: `ACTIVAR_APARTADO_PRUEBAS=false`, `ACTIVAR_RUTAS_REALES=true`. | `Filtrar archivos nuevos` |
| `Filtrar archivos nuevos` | code | Valida candidato; descarta archivos anteriores a `2026-09-22`; ordena de más antiguo a más nuevo. No consulta contadores JSON. | `Loop Over Items` |
| `Loop Over Items` | splitInBatches | Procesa un archivo a la vez. Punto de **convergencia** de las ramas normal y reproceso. La salida "loop" (#1) alimenta `Preparar archivo CAT`. | `Preparar archivo CAT` |

## 3. Preparación y control PostgreSQL

| Nodo | Tipo | Propósito / notas | Salida → |
| --- | --- | --- | --- |
| `Preparar archivo CAT` | code | Calcula SHA-256 del archivo, `run_name`, y rutas: copia en `01_ENTRADA`, salidas, logs, errores, plantillas, scripts, catálogo. Falla si el archivo no existe. | `Resolver documento origen PG` |
| `Resolver documento origen PG` | postgres | `core.fn_crear_o_resolver_documento($1..$7)` con empresa fija, `PROGRAMACION_ENTREGA`, `DROPBOX`, fecha, hash. | `Propagar documento origen PG` |
| `Propagar documento origen PG` | code | Exige `documento_id`; propaga contexto. | `Crear o recuperar ejecución PG` |
| `Crear o recuperar ejecución PG` | postgres | `ops.fn_crear_ejecucion_automatizacion('REMISIONES_CATERPILLAR', doc, execution.id, run_name, reproceso_de_id)`. | `Propagar ejecución PG` |
| `Propagar ejecución PG` | code | Valida el `motivo`; calcula `procesar_segun_pg` (procesables: `CREATED`, `REPROCESS_CREATED`, `ALREADY_PROCESSING`). Motivo desconocido ⇒ error. | `¿Es reproceso?` |
| `¿Es reproceso?` | if | `mode == "REPROCESS"` | sí → `Mapear resultado creación reproceso CAT`; no → `¿Procesar según PG?` |
| `¿Procesar según PG?` | if | Continúa el pipeline sólo si `procesar_segun_pg` | sí → `Leer catálogo Caterpillar`; no → `Loop Over Items` |

## 4. Catálogo y lectura del Excel

| Nodo(s) | Tipo | Propósito |
| --- | --- | --- |
| `Leer catálogo Caterpillar` → `Extraer productos catálogo` → `Preparar productos catálogo CAT` | readWriteFile / extractFromFile (hoja `Productos_por_Planta`) / code | Carga el catálogo de productos por planta (`Catalogo_Caterpillar.xlsx` en `05_ARCHIVOS AUXILIARES\CATALOGO`). |
| `Leer catálogo Caterpillar clientes` → `Extract from File` → `Preparar catálogo CAT` | ídem (hoja `Clientes_Plantas`) | Carga clientes/plantas del catálogo. |
| `Leer archivo detectado` → `Guardar copia en entrada` → `Leer copia en entrada` | readWriteFile | Lee el Excel original, guarda una copia en `01_ENTRADA` y trabaja sobre la copia. |
| `Extraccion de informacion de excel` | extractFromFile (xlsx, sin encabezado) | Extrae todas las filas como arreglo. |

## 5. Normalización, folios y PDF

| Nodo | Tipo | Propósito / notas | Salida → |
| --- | --- | --- | --- |
| `Normalizar datos CAT` | code | Interpreta el Excel (fecha en F4, datos desde la fila 8; columnas de código, descripción, cantidades BH/RP, OC), cruza catálogo (**estricto**), arma una remisión por artículo (Torreón: una por OC, con IVA 16 % en cálculos). Error ⇒ salida de error. | ok → `Preparar reserva folios PG`; error → `Preparar error CAT` |
| `Preparar reserva folios PG` | code | Determina `serie_codigo` desde planta/subplanta; `cantidad` = nº de remisiones. Planta/subplanta no configurada ⇒ error. | `Reservar folios PG` |
| `Reservar folios PG` | postgres | `operacion.reservar_folios_para_ejecucion(ejecucion, serie, cantidad)`. | `Asignar folios PG CAT` |
| `Asignar folios PG CAT` | code | Verifica que la reserva coincida con la cantidad y con el rango; asigna folio consecutivo y nombres `REM nnnn <parte>.pdf/.html`. | `Renderizar HTML` |
| `Renderizar HTML` | code | Llena la plantilla `REM-Plantilla-CAT.html` (o `…-TORREON.html`). Falla si no existe la plantilla. | `Guardar HTML temporal` |
| `Guardar HTML temporal` | readWriteFile (write) | Escribe cada HTML en `06_ARCHIVOS TEMPORALES\html`. | `Preparar conversión PDF CAT` |
| `Preparar conversión PDF CAT` | code | Valida que existan ejecución, reserva, serie y scripts; arma el lote. | `Convertir PDF CAT` |
| `Convertir PDF CAT` | executeCommand | Ejecuta `powershell -File convertir-cat-pdf.ps1 -TempDir … -OutDir …` (script **externo**, no versionado). Salida de error habilitada. | ok → `Preparar registro remisiones PG`; error → `Preparar error CAT` |
| `Preparar registro remisiones PG` | code | Exige `exitCode = 0`; convierte fecha `dd/mm/aaaa` a SQL; arma `pdf_path` y un detalle por remisión. | `Registrar remisión PG` |
| `Registrar remisión PG` | postgres | `operacion.fn_registrar_remision_generada(ejecución, serie, folio, fecha, pdf_path, detalles jsonb)`. | `Eliminar HTML temporal CAT` |
| `Eliminar HTML temporal CAT` | executeCommand | `limpiar-temp-cat.ps1 -TempDir …` | `Preparar finalización PG` |
| `Preparar finalización PG` | code | Exige tantos registros como remisiones esperadas y `remision_id` en todos. | `Finalizar ejecución PG` |
| `Finalizar ejecución PG` | postgres | `ops.fn_finalizar_ejecucion_automatizacion(ejecución, 'COMPLETADA', null, null)`. | `Loop Over Items` |

## 6. Manejo de errores

| Nodo | Tipo | Propósito | Salida → |
| --- | --- | --- | --- |
| `Preparar error CAT` | code | Reúne contexto, `n8n_execution_id`, nodo y mensaje de error (por defecto `Convertir PDF CAT` o `Normalizar datos CAT`). | `Registrar fallo PG` |
| `Registrar fallo PG` | postgres | `ops.fn_registrar_fallo_ejecucion(ejecución, n8n_execution_id, nodo, mensaje)`. Devuelve intentos y si el error es final. | `Registrar log error CAT` |
| `Registrar log error CAT` | code | Escribe evidencia (JSON y TXT) en `04_ERRORES`; no toca contadores JSON. | `Limpiar HTML temporal por error CAT` |
| `Limpiar HTML temporal por error CAT` | code | Borra sólo los HTML temporales del lote actual. | `Loop Over Items` |

## 7. Rama de reproceso

| Nodo | Tipo | Propósito / respuesta |
| --- | --- | --- |
| `Normalizar y validar entrada reproceso CAT` | code | Único punto que lee el body. Devuelve `entrada_valida` y `entrada_motivo` (`INVALID_EXECUTION_ID` / `INVALID_REASON` / `OK`). |
| `¿Entrada reproceso válida?` | if | No → `Responder entrada inválida` |
| `Responder entrada inválida` | respondToWebhook | HTTP **400** `{ accepted:false, error }` |
| `Resolver ejecución original PG` | postgres | `ops.fn_resolver_ejecucion_para_reproceso($1)`. Salida de error habilitada. |
| `Responder reproceso error interno` | respondToWebhook | HTTP **500** `{ accepted:false, error:'INTERNAL_ERROR' }` |
| `Validar elegibilidad reproceso CAT` | code | Aplica estado ∈ {`ERROR`,`CANCELADA`}, ruta real, clasificación productiva, `PROCESOS_HABILITADOS_PROD` (**copia** del detector) y existencia del archivo. Devuelve `reproceso_elegible` / `reproceso_motivo_rechazo` / `reproceso_scope`. |
| `¿Reproceso elegible?` | if | No → `Responder reproceso rechazado` |
| `Responder reproceso rechazado` | respondToWebhook | HTTP **409** `{ accepted:false, error: <motivo> }` |
| `Detectar archivo REPROCESS CAT1` | code | Construye el ítem `ARCHIVO_DETECTADO` con `mode:"REPROCESS"`, `reproceso_de_id`, `reproceso_reason` (copia de funciones auxiliares del detector). Salida de error habilitada. |
| `Responder reproceso error de archivo` | respondToWebhook | HTTP **422** `{ error:'SOURCE_FILE_UNCLASSIFIABLE_OR_MISSING' }` |
| `Mapear resultado creación reproceso CAT` | code | Mapea el motivo real de PostgreSQL (`CREATED`/`REPROCESS_CREATED`/`ALREADY_PROCESSING`/`ALREADY_REPROCESSED`); otro ⇒ inválido (falla cerrado). |
| `¿Estado de reproceso reconocido?` | if | Sí → `Responder reproceso aceptado`; no → `Responder reproceso estado inesperado` |
| `Responder reproceso aceptado` | respondToWebhook | HTTP **202** `{ accepted:true, originalExecutionId, executionId, status }` y **continúa** hacia `¿Procesar según PG?` |
| `Responder reproceso estado inesperado` | respondToWebhook | HTTP **500** `UNEXPECTED_EXECUTION_STATE` |

## 8. Notas adhesivas (no ejecutan)

`Sticky Note` ("Inactivos: P3, P4, Nuevo Laredo, Torreón"), `Sticky Note1` ("Posibles mejoras", vacía), `Sticky Note3` (descripción del workflow), `Sticky Note Reprocess` (resumen de la rama de reproceso y aviso de mantener sincronizadas las copias de `PROCESOS_HABILITADOS_PROD`/`RUTAS_REALES`).

## Dependencias externas de los nodos

| Recurso | Ubicación (PROD) | Usado por |
| --- | --- | --- |
| Base de trabajo | `C:\Users\<WINDOWS_USER>\Documents\Dropbox\HERRAMIENTAS AUTOMATIZACION\REMISIONES CAT` | Todos los nodos de archivos |
| Scripts PowerShell | `…\05_ARCHIVOS AUXILIARES\SCRIPTS\convertir-cat-pdf.ps1`, `limpiar-temp-cat.ps1` | `Convertir PDF CAT`, `Eliminar HTML temporal CAT` |
| Catálogo | `…\05_ARCHIVOS AUXILIARES\CATALOGO\Catalogo_Caterpillar.xlsx` | Catálogo |
| Plantillas | `…\05_ARCHIVOS AUXILIARES\TEMPLATES\REM-Plantilla-CAT(.html / -TORREON.html)` | `Renderizar HTML` |

Detalle de rutas: [n8n-paths](../n8n-paths.md#caterpillar).
