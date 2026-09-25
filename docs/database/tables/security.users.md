# security.users

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [security](../schemas/security.md). Índice: [tables](README.md).

## Propósito

Usuarios del Hub: `display_name`, `email` único (normalizado), `password_hash`, rol `ADMIN`/`GENERAL`, estado, `must_change_password`.

## Primary Key

`pk_users` — PRIMARY KEY (user_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `user_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `display_name` | `text` | no |  |  |  |
| `email` | `text` | no |  |  |  |
| `password_hash` | `text` | no |  |  | Secreto derivado. No consultar. |
| `role` | `text` | no |  |  | Valores permitidos: ADMIN, GENERAL |
| `status` | `text` | no | `'ACTIVE'::text` |  | Valores permitidos: ACTIVE, INACTIVE |
| `must_change_password` | `boolean` | no | `true` |  |  |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `updated_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `last_login_at` | `timestamp with time zone` | sí |  |  |  |

## Foreign Keys

Ninguna.

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_users_display_name` | `CHECK ((btrim(display_name) <> ''::text))` |
| `ck_users_email` | `CHECK ((btrim(email) <> ''::text))` |
| `ck_users_password_hash` | `CHECK ((btrim(password_hash) <> ''::text))` |
| `ck_users_role` | `CHECK ((role = ANY (ARRAY['ADMIN'::text, 'GENERAL'::text])))` |
| `ck_users_status` | `CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `pk_users` | PK | `btree (user_id)` |
| `uq_users_email` | UNIQUE | `btree (lower(btrim(email)))` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_audit_users` | `AFTER INSERT OR DELETE OR UPDATE ON security.users FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio_security_users()` |
| `trg_users_updated_at` | `BEFORE UPDATE ON security.users FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Entra**: [`ops.automation_review_acknowledgements`](ops.automation_review_acknowledgements.md).`reviewed_by_user_id` → `user_id` (ON DELETE SET NULL)
- **Entra**: [`ops.automation_trigger_requests`](ops.automation_trigger_requests.md).`requested_by_user_id` → `user_id` (ON DELETE SET NULL)
- **Entra**: [`security.sessions`](security.sessions.md).`user_id` → `user_id` (ON DELETE CASCADE)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RIU | - |
| `daubert_hub_test_user` | - | RIU |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Trigger**: `trg_audit_users` → [`audit.fn_registrar_cambio_security_users`](../functions/audit.fn_registrar_cambio_security_users.md)
- **Trigger**: `trg_users_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/recent-activity/document-series-activity.repository.ts` | repository | R |
| `apps/api/src/recent-activity/recent-activity.repository.ts` | repository | R |
| `apps/api/src/recent-activity/recent-activity.service.ts` | service | R |
| `apps/api/src/security/sessions.repository.ts` | repository | R |
| `apps/api/src/security/users.repository.ts` | repository | RIU |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- **No consultar** `password_hash`.
- Auditada con función propia que elimina `password_hash` y marca `password_changed`.
- En TEST `daubert_hub_test_user` tiene `SELECT/INSERT/UPDATE` (fixtures).
- `DELETE` aquí arrastra en cascada: `security.sessions`.
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = RIU; `n8n_app`: sin grants en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
