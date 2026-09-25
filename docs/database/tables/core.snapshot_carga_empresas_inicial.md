# core.snapshot_carga_empresas_inicial

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Copia estática de la carga inicial de empresas (mismas 19 columnas que `vw_carga_empresas_inicial`). Sin PK ni FK.

## Primary Key

**Sin primary key.**

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `empresa_id` | `bigint` | sí |  |  |  |
| `tipo_empresa` | `text` | sí |  |  |  |
| `nombre_comercial` | `text` | sí |  |  |  |
| `empresa_fiscal_id` | `bigint` | sí |  |  |  |
| `razon_social` | `text` | sí |  |  |  |
| `rfc` | `character varying(13)` | sí |  |  |  |
| `es_vigente` | `boolean` | sí |  |  |  |
| `estatus_empresa` | `text` | sí |  |  |  |
| `ruta_dropbox` | `text` | sí |  |  |  |
| `notificaciones_activas` | `boolean` | sí |  |  |  |
| `total_documentos` | `bigint` | sí |  |  |  |
| `tipos_documento` | `text` | sí |  |  |  |
| `documento_principal` | `text` | sí |  |  |  |
| `ruta_documento_principal` | `text` | sí |  |  |  |
| `total_alias` | `bigint` | sí |  |  |  |
| `aliases` | `text` | sí |  |  |  |
| `fecha_carga_empresa` | `timestamp with time zone` | sí |  |  |  |
| `fecha_carga_fiscal` | `timestamp with time zone` | sí |  |  |  |
| `lote_carga` | `text` | sí |  |  |  |

## Foreign Keys

Ninguna.

## Unique constraints

Ninguna.

## Check constraints

Ninguna.

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

Ninguno.

## Triggers

Ninguno.

## Relationships

Sin relaciones por FK (no hay FK entrantes ni salientes).

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

Ninguno en `apps/api/src` (búsqueda de `core.snapshot_carga_empresas_inicial` en SQL de repositorios/servicios).

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Histórico sin consumidor conocido; contiene RFC y rutas.
- INFERRED: creada como `CREATE TABLE AS` de la vista de carga.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = sin grants vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
