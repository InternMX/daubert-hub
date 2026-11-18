# Integración aislada de `main` en la rama de Manufactura (v1.2.0 candidata) · Fase 2

Estado: **integración en la rama temporal `integ/main-into-manufactura-tmp` (worktree aislado). La rama real `feat/manufacturing-sheets-coex-baseline` sigue en `b3dfc61` y `main` no se modificó.** Pruebas funcionales completas: pendientes (Fase 3).

## Historial resultante
- Base común: `304c6d5`. Nuestra rama: `b3dfc61` (136 commits propios). `main` local al iniciar: `6909dc8` (v1.1.0, 75 commits por delante).
- **Merge 1 (`46bba42`)**: `b3dfc61` + `main 6909dc8`. Un conflicto.
- **Merge 2 (`e2470fd`)**: el `main` local avanzó mientras se trabajaba (de forma externa a esta tarea) a `16153a8` (v1.1.1): `9248c28` (documentación v1.1.0, la misma que figuraba solo en `origin/main`), `2f37ba8` (errores largos de Caterpillar) y `16153a8` (versión 1.1.1). Se integró en un segundo merge sin conflictos para que la candidata parta del `main` vigente. Es separable: bastaría con `git reset` de la rama temporal a `46bba42`.
- No se hizo fetch: `origin/main` coincide hoy con `main` local (`16153a8`).

## Conflictos y resoluciones
| Archivo | Conflicto | Resolución |
|---|---|---|
| `apps/api/.env.example` | Ambas ramas añadieron bloques al final | Se conservan **los dos**: BIND + PDF de Manufactura (propios) y `PAYMENT_FILE_ASSIGNMENTS_*` (TEST y PROD) de `main`, separados por una línea en blanco. Sin variables duplicadas ni contradictorias |

## Archivos modificados por ambos lados (auto-fusionados, revisados)
| Archivo | Qué aporta cada lado | Resultado |
|---|---|---|
| `apps/api/src/config/environment.ts` | Manufactura: sección `bind` y validación de `BIND_API_BASE_URL`. `main`: banderas de asignación de archivos de Pagos y versión de respaldo | Ambos presentes; `DEFAULT_APP_VERSION = '1.1.1'` (de `main`) |
| `apps/api/test/environment.spec.ts` | `main`: la versión esperada sale de `package.json` raíz | Se conserva la de `main`; las pruebas de `bind` (propias) siguen |
| `apps/api/package.json` | Rama: scripts `test:sheets-*`, `test:desechable`, `jpeg-js`, `pngjs`. `main`: scripts `test:integration:payment-*`, `@electric-sql/pglite` | Unión de ambos; versión 1.1.1 |
| `package-lock.json` | `main`: versiones 1.1.1, `multer` 2.5.0 (parche de seguridad), `pglite`. Rama: `jpeg-js`, `pngjs` | Consistente: `npm ci` termina sin cambios |
| `docs/hub/api.md` | Rama: fila de clientes (alta/edición solo ADMIN). `main`: fila del reproceso de Pagos con asignaciones puntuales | Ambas filas con su texto actualizado |
| `docs/operations/README.md` | Enlaces propios y de `main` | Unión |

## Verificación de que no se perdió nada
Clasificación de 3 vías por archivo (base · nuestra rama · `main` · resultado): **795 archivos en el merge 1 y 534 en el merge 2, 0 anomalías** — todo archivo cambiado solo por `main` quedó idéntico a `main`, todo archivo cambiado solo por la rama quedó idéntico a la rama, y los 7 + 3 modificados por ambos se revisaron uno a uno. Las migraciones históricas de `main` (009–019) llegan intactas; las 020–024 de Manufactura no colisionan con ninguna.

## Verificaciones rápidas (en el worktree, tras `npm ci`)
`npm ci` sin errores · `npm run typecheck` ✔ · `npm run lint` ✔ (0 errores) · `npm run build` ✔ (API + web) · sin marcadores de conflicto · JSON de `package.json` y `package-lock.json` válidos. `git diff --check` solo señala fin de línea (CR) en archivos que vienen de `main` sin modificar (p. ej. `compose.pilot.yaml`, servicios de Caterpillar): no son cambios de esta integración.

## Riesgos para la Fase 3
1. **Suites funcionales de `main` por ejecutar** sobre el resultado fusionado: Caterpillar (reproceso, cancelación, regeneración), Pagos (asignaciones, recuperación, reprocesos), Audi, Proveedores/Contactos, autenticación/roles, Actividad reciente. Varias son pruebas de integración que necesitan bases desechables (`test:integration:*`, `@electric-sql/pglite`).
2. **Pruebas intermitentes ya conocidas** de Manufactura: dos pruebas HTTP de vista previa que dan tiempo de espera en corridas completas y pasan solas.
3. **`compose.pilot.yaml` (de `main`) ya define las banderas `PAYMENT_FILE_ASSIGNMENTS_*`**: el mismo patrón por entorno se usará para habilitar Manufactura.
4. **Actividad reciente**: `main` no modificó `recent-activity/`, pero sí `aliases/*`, `audit/audit-catalog.ts` y `automations/*` (Caterpillar, Pagos, Audi, catálogo de automatizaciones), de los que dependen sus repositorios; solo se integran sin solapes con los 8 archivos de API que toca nuestra rama. Hay que ejecutar su contrato completo contra el código fusionado.
5. **Versión**: el árbol queda en 1.1.1; la candidata v1.2.0 requiere un cambio de versión explícito (no hecho).
6. **`daubert-hub-deploy-main`** es otra copia con `main` en el worktree de despliegue: no se tocó.
