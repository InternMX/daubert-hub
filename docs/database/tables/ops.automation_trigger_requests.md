# ops.automation_trigger_requests

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [ops](../schemas/ops.md). Índice: [tables](README.md).

## Propósito

Registro insert-only de disparos manuales (`RUN`/`REPROCESS`) pedidos desde el Hub hacia n8n, con resultado (`TRIGGERED`/`NOTHING_TO_REPROCESS`/`UPSTREAM_ERROR`).

## Primary Key

`pk_automation_trigger_requests` — PRIMARY KEY (trigger_request_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `trigger_request_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `automation_code` | `text` | no |  |  |  |
| `action_type` | `text` | no |  |  | Valores permitidos: RUN, REPROCESS |
| `requested_by_user_id` | `bigint` | sí |  |  | FK → `security.users.user_id` (ON DELETE SET NULL) |
| `requested_by_email` | `text` | no |  |  |  |
| `requested_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `outcome` | `text` | no |  |  | Valores permitidos: TRIGGERED, NOTHING_TO_REPROCESS, UPSTREAM_ERROR |
| `target_reference` | `text` | sí |  |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_automation_trigger_requests_user` | `requested_by_user_id` | `security.users(user_id)` | SET NULL |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_automation_trigger_requests_action_type` | `CHECK ((action_type = ANY (ARRAY['RUN'::text, 'REPROCESS'::text])))` |
| `ck_automation_trigger_requests_automation_code` | `CHECK (((automation_code = upper(btrim(automation_code))) AND (automation_code <> ''::text)))` |
| `ck_automation_trigger_requests_outcome` | `CHECK ((outcome = ANY (ARRAY['TRIGGERED'::text, 'NOTHING_TO_REPROCESS'::text, 'UPSTREAM_ERROR'::text])))` |
| `ck_automation_trigger_requests_requested_by_email` | `CHECK ((btrim(requested_by_email) <> ''::text))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `ix_automation_trigger_requests_automation_code` | normal | `btree (automation_code, requested_at DESC)` |
| `pk_automation_trigger_requests` | PK | `btree (trigger_request_id)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_audit_automation_trigger_requests` | `AFTER INSERT ON ops.automation_trigger_requests FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('trigger_request_id')` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `requested_by_user_id` → [`security.users`](security.users.md) (`user_id`, ON DELETE SET NULL)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | I | - |
| `daubert_hub_test_user` | - | I |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Trigger**: `trg_audit_automation_trigger_requests` → [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/trigger-requests/automation-trigger-requests.repository.ts` | repository | I |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- El Hub solo tiene `INSERT` (sin `SELECT`).
- Auditada solo en `INSERT`.
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = I; `n8n_app`: sin grants en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
