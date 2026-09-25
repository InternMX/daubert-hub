# Schema `security`

> Fuente: `pg_namespace`, `pg_class`, `pg_proc`, `pg_constraint` (PROD y TEST). Propietario del esquema: `postgres`. Índice: [schemas](README.md).

## Propósito

Autenticación del Hub: usuarios (rol `ADMIN`/`GENERAL`) y sesiones (hash de token, expiración, revocación).

## Tablas (2)

- [`security.sessions`](../tables/security.sessions.md) — Sesiones del Hub: `token_hash` (único), `expires_at`, `revoked_at`.
- [`security.users`](../tables/security.users.md) — Usuarios del Hub: `display_name`, `email` único (normalizado), `password_hash`, rol `ADMIN`/`GENERAL`, estado, `must_change_password`.

## Vistas (0)

Ninguna.

## Funciones (0)

Ninguna.

## Sequences (2)

Todas son sequences de PostgreSQL ligadas a columnas (identity o serial); no son series documentales. Ver [sequences](../sequences.md).

## Relaciones

Sin FK hacia otros esquemas.

Referenciado por FK desde: `ops.automation_review_acknowledgements`, `ops.automation_trigger_requests`.

Diagramas: [relationships](../relationships.md).

## Consumidores

Solo el Hub (`apps/api/src/security/*`, `recent-activity`). n8n no tiene acceso.

## Automatizaciones

Ninguna.

## Roles y permisos (`USAGE` de esquema)

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | USAGE | - |
| `daubert_hub_test_user` | - | USAGE |
| `daubert_docs_ro` | USAGE | USAGE |

Ningún rol de aplicación tiene `CREATE` en el esquema. No hay privilegios por defecto (`pg_default_acl` vacío): los objetos nuevos **no** heredan grants. Detalle: [roles](../roles.md), [permissions-matrix](../permissions-matrix.md).

## Riesgos

- `security.users.password_hash` y `security.sessions.token_hash` son secretos derivados: **no consultar**. El trigger de auditoría de `users` elimina `password_hash` del payload (verificado en la definición).
- `security.sessions` no está auditada; el trigger de `users` ignora cambios que solo alteran `updated_at`/`last_login_at`.

## Modelo de autenticación y ciclo de vida (metadata + código del Hub)

Fuentes: catálogo de PostgreSQL y `apps/api/src/security/*` (lectura). **No** se consultó ningún usuario, hash ni sesión.

| Aspecto | Evidencia |
| --- | --- |
| Columnas | [`security.users`](../tables/security.users.md): `user_id`, `display_name`, `email`, `password_hash`, `role` (`ADMIN`/`GENERAL`), `status` (`ACTIVE`/`INACTIVE`), `must_change_password`, `created_at`, `updated_at`, `last_login_at`. [`security.sessions`](../tables/security.sessions.md): `session_id`, `user_id`, `token_hash`, `created_at`, `expires_at`, `revoked_at` |
| Restricciones | `uq_users_email` sobre `lower(btrim(email))`; `ck_users_role`, `ck_users_status`, no vacíos en nombre/email/hash; `uq_sessions_token_hash`; `ck_sessions_expires_after_created`; FK `fk_sessions_user` con `ON DELETE CASCADE` |
| Índices | `uq_users_email`, `uq_sessions_token_hash`, `ix_sessions_user_id` |
| Roles con acceso | Solo `daubert_hub_app` (PROD; `SELECT/INSERT/UPDATE` en ambas tablas) y `daubert_hub_test_user` (TEST). Sin `DELETE` en ninguna tabla. n8n, `n8n_cat_test` y `daubert_docs_ro`: sin acceso |
| Funciones/triggers | `trg_audit_users` → `audit.fn_registrar_cambio_security_users` (excluye `password_hash`, agrega `password_changed`); `trg_users_updated_at`. `security.sessions` **sin** trigger (por diseño, comentario del repositorio) |
| Relaciones entrantes | `ops.automation_trigger_requests` y `ops.automation_review_acknowledgements` (FK `SET NULL` a `users`) |

**Ciclo de vida de una sesión (código, no verificable con la base):**

1. *Emisión*: el Hub genera un token aleatorio (256 bits, `randomBytes(32)`, base64url), entrega el valor en una cookie `HttpOnly` (`daubert_session`) y guarda solo `SHA-256(token)` en `token_hash`, con `expires_at = ahora + 12 h` (`SESSION_LIFETIME_MS`).
2. *Validación*: una sola consulta exige `revoked_at IS NULL`, `expires_at > now()` y `users.status = 'ACTIVE'`; cualquier condición falla → sin fila.
3. *Cierre*: `UPDATE … SET revoked_at = now()` por sesión, por hash de token o para todas las sesiones de un usuario (idempotente: solo filas con `revoked_at IS NULL`).
4. *Limpieza*: **ninguna**. No hay `DELETE`, función ni job en la base para purgar sesiones expiradas/revocadas: la tabla solo crece (**PENDIENTE** decidir retención).
5. `users.last_login_at` se actualiza sin generar fila de auditoría (el trigger ignora cambios que solo tocan `updated_at`/`last_login_at`).


## TEST vs PROD

- Objetos (tablas, vistas, funciones, índices, triggers, sequences): **mismos nombres y estructura** en ambas bases. Diferencias: [test-prod-drift](../test-prod-drift.md).
