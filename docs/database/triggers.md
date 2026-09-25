# Triggers

Fuente: `pg_trigger` (no internos) + `pg_get_triggerdef()`. **25 triggers**, todos habilitados (`O`), todos `FOR EACH ROW`, idénticos en PROD y TEST. **No se disparó ninguno.** Volver a [database](README.md).

| tabla | trigger | evento | función | argumentos | dominio |
| --- | --- | --- | --- | --- | --- |
| `core.alias_empresa` | `trg_alias_empresa_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `core.alias_empresa` | `trg_audit_alias_empresa` | AFTER INSERT OR DELETE OR UPDATE | [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | 'alias_id' | Auditoría |
| `core.contactos` | `trg_audit_contactos` | AFTER INSERT OR DELETE OR UPDATE | [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | 'contacto_id' | Auditoría |
| `core.contactos` | `trg_contactos_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `core.direcciones` | `trg_audit_direcciones` | AFTER INSERT OR DELETE OR UPDATE | [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | 'direccion_id' | Auditoría |
| `core.direcciones` | `trg_direcciones_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `core.documentos` | `trg_documentos_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `core.empresa_roles` | `trg_audit_empresa_roles` | AFTER INSERT OR DELETE OR UPDATE | [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | 'empresa_id', 'rol' | Auditoría |
| `core.empresa_roles` | `trg_empresa_roles_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `core.empresas` | `trg_audit_empresas` | AFTER INSERT OR DELETE OR UPDATE | [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | 'empresa_id' | Auditoría |
| `core.empresas` | `trg_empresas_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `core.empresas_fiscales` | `trg_audit_empresas_fiscales` | AFTER INSERT OR DELETE OR UPDATE | [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | 'empresa_fiscal_id' | Auditoría |
| `core.empresas_fiscales` | `trg_empresas_fiscales_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `core.medios_contacto` | `trg_audit_medios_contacto` | AFTER INSERT OR DELETE OR UPDATE | [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | 'medio_id' | Auditoría |
| `core.medios_contacto` | `trg_medios_contacto_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `operacion.remisiones` | `trg_remisiones_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `operacion.series_documentales` | `trg_series_documentales_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `ops.automation_review_acknowledgements` | `trg_audit_automation_review_acknowledgements` | AFTER INSERT | [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | 'acknowledgement_id' | Auditoría |
| `ops.automation_trigger_requests` | `trg_audit_automation_trigger_requests` | AFTER INSERT | [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | 'trigger_request_id' | Auditoría |
| `ops.automatizacion_series_proceso` | `trg_automatizacion_series_proceso_dueno_unico` | BEFORE INSERT OR UPDATE OF serie_id, automatizacion_id | [`ops.fn_validar_dueno_unico_serie_proceso`](functions/ops.fn_validar_dueno_unico_serie_proceso.md) |  | Regla de negocio |
| `ops.automatizacion_series_proceso` | `trg_automatizacion_series_proceso_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `ops.automatizaciones` | `trg_automatizaciones_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `ops.ejecuciones_automatizacion` | `trg_ejecuciones_automatizacion_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |
| `security.users` | `trg_audit_users` | AFTER INSERT OR DELETE OR UPDATE | [`audit.fn_registrar_cambio_security_users`](functions/audit.fn_registrar_cambio_security_users.md) |  | Auditoría |
| `security.users` | `trg_users_updated_at` | BEFORE UPDATE | [`core.fn_actualizar_updated_at`](functions/core.fn_actualizar_updated_at.md) |  | Mantenimiento `updated_at` |

## Resumen por dominio

- **Auditoría (10)**: `AFTER INSERT/UPDATE/DELETE` en `core.alias_empresa`, `contactos`, `direcciones`, `empresa_roles`, `empresas`, `empresas_fiscales`, `medios_contacto`, `security.users` (función propia que oculta `password_hash`); `AFTER INSERT` solo en `ops.automation_review_acknowledgements` y `ops.automation_trigger_requests`. El argumento define las columnas de `registro_id`.
- **`updated_at` (14)**: `BEFORE UPDATE` con `core.fn_actualizar_updated_at` en las tablas con columna `updated_at` que la mantienen por trigger.
- **Regla de negocio (1)**: `trg_automatizacion_series_proceso_dueno_unico` (`BEFORE INSERT OR UPDATE OF serie_id, automatizacion_id`).
- **Sin trigger de auditoría**: `core.documentos`, `core.empresas_notificacion_pago`, los tres registros de notificaciones, todo `operacion.*`, `ops.ejecuciones_automatizacion`/`automatizaciones`/`automatizacion_series_proceso`, `security.sessions`, `staging.*`.
- **Sin trigger `updated_at`** aunque tienen la columna `updated_at`: `core.empresas_notificacion_pago`, `core.correos_notificacion_pago`, `core.borradores_notificacion_pago`, `core.resultados_notificacion_pago` (dependen de que quien escribe la fije).
