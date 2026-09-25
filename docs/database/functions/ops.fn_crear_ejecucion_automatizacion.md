# ops.fn_crear_ejecucion_automatizacion

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [ops](../schemas/ops.md). Índice: [functions](README.md).

## Propósito

Crea o recupera la ejecución de un documento. Ruta normal: reutiliza `PROCESANDO`, o devuelve el estado terminal más reciente (`ALREADY_*`); si no hay, inserta. Reproceso (`p_reproceso_de_id`): inserta hija `PROCESANDO`; conflicto → `ALREADY_PROCESSING` o `ALREADY_REPROCESSED`. Captura `unique_violation` para no propagar `23505` crudo.

## Firma

```sql
ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)
```

| propiedad | valor |
| --- | --- |
| Argumentos | `p_automatizacion_codigo text, p_documento_origen_id bigint, p_n8n_execution_id text DEFAULT NULL::text, p_run_name text DEFAULT NULL::text, p_reproceso_de_id bigint DEFAULT NULL::bigint` |
| Return type | `TABLE(ejecucion_id bigint, ya_existia boolean, motivo text)` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY DEFINER |
| search_path | `search_path=pg_catalog, ops` |
| EXECUTE (PROD) | `n8n_app` (+ owner) |
| EXECUTE (TEST) | `n8n_cat_test` (+ owner) |
| Clasificación SECURITY DEFINER | REVIEW |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`ops.automatizaciones`](../tables/ops.automatizaciones.md), [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md)
- **Tablas modificadas**: [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md)
- **Funciones llamadas**: ninguna
- **Bloqueos**: ninguno explícito

## Códigos de resultado

`22023`, `P0002` (automatización inexistente), `55000` (inactiva). `motivo`: `CREATED`, `REPROCESS_CREATED`, `ALREADY_PROCESSING`, `ALREADY_COMPLETED`, `ALREADY_ERROR`, `ALREADY_CANCELLED`, `ALREADY_REPROCESSED`.

SQLSTATE presentes en el cuerpo: `22023`, `55000`, `P0002`.

## Idempotencia

Idempotente por diseño (índices únicos parciales + captura de `unique_violation`).

## Transaccionalidad

`BEGIN … EXCEPTION` interno (subtransacción) dentro de la transacción del llamador.

## Consumidores

n8n Caterpillar (`Crear o recuperar ejecución PG`, `Propagar ejecución PG`, `Mapear resultado creación reproceso CAT`, `Validar elegibilidad reproceso CAT`). Audi: no la usa (`INSERT` directo).

| workflow (export D2) | nodos |
| --- | --- |
| Caterpillar PROD | `Crear o recuperar ejecución PG`, `Mapear resultado creación reproceso CAT`, `Propagar ejecución PG`, `Validar elegibilidad reproceso CAT` |
| Caterpillar TEST | `Crear o recuperar ejecución PG`, `Mapear resultado creación reproceso CAT`, `Propagar ejecución PG`, `Validar elegibilidad reproceso CAT` |

## Riesgos

- No valida `p_reproceso_de_id` (existencia del padre se cubre por FK; estado del padre, misma automatización y mismo documento **no**): la elegibilidad vive en el workflow.
- Cuerpo reemplazado por la migración 009 (md5 del cuerpo coincide con el esperado por la 009 en PROD y TEST).

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 2b9571cc8060 | 929939dcc7cd3ef0e09b7b2a868b9616 |
| TEST | 68ab4ada7963 | 929939dcc7cd3ef0e09b7b2a868b9616 |

- Estado: **DIFFERENT** — tras quitar comentarios `--` y espacios/CR el texto es **igual** (solo cambian comentarios/saltos de línea).
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: difiere — PROD: n8n_app · TEST: n8n_cat_test.
