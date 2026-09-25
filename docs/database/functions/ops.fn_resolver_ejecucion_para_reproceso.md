# ops.fn_resolver_ejecucion_para_reproceso

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [ops](../schemas/ops.md). Índice: [functions](README.md).

## Propósito

Lectura mínima para el webhook de reproceso: une ejecución ↔ automatización `REMISIONES_CATERPILLAR` ↔ documento origen. Ejecución inexistente, de otra automatización o sin documento son indistinguibles (`encontrada = false`).

## Firma

```sql
ops.fn_resolver_ejecucion_para_reproceso(bigint)
```

| propiedad | valor |
| --- | --- |
| Argumentos | `p_ejecucion_id bigint` |
| Return type | `TABLE(encontrada boolean, estado text, documento_origen_id bigint, ruta_archivo text, nombre_archivo text)` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY DEFINER |
| search_path | `search_path=pg_catalog, ops` |
| EXECUTE (PROD) | `n8n_app` (+ owner) |
| EXECUTE (TEST) | `n8n_cat_test` (+ owner) |
| Clasificación SECURITY DEFINER | OK |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`core.documentos`](../tables/core.documentos.md), [`ops.automatizaciones`](../tables/ops.automatizaciones.md), [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md)
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

n8n Caterpillar (`Resolver ejecución original PG`, `Validar elegibilidad reproceso CAT`). Hub: sin `EXECUTE` (lo exige el postcheck 009).

| workflow (export D2) | nodos |
| --- | --- |
| Caterpillar PROD | `Resolver ejecución original PG`, `Sticky Note Reprocess`, `Validar elegibilidad reproceso CAT` |
| Caterpillar TEST | `Resolver ejecución original PG`, `Sticky Note Reprocess`, `Validar elegibilidad reproceso CAT` |

## Riesgos

- Código de automatización `REMISIONES_CATERPILLAR` **hardcodeado** en la función.
- Introducida por la migración 009 (versionada en el repo).

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 6c477c77163e | 4d4d231cbbd868aa339ab65e4105e002 |
| TEST | 99b3e4c605d7 | 4d4d231cbbd868aa339ab65e4105e002 |

- Estado: **DIFFERENT** — tras quitar comentarios `--` y espacios/CR el texto es **igual** (solo cambian comentarios/saltos de línea).
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: difiere — PROD: n8n_app · TEST: n8n_cat_test.
