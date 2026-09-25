# Snapshots schema-only

> **Estado: PENDIENTE — generación manual controlada.** En D3 **no** se ejecutó `pg_dump` ni se generó ningún snapshot.

## Por qué no se generaron

`daubert_docs_ro` es un rol de **solo lectura de catálogo**: tiene `USAGE` de esquemas, puede consultar `pg_catalog`/`information_schema` y usar `pg_get_functiondef()`/`pg_get_viewdef()`/`pg_get_indexdef()`, pero **no tiene `SELECT` sobre ninguna tabla de negocio** (verificado con `has_table_privilege`: 0 tablas y 0 vistas). `pg_dump --schema-only` solicita un lock `ACCESS SHARE` sobre cada tabla (`LOCK TABLE … IN ACCESS SHARE MODE`), y ese lock requiere privilegios sobre la tabla (`SELECT`), que `daubert_docs_ro` no tiene; por eso `pg_dump` falla. Es una decisión **deliberada**: el rol no debe poder leer datos, y por eso no se ampliaron permisos (ni `GRANT SELECT ON ALL TABLES`, ni cambios de grants).

## Qué sí existe (equivalente parcial, D3)

| Necesidad | Cobertura en D3 |
| --- | --- |
| Estructura de tablas (columnas, tipos, defaults, PK/FK/UNIQUE/CHECK, índices, triggers) | [tables/](tables/README.md), [integrity-rules](integrity-rules.md), [indexes](indexes.md), [triggers](triggers.md) — extraídas de `pg_catalog` |
| Definiciones de vistas y funciones | [views/](views/README.md), [functions/](functions/README.md); hashes en [test-prod-drift](test-prod-drift.md) |
| Grants | [permissions-matrix](permissions-matrix.md), [roles](roles.md) |

Lo que **no** cubre un snapshot de catálogo hecho así: `COMMENT`s de esquema/tabla completos, opciones de almacenamiento, `reloptions`, estadísticas, orden exacto de creación y DDL reejecutable. No hay un `.sql` reejecutable.

## Procedimiento futuro (propuesto, no ejecutado)

1. Lo ejecuta una persona con un rol **administrativo** (p. ej. `postgres`) desde una estación controlada; **no** `daubert_docs_ro`.
2. `pg_dump` en modo `--schema-only` (sin datos) de `daubert_global` y de `daubert_hub_test`, con `--no-owner` si el destino es comparación; conservar ACLs si se busca un inventario de grants.
3. Guardar fuera del repositorio hasta revisar; verificar que no hay filas (`grep -c "COPY \|INSERT INTO"` debe ser 0) y que no contiene secretos.
4. Comparar `TEST` vs `PROD` con `diff` y registrar el resultado junto a [test-prod-drift](test-prod-drift.md).
5. Decidir si se versiona (por ejemplo bajo `database/schema-snapshots/`) o se conserva solo como evidencia; **decisión PENDIENTE**.

Ver también [operations/database-backup-restore](../operations/database-backup-restore.md) (un backup completo con datos **no** es un snapshot de documentación).
