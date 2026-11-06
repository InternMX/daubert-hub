# Daubert Hub (aplicación)

Monorepo npm workspaces: `apps/api` (NestJS) y `apps/web` (React/Vite). Comandos de desarrollo y validación: `README.md` de la raíz.

| Documento | Contenido |
| --- | --- |
| [architecture.md](architecture.md) | Estructura interna de API y Web, guards, convenciones |
| [api.md](api.md) | Catálogo de endpoints, acceso y códigos de error comunes |
| [authentication.md](authentication.md) | Sesiones, cookie, CSRF por Origin, rate limit, recuperación de admin |
| [authorization.md](authorization.md) | Roles `ADMIN`/`GENERAL` y matriz de acceso |
| [automations.md](automations.md) | Cómo el Hub consume y opera automatizaciones (series, overview, reproceso, revisión, actividad reciente, auditoría) |

## Estado de los módulos

Vista consolidada del proyecto (módulos, pendientes, riesgos): [project-status](../00-overview/project-status.md).

| Módulo | Estado | Profundidad de esta documentación |
| --- | --- | --- |
| Autenticación, usuarios, roles | Implementado | Completa |
| Centro de automatizaciones (overview, series, revisión) | Implementado | Completa a nivel general |
| Caterpillar (monitoreo + reproceso + ajuste de folio) | Implementado y en PROD | [Documentación dedicada](../automations/caterpillar/README.md) |
| Audi (historial + ajuste de folio) | Implementado | [audi](../automations/audi/README.md) · [production-runbook](../automations/audi/production-runbook.md) |
| Notificaciones de pago (dashboard + reproceso + errores de archivo + configuración por empresa) | Implementado y en PROD (configuración por empresa: 2026-09-25) | [payment-notifications](../automations/payment-notifications/README.md) · [configuración por empresa](../automations/payment-notifications/company-configuration.md) |
| Proveedores, Clientes, Contactos, Alias, Direcciones | Implementado (rutas y páginas existen) | Sólo catalogados en [api.md](api.md); comportamiento detallado: PENDIENTE |

Este árbol **no** documenta como terminado nada que no tenga código y tests en el repositorio.
