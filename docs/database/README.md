# Base de datos (PostgreSQL)

PostgreSQL es la **fuente de verdad operativa** ([ADR-001](../decisions/ADR-001-postgresql-fuente-de-verdad-operativa.md)). Corre en el host Windows, **fuera de Docker**; API y n8n se conectan a ella.

> **Fase D3 (2026-09-24):** el catálogo de este directorio se generó leyendo las bases **reales** (`daubert_global` y `daubert_hub_test`, PostgreSQL 18.4) con el rol `daubert_docs_ro` en transacciones de solo lectura (`transaction_read_only = on` verificado en ambas). No se leyeron datos de negocio, no se ejecutó ninguna función, no se modificó ningún objeto. Donde una migración o documento previo discrepa del catálogo, **manda PostgreSQL** (ver [hallazgos](#hallazgos-principales-d3)).

## Índice

| Documento | Contenido |
| --- | --- |
| [architecture.md](architecture.md) | Arquitectura de alto nivel (Hub / n8n / PostgreSQL), fronteras por schema, inventario real |
| [schemas/](schemas/README.md) | Un archivo por schema: [audit](schemas/audit.md) · [core](schemas/core.md) · [operacion](schemas/operacion.md) · [ops](schemas/ops.md) · [security](schemas/security.md) · [staging](schemas/staging.md) |
| [tables/](tables/README.md) | **31 fichas de tabla** (PK, columnas, FK, unique, check, índices, triggers, permisos, consumidores, riesgos, TEST vs PROD) |
| [views/](views/README.md) | **10 fichas de vista** (definición resumida, fuentes, consumidores, permisos, hash TEST/PROD) |
| [functions/](functions/README.md) | **13 fichas de función** (firma, seguridad, search_path, EXECUTE, tablas, códigos, idempotencia, consumidores) |
| [relationships.md](relationships.md) | Diagramas ER por dominio (Mermaid) e inventario de FK |
| [roles.md](roles.md) | Roles del clúster, atributos, membresías, privilegios de base |
| [permissions-matrix.md](permissions-matrix.md) | Matriz de permisos PROD/TEST por objeto |
| [security-definer.md](security-definer.md) | Las 10 funciones `SECURITY DEFINER`: OK / REVIEW / HIGH_RISK |
| [n8n-app-audit.md](n8n-app-audit.md) | Auditoría de privilegios de `n8n_app` |
| [folios.md](folios.md) | Arquitectura de folios (series, reservas, ajustes, remisiones, locks) |
| [audi-legacy-allocator.md](audi-legacy-allocator.md) | `reservar_folios` (Audi) vs `reservar_folios_para_ejecucion` |
| [indexes.md](indexes.md) | Los 89 índices; críticos destacados |
| [integrity-rules.md](integrity-rules.md) | PK/FK/UNIQUE/CHECK y reglas de negocio protegidas por la base |
| [triggers.md](triggers.md) · [sequences.md](sequences.md) | Triggers (25) y sequences (26; no son series documentales) |
| [migrations.md](migrations.md) | Migraciones versionadas, estado real vs. base (CONFIRMED / INFERRED / UNKNOWN) |
| [test-prod-drift.md](test-prod-drift.md) | Diferencias TEST vs PROD, hashes de funciones y vistas |
| [hub-contract.md](hub-contract.md) · [n8n-contract.md](n8n-contract.md) | Qué objetos usa realmente el Hub y cada workflow |
| [troubleshooting.md](troubleshooting.md) | Guía de problemas de base de datos |
| [data-dictionary.md](data-dictionary.md) | Índice de todos los objetos |
| [schema-snapshots.md](schema-snapshots.md) | Snapshots `pg_dump --schema-only`: **PENDIENTE** (manual controlado) |
| [roles-permissions.md](roles-permissions.md) | Roles y grants desde migraciones (D1); ver corrección en [roles.md](roles.md) |
| [document-series.md](document-series.md) | Series y ajuste seguro de folios (D1) |
| [../operations/database-backup-restore.md](../operations/database-backup-restore.md) | Procedimiento recomendado de backup/restore (no ejecutado; políticas PENDIENTE) |

Contratos por automatización: [Caterpillar](../automations/caterpillar/database-contract.md) · [Audi](../automations/audi/database-contract.md) · [Notificaciones de pago](../automations/payment-notifications/database-contract.md).

## Bases y entornos

| Entorno | Base |
| --- | --- |
| TEST | `daubert_hub_test` |
| PROD | `daubert_global` |

Ver [environments](../00-overview/environments.md).

## Hallazgos principales (D3)

| # | Hallazgo | Estado | Detalle |
| --- | --- | --- | --- |
| 1 | TEST y PROD tienen **la misma estructura** (31 tablas, 10 vistas, 13 funciones, 25 triggers, 89 índices, 342 constraints, 26 sequences); sin objetos `ONLY_TEST`/`ONLY_PROD` | CONFIRMED | [test-prod-drift](test-prod-drift.md) |
| 2 | 6 funciones difieren entre TEST y PROD **solo en comentarios/CRLF**; sin drift funcional | CONFIRMED | [test-prod-drift](test-prod-drift.md#funciones) |
| 3 | **Permission drift**: el Hub usa `daubert_hub_app` (acotado) en PROD y `daubert_hub_test_user` (DML amplio, incluye `audit.cambios` y vistas) en TEST | CONFIRMED | [test-prod-drift](test-prod-drift.md#permisos) |
| 4 | `daubert_hub_app` **sin grants en `core.direcciones`** en PROD, aunque el Hub la usa (contradice D1/migración `20260902_002`) | CONFIRMED (causa UNKNOWN) | [hub-contract](hub-contract.md#brechas-detectadas) |
| 5 | `n8n_app` (rol compartido): 3 privilegios `POSSIBLY_EXCESSIVE`, 1 `REVIEW`, 0 `DELETE` | CONFIRMED | [n8n-app-audit](n8n-app-audit.md) |
| 6 | 10 funciones `SECURITY DEFINER`: 0 `HIGH_RISK`, 1 `REVIEW`; todas propiedad del superusuario `postgres` | CONFIRMED | [security-definer](security-definer.md) |
| 7 | Audi usa un allocator legado (`INVOKER`, sin reserva ni rastro) mientras Caterpillar usa el modelo de reservas | CONFIRMED | [audi-legacy-allocator](audi-legacy-allocator.md) |
| 8 | La migración 009 está aplicada en PROD (el md5 del cuerpo coincide) | CONFIRMED | [migrations](migrations.md#comparación-con-la-base-real-d3) |
| 9 | No hay tabla de control de migraciones; casi todos los objetos no tienen migración versionada en Git | CONFIRMED | [migrations](migrations.md#comparación-con-la-base-real-d3) |
| 10 | `staging.*` y 3 objetos de carga inicial de `core` no tienen consumidores demostrables | INFERRED | [schemas/staging](schemas/staging.md) |
| 11 | Sin retención definida para `audit.cambios`; 4 tablas con `updated_at` sin trigger | CONFIRMED | [schemas/audit](schemas/audit.md), [triggers](triggers.md) |

## Qué NO se pudo verificar (límites de `daubert_docs_ro`)

- **Datos**: series existentes, `siguiente_folio`, pisos, rutas, ejecuciones `PROCESANDO`, reservas huérfanas, conteos de tablas. Se consultan desde el Hub o con un rol autorizado (ver [troubleshooting](troubleshooting.md)).
- **DDL reejecutable / `pg_dump`**: [schema-snapshots](schema-snapshots.md) (PENDIENTE).
- **Directorio externo de migraciones** (Dropbox): fuera del repo; su contenido se conoce solo por D1/D2.
- **Qué rol respalda cada credencial n8n**: se infiere (D1/D2).
- **Workflow de Notificaciones de pago**: export no versionado; su contrato es INFERRED desde D2.

## Metodología (reproducible)

1. Conexión con `daubert_docs_ro` (variables `PGHOST/PGPORT/PGUSER/PGPASSWORD` de la sesión, nunca escritas aquí).
2. `BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'; … ROLLBACK;` y comprobación de `SHOW transaction_read_only`.
3. Consultas solo a `pg_catalog` (`pg_class`, `pg_attribute`, `pg_constraint`, `pg_index`, `pg_trigger`, `pg_proc`, `pg_roles`, `pg_auth_members`, `pg_default_acl`, `pg_depend`, `has_*_privilege`, `pg_get_*def`). Sin `pg_authid`. Sin funciones de negocio.
4. Cruce con `apps/api/src` (regex sobre SQL), `n8n/workflows/**` (D2) y `database/migrations/`.

## Qué falta documentar

- Inventario de valores (datos) de configuración: series, rutas, piso de folio: PENDIENTE (requiere lectura autorizada).
- Retención de `audit.cambios` y purga de `security.sessions`: PENDIENTE (decisión).
- Política de backup: [database-backup-restore](../operations/database-backup-restore.md) (PENDIENTE).

Cierre de la fase: [d3-final-report](d3-final-report.md).
