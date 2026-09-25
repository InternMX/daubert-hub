# ops.automatizaciones

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [ops](../schemas/ops.md). Índice: [tables](README.md).

## Propósito

Catálogo de automatizaciones (`codigo` en mayúsculas, `estatus`). Una `INACTIVA` no permite crear ejecuciones.

## Primary Key

`pk_automatizaciones` — PRIMARY KEY (automatizacion_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `automatizacion_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `codigo` | `text` | no |  |  | UNIQUE |
| `nombre` | `text` | no |  |  |  |
| `descripcion` | `text` | sí |  |  |  |
| `estatus` | `text` | no | `'ACTIVA'::text` |  | Valores permitidos: ACTIVA, INACTIVA |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `updated_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |

## Foreign Keys

Ninguna.

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_automatizaciones_codigo` | `UNIQUE (codigo)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_automatizaciones_codigo` | `CHECK (((codigo = upper(btrim(codigo))) AND (codigo <> ''::text)))` |
| `ck_automatizaciones_descripcion` | `CHECK (((descripcion IS NULL) OR (btrim(descripcion) <> ''::text)))` |
| `ck_automatizaciones_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVA'::text, 'INACTIVA'::text])))` |
| `ck_automatizaciones_nombre` | `CHECK ((btrim(nombre) <> ''::text))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `pk_automatizaciones` | PK | `btree (automatizacion_id)` |
| `uq_automatizaciones_codigo` | UNIQUE | `btree (codigo)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_automatizaciones_updated_at` | `BEFORE UPDATE ON ops.automatizaciones FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Entra**: [`ops.automatizacion_series_proceso`](ops.automatizacion_series_proceso.md).`automatizacion_id` → `automatizacion_id` (ON DELETE RESTRICT)
- **Entra**: [`ops.ejecuciones_automatizacion`](ops.ejecuciones_automatizacion.md).`automatizacion_id` → `automatizacion_id` (ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | R | - |
| `n8n_app` | R | R |
| `daubert_hub_test_user` | - | RID |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Lee**: [`ops.fn_crear_ejecucion_automatizacion`](../functions/ops.fn_crear_ejecucion_automatizacion.md)
- **Lee**: [`ops.fn_resolver_ejecucion_para_reproceso`](../functions/ops.fn_resolver_ejecucion_para_reproceso.md)
- **Lee**: [`ops.fn_resolver_ruta_automatizacion`](../functions/ops.fn_resolver_ruta_automatizacion.md)
- **Trigger**: `trg_automatizaciones_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/document-series.repository.ts` | repository | R |
| `apps/api/src/automations/overview/automation-overview.types.ts` | otro | R |
| `apps/api/src/automations/overview/automations-overview.repository.ts` | repository | R |
| `apps/api/src/automations/overview/automations-overview.service.ts` | service | R |
| `apps/api/src/automations/remisiones-audi/audi-executions.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-routing.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-audi-activity.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | R |

## n8n consumers

| workflow (export versionado D2) | nodos |
| --- | --- |
| Audi PROD | `Leer automatización Audi`, `Preparar validación candidato PG` |
| Audi TEST | `Leer automatización Audi` |

**Indirecto, vía funciones** (el workflow no toca la tabla, llama a la función): `ops.fn_crear_ejecucion_automatizacion` (Caterpillar PROD, Caterpillar TEST); `ops.fn_resolver_ejecucion_para_reproceso` (Caterpillar PROD, Caterpillar TEST).

## Riesgos al modificar

- `DELETE` bloqueado por FK `RESTRICT` desde ejecuciones y rutas.
- `DELETE` bloqueado por referencias (`RESTRICT`/`NO ACTION`) desde: `ops.automatizacion_series_proceso`, `ops.ejecuciones_automatizacion`.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = R vs TEST (`daubert_hub_test_user`) = RID. Ver [permissions-matrix](../permissions-matrix.md).
