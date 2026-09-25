# Catálogo de tablas

31 tablas ordinarias (0 particionadas) en 6 esquemas de negocio; idénticas en PROD y TEST (estructura). Cada ficha se generó de `pg_catalog` en modo solo lectura y se cruzó con `apps/api`, exports n8n (D2) y grants. Volver a [database](../README.md).

| esquema | tabla | propósito | auditada por trigger |
| --- | --- | --- | --- |
| audit | [`audit.cambios`](audit.cambios.md) | Bitácora genérica de cambios `INSERT`/`UPDATE`/`DELETE` de tablas auditadas. | no |
| core | [`core.alias_empresa`](core.alias_empresa.md) | Nombres alternos de una empresa (abreviatura, razón social histórica, nombre de archivo/carpeta…). | sí |
| core | [`core.borradores_notificacion_pago`](core.borradores_notificacion_pago.md) | Borrador de correo (Outlook) reservado por cada par (correo recibido, empresa) para las notificaciones de pago. | no |
| core | [`core.contactos`](core.contactos.md) | Contactos de una empresa: persona, área o buzón genérico. | sí |
| core | [`core.correos_notificacion_pago`](core.correos_notificacion_pago.md) | Registro de correos entrantes de comprobantes de pago procesados (o en proceso) por n8n. | no |
| core | [`core.direcciones`](core.direcciones.md) | Direcciones de una empresa **o** de una empresa fiscal (exactamente una de las dos: `chk_direcciones_propietario_xor`), con tipo, principal y vigencia. | sí |
| core | [`core.documentos`](core.documentos.md) | Documento/archivo origen registrado (ruta Dropbox, tipo, hash). | no |
| core | [`core.empresa_roles`](core.empresa_roles.md) | Roles de negocio de una empresa (`PROVEEDOR`, `SERVICIO`, `FLETE`, `CLIENTE`, `OTRO`); PK compuesta (`empresa_id`, `rol`). | sí |
| core | [`core.empresas`](core.empresas.md) | Maestro de empresas (proveedores, clientes, servicios, fletes). | sí |
| core | [`core.empresas_fiscales`](core.empresas_fiscales.md) | Razones sociales y RFC de una empresa, con vigencia. | sí |
| core | [`core.empresas_notificacion_pago`](core.empresas_notificacion_pago.md) | Configuración por empresa de las notificaciones de pago (`notificaciones_activas`, `procesa_comprobantes_pago`, `ruta_destino`). | no |
| core | [`core.medios_contacto`](core.medios_contacto.md) | Medios de contacto de un contacto (correo, teléfono, WhatsApp, web…). | sí |
| core | [`core.resultados_notificacion_pago`](core.resultados_notificacion_pago.md) | Resultado del procesamiento por (correo, empresa): `LISTO`, `MANUAL`, `ERROR`, `OMITIDO`. | no |
| core | [`core.snapshot_carga_empresas_inicial`](core.snapshot_carga_empresas_inicial.md) | Copia estática de la carga inicial de empresas (mismas 19 columnas que `vw_carga_empresas_inicial`). | no |
| core | [`core.stg_contactos_notificacion_pago`](core.stg_contactos_notificacion_pago.md) | Tabla de aterrizaje de la carga de contactos de notificación (columnas `*_carga`, `email`). | no |
| operacion | [`operacion.ajustes_series`](operacion.ajustes_series.md) | Historial de ajustes manuales de `siguiente_folio` hechos desde el Hub: folio anterior/nuevo, motivo, usuario. | no |
| operacion | [`operacion.remision_detalle`](operacion.remision_detalle.md) | Renglones de una remisión (`codigo_interno`, `part_number`, `descripcion`, `cantidad_texto`). | no |
| operacion | [`operacion.remisiones`](operacion.remisiones.md) | Remisión emitida: serie + folio, cliente, ejecución que la generó, fecha, `pdf_path`, estado (`PENDIENTE`/`GENERADA`/`CANCELADA`). | no |
| operacion | [`operacion.reservas_folios`](operacion.reservas_folios.md) | Rango contiguo de folios `[folio_inicial, folio_final]` reservado por una ejecución en una serie. | no |
| operacion | [`operacion.series_documentales`](operacion.series_documentales.md) | Serie documental: contador de folios (`siguiente_folio`), `estatus`, piso `folio_minimo_ajustable`. | no |
| ops | [`ops.automation_review_acknowledgements`](ops.automation_review_acknowledgements.md) | Acuses de revisión de eventos (errores) de una automatización hechos por un usuario del Hub. | sí |
| ops | [`ops.automation_trigger_requests`](ops.automation_trigger_requests.md) | Registro insert-only de disparos manuales (`RUN`/`REPROCESS`) pedidos desde el Hub hacia n8n, con resultado (`TRIGGERED`/`NOTHING_TO_REPROCESS`/`UPSTREAM_ERROR`). | sí |
| ops | [`ops.automatizacion_series_proceso`](ops.automatizacion_series_proceso.md) | Rutas: (`automatizacion_id`, `llave_proceso`) → serie + empresa cliente, con estado. | no |
| ops | [`ops.automatizaciones`](ops.automatizaciones.md) | Catálogo de automatizaciones (`codigo` en mayúsculas, `estatus`). | no |
| ops | [`ops.ejecuciones_automatizacion`](ops.ejecuciones_automatizacion.md) | Un intento de procesar un documento origen: estado, contadores de reintento, error, `n8n_execution_id`, `reproceso_de_id` (autorreferencia). | no |
| security | [`security.sessions`](security.sessions.md) | Sesiones del Hub: `token_hash` (único), `expires_at`, `revoked_at`. | no |
| security | [`security.users`](security.users.md) | Usuarios del Hub: `display_name`, `email` único (normalizado), `password_hash`, rol `ADMIN`/`GENERAL`, estado, `must_change_password`. | sí |
| staging | [`staging.bind_productos_raw`](staging.bind_productos_raw.md) | Exportación cruda de productos del ERP BIND (código, título, SKU, costos, unidades, categorías…) ligada a una carga (`carga_id`). | no |
| staging | [`staging.cargas_fuente`](staging.cargas_fuente.md) | Cabecera de cada carga de origen (`tipo_fuente`, archivo, fecha de la fuente, observaciones). | no |
| staging | [`staging.manufactura_documentos`](staging.manufactura_documentos.md) | Documentos de manufactura cargados (archivo, hoja, fecha) ligados a una carga. | no |
| staging | [`staging.manufactura_productos_extraidos`](staging.manufactura_productos_extraidos.md) | Productos extraídos de un documento de manufactura (código/título crudos, dimensiones, calibre, peso, fabricante/cliente crudos, `confianza`, `requiere_revision`, `datos_adicionales` JSONB). | no |
