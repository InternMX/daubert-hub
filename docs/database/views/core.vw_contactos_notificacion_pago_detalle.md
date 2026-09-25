# core.vw_contactos_notificacion_pago_detalle

> Vista (propietario `postgres`, sin `security_barrier`/`security_invoker`). Definición obtenida con `pg_get_viewdef()`; no se consultó ningún dato de la vista. Índice: [views](README.md).

## Propósito

Detalle (con RFC, razón social vigente y estatus) de los correos de notificación de pago activos.

## Tablas / vistas fuente

- [`core.contactos`](../tables/core.contactos.md)
- [`core.empresas`](../tables/core.empresas.md)
- [`core.empresas_fiscales`](../tables/core.empresas_fiscales.md)
- [`core.medios_contacto`](../tables/core.medios_contacto.md)

## Columnas

| columna | tipo |
| --- | --- |
| `empresa_id` | `bigint` |
| `tipo_empresa` | `text` |
| `nombre_comercial` | `text` |
| `empresa_fiscal_id` | `bigint` |
| `razon_social` | `text` |
| `rfc` | `character varying(13)` |
| `contacto_id` | `bigint` |
| `nombre_contacto` | `text` |
| `tipo_contacto` | `text` |
| `area` | `text` |
| `cargo` | `text` |
| `medio_id` | `bigint` |
| `correo` | `text` |
| `tipo_destinatario_pago` | `text` |
| `estatus_empresa` | `text` |
| `estatus_contacto` | `text` |
| `estatus_medio` | `text` |
| `ruta_dropbox` | `text` |

## Definición (resumen)

3 `JOIN`s · usa DISTINCT / DISTINCT ON. Definición completa: `SELECT pg_get_viewdef('core.vw_contactos_notificacion_pago_detalle'::regclass, true);` (solo lectura).

## Consumidores

Ninguno demostrable.

## Permisos

Solo `postgres` (y `daubert_hub_test_user` en TEST).

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

> Al ser una vista propiedad de `postgres` **sin** `security_invoker`, se ejecuta con los privilegios del propietario: quien tenga `SELECT` sobre la vista lee las tablas subyacentes a través de ella aunque no tenga `SELECT` directo sobre ellas (es exactamente lo que ocurre con `n8n_app` y las dos vistas `_n8n`).

## TEST vs PROD

- Definición: **IDENTICAL** (`sha256` PROD `3eff4b803392` · TEST `3eff4b803392`).
- Columnas: idénticas.
- Permisos: ver [permissions-matrix](../permissions-matrix.md).
