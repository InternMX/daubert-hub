# Catálogo de vistas

10 vistas (todas en `core`, ninguna materializada), con definiciones **idénticas** en PROD y TEST. Volver a [database](../README.md).

| vista | propósito | consumidor |
| --- | --- | --- |
| [`core.vw_carga_empresas_inicial`](core.vw_carga_empresas_inicial.md) | Reconstruye el paquete de carga inicial de empresas (empresa + fiscal vigente + notificaciones + resumen de documentos y alias) con etiqueta fija `lote_carga = CARGA_INICIAL_XML_BIND_V1`. | Ninguno demostrable (histórico). |
| [`core.vw_catalogo_nombres_empresa`](core.vw_catalogo_nombres_empresa.md) | Catálogo unificado de nombres detectables por empresa: nombre comercial, razones sociales (vigente/histórica) y alias, con bandera `es_vigente`. | Ninguno demostrable en Hub ni en workflows versionados. |
| [`core.vw_catalogo_notificacion_pago_n8n`](core.vw_catalogo_notificacion_pago_n8n.md) | **Catálogo consumido por n8n** (Notificaciones de pago): una fila por (empresa, alias detectable) con `ruta_destino`, `rfc`, listas de correos `PARA/CC/CCO` y `estado = APROBADO`. | n8n Notificaciones de pago (`Consultar catálogo BD`, según D2; export no versionado). |
| [`core.vw_contactos_notificacion_pago`](core.vw_contactos_notificacion_pago.md) | Contactos y correos activos autorizados para notificación de pago, solo de empresas activas con `notificaciones_activas`. | Ninguno demostrable. |
| [`core.vw_contactos_notificacion_pago_detalle`](core.vw_contactos_notificacion_pago_detalle.md) | Detalle (con RFC, razón social vigente y estatus) de los correos de notificación de pago activos. | Ninguno demostrable. |
| [`core.vw_contactos_notificacion_pago_n8n`](core.vw_contactos_notificacion_pago_n8n.md) | Por empresa que `procesa_comprobantes_pago`: fiscal vigente, y correos `PARA/CC/CCO` agregados (`;`) con sus conteos. | n8n Notificaciones de pago (según D2 y como dependencia del catálogo). |
| [`core.vw_empresas_con_fiscal_vigente`](core.vw_empresas_con_fiscal_vigente.md) | Todas las empresas con su razón social/RFC vigente (`LEFT JOIN`) y `notificaciones_activas`. | Ninguno demostrable (el Hub consulta tablas directamente). |
| [`core.vw_empresas_hub`](core.vw_empresas_hub.md) | Vista de empresas para el Hub: fiscal vigente, `roles[]` activos, `es_proveedor`/`es_cliente` (con respaldo en `tipo_empresa` si no hay filas en `empresa_roles`). | **Ninguno demostrable**: el código de `apps/api` no referencia esta vista (consulta `core. |
| [`core.vw_empresas_pendientes_fiscal`](core.vw_empresas_pendientes_fiscal.md) | Empresas sin razón social vigente (`empresa_fiscal_id IS NULL`), para depuración de catálogo. | Ninguno demostrable. |
| [`core.vw_estado_catalogo_empresas`](core.vw_estado_catalogo_empresas.md) | Estado de completitud del catálogo por empresa (`COMPLETA`/`PENDIENTE_FISCAL`) con conteos de fiscales, alias y documentos. | Ninguno demostrable. |

Definiciones hash-comparadas: [test-prod-drift](../test-prod-drift.md#vistas).
