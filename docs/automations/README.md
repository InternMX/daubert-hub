# Automatizaciones (n8n)

Las automatizaciones las **ejecuta n8n**; el estado y las reglas de integridad viven en **PostgreSQL**; el Hub las **monitorea y opera de forma acotada** ([hub/automations](../hub/automations.md)).

| Automatización | Código | Estado documental | Documento |
| --- | --- | --- | --- |
| Remisiones Caterpillar | `REMISIONES_CATERPILLAR` | **Completo**, verificado contra el export | [caterpillar/](caterpillar/README.md) |
| Remisiones Audi | `REMISIONES_AUDI` | **Completo** (D2) | [audi/README.md](audi/README.md) |
| Notificaciones de pago | `PAYMENT_NOTIFICATIONS` | **Completo** (D2; export no versionado) | [payment-notifications/README.md](payment-notifications/README.md) |

Documentos transversales de n8n (D2): [n8n-test-prod-drift](n8n-test-prod-drift.md) · [n8n-dependencies](n8n-dependencies.md) · [n8n-paths](n8n-paths.md) · exports e inventario en [`../../n8n/`](../../n8n/README.md).

## Patrón común y diferencias (verificado contra los exports, D2)

- Modelo compartido de remisiones: `ops.automatizaciones` → `ops.ejecuciones_automatizacion` → folios y remisiones ([database/architecture](../database/architecture.md)).
- El Hub lee estado y ofrece acciones administrativas acotadas.

| Aspecto | Caterpillar | Audi | Notificaciones de pago |
| --- | --- | --- | --- |
| Acceso a PostgreSQL desde n8n | **Sólo funciones** `SECURITY DEFINER` | **SQL directo** + allocator legado `reservar_folios` | **SQL directo** sobre `core.*` (sin funciones) |
| Idempotencia | En PostgreSQL (funciones, índices únicos) | Parcial en PostgreSQL (`NOT EXISTS`, estado `COMPLETADA`) y en el workflow | Claves únicas por correo/proveedor **y** un JSON de duplicados de PDF |
| Registro de fallos | `fn_registrar_fallo_ejecucion` (reintentos) | Sólo log en carpeta (ejecución queda `PROCESANDO`) | Estados `ERROR` en correo/borrador/resultado |
| Reproceso desde el Hub | Sí (`ADMIN`) | No | Sí (cualquier usuario autenticado) |
| Error Workflow | Ninguno | Compartido con TEST (sólo log) | Referenciado, **sin export** |

## Plantilla de documentación por automatización

Toda automatización nueva o pendiente debe seguir la estructura de [caterpillar/](caterpillar/README.md):

| Sección | Contenido |
| --- | --- |
| `README.md` | Propósito, qué genera, estado, mapa de documentos |
| `architecture.md` | Componentes y responsabilidades |
| `workflow.md` | Flujo lógico (Mermaid) y nodos importantes para troubleshooting |
| `database-contract.md` | Tablas, funciones, invariantes |
| `reprocessing.md` | Reproceso/reintentos y contrato del webhook (si aplica) |
| `testing.md` | Pruebas y checklist de promoción TEST → PROD |
| `production-runbook.md` | Estado PROD, verificación, rollback |
| `troubleshooting.md` | Casos: síntoma, causa probable, qué revisar, qué NO hacer, acción segura |

## Regla de honestidad documental

Desde la Fase D2 los exports sanitizados están en [`n8n/`](../../n8n/README.md) (excepto Notificaciones de pago: no versionado por contener correos reales; su documentación se derivó del original en Dropbox, sin modificarlo). **El JSON real manda**: si un documento y el export discrepan, se corrige el documento. Lo que no pudo verificarse (p. ej. el Error Workflow de Notificaciones) se marca explícitamente.
