# core.direcciones

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Direcciones de una empresa **o** de una empresa fiscal (exactamente una de las dos: `chk_direcciones_propietario_xor`), con tipo, principal y vigencia.

## Primary Key

`direcciones_pkey` — PRIMARY KEY (direccion_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `direccion_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `empresa_id` | `bigint` | sí |  |  | FK → `core.empresas.empresa_id` (ON DELETE CASCADE) |
| `empresa_fiscal_id` | `bigint` | sí |  |  | FK → `core.empresas_fiscales.empresa_fiscal_id` (ON DELETE CASCADE) |
| `tipo_direccion` | `text` | no |  |  | Valores permitidos: FISCAL, COMERCIAL, OPERATIVA, ENTREGA, FACTURACION, OTRA |
| `calle` | `text` | sí |  |  |  |
| `numero_exterior` | `text` | sí |  |  |  |
| `numero_interior` | `text` | sí |  |  |  |
| `colonia` | `text` | sí |  |  |  |
| `codigo_postal` | `text` | sí |  |  |  |
| `municipio` | `text` | sí |  |  |  |
| `estado` | `text` | sí |  |  |  |
| `pais` | `text` | sí | `'MEXICO'::text` |  |  |
| `direccion_completa` | `text` | sí |  |  |  |
| `referencias` | `text` | sí |  |  |  |
| `es_principal` | `boolean` | no | `false` |  |  |
| `estatus` | `text` | no | `'ACTIVA'::text` |  | Valores permitidos: ACTIVA, INACTIVA |
| `fecha_inicio` | `date` | sí |  |  |  |
| `fecha_fin` | `date` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `direcciones_empresa_fiscal_id_fkey` | `empresa_fiscal_id` | `core.empresas_fiscales(empresa_fiscal_id)` | CASCADE |
| `direcciones_empresa_id_fkey` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_direcciones_contenido` | `CHECK (((direccion_completa IS NOT NULL) OR (calle IS NOT NULL)))` |
| `chk_direcciones_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVA'::text, 'INACTIVA'::text])))` |
| `chk_direcciones_fechas` | `CHECK (((fecha_fin IS NULL) OR (fecha_inicio IS NULL) OR (fecha_fin >= fecha_inicio)))` |
| `chk_direcciones_propietario_xor` | `CHECK ((((empresa_id IS NOT NULL) AND (empresa_fiscal_id IS NULL)) OR ((empresa_id IS NULL) AND (empresa_fiscal_id IS NOT NULL))))` |
| `chk_direcciones_tipo` | `CHECK ((tipo_direccion = ANY (ARRAY['FISCAL'::text, 'COMERCIAL'::text, 'OPERATIVA'::text, 'ENTREGA'::text, 'FACTURACION'::text, 'OTRA'::text])))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `direcciones_pkey` | PK | `btree (direccion_id)` |
| `idx_direcciones_codigo_postal` | normal | `btree (codigo_postal)` |
| `idx_direcciones_empresa` | normal parcial | `btree (empresa_id) WHERE (empresa_id IS NOT NULL)` |
| `idx_direcciones_empresa_fiscal` | normal parcial | `btree (empresa_fiscal_id) WHERE (empresa_fiscal_id IS NOT NULL)` |
| `uq_direccion_principal_empresa` | UNIQUE parcial | `btree (empresa_id, tipo_direccion) WHERE ((empresa_id IS NOT NULL) AND (es_principal = true) AND (estatus = 'ACTIVA'::text))` |
| `uq_direccion_principal_empresa_fiscal` | UNIQUE parcial | `btree (empresa_fiscal_id, tipo_direccion) WHERE ((empresa_fiscal_id IS NOT NULL) AND (es_principal = true) AND (estatus = 'ACTIVA'::text))` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_audit_direcciones` | `AFTER INSERT OR DELETE OR UPDATE ON core.direcciones FOR EACH ROW EXECUTE FUNCTION audit.fn_registrar_cambio('direccion_id')` |
| `trg_direcciones_updated_at` | `BEFORE UPDATE ON core.direcciones FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `empresa_fiscal_id` → [`core.empresas_fiscales`](core.empresas_fiscales.md) (`empresa_fiscal_id`, ON DELETE CASCADE)
- **Sale**: `empresa_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE CASCADE)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Trigger**: `trg_audit_direcciones` → [`audit.fn_registrar_cambio`](../functions/audit.fn_registrar_cambio.md)
- **Trigger**: `trg_direcciones_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/addresses/addresses.repository.ts` | repository | RIU |

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- **DB-01 — brecha de permisos en PROD** (documentada, **NO corregida**; no se probaron escrituras ni se cambiaron grants):

  | aspecto | detalle |
  | --- | --- |
  | Permiso esperado | `INSERT/UPDATE` (+ sequence) para `daubert_hub_app`, según D1 y la migración `20260902_002`; el repositorio además hace `SELECT`. |
  | Permiso observado (PROD) | Ninguno: `daubert_hub_app` no tiene privilegio alguno sobre la tabla ni su sequence (`has_table_privilege` / `relacl`). En TEST, `daubert_hub_test_user` tiene `RIUD`. |
  | Consumidor Hub | `apps/api/src/addresses/addresses.repository.ts` (`SELECT/INSERT/UPDATE`); módulo `AddressesModule` registrado en `app.module.ts`. |
  | Contradicción | La documentación previa (D1) y la migración citada indican que el grant existe; la base PROD no lo refleja. Causa **UNKNOWN** (migración no aplicada, revocación posterior u otra). |
  | Impacto potencial | Si los endpoints de direcciones se usan en PROD, previsiblemente fallarían con `permission denied` (**no verificado**: no se ejecutó ninguna operación). También se desconoce si el módulo se usa en PROD. TEST no lo detecta por su permission drift. |
  | Estado | Registrado como riesgo DB-01. Corrección: decisión humana en una fase posterior. |
- Auditada (`trg_audit_direcciones`).
- Los cambios se auditan: una modificación masiva genera una fila de `audit.cambios` por fila afectada.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = sin grants vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
