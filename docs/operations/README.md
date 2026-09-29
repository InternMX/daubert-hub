# Operaciones

Runbooks generales. Si no hay evidencia suficiente para un procedimiento exacto, se marca **PENDIENTE** en vez de inventarlo.

| Documento | Estado |
| --- | --- |
| [deployment.md](deployment.md) | Documentado (Docker Compose del piloto). Referencia de comandos: [`deploy/README.md`](../../deploy/README.md) |
| [backup-restore.md](backup-restore.md) | **PENDIENTE** (sólo requisitos conocidos) |
| [database-backup-restore.md](database-backup-restore.md) | Procedimiento **recomendado** de backup/restore de PostgreSQL (D3, no ejecutado; restauración manual) |
| [postgresql-backup-automation.md](postgresql-backup-automation.md) | Backups automatizados por tiers con **cifrado asimétrico (age)**, más **instalador, preflight y Task Scheduler reproducibles** (config externa `%ProgramData%\DaubertHub\Backup\`, portable entre PCs). **IMPLEMENTED / PENDING PROD VALIDATION** — código y 619 pruebas en verde; age **no instalado todavía**; rol `daubert_backup`, `pgpass` real, par de claves age real y registro real de tareas **PENDIENTE**. Incluye restore drill real de n8n/PostgreSQL (2026-09-28, PASS) |
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
