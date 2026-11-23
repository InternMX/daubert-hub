# Daubert Hub 1.3.0 — Nota de release

**Liberación productiva completada el 23/11/2026.** Habilita las hojas de Manufactura en PRODUCCIÓN mediante una transición supervisada. No incluye
migraciones (020–024 y 026 ya están aplicadas desde 1.2.0; Caterpillar 025 sigue excluida) ni cambios de n8n. No cambia la lógica funcional de
Manufactura.

## Despliegue del 23/11/2026

| Paso | Resultado |
| --- | --- |
| B3 | Respaldo previo aceptado tras restauración aislada, 20 PASS / 0 FAIL. Evidencia: `verificacion-B3-20261123-150434.txt`. |
| B4 | Paso condicional para BIND. La evidencia revisada no confirma su ejecución. |
| B5 | PROD quedó en v1.3.0, commit `631e3a027e384f55cd469c951c9a5d5212dc9773`, con Manufactura apagada. Se verificaron las identidades de las imágenes API y Web. |
| B6 | Antes de habilitar se confirmó en vivo API sana en `631e3a0`, Manufactura apagada y Nginx CLOSED con política Manufactura (HTTP 503 y `X-Hub-Window: closed-v1`). |
| B7 | PreEnable completo, **35 PASS / 0 FAIL**, ligado a `631e3a0`. Evidencia: `readiness-preenable.txt`. |
| B8 | Activación exitosa mediante el envoltorio temporal v2, tras un plan en seco con `Enable=True Disable=False Apply=False`, exit 0 y bloqueo liberado. |
| B9 | Nginx OPEN y smoke aprobado, según el cierre informado por el operador. **S10:** la generación de un documento productivo real no quedó acreditada. |
| B10 | El operador confirmó la limpieza de credenciales temporales y el cierre del transcript. |
| D1 | Respaldo posterior verificado con restauración aislada, **20 PASS / 0 FAIL**. Evidencia: `verificacion-D1-20261123-153437.txt`. |

Las evidencias operativas se conservan fuera del repositorio, en `_ventana-v130`. El envoltorio se conserva en `_ensayo-v130/hotfix`.

### Incidente B8 y corrección

La plantilla original de `docker inspect` accedía a `.State.Health` y fallaba para Web, cuyo contenedor carece de healthcheck. El error dejaba vacíos también el digest, el ID y la hora de arranque. El envoltorio v1 devolvió exit 3 porque el dot-source reasignaba los parámetros de modo.

`Invoke-SwitchManufactura-Hotfix-v2.ps1` conserva `Enable`, `Disable` y `Apply` antes del dot-source y sustituye en memoria `Get-SwitchContainerFacts`. La lectura mediante `index` conserva los datos de Web con Health vacío y sigue leyendo el estado de salud de API. SHA-256 de v2: `fb0a87c2b6ddbf5c1895e3de982582f01393efe8225e7f55df9ec519254b8e64`.

La corrección permanente se integró después mediante el [PR #45](https://github.com/InternMX/daubert-hub/pull/45), merge commit `59b103fb7e17c162361d892e525ef80b7cf06ec7`. [El CI de main pasó para ese SHA](https://github.com/InternMX/daubert-hub/actions/runs/45274155555). El commit desplegado durante la ventana fue `631e3a027e384f55cd469c951c9a5d5212dc9773`.

### Contingencia R1 con el checkout operativo en 631e3a0

La ruta `-Disable` del envoltorio v2 aún no se ha validado operativamente. Ejecutar este procedimiento solo en una ventana autorizada.

1. Verificar el SHA-256 de v2 indicado arriba y confirmar que el checkout operativo está limpio en el commit desplegado. Cerrar Nginx con la política Manufactura autorizada y comprobar `CLOSED`.
2. Ejecutar `Invoke-SwitchManufactura-Hotfix-v2.ps1 -Disable`. Exigir `Enable=False Disable=True Apply=False`, `PLAN: retirar overlay` y exit 0.
3. Con autorización expresa para aplicar, ejecutar el mismo envoltorio con `-Disable -Apply`. Exigir exit 0, `MANUFACTURA_SWITCH_OK accion=Disable`, API verificablemente apagada y ausencia del overlay activo.
4. Recargar Nginx con `Reload -ExpectState Closed`. Reabrir únicamente tras verificar la transición y obtener autorización. Si el plan falla o la transición queda indeterminada, mantener el cierre y escalar. Exit 6 activa la contingencia R2.

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
  apagada). Para desplegar otra versión, completar primero la desactivación supervisada según R1 cuando aplique y volver a habilitar con un PreEnable nuevo tras el despliegue.
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

## Procedimiento previsto para la ventana (referencia histórica)

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
| Fallo funcional tras habilitar | Seguir la contingencia R1 documentada arriba mientras el checkout operativo conserve el Switch original. |
| Estado indeterminado (exit 6) o fallo de imágenes | Reversión de **ambas** imágenes a 1.2.0: etiquetar `:latest` como `failed-<X>`, `rollback-22d8916` → `:latest` (api y web), retirar el overlay activo a `historial` y comprobar que ya no existe, `docker compose … up -d --no-build api web` **sin** el overlay y con `MANUFACTURING_ENABLED=false` en la sesión, `Reload`. Terminada solo si: `/api/health` = `22d8916`, el overlay activo no existe y la API está verificablemente apagada (`ConvertFrom-DaubertContainerEnv` = `Apagado`) |
| Esquema | No se revierte: las migraciones son compatibles con 1.2.0 y los documentos se conservan |

Las imágenes de 1.2.0 no se borran ni se reetiquetan durante el release.
