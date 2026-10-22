# Backup y restauración

Índice del estado **actual**. Los procedimientos viven en los documentos enlazados; este archivo solo resume qué se respalda, con qué y dónde recuperar. Sin secretos.

## Qué se respalda hoy

| Activo | Mecanismo | Frecuencia / retención | Documento |
| --- | --- | --- | --- |
| Base `daubert_global` (PROD) | `scripts/backup` (pg_dump + cifrado asimétrico age + SHA-256), tareas `Daubert - PostgreSQL Frequent/Daily/Monthly` | Frequent cada 4 h (7 días) · Daily (30 días, + esquema) · Monthly (12 meses, + roles globales sanitizados) | [postgresql-backup-automation](postgresql-backup-automation.md) |
| n8n (SQLite de workflows y credenciales, `config`, `storage`, `nodes`) | `Start-DaubertN8nBackup.ps1` (snapshot en caliente + 7z + age), tarea `Daubert - n8n Weekly` | Weekly (domingo 04:30, 56 días) · **OnChange manual** antes de cambiar workflows/credenciales (90 días) | [n8n-backup-automation](n8n-backup-automation.md) |
| Hub (imágenes Docker) | Anclas `daubert-hub-<api\|web>:rollback-<commit>` y `docker save` en `_hub_rollback` | En cada release | [deployment-checklist](deployment-checklist.md) |
| Archivos de entorno de PROD | Copia fechada en `_hub_rollback` antes de cada cambio | Manual | [deployment-checklist](deployment-checklist.md) |
| Base `daubert_hub_test` (TEST) | Se reconstruye desde las migraciones; hay volcados puntuales antes de migraciones | Manual | [database/migrations](../database/migrations.md) |
| Archivos origen y PDFs | Dropbox (historial de versiones/papelera) | — | — |

## Recuperación

- PostgreSQL: [database-backup-restore](database-backup-restore.md) (restaurar siempre a una base **nueva** primero). Restore drill ejecutado el 2026-10-01 (PASS); con la clave privada en otra estación: **PENDIENTE**.
- n8n: requisitos y restore drill validado en [n8n-backup-automation](n8n-backup-automation.md#requisitos-para-restaurar). Sin el archivo `config` las credenciales no se pueden descifrar.
- Hub: rollback por imagen en [deployment-checklist](deployment-checklist.md#rollback) (sin `down`).
- La clave privada de age vive fuera del host productor; no está en este repositorio.

## Restauración: consideraciones que ya se conocen

- Tras restaurar `daubert_global` hay que **verificar la coherencia entre `siguiente_folio` y el mayor folio realmente emitido** (PDFs y `remisiones`/`reservas_folios`); un contador que retroceda puede reutilizar folios ([document-series](../database/document-series.md)).
- Antes de reactivar n8n tras una restauración, confirmar que **ninguna ejecución `PROCESANDO`** quedó huérfana ([caterpillar/troubleshooting](../automations/caterpillar/troubleshooting.md#11-ejecución-queda-procesando)).
- Ejecutar los `postcheck` de las migraciones aplicadas como verificación de esquema/permisos.
