# operacion.remision_detalle

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [operacion](../schemas/operacion.md). Índice: [tables](README.md).

## Propósito

Renglones de una remisión (`codigo_interno`, `part_number`, `descripcion`, `cantidad_texto`). `cantidad_texto` es **texto** (no numérico).

## Primary Key

`pk_remision_detalle` — PRIMARY KEY (detalle_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `detalle_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `remision_id` | `bigint` | no |  |  | FK → `operacion.remisiones.remision_id` (ON DELETE RESTRICT) |
| `codigo_interno` | `text` | sí |  |  |  |
| `part_number` | `text` | sí |  |  |  |
| `descripcion` | `text` | sí |  |  |  |
| `cantidad_texto` | `text` | no |  |  |  |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_remision_detalle_remision` | `remision_id` | `operacion.remisiones(remision_id)` | RESTRICT |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_remision_detalle_cantidad_texto` | `CHECK ((btrim(cantidad_texto) <> ''::text))` |
| `ck_remision_detalle_codigo_interno` | `CHECK (((codigo_interno IS NULL) OR (btrim(codigo_interno) <> ''::text)))` |
| `ck_remision_detalle_descripcion` | `CHECK (((descripcion IS NULL) OR (btrim(descripcion) <> ''::text)))` |
| `ck_remision_detalle_part_number` | `CHECK (((part_number IS NULL) OR (btrim(part_number) <> ''::text)))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `ix_remision_detalle_remision_id` | normal | `btree (remision_id)` |
| `pk_remision_detalle` | PK | `btree (detalle_id)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `remision_id` → [`operacion.remisiones`](operacion.remisiones.md) (`remision_id`, ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | R | - |
| `n8n_app` | RI | RI |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Modifica**: [`operacion.fn_registrar_remision_generada`](../functions/operacion.fn_registrar_remision_generada.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | R |

## n8n consumers

| workflow (export versionado D2) | nodos |
| --- | --- |
| Audi PROD | `Preparar remisiones generadas PG` |
| Audi TEST | `Preparar remisiones generadas PG` |

**Indirecto, vía funciones** (el workflow no toca la tabla, llama a la función): `operacion.fn_registrar_remision_generada` (Caterpillar PROD, Caterpillar TEST).

## Riesgos al modificar

- FK `RESTRICT` a `remisiones`.
- Sin unicidad por renglón: la idempotencia de detalle la compara la función por multiconjunto.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = R vs TEST (`daubert_hub_test_user`) = sin grants. Ver [permissions-matrix](../permissions-matrix.md).
