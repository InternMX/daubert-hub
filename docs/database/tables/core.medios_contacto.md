# core.medios_contacto

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Medios de contacto de un contacto (correo, teléfono, WhatsApp, web…). Indica si un correo recibe notificaciones de pago y en qué posición (`PARA`/`CC`/`CCO`).

## Primary Key

`medios_contacto_pkey` — PRIMARY KEY (medio_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `medio_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `contacto_id` | `bigint` | no |  |  | FK → `core.contactos.contacto_id` (ON DELETE CASCADE) |
| `tipo_medio` | `text` | no |  |  | Valores permitidos: CORREO, TELEFONO, WHATSAPP, OTRO, WEB |
| `valor` | `text` | no |  |  | Correo/teléfono/URL (dato sensible). |
| `es_principal` | `boolean` | no | `false` |  |  |
| `recibe_notificacion_pago` | `boolean` | no | `false` |  | Indica si el correo está autorizado para precargarse en notificaciones de pago. |
| `tipo_destinatario_pago` | `text` | sí |  |  | Valores permitidos: PARA, CC, CCO; Posición del correo autorizado en la notificación: PARA, CC o CCO. |
| `estatus` | `text` | no | `'PENDIENTE'::text` |  | Valores permitidos: PENDIENTE, ACTIVO, RECHAZADO, INACTIVO |
| `observaciones` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `medios_contacto_contacto_id_fkey` | `contacto_id` | `core.contactos(contacto_id)` | CASCADE |

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_medios_contacto` | `UNIQUE (contacto_id, tipo_medio, valor)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_medios_contacto_destinatario` | `CHECK (((tipo_destinatario_pago IS NULL) OR (tipo_destinatario_pago = ANY (ARRAY['PARA'::text, 'CC'::text, 'CCO'::text]))))` |
| `chk_medios_contacto_estatus` | `CHECK ((estatus = ANY (ARRAY['PENDIENTE'::text, 'ACTIVO'::text, 'RECHAZADO'::text, 'INACTIVO'::text])))` |
| `chk_medios_contacto_notificacion` | `CHECK (((recibe_notificacion_pago = false) OR ((tipo_medio = 'CORREO'::text) AND (tipo_destinatario_pago IS NOT NULL))))` |
| `chk_medios_contacto_tipo` | `CHECK ((tipo_medio = ANY (ARRAY['CORREO'::text, 'TELEFONO'::text, 'WHATSAPP'::text, 'OTRO'::text, 'WEB'::text])))` |
| `chk_medios_contacto_valor_no_vacio` | `CHECK ((btrim(valor) <> ''::text))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `idx_medios_contacto_contacto` | normal | `btree (contacto_id)` |
| `idx_medios_contacto_notificacion_pago` | normal | `btree (recibe_notificacion_pago, estatus, tipo_destinatario_pago)` |
| `idx_medios_contacto_valor` | normal | `btree (lower(btrim(valor)))` |
| `medios_contacto_pkey` | PK | `btree (medio_id)` |
| `uq_medio_principal_por_tipo` | UNIQUE parcial | `btree (contacto_id, tipo_medio) WHERE ((es_principal = true) AND (estatus = 'ACTIVO'::text))` |
| `uq_medios_contacto` | UNIQUE | `btree (contacto_id, tipo_medio, valor)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_audit_medios_contacto` | `AFTER INSERT OR DELETE OR UPDATE ON core.medios_contacto FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('medio_id')` |
| `trg_medios_contacto_updated_at` | `BEFORE UPDATE ON core.medios_contacto FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `contacto_id` → [`core.contactos`](core.contactos.md) (`contacto_id`, ON DELETE CASCADE)

Diagramas: [relationships](../relationships.md).

Vistas que la leen: [`core.vw_contactos_notificacion_pago`](../views/core.vw_contactos_notificacion_pago.md), [`core.vw_contactos_notificacion_pago_detalle`](../views/core.vw_contactos_notificacion_pago_detalle.md), [`core.vw_contactos_notificacion_pago_n8n`](../views/core.vw_contactos_notificacion_pago_n8n.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RIU | - |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Trigger**: `trg_audit_medios_contacto` → [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)
- **Trigger**: `trg_medios_contacto_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/contact-directory/contact-directory.repository.ts` | repository | R |
| `apps/api/src/contact-methods/contact-methods.repository.ts` | repository | RIU |
| `apps/api/src/contacts/contacts.repository.ts` | repository | I |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- `chk_medios_contacto_notificacion`: un medio que recibe notificaciones debe ser `CORREO` con `tipo_destinatario_pago`.
- Contiene correos/teléfonos reales: sensible.
- Auditada.
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = RIU vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
