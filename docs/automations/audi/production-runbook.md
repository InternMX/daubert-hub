# Audi — Runbook de PROD

Workflow: `Remisiones AUDI PRODUCCION` ([export](../../../n8n/workflows/remisiones-audi/prod/workflow.json)). Sin secretos. Instancia n8n **compartida con TEST**.

## Componentes

| Elemento | Valor |
| --- | --- |
| Base | `daubert_global` (credencial `Postgres produccion`) |
| Schedule | Cada 15 min (zona `America/Mexico_City`) |
| Origen | `C:\Users\<WINDOWS_USER>\Documents\Dropbox\CLIENTES\AUDI\<año>\…` |
| Base de trabajo | `C:\Users\<WINDOWS_USER>\Documents\Dropbox\HERRAMIENTAS AUTOMATIZACION\REMISIONES AUDI` |
| Subworkflows | `Generación PDFs`, `Generación Hojas Identificación` |
| Manejador de errores | `Manejador de errores Audi Remisiones` |

## Operación

| Tarea | Cómo |
| --- | --- |
| **Revisar salud** | n8n: workflow **Active** y ejecuciones cada 15 min. Hub → Remisiones Audi: última ejecución reciente; sin ejecuciones `PROCESANDO` antiguas. Carpeta `04_ERRORES`: revisar archivos `ERROR_*.json` recientes. |
| **Identificar la ejecución** | Hub (historial) o `ops.ejecuciones_automatizacion` (sólo lectura): `n8n_execution_id`, `run_name` (`<archivo>_<timestamp>`), `estado`. En `03_LOGS`: `log_<run_name>.csv`. |
| **Verificar el input** | Que el Excel esté bajo `CLIENTES\AUDI\<año actual ±1>\…información adicional…`, nombre con "programacion de entrega" y "audi", extensión `.xlsx`, antigüedad de entre 2 min y 60 días y **fuera** de subcarpetas *remisiones/facturas/recibida*. |
| **Verificar el output** | PDFs en `02_SALIDAS\REMISIONES` (uno por folio) y `02_SALIDAS\HOJAS_IDENTIFICACION` (uno por archivo); filas `GENERADA` en `operacion.remisiones` con los folios reservados. |
| **Revisar PostgreSQL** | Sólo lectura; ver casos en [troubleshooting](troubleshooting.md). |
| **Reprocesar** | **No existe reproceso** ni desde el Hub ni por webhook. Un archivo `PROCESANDO` o `COMPLETADA` no vuelve a procesarse solo. Resolver una ejecución atascada exige intervención controlada ([troubleshooting #5](troubleshooting.md#5-una-ejecución-queda-procesando)) — **procedimiento formal PENDIENTE**. |
| **Detener de forma segura** | Desactivar el workflow entre ciclos. Un ciclo interrumpido deja la ejecución `PROCESANDO` (y folios consumidos si ya reservó). |
| **Reactivar** | Activar; confirmar el siguiente ciclo y revisar `PROCESANDO` huérfanas. |
| **Rollback de workflow** | Sin rollback verificado: el único otro export (`Instalacion\Remisiones AUDI PRODUCCION.json`) es la versión anterior con **contadores JSON** (mismo `id`); no usarla: los folios los controla PostgreSQL. Confirmar en n8n el historial de versiones antes de revertir. |
| **Comprobar un solo PROD activo** | En n8n, sólo `Remisiones AUDI PRODUCCION` activo; `Remisiones AUDI PRUEBAS` inactivo (los exports lo muestran inactivo). |

## Riesgos operativos (de los nodos)

- **Ejecución atascada:** el manejador de errores sólo escribe un log; no actualiza PostgreSQL. Tras un fallo posterior a `Crear ejecución PG`, el archivo queda excluido de la detección.
- **Folios consumidos sin remisión** si el fallo ocurre después de `Reservar folios PostgreSQL`.
- **Límite de 6 artículos** por archivo (filas 8–13 del Excel).
- **Acumulación de candidatos:** se revisan sólo los 20 archivos **más antiguos** de los últimos 60 días; si hubiera más de 20 ya completados por delante, un archivo nuevo podría no llegar a evaluarse (verificar con el volumen real).
- **Archivos sobrescritos** en la misma ruta se consideran el mismo documento (no se reprocesan).
- **Cliente por búsqueda difusa** (`ILIKE '%AUDI%'`): una empresa nueva con "AUDI" en cualquier campo rompe el flujo.
- Los scripts PowerShell se ejecutan con `-ExecutionPolicy Bypass` desde una carpeta sincronizada por Dropbox.
- El manejador de TEST escribe en la carpeta de **PROD** (log de errores contaminado).

## Relación con el Hub

Historial y ajuste de folio (`ADMIN`) de `REMISION_AUDI`; el catálogo del Hub indica **10 min** de polling, pero el workflow corre cada **15 min** ([inconsistencia](../../00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración)).
