# Caterpillar — Arquitectura

Vista general del sistema: [00-overview/architecture](../../00-overview/architecture.md). Aquí, sólo lo específico de Caterpillar.

## Componentes y responsabilidades

| Componente | Responsabilidad en Caterpillar | Explícitamente NO hace |
| --- | --- | --- |
| **React (Web)** | Página `/automations/remissions/caterpillar`: series/rutas, historial, detalle, diálogo de ajuste de folio y de **Reprocesar** (sólo `ADMIN`, sólo ejecuciones `FAILED`/`CANCELLED`). Valida la forma de las respuestas. | No llama a n8n. Ocultar el botón es UX, no seguridad. |
| **NestJS (API)** | Endpoints de lectura, reproceso (`POST …/reprocess`, `@Roles('ADMIN')`) y ajuste de folio. Llama al webhook de n8n **server-to-server** y traduce su contrato al del Hub. Registra la auditoría del intento en `ops.automation_trigger_requests`. | No reimplementa idempotencia, no envía rutas/series/documento/planta al webhook, no accede a Dropbox, no reserva folios. |
| **PostgreSQL** | **Fuente de verdad**: ejecuciones, reservas, remisiones, series/rutas, reglas de idempotencia, ownership e integridad (funciones `SECURITY DEFINER`, índices únicos). | — |
| **n8n** | Orquestación: detectar archivos, clasificar, invocar funciones de PostgreSQL, generar remisiones y PDF, mover/escribir archivos, exponer el webhook de reproceso. | No usa `postgres`. Por diseño opera el modelo Caterpillar a través de las funciones de PostgreSQL (aunque `n8n_app` conserva grants directos heredados: ver [roles-permissions](../../database/roles-permissions.md)). |
| **Dropbox** | Almacén de los archivos de Programación de Entrega (origen) y de los PDFs generados (destino). | El Hub no lo lee ni escribe. |
| **Generación de PDF** | Dentro del workflow n8n: `Renderizar HTML` llena una plantilla HTML (`REM-Plantilla-CAT.html` / `…-TORREON.html`), la escribe como HTML temporal y `Convertir PDF CAT` ejecuta un **script PowerShell externo** (`convertir-cat-pdf.ps1`) que produce el PDF; la ruta queda en `remisiones.pdf_path`. El script y las plantillas **no están versionados** ([n8n-dependencies](../n8n-dependencies.md)). | — |
| **Daubert Hub** | Conjunto Web + API que muestra el estado y ofrece las acciones administrativas. | No es el motor de la automatización ([ADR-005](../../decisions/ADR-005-hub-consume-estado-automatizaciones.md)). |

## Flujo de una solicitud de reproceso (vista de componentes)

```text
Admin (navegador) ──POST /api/automations/remissions/caterpillar/executions/:id/reprocess──▶ API (valida rol, id, reason)
API ──POST webhook  { executionId, reason }  + header X-Daubert-Automation-Token──▶ n8n
n8n ──ops.fn_resolver_ejecucion_para_reproceso(executionId)──▶ PostgreSQL   (todo lo demás se resuelve aquí)
n8n ◀── { accepted, status | error, executionId, originalExecutionId } ──
API ──INSERT ops.automation_trigger_requests (best-effort)──▶ PostgreSQL
API ◀── HTTP 202 / 200 / 404 / 409 / 502 / 504 ──▶ Web muestra mensaje
```

Diagramas Mermaid del flujo normal y del reproceso: [workflow.md](workflow.md).

## Identidad de rutas y procesos

- Autoridad de ruteo: `ops.automatizacion_series_proceso` (**nunca** se parsea `series_documentales.codigo`).
- Nueve `llave_proceso` conocidas → etiqueta en el Hub (`caterpillar-process-labels.ts`, sólo presentación):

| `llave_proceso` | Etiqueta |
| --- | --- |
| `CATERPILLAR_P2\|P2\|` | P2 |
| `CAT_P3_P4_P5_P6\|P3\|` … `\|P6\|` | P3, P4, P5, P6 |
| `CAT_NUEVO_LAREDO\|NUEVO_LAREDO\|FINSA_1` / `FINSA_3` | Nuevo Laredo FINSA 1 / FINSA 3 |
| `CAT_TORREON\|TORREON\|` y `…\|PLANTA_2` | Torreón / Torreón Planta 2 (misma serie) |

- Una llave desconocida nunca rompe la respuesta: el Hub muestra la `llave_proceso` cruda.
- Como Torreón/Planta 2 comparten serie, el Hub **no puede** deducir la ruta de una ejecución sólo por su serie: muestra "Proceso no determinado" en vez de adivinar. Limitación conocida del modelo actual.

## Configuración por entorno

Ver [environments](../../00-overview/environments.md). Variables del Hub: `CATERPILLAR_REPROCESS_WEBHOOK_URL` y `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN` (valor secreto, sólo en el entorno de la API).
