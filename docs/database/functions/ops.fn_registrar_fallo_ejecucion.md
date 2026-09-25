# ops.fn_registrar_fallo_ejecucion

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [ops](../schemas/ops.md). Índice: [functions](README.md).

## Propósito

Registra el fallo de un intento de n8n sin doble conteo del mismo `n8n_execution_id`; incrementa `intentos_fallidos`; al agotar `max_intentos` finaliza en `ERROR` llamando a `fn_finalizar_ejecucion_automatizacion` (abandona reservas).

## Firma

```sql
ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)
```

| propiedad | valor |
| --- | --- |
| Argumentos | `p_ejecucion_id bigint, p_n8n_execution_id text, p_error_nodo text, p_error_mensaje text` |
| Return type | `TABLE(ejecucion_id bigint, ya_registrado boolean, intentos_fallidos integer, max_intentos integer, error_final boolean, estado_actual text, reservas_abandonadas integer)` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY DEFINER |
| search_path | `search_path=pg_catalog, ops, operacion` |
| EXECUTE (PROD) | `n8n_app` (+ owner) |
| EXECUTE (TEST) | `n8n_cat_test` (+ owner) |
| Clasificación SECURITY DEFINER | OK |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`operacion.reservas_folios`](../tables/operacion.reservas_folios.md), [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md)
- **Tablas modificadas**: [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md)
- **Funciones llamadas**: [`ops.fn_finalizar_ejecucion_automatizacion`](ops.fn_finalizar_ejecucion_automatizacion.md)
- **Bloqueos**: `FOR UPDATE`

## Códigos de resultado

`22023`, `P0002`, `55000` (ejecución no `PROCESANDO`).

SQLSTATE presentes en el cuerpo: `22023`, `55000`, `P0002`.

## Idempotencia

Idempotente por `n8n_execution_id` (`ya_registrado = true`).

## Transaccionalidad

Todo o nada; bloquea la fila de la ejecución.

## Consumidores

n8n Caterpillar (`Registrar fallo PG`). Audi: no existe equivalente.

| workflow (export D2) | nodos |
| --- | --- |
| Caterpillar PROD | `Registrar fallo PG` |
| Caterpillar TEST | `Registrar fallo PG` |

## Riesgos

- Es la única vía de "recuperación" automática de `PROCESANDO` → `ERROR`; solo existe para Caterpillar.

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 43e6749427c0 | a2d6151b712cf07836e49f0cbf4e8948 |
| TEST | 43e6749427c0 | a2d6151b712cf07836e49f0cbf4e8948 |

- Estado: **IDENTICAL**.
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: difiere — PROD: n8n_app · TEST: n8n_cat_test.
