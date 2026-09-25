# Audi — Arquitectura

Vista general: [00-overview/architecture](../../00-overview/architecture.md). Aquí lo específico de Audi, verificado contra los exports.

## Componentes

| Componente | Responsabilidad | No hace |
| --- | --- | --- |
| **n8n — `Remisiones AUDI PRODUCCION`** | Orquesta todo el ciclo: detectar Excel, validar en PostgreSQL, leer y normalizar, reservar folios, generar remisiones, registrar en PostgreSQL, hojas de identificación, cerrar ejecución, escribir log. | No usa funciones `SECURITY DEFINER` de ejecución/finalización (usa SQL directo); no registra fallos en PostgreSQL. |
| **Subworkflow `Generación PDFs`** | Clasifica plantilla (bolsas/tubos), renderiza HTML de cada remisión, lo guarda como temporal y lo convierte a PDF con un script PowerShell externo. | — |
| **Subworkflow `Generación Hojas Identificación`** | Renderiza una hoja por artículo (HTML) y las convierte a un PDF único. | — |
| **`Manejador de errores Audi Remisiones`** | Error Trigger → escribe un JSON en `04_ERRORES` (ruta fija de PROD). | No toca PostgreSQL; no notifica. |
| **PostgreSQL** | Fuente de verdad de ejecuciones, folios y remisiones. Credencial `Postgres produccion`. | — |
| **Dropbox** | Carpeta de cliente (`CLIENTES\AUDI\…`) = origen; `HERRAMIENTAS AUTOMATIZACION\REMISIONES AUDI` = copias, salidas, logs, plantillas, catálogo, scripts. | — |
| **Scripts PowerShell** | `convertir-audi-pdf.ps1`, `limpiar-temp-audi.ps1` (externos, no versionados). | — |
| **Hub** | Muestra historial y ajusta folios. | No dispara ni reprocesa Audi. |

## Relación con otros elementos

- `Generación PDFs` y `Generación Hojas Identificación` se invocan con **Execute Workflow**; los usa también el workflow de TEST (mismos IDs) ([dependencias](../n8n-dependencies.md)).
- El nodo `Guardar copia en entrada` copia el Excel a `01_ENTRADA` con PowerShell (`Copy-Item`): **no mueve ni borra** el original.
- Instancia n8n **compartida** con TEST y con las demás automatizaciones.

## Modelo de datos usado

Mismo esquema `ops`/`operacion` que Caterpillar pero con otro patrón de acceso: ver [database-contract](database-contract.md). La propiedad serie↔automatización de Audi se registra en `ops.automatizacion_series_proceso` (`llave_proceso = 'AUDI'`, migración `20260922_004`), **pero el workflow no la consulta**: fija `REMISIONES_AUDI` / `REMISION_AUDI`.

## Identificación del cliente

`Leer cliente Audi PG` busca en `core.empresas` con `to_jsonb(e)::text ILIKE '%AUDI%'` (`LIMIT 2`) y `Validar cliente Audi PG` exige **exactamente una** coincidencia. Es una búsqueda difusa: agregar otra empresa cuyo registro contenga "AUDI" hace **fallar** el workflow ("más de una empresa relacionada con Audi").
