# Diferencias funcionales de la rama respecto a `main` (v1.1.0) que pueden afectar módulos existentes

Estado: **reporte, sin cambios**. No se modificó ninguna función operativa de PROD. Base de comparación: `git diff main...feat/manufacturing-sheets-coex-baseline` (133 commits, 472 archivos). Solo se analiza lo que **no** es Manufactura; lo propio de Manufactura se describe en `manufactura-produccion-diagnostico.md`.

## 1. Alcance real
- **API:** fuera de `manufacturing-*`, la rama toca **8 archivos** de producción: `app.module.ts`, `main.ts`, `config/environment.ts`, `config/validation-pipe.ts`, `clients/clients.controller.ts`, `recent-activity/{controller,module,service}.ts`. **No toca** `automations/*` (Caterpillar, Audi, Notificaciones de Pago), `auth`, `security`, `database` ni `common`.
- **Web:** `App.tsx`, `AppShell.tsx`, `automations/{AutomationsPage,automationRoutes}`, `components/RecentActivity.tsx`, `clients/{ClientsPage,ClientDetailPage}`, `users/{UsersPage,UserDetailPage}` más páginas/servicios nuevos.
- **Base de datos:** el código existente **no** requiere ningún objeto nuevo; solo Manufactura (esquema `manufactura`). Ninguna migración 012–016 es necesaria para que Caterpillar, Audi o Pagos sigan funcionando.
- **Dependencias:** `jpeg-js`, `pngjs` (producción) y `@types/pngjs` (desarrollo); `package-lock.json` +28 líneas.

## 2. Cambios de comportamiento visibles para usuarios existentes (se activan al desplegar el código, independientemente de la base)
| # | Cambio | Quién lo nota | Riesgo / comentario |
|---|---|---|---|
| D1 | **Clientes: alta, edición, desactivar y reactivar son solo ADMIN** (`@Roles('ADMIN')` en 4 rutas; `403 ROLE_NOT_ALLOWED`). La lista y el detalle siguen abiertos. En la web se oculta «Nuevo cliente» a GENERAL | Cuentas GENERAL | Hoy PROD tiene **4 ADMIN y 0 GENERAL** (inventario del 2026-11-05): ningún usuario actual pierde acceso, pero cambia la política para futuras cuentas GENERAL. Decisión ya aprobada para TEST; confirmar para PROD |
| D2 | **Menú «Hojas de manufactura»** y tarjeta «Proceso asistido» en Automatizaciones; **«Mi perfil»** (nuevo) en el menú de cuenta | Todos | Visual. La tarjeta es estática (no sale del catálogo de automatizaciones ni toca `ops.automatizaciones`) |
| D3 | **Actividad reciente** añade eventos de Manufactura y un campo opcional `link` en los elementos (se muestra como enlace) | Todos | La consulta de Manufactura se omite si no existe `manufactura.revisiones` (`to_regclass`); el contrato anterior de la API se conserva. El controlador ahora pasa la identidad de la sesión al servicio |
| D4 | **Detalle de cliente** muestra la sección «Abreviaturas» (llama a `/api/manufacturing-sheets/documents/abbreviations…`) | Todos al abrir un cliente activo | **Mientras `TestOnlyGuard` siga activo, esa llamada responde 404 en PROD y la sección mostrará «Esta función no está activa en este entorno»** en una pantalla ya existente. Resolver junto con la sustitución del guard (o desplegar la 015 + guard) |
| D5 | **Usuarios**: enlace a firmas de un usuario (`/users/signatures`) y página nueva `UserSignaturesPage` | ADMIN | Depende de los endpoints de firmas (mismo caso que D4: 404 sin guard cambiado) |
| D6 | **Mi perfil → Mis firmas** | Todos | Igual que D4/D5 hasta habilitar el gestor |

## 3. Cambios de configuración y arranque
| # | Cambio | Comentario |
|---|---|---|
| C1 | `config/environment.ts`: nueva sección `bind` con validación **al arrancar**: `BIND_API_BASE_URL` (si se define) debe ser `https://*.bind.com.mx` sin credenciales ni puerto; si no, **la API no arranca**. `BIND_API_KEY` y `BIND_SUBSCRIPTION_KEY` son opcionales (sin clave, la consulta responde `NOT_CONFIGURED` en tiempo de llamada) | No definir `BIND_API_BASE_URL` en `deploy/pilot.prod.env` salvo necesidad |
| C2 | `main.ts`: el `ValidationPipe` global ahora sale de `createGlobalValidationPipe()` con **las mismas opciones** que antes (`transform`, `whitelist`, `forbidNonWhitelisted`) | Sin cambio de comportamiento para DTO existentes (verificado en el diff) |
| C3 | `app.module.ts` registra `ManufacturingSheetsModule` y `ManufacturingDocumentsModule` | Aparecen rutas `/api/manufacturing-sheets/*` (BIND, vista previa, PDF de borrador → 501 sin Chrome) y las del gestor documental (404 por `TestOnlyGuard`) |
| C4 | `nest-cli.json`: se copian plantillas, herramientas y perfiles de Manufactura a `dist/` | La imagen de la API crece levemente |
| C5 | `package.json`: dependencias nuevas de producción (`jpeg-js`, `pngjs`) | `npm ci --omit=dev` las instala; revisar auditoría de dependencias antes de construir la imagen |
| C6 | `vite.config.ts` (solo pruebas): fuerza `VITE_MANUFACTURING_DOCUMENTS=false` | Sin efecto en producción; para activar el gestor la compilación de PROD debe pasar `VITE_MANUFACTURING_DOCUMENTS=true` |

## 4. Lo que NO cambia
- Código de Caterpillar, Audi y Notificaciones de Pago (API y n8n), rutas de n8n, credenciales y webhooks.
- Autenticación, sesiones, CSRF/origen y guards globales (el gestor y las abreviaturas solo añaden controladores autenticados).
- Funciones, tablas, vistas, triggers y privilegios existentes de la base: las migraciones 012–016 crean únicamente el esquema `manufactura` (verificado con huellas de catálogo, ACL incluidas, antes y después).

## 5. Recomendaciones (sin implementar todavía)
1. **Resolver D4–D6 junto con el guard**: o se despliega la API con el guard sustituido y las migraciones aplicadas (flujo completo), o se oculta provisionalmente la sección de abreviaturas / firmas. No conviene desplegar el código con las pantallas visibles y el backend en 404.
2. **Regresión previa a la liberación** de las pantallas existentes tocadas (Clientes, Usuarios, Automatizaciones, Actividad reciente, menú y perfil) además de Caterpillar/Audi/Pagos.
3. Confirmar D1 con quien administra cuentas, y comunicar el cambio.
4. Mantener `BIND_API_BASE_URL` sin definir en PROD.
