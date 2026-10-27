# Auditoría de limpieza posdespliegue y plan de aplicación de 1.1.0 (2026-10-27)

Complementa [la nota del despliegue conjunto](2026-10-27-hub-pagos-caterpillar-joint-prod.md) y la Fase F del [plan conjunto](../automations/caterpillar/joint-deployment-plan.md#10-fase-f--limpieza-y-cierre-técnico). Inventario **solo de lectura** (git, `docker ps/images/volume/network ls`, listados de carpetas); **no se eliminó nada**. Sin secretos. La producción está abierta: cualquier eliminación requiere autorización explícita, por nombre exacto, sin comodines.

Clasificación: **CONSERVAR** · **ARCHIVAR** (conservar, pero fuera del camino de trabajo) · **CANDIDATO A ELIMINAR** (solo con autorización) · **REVISAR MANUALMENTE**.

## Registro de lo realizado

| Acción | Resultado |
| --- | --- |
| Eliminaciones | **Ninguna** (ni en el repositorio ni en el disco, Docker o n8n). El inventario con identificadores y comandos exactos, pendiente de autorización, está fuera del repositorio en `Documents\Daubert\_archivo_post_release_2026-10-27\_eliminaciones-pendientes_INVENTARIO.md`. |
| Archivado (sin borrar) | `tmp/` del repositorio (3 archivos sin secretos, movidos) y copia de los scripts/procedimiento de la promoción de n8n a `Documents\Daubert\_archivo_post_release_2026-10-27\` con `_registro.md` (SHA-256 de cada uno). |
| Escrituras fuera del repositorio | Ninguna. `npm ci --ignore-scripts` creó `node_modules` y `apps/*/dist` dentro del worktree (ignorados por Git) para ejecutar las pruebas locales. |
| Elementos "inequívocamente prescindibles" | No se encontró ninguno que cumpla el criterio sin riesgo de ser evidencia; todo queda como candidato con autorización. |

## 1. Repositorio

| Elemento | Clasificación | Motivo |
| --- | --- | --- |
| `n8n/workflows/remisiones-caterpillar/candidate-015`, `candidate-5678`, `candidate-5690`, `candidate-016-prod`, `historical/` | **CONSERVAR** | Pruebas del repositorio los usan (`caterpillar-015-candidate.spec.ts`, etc.); `candidate-016-prod` es el origen del workflow publicado y su SHA está en esta documentación. |
| `n8n/workflows/payment-notifications/prod/recovery-promotion.manifest.json`, `recovery-rehearsal-results.json` | **CONSERVAR** | Manifiesto de promoción y resultados del ensayo. Los exports crudos de Pagos **no están versionados** (por diseño; ver más abajo). |
| `scripts/rehearsal/joint/*`, `scripts/rehearse-*.cjs`, `scripts/inventory-ensayo-resources.cjs` | **ARCHIVAR** | Ensayos de la ventana. Útiles para auditoría; consolidar en docs antes de cualquier retiro. |
| `docs/architecture/*.finalize*.json` | **REVISAR MANUALMENTE** | Salidas generadas de documentación; confirmar si siguen siendo fuente. |
| `compose.prod-temp.yaml`, `compose.pilot.yaml` | **CONSERVAR** | El primero cubre variables de PROD en el host de despliegue; el nombre "temp" no implica descartable. |
| `tmp/` (ignorado por Git: `FINAL-DEPLOYMENT.md`, `postdeploy-*.cjs`, 19/10) | **ARCHIVAR** | Notas y sondas del despliegue `cbcb6f3`; fuera del repositorio versionado, pueden contener datos de ese release. Moverlos junto a la evidencia, no borrar. |
| Documentos con estado anterior a este release (`docs/00-overview/project-status.md`, `environments.md`, `joint-deployment-plan.md`, `prod-cutover-016.md`, `production-rollout.md`, `deployment-checklist.md`) | **REVISAR MANUALMENTE** | Aún describen `6370753`/`1.0.6` como "PROD hoy". Se actualizaron `project-status.md`, `environments.md` y `deployment-checklist.md` en esta rama; el resto son registros históricos fechados y se dejan como evidencia. |
| Ramas locales/remotas | ver §3 | |

## 2. Fuera del repositorio

| Ruta | Clasificación | Motivo |
| --- | --- | --- |
| `%LOCALAPPDATA%\DaubertHub\release-artifacts\{pagos-20261027, joint-deploy-20261027}` | **CONSERVAR** | JSON aprobados (hashes en la nota), manifiestos y `joint-migrations-prod.txt`; los README indican que son privados (no versionar los exports). |
| `C:\ProgramData\DaubertHub\Backup` (`*.age` y `*.sha256`), `Documents\Daubert\respaldos-postgres-prod\*.dump` | **CONSERVAR** | Recuperación. Nunca eliminar durante la supervisión. |
| `Documents\Daubert\exports-n8n\{prod,full-test}-20261023.json` | **CONSERVAR** | Export previo de n8n (referencia de rollback). |
| `%LOCALAPPDATA%\DaubertHub\{maintenance-window, rotation-20261012, security, secrets, recovery, staging}` | **CONSERVAR** / **REVISAR MANUALMENTE** `staging` | Evidencia de ventanas y rotación; `staging` (modificado hoy) revisar antes de decidir. No abrir `secrets`. |
| `Documents\Daubert\ensayo-integracion-conjunta\*` (inventario, logs, `joint-migrations-state.json` con credenciales de una BD desechable, clones `combined-lf`, etc.) | **ARCHIVAR**, luego **CANDIDATO A ELIMINAR** | F.1/F.3 del plan conjunto: consolidar resultados en docs (hecho en esta nota) y eliminar tras la supervisión y con autorización. |
| `Documents\Daubert\ensayo-postgres-prod\2026…` (≈172 MB, servidor detenido) | **CANDIDATO A ELIMINAR** | Bases desechables de ensayo. |
| `Documents\Daubert\_archivo_worktrees_retirados_2026-10-22`, `_hub_rollback`, `_registro_limpieza_2026-10-22.md` | **CONSERVAR** | Registro y archivo de una limpieza anterior. |
| `Documents\Daubert\Bind API KEY.txt` | **REVISAR MANUALMENTE** | Nombre sugiere una credencial en texto plano fuera de un almacén seguro. No se abrió. Decidir si se rota o se mueve a `secrets`. |
| `%TEMP%\.tmp*`, `%TEMP%\daubert-*`, `%TEMP%\opencode\*` (scripts B1/W4-A/W4-B, procedimiento) | **ARCHIVAR** los scripts W4-A/W4-B y el procedimiento (evidencia de la promoción); el resto **CANDIDATO A ELIMINAR** | Temporales del sistema. No se tocó nada; `%TEMP%` mezcla cosas ajenas al proyecto. |
| `Documents\Daubert\daubert-hub-*` (9 worktrees) y `ensayo-…\{combined,release,preflight-final}` | **REVISAR MANUALMENTE** | Ver §3. |

## 3. Git: ramas y worktrees

`main` y `origin/main` = `f099e31`. El tag `release-2026-10-27-hub-pagos-cat` está en `origin` y **no se tocó**.

| Elemento | Clasificación |
| --- | --- |
| `main`, `feat/caterpillar-remission-controls` (PR #18 fusionado), `release/hub-conjunto-pagos-caterpillar`, `release/hub-caterpillar-b2` | **CONSERVAR** hasta confirmar la supervisión; después decide el responsable (el plan conjunto ya lo marca). |
| `ensayo/integracion-conjunta-pagos-caterpillar`, ref `refs/sim/relB`, worktrees `ensayo-…/combined` y `preflight-final` (detached en `f099e31`) | **CANDIDATO A ELIMINAR** tras la supervisión, con `git worktree remove` y comprobación previa de cambios sin commit. |
| Ramas ya fusionadas o históricas (`docs/fase-d*`, `fix/*`, `feat/payment-*`) y sus worktrees | **REVISAR MANUALMENTE**: comprobar con `git branch --merged main` cuáles no aportan commits propios. `feat/payment-notification-permanent-alias` y `release/v1.0.6-payment-permanent-alias` no tienen remoto: pueden ser trabajo único. |
| `feat/manufacturing-sheets-coex-baseline` (worktree principal `daubert-hub`) | **CONSERVAR** (trabajo en curso, ajeno a este release). |

## 4. Docker (inventario)

Contenedores de producción: `daubert-hub-api-1` (healthy) y `daubert-hub-web-1`, imágenes `daubert-hub-{api,web}:latest` construidas hoy. **No tocar.**

| Elemento | Clasificación |
| --- | --- |
| Anclas `daubert-hub-{api,web}:rollback-6370753` (versión inmediatamente anterior), `rollback-cbcb6f3`, `rollback-eb600fe`, `rollback-f182c2a`, `rollback-909c37e` | **CONSERVAR** (la regla F.2 prohíbe borrar anclas de PROD; las más antiguas solo se podrían retirar con autorización expresa). |
| Falta ancla `rollback-f099e31` | **REVISAR MANUALMENTE**: el despliegue de `1.1.0` crea la suya; confirmar que exista antes de desplegar. |
| 40 etiquetas `daubert-hub-rbtest{,b,c,d,f,g,h}-{api,web}:*` y 50 contenedores `daubert-hub-rbtest*` (todos detenidos o creados; recuento del 2026-10-27), 7 redes `daubert-hub-rbtest*_pilot` | **CANDIDATO A ELIMINAR** (por nombre exacto; las etiquetas `latest`/`rollback-6370753` comparten imagen con PROD: quitar **solo la etiqueta**, nunca la imagen) |
| Volúmenes (22 en total; el plan conjunto estimó 14 anónimos de ensayo) | **REVISAR MANUALMENTE** por ID verificado, solo después de eliminar su contenedor. |
| `n8n-test-aislado` y su volumen, `daubert-review17-*`, `pg-ensayo-013` | **CONSERVAR** (entornos de prueba vigentes). |

No se ejecutó `prune`, `rm` ni `rmi`.

## 5. Seguridad de dependencias

Propuesta detallada y validada en una copia desechable: [npm-prod-vulnerabilities-proposal](2026-10-27-npm-prod-vulnerabilities-proposal.md) (actualización de lock de `body-parser`/`qs` + override de `multer`; deja 0 vulnerabilidades de producción sin saltar a NestJS 12). No aplicada.

## Pruebas locales de este cambio (sin recursos productivos)

Resultados tras la segunda fase (rama con `.gitattributes` y la corrección de `ContactsPage`):

| Comprobación | Resultado |
| --- | --- |
| `npm ci --ignore-scripts` (el lock es coherente con `1.1.0`) | OK |
| `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:dev-guard` | OK |
| `caterpillar-015-enabled.spec.ts` | **Fallo preexistente, causa CRLF/LF** (no regresión): 38/38 en checkouts LF limpios de `f099e31` y de esta rama; 2 fallos en un checkout CRLF de `f099e31`. Corregido con `.gitattributes` (`candidate-015/** text eol=lf`): 38/38 también en el worktree CRLF de esta rama. |
| API completa (`npm run test:api`) | 150/150 archivos, 2426/2426 pruebas **con variables `DB_*` ficticias definidas**. Sin ellas, las pruebas pasan pero Vitest reporta 3 rechazos no manejados (`Missing required environment variable: DB_HOST`, al importar `app.module`) y sale con código 1; ocurre igual en `f099e31` (preexistente, dependiente del entorno). |
| Web completa (`npm run test:web`) | 87/87 archivos, 1226/1226 pruebas, dos ejecuciones consecutivas. |
| `ContactsPage global creation…` | El fallo inicial **no era un timeout** (2,8 s): una carrera. El aserto de URL se evaluaba en el mismo instante que aparecía el aviso de éxito, y `closeDrawer` actualiza el router un render después. El aserto ahora espera (`waitFor`) igual que los anteriores; no se relajó ninguna validación. 41/41 pasan en 3 ejecuciones aisladas. |
| `apps/api/test/environment.spec.ts` (incluye la prueba de coherencia de versiones) | 18/18 |
| `npm run test:integration` | **No ejecutado**: requiere una base de datos. |

## Plan de aplicación de `1.1.0` a producción

Nada de esto se ejecutó. Requiere autorización; no es una ventana de mantenimiento, el cambio es solo de metadatos (sin migraciones, sin n8n).

1. **Revisión y fusión**: PR de `chore/release-1.1.0-versioning-closeout` hacia `main` (ejecutarlo el responsable). Los 2 fallos de `caterpillar-015-enabled.spec.ts` ya se resolvieron con `.gitattributes`; ejecutar `npm run test:api` con variables `DB_*` ficticias definidas (sin ellas Vitest sale con código 1 por 3 rechazos no manejados, preexistentes).
2. **Anclas y respaldo**: comprobar que las `rollback-6370753` siguen presentes y que hay un respaldo reciente. La ancla `rollback-f099e31` la crea el propio despliegue (paso 5).
3. **Preflight**: `.\scripts\deploy\Deploy-DaubertHub.ps1 -Preflight` desde el checkout de despliegue en `main` (candidato == `HEAD`). Esperado: `WARN` solo por ausencia de migraciones/n8n pendientes; `APP_VERSION=1.1.0`.
4. **Ensayo**: `-WhatIf` con los mismos argumentos; revisar que solo se recrean API y Web, sin tocar PostgreSQL ni n8n.
5. **Despliegue** (`-Deploy -AcknowledgeN8nAlreadyApplied` según el delta; como en los releases 1.0.x, sin cerrar Nginx; la API se recrea y habrá una interrupción breve: confirmar con el responsable que se acepta con producción abierta): el script valida `/api/health` contra `APP_VERSION`.
6. **Verificación**: `/api/health` con `version: 1.1.0` y el commit nuevo; pie de la interfaz `v1.1.0`; `daubert-hub-api-1` healthy; el Schedule de n8n y las 5 ejecuciones `waiting` sin cambios.
7. **Registro**: nota `docs/deployments/` del `1.1.0` y, solo entonces, el tag `v1.1.0`.
8. **Rollback**: anclas `rollback-f099e31` (se crea en el paso 5); n8n y PostgreSQL no cambian.

**Prevención**: antes de cada release, subir la versión en un `chore(release)` y confirmarlo en el preflight; la prueba nueva de `environment.spec.ts` impide que la versión de reserva y los workspaces diverjan de la raíz.
