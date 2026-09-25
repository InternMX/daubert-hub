# core.vw_catalogo_notificacion_pago_n8n

> Vista (propietario `postgres`, sin `security_barrier`/`security_invoker`). Definición obtenida con `pg_get_viewdef()`; no se consultó ningún dato de la vista. Índice: [views](README.md).

## Propósito

**Catálogo consumido por n8n** (Notificaciones de pago): una fila por (empresa, alias detectable) con `ruta_destino`, `rfc`, listas de correos `PARA/CC/CCO` y `estado = APROBADO`. Construye alias a partir del nombre comercial y los alias activos, deduplicando por clave normalizada.

## Tablas / vistas fuente

- [`core.alias_empresa`](../tables/core.alias_empresa.md)
- [`core.empresas_notificacion_pago`](../tables/core.empresas_notificacion_pago.md)
- [`core.vw_contactos_notificacion_pago_n8n`](../views/core.vw_contactos_notificacion_pago_n8n.md)

## Columnas

| columna | tipo |
| --- | --- |
| `id_proveedor` | `text` |
| `empresa_id` | `bigint` |
| `proveedor` | `text` |
| `nombre_comercial` | `text` |
| `tipo` | `text` |
| `tipo_empresa` | `text` |
| `alias_pdf` | `text` |
| `ruta_destino` | `text` |
| `confianza` | `text` |
| `estado` | `text` |
| `procesa_comprobantes_pago` | `boolean` |
| `notificaciones_activas` | `boolean` |
| `rfc` | `character varying(13)` |
| `correos_para` | `text` |
| `correos_cc` | `text` |
| `correos_cco` | `text` |
| `total_correos_notificacion` | `bigint` |
| `ruta_dropbox` | `text` |

## Definición (resumen)

3 `JOIN`s · usa CTEs, DISTINCT / DISTINCT ON, UNION ALL. Definición completa: `SELECT pg_get_viewdef('core.vw_catalogo_notificacion_pago_n8n'::regclass, true);` (solo lectura).

## Consumidores

n8n Notificaciones de pago (`Consultar catálogo BD`, según D2; export no versionado). Hub: no.

## Permisos

`n8n_app` `SELECT` (PROD y TEST); `daubert_hub_test_user` en TEST.

| Rol | PROD | TEST |
| --- | --- | --- |
| `n8n_app` | R | R |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

> Al ser una vista propiedad de `postgres` **sin** `security_invoker`, se ejecuta con los privilegios del propietario: quien tenga `SELECT` sobre la vista lee las tablas subyacentes a través de ella aunque no tenga `SELECT` directo sobre ellas (es exactamente lo que ocurre con `n8n_app` y las dos vistas `_n8n`).

## TEST vs PROD

- Definición: **IDENTICAL** (`sha256` PROD `fe4e796f69db` · TEST `fe4e796f69db`).
- Columnas: idénticas.
- Permisos: ver [permissions-matrix](../permissions-matrix.md).
