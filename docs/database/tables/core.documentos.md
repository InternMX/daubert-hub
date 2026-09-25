# core.documentos

> Ficha generada de `pg_catalog` (PROD `daubert_global` y TEST `daubert_hub_test`, solo lectura). Propietario: `postgres`. Tipo: tabla ordinaria. Esquema: [core](../schemas/core.md). Índice: [tables](README.md).

## Propósito

Documento/archivo origen registrado (ruta Dropbox, tipo, hash). Es la referencia `documento_origen_id` de las ejecuciones de automatización. Propietario XOR: empresa **o** empresa fiscal.

## Primary Key

`documentos_pkey` — PRIMARY KEY (documento_id)

## Columns

| column | type | nullable | default | identity/generated | nota verificable |
| --- | --- | --- | --- | --- | --- |
| `documento_id` | `bigint` | no |  | GENERATED ALWAYS AS IDENTITY | PK |
| `empresa_id` | `bigint` | sí |  |  | FK → `core.empresas.empresa_id` (ON DELETE CASCADE) |
| `empresa_fiscal_id` | `bigint` | sí |  |  | FK → `core.empresas_fiscales.empresa_fiscal_id` (ON DELETE CASCADE) |
| `tipo_documento` | `text` | no |  |  |  |
| `nombre_archivo` | `text` | no |  |  |  |
| `ruta_archivo` | `text` | no |  |  |  |
| `fecha_documento` | `date` | sí |  |  |  |
| `hash_archivo` | `text` | sí |  |  | Hash del archivo (en minúsculas); permite reconocer versiones distintas de la misma ruta. |
| `origen` | `text` | sí |  |  | Valores permitidos: DROPBOX, OUTLOOK, BIND, N8N, CARGA_MANUAL, OTRO |
| `estatus` | `text` | no | `'ACTIVO'::text` |  | Valores permitidos: ACTIVO, INACTIVO, ARCHIVADO, ERROR |
| `observaciones` | `text` | sí |  |  |  |
| `created_at` | `timestamp with time zone` | no | `now()` |  |  |
| `updated_at` | `timestamp with time zone` | no | `now()` |  |  |

## Foreign Keys

| constraint | columnas | referencia | ON DELETE |
| --- | --- | --- | --- |
| `documentos_empresa_fiscal_id_fkey` | `empresa_fiscal_id` | `core.empresas_fiscales(empresa_fiscal_id)` | CASCADE |
| `documentos_empresa_id_fkey` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE |

## Unique constraints

Ninguna.

## Check constraints

| constraint | definición |
| --- | --- |
| `chk_documentos_estatus` | `CHECK ((estatus = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text, 'ARCHIVADO'::text, 'ERROR'::text])))` |
| `chk_documentos_nombre_no_vacio` | `CHECK ((btrim(nombre_archivo) <> ''::text))` |
| `chk_documentos_origen` | `CHECK (((origen IS NULL) OR (origen = ANY (ARRAY['DROPBOX'::text, 'OUTLOOK'::text, 'BIND'::text, 'N8N'::text, 'CARGA_MANUAL'::text, 'OTRO'::text]))))` |
| `chk_documentos_propietario_xor` | `CHECK ((((empresa_id IS NOT NULL) AND (empresa_fiscal_id IS NULL)) OR ((empresa_id IS NULL) AND (empresa_fiscal_id IS NOT NULL))))` |
| `chk_documentos_ruta_no_vacia` | `CHECK ((btrim(ruta_archivo) <> ''::text))` |

Los `NOT NULL` se reflejan en la columna *nullable*.

## Indexes

| índice | tipo | definición |
| --- | --- | --- |
| `documentos_pkey` | PK | `btree (documento_id)` |
| `idx_documentos_empresa` | normal parcial | `btree (empresa_id) WHERE (empresa_id IS NOT NULL)` |
| `idx_documentos_empresa_fiscal` | normal parcial | `btree (empresa_fiscal_id) WHERE (empresa_fiscal_id IS NOT NULL)` |
| `idx_documentos_fecha` | normal | `btree (fecha_documento)` |
| `idx_documentos_hash` | normal parcial | `btree (hash_archivo) WHERE (hash_archivo IS NOT NULL)` |
| `idx_documentos_tipo` | normal | `btree (tipo_documento)` |
| `uq_documentos_empresa_ruta_hash_normalizada` | UNIQUE parcial | `btree (empresa_id, lower(btrim(ruta_archivo)), hash_archivo) WHERE ((empresa_id IS NOT NULL) AND (hash_archivo IS NOT NULL))` |
| `uq_documentos_empresa_ruta_sin_hash_normalizada` | UNIQUE parcial | `btree (empresa_id, lower(btrim(ruta_archivo))) WHERE ((empresa_id IS NOT NULL) AND (hash_archivo IS NULL))` |

## Triggers

| trigger | definición |
| --- | --- |
| `trg_documentos_updated_at` | `BEFORE UPDATE ON core.documentos FOR EACH ROW EXECUTE FUNCTION core.fn_actualizar_updated_at()` |

Detalle: [triggers](../triggers.md).

## Relationships

- **Sale**: `empresa_fiscal_id` → [`core.empresas_fiscales`](core.empresas_fiscales.md) (`empresa_fiscal_id`, ON DELETE CASCADE)
- **Sale**: `empresa_id` → [`core.empresas`](core.empresas.md) (`empresa_id`, ON DELETE CASCADE)
- **Entra**: [`ops.ejecuciones_automatizacion`](ops.ejecuciones_automatizacion.md).`documento_origen_id` → `documento_id` (ON DELETE RESTRICT)

Diagramas: [relationships](../relationships.md).

Vistas que la leen: [`core.vw_carga_empresas_inicial`](../views/core.vw_carga_empresas_inicial.md), [`core.vw_estado_catalogo_empresas`](../views/core.vw_estado_catalogo_empresas.md).

## Roles con permisos

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | R | - |
| `n8n_app` | RI | RI |
| `daubert_hub_test_user` | - | RIUD |

Leyenda: R=SELECT, I=INSERT, U=UPDATE, D=DELETE. Propietario: `postgres` (todos los privilegios).

## Functions que la usan

- **Modifica**: [`core.fn_crear_o_resolver_documento`](../functions/core.fn_crear_o_resolver_documento.md)
- **Lee**: [`ops.fn_resolver_ejecucion_para_reproceso`](../functions/ops.fn_resolver_ejecucion_para_reproceso.md)
- **Trigger**: `trg_documentos_updated_at` → [`core.fn_actualizar_updated_at`](../functions/core.fn_actualizar_updated_at.md)

## Hub consumers

| archivo | capa | operaciones |
| --- | --- | --- |
| `apps/api/src/automations/remisiones-caterpillar/caterpillar-executions.repository.ts` | repository | R |
| `apps/api/src/recent-activity/remisiones-caterpillar-activity.repository.ts` | repository | R |

## n8n consumers

| workflow (export versionado D2) | nodos |
| --- | --- |
| Audi PROD | `Preparar documento origen PG`, `Preparar validación candidato PG`, `Propagar documento PG` |
| Audi TEST | `Preparar documento origen PG`, `Propagar documento PG` |
| Caterpillar PROD | `Detectar archivo REPROCESS CAT1`, `Validar elegibilidad reproceso CAT` |
| Caterpillar TEST | `Detectar archivo REPROCESS CAT1` |

**Indirecto, vía funciones** (el workflow no toca la tabla, llama a la función): `core.fn_crear_o_resolver_documento` (Caterpillar PROD, Caterpillar TEST); `ops.fn_resolver_ejecucion_para_reproceso` (Caterpillar PROD, Caterpillar TEST).

## Riesgos al modificar

- Dos índices únicos parciales (con y sin hash) por (empresa, ruta normalizada): base de la idempotencia de `fn_crear_o_resolver_documento`. Modificarlos rompe la deduplicación.
- No tiene trigger de auditoría.
- `ON DELETE RESTRICT` desde `ops.ejecuciones_automatizacion.documento_origen_id`: no se puede borrar un documento con ejecuciones.
- `DELETE` bloqueado por referencias (`RESTRICT`/`NO ACTION`) desde: `ops.ejecuciones_automatizacion`.

## TEST vs PROD

- Estructura (columnas, tipos, defaults, constraints, índices, triggers): **idéntica**.
- Permisos: **drift real** — Hub PROD (`daubert_hub_app`) = R vs TEST (`daubert_hub_test_user`) = RIUD. Ver [permissions-matrix](../permissions-matrix.md).
