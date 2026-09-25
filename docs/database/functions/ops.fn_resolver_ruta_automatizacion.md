# ops.fn_resolver_ruta_automatizacion

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [ops](../schemas/ops.md). Índice: [functions](README.md).

## Propósito

Devuelve la ruta ACTIVA (serie, estatus de serie, cliente y su nombre comercial) para (`codigo`, `llave_proceso`). `LANGUAGE sql STABLE`.

## Firma

```sql
ops.fn_resolver_ruta_automatizacion(text,text)
```

| propiedad | valor |
| --- | --- |
| Argumentos | `p_automatizacion_codigo text, p_llave_proceso text` |
| Return type | `TABLE(ruta_id bigint, automatizacion_id bigint, serie_id bigint, serie_codigo text, serie_estatus text, empresa_cliente_id bigint, empresa_cliente_nombre text)` |
| Lenguaje | sql |
| Volatilidad | STABLE |
| Owner | postgres |
| Seguridad | SECURITY DEFINER |
| search_path | `search_path=pg_catalog, ops, operacion, core` |
| EXECUTE (PROD) | `n8n_app` (+ owner) |
| EXECUTE (TEST) | `n8n_cat_test` (+ owner) |
| Clasificación SECURITY DEFINER | OK |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`core.empresas`](../tables/core.empresas.md), [`operacion.series_documentales`](../tables/operacion.series_documentales.md), [`ops.automatizacion_series_proceso`](../tables/ops.automatizacion_series_proceso.md), [`ops.automatizaciones`](../tables/ops.automatizaciones.md)
- **Tablas modificadas**: ninguna
- **Funciones llamadas**: ninguna
- **Bloqueos**: ninguno explícito

## Códigos de resultado

—

SQLSTATE presentes en el cuerpo: ninguno explícito.

## Idempotencia

Solo lectura.

## Transaccionalidad

Sin escrituras.

## Consumidores

**Ningún consumidor demostrable**: ni los workflows exportados ni `apps/api` la llaman (D2: el ruteo de Caterpillar está hardcodeado en el workflow).

## Riesgos

- Función sin uso: su existencia no implica que el catálogo de rutas gobierne n8n.

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 540563c54740 | 3071b4875a01a81e7849dcd60d438e62 |
| TEST | 540563c54740 | 3071b4875a01a81e7849dcd60d438e62 |

- Estado: **IDENTICAL**.
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: difiere — PROD: n8n_app · TEST: n8n_cat_test.
