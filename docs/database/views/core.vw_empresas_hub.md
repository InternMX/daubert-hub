# core.vw_empresas_hub

> Vista (propietario `postgres`, sin `security_barrier`/`security_invoker`). Definición obtenida con `pg_get_viewdef()`; no se consultó ningún dato de la vista. Índice: [views](README.md).

## Propósito

Vista de empresas para el Hub: fiscal vigente, `roles[]` activos, `es_proveedor`/`es_cliente` (con respaldo en `tipo_empresa` si no hay filas en `empresa_roles`).

## Tablas / vistas fuente

- [`core.empresa_roles`](../tables/core.empresa_roles.md)
- [`core.empresas`](../tables/core.empresas.md)
- [`core.empresas_fiscales`](../tables/core.empresas_fiscales.md)

## Columnas

| columna | tipo |
| --- | --- |
| `empresa_id` | `bigint` |
| `tipo_empresa_compatibilidad` | `text` |
| `nombre_comercial` | `text` |
| `empresa_fiscal_id` | `bigint` |
| `razon_social_vigente` | `text` |
| `rfc_vigente` | `character varying(13)` |
| `estatus` | `text` |
| `ruta_dropbox` | `text` |
| `observaciones` | `text` |
| `roles` | `text[]` |
| `es_proveedor` | `boolean` |
| `es_cliente` | `boolean` |
| `created_at` | `timestamp with time zone` |
| `updated_at` | `timestamp with time zone` |

## Definición (resumen)

2 `JOIN`s · usa CTEs, DISTINCT / DISTINCT ON, GROUP BY. Definición completa: `SELECT pg_get_viewdef('core.vw_empresas_hub'::regclass, true);` (solo lectura).

## Consumidores

**Ninguno demostrable**: el código de `apps/api` no referencia esta vista (consulta `core.empresas`/`empresa_roles` directamente) y `daubert_hub_app` no tiene `SELECT` sobre ella en PROD.

## Permisos

Solo `postgres` (y `daubert_hub_test_user` en TEST).

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

> Al ser una vista propiedad de `postgres` **sin** `security_invoker`, se ejecuta con los privilegios del propietario: quien tenga `SELECT` sobre la vista lee las tablas subyacentes a través de ella aunque no tenga `SELECT` directo sobre ellas (es exactamente lo que ocurre con `n8n_app` y las dos vistas `_n8n`).

## TEST vs PROD

- Definición: **IDENTICAL** (`sha256` PROD `618267e50d5b` · TEST `618267e50d5b`).
- Columnas: idénticas.
- Permisos: ver [permissions-matrix](../permissions-matrix.md).
