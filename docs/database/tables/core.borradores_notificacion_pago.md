# core.borradores_notificacion_pago

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Borrador de correo (Outlook) reservado por cada par (correo recibido, empresa) para las notificaciones de pago. Estados `PENDIENTE`/`CREADO`/`ERROR`.

## Primary Key

`borradores_notificacion_pago_pkey` — PRIMARY KEY (borrador_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `borrador_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `correo_id` | `bigint` | no |  |  | FK → `core.correos_notificacion_pago.correo_id` (NO ACTION) |
| `empresa_id` | `bigint` | no |  |  | FK → `core.empresas.empresa_id` (NO ACTION) |
| `estado` | `text` | no | `'PENDIENTE'::text` |  | Valores permitidos: PENDIENTE, CREADO, ERROR |
| `outlook_draft_id` | `text` | sí |  |  |  |
| `detalle_error` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `borradores_notificacion_pago_correo_id_fkey` | `correo_id` | `core.correos_notificacion_pago(correo_id)` | NO ACTION |
| `borradores_notificacion_pago_empresa_id_fkey` | `empresa_id` | `core.empresas(empresa_id)` | NO ACTION |

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_borrador_notificacion_correo_empresa` | `UNIQUE (correo_id, empresa_id)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_borrador_notificacion_estado` | `CHECK ((estado = ANY (ARRAY['PENDIENTE'::text, 'CREADO'::text, 'ERROR'::text])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `borradores_notificacion_pago_pkey` | PK | `btree (borrador_id)` |
| `uq_borrador_notificacion_correo_empresa` | UNIQUE | `btree (correo_id, empresa_id)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `correo_id` → [`core.correos_notificacion_pago`](core.correos_notificacion_pago.md) (`correo_id`, ON DELETE NO ACTION)
- **Sale**: `empresa_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE NO ACTION)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `n8n_app` | RIU | RIU |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

Ninguno en `apps/api/src` (búsqueda de `core.borradores_notificacion_pago` en SQL de repositorios/servicios).

## n8n consumers


Notificaciones de pago (según [D2](../../automations/payment-notifications/database-contract.md); export **no versionado**, INFERRED): INSERT/UPDATE/SELECT (SQL directo).

## Riesgos al modificar

- Sin `ON DELETE` en las FK (comportamiento `NO ACTION`): no se pueden borrar correos/empresas con borradores.
- La lógica de estados vive en SQL embebido en n8n (sin funciones).

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = sin grants vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
