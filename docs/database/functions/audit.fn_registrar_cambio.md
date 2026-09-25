# audit.fn_registrar_cambio

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [audit](../schemas/audit.md). Índice: [functions](README.md).

## Propósito

Trigger genérico de auditoría. Inserta en `audit.cambios` una fila por cambio (`INSERT`/`UPDATE`/`DELETE`). En `UPDATE` ignora cambios que solo tocan `updated_at`. Los argumentos del trigger (`TG_ARGV`) definen las columnas que forman `registro_id`.

## Firma

```sql
audit.fn_registrar_cambio()
```

| propiedad | valor |
| --- | --- |
| Argumentos | (ninguno) |
| Return type | `trigger` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY DEFINER |
| search_path | `search_path=pg_catalog, audit` |
| EXECUTE (PROD) | `PUBLIC` (ACL por defecto: sin `REVOKE`; todos los roles) |
| EXECUTE (TEST) | `PUBLIC` (ACL por defecto: sin `REVOKE`; todos los roles) |
| Clasificación SECURITY DEFINER | OK |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: ninguna
- **Tablas modificadas**: [`audit.cambios`](../tables/audit.cambios.md)
- **Funciones llamadas**: ninguna
- **Bloqueos**: ninguno explícito

## Códigos de resultado

—

SQLSTATE presentes en el cuerpo: ninguno explícito.

## Idempotencia

No aplica (trigger).

## Transaccionalidad

Corre dentro de la transacción de la sentencia auditada; si falla, falla la sentencia.

## Consumidores

Triggers `trg_audit_*` (ver [triggers](../triggers.md)).

## Riesgos

- Lee `app.user_id`, `app.user_email`, `app.origin`, `app.request_id` con `current_setting(..., true)`: cualquier sesión puede fijarlos.
- `EXECUTE` queda en `PUBLIC` (ACL por defecto) pero una función trigger no puede invocarse directamente.

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 095703295f4e | d165640eb1dc3c1f11cc85bd7ae1f6e3 |
| TEST | 095703295f4e | d165640eb1dc3c1f11cc85bd7ae1f6e3 |

- Estado: **IDENTICAL**.
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: idéntico.
