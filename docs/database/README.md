# Base de datos (PostgreSQL)

PostgreSQL es la **fuente de verdad operativa** ([ADR-001](../decisions/ADR-001-postgresql-fuente-de-verdad-operativa.md)). Corre en el host Windows, **fuera de Docker**; API y n8n se conectan a ella.

| Documento | Contenido |
| --- | --- |
| [architecture.md](architecture.md) | Esquemas, tablas clave, relaciones (diagrama ER), funciones `SECURITY DEFINER` |
| [migrations.md](migrations.md) | Ubicación, naming, up/down, precheck/postcheck, proceso recomendado |
| [roles-permissions.md](roles-permissions.md) | Roles, mínimo privilegio, grants relevantes, riesgos |
| [document-series.md](document-series.md) | Series documentales, folios, reservas, ajuste seguro |

Contrato específico de Caterpillar sobre estas tablas: [caterpillar/database-contract.md](../automations/caterpillar/database-contract.md).

## Bases y entornos

| Entorno | Base |
| --- | --- |
| TEST | `daubert_hub_test` |
| PROD | `daubert_global` |

Ver [environments](../00-overview/environments.md).

## Qué NO está documentado todavía (PENDIENTE)

- DDL completo y catálogo exhaustivo de columnas de `core.*` (empresas, contactos, direcciones): los DDL base viven en el directorio de migraciones **externo** al repo (p. ej. `001_daubert_hub_base_v2.sql` en `daubert_hub_test/`), no versionados aquí.
- Esquema `audit` (estructura de `audit.cambios` y de `audit.fn_registrar_cambio`): sólo se conoce su uso desde el código y las migraciones.
- Inventario oficial de qué migraciones están aplicadas en cada base (no existe una tabla de control de migraciones en lo inspeccionado): ver [migrations.md](migrations.md#estado-de-aplicación).
- Procedimiento de backup/restore: [operations/backup-restore.md](../operations/backup-restore.md).
