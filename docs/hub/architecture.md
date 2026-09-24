# Arquitectura interna del Hub

Fuentes: `apps/api/src/main.ts`, `app.module.ts`, `database/*`, `common/*`, `apps/web/src/App.tsx`, `services/*`.

## API (NestJS 11)

### Arranque (`main.ts`)

1. `NestFactory.create(AppModule)` con prefijo global `api`.
2. `helmet` con CSP `default-src 'none'` y `frame-ancestors 'none'` (la API sólo devuelve JSON). **HSTS desactivado** a propósito (ver [architecture general](../00-overview/architecture.md#cloudflare)).
3. `ValidationPipe` global con `transform`, `whitelist` y `forbidNonWhitelisted`: cualquier campo no declarado en un DTO se rechaza (400).
4. `SafeExceptionFilter` global: errores 5xx devuelven siempre `Error interno del servidor.`; 4xx devuelven `{ statusCode, message, code? }`; nunca stack traces ni detalle upstream. El 429 de login añade `Retry-After`.
5. Guard opcional de base viva (`EXPECTED_DATABASE_NAME`, sólo lo fija el launcher de desarrollo).
6. Escucha en `API_PORT` (3000).

### Middleware y guards globales (orden)

| # | Componente | Función |
| --- | --- | --- |
| — | `RequestIdMiddleware` | Genera **siempre en servidor** un UUID por request (`x-request-id`); es el id de correlación de auditoría (`app.request_id`). |
| 1 | `CsrfOriginGuard` | Rechaza requests de navegador cross-site en métodos no seguros. |
| 2 | `AuthGuard` | Exige sesión válida salvo rutas `@Public()`. |
| 3 | `MustChangePasswordGuard` | Bloquea rutas de negocio si `mustChangePassword` es `true`. |
| 4 | `RolesGuard` | Aplica `@Roles(...)` sólo donde se declare. |

### Acceso a datos

- `DatabaseService` mantiene un `pg.Pool` con las variables `DB_*`. Cada repositorio ejecuta SQL parametrizado; no hay ORM.
- Las escrituras que deben auditarse abren transacción y fijan variables de sesión `app.origin`, `app.request_id`, `app.user_id`, `app.user_email` (con `set_config(..., true)`, alcance de transacción). Los triggers genéricos (`audit.fn_registrar_cambio`) las leen para poblar el historial de auditoría.
- Los identificadores `BIGINT` viajan como **string** en toda la API/Web (nunca `Number`), y los IDs de ruta se validan con regex + rango `int8`.

### Módulos

Un módulo por dominio (`providers`, `clients`, `contacts`, `contact-methods`, `contact-directory`, `companies`, `aliases`, `addresses`, `recent-activity`, `automations`, `security`, `health`). Convención: `controller` → `service` → `repository`. Los DTO validan la entrada con `class-validator`.

## Web (React 19 + Vite + MUI)

- Enrutado con `react-router-dom` (`App.tsx`); guards `ProtectedLayout`, `PublicOnlyRoute`, `ChangePasswordRoute`, `AdminRoute`.
- `services/*` encapsulan `fetch` contra `apiBaseUrl` (`/api` por defecto, sobreescribible con `VITE_API_BASE_URL`) y **validan la forma** de cada respuesta antes de usarla.
- `services/httpInterceptor.ts` instala un wrapper global de `fetch`: un `401` fuera de `/auth/*` dispara "sesión expirada"; un `403` con código `PASSWORD_CHANGE_REQUIRED` redirige al cambio de contraseña.
- En desarrollo, Vite hace proxy de `/api` a `http://localhost:3000`. En Docker lo hace Nginx.
- Ocultar/mostrar controles según rol es **UX**; la autoridad es siempre la API.

## Convenciones útiles al leer el código

- Los comentarios citan "Fase N" (p. ej. 12C = reproceso manual Caterpillar, 12B = ajuste de folios, 10I = acuses de revisión, PN1.2 = reproceso de Notificaciones de pago). Son etiquetas históricas del proyecto, no números de versión.
- Estados de ejecución en BD (`PROCESANDO`, `COMPLETADA`, `ERROR`, `CANCELADA`) se traducen a `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED` en API/Web (`audi-processing-status.ts`, compartido por Audi y Caterpillar).
- Estados `ACTIVA`/`INACTIVA` → `ACTIVE`/`INACTIVE`.
