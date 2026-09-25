# Schema `core`

> Fuente: `pg_namespace`, `pg_class`, `pg_proc`, `pg_constraint` (PROD y TEST). Propietario del esquema: `postgres`. Índice: [schemas](README.md).

## Propósito

Datos maestros: empresas (proveedores/clientes/servicios/fletes), razones sociales y RFC, alias, contactos y medios de contacto, direcciones, documentos origen y el modelo de notificaciones de pago. Incluye 10 vistas.

## Tablas (14)

- [`core.alias_empresa`](../tables/core.alias_empresa.md) — Nombres alternos de una empresa (abreviatura, razón social histórica, nombre de archivo/carpeta…).
- [`core.borradores_notificacion_pago`](../tables/core.borradores_notificacion_pago.md) — Borrador de correo (Outlook) reservado por cada par (correo recibido, empresa) para las notificaciones de pago.
- [`core.contactos`](../tables/core.contactos.md) — Contactos de una empresa: persona, área o buzón genérico.
- [`core.correos_notificacion_pago`](../tables/core.correos_notificacion_pago.md) — Registro de correos entrantes de comprobantes de pago procesados (o en proceso) por n8n.
- [`core.direcciones`](../tables/core.direcciones.md) — Direcciones de una empresa **o** de una empresa fiscal (exactamente una de las dos: `chk_direcciones_propietario_xor`), con tipo, principal y vigencia.
- [`core.documentos`](../tables/core.documentos.md) — Documento/archivo origen registrado (ruta Dropbox, tipo, hash).
- [`core.empresa_roles`](../tables/core.empresa_roles.md) — Roles de negocio de una empresa (`PROVEEDOR`, `SERVICIO`, `FLETE`, `CLIENTE`, `OTRO`); PK compuesta (`empresa_id`, `rol`).
- [`core.empresas`](../tables/core.empresas.md) — Maestro de empresas (proveedores, clientes, servicios, fletes).
- [`core.empresas_fiscales`](../tables/core.empresas_fiscales.md) — Razones sociales y RFC de una empresa, con vigencia.
- [`core.empresas_notificacion_pago`](../tables/core.empresas_notificacion_pago.md) — Configuración por empresa de las notificaciones de pago (`notificaciones_activas`, `procesa_comprobantes_pago`, `ruta_destino`).
- [`core.medios_contacto`](../tables/core.medios_contacto.md) — Medios de contacto de un contacto (correo, teléfono, WhatsApp, web…).
- [`core.resultados_notificacion_pago`](../tables/core.resultados_notificacion_pago.md) — Resultado del procesamiento por (correo, empresa): `LISTO`, `MANUAL`, `ERROR`, `OMITIDO`.
- [`core.snapshot_carga_empresas_inicial`](../tables/core.snapshot_carga_empresas_inicial.md) — Copia estática de la carga inicial de empresas (mismas 19 columnas que `vw_carga_empresas_inicial`).
- [`core.stg_contactos_notificacion_pago`](../tables/core.stg_contactos_notificacion_pago.md) — Tabla de aterrizaje de la carga de contactos de notificación (columnas `*_carga`, `email`).

## Vistas (10)

- [`core.vw_carga_empresas_inicial`](../views/core.vw_carga_empresas_inicial.md)
- [`core.vw_catalogo_nombres_empresa`](../views/core.vw_catalogo_nombres_empresa.md)
- [`core.vw_catalogo_notificacion_pago_n8n`](../views/core.vw_catalogo_notificacion_pago_n8n.md)
- [`core.vw_contactos_notificacion_pago`](../views/core.vw_contactos_notificacion_pago.md)
- [`core.vw_contactos_notificacion_pago_detalle`](../views/core.vw_contactos_notificacion_pago_detalle.md)
- [`core.vw_contactos_notificacion_pago_n8n`](../views/core.vw_contactos_notificacion_pago_n8n.md)
- [`core.vw_empresas_con_fiscal_vigente`](../views/core.vw_empresas_con_fiscal_vigente.md)
- [`core.vw_empresas_hub`](../views/core.vw_empresas_hub.md)
- [`core.vw_empresas_pendientes_fiscal`](../views/core.vw_empresas_pendientes_fiscal.md)
- [`core.vw_estado_catalogo_empresas`](../views/core.vw_estado_catalogo_empresas.md)

## Funciones (2)

- [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md) — INVOKER
- [`core.fn_crear_o_resolver_documento`](../functions/core.fn_crear_o_resolver_documento.md) — SECURITY DEFINER

## Sequences (9)

Todas son sequences de PostgreSQL ligadas a columnas (identity o serial); no son series documentales. Ver [sequences](../sequences.md).

## Relaciones

Sin FK hacia otros esquemas.

Referenciado por FK desde: `operacion.remisiones`, `ops.automatizacion_series_proceso`, `ops.ejecuciones_automatizacion`.

Diagramas: [relationships](../relationships.md).

## Consumidores

Hub (directorio de empresas, contactos, alias, direcciones, actividad reciente, estado de notificaciones); n8n `n8n_app` (Audi: `core.documentos`, `core.empresas`; Notificaciones de pago: correos/borradores/resultados y 2 vistas; Caterpillar: solo la función `core.fn_crear_o_resolver_documento`).

## Automatizaciones

Audi, Caterpillar, Notificaciones de pago.

## Roles y permisos (`USAGE` de esquema)

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | USAGE | - |
| `n8n_app` | USAGE | USAGE |
| `n8n_cat_test` | - | USAGE |
| `daubert_hub_test_user` | - | USAGE |
| `daubert_docs_ro` | USAGE | USAGE |

Ningún rol de aplicación tiene `CREATE` en el esquema. No hay privilegios por defecto (`pg_default_acl` vacío): los objetos nuevos **no** heredan grants. Detalle: [roles](../roles.md), [permissions-matrix](../permissions-matrix.md).

## Riesgos

- `core.empresas` y `core.empresas_fiscales` contienen RFC y razón social; `n8n_app` puede leer `core.empresas` completa.
- Tres objetos de carga inicial sin PK/FK (`snapshot_carga_empresas_inicial`, `stg_contactos_notificacion_pago`, `vw_carga_empresas_inicial`) siguen en el esquema productivo.
- `core.direcciones`: el código del Hub la usa pero `daubert_hub_app` **no tiene grants** en PROD (ver [hub-contract](../hub-contract.md#brechas-detectadas)).

## TEST vs PROD

- Objetos (tablas, vistas, funciones, índices, triggers, sequences): **mismos nombres y estructura** en ambas bases. Diferencias: [test-prod-drift](../test-prod-drift.md).
