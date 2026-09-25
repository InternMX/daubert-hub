# operacion.ajustes_series

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [operacion](../schemas/operacion.md). Índice: [tables](README.md).

## Propósito

Historial de ajustes manuales de `siguiente_folio` hechos desde el Hub: folio anterior/nuevo, motivo, usuario.

## Primary Key

`pk_ajustes_series` — PRIMARY KEY (ajuste_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `ajuste_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `serie_id` | `bigint` | no |  |  | FK → `operacion.series_documentales.serie_id` (ON DELETE RESTRICT) |
| `siguiente_folio_anterior` | `bigint` | no |  |  |  |
| `siguiente_folio_nuevo` | `bigint` | no |  |  |  |
| `motivo` | `text` | no |  |  |  |
| `usuario_id` | `bigint` | sí |  |  |  |
| `usuario_email` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_ajustes_series_serie` | `serie_id` | `operacion.series_documentales(serie_id)` | RESTRICT |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_ajustes_series_folio_anterior` | `CHECK ((siguiente_folio_anterior > 0))` |
| `ck_ajustes_series_folio_nuevo` | `CHECK ((siguiente_folio_nuevo > 0))` |
| `ck_ajustes_series_folios_distintos` | `CHECK ((siguiente_folio_anterior <> siguiente_folio_nuevo))` |
| `ck_ajustes_series_motivo` | `CHECK ((btrim(motivo) <> ''::text))` |
| `ck_ajustes_series_usuario_email` | `CHECK (((usuario_email IS NULL) OR (btrim(usuario_email) <> ''::text)))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `ix_ajustes_series_serie_created_at` | normal | `btree (serie_id, created_at DESC)` |
| `pk_ajustes_series` | PK | `btree (ajuste_id)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `serie_id` → [`operacion.series_documentales`](operacion.series_documentales.md) (`serie_id`, ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RI | - |
| `daubert_hub_test_user` | - | RID |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/document-series.repository.ts` | repository | RI |
| `apps/api/src/recent-activity/document-series-activity.repository.ts` | repository | R |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- El Hub inserta aquí y actualiza `series_documentales` en la misma transacción; un `UPDATE` directo de `siguiente_folio` no deja rastro.
- FK `RESTRICT` a la serie.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = RI vs TEST (`daubert_hub_test_user`) = RID. Ver [permissions-matrix](../permissions-matrix.md).
