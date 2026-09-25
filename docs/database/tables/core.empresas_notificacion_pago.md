# core.empresas_notificacion_pago

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Configuración por empresa de las notificaciones de pago (`notificaciones_activas`, `procesa_comprobantes_pago`, `ruta_destino`). Relación 1:1 con `core.empresas` (PK = `empresa_id`).

> **Actualización 2026-09-25:** el Hub ya administra esta tabla (alta de proveedor, upsert de empresas históricas, sincronización de `ruta_destino`). Reglas y flujo: [company-configuration](../../automations/payment-notifications/company-configuration.md). El Hub siempre inserta `notificaciones_activas=false` y `procesa_comprobantes_pago=false` explícitos (los defaults de columna siguen siendo `true`) y no escribe `observaciones`.

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
| `daubert_hub_app` | RIU (migración `20260925_011`) | - |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

Ninguna (ninguna función de negocio la referencia en su cuerpo).

## Hub consumers

Desde 2026-09-25: `payment-notification-settings/payment-notification-settings.repository.ts` (lectura, upsert y alta/sincronización de `ruta_destino`) y `providers/providers.repository.ts` (alta de proveedor y cambio de `ruta_dropbox`). D3 (2026-09-24) no encontró ninguno.

## n8n consumers

Ninguno demostrable (ningún workflow versionado la referencia).

## Riesgos al modificar

- n8n la consume **solo a través de vistas** (propiedad de `postgres`). El Hub (`daubert_hub_app`) tiene `SELECT/INSERT/UPDATE` directo desde la migración `20260925_011`; sin `DELETE`.
- Sin trigger de auditoría ni `updated_at` automático (no tiene trigger `updated_at`).

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: medición D3 (2026-09-24) Hub PROD sin grants vs TEST RIUD; desde la migración `20260925_011` Hub PROD = `RIU` (sigue sin `DELETE`). Ver [permissions-matrix](../permissions-matrix.md).
