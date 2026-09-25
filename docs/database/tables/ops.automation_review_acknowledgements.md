# ops.automation_review_acknowledgements

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [ops](../schemas/ops.md). Índice: [tables](README.md).

## Propósito

Acuses de revisión de eventos (errores) de una automatización hechos por un usuario del Hub. Único por (automatización, tipo de fuente, referencia).

## Primary Key

`pk_automation_review_acknowledgements` — PRIMARY KEY (acknowledgement_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `acknowledgement_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `automation_code` | `text` | no |  |  |  |
| `source_type` | `text` | no |  |  |  |
| `source_reference` | `text` | no |  |  |  |
| `source_occurred_at` | `timestamp with time zone` | no |  |  |  |
| `reviewed_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `reviewed_by_user_id` | `bigint` | sí |  |  | FK → `security.users.user_id` (ON DELETE SET NULL) |
| `reviewed_by_email` | `text` | no |  |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_automation_review_acknowledgements_user` | `reviewed_by_user_id` | `security.users(user_id)` | SET NULL |

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_automation_review_acknowledgements_source` | `UNIQUE (automation_code, source_type, source_reference)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_automation_review_acknowledgements_automation_code` | `CHECK (((automation_code = upper(btrim(automation_code))) AND (automation_code <> ''::text)))` |
| `ck_automation_review_acknowledgements_reviewed_by_email` | `CHECK ((btrim(reviewed_by_email) <> ''::text))` |
| `ck_automation_review_acknowledgements_source_reference` | `CHECK ((btrim(source_reference) <> ''::text))` |
| `ck_automation_review_acknowledgements_source_type` | `CHECK (((source_type = upper(btrim(source_type))) AND (source_type <> ''::text)))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `ix_automation_review_acknowledgements_automation_code` | normal | `btree (automation_code, source_occurred_at DESC)` |
| `pk_automation_review_acknowledgements` | PK | `btree (acknowledgement_id)` |
| `uq_automation_review_acknowledgements_source` | UNIQUE | `btree (automation_code, source_type, source_reference)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_audit_automation_review_acknowledgements` | `AFTER INSERT ON ops.automation_review_acknowledgements FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('acknowledgement_id')` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `reviewed_by_user_id` → [`security.users`](security.users.md) (`user_id`, ON DELETE SET NULL)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RI | - |
| `daubert_hub_test_user` | - | RI |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Trigger**: `trg_audit_automation_review_acknowledgements` → [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/review/review-acknowledgements.repository.ts` | repository | RI |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Auditada solo en `INSERT`.
- FK `SET NULL` a `security.users`.
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = RI; `n8n_app`: sin grants en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
