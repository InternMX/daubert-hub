# staging.bind_productos_raw

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [staging](../schemas/staging.md). Índice: [tables](README.md).

## Propósito

Exportación cruda de productos del ERP BIND (código, título, SKU, costos, unidades, categorías…) ligada a una carga (`carga_id`). Único por (`carga_id`, `bind_id`).

## Primary Key

`bind_productos_raw_pkey` — PRIMARY KEY (registro_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `registro_id` | `bigint` | no |  | serial (nextval) | PK |
| `carga_id` | `bigint` | no |  |  | FK → `staging.cargas_fuente.carga_id` (NO ACTION) |
| `bind_id` | `uuid` | sí |  |  |  |
| `no_producto` | `bigint` | sí |  |  |  |
| `codigo` | `character varying(100)` | sí |  |  |  |
| `titulo` | `text` | sí |  |  |  |
| `sku` | `text` | sí |  |  |  |
| `tiempo_surtido` | `numeric` | sí |  |  |  |
| `volumen` | `numeric` | sí |  |  |  |
| `peso` | `numeric` | sí |  |  |  |
| `costo` | `numeric` | sí |  |  |  |
| `tipo_iva` | `character varying(50)` | sí |  |  |  |
| `moneda` | `character varying(10)` | sí |  |  |  |
| `tipo` | `integer` | sí |  |  |  |
| `tipo_compra` | `integer` | sí |  |  |  |
| `costeo` | `integer` | sí |  |  |  |
| `ieps` | `numeric` | sí |  |  |  |
| `tipo_ieps` | `character varying(50)` | sí |  |  |  |
| `unidad_medida` | `character varying(100)` | sí |  |  |  |
| `categoria_1` | `text` | sí |  |  |  |
| `categoria_2` | `text` | sí |  |  |  |
| `categoria_3` | `text` | sí |  |  |  |
| `descripcion` | `text` | sí |  |  |  |
| `produccion_automatizada` | `character varying(20)` | sí |  |  |  |
| `clave_cfdi` | `character varying(20)` | sí |  |  |  |
| `unidad_cfdi` | `character varying(20)` | sí |  |  |  |
| `categoria_propuesta` | `character varying(100)` | sí |  |  |  |
| `confianza_categoria` | `character varying(20)` | sí |  |  |  |
| `fecha_carga` | `timestamp without time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `bind_productos_raw_carga_id_fkey` | `carga_id` | `staging.cargas_fuente(carga_id)` | NO ACTION |

## Unique constraints

| constraint | definición |
| --- | --- |
| `bind_productos_raw_carga_id_bind_id_key` | `UNIQUE (carga_id, bind_id)` |

## Check constraints

Ninguna.

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `bind_productos_raw_carga_id_bind_id_key` | UNIQUE | `btree (carga_id, bind_id)` |
| `bind_productos_raw_pkey` | PK | `btree (registro_id)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `carga_id` → [`staging.cargas_fuente`](staging.cargas_fuente.md) (`carga_id`, ON DELETE NO ACTION)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

Ningún rol de aplicación tiene grants directos en PROD ni en TEST (solo el propietario `postgres`).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

Ninguno en `apps/api/src` (búsqueda de `staging.bind_productos_raw` en SQL de repositorios/servicios).

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Sin consumidores conocidos. INFERRED: `bind_id uuid` y campos `tipo_iva`, `clave_cfdi` indican origen BIND.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = sin grants; `n8n_app`: sin grants en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
