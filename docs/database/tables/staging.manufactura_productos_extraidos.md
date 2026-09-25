# staging.manufactura_productos_extraidos

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [staging](../schemas/staging.md). Índice: [tables](README.md).

## Propósito

Productos extraídos de un documento de manufactura (código/título crudos, dimensiones, calibre, peso, fabricante/cliente crudos, `confianza`, `requiere_revision`, `datos_adicionales` JSONB).

## Primary Key

`manufactura_productos_extraidos_pkey` — PRIMARY KEY (extraccion_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `extraccion_id` | `bigint` | no |  | serial (nextval) | PK |
| `documento_id` | `bigint` | no |  |  | FK → `staging.manufactura_documentos.documento_id` (NO ACTION) |
| `codigo_raw` | `text` | sí |  |  |  |
| `titulo_raw` | `text` | sí |  |  |  |
| `categoria_propuesta` | `character varying(100)` | sí |  |  |  |
| `linea_raw` | `text` | sí |  |  |  |
| `material_raw` | `text` | sí |  |  |  |
| `ancho` | `numeric` | sí |  |  |  |
| `largo` | `numeric` | sí |  |  |  |
| `alto` | `numeric` | sí |  |  |  |
| `unidad_dimension` | `character varying(20)` | sí |  |  |  |
| `calibre` | `numeric` | sí |  |  |  |
| `unidad_calibre` | `character varying(20)` | sí |  |  |  |
| `peso` | `numeric` | sí |  |  |  |
| `unidad_peso` | `character varying(20)` | sí |  |  |  |
| `cantidad_presentacion` | `numeric` | sí |  |  |  |
| `fabricante_raw` | `text` | sí |  |  |  |
| `cliente_raw` | `text` | sí |  |  |  |
| `confianza` | `character varying(20)` | sí |  |  |  |
| `requiere_revision` | `boolean` | sí | `false` |  |  |
| `datos_adicionales` | `jsonb` | sí |  |  |  |
| `fecha_extraccion` | `timestamp without time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `manufactura_productos_extraidos_documento_id_fkey` | `documento_id` | `staging.manufactura_documentos(documento_id)` | NO ACTION |

## Unique constraints

Ninguna.

## Check constraints

Ninguna.

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `manufactura_productos_extraidos_pkey` | PK | `btree (extraccion_id)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `documento_id` → [`staging.manufactura_documentos`](staging.manufactura_documentos.md) (`documento_id`, ON DELETE NO ACTION)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

Ningún rol de aplicación tiene grants directos en PROD ni en TEST (solo el propietario `postgres`).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

Ninguno en `apps/api/src` (búsqueda de `staging.manufactura_productos_extraidos` en SQL de repositorios/servicios).

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Sin consumidores conocidos.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = sin grants; `n8n_app`: sin grants en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
