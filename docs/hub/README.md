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

| Módulo | Estado | Profundidad de esta documentación |
| --- | --- | --- |
| Autenticación, usuarios, roles | Implementado | Completa |
| Centro de automatizaciones (overview, series, revisión) | Implementado | Completa a nivel general |
| Caterpillar (monitoreo + reproceso + ajuste de folio) | Implementado y en PROD | [Documentación dedicada](../automations/caterpillar/README.md) |
| Audi (historial + ajuste de folio) | Implementado | Esqueleto — [audi](../automations/audi/README.md) |
| Notificaciones de pago (dashboard + reproceso) | Implementado | Esqueleto — [payment-notifications](../automations/payment-notifications/README.md) |
| Proveedores, Clientes, Contactos, Alias, Direcciones | Implementado (rutas y páginas existen) | Sólo catalogados en [api.md](api.md); comportamiento detallado: PENDIENTE |

Este árbol **no** documenta como terminado nada que no tenga código y tests en el repositorio.
