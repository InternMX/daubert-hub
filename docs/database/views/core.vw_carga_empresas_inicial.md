# core.vw_carga_empresas_inicial

> Vista (propietario `postgres`, sin `security_barrier`/`security_invoker`). Definición obtenida con `pg_get_viewdef()`; no se consultó ningún dato de la vista. Índice: [views](README.md).

## Propósito

Reconstruye el paquete de carga inicial de empresas (empresa + fiscal vigente + notificaciones + resumen de documentos y alias) con etiqueta fija `lote_carga = CARGA_INICIAL_XML_BIND_V1`. Solo empresas ACTIVAS con fiscal vigente.

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
| `empresa_fiscal_id` | `bigint` |
| `razon_social` | `text` |
| `rfc` | `character varying(13)` |
| `es_vigente` | `boolean` |
| `estatus_empresa` | `text` |
| `ruta_dropbox` | `text` |
| `notificaciones_activas` | `boolean` |
| `total_documentos` | `bigint` |
| `tipos_documento` | `text` |
| `documento_principal` | `text` |
| `ruta_documento_principal` | `text` |
| `total_alias` | `bigint` |
| `aliases` | `text` |
| `fecha_carga_empresa` | `timestamp with time zone` |
| `fecha_carga_fiscal` | `timestamp with time zone` |
| `lote_carga` | `text` |

## Definición (resumen)

4 `JOIN`s · usa LATERAL, DISTINCT / DISTINCT ON, agregación de texto. Definición completa: `SELECT pg_get_viewdef('core.vw_carga_empresas_inicial'::regclass, true);` (solo lectura).

## Consumidores

Ninguno demostrable (histórico). Existe también la tabla `core.snapshot_carga_empresas_inicial` con las mismas columnas.

## Permisos

Solo `postgres` (y `daubert_hub_test_user` en TEST).

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

> Al ser una vista propiedad de `postgres` **sin** `security_invoker`, se ejecuta con los privilegios del propietario: quien tenga `SELECT` sobre la vista lee las tablas subyacentes a través de ella aunque no tenga `SELECT` directo sobre ellas (es exactamente lo que ocurre con `n8n_app` y las dos vistas `_n8n`).

## TEST vs PROD

- Definición: **IDENTICAL** (`sha256` PROD `44541a79f922` · TEST `44541a79f922`).
- Columnas: idénticas.
- Permisos: ver [permissions-matrix](../permissions-matrix.md).
