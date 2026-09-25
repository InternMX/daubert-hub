# Schema `staging`

> Fuente: `pg_namespace`, `pg_class`, `pg_proc`, `pg_constraint` (PROD y TEST). Propietario del esquema: `postgres`. Índice: [schemas](README.md).

## Propósito

Áreas de aterrizaje para cargas históricas (catálogo de productos exportado de BIND y documentos de manufactura). No participan en el runtime del Hub ni de n8n.

## Tablas (4)

- [`staging.bind_productos_raw`](../tables/staging.bind_productos_raw.md) — Exportación cruda de productos del ERP BIND (código, título, SKU, costos, unidades, categorías…) ligada a una carga (`carga_id`).
- [`staging.cargas_fuente`](../tables/staging.cargas_fuente.md) — Cabecera de cada carga de origen (`tipo_fuente`, archivo, fecha de la fuente, observaciones).
- [`staging.manufactura_documentos`](../tables/staging.manufactura_documentos.md) — Documentos de manufactura cargados (archivo, hoja, fecha) ligados a una carga.
- [`staging.manufactura_productos_extraidos`](../tables/staging.manufactura_productos_extraidos.md) — Productos extraídos de un documento de manufactura (código/título crudos, dimensiones, calibre, peso, fabricante/cliente crudos, `confianza`, `requiere_revision`, `datos_adicionales` JSONB).

## Vistas (0)

Ninguna.

## Funciones (0)

Ninguna.

## Sequences (4)

Todas son sequences de PostgreSQL ligadas a columnas (identity o serial); no son series documentales. Ver [sequences](../sequences.md).

## Relaciones

Sin FK hacia otros esquemas.

Diagramas: [relationships](../relationships.md).

## Consumidores

**Ninguno demostrable**: ni `apps/api` ni los workflows versionados referencian `staging.*`, y ningún rol de aplicación tiene grants (solo `postgres`, más `USAGE` de esquema para `daubert_docs_ro`).

## Automatizaciones

Ninguna.

## Roles y permisos (`USAGE` de esquema)

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_docs_ro` | USAGE | USAGE |

Ningún rol de aplicación tiene `CREATE` en el esquema. No hay privilegios por defecto (`pg_default_acl` vacío): los objetos nuevos **no** heredan grants. Detalle: [roles](../roles.md), [permissions-matrix](../permissions-matrix.md).

## Riesgos

- Sin consumidores conocidos: propósito inferido por nombres de tablas/columnas (INFERRED). Confirmar con el responsable antes de retirar.
- Tablas con PK `bigint` + `DEFAULT nextval` (serial), no `IDENTITY`: distinto del resto del modelo.

## Origen, carga y consumo

| Pregunta | Respuesta (evidencia) |
| --- | --- |
| ¿Quién carga? | **No demostrable**: ningún código de `apps/api`, ningún workflow versionado ni ninguna migración citada en D1/D2 escribe en `staging.*`. Los grants (solo `postgres`) implican cargas con un rol administrativo, fuera de las aplicaciones. **UNKNOWN** el script o herramienta |
| ¿Quién consume? | Nadie demostrable. No hay FK, vista ni función que dependa de `staging` |
| ¿Pertenece al Hub actual? | **No**: parece pertenecer a un proceso de integración/carga histórica (catálogo BIND y documentos de manufactura). INFERRED por nombres y tipos (`bind_id uuid`, `clave_cfdi`, `tipo_iva`, `hoja`, `requiere_revision`, `confianza`) |
| Relaciones | `cargas_fuente` (1) → `bind_productos_raw` (N) y `cargas_fuente` (1) → `manufactura_documentos` (N) → `manufactura_productos_extraidos` (N); `UNIQUE (carga_id, bind_id)` en `bind_productos_raw`. Ninguna hacia `core`/`ops`/`operacion` |
| TEST vs PROD | Estructura idéntica; **sin grants** para roles de aplicación en ninguna base |
| Datos | No se consultaron (`daubert_docs_ro` no tiene `SELECT`) |

Diagrama: [relationships](../relationships.md#6-staging--manufactura).


## TEST vs PROD

- Objetos (tablas, vistas, funciones, índices, triggers, sequences): **mismos nombres y estructura** en ambas bases. Diferencias: [test-prod-drift](../test-prod-drift.md).
