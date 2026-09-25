# audit.fn_registrar_cambio_security_users

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [audit](../schemas/audit.md). Índice: [functions](README.md).

## Propósito

Variante para `security.users`: excluye `password_hash` de los JSONB, ignora cambios que solo alteran `updated_at`/`last_login_at` y agrega `password_changed: true` cuando cambió el hash.

## Firma

```sql
audit.fn_registrar_cambio_security_users()
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

Dentro de la transacción de la sentencia auditada.

## Consumidores

Trigger `trg_audit_users`.

## Riesgos

- Garantía de privacidad verificada en la definición: `v_old - 'password_hash'`, `v_new - 'password_hash'`.

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 0e5918ea3778 | 767c3c24e968275c3e11fd2c34fc87c6 |
| TEST | 0e5918ea3778 | 767c3c24e968275c3e11fd2c34fc87c6 |

- Estado: **IDENTICAL**.
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: idéntico.
