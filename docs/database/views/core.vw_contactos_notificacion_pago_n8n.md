# core.vw_contactos_notificacion_pago_n8n

> Vista (propietario `postgres`, sin `security_barrier`/`security_invoker`). Definición obtenida con `pg_get_viewdef()`; no se consultó ningún dato de la vista. Índice: [views](README.md).

## Propósito

Por empresa que `procesa_comprobantes_pago`: fiscal vigente, y correos `PARA/CC/CCO` agregados (`;`) con sus conteos. Base de `vw_catalogo_notificacion_pago_n8n`.

## Tablas / vistas fuente

- [`core.contactos`](../tables/core.contactos.md)
- [`core.empresas`](../tables/core.empresas.md)
- [`core.empresas_fiscales`](../tables/core.empresas_fiscales.md)
- [`core.empresas_notificacion_pago`](../tables/core.empresas_notificacion_pago.md)
- [`core.medios_contacto`](../tables/core.medios_contacto.md)

Es fuente de: [`core.vw_catalogo_notificacion_pago_n8n`](core.vw_catalogo_notificacion_pago_n8n.md).

## Columnas

| columna | tipo |
| --- | --- |
| `empresa_id` | `bigint` |
| `tipo_empresa` | `text` |
| `nombre_comercial` | `text` |
| `empresa_fiscal_id` | `bigint` |
| `razon_social` | `text` |
| `rfc` | `character varying(13)` |
| `ruta_dropbox` | `text` |
| `procesa_comprobantes_pago` | `boolean` |
| `notificaciones_activas` | `boolean` |
| `correos_para` | `text` |
| `correos_cc` | `text` |
| `correos_cco` | `text` |
| `total_correos_para` | `bigint` |
| `total_correos_cc` | `bigint` |
| `total_correos_cco` | `bigint` |
| `total_correos_notificacion` | `bigint` |

## Definición (resumen)

4 `JOIN`s · usa CTEs, DISTINCT / DISTINCT ON, agregación de texto, GROUP BY. Definición completa: `SELECT pg_get_viewdef('core.vw_contactos_notificacion_pago_n8n'::regclass, true);` (solo lectura).

## Consumidores

n8n Notificaciones de pago (según D2 y como dependencia del catálogo).

## Permisos

`n8n_app` `SELECT` (PROD y TEST).

| Rol | PROD | TEST |
| --- | --- | --- |
| `n8n_app` | R | R |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

> Al ser una vista propiedad de `postgres` **sin** `security_invoker`, se ejecuta con los privilegios del propietario: quien tenga `SELECT` sobre la vista lee las tablas subyacentes a través de ella aunque no tenga `SELECT` directo sobre ellas (es exactamente lo que ocurre con `n8n_app` y las dos vistas `_n8n`).

## TEST vs PROD

- Definición: **IDENTICAL** (`sha256` PROD `d4da4c5b22d3` · TEST `d4da4c5b22d3`).
- Columnas: idénticas.
- Permisos: ver [permissions-matrix](../permissions-matrix.md).
