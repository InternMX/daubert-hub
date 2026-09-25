# core.vw_catalogo_nombres_empresa

> Vista (propietario `postgres`, sin `security_barrier`/`security_invoker`). Definición obtenida con `pg_get_viewdef()`; no se consultó ningún dato de la vista. Índice: [views](README.md).

## Propósito

Catálogo unificado de nombres detectables por empresa: nombre comercial, razones sociales (vigente/histórica) y alias, con bandera `es_vigente`.

## Tablas / vistas fuente

- [`core.alias_empresa`](../tables/core.alias_empresa.md)
- [`core.empresas`](../tables/core.empresas.md)
- [`core.empresas_fiscales`](../tables/core.empresas_fiscales.md)

## Columnas

| columna | tipo |
| --- | --- |
| `empresa_id` | `bigint` |
| `nombre_detectable` | `text` |
| `origen_nombre` | `text` |
| `es_vigente` | `boolean` |

## Definición (resumen)

0 `JOIN`s · usa UNION ALL. Definición completa: `SELECT pg_get_viewdef('core.vw_catalogo_nombres_empresa'::regclass, true);` (solo lectura).

## Consumidores

Ninguno demostrable en Hub ni en workflows versionados.

## Permisos

Solo `postgres` (y `daubert_hub_test_user` en TEST).

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

> Al ser una vista propiedad de `postgres` **sin** `security_invoker`, se ejecuta con los privilegios del propietario: quien tenga `SELECT` sobre la vista lee las tablas subyacentes a través de ella aunque no tenga `SELECT` directo sobre ellas (es exactamente lo que ocurre con `n8n_app` y las dos vistas `_n8n`).

## TEST vs PROD

- Definición: **IDENTICAL** (`sha256` PROD `d2d1db12afae` · TEST `d2d1db12afae`).
- Columnas: idénticas.
- Permisos: ver [permissions-matrix](../permissions-matrix.md).
