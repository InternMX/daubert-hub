# core.empresas_fiscales

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Razones sociales y RFC de una empresa, con vigencia. Una sola vigente por empresa (`uq_empresa_fiscal_vigente`); `rfc` único global.

## Primary Key

`empresas_fiscales_pkey` — PRIMARY KEY (empresa_fiscal_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `empresa_fiscal_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `empresa_id` | `bigint` | no |  |  | FK → `core.empresas.empresa_id` (ON DELETE RESTRICT) |
| `razon_social` | `text` | no |  |  |  |
| `rfc` | `character varying(13)` | no |  |  | UNIQUE; RFC (dato sensible). `UNIQUE` global. |
| `es_vigente` | `boolean` | no | `true` |  |  |
| `fecha_inicio` | `date` | sí |  |  |  |
| `fecha_fin` | `date` | sí |  |  |  |
| `observaciones` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `empresas_fiscales_empresa_id_fkey` | `empresa_id` | `core.empresas(empresa_id)` | RESTRICT |

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_empresas_fiscales_rfc` | `UNIQUE (rfc)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_empresas_fiscales_fechas` | `CHECK (((fecha_fin IS NULL) OR (fecha_inicio IS NULL) OR (fecha_fin >= fecha_inicio)))` |
| `chk_empresas_fiscales_razon_no_vacia` | `CHECK ((btrim(razon_social) <> ''::text))` |
| `chk_empresas_fiscales_rfc_no_vacio` | `CHECK ((btrim((rfc)::text) <> ''::text))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `empresas_fiscales_pkey` | PK | `btree (empresa_fiscal_id)` |
| `idx_empresas_fiscales_empresa` | normal | `btree (empresa_id)` |
| `idx_empresas_fiscales_razon_social` | normal | `btree (lower(btrim(razon_social)))` |
| `uq_empresa_fiscal_vigente` | UNIQUE parcial | `btree (empresa_id) WHERE (es_vigente = true)` |
| `uq_empresas_fiscales_rfc` | UNIQUE | `btree (rfc)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_audit_empresas_fiscales` | `AFTER INSERT OR DELETE OR UPDATE ON core.empresas_fiscales FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('empresa_fiscal_id')` |
| `trg_empresas_fiscales_updated_at` | `BEFORE UPDATE ON core.empresas_fiscales FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `empresa_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE RESTRICT)
- **Entra**: [`core.direcciones`](core.direcciones.md).`empresa_fiscal_id` → `empresa_fiscal_id` (ON DELETE CASCADE)
- **Entra**: [`core.documentos`](core.documentos.md).`empresa_fiscal_id` → `empresa_fiscal_id` (ON DELETE CASCADE)

Diagramas: [relationships](../relationships.md).

Vistas que la leen: [`core.vw_carga_empresas_inicial`](../views/core.vw_carga_empresas_inicial.md), [`core.vw_catalogo_nombres_empresa`](../views/core.vw_catalogo_nombres_empresa.md), [`core.vw_contactos_notificacion_pago_detalle`](../views/core.vw_contactos_notificacion_pago_detalle.md), [`core.vw_contactos_notificacion_pago_n8n`](../views/core.vw_contactos_notificacion_pago_n8n.md), [`core.vw_empresas_con_fiscal_vigente`](../views/core.vw_empresas_con_fiscal_vigente.md), [`core.vw_empresas_hub`](../views/core.vw_empresas_hub.md), [`core.vw_empresas_pendientes_fiscal`](../views/core.vw_empresas_pendientes_fiscal.md), [`core.vw_estado_catalogo_empresas`](../views/core.vw_estado_catalogo_empresas.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RIU | - |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Trigger**: `trg_audit_empresas_fiscales` → [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)
- **Trigger**: `trg_empresas_fiscales_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/clients/clients.repository.ts` | repository | RIU |
| `apps/api/src/companies/companies.repository.ts` | repository | R |
| `apps/api/src/providers/providers.repository.ts` | repository | RIU |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Contiene RFC: sensible.
- La FK a `empresas` es `RESTRICT`: no se borra una empresa con razones sociales.
- Auditada.
- `DELETE` aquí arrastra en cascada: `core.direcciones`, `core.documentos`.
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = RIU vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
