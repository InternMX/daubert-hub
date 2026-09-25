# audit.cambios

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [audit](../schemas/audit.md). Índice: [tables](README.md).

## Propósito

Bitácora genérica de cambios `INSERT`/`UPDATE`/`DELETE` de tablas auditadas. Cada fila guarda esquema, tabla, `registro_id` (`col=valor|col=valor`), operación, atribución (`usuario_id`, `usuario_email`, `origen`, `request_id`) y los JSONB `datos_anteriores`/`datos_nuevos`.

## Primary Key

`cambios_pkey` — PRIMARY KEY (cambio_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `cambio_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `fecha` | `timestamp with time zone` | no | `now()` |  |  |
| `esquema` | `text` | no |  |  |  |
| `tabla` | `text` | no |  |  |  |
| `registro_id` | `text` | sí |  |  | Cadena `col=valor` (varias separadas por `\|`) construida por el trigger. |
| `operacion` | `text` | no |  |  | Valores permitidos: INSERT, UPDATE, DELETE |
| `usuario_id` | `text` | sí |  |  |  |
| `usuario_email` | `text` | sí |  |  |  |
| `origen` | `text` | no | `'SISTEMA'::text` |  |  |
| `request_id` | `text` | sí |  |  |  |
| `datos_anteriores` | `jsonb` | sí |  |  |  |
| `datos_nuevos` | `jsonb` | sí |  |  |  |

## Foreign Keys

Ninguna.

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_audit_operacion` | `CHECK ((operacion = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `cambios_pkey` | PK | `btree (cambio_id)` |
| `idx_audit_cambios_fecha` | normal | `btree (fecha DESC)` |
| `idx_audit_cambios_registro` | normal | `btree (esquema, tabla, registro_id, fecha DESC)` |
| `idx_audit_cambios_usuario` | normal parcial | `btree (usuario_id, fecha DESC) WHERE (usuario_id IS NOT NULL)` |

## Triggers

Ninguno.

## Relationships

Sin relaciones por FK (no hay FK entrantes ni salientes).

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | R | - |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Modifica**: [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)
- **Modifica**: [`audit.fn_registrar_cambio_security_users`](../functions/audit.fn_registrar_cambio_security_users.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/recent-activity/recent-activity.repository.ts` | repository | R |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Contiene copias completas de filas de negocio: sensible.
- Sin retención definida: **PENDIENTE**.
- En TEST `daubert_hub_test_user` tiene `DELETE/UPDATE/INSERT` sobre esta tabla (en PROD el Hub solo tiene `SELECT`): permite falsificar/borrar auditoría en TEST y no es representativo.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = R vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
