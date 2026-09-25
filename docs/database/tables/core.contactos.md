# core.contactos

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Contactos de una empresa: persona, área o buzón genérico.

## Primary Key

`contactos_pkey` — PRIMARY KEY (contacto_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `contacto_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `empresa_id` | `bigint` | no |  |  | FK → `core.empresas.empresa_id` (ON DELETE CASCADE) |
| `nombre` | `text` | sí |  |  |  |
| `tipo_contacto` | `text` | no | `'PERSONA'::text` |  | Valores permitidos: PERSONA, AREA, BUZON_GENERICO |
| `area` | `text` | sí |  |  |  |
| `cargo` | `text` | sí |  |  |  |
| `es_contacto_principal` | `boolean` | no | `false` |  |  |
| `estatus` | `text` | no | `'ACTIVO'::text` |  | Valores permitidos: PENDIENTE, ACTIVO, RECHAZADO, INACTIVO |
| `observaciones` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `contactos_empresa_id_fkey` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_contactos_estatus` | `CHECK ((estatus = ANY (ARRAY['PENDIENTE'::text, 'ACTIVO'::text, 'RECHAZADO'::text, 'INACTIVO'::text])))` |
| `chk_contactos_nombre` | `CHECK (((tipo_contacto <> 'PERSONA'::text) OR (nombre IS NOT NULL)))` |
| `chk_contactos_tipo` | `CHECK ((tipo_contacto = ANY (ARRAY['PERSONA'::text, 'AREA'::text, 'BUZON_GENERICO'::text])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `contactos_pkey` | PK | `btree (contacto_id)` |
| `idx_contactos_empresa` | normal | `btree (empresa_id)` |
| `idx_contactos_nombre` | normal parcial | `btree (lower(btrim(nombre))) WHERE (nombre IS NOT NULL)` |
| `uq_contacto_principal_empresa` | UNIQUE parcial | `btree (empresa_id) WHERE ((es_contacto_principal = true) AND (estatus = 'ACTIVO'::text))` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_audit_contactos` | `AFTER INSERT OR DELETE OR UPDATE ON core.contactos FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('contacto_id')` |
| `trg_contactos_updated_at` | `BEFORE UPDATE ON core.contactos FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `empresa_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE CASCADE)
- **Entra**: [`core.medios_contacto`](core.medios_contacto.md).`contacto_id` → `contacto_id` (ON DELETE CASCADE)

Diagramas: [relationships](../relationships.md).

Vistas que la leen: [`core.vw_contactos_notificacion_pago`](../views/core.vw_contactos_notificacion_pago.md), [`core.vw_contactos_notificacion_pago_detalle`](../views/core.vw_contactos_notificacion_pago_detalle.md), [`core.vw_contactos_notificacion_pago_n8n`](../views/core.vw_contactos_notificacion_pago_n8n.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RIU | - |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Trigger**: `trg_audit_contactos` → [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)
- **Trigger**: `trg_contactos_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/contact-directory/contact-directory.repository.ts` | repository | R |
| `apps/api/src/contact-methods/contact-methods.repository.ts` | repository | R |
| `apps/api/src/contacts/contacts.repository.ts` | repository | RIU |
| `apps/api/src/recent-activity/recent-activity.repository.ts` | repository | R |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Un solo contacto principal ACTIVO por empresa (`uq_contacto_principal_empresa`).
- `DELETE` de empresa arrastra contactos y sus medios (cascada).
- Auditada (`trg_audit_contactos`).
- `DELETE` aquí arrastra en cascada: `core.medios_contacto`.
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = RIU vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
