# Índices

Fuente: `pg_index` + `pg_get_indexdef()`. **89 índices** en PROD y TEST (idénticos). Incluye 29 PK, 25 únicos y 23 parciales. Volver a [database](README.md).

## Índices críticos

### Idempotencia de ejecución (`ops.ejecuciones_automatizacion`)

Una `PROCESANDO` por (automatización, documento); una `COMPLETADA` original por (automatización, documento); un solo hijo por padre en reproceso. `fn_crear_ejecucion_automatizacion` se apoya en ellas (captura `unique_violation`). El índice de reproceso lo creó la migración 009.

- `uq_ejecuciones_automatizacion_procesando`
- `uq_ejecuciones_automatizacion_completada_original`
- `uq_ejecuciones_automatizacion_reproceso_unico`

### Documentos (`core.documentos`)

Deduplicación por empresa + ruta normalizada (`lower(btrim(...))`), con o sin hash; base de `fn_crear_o_resolver_documento` (`ON CONFLICT DO NOTHING`).

- `uq_documentos_empresa_ruta_hash_normalizada`
- `uq_documentos_empresa_ruta_sin_hash_normalizada`

### Folios y remisiones

Serie única por código; una reserva por (ejecución, serie); un folio activo por serie (cancelada libera el índice); índice parcial de reservas `RESERVADA` por serie.

- `uq_series_documentales_codigo`
- `uq_reservas_folios_ejecucion_serie`
- `uq_remisiones_serie_folio_no_cancelada`
- `ix_reservas_folios_serie_activa`

### Empresas

Nombre comercial único (normalizado); una razón social vigente por empresa; RFC único; alias activo único entre **todas** las empresas; un contacto principal activo por empresa.

- `uq_empresas_nombre_comercial`
- `uq_empresa_fiscal_vigente`
- `uq_empresas_fiscales_rfc`
- `uq_alias_empresa_activo`
- `uq_contacto_principal_empresa`

### Sessions (`security`)

Token hash único; email de usuario único normalizado.

- `uq_sessions_token_hash`
- `ix_sessions_user_id`
- `uq_users_email`

### Audit (`audit.cambios`)

Consulta por fecha, por registro y por usuario (parcial).

- `idx_audit_cambios_fecha`
- `idx_audit_cambios_registro`
- `idx_audit_cambios_usuario`

### Notificaciones de pago

Idempotencia por `outlook_message_id`; un borrador por (correo, empresa).

- `uq_correos_notificacion_pago_message`
- `uq_borrador_notificacion_correo_empresa`
- `idx_medios_contacto_notificacion_pago`

## Inventario completo

| tabla | índice | tipo | definición |
| --- | --- | --- | --- |
| `audit.cambios` | `cambios_pkey` | PK | `btree (cambio_id)` |
| `audit.cambios` | `idx_audit_cambios_fecha` | normal | `btree (fecha DESC)` |
| `audit.cambios` | `idx_audit_cambios_registro` | normal | `btree (esquema, tabla, registro_id, fecha DESC)` |
| `audit.cambios` | `idx_audit_cambios_usuario` | normal parcial | `btree (usuario_id, fecha DESC) WHERE (usuario_id IS NOT NULL)` |
| `core.alias_empresa` | `alias_empresa_pkey` | PK | `btree (alias_id)` |
| `core.alias_empresa` | `idx_alias_empresa_empresa` | normal | `btree (empresa_id)` |
| `core.alias_empresa` | `idx_alias_empresa_normalizado` | normal | `btree (lower(btrim(alias_normalizado)))` |
| `core.alias_empresa` | `uq_alias_empresa_activo` | UNIQUE parcial | `btree (lower(btrim(alias_normalizado))) WHERE (estatus = 'ACTIVO'::text)` |
| `core.borradores_notificacion_pago` | `borradores_notificacion_pago_pkey` | PK | `btree (borrador_id)` |
| `core.borradores_notificacion_pago` | `uq_borrador_notificacion_correo_empresa` | UNIQUE | `btree (correo_id, empresa_id)` |
| `core.contactos` | `contactos_pkey` | PK | `btree (contacto_id)` |
| `core.contactos` | `idx_contactos_empresa` | normal | `btree (empresa_id)` |
| `core.contactos` | `idx_contactos_nombre` | normal parcial | `btree (lower(btrim(nombre))) WHERE (nombre IS NOT NULL)` |
| `core.contactos` | `uq_contacto_principal_empresa` | UNIQUE parcial | `btree (empresa_id) WHERE ((es_contacto_principal = true) AND (estatus = 'ACTIVO'::text))` |
| `core.correos_notificacion_pago` | `correos_notificacion_pago_pkey` | PK | `btree (correo_id)` |
| `core.correos_notificacion_pago` | `uq_correos_notificacion_pago_message` | UNIQUE | `btree (outlook_message_id)` |
| `core.direcciones` | `direcciones_pkey` | PK | `btree (direccion_id)` |
| `core.direcciones` | `idx_direcciones_codigo_postal` | normal | `btree (codigo_postal)` |
| `core.direcciones` | `idx_direcciones_empresa` | normal parcial | `btree (empresa_id) WHERE (empresa_id IS NOT NULL)` |
| `core.direcciones` | `idx_direcciones_empresa_fiscal` | normal parcial | `btree (empresa_fiscal_id) WHERE (empresa_fiscal_id IS NOT NULL)` |
| `core.direcciones` | `uq_direccion_principal_empresa` | UNIQUE parcial | `btree (empresa_id, tipo_direccion) WHERE ((empresa_id IS NOT NULL) AND (es_principal = true) AND (estatus = 'ACTIVA'::text))` |
| `core.direcciones` | `uq_direccion_principal_empresa_fiscal` | UNIQUE parcial | `btree (empresa_fiscal_id, tipo_direccion) WHERE ((empresa_fiscal_id IS NOT NULL) AND (es_principal = true) AND (estatus = 'ACTIVA'::text))` |
| `core.documentos` | `documentos_pkey` | PK | `btree (documento_id)` |
| `core.documentos` | `idx_documentos_empresa` | normal parcial | `btree (empresa_id) WHERE (empresa_id IS NOT NULL)` |
| `core.documentos` | `idx_documentos_empresa_fiscal` | normal parcial | `btree (empresa_fiscal_id) WHERE (empresa_fiscal_id IS NOT NULL)` |
| `core.documentos` | `idx_documentos_fecha` | normal | `btree (fecha_documento)` |
| `core.documentos` | `idx_documentos_hash` | normal parcial | `btree (hash_archivo) WHERE (hash_archivo IS NOT NULL)` |
| `core.documentos` | `idx_documentos_tipo` | normal | `btree (tipo_documento)` |
| `core.documentos` | `uq_documentos_empresa_ruta_hash_normalizada` | UNIQUE parcial | `btree (empresa_id, lower(btrim(ruta_archivo)), hash_archivo) WHERE ((empresa_id IS NOT NULL) AND (hash_archivo IS NOT NULL))` |
| `core.documentos` | `uq_documentos_empresa_ruta_sin_hash_normalizada` | UNIQUE parcial | `btree (empresa_id, lower(btrim(ruta_archivo))) WHERE ((empresa_id IS NOT NULL) AND (hash_archivo IS NULL))` |
| `core.empresa_roles` | `idx_empresa_roles_rol_activo` | normal parcial | `btree (rol, empresa_id) WHERE (estatus = 'ACTIVO'::text)` |
| `core.empresa_roles` | `pk_empresa_roles` | PK | `btree (empresa_id, rol)` |
| `core.empresas` | `empresas_pkey` | PK | `btree (empresa_id)` |
| `core.empresas` | `uq_empresas_nombre_comercial` | UNIQUE | `btree (lower(btrim(nombre_comercial)))` |
| `core.empresas_fiscales` | `empresas_fiscales_pkey` | PK | `btree (empresa_fiscal_id)` |
| `core.empresas_fiscales` | `idx_empresas_fiscales_empresa` | normal | `btree (empresa_id)` |
| `core.empresas_fiscales` | `idx_empresas_fiscales_razon_social` | normal | `btree (lower(btrim(razon_social)))` |
| `core.empresas_fiscales` | `uq_empresa_fiscal_vigente` | UNIQUE parcial | `btree (empresa_id) WHERE (es_vigente = true)` |
| `core.empresas_fiscales` | `uq_empresas_fiscales_rfc` | UNIQUE | `btree (rfc)` |
| `core.empresas_notificacion_pago` | `empresas_notificacion_pago_pkey` | PK | `btree (empresa_id)` |
| `core.medios_contacto` | `idx_medios_contacto_contacto` | normal | `btree (contacto_id)` |
| `core.medios_contacto` | `idx_medios_contacto_notificacion_pago` | normal | `btree (recibe_notificacion_pago, estatus, tipo_destinatario_pago)` |
| `core.medios_contacto` | `idx_medios_contacto_valor` | normal | `btree (lower(btrim(valor)))` |
| `core.medios_contacto` | `medios_contacto_pkey` | PK | `btree (medio_id)` |
| `core.medios_contacto` | `uq_medio_principal_por_tipo` | UNIQUE parcial | `btree (contacto_id, tipo_medio) WHERE ((es_principal = true) AND (estatus = 'ACTIVO'::text))` |
| `core.medios_contacto` | `uq_medios_contacto` | UNIQUE | `btree (contacto_id, tipo_medio, valor)` |
| `core.resultados_notificacion_pago` | `resultados_notificacion_pago_pkey` | PK | `btree (correo_id, empresa_id)` |
| `operacion.ajustes_series` | `ix_ajustes_series_serie_created_at` | normal | `btree (serie_id, created_at DESC)` |
| `operacion.ajustes_series` | `pk_ajustes_series` | PK | `btree (ajuste_id)` |
| `operacion.remision_detalle` | `ix_remision_detalle_remision_id` | normal | `btree (remision_id)` |
| `operacion.remision_detalle` | `pk_remision_detalle` | PK | `btree (detalle_id)` |
| `operacion.remisiones` | `ix_remisiones_ejecucion_id` | normal | `btree (ejecucion_id)` |
| `operacion.remisiones` | `ix_remisiones_empresa_fecha` | normal | `btree (empresa_cliente_id, fecha_documento DESC)` |
| `operacion.remisiones` | `ix_remisiones_estatus_created_at` | normal | `btree (estatus, created_at DESC)` |
| `operacion.remisiones` | `pk_remisiones` | PK | `btree (remision_id)` |
| `operacion.remisiones` | `uq_remisiones_serie_folio_no_cancelada` | UNIQUE parcial | `btree (serie_id, folio) WHERE (estatus <> 'CANCELADA'::text)` |
| `operacion.reservas_folios` | `ix_reservas_folios_serie_activa` | normal parcial | `btree (serie_id) WHERE (estatus = 'RESERVADA'::text)` |
| `operacion.reservas_folios` | `pk_reservas_folios` | PK | `btree (reserva_id)` |
| `operacion.reservas_folios` | `uq_reservas_folios_ejecucion_serie` | UNIQUE | `btree (ejecucion_id, serie_id)` |
| `operacion.series_documentales` | `pk_series_documentales` | PK | `btree (serie_id)` |
| `operacion.series_documentales` | `uq_series_documentales_codigo` | UNIQUE | `btree (codigo)` |
| `ops.automation_review_acknowledgements` | `ix_automation_review_acknowledgements_automation_code` | normal | `btree (automation_code, source_occurred_at DESC)` |
| `ops.automation_review_acknowledgements` | `pk_automation_review_acknowledgements` | PK | `btree (acknowledgement_id)` |
| `ops.automation_review_acknowledgements` | `uq_automation_review_acknowledgements_source` | UNIQUE | `btree (automation_code, source_type, source_reference)` |
| `ops.automation_trigger_requests` | `ix_automation_trigger_requests_automation_code` | normal | `btree (automation_code, requested_at DESC)` |
| `ops.automation_trigger_requests` | `pk_automation_trigger_requests` | PK | `btree (trigger_request_id)` |
| `ops.automatizacion_series_proceso` | `ix_automatizacion_series_proceso_empresa_cliente_id` | normal | `btree (empresa_cliente_id)` |
| `ops.automatizacion_series_proceso` | `ix_automatizacion_series_proceso_serie_id` | normal | `btree (serie_id)` |
| `ops.automatizacion_series_proceso` | `pk_automatizacion_series_proceso` | PK | `btree (ruta_id)` |
| `ops.automatizacion_series_proceso` | `uq_automatizacion_series_proceso_automatizacion_llave` | UNIQUE | `btree (automatizacion_id, llave_proceso)` |
| `ops.automatizaciones` | `pk_automatizaciones` | PK | `btree (automatizacion_id)` |
| `ops.automatizaciones` | `uq_automatizaciones_codigo` | UNIQUE | `btree (codigo)` |
| `ops.ejecuciones_automatizacion` | `ix_ejecuciones_automatizacion_documento_estado` | normal | `btree (automatizacion_id, documento_origen_id, estado, created_at DESC)` |
| `ops.ejecuciones_automatizacion` | `ix_ejecuciones_automatizacion_n8n_execution_id` | normal parcial | `btree (n8n_execution_id) WHERE (n8n_execution_id IS NOT NULL)` |
| `ops.ejecuciones_automatizacion` | `ix_ejecuciones_automatizacion_reproceso_de_id` | normal parcial | `btree (reproceso_de_id) WHERE (reproceso_de_id IS NOT NULL)` |
| `ops.ejecuciones_automatizacion` | `pk_ejecuciones_automatizacion` | PK | `btree (ejecucion_id)` |
| `ops.ejecuciones_automatizacion` | `uq_ejecuciones_automatizacion_completada_original` | UNIQUE parcial | `btree (automatizacion_id, documento_origen_id) WHERE ((estado = 'COMPLETADA'::text) AND (reproceso_de_id IS NULL))` |
| `ops.ejecuciones_automatizacion` | `uq_ejecuciones_automatizacion_procesando` | UNIQUE parcial | `btree (automatizacion_id, documento_origen_id) WHERE (estado = 'PROCESANDO'::text)` |
| `ops.ejecuciones_automatizacion` | `uq_ejecuciones_automatizacion_reproceso_unico` | UNIQUE parcial | `btree (reproceso_de_id) WHERE (reproceso_de_id IS NOT NULL)` |
| `security.sessions` | `ix_sessions_user_id` | normal | `btree (user_id)` |
| `security.sessions` | `pk_sessions` | PK | `btree (session_id)` |
| `security.sessions` | `uq_sessions_token_hash` | UNIQUE | `btree (token_hash)` |
| `security.users` | `pk_users` | PK | `btree (user_id)` |
| `security.users` | `uq_users_email` | UNIQUE | `btree (lower(btrim(email)))` |
| `staging.bind_productos_raw` | `bind_productos_raw_carga_id_bind_id_key` | UNIQUE | `btree (carga_id, bind_id)` |
| `staging.bind_productos_raw` | `bind_productos_raw_pkey` | PK | `btree (registro_id)` |
| `staging.cargas_fuente` | `cargas_fuente_pkey` | PK | `btree (carga_id)` |
| `staging.manufactura_documentos` | `manufactura_documentos_pkey` | PK | `btree (documento_id)` |
| `staging.manufactura_productos_extraidos` | `manufactura_productos_extraidos_pkey` | PK | `btree (extraccion_id)` |
