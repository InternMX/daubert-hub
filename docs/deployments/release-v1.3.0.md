# Daubert Hub 1.3.0 — Nota de release

Estado: **candidato, sin desplegar.** Habilita las hojas de Manufactura en PRODUCCIÓN mediante una transición supervisada. No incluye
migraciones (020–024 y 026 ya están aplicadas desde 1.2.0; Caterpillar 025 sigue excluida) ni cambios de n8n. No cambia la lógica funcional de
Manufactura.

## Alcance

| Cambio | Archivos |
| --- | --- |
| Estabilización del CI web (consultas acotadas y escenarios divididos, mismas 423 aserciones, sin cambios de timeouts) | `apps/web/src/manufacturing/ManufacturingSpecificationPage.test.tsx` |
| Las imágenes de release nunca se sobrescriben (etiquetas `release-<commit>`, manifiesto y tar) | `scripts/deploy/New-ReleaseImages.ps1` |
| Readiness: comparación de imágenes por digest de plataforma (compatible con containerd) y evaluación base + overlay (`-EnvOverlay`) | `scripts/deploy/Test-ManufacturaReleaseReadiness.ps1` |
| Activación supervisada con compensación (solo `api`, mismo commit, mismas imágenes) | `scripts/deploy/Switch-Manufactura.ps1`, `scripts/deploy/DaubertOps.Common.psm1` |
| `Close` rechaza la política Operativa con Manufactura habilitada; bloqueo de operación compartido | `scripts/deploy/Set-EntryClosure.ps1` |
| `Deploy` se niega mientras Manufactura esté habilitada | `scripts/deploy/Deploy-DaubertHub.ps1` |
| La interfaz de Manufactura (compilada en la imagen Web) solo se muestra si la API confirma el módulo (`capabilities` 200); ante 404/401/5xx/red, oculta y con aviso en acceso directo | `apps/web/src/manufacturing/manufacturaDisponible.ts`, `RequiereManufactura.tsx`, `App.tsx`, `AppShell.tsx`, `AutomationsPage.tsx`, `ProfilePage.tsx`, `ClientDetailPage.tsx`, `UserDetailPage.tsx`, `UsersPage.tsx` y sus pruebas |
| Versión 1.3.0 | `package.json` (raíz, API, Web), `package-lock.json`, `DEFAULT_APP_VERSION` |

## Reglas operativas de esta versión

- **Prohibido ejecutar `Deploy-DaubertHub.ps1` con Manufactura habilitada.** La compuerta lo bloquea (overlay activo o API no verificablemente
  apagada). Para desplegar otra versión: `Switch-Manufactura.ps1 -Disable -Apply`, desplegar, y volver a habilitar con un PreEnable nuevo.
  La conservación del overlay dentro de `Deploy` queda para una versión posterior.
- La habilitación solo se hace con `Switch-Manufactura.ps1 -Enable -Apply` dentro de una ventana cerrada con `-Policy Manufactura`, con
  readiness `PreEnable` completo de menos de 2 h para el commit en ejecución. Nunca con `docker compose` manual ni editando `deploy/pilot.prod.env`
  (la base puede conservar `MANUFACTURING_ENABLED=false` o vacía; la habilitación la aporta el overlay canónico, SHA-256
  `3b540e4e9f3a335f6eed213a0af33c935f31fa01c687f5e6c9cad3d8aa23396a`).
- Con Manufactura habilitada, cualquier `Close` exige `-Policy Manufactura`.
- `Deploy` **nunca** habilita Manufactura: rechaza cualquier configuración efectiva con `MANUFACTURING_ENABLED=true` (archivo base o sesión), aunque exista evidencia PreEnable válida.
- `Deploy`, `Switch-Manufactura`, `Set-EntryClosure` (salvo `Status`) y `New-ReleaseImages -Build` comparten un bloqueo de operación (`…\DaubertHub\locks\operacion.lock`): no pueden intercalarse. `Deploy` revalida el estado de Manufactura bajo ese bloqueo después de la confirmación.
- `Switch-Manufactura` exige además el manifiesto de imágenes autorizado (`-ImagesManifest`, `-ImagesManifestSha256`): las etiquetas `release-<X>` deben seguir siendo las imágenes validadas.
- Limitación conocida de la Web: tras un `Switch-Manufactura -Disable`, una sesión ya abierta conserva el menú hasta navegar a una pantalla de Manufactura (que revalida y muestra el aviso) o recargar; el backend responde 404 en todo caso.

## Procedimiento resumido (requiere autorización expresa en cada paso)

1. CI verde sobre el SHA candidato y, tras el merge, sobre el SHA final de `main`.
2. Antes de construir: comprobar que `daubert-hub-{api,web}:release-<X>` no existen y que `release-22d8916`, `rollback-de13370` y las imágenes
   en ejecución siguen intactas. Construir una sola vez: `New-ReleaseImages.ps1 -Commit <X> -Build -ManufacturingUi -SaveDir … -Manifest …`.
   Si la versión de Chromium del manifiesto difiere de la aprobada (156.0.8078.79), repetir la comparación automática de los ocho formatos.
3. Ventana: `Close -Policy Manufactura` → respaldo verificado → `Deploy -UseValidatedImages -ClosurePolicy Manufactura …` con la API apagada
   (crea `rollback-22d8916`) → `Reload -ExpectState Closed` → overlay canónico en `…\DaubertHub\manufactura\preparada\manufactura.env` →
   readiness `PreEnable` con `-EnvOverlay` y `-NginxConf …\default.conf.open` → `Switch-Manufactura -Enable -Apply` → `Reload -ExpectState Closed`
   → `Open` → smoke → respaldo con documentos verificado.

## Reversión

| Situación | Acción |
| --- | --- |
| La activación falla | `Switch-Manufactura` compensa a apagado por sí mismo (exit 5) |
| Fallo funcional tras habilitar | `Switch-Manufactura -Disable -Apply` y `Reload` |
| Estado indeterminado (exit 6) o fallo de imágenes | Reversión de **ambas** imágenes a 1.2.0: etiquetar `:latest` como `failed-<X>`, `rollback-22d8916` → `:latest` (api y web), retirar el overlay activo a `historial` y comprobar que ya no existe, `docker compose … up -d --no-build api web` **sin** el overlay y con `MANUFACTURING_ENABLED=false` en la sesión, `Reload`. Terminada solo si: `/api/health` = `22d8916`, el overlay activo no existe y la API está verificablemente apagada (`ConvertFrom-DaubertContainerEnv` = `Apagado`) |
| Esquema | No se revierte: las migraciones son compatibles con 1.2.0 y los documentos se conservan |

Las imágenes de 1.2.0 no se borran ni se reetiquetan durante el release.
