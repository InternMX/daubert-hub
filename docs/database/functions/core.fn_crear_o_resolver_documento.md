# core.fn_crear_o_resolver_documento

> Ficha derivada de `pg_get_functiondef()` (no se ejecutó la función). Esquema: [core](../schemas/core.md). Índice: [functions](README.md).

## Propósito

Crea un documento origen en `core.documentos` o devuelve el existente (mismo `empresa_id` + ruta normalizada [+ hash]). `INSERT … ON CONFLICT DO NOTHING` apoyado en los índices únicos parciales; si hubo conflicto, lo resuelve por `SELECT`.

## Firma

```sql
core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)
```

| propiedad | valor |
| --- | --- |
| Argumentos | `p_empresa_id bigint, p_tipo_documento text, p_nombre_archivo text, p_ruta_archivo text, p_origen text, p_fecha_documento date DEFAULT NULL::date, p_hash_archivo text DEFAULT NULL::text` |
| Return type | `TABLE(documento_id bigint, ya_existia boolean)` |
| Lenguaje | plpgsql |
| Volatilidad | VOLATILE |
| Owner | postgres |
| Seguridad | SECURITY DEFINER |
| search_path | `search_path=pg_catalog, core` |
| EXECUTE (PROD) | `n8n_app` (+ owner) |
| EXECUTE (TEST) | `n8n_cat_test` (+ owner) |
| Clasificación SECURITY DEFINER | OK |

## Objetos que toca (derivado del cuerpo)

- **Tablas leídas**: [`core.documentos`](../tables/core.documentos.md)
- **Tablas modificadas**: [`core.documentos`](../tables/core.documentos.md)
- **Funciones llamadas**: ninguna
- **Bloqueos**: ninguno explícito

## Códigos de resultado

`22023` (argumento requerido vacío); excepción genérica si no logra crear ni resolver (por ejemplo, una condición que no es conflicto de índice).

SQLSTATE presentes en el cuerpo: `22023`.

## Idempotencia

Idempotente: reintento con los mismos datos → `ya_existia = true`.

## Transaccionalidad

Una sentencia `INSERT` + `SELECT` en la transacción del llamador.

## Consumidores

n8n Caterpillar (`Resolver documento origen PG`, `Propagar documento origen PG`; PROD y TEST). Hub: ninguno.

| workflow (export D2) | nodos |
| --- | --- |
| Caterpillar PROD | `Propagar documento origen PG`, `Resolver documento origen PG` |
| Caterpillar TEST | `Propagar documento origen PG`, `Resolver documento origen PG` |

## Riesgos

- `p_origen` no se valida en la función (lo valida `chk_documentos_origen`).
- No comprueba que `p_empresa_id` sea la esperada por el workflow (la empresa es constante en el nodo n8n).

## TEST vs PROD

|  | sha256 (12) | md5 cuerpo sin CR |
| --- | --- | --- |
| PROD | 7a2460627a65 | 86b765f1db4fff494424b5aea4309ba8 |
| TEST | d28d5823cd35 | 86b765f1db4fff494424b5aea4309ba8 |

- Estado: **DIFFERENT** — tras quitar comentarios `--` y espacios/CR el texto es **igual** (solo cambian comentarios/saltos de línea).
- Firma, propietario, `SECURITY DEFINER` y `search_path`: idénticos.
- `EXECUTE`: difiere — PROD: n8n_app · TEST: n8n_cat_test.
