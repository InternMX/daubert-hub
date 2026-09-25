# ops.fn_validar_dueno_unico_serie_proceso

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [ops](../schemas/ops.md). Índice: [functions](README.md).

## Propósito

Trigger `BEFORE INSERT/UPDATE OF serie_id, automatizacion_id` en `ops.automatizacion_series_proceso`: impide que una serie quede ruteada bajo dos automatizaciones distintas.

## Firma

```sql
ops.fn_validar_dueno_unico_serie_proceso()
```

| propiedad | valor |
| --- | --- |
| Argumentos | (ninguno) |
| Return type | `trigger` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY INVOKER |
| search_path | (no fijado) |
| EXECUTE (PROD) | `PUBLIC` (ACL por defecto: sin `REVOKE`; todos los roles) |
| EXECUTE (TEST) | `PUBLIC` (ACL por defecto: sin `REVOKE`; todos los roles) |
| Clasificación SECURITY DEFINER | N/A (INVOKER) |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`ops.automatizacion_series_proceso`](../tables/ops.automatizacion_series_proceso.md)
- **Tablas modificadas**: ninguna
- **Funciones llamadas**: ninguna
- **Bloqueos**: ninguno explícito

## Códigos de resultado

`23505`.

SQLSTATE presentes en el cuerpo: `23505`.

## Idempotencia

No aplica (trigger).

## Transaccionalidad

Dentro de la sentencia.

## Consumidores

Trigger `trg_automatizacion_series_proceso_dueno_unico`.

## Riesgos

- `SECURITY INVOKER`; la comprobación `EXISTS` no bloquea: dos inserciones concurrentes podrían pasar. Riesgo práctico bajo (tabla de configuración).

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 5d0960b57f3e | dc3e77d5306974df2e669b2ec6deb75e |
| TEST | 5d0960b57f3e | dc3e77d5306974df2e669b2ec6deb75e |

- Estado: **IDENTICAL**.
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: idéntico.
