# core.empresas_notificacion_pago

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Configuración por empresa de las notificaciones de pago (`notificaciones_activas`, `procesa_comprobantes_pago`, `ruta_destino`). Relación 1:1 con `core.empresas` (PK = `empresa_id`).

## Primary Key

`empresas_notificacion_pago_pkey` — PRIMARY KEY (empresa_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `empresa_id` | `bigint` | no |  |  | FK → `core.empresas.empresa_id` (ON DELETE CASCADE); PK |
| `notificaciones_activas` | `boolean` | no | `true` |  |  |
| `procesa_comprobantes_pago` | `boolean` | no | `true` |  |  |
| `ruta_destino` | `text` | no | `'PAGOS\NOTIFICACIONES DE PAGO\{ANIO}\{MES_NUM}.- {MES_NOMBRE_TITULO}'::text` |  |  |
| `observaciones` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `empresas_notificacion_pago_empresa_id_fkey` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE |

## Unique constraints

Ninguna.

## Check constraints

Ninguna.

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `empresas_notificacion_pago_pkey` | PK | `btree (empresa_id)` |

## Triggers

Ninguno.

## Relationships

- **Sale**: `empresa_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE CASCADE)

Diagramas: [relationships](../relationships.md).

Vistas que la leen: [`core.vw_carga_empresas_inicial`](../views/core.vw_carga_empresas_inicial.md), [`core.vw_catalogo_notificacion_pago_n8n`](../views/core.vw_catalogo_notificacion_pago_n8n.md), [`core.vw_contactos_notificacion_pago`](../views/core.vw_contactos_notificacion_pago.md), [`core.vw_contactos_notificacion_pago_n8n`](../views/core.vw_contactos_notificacion_pago_n8n.md), [`core.vw_empresas_con_fiscal_vigente`](../views/core.vw_empresas_con_fiscal_vigente.md), [`core.vw_empresas_pendientes_fiscal`](../views/core.vw_empresas_pendientes_fiscal.md), [`core.vw_estado_catalogo_empresas`](../views/core.vw_estado_catalogo_empresas.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

Ninguno en `apps/api/src` (búsqueda de `core.empresas_notificacion_pago` en SQL de repositorios/servicios).

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- Ningún rol de aplicación tiene grants directos: se consume **solo a través de vistas** (propiedad de `postgres`).
- Sin trigger de auditoría ni `updated_at` automático (no tiene trigger `updated_at`).

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = sin grants vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
