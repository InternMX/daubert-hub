# Operaciones

Runbooks generales. Si no hay evidencia suficiente para un procedimiento exacto, se marca **PENDIENTE** en vez de inventarlo.

| Documento | Estado |
| --- | --- |
| [deployment.md](deployment.md) | Documentado (Docker Compose del piloto). Referencia de comandos: [`deploy/README.md`](../../deploy/README.md) |
| [backup-restore.md](backup-restore.md) | **PENDIENTE** (sólo requisitos conocidos) |
| [database-backup-restore.md](database-backup-restore.md) | Procedimiento **recomendado** de backup/restore de PostgreSQL (D3, no ejecutado; políticas PENDIENTE) |
| [troubleshooting.md](troubleshooting.md) | Documentado a nivel de plataforma; Caterpillar tiene su guía propia: [caterpillar/troubleshooting](../automations/caterpillar/troubleshooting.md) |

## Runbooks por módulo

| Módulo | Runbook |
| --- | --- |
| Caterpillar | [production-runbook](../automations/caterpillar/production-runbook.md) |
| Migraciones de BD | [database/migrations](../database/migrations.md) |
| Series/folios | [database/document-series](../database/document-series.md) |
| Base de datos (diagnóstico) | [database/troubleshooting](../database/troubleshooting.md) |
| Audi / Notificaciones de pago | PENDIENTE |

## Principios operativos

1. PostgreSQL y n8n están **fuera de Docker**; reiniciar el stack Docker no los afecta.
2. TEST y PROD se despliegan con `--project-name` y archivo `--env-file` distintos; verifica siempre `environment` en `/api/health` después de desplegar.
3. Ningún despliegue del Hub ejecuta migraciones, ni cambia n8n, ni cambia firewall/router.
4. Los cambios en PROD se registran en `docs/deployments/`.
5. Los secretos viven sólo en los archivos de entorno no versionados y en las credenciales de n8n.
