# Remisiones Caterpillar — exports

| Archivo | Workflow n8n | Entorno | Clasificación | Activo al exportar |
| --- | --- | --- | --- | :-: |
| [`prod/workflow.json`](prod/workflow.json) | `Remisiones CAT Produccion PG` | PROD | PROD actual | sí |
| [`test/workflow.json`](test/workflow.json) | `MANUAL TEST REMISIONES CAT` | TEST | TEST actual | no |
| [`historical/pg-pre-reprocess-candidate.json`](historical/pg-pre-reprocess-candidate.json) | `Remisiones CAT Produccion PG CANDIDATE` | Carpeta de PRUEBAS (`PROMOCION_PROD`), usa credencial PROD | Histórico / posible rollback (requiere revisión manual) | no |

- **Por qué se conserva el histórico:** es el único export del estado PostgreSQL **sin** rama de reproceso; sirve de referencia del cambio 12C y podría ser el rollback mencionado en la [nota de despliegue](../../../docs/deployments/2026-09-24-caterpillar-12c-prod.md). Está **inactivo** y usa la credencial `Postgres produccion`: no activarlo sin revisión.
- **No versionado:** el workflow legado con contadores JSON (mismo `id` que el PROD actual) — ver [inventory](../../inventory.md).
- Sanitización aplicada: [security-notes](../../security-notes.md#campos-sanitizados-copias-versionadas).
- Documentación: [docs/automations/caterpillar/](../../../docs/automations/caterpillar/README.md) · diferencias TEST/PROD: [drift](../../../docs/automations/n8n-test-prod-drift.md#caterpillar).
