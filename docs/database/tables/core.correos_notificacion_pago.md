# core.correos_notificacion_pago

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Registro de correos entrantes de comprobantes de pago procesados (o en proceso) por n8n. Idempotencia por `outlook_message_id` (`UNIQUE`). Campos de resumen (`resumen_enviado`, `fecha_resumen_enviado`, `detalle_error_resumen`).

## Primary Key

`correos_notificacion_pago_pkey` — PRIMARY KEY (correo_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `correo_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `outlook_message_id` | `text` | no |  |  | UNIQUE |
| `internet_message_id` | `text` | sí |  |  |  |
| `fecha_recepcion` | `timestamp with time zone` | sí |  |  |  |
| `asunto` | `text` | sí |  |  |  |
| `remitente` | `text` | sí |  |  |  |
| `estado` | `text` | no | `'PENDIENTE'::text` |  | Valores permitidos: PENDIENTE, PROCESADO, ERROR |
| `fecha_procesado` | `timestamp with time zone` | sí |  |  |  |
| `detalle_error` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |
| `resumen_enviado` | `boolean` | no | `false` |  |  |
| `fecha_resumen_enviado` | `timestamp with time zone` | sí |  |  |  |
| `detalle_error_resumen` | `text` | sí |  |  |  |

## Foreign Keys

Ninguna.

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_correos_notificacion_pago_message` | `UNIQUE (outlook_message_id)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_correos_notificacion_pago_estado` | `CHECK ((estado = ANY (ARRAY['PENDIENTE'::text, 'PROCESADO'::text, 'ERROR'::text])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `correos_notificacion_pago_pkey` | PK | `btree (correo_id)` |
| `uq_correos_notificacion_pago_message` | UNIQUE | `btree (outlook_message_id)` |

## Triggers

Ninguno.

## Relationships

- **Entra**: [`core.borradores_notificacion_pago`](core.borradores_notificacion_pago.md).`correo_id` → `correo_id` (ON DELETE NO ACTION)
- **Entra**: [`core.resultados_notificacion_pago`](core.resultados_notificacion_pago.md).`correo_id` → `correo_id` (ON DELETE CASCADE)

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


Notificaciones de pago (según [D2](../../automations/payment-notifications/database-contract.md); export **no versionado**, INFERRED): INSERT/UPDATE/SELECT (SQL directo).

## Riesgos al modificar

- Un correo `PENDIENTE` no cerrado no vuelve a ser tomado por el sondeo (ver troubleshooting de la automatización).
- Contiene asunto y remitente de correos reales: sensible.
- `DELETE` aquí arrastra en cascada: `core.resultados_notificacion_pago`.
- `DELETE` bloqueado por referencias (`RESTRICT`/`NO ACTION`) desde: `core.borradores_notificacion_pago`.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = R vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
