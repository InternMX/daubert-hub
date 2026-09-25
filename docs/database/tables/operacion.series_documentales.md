# operacion.series_documentales

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [operacion](../schemas/operacion.md). Índice: [tables](README.md).

## Propósito

Serie documental: contador de folios (`siguiente_folio`), `estatus`, piso `folio_minimo_ajustable`.

## Primary Key

`pk_series_documentales` — PRIMARY KEY (serie_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `serie_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `codigo` | `text` | no |  |  | UNIQUE |
| `nombre` | `text` | no |  |  |  |
| `siguiente_folio` | `bigint` | no |  |  | Próximo folio libre. Avanza al reservar; retrocede solo por ajuste manual del Hub. |
| `estatus` | `text` | no | `'ACTIVA'::text` |  | Valores permitidos: ACTIVA, INACTIVA |
| `created_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `updated_at` | `timestamp with time zone` | no | `CURRENT_TIMESTAMP` |  |  |
| `folio_minimo_ajustable` | `bigint` | sí |  |  | Piso histórico para ajustes hacia atrás; `NULL` = sin configurar (falla cerrado).; Explicit historical/cutover safety floor for manual backward next-folio adjustments from Daubert Hub (Phase 12B.2). NULL = unconfigured: backward adjustment must fail closed. Never inferred from MIN(remisiones.folio)/MIN(reservas_folios.folio_inicial). Forward adjustment, reservation, and remittance generation are unaffected by this column. |

## Foreign Keys

Ninguna.

## Unique constraints

| constraint | definición |
| --- | --- |
| `uq_series_documentales_codigo` | `UNIQUE (codigo)` |

## Check constraints

| constraint | definición |
| --- | --- |
| `ck_series_documentales_codigo` | `CHECK (((codigo = upper(btrim(codigo))) AND (codigo <> ''::text)))` |
| `ck_series_documentales_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVA'::text, 'INACTIVA'::text])))` |
| `ck_series_documentales_folio_minimo_ajustable` | `CHECK (((folio_minimo_ajustable IS NULL) OR (folio_minimo_ajustable > 0)))` |
| `ck_series_documentales_nombre` | `CHECK ((btrim(nombre) <> ''::text))` |
| `ck_series_documentales_siguiente_folio` | `CHECK ((siguiente_folio > 0))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `pk_series_documentales` | PK | `btree (serie_id)` |
| `uq_series_documentales_codigo` | UNIQUE | `btree (codigo)` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_series_documentales_updated_at` | `BEFORE UPDATE ON operacion.series_documentales FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Entra**: [`operacion.ajustes_series`](operacion.ajustes_series.md).`serie_id` → `serie_id` (ON DELETE RESTRICT)
- **Entra**: [`operacion.remisiones`](operacion.remisiones.md).`serie_id` → `serie_id` (ON DELETE RESTRICT)
- **Entra**: [`operacion.reservas_folios`](operacion.reservas_folios.md).`serie_id` → `serie_id` (ON DELETE RESTRICT)
- **Entra**: [`ops.automatizacion_series_proceso`](ops.automatizacion_series_proceso.md).`serie_id` → `serie_id` (ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | RU | - |
| `n8n_app` | RU | RU |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Modifica**: [`operacion.reservar_folios`](../functions/operacion.reservar_folios.md)
- **Modifica**: [`operacion.reservar_folios_para_ejecucion`](../functions/operacion.reservar_folios_para_ejecucion.md)
- **Lee**: [`operacion.fn_registrar_remision_generada`](../functions/operacion.fn_registrar_remision_generada.md)
- **Lee**: [`ops.fn_resolver_ruta_automatizacion`](../functions/ops.fn_resolver_ruta_automatizacion.md)
- **Trigger**: `trg_series_documentales_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/document-series.repository.ts` | repository | RU |
| `apps/api/src/automations/remisiones-audi/audi-executions.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-process-labels.ts` | otro | R |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-routing.repository.ts` | repository | R |
| `apps/api/src/recent-activity/document-series-activity.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-audi-activity.repository.ts` | repository | R |

## n8n consumers

| workflow (export versionado D2) | nodos |
| --- | --- |
| Audi PROD | `Leer automatización Audi` |
| Audi TEST | `Leer automatización Audi` |

**Indirecto, vía funciones** (el workflow no toca la tabla, llama a la función): `operacion.fn_registrar_remision_generada` (Caterpillar PROD, Caterpillar TEST); `operacion.reservar_folios` (Audi PROD, Audi TEST); `operacion.reservar_folios_para_ejecucion` (Caterpillar PROD, Caterpillar TEST).

## Riesgos al modificar

- `daubert_hub_app` y `n8n_app` tienen `UPDATE` de tabla completa (incluye `codigo`, `estatus`, `siguiente_folio`).
- Sin auditoría por trigger: los cambios de `siguiente_folio` solo quedan en `ajustes_series` si pasan por el Hub.
- `DELETE` bloqueado por referencias (`RESTRICT`/`NO ACTION`) desde: `operacion.ajustes_series`, `operacion.remisiones`, `operacion.reservas_folios`, `ops.automatizacion_series_proceso`.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = RU vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
