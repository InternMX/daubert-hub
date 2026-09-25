# core.vw_empresas_pendientes_fiscal

> Vista (propietario `postgres`, sin `security_barrier`/`security_invoker`). Definición obtenida con `pg_get_viewdef()`; no se consultó ningún dato de la vista. Índice: [views](README.md).

## Propósito

Empresas sin razón social vigente (`empresa_fiscal_id IS NULL`), para depuración de catálogo.

## Tablas / vistas fuente

- [`core.empresas`](../tables/core.empresas.md)
- [`core.empresas_fiscales`](../tables/core.empresas_fiscales.md)
- [`core.empresas_notificacion_pago`](../tables/core.empresas_notificacion_pago.md)

## Columnas

| columna | tipo |
| --- | --- |
| `empresa_id` | `bigint` |
| `tipo_empresa` | `text` |
| `nombre_comercial` | `text` |
| `ruta_dropbox` | `text` |
| `estatus` | `text` |
| `notificaciones_activas` | `boolean` |
| `observaciones` | `text` |
| `created_at` | `timestamp with time zone` |
| `updated_at` | `timestamp with time zone` |

## Definición (resumen)

2 `JOIN`s. Definición completa: `SELECT pg_get_viewdef('core.vw_empresas_pendientes_fiscal'::regclass, true);` (solo lectura).

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

- Definición: **IDENTICAL** (`sha256` PROD `d89a323d514e` · TEST `d89a323d514e`).
- Columnas: idénticas.
- Permisos: ver [permissions-matrix](../permissions-matrix.md).
