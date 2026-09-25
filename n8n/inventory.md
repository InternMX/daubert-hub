# Inventario de workflows n8n

Fuente: exploración recursiva de Dropbox el 2026-09-24. Sólo lectura; nada se modificó.

## Resumen del descubrimiento

| Raíz | Entorno inferido | Archivos `.json` | Exports n8n válidos | No son workflows |
| --- | --- | --- | --- | --- |
| `C:\Users\06\Documents\Dropbox\HERRAMIENTAS AUTOMATIZACION\` | PROD | 154 | 8 | 146 |
| `C:\Users\06\Documents\Dropbox\PRUEBAS\` | TEST | 27 | 4 | 23 |
| **Total** | | **181** | **12** | **169** |

Criterio de export válido: JSON que parsea, con `nodes` (array) y `connections` (objeto), además de `name`/`settings`/`versionId`/`id` cuando existen. Ningún JSON dejó de parsear.

Los 169 JSON descartados **no** son workflows: contadores de folios y estado (`contador_*`, `archivos_procesados_*`, incluidos los de `ESTADO (EN DESUSO)`/`LEGACY (DESUSO)`), logs de ejecución (`03_LOGS`) y registros de error (`04_ERRORES`; 131 sólo en Caterpillar) y archivos auxiliares. Ninguno se copió ni se inspeccionó más allá de su clasificación por estructura y carpeta.

Otros artefactos referenciados por los workflows y **no versionados**: scripts PowerShell (`convertir-*-pdf.ps1`, `limpiar-temp-*.ps1`, `detectar-archivos-cat.ps1`, `eliminar-html-temporal.ps1`), plantillas HTML, catálogos Excel, un `.sql` de migración de estado de Audi a PostgreSQL y `instalacion n8n.txt` (no revisado: podría contener datos de instalación). Ver [n8n-dependencies](../docs/automations/n8n-dependencies.md).

## Inventario

Leyenda: **Nodos** = total de nodos (incluye notas adhesivas); **Con. ** = nodos de origen con conexiones salientes. Fechas = modificación del archivo (UTC). "Act." = campo `active` al exportar.

| # | Automatización | Workflow (nombre) | Entorno | Clasificación | Act. | Nodos | Con. | Trigger(s) | Schedule | Webhook | PostgreSQL (credencial) | Otras credenciales | Error Workflow | Versionado | Archivo fuente | Modif. | Observaciones |
| --- | --- | --- | --- | --- | :-: | :-: | :-: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Caterpillar | Remisiones CAT Produccion PG | PROD | **PROD actual** | sí | 58 | 49 | Schedule, manual, Webhook | 10 min | `POST cat-reprocess` (Header Auth) | Postgres produccion | Daubert Hub - n8n PROD | — (ninguno) | `remisiones-caterpillar/prod/workflow.json` | `HERRAMIENTAS AUTOMATIZACION\REMISIONES CAT\Remisiones CAT Produccion PG.json` | 2026-09-24 21:44 | Incluye rama de reproceso |
| 2 | Caterpillar | MANUAL TEST REMISIONES CAT | TEST | **TEST actual** | no | 60 | 50 | Schedule, manual, Webhook | 10 min | `POST cat-test-reprocess` | cat_test | Daubert Hub - n8n TEST | — | `remisiones-caterpillar/test/workflow.json` | `PRUEBAS\REMISIONES CAT\MANUAL TEST REMISIONES CAT.json` | 2026-09-24 21:46 | Nodo suelto "Execute a SQL query" (diagnóstico) |
| 3 | Caterpillar | Remisiones CAT Produccion PG CANDIDATE | TEST (carpeta `PROMOCION_PROD`) | **Rollback/histórico (posible)** — requiere revisión manual | no | 41 | 38 | Schedule, manual | 10 min | — | Postgres produccion | — | — | `remisiones-caterpillar/historical/pg-pre-reprocess-candidate.json` | `PRUEBAS\REMISIONES CAT\PROMOCION_PROD\Remisiones CAT Produccion PG CANDIDATE.json` | 2026-09-21 23:01 | PG **sin** rama de reproceso; sin `id` (nunca se guardó como workflow); usa credencial PROD |
| 4 | Caterpillar | Remisiones CAT Produccion | PROD (`Instalacion\`) | **Rollback/histórico** (contadores JSON, pre-PostgreSQL) | sí | 37 | 32 | Schedule, manual | 10 min | — | (ninguna) | — | — | No (superado; mismo `id` que #1) | `HERRAMIENTAS AUTOMATIZACION\REMISIONES CAT\Instalacion\Remisiones CAT Produccion.json` | 2026-09-10 21:37 | Mismo `id` que #1: es una **versión anterior** del mismo workflow, no un segundo workflow |
| 5 | Audi | Remisiones AUDI PRODUCCION | PROD | **PROD actual** | sí | 39 | 37 | Schedule, manual | 15 min | — | Postgres produccion | — | Manejador de errores Audi Remisiones | `remisiones-audi/prod/workflow.json` | `HERRAMIENTAS AUTOMATIZACION\REMISIONES AUDI\Remisiones AUDI PRODUCCION.json` | 2026-09-24 21:44 | Nodo suelto "Execute a SQL query"; llama a 2 subworkflows |
| 6 | Audi | Remisiones AUDI PRUEBAS | TEST | **TEST actual** (detrás de PROD) | no | 44 | 39 | Schedule, manual | 15 min | — | Postgres pruebas | — | Manejador de errores Audi Remisiones (**el de PROD**) | `remisiones-audi/test/workflow.json` | `PRUEBAS\REMISIONES AUDI\Remisiones AUDI PRUEBAS.json` | 2026-09-24 21:46 | 5 nodos deshabilitados del contador JSON |
| 7 | Audi | Remisiones AUDI PRODUCCION | PROD (`Instalacion\`) | **Rollback/histórico** (contadores JSON) | sí | 25 | 22 | Schedule, manual | 15 min | — | (ninguna) | — | Manejador de errores Audi Remisiones | No (superado; mismo `id` que #5) | `…\REMISIONES AUDI\Instalacion\Remisiones AUDI PRODUCCION.json` | 2026-07-23 16:41 | Versión anterior del mismo workflow |
| 8 | Audi | Generación PDFs | PROD | **Subworkflow** (compartido TEST/PROD) | sí | 9 | 7 | Execute Workflow Trigger | — | — | — | — | — | `remisiones-audi/shared/generacion-pdfs.json` | `…\REMISIONES AUDI\Instalacion\Generación PDFs.json` | 2026-07-23 16:50 | Llamado por #5 y #6 |
| 9 | Audi | Generación Hojas Identificación | PROD | **Subworkflow** (compartido) | sí | 6 | 5 | Execute Workflow Trigger | — | — | — | — | — | `remisiones-audi/shared/generacion-hojas-identificacion.json` | `…\Instalacion\Generación Hojas Identificación.json` | 2026-07-23 16:50 | Llamado por #5 y #6 |
| 10 | Audi | Manejador de errores Audi Remisiones | PROD | **Error handler** (compartido) | sí | 3 | 2 | Error Trigger | — | — | — | — | — | `remisiones-audi/shared/manejador-errores.json` | `…\Instalacion\Manejador de errores Audi Remisiones.json` | 2026-07-23 16:50 | Sólo escribe un log JSON en `04_ERRORES` **de PROD** |
| 11 | Notificaciones de pago | Produccion Notificacion de pagos a Proveedores | PROD | **PROD actual** | sí | 100 | 91 | Schedule, manual, Webhook | intervalo sin valor explícito (default de n8n) | `POST daubert-hub/notificaciones-pago/reprocesar` (Header Auth, responde 202) | Postgres produccion | Outlook LOGIN OAUT2; Daubert Hub - n8n PROD | **Ausente** (id referenciado sin export) | **No** (DO_NOT_VERSION, ver [security-notes](security-notes.md)) | `HERRAMIENTAS AUTOMATIZACION\NOTIFICACIONES DE PAGO\Produccion Notificacion de pagos a Proveedores.json` | 2026-09-24 21:44 | Etiquetado "Prueba" en n8n; nodo suelto "BASELINE CORREOS" |
| 12 | Notificaciones de pago | Test Notificacion de pagos a Proveedores | TEST | **TEST actual** | no | 100 | 91 | Schedule, manual, Webhook | ídem | **mismo `path`** que PROD | Postgres pruebas | Outlook LOGIN OAUT2 (la misma); Daubert Hub - n8n TEST | — (ninguno) | **No** (DO_NOT_VERSION) | `PRUEBAS\NOTIFICACIONES DE PAGO\Test Notificacion de pagos a Proveedores.json` | 2026-09-24 21:46 | PROD tiene lógica que TEST no tiene (ver drift) |

Rutas: anteponer `C:\Users\06\Documents\Dropbox\` a las rutas de la columna "Archivo fuente"; `…` equivale a `HERRAMIENTAS AUTOMATIZACION`.

## Automatizaciones detectadas

Sólo tres: **Remisiones Caterpillar**, **Remisiones Audi** y **Notificaciones de pago**. No se encontraron otros workflows n8n de Daubert bajo las dos raíces.

## Candidatos múltiples por automatización (no se eligió arbitrariamente)

| Automatización | Candidatos | Lectura |
| --- | --- | --- |
| Caterpillar | #1 (PG con reproceso, `id` 9Ngn…) · #4 (JSON, mismo `id`) · #3 (PG sin reproceso, sin `id`) | #1 es el vigente (activo, Sep-24, incluye webhook). #4 es una versión histórica del mismo workflow (mismo `id` ⇒ no pueden coexistir como dos workflows en la instancia). #3 es el candidato de promoción sin reproceso: **posible rollback**, y coincide con la descripción "workflow previo a 12C, inactivo, como rollback" de la nota 12C, pero **no se puede afirmar**: requiere revisión manual en n8n. |
| Audi | #5 (vigente) · #7 (versión anterior, mismo `id`) | #7 es histórico. |
| Notificaciones | #11 (PROD) · #12 (TEST) | Sin candidatos extra. |

## Dependencias entre workflows

Ver [n8n-dependencies](../docs/automations/n8n-dependencies.md): Audi PROD/TEST → 2 subworkflows + manejador de errores (presentes); Notificaciones PROD → manejador de errores **ausente**; Caterpillar → ninguno.
