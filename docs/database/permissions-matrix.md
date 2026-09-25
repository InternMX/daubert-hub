# Matriz de permisos

Fuente: `has_table_privilege`, `has_function_privilege`, `has_schema_privilege`, `has_database_privilege`, `has_sequence_privilege`, `pg_class.relacl`, `pg_proc.proacl` en PROD y TEST (solo lectura, 2026-09-24). Solo se listan los roles del proyecto; `postgres` (superusuario, propietario de todo) se omite. **No** se consultaron hashes de contraseña. Volver a [database](README.md).

Leyenda: **R**=SELECT · **I**=INSERT · **U**=UPDATE · **D**=DELETE · **X**=EXECUTE · `USAGE` · **-**=sin privilegio. TRUNCATE/REFERENCES/TRIGGER: ningún rol de aplicación los tiene.

> Los roles son objetos del clúster (existen los mismos seis en ambas bases); lo que cambia es qué privilegios se otorgaron en cada base. Rol de runtime del Hub: `daubert_hub_app` (PROD) / `daubert_hub_test_user` (TEST). n8n: `n8n_app` (PROD; TEST para Audi/Notificaciones, INFERRED) y `n8n_cat_test` (TEST, Caterpillar).

## PROD (`daubert_global`) — tablas y vistas

| Object | daubert_hub_app | n8n_app | n8n_cat_test | daubert_hub_test_user | daubert_docs_ro | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `audit.cambios` | R | - | - | - | - | Escritura solo vía triggers `SECURITY DEFINER`. En TEST el usuario del Hub puede `DELETE/UPDATE`. |
| `core.alias_empresa` | RID | - | - | - | - |  |
| `core.borradores_notificacion_pago` | - | RIU | - | - | - |  |
| `core.contactos` | RIU | - | - | - | - |  |
| `core.correos_notificacion_pago` | R | RIU | - | - | - |  |
| `core.direcciones` | - | - | - | - | - | El Hub la usa (`addresses`), pero PROD no concede nada a `daubert_hub_app`. TEST sí. |
| `core.documentos` | R | RI | - | - | - | n8n `INSERT` directo (Audi) y vía función (Caterpillar). |
| `core.empresa_roles` | RIU | - | - | - | - |  |
| `core.empresas` | RIU | R | - | - | - | n8n lee la tabla completa (RFC no está aquí; está en `empresas_fiscales`). |
| `core.empresas_fiscales` | RIU | - | - | - | - |  |
| `core.empresas_notificacion_pago` | - | - | - | - | - | Solo a través de vistas. |
| `core.medios_contacto` | RIU | - | - | - | - |  |
| `core.resultados_notificacion_pago` | R | RIU | - | - | - |  |
| `core.snapshot_carga_empresas_inicial` | - | - | - | - | - |  |
| `core.stg_contactos_notificacion_pago` | - | - | - | - | - |  |
| `operacion.ajustes_series` | RI | - | - | - | - |  |
| `operacion.remision_detalle` | R | RI | - | - | - |  |
| `operacion.remisiones` | R | RIU | - | - | - | n8n `UPDATE` sin uso en workflows exportados. |
| `operacion.reservas_folios` | R | - | - | - | - |  |
| `operacion.series_documentales` | RU | RU | - | - | - | `UPDATE` en Hub (ajuste de folio) y n8n (allocator legado Audi). |
| `ops.automation_review_acknowledgements` | RI | - | - | - | - |  |
| `ops.automation_trigger_requests` | I | - | - | - | - | Hub solo `INSERT` (sin `SELECT`). |
| `ops.automatizacion_series_proceso` | R | - | - | - | - |  |
| `ops.automatizaciones` | R | R | - | - | - |  |
| `ops.ejecuciones_automatizacion` | R | RIU | - | - | - | n8n `INSERT/UPDATE` directo (Audi); Caterpillar usa funciones. |
| `security.sessions` | RIU | - | - | - | - | Solo Hub. |
| `security.users` | RIU | - | - | - | - | Solo Hub. |
| `staging.bind_productos_raw` | - | - | - | - | - |  |
| `staging.cargas_fuente` | - | - | - | - | - |  |
| `staging.manufactura_documentos` | - | - | - | - | - |  |
| `staging.manufactura_productos_extraidos` | - | - | - | - | - |  |
| `core.vw_carga_empresas_inicial` | - | - | - | - | - |  |
| `core.vw_catalogo_nombres_empresa` | - | - | - | - | - |  |
| `core.vw_catalogo_notificacion_pago_n8n` | - | R | - | - | - | Único acceso de n8n al catálogo (expone RFC y correos). |
| `core.vw_contactos_notificacion_pago` | - | - | - | - | - |  |
| `core.vw_contactos_notificacion_pago_detalle` | - | - | - | - | - |  |
| `core.vw_contactos_notificacion_pago_n8n` | - | R | - | - | - | Expone correos y RFC a `n8n_app` sin `SELECT` en las tablas base. |
| `core.vw_empresas_con_fiscal_vigente` | - | - | - | - | - |  |
| `core.vw_empresas_hub` | - | - | - | - | - |  |
| `core.vw_empresas_pendientes_fiscal` | - | - | - | - | - |  |
| `core.vw_estado_catalogo_empresas` | - | - | - | - | - |  |

## TEST (`daubert_hub_test`) — tablas y vistas

| Object | daubert_hub_app | n8n_app | n8n_cat_test | daubert_hub_test_user | daubert_docs_ro | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `audit.cambios` | - | - | - | RIUD | - | Escritura solo vía triggers `SECURITY DEFINER`. En TEST el usuario del Hub puede `DELETE/UPDATE`. |
| `core.alias_empresa` | - | - | - | RIUD | - |  |
| `core.borradores_notificacion_pago` | - | RIU | - | RIUD | - |  |
| `core.contactos` | - | - | - | RIUD | - |  |
| `core.correos_notificacion_pago` | - | RIU | - | RIUD | - |  |
| `core.direcciones` | - | - | - | RIUD | - | El Hub la usa (`addresses`), pero PROD no concede nada a `daubert_hub_app`. TEST sí. |
| `core.documentos` | - | RI | - | RIUD | - | n8n `INSERT` directo (Audi) y vía función (Caterpillar). |
| `core.empresa_roles` | - | - | - | RIUD | - |  |
| `core.empresas` | - | R | - | RIUD | - | n8n lee la tabla completa (RFC no está aquí; está en `empresas_fiscales`). |
| `core.empresas_fiscales` | - | - | - | RIUD | - |  |
| `core.empresas_notificacion_pago` | - | - | - | RIUD | - | Solo a través de vistas. |
| `core.medios_contacto` | - | - | - | RIUD | - |  |
| `core.resultados_notificacion_pago` | - | RIU | - | RIUD | - |  |
| `core.snapshot_carga_empresas_inicial` | - | - | - | RIUD | - |  |
| `core.stg_contactos_notificacion_pago` | - | - | - | RIUD | - |  |
| `operacion.ajustes_series` | - | - | - | RID | - |  |
| `operacion.remision_detalle` | - | RI | - | - | - |  |
| `operacion.remisiones` | - | RIU | - | R | - | n8n `UPDATE` sin uso en workflows exportados. |
| `operacion.reservas_folios` | - | - | - | R | - |  |
| `operacion.series_documentales` | - | RU | - | RIUD | - | `UPDATE` en Hub (ajuste de folio) y n8n (allocator legado Audi). |
| `ops.automation_review_acknowledgements` | - | - | - | RI | - |  |
| `ops.automation_trigger_requests` | - | - | - | I | - | Hub solo `INSERT` (sin `SELECT`). |
| `ops.automatizacion_series_proceso` | - | - | - | RID | - |  |
| `ops.automatizaciones` | - | R | - | RID | - |  |
| `ops.ejecuciones_automatizacion` | - | RIU | - | R | - | n8n `INSERT/UPDATE` directo (Audi); Caterpillar usa funciones. |
| `security.sessions` | - | - | - | RIU | - | Solo Hub. |
| `security.users` | - | - | - | RIU | - | Solo Hub. |
| `staging.bind_productos_raw` | - | - | - | - | - |  |
| `staging.cargas_fuente` | - | - | - | - | - |  |
| `staging.manufactura_documentos` | - | - | - | - | - |  |
| `staging.manufactura_productos_extraidos` | - | - | - | - | - |  |
| `core.vw_carga_empresas_inicial` | - | - | - | RIUD | - |  |
| `core.vw_catalogo_nombres_empresa` | - | - | - | RIUD | - |  |
| `core.vw_catalogo_notificacion_pago_n8n` | - | R | - | RIUD | - | Único acceso de n8n al catálogo (expone RFC y correos). |
| `core.vw_contactos_notificacion_pago` | - | - | - | RIUD | - |  |
| `core.vw_contactos_notificacion_pago_detalle` | - | - | - | RIUD | - |  |
| `core.vw_contactos_notificacion_pago_n8n` | - | R | - | RIUD | - | Expone correos y RFC a `n8n_app` sin `SELECT` en las tablas base. |
| `core.vw_empresas_con_fiscal_vigente` | - | - | - | RIUD | - |  |
| `core.vw_empresas_hub` | - | - | - | RIUD | - |  |
| `core.vw_empresas_pendientes_fiscal` | - | - | - | RIUD | - |  |
| `core.vw_estado_catalogo_empresas` | - | - | - | RIUD | - |  |

## Funciones (`EXECUTE`) — PROD

| Function | seguridad | daubert_hub_app | n8n_app | n8n_cat_test | daubert_hub_test_user | daubert_docs_ro | PUBLIC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `audit.fn_registrar_cambio()` | DEFINER | X | X | X | X | X | PUBLIC (por defecto) |
| `audit.fn_registrar_cambio_security_users()` | DEFINER | X | X | X | X | X | PUBLIC (por defecto) |
| `core.fn_actualizar_updated_at()` | INVOKER | X | X | X | X | X | PUBLIC (por defecto) |
| `core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)` | DEFINER | - | X | - | - | - | REVOCADO a PUBLIC |
| `operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)` | DEFINER | - | X | - | - | - | REVOCADO a PUBLIC |
| `operacion.reservar_folios(text,integer)` | INVOKER | - | X | - | - | - | REVOCADO a PUBLIC |
| `operacion.reservar_folios_para_ejecucion(bigint,text,integer)` | DEFINER | - | X | - | - | - | REVOCADO a PUBLIC |
| `ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)` | DEFINER | - | X | - | - | - | REVOCADO a PUBLIC |
| `ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)` | DEFINER | - | X | - | - | - | REVOCADO a PUBLIC |
| `ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)` | DEFINER | - | X | - | - | - | REVOCADO a PUBLIC |
| `ops.fn_resolver_ejecucion_para_reproceso(bigint)` | DEFINER | - | X | - | - | - | REVOCADO a PUBLIC |
| `ops.fn_resolver_ruta_automatizacion(text,text)` | DEFINER | - | X | - | - | - | REVOCADO a PUBLIC |
| `ops.fn_validar_dueno_unico_serie_proceso()` | INVOKER | X | X | X | X | X | PUBLIC (por defecto) |

## Funciones (`EXECUTE`) — TEST

| Function | seguridad | daubert_hub_app | n8n_app | n8n_cat_test | daubert_hub_test_user | daubert_docs_ro | PUBLIC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `audit.fn_registrar_cambio()` | DEFINER | X | X | X | X | X | PUBLIC (por defecto) |
| `audit.fn_registrar_cambio_security_users()` | DEFINER | X | X | X | X | X | PUBLIC (por defecto) |
| `core.fn_actualizar_updated_at()` | INVOKER | X | X | X | X | X | PUBLIC (por defecto) |
| `core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)` | DEFINER | - | - | X | - | - | REVOCADO a PUBLIC |
| `operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)` | DEFINER | - | - | X | - | - | REVOCADO a PUBLIC |
| `operacion.reservar_folios(text,integer)` | INVOKER | - | X | - | - | - | REVOCADO a PUBLIC |
| `operacion.reservar_folios_para_ejecucion(bigint,text,integer)` | DEFINER | - | - | X | - | - | REVOCADO a PUBLIC |
| `ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)` | DEFINER | - | - | X | - | - | REVOCADO a PUBLIC |
| `ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)` | DEFINER | - | - | X | - | - | REVOCADO a PUBLIC |
| `ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)` | DEFINER | - | - | X | - | - | REVOCADO a PUBLIC |
| `ops.fn_resolver_ejecucion_para_reproceso(bigint)` | DEFINER | - | - | X | - | - | REVOCADO a PUBLIC |
| `ops.fn_resolver_ruta_automatizacion(text,text)` | DEFINER | - | - | X | - | - | REVOCADO a PUBLIC |
| `ops.fn_validar_dueno_unico_serie_proceso()` | INVOKER | X | X | X | X | X | PUBLIC (por defecto) |

## Schemas (`USAGE`)

| schema | daubert_hub_app | n8n_app | n8n_cat_test | daubert_hub_test_user | daubert_docs_ro |
| --- | --- | --- | --- | --- | --- |
| audit | P:U T:- | P:- T:- | P:- T:- | P:- T:U | P:U T:U |
| core | P:U T:- | P:U T:U | P:- T:U | P:- T:U | P:U T:U |
| operacion | P:U T:- | P:U T:U | P:- T:U | P:- T:U | P:U T:U |
| ops | P:U T:- | P:U T:U | P:- T:U | P:- T:U | P:U T:U |
| security | P:U T:- | P:- T:- | P:- T:- | P:- T:U | P:U T:U |
| staging | P:- T:- | P:- T:- | P:- T:- | P:- T:- | P:U T:U |
| public | P:U T:U | P:U T:U | P:U T:U | P:U T:U | P:U T:U |

`P` = PROD, `T` = TEST, `U` = USAGE. Nadie salvo `postgres` (y `pg_database_owner` en `public`) tiene `CREATE` en ningún schema.

## Base de datos (`CONNECT`/`TEMPORARY`)

El ACL de ambas bases contiene `=Tc/postgres`: **`PUBLIC` tiene `CONNECT` y `TEMPORARY`**. Por eso los seis roles pueden conectarse a PROD y a TEST y crear tablas temporales. `daubert_docs_ro` además tiene `CONNECT` explícito en ambas y `daubert_hub_test_user` en TEST. Ver [roles](roles.md).

## Sequences

Las 22 sequences de columnas `IDENTITY` no requieren privilegio de sequence para insertar; los grants existentes son vestigiales. Resumen de PROD (solo lo que difiere de "nadie"):

| sequence | PROD |
| --- | --- |
| `core.alias_empresa_alias_id_seq` | daubert_hub_app: USAGE |
| `core.contactos_contacto_id_seq` | daubert_hub_app: USAGE |
| `core.correos_notificacion_pago_correo_id_seq` | n8n_app: SELECT,USAGE |
| `core.documentos_documento_id_seq` | n8n_app: USAGE |
| `core.empresas_empresa_id_seq` | daubert_hub_app: USAGE |
| `core.empresas_fiscales_empresa_fiscal_id_seq` | daubert_hub_app: USAGE |
| `core.medios_contacto_medio_id_seq` | daubert_hub_app: USAGE |
| `operacion.ajustes_series_ajuste_id_seq` | daubert_hub_app: USAGE |
| `operacion.remision_detalle_detalle_id_seq` | n8n_app: USAGE |
| `operacion.remisiones_remision_id_seq` | n8n_app: USAGE |
| `ops.automation_review_acknowledgements_acknowledgement_id_seq` | daubert_hub_app: USAGE |
| `ops.automation_trigger_requests_trigger_request_id_seq` | daubert_hub_app: USAGE |
| `ops.ejecuciones_automatizacion_ejecucion_id_seq` | n8n_app: USAGE |
| `security.sessions_session_id_seq` | daubert_hub_app: USAGE |
| `security.users_user_id_seq` | daubert_hub_app: USAGE |

TEST: los grants de sequences pertenecen sobre todo a `daubert_hub_test_user` (`SELECT, USAGE`) y a `n8n_app`; detalle por `has_sequence_privilege` en la base. Las sequences de `staging` (serial) no tienen grants para nadie.

## Default privileges

`pg_default_acl` está **vacío** en PROD y TEST: los objetos nuevos no otorgan nada automáticamente; cada migración debe hacer sus `GRANT`.

## `daubert_docs_ro`

Sin `SELECT` en ninguna tabla ni vista de negocio, sin `EXECUTE` en funciones de negocio (solo el `EXECUTE` por defecto de `PUBLIC` sobre las 4 funciones trigger), `USAGE` en los 7 schemas, ajustes de rol `default_transaction_read_only=on`, `statement_timeout=30s`, `lock_timeout=5s`. Es deliberado (D3): por eso `pg_dump` no funciona con este rol ([schema-snapshots](schema-snapshots.md)).
