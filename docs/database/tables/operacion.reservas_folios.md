# operacion.reservas_folios

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [operacion](../schemas/operacion.md). Índice: [tables](README.md).

## Propósito

Rango contiguo de folios `[folio_inicial, folio_final]` reservado por una ejecución en una serie. Estados `RESERVADA`/`APLICADA`/`ABANDONADA`.

## Primary Key

`pk_reservas_folios` — PRIMARY KEY (reserva_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `reserva_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `ejecucion_id` | `bigint` | no |  |  | FK → `ops.ejecuciones_automatizacion.ejecucion_id` (ON DELETE RESTRICT) |
| `serie_id` | `bigint` | no |  |  | FK → `operacion.series_documentales.serie_id` (ON DELETE RESTRICT) |
| `folio_inicial` | `bigint` | no |  |  |  |
| `folio_final` | `bigint` | no |  |  |  |
| `cantidad` | `integer` | no |  |  | Debe cumplir `folio_final = folio_inicial + cantidad − 1`. |
| `estatus` | `text` | no | `'RESERVADA'::text` |  | Valores permitidos: RESERVADA, APLICADA, ABANDONADA |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `finalizada_en` | `timestamp with time zone` | sí |  |  | NOT NULL si y solo si la reserva ya no está `RESERVADA` (`ck_reservas_folios_finalizada_en`). |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_reservas_folios_ejecucion` | `ejecucion_id` | `ops.ejecuciones_automatizacion(ejecucion_id)` | RESTRICT |
| `fk_reservas_folios_serie` | `serie_id` | `operacion.series_documentales(serie_id)` | RESTRICT |

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_reservas_folios_ejecucion_serie` | `UNIQUE (ejecucion_id, serie_id)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_reservas_folios_cantidad` | `CHECK ((cantidad > 0))` |
| `ck_reservas_folios_estatus` | `CHECK ((estatus = ANY (ARRAY['RESERVADA'::text, 'APLICADA'::text, 'ABANDONADA'::text])))` |
| `ck_reservas_folios_finalizada_en` | `CHECK ((((estatus = 'RESERVADA'::text) AND (finalizada_en IS NULL)) OR ((estatus <> 'RESERVADA'::text) AND (finalizada_en IS NOT NULL))))` |
| `ck_reservas_folios_folio_final` | `CHECK ((folio_final >= folio_inicial))` |
| `ck_reservas_folios_folio_inicial` | `CHECK ((folio_inicial > 0))` |
| `ck_reservas_folios_rango_coherente` | `CHECK ((folio_final = ((folio_inicial + cantidad) - 1)))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `ix_reservas_folios_serie_activa` | normal parcial | `btree (serie_id) WHERE (estatus = 'RESERVADA'::text)` |
| `pk_reservas_folios` | PK | `btree (reserva_id)` |
| `uq_reservas_folios_ejecucion_serie` | UNIQUE | `btree (ejecucion_id, serie_id)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `ejecucion_id` → [`ops.ejecuciones_automatizacion`](ops.ejecuciones_automatizacion.md) (`ejecucion_id`, ON DELETE RESTRICT)
- **Sale**: `serie_id` → [`operacion.series_documentales`](operacion.series_documentales.md) (`serie_id`, ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | R | - |
| `daubert_hub_test_user` | - | R |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Modifica**: [`operacion.reservar_folios_para_ejecucion`](../functions/operacion.reservar_folios_para_ejecucion.md)
- **Modifica**: [`ops.fn_finalizar_ejecucion_automatizacion`](../functions/ops.fn_finalizar_ejecucion_automatizacion.md)
- **Lee**: [`operacion.fn_registrar_remision_generada`](../functions/operacion.fn_registrar_remision_generada.md)
- **Lee**: [`ops.fn_registrar_fallo_ejecucion`](../functions/ops.fn_registrar_fallo_ejecucion.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/document-series.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | R |

## n8n consumers


**Indirecto, vía funciones** (el workflow no toca la tabla, llama a la función): `operacion.fn_registrar_remision_generada` (Caterpillar PROD, Caterpillar TEST); `operacion.reservar_folios_para_ejecucion` (Caterpillar PROD, Caterpillar TEST); `ops.fn_finalizar_ejecucion_automatizacion` (Caterpillar PROD, Caterpillar TEST); `ops.fn_registrar_fallo_ejecucion` (Caterpillar PROD, Caterpillar TEST).

## Riesgos al modificar

- `UNIQUE(ejecucion_id, serie_id)`: una reserva por ejecución y serie.
- Solo la usa el modelo Caterpillar; Audi no crea reservas.
- Ningún rol de aplicación puede escribirla directamente: solo `reservar_folios_para_ejecucion` y `fn_finalizar_ejecucion_automatizacion` (definer).

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = R; `n8n_app`: sin grants en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
