# Sequences

Fuente: `pg_sequence`, `pg_depend`. **26 sequences** en PROD y TEST, todas `bigint`, incremento 1, sin `CYCLE`, **todas ligadas a una columna** (22 `IDENTITY`, 4 `serial` de `staging`). No se leyó `last_value`. Volver a [database](README.md).

## PostgreSQL SEQUENCE ≠ serie documental de negocio

| | PostgreSQL SEQUENCE | Serie documental |
| --- | --- | --- |
| Qué es | Generador de identificadores técnicos (`*_id`) | Contador de **folios** de negocio (`operacion.series_documentales.siguiente_folio`) |
| Dónde | `pg_class` relkind `S` | Fila de tabla |
| Huecos | Sí (rollbacks, reintentos) | Los folios reservados y abandonados **no se reciclan** ([folios](folios.md)) |
| Quién la mueve | `INSERT` (automático) | `reservar_folios*` y el ajuste manual del Hub |
| Relación | Ninguna: la serie documental **no** usa una sequence de PostgreSQL para el folio | |

## Inventario

| sequence | tipo | inicio / incremento | ligada a | dependencia | grants PROD |
| --- | --- | --- | --- | --- | --- |
| `audit.cambios_cambio_id_seq` | bigint | 1 / +1 | `audit.cambios.cambio_id` | IDENTITY | — |
| `core.alias_empresa_alias_id_seq` | bigint | 1 / +1 | `core.alias_empresa.alias_id` | IDENTITY | daubert_hub_app: USAGE |
| `core.borradores_notificacion_pago_borrador_id_seq` | bigint | 1 / +1 | `core.borradores_notificacion_pago.borrador_id` | IDENTITY | — |
| `core.contactos_contacto_id_seq` | bigint | 1 / +1 | `core.contactos.contacto_id` | IDENTITY | daubert_hub_app: USAGE |
| `core.correos_notificacion_pago_correo_id_seq` | bigint | 1 / +1 | `core.correos_notificacion_pago.correo_id` | IDENTITY | n8n_app: SELECT,USAGE |
| `core.direcciones_direccion_id_seq` | bigint | 1 / +1 | `core.direcciones.direccion_id` | IDENTITY | — |
| `core.documentos_documento_id_seq` | bigint | 1 / +1 | `core.documentos.documento_id` | IDENTITY | n8n_app: USAGE |
| `core.empresas_empresa_id_seq` | bigint | 1 / +1 | `core.empresas.empresa_id` | IDENTITY | daubert_hub_app: USAGE |
| `core.empresas_fiscales_empresa_fiscal_id_seq` | bigint | 1 / +1 | `core.empresas_fiscales.empresa_fiscal_id` | IDENTITY | daubert_hub_app: USAGE |
| `core.medios_contacto_medio_id_seq` | bigint | 1 / +1 | `core.medios_contacto.medio_id` | IDENTITY | daubert_hub_app: USAGE |
| `operacion.ajustes_series_ajuste_id_seq` | bigint | 1 / +1 | `operacion.ajustes_series.ajuste_id` | IDENTITY | daubert_hub_app: USAGE |
| `operacion.remision_detalle_detalle_id_seq` | bigint | 1 / +1 | `operacion.remision_detalle.detalle_id` | IDENTITY | n8n_app: USAGE |
| `operacion.remisiones_remision_id_seq` | bigint | 1 / +1 | `operacion.remisiones.remision_id` | IDENTITY | n8n_app: USAGE |
| `operacion.reservas_folios_reserva_id_seq` | bigint | 1 / +1 | `operacion.reservas_folios.reserva_id` | IDENTITY | — |
| `operacion.series_documentales_serie_id_seq` | bigint | 1 / +1 | `operacion.series_documentales.serie_id` | IDENTITY | — |
| `ops.automation_review_acknowledgements_acknowledgement_id_seq` | bigint | 1 / +1 | `ops.automation_review_acknowledgements.acknowledgement_id` | IDENTITY | daubert_hub_app: USAGE |
| `ops.automation_trigger_requests_trigger_request_id_seq` | bigint | 1 / +1 | `ops.automation_trigger_requests.trigger_request_id` | IDENTITY | daubert_hub_app: USAGE |
| `ops.automatizacion_series_proceso_ruta_id_seq` | bigint | 1 / +1 | `ops.automatizacion_series_proceso.ruta_id` | IDENTITY | — |
| `ops.automatizaciones_automatizacion_id_seq` | bigint | 1 / +1 | `ops.automatizaciones.automatizacion_id` | IDENTITY | — |
| `ops.ejecuciones_automatizacion_ejecucion_id_seq` | bigint | 1 / +1 | `ops.ejecuciones_automatizacion.ejecucion_id` | IDENTITY | n8n_app: USAGE |
| `security.sessions_session_id_seq` | bigint | 1 / +1 | `security.sessions.session_id` | IDENTITY | daubert_hub_app: USAGE |
| `security.users_user_id_seq` | bigint | 1 / +1 | `security.users.user_id` | IDENTITY | daubert_hub_app: USAGE |
| `staging.bind_productos_raw_registro_id_seq` | bigint | 1 / +1 | `staging.bind_productos_raw.registro_id` | serial (owned by) | — |
| `staging.cargas_fuente_carga_id_seq` | bigint | 1 / +1 | `staging.cargas_fuente.carga_id` | serial (owned by) | — |
| `staging.manufactura_documentos_documento_id_seq` | bigint | 1 / +1 | `staging.manufactura_documentos.documento_id` | serial (owned by) | — |
| `staging.manufactura_productos_extraidos_extraccion_id_seq` | bigint | 1 / +1 | `staging.manufactura_productos_extraidos.extraccion_id` | serial (owned by) | — |

Las sequences `IDENTITY` pertenecen internamente a su columna (`deptype = i`): no se pueden borrar ni tocar sin alterar la columna. Las de `staging` son `serial` (`deptype = a`).
