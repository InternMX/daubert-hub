# Schema `audit`

> Fuente: `pg_namespace`, `pg_class`, `pg_proc`, `pg_constraint` (PROD y TEST). Propietario del esquema: `postgres`. Índice: [schemas](README.md).

## Propósito

Bitácora genérica de cambios. Una tabla (`audit.cambios`) y dos funciones trigger `SECURITY DEFINER` que la alimentan.

## Tablas (1)

- [`audit.cambios`](../tables/audit.cambios.md) — Bitácora genérica de cambios `INSERT`/`UPDATE`/`DELETE` de tablas auditadas.

## Vistas (0)

Ninguna.

## Funciones (2)

- [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md) — SECURITY DEFINER
- [`audit.fn_registrar_cambio_security_users`](../functions/audit.fn_registrar_cambio_security_users.md) — SECURITY DEFINER

## Sequences (1)

Todas son sequences de PostgreSQL ligadas a columnas (identity o serial); no son series documentales. Ver [sequences](../sequences.md).

## Relaciones

Sin FK hacia otros esquemas.

Diagramas: [relationships](../relationships.md).

## Consumidores

Hub: lectura (`recent-activity/*`, `security/*`). Escritura: **solo triggers** (`audit.fn_registrar_cambio*`). n8n: ninguno.

## Automatizaciones

Ninguna consume ni escribe `audit` directamente.

## Roles y permisos (`USAGE` de esquema)

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | USAGE | - |
| `daubert_hub_test_user` | - | USAGE |
| `daubert_docs_ro` | USAGE | USAGE |

Ningún rol de aplicación tiene `CREATE` en el esquema. No hay privilegios por defecto (`pg_default_acl` vacío): los objetos nuevos **no** heredan grants. Detalle: [roles](../roles.md), [permissions-matrix](../permissions-matrix.md).

## Riesgos

- `audit.cambios` guarda `datos_anteriores`/`datos_nuevos` completos en JSONB: contiene datos de negocio (contactos, empresas, RFC). Tratar como sensible.
- Sin evidencia de retención/purga (no hay función, partición ni política en la base): crecimiento ilimitado. **PENDIENTE** decidir retención.
- Solo algunas tablas están auditadas (ver [triggers](../triggers.md)); `operacion.*`, `ops.ejecuciones_automatizacion`, `core.documentos` y `security.sessions` **no** tienen trigger de auditoría.
- La atribución (`usuario_id`, `origen`, `request_id`) proviene de GUCs `app.*` que fija la aplicación (`set_config`); no está verificada criptográficamente.

## Eventos, estructura y uso

Fuentes: catálogo y `apps/api/src/recent-activity/*`, `security/audit-context.ts` (lectura). **No** se leyó ninguna fila de `audit.cambios`.

| Aspecto | Evidencia |
| --- | --- |
| Eventos | `INSERT`, `UPDATE`, `DELETE` (`chk_audit_operacion`). En `UPDATE` no se registra si solo cambió `updated_at` (y, para `users`, `last_login_at`) |
| Estructura | [`audit.cambios`](../tables/audit.cambios.md): `cambio_id` (IDENTITY), `fecha`, `esquema`, `tabla`, `registro_id` (texto `col=valor\|col=valor`), `operacion`, `usuario_id` y `usuario_email` (texto, **sin FK** a `security.users`), `origen` (default `SISTEMA`), `request_id`, `datos_anteriores`, `datos_nuevos` (JSONB) |
| Insertores | Solo los triggers `trg_audit_*` (10) mediante `audit.fn_registrar_cambio` / `_security_users`, `SECURITY DEFINER`. Ningún rol de aplicación tiene `INSERT` (en TEST `daubert_hub_test_user` sí) |
| Atribución | Variables de sesión `app.user_id`, `app.user_email`, `app.origin`, `app.request_id` que el Hub fija con `set_config(..., true)` por transacción (`origin = DAUBERT_HUB`). Escrituras sin esas variables (n8n, SQL directo) quedan con `origen = SISTEMA` |
| Readers | Hub: `recent-activity/recent-activity.repository.ts` (filtra `origen = 'DAUBERT_HUB'` y `request_id IS NOT NULL`, agrupa por `request_id`) (única consulta `FROM audit.cambios` en `apps/api/src`). `daubert_hub_app` tiene solo `SELECT` |
| Índices | `idx_audit_cambios_fecha` (`fecha DESC`), `idx_audit_cambios_registro` (`esquema, tabla, registro_id, fecha DESC`), `idx_audit_cambios_usuario` (parcial `usuario_id IS NOT NULL`) |
| Tablas auditadas | `core.alias_empresa`, `contactos`, `direcciones`, `empresa_roles`, `empresas`, `empresas_fiscales`, `medios_contacto`, `security.users`; `ops.automation_review_acknowledgements` y `ops.automation_trigger_requests` (solo `INSERT`) |
| No auditadas | `core.documentos`, `operacion.*`, `ops.ejecuciones_automatizacion`, `security.sessions`, notificaciones de pago, `staging.*`. Los ajustes de folio dejan rastro en `operacion.ajustes_series`, no en `audit.cambios` |
| Retención | **Sin evidencia**: no hay partición, `DELETE`, función de purga ni job. **PENDIENTE** |

Nota de diseño: el Hub reconstruye la actividad reciente **desde** `audit.cambios`, por lo que borrar o truncar filas cambiaría lo que muestra el Hub.


## TEST vs PROD

- Objetos (tablas, vistas, funciones, índices, triggers, sequences): **mismos nombres y estructura** en ambas bases. Diferencias: [test-prod-drift](../test-prod-drift.md).
