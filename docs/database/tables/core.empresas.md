# core.empresas

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Maestro de empresas (proveedores, clientes, servicios, fletes). `nombre_comercial` único (insensible a mayúsculas/espacios). Ancla de casi todo el modelo.

## Primary Key

`empresas_pkey` — PRIMARY KEY (empresa_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `empresa_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `tipo_empresa` | `text` | no |  |  | Valores permitidos: PROVEEDOR, SERVICIO, FLETE, CLIENTE, OTRO |
| `nombre_comercial` | `text` | no |  |  |  |
| `razon_social` | `text` | sí |  |  |  |
| `estatus` | `text` | no | `'ACTIVO'::text` |  | Valores permitidos: ACTIVO, INACTIVO, BLOQUEADO |
| `ruta_dropbox` | `text` | sí |  |  |  |
| `observaciones` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

Ninguna.

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_empresas_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text, 'BLOQUEADO'::text])))` |
| `chk_empresas_nombre_no_vacio` | `CHECK ((btrim(nombre_comercial) <> ''::text))` |
| `chk_empresas_tipo` | `CHECK ((tipo_empresa = ANY (ARRAY['PROVEEDOR'::text, 'SERVICIO'::text, 'FLETE'::text, 'CLIENTE'::text, 'OTRO'::text])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `empresas_pkey` | PK | `btree (empresa_id)` |
| `uq_empresas_nombre_comercial` | UNIQUE | `btree (lower(btrim(nombre_comercial)))` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_audit_empresas` | `AFTER INSERT OR DELETE OR UPDATE ON core.empresas FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('empresa_id')` |
| `trg_empresas_updated_at` | `BEFORE UPDATE ON core.empresas FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Entra**: [`core.alias_empresa`](core.alias_empresa.md).`empresa_id` → `empresa_id` (ON DELETE CASCADE)
- **Entra**: [`core.borradores_notificacion_pago`](core.borradores_notificacion_pago.md).`empresa_id` → `empresa_id` (ON DELETE NO ACTION)
- **Entra**: [`core.contactos`](core.contactos.md).`empresa_id` → `empresa_id` (ON DELETE CASCADE)
- **Entra**: [`core.direcciones`](core.direcciones.md).`empresa_id` → `empresa_id` (ON DELETE CASCADE)
- **Entra**: [`core.documentos`](core.documentos.md).`empresa_id` → `empresa_id` (ON DELETE CASCADE)
- **Entra**: [`core.empresa_roles`](core.empresa_roles.md).`empresa_id` → `empresa_id` (ON DELETE CASCADE)
- **Entra**: [`core.empresas_fiscales`](core.empresas_fiscales.md).`empresa_id` → `empresa_id` (ON DELETE RESTRICT)
- **Entra**: [`core.empresas_notificacion_pago`](core.empresas_notificacion_pago.md).`empresa_id` → `empresa_id` (ON DELETE CASCADE)
- **Entra**: [`core.resultados_notificacion_pago`](core.resultados_notificacion_pago.md).`empresa_id` → `empresa_id` (ON DELETE NO ACTION)
- **Entra**: [`operacion.remisiones`](operacion.remisiones.md).`empresa_cliente_id` → `empresa_id` (ON DELETE RESTRICT)
- **Entra**: [`ops.automatizacion_series_proceso`](ops.automatizacion_series_proceso.md).`empresa_cliente_id` → `empresa_id` (ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

Vistas que la leen: [`core.vw_carga_empresas_inicial`](../views/core.vw_carga_empresas_inicial.md), [`core.vw_catalogo_nombres_empresa`](../views/core.vw_catalogo_nombres_empresa.md), [`core.vw_contactos_notificacion_pago`](../views/core.vw_contactos_notificacion_pago.md), [`core.vw_contactos_notificacion_pago_detalle`](../views/core.vw_contactos_notificacion_pago_detalle.md), [`core.vw_contactos_notificacion_pago_n8n`](../views/core.vw_contactos_notificacion_pago_n8n.md), [`core.vw_empresas_con_fiscal_vigente`](../views/core.vw_empresas_con_fiscal_vigente.md), [`core.vw_empresas_hub`](../views/core.vw_empresas_hub.md), [`core.vw_empresas_pendientes_fiscal`](../views/core.vw_empresas_pendientes_fiscal.md), [`core.vw_estado_catalogo_empresas`](../views/core.vw_estado_catalogo_empresas.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RIU | - |
| `n8n_app` | R | R |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Lee**: [`ops.fn_resolver_ruta_automatizacion`](../functions/ops.fn_resolver_ruta_automatizacion.md)
- **Trigger**: `trg_audit_empresas` → [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)
- **Trigger**: `trg_empresas_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/addresses/addresses.repository.ts` | repository | R |
| `apps/api/src/aliases/aliases.repository.ts` | repository | R |
| `apps/api/src/automations/payment-notifications/payment-notifications.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-routing.repository.ts` | repository | R |
| `apps/api/src/clients/clients.repository.ts` | repository | RIU |
| `apps/api/src/companies/companies.repository.ts` | repository | R |
| `apps/api/src/contact-directory/contact-directory.repository.ts` | repository | R |
| `apps/api/src/contact-methods/contact-methods.repository.ts` | repository | R |
| `apps/api/src/contacts/contacts.repository.ts` | repository | R |
| `apps/api/src/providers/providers.repository.ts` | repository | RIU |
| `apps/api/src/recent-activity/recent-activity.repository.ts` | repository | R |

## n8n consumers

| workflow (export versionado D2) | nodos |
| --- | --- |
| Audi PROD | `Leer cliente Audi PG`, `Validar cliente Audi PG` |
| Audi TEST | `Leer cliente Audi PG`, `Validar cliente Audi PG` |

Notificaciones de pago (según [D2](../../automations/payment-notifications/database-contract.md); export **no versionado**, INFERRED): SELECT (nombre comercial en el resumen).

## Riesgos al modificar

- `n8n_app` tiene `SELECT` de toda la tabla (Audi busca cliente con `to_jsonb(e)::text ILIKE …`, lectura de fila completa).
- Referenciada con `ON DELETE RESTRICT` por `empresas_fiscales`, `remisiones` y rutas; con `CASCADE` por alias, contactos, roles, direcciones, documentos y config de notificaciones.
- PROD tiene 2 columnas eliminadas (huecos de `attnum` 7 y 11) que TEST no tiene: sin efecto funcional.
- Auditada (`trg_audit_empresas`).
- `DELETE` aquí arrastra en cascada: `core.alias_empresa`, `core.contactos`, `core.direcciones`, `core.documentos`, `core.empresa_roles`, `core.empresas_notificacion_pago`.
- `DELETE` bloqueado por referencias (`RESTRICT`/`NO ACTION`) desde: `core.borradores_notificacion_pago`, `core.empresas_fiscales`, `core.resultados_notificacion_pago`, `operacion.remisiones`, `ops.automatizacion_series_proceso`.
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Solo difiere el `attnum` de 3 columnas: PROD tiene 2 columnas eliminadas (huecos 7 y 11); sin efecto funcional. Se comparó por nombre/tipo/default, que son idénticos.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = RIU vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
