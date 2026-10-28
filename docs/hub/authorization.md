# Autorización

Fuentes: `security/roles.guard.ts`, `security/route-access.decorators.ts`, `security/users.types.ts`, controladores, `apps/web/src/auth/RouteGuards.tsx`.

## Roles

`UserRole = 'ADMIN' | 'GENERAL'` (estado de usuario: `ACTIVE` / `INACTIVE`).

## Modelo: abierto por defecto para autenticados, restringido por decorador

- `AuthGuard` hace **seguro por defecto**: toda ruta exige sesión salvo `@Public()`.
- `RolesGuard` **sólo restringe donde se declara `@Roles(...)`**. Una ruta autenticada sin `@Roles` está abierta a `ADMIN` y `GENERAL`. Esto es intencional (Fase 6: aditivo, no un nuevo default restrictivo).
- Un rol no permitido recibe `403` con `code: ROLE_NOT_ALLOWED`. Falta de sesión: `401`.

> Consecuencia operativa: una **ruta nueva** que deba ser sólo de administración **debe** declarar `@Roles('ADMIN')` explícitamente; si no, quedará abierta a `GENERAL`.

## Matriz de acceso

| Capacidad | ADMIN | GENERAL | Cómo se aplica |
| --- | :---: | :---: | --- |
| Datos maestros (proveedores, clientes, contactos, direcciones, alias) | ✔ | ✔ | Sin `@Roles` |
| Ver automatizaciones, historial, detalle, series | ✔ | ✔ | Sin `@Roles` |
| Acuse de revisión de un problema de automatización | ✔ | ✔ | Sin `@Roles` (acción operativa) |
| Reproceso y asignación puntual de archivos de Notificaciones de pago | ✔ | ✔ | Sin `@Roles` (acción operativa; ver «Decisiones abiertas») |
| Configuración de Pagos por empresa (ruta Dropbox, destinatarios, «Procesa comprobantes», «Generar borradores») | ✔ | ✔ | Sin `@Roles` (`payment-notification-settings.controller.ts`) |
| **Ajustar `siguiente_folio` de una serie** | ✔ | ✘ | `@Roles('ADMIN')` a nivel de método |
| **Reproceso manual Caterpillar** | ✔ | ✘ | `@Roles('ADMIN')` a nivel de método |
| **Regeneración comercial y cancelación individual de remisiones Caterpillar** | ✔ | ✘ | `@Roles('ADMIN')` a nivel de método (`caterpillar.controller.ts`) |
| **Auditoría administrativa** (`/api/audit`) | ✔ | ✘ | `@Roles('ADMIN')` a nivel de clase |
| **Administración de usuarios** (`/api/users/*`) | ✔ | ✘ | `@Roles('ADMIN')` a nivel de clase |
| Rutas web `/users*` | ✔ | ✘ | `AdminRoute` (UX; la API es la autoridad) |

## Notas

- El ajuste de folios endureció también el ajuste de Audi, que antes no tenía restricción de rol (comentario en `automations.controller.ts`, Fase 12B.2).
- Hoy **no** hay permisos granulares por módulo/cliente/planta: sólo los dos roles.
- Ocultar botones en la web (p. ej. "Reprocesar" sólo visible a `ADMIN` con ejecución `FAILED`/`CANCELLED`) es UX. Un usuario `GENERAL` que llame al endpoint directamente recibe `403`.

## Decisiones abiertas (auditoría 2026-10-28)

Pagos y los datos maestros no restringen acciones sensibles a `ADMIN`, mientras que Caterpillar sí. Esto es el comportamiento **actual**, no una política aprobada como definitiva; qué acciones deben pasar a `ADMIN` es una decisión de negocio pendiente (P-09 en [pendientes](../00-overview/pending-and-roadmap.md#4-riesgos-operativos-pendientes)). No se ha cambiado ningún rol.

## Autorización hacia n8n y PostgreSQL (no es de usuarios)

- Hub → n8n: token compartido en header `X-Daubert-Automation-Token`, sólo server-side ([caterpillar/reprocessing](../automations/caterpillar/reprocessing.md#seguridad)).
- Hub → PostgreSQL: rol `daubert_hub_app` de mínimo privilegio ([database/roles-permissions](../database/roles-permissions.md)).
