# Automatizaciones (n8n)

Las automatizaciones las **ejecuta n8n**; el estado y las reglas de integridad viven en **PostgreSQL**; el Hub las **monitorea y opera de forma acotada** ([hub/automations](../hub/automations.md)).

| Automatización | Código | Estado documental | Documento |
| --- | --- | --- | --- |
| Remisiones Caterpillar | `REMISIONES_CATERPILLAR` | **Completo** (módulo piloto) | [caterpillar/](caterpillar/README.md) |
| Remisiones Audi | `REMISIONES_AUDI` | Esqueleto (PENDIENTE) | [audi/README.md](audi/README.md) |
| Notificaciones de pago | `PAYMENT_NOTIFICATIONS` | Esqueleto (PENDIENTE) | [payment-notifications/README.md](payment-notifications/README.md) |

## Patrón común (observado en Caterpillar y Audi)

- Modelo compartido: `ops.automatizaciones` → `ops.ejecuciones_automatizacion` → reservas de folios y remisiones ([database/architecture](../database/architecture.md)).
- n8n opera con un rol de mínimo privilegio y funciones `SECURITY DEFINER`.
- Idempotencia garantizada en PostgreSQL, no en el workflow.
- El Hub lee estado y ofrece acciones administrativas acotadas.

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

Los workflows n8n **no están versionados en este repositorio**. Cualquier descripción de su lógica interna se etiqueta como *Descripción de proyecto* hasta verificarse contra el export del workflow ([pendiente Fase D2](../README.md#pendientes-transversales-candidatos-a-fase-d2)).
