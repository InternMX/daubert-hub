# staging.cargas_fuente

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [staging](../schemas/staging.md). Índice: [tables](README.md).

## Propósito

Cabecera de cada carga de origen (`tipo_fuente`, archivo, fecha de la fuente, observaciones).

## Primary Key

`cargas_fuente_pkey` — PRIMARY KEY (carga_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `carga_id` | `bigint` | no |  | serial (nextval) | PK |
| `tipo_fuente` | `character varying(50)` | no |  |  |  |
| `archivo` | `text` | sí |  |  |  |
| `fecha_fuente` | `date` | sí |  |  |  |
| `fecha_carga` | `timestamp without time zone` | no | `now()` |  |  |
| `observaciones` | `text` | sí |  |  |  |

## Foreign Keys

Ninguna.

## Unique constraints

Ninguna.

## Check constraints

Ninguna.

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `cargas_fuente_pkey` | PK | `btree (carga_id)` |

## Triggers

Ninguno.

## Relationships

- **Entra**: [`staging.bind_productos_raw`](staging.bind_productos_raw.md).`carga_id` → `carga_id` (ON DELETE NO ACTION)
- **Entra**: [`staging.manufactura_documentos`](staging.manufactura_documentos.md).`carga_id` → `carga_id` (ON DELETE NO ACTION)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

Ningún rol de aplicación tiene grants directos en PROD ni en TEST (solo el propietario `postgres`).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

Ninguno en `apps/api/src` (búsqueda de `staging.cargas_fuente` en SQL de repositorios/servicios).

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Sin consumidores conocidos.
- `DELETE` bloqueado por referencias (`RESTRICT`/`NO ACTION`) desde: `staging.bind_productos_raw`, `staging.manufactura_documentos`.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = sin grants; `n8n_app`: sin grants en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
