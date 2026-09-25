# core.fn_actualizar_updated_at

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [core](../schemas/core.md). Índice: [functions](README.md).

## Propósito

Trigger `BEFORE UPDATE` que fija `NEW.updated_at = NOW()`.

## Firma

```sql
core.fn_actualizar_updated_at()
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

- **Tablas leídas**: ninguna
- **Tablas modificadas**: ninguna
- **Funciones llamadas**: ninguna
- **Bloqueos**: ninguno explícito

## Códigos de resultado

—

SQLSTATE presentes en el cuerpo: ninguno explícito.

## Idempotencia

No aplica.

## Transaccionalidad

Dentro de la sentencia.

## Consumidores

14 triggers `trg_*_updated_at`.

## Riesgos

- Es `SECURITY INVOKER` y no toca datos: sin riesgo.

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 3eaee6212619 | 06bcf30ac3d0a7f279a54cbf228a7bec |
| TEST | 3eaee6212619 | 06bcf30ac3d0a7f279a54cbf228a7bec |

- Estado: **IDENTICAL**.
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: idéntico.
