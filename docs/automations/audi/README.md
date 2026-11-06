# Remisiones Audi

Documentado en la Fase D2 **a partir de los exports reales** ([PROD](../../../n8n/workflows/remisiones-audi/prod/workflow.json), [TEST](../../../n8n/workflows/remisiones-audi/test/workflow.json), [subworkflows y manejador de errores](../../../n8n/workflows/remisiones-audi/shared/)). Lo histórico no se asume vigente: **manda el export actual**.

| | |
| --- | --- |
| Código de automatización | `REMISIONES_AUDI` |
| Serie documental | `REMISION_AUDI` |
| Cliente | Audi (`core.empresas`, localizado en tiempo de ejecución por búsqueda de texto) |
| Workflow PROD | `Remisiones AUDI PRODUCCION` — activo, **cada 15 minutos** |
| Workflow TEST | `Remisiones AUDI PRUEBAS` — inactivo al exportar; **detrás de PROD** |
| Subworkflows | `Generación PDFs`, `Generación Hojas Identificación` (compartidos TEST/PROD) |
| Error Workflow | `Manejador de errores Audi Remisiones` (compartido; sólo escribe un log JSON) |
| Credencial PostgreSQL | `Postgres produccion` (PROD) / `Postgres pruebas` (TEST) |
| Hub | Historial (`GET /api/automations/remissions/audi/executions`), ajuste de folio (`ADMIN`), acuses de revisión, actividad reciente |
| Reproceso manual desde el Hub | **No existe** (no hay webhook en el workflow) |
| Limitaciones confirmadas (2026-10-28) | Máximo 6 artículos por archivo (filas 8-13); idempotencia por **ruta** del archivo, no por contenido; si falla tras reservar quedan folios consumidos sin remisión; el Error Workflow solo escribe un log; sin reproceso desde el Hub. Ver [workflow](workflow.md) y [pendientes](../../00-overview/pending-and-roadmap.md#5-limitaciones-funcionales-conocidas). No se ha modificado el workflow |

## Propósito

Genera **remisiones de Audi** (PDF) y **hojas de identificación** (PDF) a partir de cada Excel *Programación de Entrega* de Audi que aparece en la carpeta del cliente en Dropbox. Por cada archivo: registra el documento origen, crea una ejecución, reserva folios, genera una remisión por artículo y las hojas de identificación, y cierra la ejecución.

## Mapa de documentos

| Documento | Contenido |
| --- | --- |
| [architecture.md](architecture.md) | Componentes y responsabilidades |
| [workflow.md](workflow.md) | Flujo principal y manejo de errores (Mermaid), reglas verificadas |
| [nodes-reference.md](nodes-reference.md) | Referencia de nodos |
| [database-contract.md](database-contract.md) | Contrato PostgreSQL desde el workflow |
| [testing.md](testing.md) | Pruebas y promoción |
| [production-runbook.md](production-runbook.md) | Operación en PROD |
| [troubleshooting.md](troubleshooting.md) | Guía de fallos |
| Comparación TEST/PROD | [n8n-test-prod-drift](../n8n-test-prod-drift.md#audi) |

## Diferencias importantes frente a Caterpillar (verificadas)

| Aspecto | Audi | Caterpillar |
| --- | --- | --- |
| Control en PostgreSQL | **SQL directo** desde nodos (INSERT/UPDATE sobre tablas) y el allocator legado `operacion.reservar_folios(text,int)` | Sólo **funciones** `SECURITY DEFINER` |
| Ejecución | `INSERT` / `UPDATE ... 'COMPLETADA'` directo | `fn_crear_ejecucion…` / `fn_finalizar…` |
| Reintentos / fallos | **Sin** registro de fallo en PostgreSQL: una falla tras crear la ejecución la deja `PROCESANDO` | `fn_registrar_fallo_ejecucion` con `max_intentos` |
| Reproceso | No existe | Webhook + hija inmutable |
| Ventana de detección | Sin fecha de corte: 60 días, hasta 20 candidatos | Corte 2026-09-22 |
| Schedule | 15 min (el catálogo del Hub dice 10 min) | 10 min (el catálogo del Hub dice 15 min) |

## Lo que NO está en el export (no se documenta como implementado)

- **División por tarimas:** no aparece ninguna lógica de tarimas/pallets en los workflows de Audi. La hoja de identificación se genera **una por artículo**.
- **Reproceso, reintentos y `max_intentos`:** no existen en Audi.
- **Contador JSON:** la **configuración** sigue definida (`counterPath`) pero **no se usa** en PROD (los nodos de contador ya no existen en PROD; en TEST están deshabilitados).
