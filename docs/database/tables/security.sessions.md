# security.sessions

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [security](../schemas/security.md). Índice: [tables](README.md).

## Propósito

Sesiones del Hub: `token_hash` (único), `expires_at`, `revoked_at`. Solo se almacena el hash del token.

## Primary Key

`pk_sessions` — PRIMARY KEY (session_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `session_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `user_id` | `bigint` | no |  |  | FK → `security.users.user_id` (ON DELETE CASCADE) |
| `token_hash` | `text` | no |  |  | UNIQUE; Hash del token de sesión. No consultar. |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `expires_at` | `timestamp with time zone` | no |  |  |  |
| `revoked_at` | `timestamp with time zone` | sí |  |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `fk_sessions_user` | `user_id` | `security.users(user_id)` | CASCADE |

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_sessions_token_hash` | `UNIQUE (token_hash)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_sessions_expires_after_created` | `CHECK ((expires_at > created_at))` |
| `ck_sessions_token_hash` | `CHECK ((btrim(token_hash) <> ''::text))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `ix_sessions_user_id` | normal | `btree (user_id)` |
| `pk_sessions` | PK | `btree (session_id)` |
| `uq_sessions_token_hash` | UNIQUE | `btree (token_hash)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `user_id` → [`security.users`](security.users.md) (`user_id`, ON DELETE CASCADE)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RIU | - |
| `daubert_hub_test_user` | - | RIU |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/security/sessions.repository.ts` | repository | RIU |
| `apps/api/src/security/users.repository.ts` | repository | U |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- **No consultar** `token_hash`.
- FK `CASCADE` desde `users`.
- Sin auditoría ni limpieza automática de sesiones expiradas (no hay función/trigger de purga en la base).

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **equivalentes** en privilegios (Hub: `daubert_hub_app` PROD = `daubert_hub_test_user` TEST = RIU; `n8n_app`: sin grants en ambas). Los nombres de rol del Hub difieren por entorno; ver [permissions-matrix](../permissions-matrix.md).
