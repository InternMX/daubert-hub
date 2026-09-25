# ops.automatizacion_series_proceso

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [ops](../schemas/ops.md). Índice: [tables](README.md).

## Propósito

Rutas: (`automatizacion_id`, `llave_proceso`) → serie + empresa cliente, con estado. Única autoridad de propiedad automatización↔serie; un trigger impide que una serie pertenezca a dos automatizaciones.

## Primary Key

`pk_automatizacion_series_proceso` — PRIMARY KEY (ruta_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `ruta_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `automatizacion_id` | `bigint` | no |  |  | FK → `ops.automatizaciones.automatizacion_id` (ON DELETE RESTRICT) |
| `llave_proceso` | `text` | no |  |  |  |
| `serie_id` | `bigint` | no |  |  | FK → `operacion.series_documentales.serie_id` (ON DELETE RESTRICT) |
| `empresa_cliente_id` | `bigint` | no |  |  | FK → `core.empresas.empresa_id` (ON DELETE RESTRICT) |
| `estatus` | `text` | no | `'ACTIVA'::text` |  | Valores permitidos: ACTIVA, INACTIVA |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `updated_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_automatizacion_series_proceso_automatizacion` | `automatizacion_id` | `ops.automatizaciones(automatizacion_id)` | RESTRICT |
| `fk_automatizacion_series_proceso_empresa_cliente` | `empresa_cliente_id` | `core.empresas(empresa_id)` | RESTRICT |
| `fk_automatizacion_series_proceso_serie` | `serie_id` | `operacion.series_documentales(serie_id)` | RESTRICT |

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_automatizacion_series_proceso_automatizacion_llave` | `UNIQUE (automatizacion_id, llave_proceso)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_automatizacion_series_proceso_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVA'::text, 'INACTIVA'::text])))` |
| `ck_automatizacion_series_proceso_llave_proceso` | `CHECK ((btrim(llave_proceso) <> ''::text))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `ix_automatizacion_series_proceso_empresa_cliente_id` | normal | `btree (empresa_cliente_id)` |
| `ix_automatizacion_series_proceso_serie_id` | normal | `btree (serie_id)` |
| `pk_automatizacion_series_proceso` | PK | `btree (ruta_id)` |
| `uq_automatizacion_series_proceso_automatizacion_llave` | UNIQUE | `btree (automatizacion_id, llave_proceso)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_automatizacion_series_proceso_dueno_unico` | `BEFORE INSERT OR UPDATE OF serie_id, automatizacion_id ON ops.automatizacion_series_proceso FOR EACH ROW EXECUTE FUNCTION ops.fn_validar_dueno_unico_serie_proceso()` |
| `trg_automatizacion_series_proceso_updated_at` | `BEFORE UPDATE ON ops.automatizacion_series_proceso FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `automatizacion_id` → [`ops.automatizaciones`](ops.automatizaciones.md) (`automatizacion_id`, ON DELETE RESTRICT)
- **Sale**: `empresa_cliente_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE RESTRICT)
- **Sale**: `serie_id` → [`operacion.series_documentales`](operacion.series_documentales.md) (`serie_id`, ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | R | - |
| `daubert_hub_test_user` | - | RID |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Lee**: [`operacion.fn_registrar_remision_generada`](../functions/operacion.fn_registrar_remision_generada.md)
- **Lee**: [`operacion.reservar_folios_para_ejecucion`](../functions/operacion.reservar_folios_para_ejecucion.md)
- **Lee**: [`ops.fn_resolver_ruta_automatizacion`](../functions/ops.fn_resolver_ruta_automatizacion.md)
- **Lee**: [`ops.fn_validar_dueno_unico_serie_proceso`](../functions/ops.fn_validar_dueno_unico_serie_proceso.md)
- **Trigger**: `trg_automatizacion_series_proceso_dueno_unico` → [`ops.fn_validar_dueno_unico_serie_proceso`](../functions/ops.fn_validar_dueno_unico_serie_proceso.md)
- **Trigger**: `trg_automatizacion_series_proceso_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/document-series.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-routing.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | R |

## n8n consumers


**Indirecto, vía funciones** (el workflow no toca la tabla, llama a la función): `operacion.fn_registrar_remision_generada` (Caterpillar PROD, Caterpillar TEST); `operacion.reservar_folios_para_ejecucion` (Caterpillar PROD, Caterpillar TEST).

## Riesgos al modificar

- `fn_resolver_ruta_automatizacion` la consulta, pero **ningún workflow exportado llama** esa función (Caterpillar tiene el ruteo hardcodeado): activar una ruta aquí no habilita un proceso en n8n.
- El trigger de dueño único no es seguro ante concurrencia (comprobación `EXISTS` sin bloqueo); la carga real es baja.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = R vs TEST (`daubert_hub_test_user`) = RID. Ver [permissions-matrix](../permissions-matrix.md).
