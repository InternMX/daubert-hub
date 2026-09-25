# Backup y restauración

> **Actualización D3:** existe un procedimiento **recomendado** (no ejecutado ni probado) en [database-backup-restore](database-backup-restore.md). Las decisiones de política (ubicación, retención, PITR, responsables) siguen PENDIENTE.

> **Estado: PENDIENTE.** En el repositorio y en los documentos revisados **no existe** un procedimiento exacto de backup/restore de PostgreSQL. Este documento sólo recoge los requisitos que sí están respaldados y lo que hay que definir. No se inventan comandos ni calendarios.

## Lo que sí está respaldado

| Hecho | Fuente |
| --- | --- |
| PostgreSQL corre en el host Windows, fuera de Docker; los contenedores del Hub no guardan datos de negocio (no hay volumen de BD en `compose.pilot.yaml`) | `deploy/README.md`, `compose.pilot.yaml` |
| Antes de aplicar migraciones en PROD hay que **tomar un backup fresco o confirmar que existe recuperación a un punto en el tiempo** de `daubert_global` | `README_DEPLOY.md` del paquete Caterpillar (externo) |
| El estado que importa (folios, ejecuciones, remisiones, usuarios, sesiones, auditoría) está **sólo en PostgreSQL** | [ADR-001](../decisions/ADR-001-postgresql-fuente-de-verdad-operativa.md) |
| Los workflows n8n, sus credenciales y los PDFs/archivos origen **no** están en PostgreSQL | [architecture](../00-overview/architecture.md) |
| Las migraciones y paquetes SQL viven en un directorio de Dropbox (fuera del repo, salvo la 009) | [migrations](../database/migrations.md) |

## Qué debe cubrir un plan de recuperación (a definir)

| Activo | Dónde vive | Decisión pendiente |
| --- | --- | --- |
| Base `daubert_global` (PROD) | PostgreSQL host Windows | Herramienta, frecuencia, retención, ubicación del backup, ¿PITR/WAL archiving? |
| Base `daubert_hub_test` (TEST) | ídem | ¿Se respalda o se reconstruye desde migraciones? |
| Roles de PostgreSQL (`daubert_hub_app`, `n8n_app`, …) | Clúster (globales) | Los roles son globales al clúster: un backup de una sola base no los incluye |
| Workflows y credenciales de n8n | n8n | Exportación versionada; respaldo cifrado de credenciales |
| Archivos origen y PDFs | Dropbox | Historial de versiones/papelera de Dropbox como capa de recuperación |
| Archivos de entorno (`deploy/pilot.*.env`) | Host, no versionados | Custodia segura de secretos |

## Restauración: consideraciones que ya se conocen

- Tras restaurar `daubert_global` hay que **verificar la coherencia entre `siguiente_folio` y el mayor folio realmente emitido** (PDFs y `remisiones`/`reservas_folios`); un contador que retroceda puede reutilizar folios ([document-series](../database/document-series.md)).
- Antes de reactivar n8n tras una restauración, confirmar que **ninguna ejecución `PROCESANDO`** quedó huérfana ([caterpillar/troubleshooting](../automations/caterpillar/troubleshooting.md#11-ejecución-queda-procesando)).
- Ejecutar los `postcheck` de las migraciones aplicadas como verificación de esquema/permisos.

## Siguiente paso (Fase D2)

Definir y probar (con una restauración real en un entorno de prueba) el procedimiento y documentarlo aquí.
