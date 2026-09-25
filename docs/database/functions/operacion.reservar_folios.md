# operacion.reservar_folios

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [operacion](../schemas/operacion.md). Índice: [functions](README.md).

## Propósito

**Allocator legado (Audi).** Bloquea la serie por código (`FOR UPDATE`), verifica que el rango pedido no choque con remisiones no canceladas y avanza `siguiente_folio`. No crea reserva, no valida ejecución ni ruta.

## Firma

```sql
operacion.reservar_folios(text,integer)
```

| propiedad | valor |
| --- | --- |
| Argumentos | `p_serie_codigo text, p_cantidad integer` |
| Return type | `TABLE(folio_inicial bigint, folio_final bigint, cantidad integer)` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY INVOKER |
| search_path | (no fijado) |
| EXECUTE (PROD) | `n8n_app` (+ owner) |
| EXECUTE (TEST) | `n8n_app` (+ owner) |
| Clasificación SECURITY DEFINER | N/A (INVOKER) |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`operacion.remisiones`](../tables/operacion.remisiones.md), [`operacion.series_documentales`](../tables/operacion.series_documentales.md)
- **Tablas modificadas**: [`operacion.series_documentales`](../tables/operacion.series_documentales.md)
- **Funciones llamadas**: ninguna
- **Bloqueos**: `FOR UPDATE`

## Códigos de resultado

`22023`, `P0002` (serie inexistente), `55000` (serie inactiva), `23505` (rango choca con una remisión activa).

SQLSTATE presentes en el cuerpo: `22023`, `23505`, `55000`, `P0002`.

## Idempotencia

**No** idempotente: cada llamada consume `cantidad` folios nuevos.

## Transaccionalidad

Dentro de la transacción del llamador; si el workflow falla después, los folios ya consumidos no se devuelven (huecos).

## Consumidores

n8n Audi (`Reservar folios PostgreSQL`, PROD y TEST). Hub: ninguno.

| workflow (export D2) | nodos |
| --- | --- |
| Audi PROD | `Reservar folios PostgreSQL` |
| Audi TEST | `Reservar folios PostgreSQL` |

## Riesgos

- `SECURITY INVOKER`: requiere `SELECT/UPDATE` directo de `n8n_app` sobre `operacion.series_documentales` y `SELECT` sobre `remisiones`.
- Sin rastro de la reserva ni de la ejecución que la pidió.
- Ver [audi-legacy-allocator](../audi-legacy-allocator.md).

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 3cd20f24eda1 | 888b4c2e13bc465862c4b374dc6167d3 |
| TEST | 3cd20f24eda1 | 888b4c2e13bc465862c4b374dc6167d3 |

- Estado: **IDENTICAL**.
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: idéntico.
