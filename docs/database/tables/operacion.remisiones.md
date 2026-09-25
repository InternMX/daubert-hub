# operacion.remisiones

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [operacion](../schemas/operacion.md). Índice: [tables](README.md).

## Propósito

Remisión emitida: serie + folio, cliente, ejecución que la generó, fecha, `pdf_path`, estado (`PENDIENTE`/`GENERADA`/`CANCELADA`).

## Primary Key

`pk_remisiones` — PRIMARY KEY (remision_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `remision_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `serie_id` | `bigint` | no |  |  | FK → `operacion.series_documentales.serie_id` (ON DELETE RESTRICT) |
| `folio` | `bigint` | no |  |  |  |
| `empresa_cliente_id` | `bigint` | no |  |  | FK → `core.empresas.empresa_id` (ON DELETE RESTRICT) |
| `ejecucion_id` | `bigint` | no |  |  | FK → `ops.ejecuciones_automatizacion.ejecucion_id` (ON DELETE RESTRICT) |
| `fecha_documento` | `date` | no |  |  |  |
| `pdf_path` | `text` | sí |  |  |  |
| `estatus` | `text` | no | `'PENDIENTE'::text` |  | Valores permitidos: PENDIENTE, GENERADA, CANCELADA |
| `motivo_cancelacion` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `updated_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_remisiones_ejecucion` | `ejecucion_id` | `ops.ejecuciones_automatizacion(ejecucion_id)` | RESTRICT |
| `fk_remisiones_empresa_cliente` | `empresa_cliente_id` | `core.empresas(empresa_id)` | RESTRICT |
| `fk_remisiones_serie` | `serie_id` | `operacion.series_documentales(serie_id)` | RESTRICT |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_remisiones_estatus` | `CHECK ((estatus = ANY (ARRAY['PENDIENTE'::text, 'GENERADA'::text, 'CANCELADA'::text])))` |
| `ck_remisiones_folio` | `CHECK ((folio > 0))` |
| `ck_remisiones_motivo_cancelacion` | `CHECK (((motivo_cancelacion IS NULL) OR (btrim(motivo_cancelacion) <> ''::text)))` |
| `ck_remisiones_pdf_path` | `CHECK (((pdf_path IS NULL) OR (btrim(pdf_path) <> ''::text)))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `ix_remisiones_ejecucion_id` | normal | `btree (ejecucion_id)` |
| `ix_remisiones_empresa_fecha` | normal | `btree (empresa_cliente_id, fecha_documento DESC)` |
| `ix_remisiones_estatus_created_at` | normal | `btree (estatus, created_at DESC)` |
| `pk_remisiones` | PK | `btree (remision_id)` |
| `uq_remisiones_serie_folio_no_cancelada` | UNIQUE parcial | `btree (serie_id, folio) WHERE (estatus <> 'CANCELADA'::text)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_remisiones_updated_at` | `BEFORE UPDATE ON operacion.remisiones FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `ejecucion_id` → [`ops.ejecuciones_automatizacion`](ops.ejecuciones_automatizacion.md) (`ejecucion_id`, ON DELETE RESTRICT)
- **Sale**: `empresa_cliente_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE RESTRICT)
- **Sale**: `serie_id` → [`operacion.series_documentales`](operacion.series_documentales.md) (`serie_id`, ON DELETE RESTRICT)
- **Entra**: [`operacion.remision_detalle`](operacion.remision_detalle.md).`remision_id` → `remision_id` (ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | R | - |
| `n8n_app` | RIU | RIU |
| `daubert_hub_test_user` | - | R |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Modifica**: [`operacion.fn_registrar_remision_generada`](../functions/operacion.fn_registrar_remision_generada.md)
- **Lee**: [`operacion.reservar_folios`](../functions/operacion.reservar_folios.md)
- **Lee**: [`ops.fn_finalizar_ejecucion_automatizacion`](../functions/ops.fn_finalizar_ejecucion_automatizacion.md)
- **Trigger**: `trg_remisiones_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/document-series.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-audi/audi-executions.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-audi-activity.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | R |

## n8n consumers

| workflow (export versionado D2) | nodos |
| --- | --- |
| Audi PROD | `Preparar remisiones generadas PG` |
| Audi TEST | `Preparar remisiones generadas PG` |

**Indirecto, vía funciones** (el workflow no toca la tabla, llama a la función): `operacion.fn_registrar_remision_generada` (Caterpillar PROD, Caterpillar TEST); `operacion.reservar_folios` (Audi PROD, Audi TEST); `ops.fn_finalizar_ejecucion_automatizacion` (Caterpillar PROD, Caterpillar TEST).

## Riesgos al modificar

- `uq_remisiones_serie_folio_no_cancelada`: un folio activo por serie; cancelar libera el folio a nivel de índice (los PDFs ya emitidos no se liberan).
- `n8n_app` tiene `UPDATE` directo, pero ningún workflow exportado lo usa.
- Sin trigger de auditoría.
- `DELETE` bloqueado por referencias (`RESTRICT`/`NO ACTION`) desde: `operacion.remision_detalle`.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = R; `n8n_app`: RIU en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
