# operacion.fn_registrar_remision_generada

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [operacion](../schemas/operacion.md). Índice: [functions](README.md).

## Propósito

Persiste una remisión `GENERADA` y sus renglones. Valida: argumentos, ejecución `PROCESANDO`, serie ruta ACTIVA sin ambigüedad (deriva `empresa_cliente_id`, nunca lo acepta), folio dentro de la reserva de esa ejecución/serie. Serializa con `pg_advisory_xact_lock(serie:folio)`.

## Firma

```sql
operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)
```

| propiedad | valor |
| --- | --- |
| Argumentos | `p_ejecucion_id bigint, p_serie_codigo text, p_folio bigint, p_fecha_documento date, p_pdf_path text, p_detalles jsonb` |
| Return type | `TABLE(remision_id bigint, ya_existia boolean)` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY DEFINER |
| search_path | `search_path=pg_catalog, operacion, ops` |
| EXECUTE (PROD) | `n8n_app` (+ owner) |
| EXECUTE (TEST) | `n8n_cat_test` (+ owner) |
| Clasificación SECURITY DEFINER | OK |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`operacion.remision_detalle`](../tables/operacion.remision_detalle.md), [`operacion.remisiones`](../tables/operacion.remisiones.md), [`operacion.reservas_folios`](../tables/operacion.reservas_folios.md), [`operacion.series_documentales`](../tables/operacion.series_documentales.md), [`ops.automatizacion_series_proceso`](../tables/ops.automatizacion_series_proceso.md), [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md)
- **Tablas modificadas**: [`operacion.remision_detalle`](../tables/operacion.remision_detalle.md), [`operacion.remisiones`](../tables/operacion.remisiones.md)
- **Funciones llamadas**: ninguna
- **Bloqueos**: `pg_advisory_xact_lock`

## Códigos de resultado

`22023`, `P0002`, `55000`, `23505` (folio de otra ejecución, o mismo folio con cabecera/detalle distintos).

SQLSTATE presentes en el cuerpo: `22023`, `23505`, `55000`, `P0002`.

## Idempotencia

Idempotente: mismo folio + misma cabecera + mismo multiconjunto de detalles → `ya_existia = true`; distinto → `23505` (nunca sobrescribe).

## Transaccionalidad

Todo o nada en la transacción del llamador (cabecera + renglones).

## Consumidores

n8n Caterpillar (`Registrar remisión PG`). Audi: **no** la usa (inserta con SQL directo).

| workflow (export D2) | nodos |
| --- | --- |
| Caterpillar PROD | `Registrar remisión PG` |
| Caterpillar TEST | `Registrar remisión PG` |

## Riesgos

- No verifica que el `pdf_path` exista en disco.
- Un `pdf_path` distinto en un reintento se rechaza con `23505` (no se puede corregir la ruta vía esta función).

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | eea96144b57d | 0137ef4e66a93fecb79fa2f987ef2c23 |
| TEST | df3b2d987b93 | 6efa9ced75530e72a3b79825c86ba3db |

- Estado: **DIFFERENT** — tras quitar comentarios `--` y espacios/CR el texto es **igual** (solo cambian comentarios/saltos de línea).
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: difiere — PROD: n8n_app · TEST: n8n_cat_test.
