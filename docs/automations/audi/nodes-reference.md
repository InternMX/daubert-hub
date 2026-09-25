# Audi — Referencia de nodos

Workflow PROD `Remisiones AUDI PRODUCCION` (39 nodos) y subworkflows. Nombres **exactos**. Sin copiar JavaScript. Credencial PostgreSQL de los nodos `postgres`: `Postgres produccion` (TEST: `Postgres pruebas`). Flujo: [workflow.md](workflow.md).

## Disparadores y validación de configuración

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Schedule Trigger` | scheduleTrigger | Cada 15 minutos |
| `When clicking ‘Execute workflow’` | manualTrigger | Ejecución manual |
| `Leer automatización Audi` | postgres | `SELECT` de `ops.automatizaciones` (`REMISIONES_AUDI`) × `operacion.series_documentales` (`REMISION_AUDI`): ids, estatus, `siguiente_folio` |
| `Validar configuración PostgreSQL` | code | Falla si la automatización o la serie no son las esperadas, no están `ACTIVA`, o el folio es inválido |

## Detección y selección

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Buscar programaciones Audi` | code | Recorre `CLIENTES\AUDI\<año>` (años actual ±1), carpetas de "información adicional", recursivo (excluye *remisiones*/*facturas*/*recibida*), filtra Excel de programación de entrega de Audi, antigüedad 2 min–60 días, ordena ascendente y devuelve hasta 20 candidatos |
| `Preparar validación candidato PG` | code | Arma un `SELECT` (SQL con texto interpolado) que, por candidato, busca su documento por ruta y calcula `ya_completado_pg` / `ya_procesando_pg` |
| `Validar candidato PG` | postgres | Ejecuta ese SQL |
| `Elegir archivo pendiente PG` | code | Filtra los no completados ni en proceso y devuelve el primero |
| `Preparar archivo trigger` | code | Define **todas** las rutas de trabajo (entrada, salidas, logs, errores, plantillas, scripts, estado, catálogo, temporales), `run_name`, nombre de la copia; incluye `counterPath` legado |
| `Ignorar archivos temporales` | code | Descarta temporales/rutas inválidas |

## Cliente, documento e idempotencia

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Leer cliente Audi PG` | postgres | `core.empresas` con `to_jsonb(e)::text ILIKE '%AUDI%' LIMIT 2` |
| `Validar cliente Audi PG` | code | Exactamente 1 empresa; si no, error |
| `Preparar documento origen PG` | code | Genera SQL: reutiliza `core.documentos` por empresa+ruta (minúsculas) o inserta (`PROGRAMACION_ENTREGA`, origen `DROPBOX`). Sin hash |
| `Registrar documento origen PG` | postgres | Ejecuta ese SQL |
| `Propagar documento PG` | code | Exige `documento_id` |
| `Validar idempotencia PG` | postgres | ¿Existe ejecución `COMPLETADA` para (automatización, documento)? |
| `Control idempotencia PG` | code | Si ya completado, **no emite ítems** (termina) |
| `Crear ejecución PG` | postgres | `INSERT INTO ops.ejecuciones_automatizacion` (`PROCESANDO`, `n8n_execution_id`, `run_name`) |
| `Propagar ejecución PG` | code | Exige `ejecucion_id` |

## Lectura y normalización

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Leer archivo disparador` → `Guardar copia en entrada` → `Leer copia en entrada` | readWriteFile / executeCommand | Lee el Excel, lo copia con `Copy-Item` a `01_ENTRADA` y trabaja con la copia |
| `Extraccion de informacion de excel` | extractFromFile (xlsx, sin encabezado) | Filas crudas |
| `Leer catálogo productos` → `Extracción catalogo productos` → `Preparar catalogo productos` | readWriteFile / extractFromFile (`Catalogo_Productos`) / code | Catálogo de productos Audi (formato tubos/bolsas, empaque) |
| `Normalizar datos` | code (≈15k caracteres) | Extrae fecha, artículos (filas 8-13), cantidades y presentaciones, cruza catálogo; error si no hay artículos válidos |
| `Preparar conteo remisiones PG` | code | Cantidad de folios a reservar |

## Folios, PDF y registro

| Nodo | Tipo | Propósito |
| --- | --- | --- |
| `Reservar folios PostgreSQL` | postgres | `SELECT * FROM operacion.reservar_folios('REMISION_AUDI', n)` |
| `Asignar no.Rem PG` | code | Valida rango/cantidad y asigna folios (4 dígitos) y nombres de salida |
| `Call Generación PDFs` | executeWorkflow | Invoca el subworkflow `Generación PDFs` |
| `Preparar remisiones generadas PG` | code | Genera el SQL de registro (CTE) con nombres de PDF |
| `Registrar remisiones generadas PG` | postgres | Inserta `operacion.remisiones` (`GENERADA`) y `operacion.remision_detalle` si no existen |
| `Recuperar datos para HI` | code | Reutiliza los ítems de `Asignar no.Rem PG` |
| `Generación Hojas Identificación` | executeWorkflow | Invoca el subworkflow de hojas |
| `Cerrar ejecución COMPLETADA PG` | postgres | `UPDATE … SET estado='COMPLETADA' … WHERE … AND estado='PROCESANDO'` |
| `Preparar log ejecución` → `Guardar log ejecución` | code / readWriteFile | Escribe `03_LOGS\log_<run_name>.csv` |

## Subworkflow `Generación PDFs` (9 nodos)

`Start` (Execute Workflow Trigger) → `Clasificar template` (bolsas/tubos) → `Lectura de templates` → `Renderizar HTML` → `Preparar rutas PDF` → `Guardado temporal HTML` → `Convertir PDF` (PowerShell) → `Eliminar html temporal` (PowerShell). Nota adhesiva "Clasificar template".

## Subworkflow `Generación Hojas Identificación` (6 nodos)

`Start` → `Leer template HI` → `Renderizar HTML HI` → `Guardado temporal HTML HI` → `Convertir PDF HI` (PowerShell) → `Eliminar html temporal`.

## Manejador `Manejador de errores Audi Remisiones` (3 nodos)

`Error Trigger` → `Preparar log error` → `Guardar log error`.

## Nodos sueltos / notas

- `Execute a SQL query` (postgres): `SELECT current_database(), current_user`. **Sin conexiones** (diagnóstico manual).
- En TEST: 5 nodos deshabilitados del contador JSON y notas ("LEGACY NODES", "Pendiente", "Posibles mejoras") — ver [drift](../n8n-test-prod-drift.md#audi).
