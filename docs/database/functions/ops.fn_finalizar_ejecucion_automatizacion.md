# ops.fn_finalizar_ejecucion_automatizacion

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [ops](../schemas/ops.md). Índice: [functions](README.md).

## Propósito

Cierra una ejecución (`COMPLETADA`/`ERROR`/`CANCELADA`). Bloquea la fila; `COMPLETADA` exige integridad (cada reserva `RESERVADA` con exactamente `cantidad` remisiones `GENERADA` en su rango) y pasa reservas a `APLICADA`; `ERROR`/`CANCELADA` pasan reservas a `ABANDONADA` (sin tocar `siguiente_folio`).

## Firma

```sql
ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)
```

| propiedad | valor |
| --- | --- |
| Argumentos | `p_ejecucion_id bigint, p_estado_final text, p_error_nodo text DEFAULT NULL::text, p_error_mensaje text DEFAULT NULL::text` |
| Return type | `TABLE(ejecucion_id bigint, ya_estaba_finalizada boolean, estado_final text, reservas_aplicadas integer, reservas_abandonadas integer)` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY DEFINER |
| search_path | `search_path=pg_catalog, ops, operacion` |
| EXECUTE (PROD) | `n8n_app` (+ owner) |
| EXECUTE (TEST) | `n8n_cat_test` (+ owner) |
| Clasificación SECURITY DEFINER | OK |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`operacion.remisiones`](../tables/operacion.remisiones.md), [`operacion.reservas_folios`](../tables/operacion.reservas_folios.md), [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md)
- **Tablas modificadas**: [`operacion.reservas_folios`](../tables/operacion.reservas_folios.md), [`ops.ejecuciones_automatizacion`](../tables/ops.ejecuciones_automatizacion.md)
- **Funciones llamadas**: ninguna
- **Bloqueos**: `FOR UPDATE`

## Códigos de resultado

`22023`, `P0002`, `55000` (ya finalizada con otro estado, o integridad incompleta).

SQLSTATE presentes en el cuerpo: `22023`, `55000`, `P0002`.

## Idempotencia

Idempotente: mismo estado final repetido → `ya_estaba_finalizada = true` sin tocar nada.

## Transaccionalidad

Todo o nada: validación de integridad antes de cualquier escritura.

## Consumidores

n8n Caterpillar (`Finalizar ejecución PG`); invocada internamente por `fn_registrar_fallo_ejecucion`. Audi: no la usa (`UPDATE` directo).

| workflow (export D2) | nodos |
| --- | --- |
| Caterpillar PROD | `Finalizar ejecución PG` |
| Caterpillar TEST | `Execute a SQL query`, `Finalizar ejecución PG` |

## Riesgos

- Acepta cualquier `ejecucion_id` (de cualquier automatización), no solo Caterpillar.

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 057f92afc919 | 6060f6f5838ed0b1de6152d3ccd580cb |
| TEST | bfb78eba68f8 | faf128cb79f25abbf723014a41165822 |

- Estado: **DIFFERENT** — tras quitar comentarios `--` y espacios/CR el texto es **igual** (solo cambian comentarios/saltos de línea).
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: difiere — PROD: n8n_app · TEST: n8n_cat_test.
