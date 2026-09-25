# Reglas de integridad

Fuente: `pg_constraint` + `pg_get_constraintdef()`. Totales en PROD (idénticos en TEST salvo la representación textual de `chk_resultado_estado`): PK **29**, FK **33**, UNIQUE **11**, CHECK **88**, EXCLUDE **0**, NOT NULL **181** (catalogados como constraint en PostgreSQL 18). Volver a [database](README.md).

## Reglas de negocio protegidas por la base

| regla | mecanismo | tabla |
| --- | --- | --- |
| Un folio activo por serie | `uq_remisiones_serie_folio_no_cancelada` (índice) | `operacion.remisiones` |
| Rango de reserva coherente y contiguo | `ck_reservas_folios_rango_coherente`, `_folio_final`, `_folio_inicial`, `_cantidad` | `operacion.reservas_folios` |
| Una reserva por (ejecución, serie) | `uq_reservas_folios_ejecucion_serie` | `operacion.reservas_folios` |
| Coherencia estado/`finalizada_en` de reservas | `ck_reservas_folios_finalizada_en` | `operacion.reservas_folios` |
| Código de serie en mayúsculas y sin espacios; folio > 0 | `ck_series_documentales_codigo`, `_siguiente_folio` | `operacion.series_documentales` |
| Reproceso no se apunta a sí mismo; un hijo por padre | `ck_ejecuciones_automatizacion_reproceso`, `uq_ejecuciones_automatizacion_reproceso_unico` | `ops.ejecuciones_automatizacion` |
| Una ejecución PROCESANDO por (automatización, documento) | `uq_ejecuciones_automatizacion_procesando` | `ops.ejecuciones_automatizacion` |
| Una COMPLETADA original por (automatización, documento) | `uq_ejecuciones_automatizacion_completada_original` | `ops.ejecuciones_automatizacion` |
| Estados válidos y reintentos | `ck_ejecuciones_automatizacion_estado`, `chk_ejecuciones_intentos_fallidos`, `chk_ejecuciones_max_intentos` | `ops.ejecuciones_automatizacion` |
| Una serie no puede pertenecer a dos automatizaciones | trigger `trg_automatizacion_series_proceso_dueno_unico` (no es constraint) | `ops.automatizacion_series_proceso` |
| Documento pertenece a empresa **o** empresa fiscal | `chk_documentos_propietario_xor` | `core.documentos` |
| Dirección pertenece a empresa **o** empresa fiscal | `chk_direcciones_propietario_xor` | `core.direcciones` |
| Una razón social vigente por empresa; RFC único | `uq_empresa_fiscal_vigente`, `uq_empresas_fiscales_rfc` | `core.empresas_fiscales` |
| Notificación de pago solo a correos con posición | `chk_medios_contacto_notificacion`, `chk_medios_contacto_destinatario` | `core.medios_contacto` |
| Roles de usuario del Hub y estado | `ck_users_role` (`ADMIN`/`GENERAL`), `ck_users_status` | `security.users` |
| Sesión expira después de crearse; token único | `ck_sessions_expires_after_created`, `uq_sessions_token_hash` | `security.sessions` |
| Operaciones de auditoría válidas | `chk_audit_operacion` | `audit.cambios` |
| Acción/resultado de disparo manual | `ck_automation_trigger_requests_action_type`, `_outcome` | `ops.automation_trigger_requests` |

**Sin constraints `EXCLUDE`.** Todas las FK están validadas (`convalidated = true`). Tablas sin PK: `core.snapshot_carga_empresas_inicial`, `core.stg_contactos_notificacion_pago`.

## Primary keys

| tabla | constraint | definición |
| --- | --- | --- |
| `audit.cambios` | `cambios_pkey` | `PRIMARY KEY (cambio_id)` |
| `core.alias_empresa` | `alias_empresa_pkey` | `PRIMARY KEY (alias_id)` |
| `core.borradores_notificacion_pago` | `borradores_notificacion_pago_pkey` | `PRIMARY KEY (borrador_id)` |
| `core.contactos` | `contactos_pkey` | `PRIMARY KEY (contacto_id)` |
| `core.correos_notificacion_pago` | `correos_notificacion_pago_pkey` | `PRIMARY KEY (correo_id)` |
| `core.direcciones` | `direcciones_pkey` | `PRIMARY KEY (direccion_id)` |
| `core.documentos` | `documentos_pkey` | `PRIMARY KEY (documento_id)` |
| `core.empresa_roles` | `pk_empresa_roles` | `PRIMARY KEY (empresa_id, rol)` |
| `core.empresas` | `empresas_pkey` | `PRIMARY KEY (empresa_id)` |
| `core.empresas_fiscales` | `empresas_fiscales_pkey` | `PRIMARY KEY (empresa_fiscal_id)` |
| `core.empresas_notificacion_pago` | `empresas_notificacion_pago_pkey` | `PRIMARY KEY (empresa_id)` |
| `core.medios_contacto` | `medios_contacto_pkey` | `PRIMARY KEY (medio_id)` |
| `core.resultados_notificacion_pago` | `resultados_notificacion_pago_pkey` | `PRIMARY KEY (correo_id, empresa_id)` |
| `operacion.ajustes_series` | `pk_ajustes_series` | `PRIMARY KEY (ajuste_id)` |
| `operacion.remision_detalle` | `pk_remision_detalle` | `PRIMARY KEY (detalle_id)` |
| `operacion.remisiones` | `pk_remisiones` | `PRIMARY KEY (remision_id)` |
| `operacion.reservas_folios` | `pk_reservas_folios` | `PRIMARY KEY (reserva_id)` |
| `operacion.series_documentales` | `pk_series_documentales` | `PRIMARY KEY (serie_id)` |
| `ops.automation_review_acknowledgements` | `pk_automation_review_acknowledgements` | `PRIMARY KEY (acknowledgement_id)` |
| `ops.automation_trigger_requests` | `pk_automation_trigger_requests` | `PRIMARY KEY (trigger_request_id)` |
| `ops.automatizacion_series_proceso` | `pk_automatizacion_series_proceso` | `PRIMARY KEY (ruta_id)` |
| `ops.automatizaciones` | `pk_automatizaciones` | `PRIMARY KEY (automatizacion_id)` |
| `ops.ejecuciones_automatizacion` | `pk_ejecuciones_automatizacion` | `PRIMARY KEY (ejecucion_id)` |
| `security.sessions` | `pk_sessions` | `PRIMARY KEY (session_id)` |
| `security.users` | `pk_users` | `PRIMARY KEY (user_id)` |
| `staging.bind_productos_raw` | `bind_productos_raw_pkey` | `PRIMARY KEY (registro_id)` |
| `staging.cargas_fuente` | `cargas_fuente_pkey` | `PRIMARY KEY (carga_id)` |
| `staging.manufactura_documentos` | `manufactura_documentos_pkey` | `PRIMARY KEY (documento_id)` |
| `staging.manufactura_productos_extraidos` | `manufactura_productos_extraidos_pkey` | `PRIMARY KEY (extraccion_id)` |

## Foreign keys

| tabla | constraint | definición |
| --- | --- | --- |
| `core.alias_empresa` | `alias_empresa_empresa_id_fkey` | `FOREIGN KEY (empresa_id) REFERENCES core.empresas(empresa_id) ON UPDATE CASCADE ON DELETE CASCADE` |
| `core.borradores_notificacion_pago` | `borradores_notificacion_pago_correo_id_fkey` | `FOREIGN KEY (correo_id) REFERENCES core.correos_notificacion_pago(correo_id)` |
| `core.borradores_notificacion_pago` | `borradores_notificacion_pago_empresa_id_fkey` | `FOREIGN KEY (empresa_id) REFERENCES core.empresas(empresa_id)` |
| `core.contactos` | `contactos_empresa_id_fkey` | `FOREIGN KEY (empresa_id) REFERENCES core.empresas(empresa_id) ON UPDATE CASCADE ON DELETE CASCADE` |
| `core.direcciones` | `direcciones_empresa_fiscal_id_fkey` | `FOREIGN KEY (empresa_fiscal_id) REFERENCES core.empresas_fiscales(empresa_fiscal_id) ON UPDATE CASCADE ON DELETE CASCADE` |
| `core.direcciones` | `direcciones_empresa_id_fkey` | `FOREIGN KEY (empresa_id) REFERENCES core.empresas(empresa_id) ON UPDATE CASCADE ON DELETE CASCADE` |
| `core.documentos` | `documentos_empresa_fiscal_id_fkey` | `FOREIGN KEY (empresa_fiscal_id) REFERENCES core.empresas_fiscales(empresa_fiscal_id) ON UPDATE CASCADE ON DELETE CASCADE` |
| `core.documentos` | `documentos_empresa_id_fkey` | `FOREIGN KEY (empresa_id) REFERENCES core.empresas(empresa_id) ON UPDATE CASCADE ON DELETE CASCADE` |
| `core.empresa_roles` | `empresa_roles_empresa_id_fkey` | `FOREIGN KEY (empresa_id) REFERENCES core.empresas(empresa_id) ON UPDATE CASCADE ON DELETE CASCADE` |
| `core.empresas_fiscales` | `empresas_fiscales_empresa_id_fkey` | `FOREIGN KEY (empresa_id) REFERENCES core.empresas(empresa_id) ON UPDATE CASCADE ON DELETE RESTRICT` |
| `core.empresas_notificacion_pago` | `empresas_notificacion_pago_empresa_id_fkey` | `FOREIGN KEY (empresa_id) REFERENCES core.empresas(empresa_id) ON DELETE CASCADE` |
| `core.medios_contacto` | `medios_contacto_contacto_id_fkey` | `FOREIGN KEY (contacto_id) REFERENCES core.contactos(contacto_id) ON UPDATE CASCADE ON DELETE CASCADE` |
| `core.resultados_notificacion_pago` | `fk_resultado_correo` | `FOREIGN KEY (correo_id) REFERENCES core.correos_notificacion_pago(correo_id) ON DELETE CASCADE` |
| `core.resultados_notificacion_pago` | `fk_resultado_empresa` | `FOREIGN KEY (empresa_id) REFERENCES core.empresas(empresa_id)` |
| `operacion.ajustes_series` | `fk_ajustes_series_serie` | `FOREIGN KEY (serie_id) REFERENCES operacion.series_documentales(serie_id) ON DELETE RESTRICT` |
| `operacion.remision_detalle` | `fk_remision_detalle_remision` | `FOREIGN KEY (remision_id) REFERENCES operacion.remisiones(remision_id) ON DELETE RESTRICT` |
| `operacion.remisiones` | `fk_remisiones_ejecucion` | `FOREIGN KEY (ejecucion_id) REFERENCES ops.ejecuciones_automatizacion(ejecucion_id) ON DELETE RESTRICT` |
| `operacion.remisiones` | `fk_remisiones_empresa_cliente` | `FOREIGN KEY (empresa_cliente_id) REFERENCES core.empresas(empresa_id) ON DELETE RESTRICT` |
| `operacion.remisiones` | `fk_remisiones_serie` | `FOREIGN KEY (serie_id) REFERENCES operacion.series_documentales(serie_id) ON DELETE RESTRICT` |
| `operacion.reservas_folios` | `fk_reservas_folios_ejecucion` | `FOREIGN KEY (ejecucion_id) REFERENCES ops.ejecuciones_automatizacion(ejecucion_id) ON DELETE RESTRICT` |
| `operacion.reservas_folios` | `fk_reservas_folios_serie` | `FOREIGN KEY (serie_id) REFERENCES operacion.series_documentales(serie_id) ON DELETE RESTRICT` |
| `ops.automation_review_acknowledgements` | `fk_automation_review_acknowledgements_user` | `FOREIGN KEY (reviewed_by_user_id) REFERENCES security.users(user_id) ON DELETE SET NULL` |
| `ops.automation_trigger_requests` | `fk_automation_trigger_requests_user` | `FOREIGN KEY (requested_by_user_id) REFERENCES security.users(user_id) ON DELETE SET NULL` |
| `ops.automatizacion_series_proceso` | `fk_automatizacion_series_proceso_automatizacion` | `FOREIGN KEY (automatizacion_id) REFERENCES ops.automatizaciones(automatizacion_id) ON DELETE RESTRICT` |
| `ops.automatizacion_series_proceso` | `fk_automatizacion_series_proceso_empresa_cliente` | `FOREIGN KEY (empresa_cliente_id) REFERENCES core.empresas(empresa_id) ON DELETE RESTRICT` |
| `ops.automatizacion_series_proceso` | `fk_automatizacion_series_proceso_serie` | `FOREIGN KEY (serie_id) REFERENCES operacion.series_documentales(serie_id) ON DELETE RESTRICT` |
| `ops.ejecuciones_automatizacion` | `fk_ejecuciones_automatizacion_automatizacion` | `FOREIGN KEY (automatizacion_id) REFERENCES ops.automatizaciones(automatizacion_id) ON DELETE RESTRICT` |
| `ops.ejecuciones_automatizacion` | `fk_ejecuciones_automatizacion_documento` | `FOREIGN KEY (documento_origen_id) REFERENCES core.documentos(documento_id) ON DELETE RESTRICT` |
| `ops.ejecuciones_automatizacion` | `fk_ejecuciones_automatizacion_reproceso` | `FOREIGN KEY (reproceso_de_id) REFERENCES ops.ejecuciones_automatizacion(ejecucion_id) ON DELETE RESTRICT` |
| `security.sessions` | `fk_sessions_user` | `FOREIGN KEY (user_id) REFERENCES security.users(user_id) ON DELETE CASCADE` |
| `staging.bind_productos_raw` | `bind_productos_raw_carga_id_fkey` | `FOREIGN KEY (carga_id) REFERENCES staging.cargas_fuente(carga_id)` |
| `staging.manufactura_documentos` | `manufactura_documentos_carga_id_fkey` | `FOREIGN KEY (carga_id) REFERENCES staging.cargas_fuente(carga_id)` |
| `staging.manufactura_productos_extraidos` | `manufactura_productos_extraidos_documento_id_fkey` | `FOREIGN KEY (documento_id) REFERENCES staging.manufactura_documentos(documento_id)` |

## Unique

| tabla | constraint | definición |
| --- | --- | --- |
| `core.borradores_notificacion_pago` | `uq_borrador_notificacion_correo_empresa` | `UNIQUE (correo_id, empresa_id)` |
| `core.correos_notificacion_pago` | `uq_correos_notificacion_pago_message` | `UNIQUE (outlook_message_id)` |
| `core.empresas_fiscales` | `uq_empresas_fiscales_rfc` | `UNIQUE (rfc)` |
| `core.medios_contacto` | `uq_medios_contacto` | `UNIQUE (contacto_id, tipo_medio, valor)` |
| `operacion.reservas_folios` | `uq_reservas_folios_ejecucion_serie` | `UNIQUE (ejecucion_id, serie_id)` |
| `operacion.series_documentales` | `uq_series_documentales_codigo` | `UNIQUE (codigo)` |
| `ops.automation_review_acknowledgements` | `uq_automation_review_acknowledgements_source` | `UNIQUE (automation_code, source_type, source_reference)` |
| `ops.automatizacion_series_proceso` | `uq_automatizacion_series_proceso_automatizacion_llave` | `UNIQUE (automatizacion_id, llave_proceso)` |
| `ops.automatizaciones` | `uq_automatizaciones_codigo` | `UNIQUE (codigo)` |
| `security.sessions` | `uq_sessions_token_hash` | `UNIQUE (token_hash)` |
| `staging.bind_productos_raw` | `bind_productos_raw_carga_id_bind_id_key` | `UNIQUE (carga_id, bind_id)` |

## Check

| tabla | constraint | definición |
| --- | --- | --- |
| `audit.cambios` | `chk_audit_operacion` | `CHECK ((operacion = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))` |
| `core.alias_empresa` | `chk_alias_empresa_alias_no_vacio` | `CHECK ((btrim(alias) <> ''::text))` |
| `core.alias_empresa` | `chk_alias_empresa_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text])))` |
| `core.alias_empresa` | `chk_alias_empresa_normalizado_no_vacio` | `CHECK ((btrim(alias_normalizado) <> ''::text))` |
| `core.alias_empresa` | `chk_alias_empresa_tipo` | `CHECK ((tipo_alias = ANY (ARRAY['ABREVIATURA'::text, 'RAZON_SOCIAL'::text, 'RAZON_SOCIAL_HISTORICA'::text, 'NOMBRE_ARCHIVO'::text, 'NOMBRE_CARPETA'::text, 'NOMBRE_COMERCIAL_ALTERNATIVO'::text, 'OTRO'::text])))` |
| `core.borradores_notificacion_pago` | `chk_borrador_notificacion_estado` | `CHECK ((estado = ANY (ARRAY['PENDIENTE'::text, 'CREADO'::text, 'ERROR'::text])))` |
| `core.contactos` | `chk_contactos_estatus` | `CHECK ((estatus = ANY (ARRAY['PENDIENTE'::text, 'ACTIVO'::text, 'RECHAZADO'::text, 'INACTIVO'::text])))` |
| `core.contactos` | `chk_contactos_nombre` | `CHECK (((tipo_contacto <> 'PERSONA'::text) OR (nombre IS NOT NULL)))` |
| `core.contactos` | `chk_contactos_tipo` | `CHECK ((tipo_contacto = ANY (ARRAY['PERSONA'::text, 'AREA'::text, 'BUZON_GENERICO'::text])))` |
| `core.correos_notificacion_pago` | `chk_correos_notificacion_pago_estado` | `CHECK ((estado = ANY (ARRAY['PENDIENTE'::text, 'PROCESADO'::text, 'ERROR'::text])))` |
| `core.direcciones` | `chk_direcciones_contenido` | `CHECK (((direccion_completa IS NOT NULL) OR (calle IS NOT NULL)))` |
| `core.direcciones` | `chk_direcciones_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVA'::text, 'INACTIVA'::text])))` |
| `core.direcciones` | `chk_direcciones_fechas` | `CHECK (((fecha_fin IS NULL) OR (fecha_inicio IS NULL) OR (fecha_fin >= fecha_inicio)))` |
| `core.direcciones` | `chk_direcciones_propietario_xor` | `CHECK ((((empresa_id IS NOT NULL) AND (empresa_fiscal_id IS NULL)) OR ((empresa_id IS NULL) AND (empresa_fiscal_id IS NOT NULL))))` |
| `core.direcciones` | `chk_direcciones_tipo` | `CHECK ((tipo_direccion = ANY (ARRAY['FISCAL'::text, 'COMERCIAL'::text, 'OPERATIVA'::text, 'ENTREGA'::text, 'FACTURACION'::text, 'OTRA'::text])))` |
| `core.documentos` | `chk_documentos_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text, 'ARCHIVADO'::text, 'ERROR'::text])))` |
| `core.documentos` | `chk_documentos_nombre_no_vacio` | `CHECK ((btrim(nombre_archivo) <> ''::text))` |
| `core.documentos` | `chk_documentos_origen` | `CHECK (((origen IS NULL) OR (origen = ANY (ARRAY['DROPBOX'::text, 'OUTLOOK'::text, 'BIND'::text, 'N8N'::text, 'CARGA_MANUAL'::text, 'OTRO'::text]))))` |
| `core.documentos` | `chk_documentos_propietario_xor` | `CHECK ((((empresa_id IS NOT NULL) AND (empresa_fiscal_id IS NULL)) OR ((empresa_id IS NULL) AND (empresa_fiscal_id IS NOT NULL))))` |
| `core.documentos` | `chk_documentos_ruta_no_vacia` | `CHECK ((btrim(ruta_archivo) <> ''::text))` |
| `core.empresa_roles` | `chk_empresa_roles_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text])))` |
| `core.empresa_roles` | `chk_empresa_roles_rol` | `CHECK ((rol = ANY (ARRAY['PROVEEDOR'::text, 'SERVICIO'::text, 'FLETE'::text, 'CLIENTE'::text, 'OTRO'::text])))` |
| `core.empresas` | `chk_empresas_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text, 'BLOQUEADO'::text])))` |
| `core.empresas` | `chk_empresas_nombre_no_vacio` | `CHECK ((btrim(nombre_comercial) <> ''::text))` |
| `core.empresas` | `chk_empresas_tipo` | `CHECK ((tipo_empresa = ANY (ARRAY['PROVEEDOR'::text, 'SERVICIO'::text, 'FLETE'::text, 'CLIENTE'::text, 'OTRO'::text])))` |
| `core.empresas_fiscales` | `chk_empresas_fiscales_fechas` | `CHECK (((fecha_fin IS NULL) OR (fecha_inicio IS NULL) OR (fecha_fin >= fecha_inicio)))` |
| `core.empresas_fiscales` | `chk_empresas_fiscales_razon_no_vacia` | `CHECK ((btrim(razon_social) <> ''::text))` |
| `core.empresas_fiscales` | `chk_empresas_fiscales_rfc_no_vacio` | `CHECK ((btrim((rfc)::text) <> ''::text))` |
| `core.medios_contacto` | `chk_medios_contacto_destinatario` | `CHECK (((tipo_destinatario_pago IS NULL) OR (tipo_destinatario_pago = ANY (ARRAY['PARA'::text, 'CC'::text, 'CCO'::text]))))` |
| `core.medios_contacto` | `chk_medios_contacto_estatus` | `CHECK ((estatus = ANY (ARRAY['PENDIENTE'::text, 'ACTIVO'::text, 'RECHAZADO'::text, 'INACTIVO'::text])))` |
| `core.medios_contacto` | `chk_medios_contacto_notificacion` | `CHECK (((recibe_notificacion_pago = false) OR ((tipo_medio = 'CORREO'::text) AND (tipo_destinatario_pago IS NOT NULL))))` |
| `core.medios_contacto` | `chk_medios_contacto_tipo` | `CHECK ((tipo_medio = ANY (ARRAY['CORREO'::text, 'TELEFONO'::text, 'WHATSAPP'::text, 'OTRO'::text, 'WEB'::text])))` |
| `core.medios_contacto` | `chk_medios_contacto_valor_no_vacio` | `CHECK ((btrim(valor) <> ''::text))` |
| `core.resultados_notificacion_pago` | `chk_resultado_estado` | `CHECK (((estado)::text = ANY ((ARRAY['LISTO'::character varying, 'MANUAL'::character varying, 'ERROR'::character varying, 'OMITIDO'::character varying])::text[])))` |
| `operacion.ajustes_series` | `ck_ajustes_series_folio_anterior` | `CHECK ((siguiente_folio_anterior > 0))` |
| `operacion.ajustes_series` | `ck_ajustes_series_folio_nuevo` | `CHECK ((siguiente_folio_nuevo > 0))` |
| `operacion.ajustes_series` | `ck_ajustes_series_folios_distintos` | `CHECK ((siguiente_folio_anterior <> siguiente_folio_nuevo))` |
| `operacion.ajustes_series` | `ck_ajustes_series_motivo` | `CHECK ((btrim(motivo) <> ''::text))` |
| `operacion.ajustes_series` | `ck_ajustes_series_usuario_email` | `CHECK (((usuario_email IS NULL) OR (btrim(usuario_email) <> ''::text)))` |
| `operacion.remision_detalle` | `ck_remision_detalle_cantidad_texto` | `CHECK ((btrim(cantidad_texto) <> ''::text))` |
| `operacion.remision_detalle` | `ck_remision_detalle_codigo_interno` | `CHECK (((codigo_interno IS NULL) OR (btrim(codigo_interno) <> ''::text)))` |
| `operacion.remision_detalle` | `ck_remision_detalle_descripcion` | `CHECK (((descripcion IS NULL) OR (btrim(descripcion) <> ''::text)))` |
| `operacion.remision_detalle` | `ck_remision_detalle_part_number` | `CHECK (((part_number IS NULL) OR (btrim(part_number) <> ''::text)))` |
| `operacion.remisiones` | `ck_remisiones_estatus` | `CHECK ((estatus = ANY (ARRAY['PENDIENTE'::text, 'GENERADA'::text, 'CANCELADA'::text])))` |
| `operacion.remisiones` | `ck_remisiones_folio` | `CHECK ((folio > 0))` |
| `operacion.remisiones` | `ck_remisiones_motivo_cancelacion` | `CHECK (((motivo_cancelacion IS NULL) OR (btrim(motivo_cancelacion) <> ''::text)))` |
| `operacion.remisiones` | `ck_remisiones_pdf_path` | `CHECK (((pdf_path IS NULL) OR (btrim(pdf_path) <> ''::text)))` |
| `operacion.reservas_folios` | `ck_reservas_folios_cantidad` | `CHECK ((cantidad > 0))` |
| `operacion.reservas_folios` | `ck_reservas_folios_estatus` | `CHECK ((estatus = ANY (ARRAY['RESERVADA'::text, 'APLICADA'::text, 'ABANDONADA'::text])))` |
| `operacion.reservas_folios` | `ck_reservas_folios_finalizada_en` | `CHECK ((((estatus = 'RESERVADA'::text) AND (finalizada_en IS NULL)) OR ((estatus <> 'RESERVADA'::text) AND (finalizada_en IS NOT NULL))))` |
| `operacion.reservas_folios` | `ck_reservas_folios_folio_final` | `CHECK ((folio_final >= folio_inicial))` |
| `operacion.reservas_folios` | `ck_reservas_folios_folio_inicial` | `CHECK ((folio_inicial > 0))` |
| `operacion.reservas_folios` | `ck_reservas_folios_rango_coherente` | `CHECK ((folio_final = ((folio_inicial + cantidad) - 1)))` |
| `operacion.series_documentales` | `ck_series_documentales_codigo` | `CHECK (((codigo = upper(btrim(codigo))) AND (codigo <> ''::text)))` |
| `operacion.series_documentales` | `ck_series_documentales_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVA'::text, 'INACTIVA'::text])))` |
| `operacion.series_documentales` | `ck_series_documentales_folio_minimo_ajustable` | `CHECK (((folio_minimo_ajustable IS NULL) OR (folio_minimo_ajustable > 0)))` |
| `operacion.series_documentales` | `ck_series_documentales_nombre` | `CHECK ((btrim(nombre) <> ''::text))` |
| `operacion.series_documentales` | `ck_series_documentales_siguiente_folio` | `CHECK ((siguiente_folio > 0))` |
| `ops.automation_review_acknowledgements` | `ck_automation_review_acknowledgements_automation_code` | `CHECK (((automation_code = upper(btrim(automation_code))) AND (automation_code <> ''::text)))` |
| `ops.automation_review_acknowledgements` | `ck_automation_review_acknowledgements_reviewed_by_email` | `CHECK ((btrim(reviewed_by_email) <> ''::text))` |
| `ops.automation_review_acknowledgements` | `ck_automation_review_acknowledgements_source_reference` | `CHECK ((btrim(source_reference) <> ''::text))` |
| `ops.automation_review_acknowledgements` | `ck_automation_review_acknowledgements_source_type` | `CHECK (((source_type = upper(btrim(source_type))) AND (source_type <> ''::text)))` |
| `ops.automation_trigger_requests` | `ck_automation_trigger_requests_action_type` | `CHECK ((action_type = ANY (ARRAY['RUN'::text, 'REPROCESS'::text])))` |
| `ops.automation_trigger_requests` | `ck_automation_trigger_requests_automation_code` | `CHECK (((automation_code = upper(btrim(automation_code))) AND (automation_code <> ''::text)))` |
| `ops.automation_trigger_requests` | `ck_automation_trigger_requests_outcome` | `CHECK ((outcome = ANY (ARRAY['TRIGGERED'::text, 'NOTHING_TO_REPROCESS'::text, 'UPSTREAM_ERROR'::text])))` |
| `ops.automation_trigger_requests` | `ck_automation_trigger_requests_requested_by_email` | `CHECK ((btrim(requested_by_email) <> ''::text))` |
| `ops.automatizacion_series_proceso` | `ck_automatizacion_series_proceso_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVA'::text, 'INACTIVA'::text])))` |
| `ops.automatizacion_series_proceso` | `ck_automatizacion_series_proceso_llave_proceso` | `CHECK ((btrim(llave_proceso) <> ''::text))` |
| `ops.automatizaciones` | `ck_automatizaciones_codigo` | `CHECK (((codigo = upper(btrim(codigo))) AND (codigo <> ''::text)))` |
| `ops.automatizaciones` | `ck_automatizaciones_descripcion` | `CHECK (((descripcion IS NULL) OR (btrim(descripcion) <> ''::text)))` |
| `ops.automatizaciones` | `ck_automatizaciones_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVA'::text, 'INACTIVA'::text])))` |
| `ops.automatizaciones` | `ck_automatizaciones_nombre` | `CHECK ((btrim(nombre) <> ''::text))` |
| `ops.ejecuciones_automatizacion` | `chk_ejecuciones_intentos_fallidos` | `CHECK ((intentos_fallidos >= 0))` |
| `ops.ejecuciones_automatizacion` | `chk_ejecuciones_max_intentos` | `CHECK ((max_intentos >= 1))` |
| `ops.ejecuciones_automatizacion` | `ck_ejecuciones_automatizacion_error_mensaje` | `CHECK (((error_mensaje IS NULL) OR (btrim(error_mensaje) <> ''::text)))` |
| `ops.ejecuciones_automatizacion` | `ck_ejecuciones_automatizacion_error_nodo` | `CHECK (((error_nodo IS NULL) OR (btrim(error_nodo) <> ''::text)))` |
| `ops.ejecuciones_automatizacion` | `ck_ejecuciones_automatizacion_estado` | `CHECK ((estado = ANY (ARRAY['PROCESANDO'::text, 'COMPLETADA'::text, 'ERROR'::text, 'CANCELADA'::text])))` |
| `ops.ejecuciones_automatizacion` | `ck_ejecuciones_automatizacion_finalizacion` | `CHECK (((finalizada_en IS NULL) OR (finalizada_en >= iniciada_en)))` |
| `ops.ejecuciones_automatizacion` | `ck_ejecuciones_automatizacion_n8n_id` | `CHECK (((n8n_execution_id IS NULL) OR (btrim(n8n_execution_id) <> ''::text)))` |
| `ops.ejecuciones_automatizacion` | `ck_ejecuciones_automatizacion_reproceso` | `CHECK (((reproceso_de_id IS NULL) OR (reproceso_de_id <> ejecucion_id)))` |
| `ops.ejecuciones_automatizacion` | `ck_ejecuciones_automatizacion_run_name` | `CHECK (((run_name IS NULL) OR (btrim(run_name) <> ''::text)))` |
| `security.sessions` | `ck_sessions_expires_after_created` | `CHECK ((expires_at > created_at))` |
| `security.sessions` | `ck_sessions_token_hash` | `CHECK ((btrim(token_hash) <> ''::text))` |
| `security.users` | `ck_users_display_name` | `CHECK ((btrim(display_name) <> ''::text))` |
| `security.users` | `ck_users_email` | `CHECK ((btrim(email) <> ''::text))` |
| `security.users` | `ck_users_password_hash` | `CHECK ((btrim(password_hash) <> ''::text))` |
| `security.users` | `ck_users_role` | `CHECK ((role = ANY (ARRAY['ADMIN'::text, 'GENERAL'::text])))` |
| `security.users` | `ck_users_status` | `CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))` |
