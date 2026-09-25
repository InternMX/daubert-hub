# core.resultados_notificacion_pago

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Resultado del procesamiento por (correo, empresa): `LISTO`, `MANUAL`, `ERROR`, `OMITIDO`. PK compuesta (`correo_id`, `empresa_id`); n8n hace upsert.

## Primary Key

`resultados_notificacion_pago_pkey` — PRIMARY KEY (correo_id, empresa_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `correo_id` | `bigint` | no |  |  | FK → `core.correos_notificacion_pago.correo_id` (ON DELETE CASCADE); PK (compuesta) |
| `empresa_id` | `bigint` | no |  |  | FK → `core.empresas.empresa_id` (NO ACTION); PK (compuesta) |
| `estado` | `character varying(20)` | no |  |  | Valores permitidos: LISTO, MANUAL, ERROR, OMITIDO |
| `motivo` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_resultado_correo` | `correo_id` | `core.correos_notificacion_pago(correo_id)` | CASCADE |
| `fk_resultado_empresa` | `empresa_id` | `core.empresas(empresa_id)` | NO ACTION |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_resultado_estado` | `CHECK (((estado)::text = ANY ((ARRAY['LISTO'::character varying, 'MANUAL'::character varying, 'ERROR'::character varying, 'OMITIDO'::character varying])::text[])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `resultados_notificacion_pago_pkey` | PK | `btree (correo_id, empresa_id)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `correo_id` → [`core.correos_notificacion_pago`](core.correos_notificacion_pago.md) (`correo_id`, ON DELETE CASCADE)
- **Sale**: `empresa_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE NO ACTION)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | R | - |
| `n8n_app` | RIU | RIU |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/payment-notifications/payment-notifications.repository.ts` | repository | R |
| `apps/api/src/recent-activity/payment-notification-activity.repository.ts` | repository | R |

## n8n consumers


Notificaciones de pago (según [D2](../../automations/payment-notifications/database-contract.md); export **no versionado**, INFERRED): INSERT … ON CONFLICT DO UPDATE / SELECT (SQL directo).

## Riesgos al modificar

- `chk_resultado_estado` está escrito de forma distinta en PROD y TEST (equivalente).

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- `chk_resultado_estado` se serializa distinto (`::character varying` vs `::text`); tras normalizar es la misma regla.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = R vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
