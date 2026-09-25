# staging.manufactura_documentos

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [staging](../schemas/staging.md). Índice: [tables](README.md).

## Propósito

Documentos de manufactura cargados (archivo, hoja, fecha) ligados a una carga.

## Primary Key

`manufactura_documentos_pkey` — PRIMARY KEY (documento_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `documento_id` | `bigint` | no |  | serial (nextval) | PK |
| `carga_id` | `bigint` | no |  |  | FK → `staging.cargas_fuente.carga_id` (NO ACTION) |
| `archivo` | `text` | no |  |  |  |
| `hoja` | `text` | sí |  |  |  |
| `fecha_documento` | `date` | sí |  |  |  |
| `fecha_carga` | `timestamp without time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `manufactura_documentos_carga_id_fkey` | `carga_id` | `staging.cargas_fuente(carga_id)` | NO ACTION |

## Unique constraints

Ninguna.

## Check constraints

Ninguna.

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `manufactura_documentos_pkey` | PK | `btree (documento_id)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `carga_id` → [`staging.cargas_fuente`](staging.cargas_fuente.md) (`carga_id`, ON DELETE NO ACTION)
- **Entra**: [`staging.manufactura_productos_extraidos`](staging.manufactura_productos_extraidos.md).`documento_id` → `documento_id` (ON DELETE NO ACTION)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

Ningún rol de aplicación tiene grants directos en PROD ni en TEST (solo el propietario `postgres`).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

Ninguno en `apps/api/src` (búsqueda de `staging.manufactura_documentos` en SQL de repositorios/servicios).

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Sin consumidores conocidos.
- `DELETE` bloqueado por referencias (`RESTRICT`/`NO ACTION`) desde: `staging.manufactura_productos_extraidos`.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = sin grants; `n8n_app`: sin grants en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
