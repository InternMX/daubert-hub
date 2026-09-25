# ops.ejecuciones_automatizacion

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [ops](../schemas/ops.md). Índice: [tables](README.md).

## Propósito

Un intento de procesar un documento origen: estado, contadores de reintento, error, `n8n_execution_id`, `reproceso_de_id` (autorreferencia).

## Primary Key

`pk_ejecuciones_automatizacion` — PRIMARY KEY (ejecucion_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `ejecucion_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `automatizacion_id` | `bigint` | no |  |  | FK → `ops.automatizaciones.automatizacion_id` (ON DELETE RESTRICT) |
| `documento_origen_id` | `bigint` | no |  |  | FK → `core.documentos.documento_id` (ON DELETE RESTRICT) |
| `n8n_execution_id` | `text` | sí |  |  |  |
| `run_name` | `text` | sí |  |  |  |
| `estado` | `text` | no | `'PROCESANDO'::text` |  | Valores permitidos: PROCESANDO, COMPLETADA, ERROR, CANCELADA |
| `iniciada_en` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `finalizada_en` | `timestamp with time zone` | sí |  |  |  |
| `error_nodo` | `text` | sí |  |  |  |
| `error_mensaje` | `text` | sí |  |  |  |
| `reproceso_de_id` | `bigint` | sí |  |  | FK → `ops.ejecuciones_automatizacion.ejecucion_id` (ON DELETE RESTRICT); Ejecución padre en un reproceso; `UNIQUE` parcial: máximo un hijo por padre. |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `updated_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `intentos_fallidos` | `integer` | no | `0` |  | Reintentos consumidos; al llegar a `max_intentos` la ejecución pasa a `ERROR` (`fn_registrar_fallo_ejecucion`). |
| `max_intentos` | `integer` | no | `2` |  |  |
| `ultimo_fallo_n8n_execution_id` | `text` | sí |  |  | Evita contar dos veces el mismo run de n8n. |
| `ultimo_error_en` | `timestamp with time zone` | sí |  |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_ejecuciones_automatizacion_automatizacion` | `automatizacion_id` | `ops.automatizaciones(automatizacion_id)` | RESTRICT |
| `fk_ejecuciones_automatizacion_documento` | `documento_origen_id` | `core.documentos(documento_id)` | RESTRICT |
| `fk_ejecuciones_automatizacion_reproceso` | `reproceso_de_id` | `ops.ejecuciones_automatizacion(ejecucion_id)` | RESTRICT |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_ejecuciones_intentos_fallidos` | `CHECK ((intentos_fallidos >= 0))` |
| `chk_ejecuciones_max_intentos` | `CHECK ((max_intentos >= 1))` |
| `ck_ejecuciones_automatizacion_error_mensaje` | `CHECK (((error_mensaje IS NULL) OR (btrim(error_mensaje) <> ''::text)))` |
| `ck_ejecuciones_automatizacion_error_nodo` | `CHECK (((error_nodo IS NULL) OR (btrim(error_nodo) <> ''::text)))` |
| `ck_ejecuciones_automatizacion_estado` | `CHECK ((estado = ANY (ARRAY['PROCESANDO'::text, 'COMPLETADA'::text, 'ERROR'::text, 'CANCELADA'::text])))` |
| `ck_ejecuciones_automatizacion_finalizacion` | `CHECK (((finalizada_en IS NULL) OR (finalizada_en >= iniciada_en)))` |
| `ck_ejecuciones_automatizacion_n8n_id` | `CHECK (((n8n_execution_id IS NULL) OR (btrim(n8n_execution_id) <> ''::text)))` |
| `ck_ejecuciones_automatizacion_reproceso` | `CHECK (((reproceso_de_id IS NULL) OR (reproceso_de_id <> ejecucion_id)))` |
| `ck_ejecuciones_automatizacion_run_name` | `CHECK (((run_name IS NULL) OR (btrim(run_name) <> ''::text)))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `ix_ejecuciones_automatizacion_documento_estado` | normal | `btree (automatizacion_id, documento_origen_id, estado, created_at DESC)` |
| `ix_ejecuciones_automatizacion_n8n_execution_id` | normal parcial | `btree (n8n_execution_id) WHERE (n8n_execution_id IS NOT NULL)` |
| `ix_ejecuciones_automatizacion_reproceso_de_id` | normal parcial | `btree (reproceso_de_id) WHERE (reproceso_de_id IS NOT NULL)` |
| `pk_ejecuciones_automatizacion` | PK | `btree (ejecucion_id)` |
| `uq_ejecuciones_automatizacion_completada_original` | UNIQUE parcial | `btree (automatizacion_id, documento_origen_id) WHERE ((estado = 'COMPLETADA'::text) AND (reproceso_de_id IS NULL))` |
| `uq_ejecuciones_automatizacion_procesando` | UNIQUE parcial | `btree (automatizacion_id, documento_origen_id) WHERE (estado = 'PROCESANDO'::text)` |
| `uq_ejecuciones_automatizacion_reproceso_unico` | UNIQUE parcial | `btree (reproceso_de_id) WHERE (reproceso_de_id IS NOT NULL)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_ejecuciones_automatizacion_updated_at` | `BEFORE UPDATE ON ops.ejecuciones_automatizacion FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `automatizacion_id` → [`ops.automatizaciones`](ops.automatizaciones.md) (`automatizacion_id`, ON DELETE RESTRICT)
- **Sale**: `documento_origen_id` → [`core.documentos`](core.documentos.md) (`documento_id`, ON DELETE RESTRICT)
- **Sale**: `reproceso_de_id` → [`ops.ejecuciones_automatizacion`](ops.ejecuciones_automatizacion.md) (`ejecucion_id`, ON DELETE RESTRICT)
- **Entra**: [`operacion.remisiones`](operacion.remisiones.md).`ejecucion_id` → `ejecucion_id` (ON DELETE RESTRICT)
- **Entra**: [`operacion.reservas_folios`](operacion.reservas_folios.md).`ejecucion_id` → `ejecucion_id` (ON DELETE RESTRICT)
- **Entra**: [`ops.ejecuciones_automatizacion`](ops.ejecuciones_automatizacion.md).`reproceso_de_id` → `ejecucion_id` (ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | R | - |
| `n8n_app` | RIU | RIU |
| `daubert_hub_test_user` | - | R |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Modifica**: [`ops.fn_crear_ejecucion_automatizacion`](../functions/ops.fn_crear_ejecucion_automatizacion.md)
- **Modifica**: [`ops.fn_finalizar_ejecucion_automatizacion`](../functions/ops.fn_finalizar_ejecucion_automatizacion.md)
- **Modifica**: [`ops.fn_registrar_fallo_ejecucion`](../functions/ops.fn_registrar_fallo_ejecucion.md)
- **Lee**: [`operacion.fn_registrar_remision_generada`](../functions/operacion.fn_registrar_remision_generada.md)
- **Lee**: [`operacion.reservar_folios_para_ejecucion`](../functions/operacion.reservar_folios_para_ejecucion.md)
- **Lee**: [`ops.fn_resolver_ejecucion_para_reproceso`](../functions/ops.fn_resolver_ejecucion_para_reproceso.md)
- **Trigger**: `trg_ejecuciones_automatizacion_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/overview/automations-overview.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-audi/audi-executions.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-audi-activity.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | R |

## n8n consumers

| workflow (export versionado D2) | nodos |
| --- | --- |
| Audi PROD | `Cerrar ejecución COMPLETADA PG`, `Crear ejecución PG`, `Preparar validación candidato PG`, `Propagar ejecución PG`, `Validar idempotencia PG` |
| Audi TEST | `Cerrar ejecución COMPLETADA PG`, `Crear ejecución PG`, `Propagar ejecución PG`, `Validar idempotencia PG` |

**Indirecto, vía funciones** (el workflow no toca la tabla, llama a la función): `operacion.fn_registrar_remision_generada` (Caterpillar PROD, Caterpillar TEST); `operacion.reservar_folios_para_ejecucion` (Caterpillar PROD, Caterpillar TEST); `ops.fn_crear_ejecucion_automatizacion` (Caterpillar PROD, Caterpillar TEST); `ops.fn_finalizar_ejecucion_automatizacion` (Caterpillar PROD, Caterpillar TEST); `ops.fn_registrar_fallo_ejecucion` (Caterpillar PROD, Caterpillar TEST); `ops.fn_resolver_ejecucion_para_reproceso` (Caterpillar PROD, Caterpillar TEST).

## Riesgos al modificar

- `n8n_app` tiene `INSERT/UPDATE` directo (patrón Audi): puede saltarse la integridad de `fn_finalizar_…`.
- Índices únicos parciales: una `PROCESANDO` por (automatización, documento); una `COMPLETADA` original por (automatización, documento); un solo hijo por `reproceso_de_id`.
- Sin trigger de auditoría.
- `DELETE` bloqueado por referencias (`RESTRICT`/`NO ACTION`) desde: `operacion.remisiones`, `operacion.reservas_folios`, `ops.ejecuciones_automatizacion`.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = R; `n8n_app`: RIU en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
