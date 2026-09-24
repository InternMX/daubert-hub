# Remisiones Audi — exports

| Archivo | Workflow n8n | Entorno | Clasificación | Activo al exportar |
| --- | --- | --- | --- | :-: |
| [`prod/workflow.json`](prod/workflow.json) | `Remisiones AUDI PRODUCCION` | PROD | PROD actual | sí |
| [`test/workflow.json`](test/workflow.json) | `Remisiones AUDI PRUEBAS` | TEST | TEST actual (detrás de PROD) | no |
| [`shared/generacion-pdfs.json`](shared/generacion-pdfs.json) | `Generación PDFs` | PROD (compartido) | Subworkflow | sí |
| [`shared/generacion-hojas-identificacion.json`](shared/generacion-hojas-identificacion.json) | `Generación Hojas Identificación` | PROD (compartido) | Subworkflow | sí |
| [`shared/manejador-errores.json`](shared/manejador-errores.json) | `Manejador de errores Audi Remisiones` | PROD (compartido) | Error handler | sí |

`shared/` existe porque los dos subworkflows y el manejador de errores **sólo se exportaron una vez (carpeta de PROD)** y **el workflow de TEST los referencia con los mismos IDs**: son compartidos entre entornos ([n8n-dependencies](../../../docs/automations/n8n-dependencies.md)).

No se versionó la versión anterior con contadores JSON (mismo `id` que el PROD actual). Sanitización: [security-notes](../../security-notes.md#campos-sanitizados-copias-versionadas). Documentación: [docs/automations/audi/](../../../docs/automations/audi/README.md).
