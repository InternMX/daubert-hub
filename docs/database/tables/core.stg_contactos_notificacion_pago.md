# core.stg_contactos_notificacion_pago

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Tabla de aterrizaje de la carga de contactos de notificación (columnas `*_carga`, `email`). Sin PK ni FK.

## Primary Key

**Sin primary key.**

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `empresa_empresa_id` | `bigint` | sí |  |  |  |
| `tipo_contacto_carga` | `text` | sí |  |  |  |
| `nombre_carga` | `text` | sí |  |  |  |
| `area_carga` | `text` | sí |  |  |  |
| `email` | `text` | sí |  |  |  |
| `tipo_destinatario_pago` | `text` | sí |  |  |  |

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

Ninguno en `apps/api/src` (búsqueda de `core.stg_contactos_notificacion_pago` en SQL de repositorios/servicios).

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Contiene correos: sensible.
- Sin consumidor conocido (INFERRED: carga inicial).

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = sin grants vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
