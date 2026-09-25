# core.alias_empresa

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Nombres alternos de una empresa (abreviatura, razón social histórica, nombre de archivo/carpeta…). Los usa el catálogo de notificaciones para reconocer proveedores en nombres de PDF.

## Primary Key

`alias_empresa_pkey` — PRIMARY KEY (alias_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `alias_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `empresa_id` | `bigint` | no |  |  | FK → `core.empresas.empresa_id` (ON DELETE CASCADE) |
| `alias` | `text` | no |  |  |  |
| `alias_normalizado` | `text` | no |  |  |  |
| `tipo_alias` | `text` | no | `'OTRO'::text` |  | Valores permitidos: ABREVIATURA, RAZON_SOCIAL, RAZON_SOCIAL_HISTORICA, NOMBRE_ARCHIVO, NOMBRE_CARPETA, NOMBRE_COMERCIAL_ALTERNATIVO, OTRO |
| `estatus` | `text` | no | `'ACTIVO'::text` |  | Valores permitidos: ACTIVO, INACTIVO |
| `observaciones` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `alias_empresa_empresa_id_fkey` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_alias_empresa_alias_no_vacio` | `CHECK ((btrim(alias) <> ''::text))` |
| `chk_alias_empresa_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text])))` |
| `chk_alias_empresa_normalizado_no_vacio` | `CHECK ((btrim(alias_normalizado) <> ''::text))` |
| `chk_alias_empresa_tipo` | `CHECK ((tipo_alias = ANY (ARRAY['ABREVIATURA'::text, 'RAZON_SOCIAL'::text, 'RAZON_SOCIAL_HISTORICA'::text, 'NOMBRE_ARCHIVO'::text, 'NOMBRE_CARPETA'::text, 'NOMBRE_COMERCIAL_ALTERNATIVO'::text, 'OTRO'::text])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `alias_empresa_pkey` | PK | `btree (alias_id)` |
| `idx_alias_empresa_empresa` | normal | `btree (empresa_id)` |
| `idx_alias_empresa_normalizado` | normal | `btree (lower(btrim(alias_normalizado)))` |
| `uq_alias_empresa_activo` | UNIQUE parcial | `btree (lower(btrim(alias_normalizado))) WHERE (estatus = 'ACTIVO'::text)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_alias_empresa_updated_at` | `BEFORE UPDATE ON core.alias_empresa FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |
| `trg_audit_alias_empresa` | `AFTER INSERT OR DELETE OR UPDATE ON core.alias_empresa FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('alias_id')` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `empresa_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE CASCADE)

Diagramas: [relationships](../relationships.md).

Vistas que la leen: [`core.vw_carga_empresas_inicial`](../views/core.vw_carga_empresas_inicial.md), [`core.vw_catalogo_nombres_empresa`](../views/core.vw_catalogo_nombres_empresa.md), [`core.vw_catalogo_notificacion_pago_n8n`](../views/core.vw_catalogo_notificacion_pago_n8n.md), [`core.vw_estado_catalogo_empresas`](../views/core.vw_estado_catalogo_empresas.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RID | - |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Trigger**: `trg_alias_empresa_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)
- **Trigger**: `trg_audit_alias_empresa` → [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/aliases/aliases.repository.ts` | repository | R |
| `apps/api/src/companies/companies.repository.ts` | repository | R |
| `apps/api/src/companies/company-aliases.repository.ts` | repository | RID |
| `apps/api/src/contact-directory/contact-directory.repository.ts` | repository | R |
| `apps/api/src/providers/providers.repository.ts` | repository | R |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- `uq_alias_empresa_activo` impide que un mismo alias normalizado ACTIVO exista en **dos empresas**: un alta puede fallar con `23505` por colisión entre empresas.
- `DELETE` en cascada desde `core.empresas`.
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = RID vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
