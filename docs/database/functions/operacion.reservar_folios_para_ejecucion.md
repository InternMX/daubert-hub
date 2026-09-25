# operacion.reservar_folios_para_ejecucion

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [operacion](../schemas/operacion.md). Índice: [functions](README.md).

## Propósito

Reserva atómica e idempotente de un rango de folios para una ejecución `PROCESANDO`: valida serie existente, ruta ACTIVA de la automatización y serie ACTIVA; inserta `reservas_folios` (`RESERVADA`) y avanza `siguiente_folio`. Serializa con `pg_advisory_xact_lock(ejecucion:serie)` y `FOR UPDATE` de la serie.

## Firma

```sql
operacion.reservar_folios_para_ejecucion(bigint,text,integer)
```

| propiedad | valor |
| --- | --- |
| Argumentos | `p_ejecucion_id bigint, p_serie_codigo text, p_cantidad integer` |
| Return type | `TABLE(reserva_id bigint, folio_inicial bigint, folio_final bigint, cantidad integer)` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY DEFINER |
| search_path | `search_path=pg_catalog, operacion, ops` |
| EXECUTE (PROD) | `n8n_app` (+ owner) |
| EXECUTE (TEST) | `n8n_cat_test` (+ owner) |
| Clasificación SECURITY DEFINER | OK |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`operacion.reservas_folios`](../tables/operacion.reservas_folios.md), [`operacion.series_documentales`](../tables/operacion.series_documentales.md), [`ops.automatizacion_series_proceso`](../tables/ops.automatizacion_series_proceso.md), [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md)
- **Tablas modificadas**: [`operacion.reservas_folios`](../tables/operacion.reservas_folios.md), [`operacion.series_documentales`](../tables/operacion.series_documentales.md)
- **Funciones llamadas**: ninguna
- **Bloqueos**: `FOR UPDATE`, `pg_advisory_xact_lock`

## Códigos de resultado

`22023`, `P0002`, `55000`, `23505` (misma ejecución/serie con otra cantidad).

SQLSTATE presentes en el cuerpo: `22023`, `23505`, `55000`, `P0002`.

## Idempotencia

Idempotente por (ejecución, serie): mismo pedido → misma reserva; cantidad distinta → `23505`.

## Transaccionalidad

Todo o nada en la transacción del llamador.

## Consumidores

n8n Caterpillar (`Reservar folios PG`). Hub: ninguno.

| workflow (export D2) | nodos |
| --- | --- |
| Caterpillar PROD | `Reservar folios PG` |
| Caterpillar TEST | `Reservar folios PG` |

## Riesgos

- No comprueba que el rango no choque con remisiones ya existentes (a diferencia del allocator legado); la protección es el contador monótono.
- Reservas de ejecuciones fallidas quedan `ABANDONADA` y **no** se reciclan.

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 4f518964c9c7 | d8d857473ba3355db4595582461dc9a1 |
| TEST | c75f9b16c5bd | 26719b6e9d322575673348111bc1279e |

- Estado: **DIFFERENT** — tras quitar comentarios `--` y espacios/CR el texto es **igual** (solo cambian comentarios/saltos de línea).
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: difiere — PROD: n8n_app · TEST: n8n_cat_test.
