# core.vw_estado_catalogo_empresas

> Vista (propietario `postgres`, sin `security_barrier`/`security_invoker`). Definición obtenida con `pg_get_viewdef()`; no se consultó ningún dato de la vista. Índice: [views](README.md).

## Propósito

Estado de completitud del catálogo por empresa (`COMPLETA`/`PENDIENTE_FISCAL`) con conteos de fiscales, alias y documentos.

## Tablas / vistas fuente

- [`core.alias_empresa`](../tables/core.alias_empresa.md)
- [`core.documentos`](../tables/core.documentos.md)
- [`core.empresas`](../tables/core.empresas.md)
- [`core.empresas_fiscales`](../tables/core.empresas_fiscales.md)
- [`core.empresas_notificacion_pago`](../tables/core.empresas_notificacion_pago.md)

## Columnas

| columna | tipo |
| --- | --- |
| `empresa_id` | `bigint` |
| `tipo_empresa` | `text` |
| `nombre_comercial` | `text` |
| `estatus` | `text` |
| `ruta_dropbox` | `text` |
| `notificaciones_activas` | `boolean` |
| `empresa_fiscal_vigente_id` | `bigint` |
| `razon_social_vigente` | `text` |
| `rfc_vigente` | `character varying(13)` |
| `total_fiscales` | `bigint` |
| `total_alias` | `bigint` |
| `total_documentos` | `bigint` |
| `estado_catalogo` | `text` |
| `observaciones` | `text` |
| `created_at` | `timestamp with time zone` |
| `updated_at` | `timestamp with time zone` |

## Definición (resumen)

5 `JOIN`s · usa LATERAL. Definición completa: `SELECT pg_get_viewdef('core.vw_estado_catalogo_empresas'::regclass, true);` (solo lectura).

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

- Definición: **IDENTICAL** (`sha256` PROD `c1c934a9c46f` · TEST `c1c934a9c46f`).
- Columnas: idénticas.
- Permisos: ver [permissions-matrix](../permissions-matrix.md).
