# Remisiones Caterpillar

Módulo piloto de documentación: primer módulo documentado de extremo a extremo.

| | |
| --- | --- |
| Código de automatización | `REMISIONES_CATERPILLAR` |
| Cliente | Caterpillar (empresa en `core.empresas`, resuelta por las rutas) |
| Disparo normal | Schedule de n8n **cada 10 minutos** (nota de despliegue 12C) |
| Hub | Monitoreo (series, historial, detalle), ajuste de folio y reproceso manual (`ADMIN`) |
| Estado en PROD | Promovido y verificado el 2026-09-24 ([nota](../../deployments/2026-09-24-caterpillar-12c-prod.md)) |

## Propósito

**Qué proceso automatiza.** La generación de **remisiones** de Caterpillar a partir de archivos de **Programación de Entrega** que se colocan en carpetas de Dropbox. Verificado contra el export del workflow ([workflow.md](workflow.md)): n8n detecta cada Excel `PROGRAMACION DE ENTREGA` en las carpetas de cliente (`…\CLIENTES\<planta>\…\SOLICITUD DE MATERIAL`), lo cruza con el catálogo Caterpillar y genera **una remisión por artículo** (Torreón: **una remisión por orden de compra** con varios artículos), cada una con su PDF. El formato interno de las columnas del Excel está en `Normalizar datos CAT` ([nodes-reference](nodes-reference.md)); su descripción de negocio detallada no se documenta aquí.

**Qué problema resuelve.** Automatiza la emisión de remisiones a partir de la programación de entrega y, con las reglas que PostgreSQL impone (verificadas en SQL), garantiza folios consecutivos sin duplicados, trazabilidad archivo → ejecución → folios → remisiones, y reintentos/reproceso seguros e idempotentes.

**Qué elementos genera** (por archivo procesado):

| Elemento | Dónde queda |
| --- | --- |
| Documento origen (ruta, nombre, hash) | `core.documentos` |
| Ejecución | `ops.ejecuciones_automatizacion` |
| Reserva(s) de folios (una por serie usada) | `operacion.reservas_folios` |
| Remisiones (una por folio) con sus renglones | `operacion.remisiones`, `operacion.remision_detalle` |
| PDF de cada remisión | Archivo en Dropbox; su ruta queda en `remisiones.pdf_path` |

**Relación con Programación de Entrega.** Cada archivo de Programación de Entrega detectado es un *documento origen* (`documento_origen_id`). Una ejecución procesa **un** documento; la ruta/planta que le corresponde se resuelve por su `llave_proceso` contra `ops.automatizacion_series_proceso` (nueve rutas, ocho series; Torreón y Torreón Planta 2 comparten serie).

## Mapa de documentos

| Documento | Contenido |
| --- | --- |
| [architecture.md](architecture.md) | Componentes y responsabilidades (React, NestJS, PostgreSQL, n8n, Dropbox, PDF, Hub) |
| [workflow.md](workflow.md) | Flujo normal y de reproceso (diagramas Mermaid), nodos importantes, casos del trigger |
| [database-contract.md](database-contract.md) | Tablas, funciones, invariantes, folios |
| [reprocessing.md](reprocessing.md) | Reproceso manual: contrato, seguridad, códigos |
| [testing.md](testing.md) | Estrategia de pruebas y checklist de promoción |
| [production-runbook.md](production-runbook.md) | Estado y verificación en PROD, rollback |
| [troubleshooting.md](troubleshooting.md) | Guía práctica de fallos |

## Evolución (respaldada por commits)

| Commit | Cambio |
| --- | --- |
| `0a5b846`, `3f549dd` | API de sólo lectura y monitoreo integrado |
| `d6f31d5` | Ajuste seguro de folio |
| `0cebdbe`, `b030a10` | API y UI de reproceso manual |
| `d56dc04` | Configuración del webhook de reproceso en el piloto |
| `f07126b` | Soporte de ámbito PROD (`OUTSIDE_ALLOWED_SCOPE`) y aceptar cualquier 2xx de n8n |
| `42e97bc` | Nota de despliegue 12C PROD |

## TEST vs PROD (verificado contra los exports)

Comparación completa en [n8n-test-prod-drift](../n8n-test-prod-drift.md#caterpillar). Resumen con la clasificación **ESPERADA / DEUDA / DRIFT / REQUIERE REVISIÓN**:

| Aspecto | TEST (`MANUAL TEST REMISIONES CAT`) | PROD (`Remisiones CAT Produccion PG`) | Clasificación |
| --- | --- | --- | --- |
| Activo / schedule | inactivo · 10 min | activo · 10 min | ESPERADA |
| Credenciales | `cat_test` + `Daubert Hub - n8n TEST` | `Postgres produccion` + `Daubert Hub - n8n PROD` | ESPERADA |
| Origen de archivos y base de trabajo | `Pruebas\REMISIONES CAT\00_ARCHIVOS A PROCESAR` | Rutas reales de `CLIENTES\…` y `HERRAMIENTAS AUTOMATIZACION\REMISIONES CAT` | ESPERADA |
| Webhook y ámbito del reproceso | `cat-test-reprocess`, `OUTSIDE_TEST_SCOPE` | `cat-reprocess`, `OUTSIDE_ALLOWED_SCOPE` | ESPERADA |
| Fecha de corte y `empresa_id` fijo | 2026-09-21 · valor de TEST | 2026-09-22 · valor de PROD | ESPERADA (constantes editadas a mano) |
| `PROCESOS_HABILITADOS_PROD` | No existe | P2, P5, P6 | DRIFT (bajo): el gating no se prueba en TEST |
| Nodo suelto y comentarios obsoletos | `Execute a SQL query`, nota "función PG aún no creada" | — | DEUDA |
| Modo de promoción | Edición manual de constantes | — | DEUDA / REQUIERE REVISIÓN |
| Lógica del pipeline (46 de 57 nodos compartidos idénticos; el resto sólo difiere por lo anterior) | Igual | Igual | Sin diferencia |
