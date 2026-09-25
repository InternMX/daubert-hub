# core.empresa_roles

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Roles de negocio de una empresa (`PROVEEDOR`, `SERVICIO`, `FLETE`, `CLIENTE`, `OTRO`); PK compuesta (`empresa_id`, `rol`). Base de `core.vw_empresas_hub`.

## Primary Key

`pk_empresa_roles` — PRIMARY KEY (empresa_id, rol)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `empresa_id` | `bigint` | no |  |  | FK → `core.empresas.empresa_id` (ON DELETE CASCADE); PK (compuesta) |
| `rol` | `text` | no |  |  | Valores permitidos: PROVEEDOR, SERVICIO, FLETE, CLIENTE, OTRO; PK (compuesta) |
| `estatus` | `text` | no | `'ACTIVO'::text` |  | Valores permitidos: ACTIVO, INACTIVO |
| `observaciones` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `empresa_roles_empresa_id_fkey` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_empresa_roles_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text])))` |
| `chk_empresa_roles_rol` | `CHECK ((rol = ANY (ARRAY['PROVEEDOR'::text, 'SERVICIO'::text, 'FLETE'::text, 'CLIENTE'::text, 'OTRO'::text])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `idx_empresa_roles_rol_activo` | normal parcial | `btree (rol, empresa_id) WHERE (estatus = 'ACTIVO'::text)` |
| `pk_empresa_roles` | PK | `btree (empresa_id, rol)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_audit_empresa_roles` | `AFTER INSERT OR DELETE OR UPDATE ON core.empresa_roles FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('empresa_id', 'rol')` |
| `trg_empresa_roles_updated_at` | `BEFORE UPDATE ON core.empresa_roles FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `empresa_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE CASCADE)

Diagramas: [relationships](../relationships.md).

Vistas que la leen: [`core.vw_empresas_hub`](../views/core.vw_empresas_hub.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RIU | - |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Trigger**: `trg_audit_empresa_roles` → [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)
- **Trigger**: `trg_empresa_roles_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/clients/clients.repository.ts` | repository | RIU |
| `apps/api/src/providers/providers.repository.ts` | repository | RIU |
| `apps/api/src/recent-activity/recent-activity.repository.ts` | repository | R |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Si una empresa no tiene filas aquí, `vw_empresas_hub` cae al campo de compatibilidad `empresas.tipo_empresa`.
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = RIU vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
