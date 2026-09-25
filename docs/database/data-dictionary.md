# Diccionario de datos (índice)

Índice de todos los objetos propios. **No duplica** el detalle: cada fila enlaza a su ficha. No hay enums, dominios ni tipos compuestos propios (0 en PROD y TEST); no hay procedimientos, vistas materializadas, tablas foráneas ni particionadas. Volver a [database](README.md).

## Inventario por tipo (idéntico en PROD y TEST)

| tipo | cantidad | detalle |
| --- | --- | --- |
| Tablas ordinarias (`relkind r`) | 31 | [tables/](tables/README.md) |
| Tablas particionadas (`p`) | 0 | — |
| Vistas (`v`) | 10 | [views/](views/README.md) |
| Vistas materializadas (`m`) | 0 | — |
| Tablas foráneas (`f`) | 0 | — |
| Sequences (`S`) | 26 | [sequences](sequences.md) |
| Funciones (`prokind f`) | 13 | [functions/](functions/README.md) |
| Procedimientos (`prokind p`) | 0 | — |
| Triggers (no internos) | 25 | [triggers](triggers.md) |
| Índices | 89 | [indexes](indexes.md) |
| Constraints | 342 | [integrity-rules](integrity-rules.md) |
| Tipos enum / compuestos / dominios propios | 0 | — |
| Extensiones | 1 | `plpgsql` |

## Objetos

| Object | Type | Schema | Purpose | Consumers | Detailed document |
| --- | --- | --- | --- | --- | --- |
| `audit.cambios` | tabla | audit | Bitácora genérica de cambios `INSERT`/`UPDATE`/`DELETE` de tablas auditadas. | Hub (1 archivos) | [ficha](tables/audit.cambios.md) |
| `core.alias_empresa` | tabla | core | Nombres alternos de una empresa (abreviatura, razón social histórica, nombre de archivo/carpeta…). | Hub (5 archivos) | [ficha](tables/core.alias_empresa.md) |
| `core.borradores_notificacion_pago` | tabla | core | Borrador de correo (Outlook) reservado por cada par (correo recibido, empresa) para las notificaciones de pago. | — | [ficha](tables/core.borradores_notificacion_pago.md) |
| `core.contactos` | tabla | core | Contactos de una empresa: persona, área o buzón genérico. | Hub (4 archivos) | [ficha](tables/core.contactos.md) |
| `core.correos_notificacion_pago` | tabla | core | Registro de correos entrantes de comprobantes de pago procesados (o en proceso) por n8n. | Hub (2 archivos) | [ficha](tables/core.correos_notificacion_pago.md) |
| `core.direcciones` | tabla | core | Direcciones de una empresa **o** de una empresa fiscal (exactamente una de las dos: `chk_direcciones_propietario_xor`), con tipo, principal y vigencia. | Hub (1 archivos) | [ficha](tables/core.direcciones.md) |
| `core.documentos` | tabla | core | Documento/archivo origen registrado (ruta Dropbox, tipo, hash). | Hub (2 archivos); n8n Audi/Caterpillar | [ficha](tables/core.documentos.md) |
| `core.empresa_roles` | tabla | core | Roles de negocio de una empresa (`PROVEEDOR`, `SERVICIO`, `FLETE`, `CLIENTE`, `OTRO`); PK compuesta (`empresa_id`, `rol`). | Hub (3 archivos) | [ficha](tables/core.empresa_roles.md) |
| `core.empresas` | tabla | core | Maestro de empresas (proveedores, clientes, servicios, fletes). | Hub (11 archivos); n8n Audi | [ficha](tables/core.empresas.md) |
| `core.empresas_fiscales` | tabla | core | Razones sociales y RFC de una empresa, con vigencia. | Hub (3 archivos) | [ficha](tables/core.empresas_fiscales.md) |
| `core.empresas_notificacion_pago` | tabla | core | Configuración por empresa de las notificaciones de pago (`notificaciones_activas`, `procesa_comprobantes_pago`, `ruta_destino`). | — | [ficha](tables/core.empresas_notificacion_pago.md) |
| `core.medios_contacto` | tabla | core | Medios de contacto de un contacto (correo, teléfono, WhatsApp, web…). | Hub (3 archivos) | [ficha](tables/core.medios_contacto.md) |
| `core.resultados_notificacion_pago` | tabla | core | Resultado del procesamiento por (correo, empresa): `LISTO`, `MANUAL`, `ERROR`, `OMITIDO`. | Hub (2 archivos) | [ficha](tables/core.resultados_notificacion_pago.md) |
| `core.snapshot_carga_empresas_inicial` | tabla | core | Copia estática de la carga inicial de empresas (mismas 19 columnas que `vw_carga_empresas_inicial`). | — | [ficha](tables/core.snapshot_carga_empresas_inicial.md) |
| `core.stg_contactos_notificacion_pago` | tabla | core | Tabla de aterrizaje de la carga de contactos de notificación (columnas `*_carga`, `email`). | — | [ficha](tables/core.stg_contactos_notificacion_pago.md) |
| `operacion.ajustes_series` | tabla | operacion | Historial de ajustes manuales de `siguiente_folio` hechos desde el Hub: folio anterior/nuevo, motivo, usuario. | Hub (2 archivos) | [ficha](tables/operacion.ajustes_series.md) |
| `operacion.remision_detalle` | tabla | operacion | Renglones de una remisión (`codigo_interno`, `part_number`, `descripcion`, `cantidad_texto`). | Hub (1 archivos); n8n Audi | [ficha](tables/operacion.remision_detalle.md) |
| `operacion.remisiones` | tabla | operacion | Remisión emitida: serie + folio, cliente, ejecución que la generó, fecha, `pdf_path`, estado (`PENDIENTE`/`GENERADA`/`CANCELADA`). | Hub (5 archivos); n8n Audi | [ficha](tables/operacion.remisiones.md) |
| `operacion.reservas_folios` | tabla | operacion | Rango contiguo de folios `[folio_inicial, folio_final]` reservado por una ejecución en una serie. | Hub (3 archivos) | [ficha](tables/operacion.reservas_folios.md) |
| `operacion.series_documentales` | tabla | operacion | Serie documental: contador de folios (`siguiente_folio`), `estatus`, piso `folio_minimo_ajustable`. | Hub (7 archivos); n8n Audi | [ficha](tables/operacion.series_documentales.md) |
| `ops.automation_review_acknowledgements` | tabla | ops | Acuses de revisión de eventos (errores) de una automatización hechos por un usuario del Hub. | Hub (1 archivos) | [ficha](tables/ops.automation_review_acknowledgements.md) |
| `ops.automation_trigger_requests` | tabla | ops | Registro insert-only de disparos manuales (`RUN`/`REPROCESS`) pedidos desde el Hub hacia n8n, con resultado (`TRIGGERED`/`NOTHING_TO_REPROCESS`/`UPSTREAM_ERROR`). | Hub (1 archivos) | [ficha](tables/ops.automation_trigger_requests.md) |
| `ops.automatizacion_series_proceso` | tabla | ops | Rutas: (`automatizacion_id`, `llave_proceso`) → serie + empresa cliente, con estado. | Hub (3 archivos) | [ficha](tables/ops.automatizacion_series_proceso.md) |
| `ops.automatizaciones` | tabla | ops | Catálogo de automatizaciones (`codigo` en mayúsculas, `estatus`). | Hub (9 archivos); n8n Audi | [ficha](tables/ops.automatizaciones.md) |
| `ops.ejecuciones_automatizacion` | tabla | ops | Un intento de procesar un documento origen: estado, contadores de reintento, error, `n8n_execution_id`, `reproceso_de_id` (autorreferencia). | Hub (5 archivos); n8n Audi | [ficha](tables/ops.ejecuciones_automatizacion.md) |
| `security.sessions` | tabla | security | Sesiones del Hub: `token_hash` (único), `expires_at`, `revoked_at`. | Hub (2 archivos) | [ficha](tables/security.sessions.md) |
| `security.users` | tabla | security | Usuarios del Hub: `display_name`, `email` único (normalizado), `password_hash`, rol `ADMIN`/`GENERAL`, estado, `must_change_password`. | Hub (5 archivos) | [ficha](tables/security.users.md) |
| `staging.bind_productos_raw` | tabla | staging | Exportación cruda de productos del ERP BIND (código, título, SKU, costos, unidades, categorías…) ligada a una carga (`carga_id`). | — | [ficha](tables/staging.bind_productos_raw.md) |
| `staging.cargas_fuente` | tabla | staging | Cabecera de cada carga de origen (`tipo_fuente`, archivo, fecha de la fuente, observaciones). | — | [ficha](tables/staging.cargas_fuente.md) |
| `staging.manufactura_documentos` | tabla | staging | Documentos de manufactura cargados (archivo, hoja, fecha) ligados a una carga. | — | [ficha](tables/staging.manufactura_documentos.md) |
| `staging.manufactura_productos_extraidos` | tabla | staging | Productos extraídos de un documento de manufactura (código/título crudos, dimensiones, calibre, peso, fabricante/cliente crudos, `confianza`, `requiere_revision`, `datos_adicionales` JSONB). | — | [ficha](tables/staging.manufactura_productos_extraidos.md) |
| `core.vw_carga_empresas_inicial` | vista | core | Reconstruye el paquete de carga inicial de empresas (empresa + fiscal vigente + notificaciones + resumen de documentos y alias) con etiqueta fija `lote_carga = CARGA_INICIAL_XML_BIND_V1`. | Ninguno demostrable (histórico). | [ficha](views/core.vw_carga_empresas_inicial.md) |
| `core.vw_catalogo_nombres_empresa` | vista | core | Catálogo unificado de nombres detectables por empresa: nombre comercial, razones sociales (vigente/histórica) y alias, con bandera `es_vigente`. | Ninguno demostrable en Hub ni en workflows versionados. | [ficha](views/core.vw_catalogo_nombres_empresa.md) |
| `core.vw_catalogo_notificacion_pago_n8n` | vista | core | **Catálogo consumido por n8n** (Notificaciones de pago): una fila por (empresa, alias detectable) con `ruta_destino`, `rfc`, listas de correos `PARA/CC/CCO` y `estado = APROBADO`. | n8n Notificaciones de pago (`Consultar catálogo BD`, según D2; export no versionado). | [ficha](views/core.vw_catalogo_notificacion_pago_n8n.md) |
| `core.vw_contactos_notificacion_pago` | vista | core | Contactos y correos activos autorizados para notificación de pago, solo de empresas activas con `notificaciones_activas`. | Ninguno demostrable. | [ficha](views/core.vw_contactos_notificacion_pago.md) |
| `core.vw_contactos_notificacion_pago_detalle` | vista | core | Detalle (con RFC, razón social vigente y estatus) de los correos de notificación de pago activos. | Ninguno demostrable. | [ficha](views/core.vw_contactos_notificacion_pago_detalle.md) |
| `core.vw_contactos_notificacion_pago_n8n` | vista | core | Por empresa que `procesa_comprobantes_pago`: fiscal vigente, y correos `PARA/CC/CCO` agregados (`;`) con sus conteos. | n8n Notificaciones de pago (según D2 y como dependencia del catálogo). | [ficha](views/core.vw_contactos_notificacion_pago_n8n.md) |
| `core.vw_empresas_con_fiscal_vigente` | vista | core | Todas las empresas con su razón social/RFC vigente (`LEFT JOIN`) y `notificaciones_activas`. | Ninguno demostrable (el Hub consulta tablas directamente). | [ficha](views/core.vw_empresas_con_fiscal_vigente.md) |
| `core.vw_empresas_hub` | vista | core | Vista de empresas para el Hub: fiscal vigente, `roles[]` activos, `es_proveedor`/`es_cliente` (con respaldo en `tipo_empresa` si no hay filas en `empresa_roles`). | **Ninguno demostrable**: el código de `apps/api` no referencia esta vista (consulta `core. | [ficha](views/core.vw_empresas_hub.md) |
| `core.vw_empresas_pendientes_fiscal` | vista | core | Empresas sin razón social vigente (`empresa_fiscal_id IS NULL`), para depuración de catálogo. | Ninguno demostrable. | [ficha](views/core.vw_empresas_pendientes_fiscal.md) |
| `core.vw_estado_catalogo_empresas` | vista | core | Estado de completitud del catálogo por empresa (`COMPLETA`/`PENDIENTE_FISCAL`) con conteos de fiscales, alias y documentos. | Ninguno demostrable. | [ficha](views/core.vw_estado_catalogo_empresas.md) |
| `audit.fn_registrar_cambio` | función (DEFINER) | audit | Trigger genérico de auditoría. | Triggers `trg_audit_*` (ver [triggers](. | [ficha](functions/audit.fn_registrar_cambio.md) |
| `audit.fn_registrar_cambio_security_users` | función (DEFINER) | audit | Variante para `security.users`: excluye `password_hash` de los JSONB, ignora cambios que solo alteran `updated_at`/`last_login_at` y agrega `password_changed: true` cuando cambió el hash. | Trigger `trg_audit_users`. | [ficha](functions/audit.fn_registrar_cambio_security_users.md) |
| `core.fn_actualizar_updated_at` | función (INVOKER) | core | Trigger `BEFORE UPDATE` que fija `NEW.updated_at = NOW()`. | 14 triggers `trg_*_updated_at`. | [ficha](functions/core.fn_actualizar_updated_at.md) |
| `core.fn_crear_o_resolver_documento` | función (DEFINER) | core | Crea un documento origen en `core.documentos` o devuelve el existente (mismo `empresa_id` + ruta normalizada [+ hash]). | n8n Caterpillar (`Resolver documento origen PG`, `Propagar documento origen PG`; PROD y TEST). | [ficha](functions/core.fn_crear_o_resolver_documento.md) |
| `operacion.fn_registrar_remision_generada` | función (DEFINER) | operacion | Persiste una remisión `GENERADA` y sus renglones. | n8n Caterpillar (`Registrar remisión PG`). | [ficha](functions/operacion.fn_registrar_remision_generada.md) |
| `operacion.reservar_folios` | función (INVOKER) | operacion | **Allocator legado (Audi).** Bloquea la serie por código (`FOR UPDATE`), verifica que el rango pedido no choque con remisiones no canceladas y avanza `siguiente_folio`. | n8n Audi (`Reservar folios PostgreSQL`, PROD y TEST). | [ficha](functions/operacion.reservar_folios.md) |
| `operacion.reservar_folios_para_ejecucion` | función (DEFINER) | operacion | Reserva atómica e idempotente de un rango de folios para una ejecución `PROCESANDO`: valida serie existente, ruta ACTIVA de la automatización y serie ACTIVA; inserta `reservas_folios` (`RESERVADA`) y avanza `siguiente_folio`. | n8n Caterpillar (`Reservar folios PG`). | [ficha](functions/operacion.reservar_folios_para_ejecucion.md) |
| `ops.fn_crear_ejecucion_automatizacion` | función (DEFINER) | ops | Crea o recupera la ejecución de un documento. | n8n Caterpillar (`Crear o recuperar ejecución PG`, `Propagar ejecución PG`, `Mapear resultado creación reproceso CAT`, `Validar elegibilidad reproceso CAT`). | [ficha](functions/ops.fn_crear_ejecucion_automatizacion.md) |
| `ops.fn_finalizar_ejecucion_automatizacion` | función (DEFINER) | ops | Cierra una ejecución (`COMPLETADA`/`ERROR`/`CANCELADA`). | n8n Caterpillar (`Finalizar ejecución PG`); invocada internamente por `fn_registrar_fallo_ejecucion`. | [ficha](functions/ops.fn_finalizar_ejecucion_automatizacion.md) |
| `ops.fn_registrar_fallo_ejecucion` | función (DEFINER) | ops | Registra el fallo de un intento de n8n sin doble conteo del mismo `n8n_execution_id`; incrementa `intentos_fallidos`; al agotar `max_intentos` finaliza en `ERROR` llamando a `fn_finalizar_ejecucion_automatizacion` (abandona reservas). | n8n Caterpillar (`Registrar fallo PG`). | [ficha](functions/ops.fn_registrar_fallo_ejecucion.md) |
| `ops.fn_resolver_ejecucion_para_reproceso` | función (DEFINER) | ops | Lectura mínima para el webhook de reproceso: une ejecución ↔ automatización `REMISIONES_CATERPILLAR` ↔ documento origen. | n8n Caterpillar (`Resolver ejecución original PG`, `Validar elegibilidad reproceso CAT`). | [ficha](functions/ops.fn_resolver_ejecucion_para_reproceso.md) |
| `ops.fn_resolver_ruta_automatizacion` | función (DEFINER) | ops | Devuelve la ruta ACTIVA (serie, estatus de serie, cliente y su nombre comercial) para (`codigo`, `llave_proceso`). | **Ningún consumidor demostrable**: ni los workflows exportados ni `apps/api` la llaman (D2: el ruteo de Caterpillar está hardcodeado en el workflow). | [ficha](functions/ops.fn_resolver_ruta_automatizacion.md) |
| `ops.fn_validar_dueno_unico_serie_proceso` | función (INVOKER) | ops | Trigger `BEFORE INSERT/UPDATE OF serie_id, automatizacion_id` en `ops.automatizacion_series_proceso`: impide que una serie quede ruteada bajo dos automatizaciones distintas. | Trigger `trg_automatizacion_series_proceso_dueno_unico`. | [ficha](functions/ops.fn_validar_dueno_unico_serie_proceso.md) |
| 26 sequences | sequence | todos | Generadores de `*_id` (IDENTITY/serial); **no** son series documentales | internos | [sequences](sequences.md) |
| 25 triggers | trigger | core/ops/security | Auditoría, `updated_at` y dueño único de serie | internos | [triggers](triggers.md) |
| 89 índices | índice | todos | Unicidad, idempotencia y consulta | internos | [indexes](indexes.md) |
| 342 constraints | constraint | todos | PK, FK, UNIQUE, CHECK, NOT NULL | internos | [integrity-rules](integrity-rules.md) |
| `plpgsql 1.0` | extensión | — | Única extensión instalada; no hay `pg_cron`, `pgcrypto`, etc. | — | [architecture](architecture.md) |
| 6 roles | rol | clúster | postgres, daubert_hub_app, daubert_hub_test_user, n8n_app, n8n_cat_test, daubert_docs_ro | — | [roles](roles.md) |
