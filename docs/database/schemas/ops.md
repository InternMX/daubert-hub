# Schema `ops`

> Fuente: `pg_namespace`, `pg_class`, `pg_proc`, `pg_constraint` (PROD y TEST). Propietario del esquema: `postgres`. Índice: [schemas](README.md).

## Propósito

Orquestación de automatizaciones: catálogo, ejecuciones, rutas proceso→serie→cliente, auditoría de disparos manuales desde el Hub y acuses de revisión. Contiene 6 de las 10 funciones `SECURITY DEFINER`.

## Tablas (5)

- [`ops.automation_review_acknowledgements`](../tables/ops.automation_review_acknowledgements.md) — Acuses de revisión de eventos (errores) de una automatización hechos por un usuario del Hub.
- [`ops.automation_trigger_requests`](../tables/ops.automation_trigger_requests.md) — Registro insert-only de disparos manuales (`RUN`/`REPROCESS`) pedidos desde el Hub hacia n8n, con resultado (`TRIGGERED`/`NOTHING_TO_REPROCESS`/`UPSTREAM_ERROR`).
- [`ops.automatizacion_series_proceso`](../tables/ops.automatizacion_series_proceso.md) — Rutas: (`automatizacion_id`, `llave_proceso`) → serie + empresa cliente, con estado.
- [`ops.automatizaciones`](../tables/ops.automatizaciones.md) — Catálogo de automatizaciones (`codigo` en mayúsculas, `estatus`).
- [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md) — Un intento de procesar un documento origen: estado, contadores de reintento, error, `n8n_execution_id`, `reproceso_de_id` (autorreferencia).

## Vistas (0)

Ninguna.

## Funciones (6)

- [`ops.fn_crear_ejecucion_automatizacion`](../functions/ops.fn_crear_ejecucion_automatizacion.md) — SECURITY DEFINER
- [`ops.fn_finalizar_ejecucion_automatizacion`](../functions/ops.fn_finalizar_ejecucion_automatizacion.md) — SECURITY DEFINER
- [`ops.fn_registrar_fallo_ejecucion`](../functions/ops.fn_registrar_fallo_ejecucion.md) — SECURITY DEFINER
- [`ops.fn_resolver_ejecucion_para_reproceso`](../functions/ops.fn_resolver_ejecucion_para_reproceso.md) — SECURITY DEFINER
- [`ops.fn_resolver_ruta_automatizacion`](../functions/ops.fn_resolver_ruta_automatizacion.md) — SECURITY DEFINER
- [`ops.fn_validar_dueno_unico_serie_proceso`](../functions/ops.fn_validar_dueno_unico_serie_proceso.md) — INVOKER

## Sequences (5)

Todas son sequences de PostgreSQL ligadas a columnas (identity o serial); no son series documentales. Ver [sequences](../sequences.md).

## Relaciones

Referencias hacia otros esquemas (FK):

- `ops.automation_review_acknowledgements` → `security.users`
- `ops.automation_trigger_requests` → `security.users`
- `ops.automatizacion_series_proceso` → `core.empresas`
- `ops.automatizacion_series_proceso` → `operacion.series_documentales`
- `ops.ejecuciones_automatizacion` → `core.documentos`

Referenciado por FK desde: `operacion.remisiones`, `operacion.reservas_folios`.

Diagramas: [relationships](../relationships.md).

## Consumidores

Hub (lectura de catálogo/ejecuciones/rutas; INSERT en `automation_trigger_requests` y `automation_review_acknowledgements`); n8n (funciones `fn_*` en Caterpillar; SQL directo sobre `ejecuciones_automatizacion` en Audi).

## Automatizaciones

Audi, Caterpillar (Notificaciones no usa `ops`).

## Roles y permisos (`USAGE` de esquema)

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | USAGE | - |
| `n8n_app` | USAGE | USAGE |
| `n8n_cat_test` | - | USAGE |
| `daubert_hub_test_user` | - | USAGE |
| `daubert_docs_ro` | USAGE | USAGE |

Ningún rol de aplicación tiene `CREATE` en el esquema. No hay privilegios por defecto (`pg_default_acl` vacío): los objetos nuevos **no** heredan grants. Detalle: [roles](../roles.md), [permissions-matrix](../permissions-matrix.md).

## Riesgos

- Audi crea/cierra ejecuciones con SQL directo (`INSERT`/`UPDATE`): no usa `fn_registrar_fallo_ejecucion`, por lo que un fallo posterior deja la ejecución `PROCESANDO`, y el índice `uq_ejecuciones_automatizacion_procesando` bloquea un nuevo intento sobre el mismo documento.
- La elegibilidad de un reproceso (estado del padre, misma automatización) **no** la valida `fn_crear_ejecucion_automatizacion`: depende del workflow.

## TEST vs PROD

- Objetos (tablas, vistas, funciones, índices, triggers, sequences): **mismos nombres y estructura** en ambas bases. Diferencias: [test-prod-drift](../test-prod-drift.md).
