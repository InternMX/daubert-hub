# Operaciones

Runbooks generales. Si no hay evidencia suficiente para un procedimiento exacto, se marca **PENDIENTE** en vez de inventarlo.

| Documento | Estado |
| --- | --- |
| [deployment.md](deployment.md) | Documentado (Docker Compose del piloto). Referencia de comandos: [`deploy/README.md`](../../deploy/README.md) |
| [deployment-checklist.md](deployment-checklist.md) | Checklist PRE-DEPLOY / DEPLOY / POST-DEPLOY / ROLLBACK de PROD con el preflight de solo lectura `scripts/deploy/Test-DaubertDeployPreflight.ps1` (preparado, **no ejecutado** en PROD) |
| [diagnose-daubert-server.md](diagnose-daubert-server.md) | Diagnóstico **de solo lectura** del host (`scripts/server/Diagnose-DaubertServer.ps1`): red, firewall, Docker, PostgreSQL, n8n, Dropbox, energía, arranque, backups y estado objetivo del servidor. **No configura nada** |
| [backup-restore.md](backup-restore.md) | **PENDIENTE** (sólo requisitos conocidos) |
| [database-backup-restore.md](database-backup-restore.md) | Procedimiento **recomendado** de backup/restore de PostgreSQL (D3, no ejecutado; restauración manual) |
| [postgresql-backup-automation.md](postgresql-backup-automation.md) | Backups automatizados por tiers con **cifrado asimétrico (age)**, más **instalador, preflight y Task Scheduler reproducibles** (config externa `%ProgramData%\DaubertHub\Backup\`, portable entre PCs). **IMPLEMENTED y en operación real contra `daubert_global`** — backups reales de los tres tiers con SHA-256 verificado, tareas registradas en Task Scheduler (Daily/Monthly con reintento horario `-OnlyIfDue`) y 884 pruebas en verde; restore drill real de un backup Daily de esta automatización el 2026-10-01 (PASS, base temporal `daubert_restore_20261001`, ya eliminada); **pendiente**: repetirlo con la clave privada en otra estación. Incluye restore drill real de n8n/PostgreSQL (2026-09-28, PASS) |
| [troubleshooting.md](troubleshooting.md) | Documentado a nivel de plataforma; Caterpillar tiene su guía propia: [caterpillar/troubleshooting](../automations/caterpillar/troubleshooting.md) |

## Runbooks por módulo

| Módulo | Runbook |
| --- | --- |
| Caterpillar | [production-runbook](../automations/caterpillar/production-runbook.md) |
| Migraciones de BD | [database/migrations](../database/migrations.md) |
| Series/folios | [database/document-series](../database/document-series.md) |
| Base de datos (diagnóstico) | [database/troubleshooting](../database/troubleshooting.md) |
| Notificaciones de pago | [production-runbook](../automations/payment-notifications/production-runbook.md) · alta de empresas: [company-configuration](../automations/payment-notifications/company-configuration.md) |
| Audi | PENDIENTE |

## Principios operativos

1. PostgreSQL y n8n están **fuera de Docker**; reiniciar el stack Docker no los afecta.
2. TEST y PROD se despliegan con `--project-name` y archivo `--env-file` distintos; verifica siempre `environment` en `/api/health` después de desplegar.
3. Ningún despliegue del Hub ejecuta migraciones, ni cambia n8n, ni cambia firewall/router.
4. Los cambios en PROD se registran en `docs/deployments/`.
5. Los secretos viven sólo en los archivos de entorno no versionados y en las credenciales de n8n.
