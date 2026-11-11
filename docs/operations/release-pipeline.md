# Pipeline de preparación de releases (Fases 1 y 2A, sin despliegue)

Este proceso **no despliega ni configura PROD**. Complementa el CI existente y el runbook
[`deployment-checklist.md`](deployment-checklist.md), que sigue siendo la autoridad para publicar.

## Qué quedó automatizado

1. `.github/workflows/ci.yml` corre en PR a `main` y tras los pushes a `main`. Ejecuta typecheck, lint, build y pruebas unitarias del API/Web, las pruebas del guard de TEST y las del clasificador de release. No conecta con PostgreSQL ni n8n, ni ejecuta migraciones o Docker.
2. `.github/workflows/prepare-release.yml` se inicia **manualmente**, solo desde `main`. Recibe el commit publicado que devuelve `/api/health` en PRODUCCIÓN y compara ese commit contra el `GITHUB_SHA` del workflow.
3. `scripts/release/plan-release.cjs` crea `release-manifest.json` y `release-report.md`. GitHub Actions publica el reporte en el resumen de la ejecución y ambos archivos como artifact. No contiene secretos.

## Preparar un candidato

1. Consultar desde el entorno autorizado `http://localhost:8082/api/health` del servidor de PROD; guardar el campo `commit` (SHA real publicado, no usar el commit de `main` ni asumir que el tag más reciente está en PROD).
2. En GitHub: **Actions → Prepare release candidate → Run workflow**, elegir rama `main` e introducir ese SHA en `deployed_commit`.
3. Revisar el reporte generado, incluyendo archivos de `database/`, `n8n/`, `scripts/`, `deploy/` y rutas desconocidas.
4. Confirmar que el CI correspondiente al candidato pasó. **Este reporte no comprueba por sí mismo el estado de CI**, y no sustituye las validaciones en el servidor.
5. Si procede continuar, aprobar el SHA completo del candidato y ejecutar el plan local de Fase 2A descrito abajo. Para publicar siguen vigentes los procedimientos y aprobaciones de `deployment-checklist.md`. No ejecutar SQL ni reiniciar n8n como parte de este workflow.

La acción rechaza una referencia base que no sea hexadecimal, un commit no ancestral del candidato y un candidato que no coincida con el `HEAD` que proporciona su `package.json`. Si falla, el reporte no se publica y **no hay cambios en producción**.

## Clasificaciones

| Resultado | Significado | Acción |
| --- | --- | --- |
| `CANDIDATO_SOLO_HUB` | Cambios solo en API/Web/Docker/Compose/package y, opcionalmente, docs/herramientas | Elegible para revisar el preflight local, **no** autorizado automáticamente |
| `REQUIERE_COORDINACION_MANUAL` | Cambios en `database/`, `n8n/`, scripts/archivos operativos o rutas desconocidas | Seguir runbooks correspondientes; identificar dependencias y evidencias antes del despliegue |
| `SIN_DESPLIEGUE_HUB` | Solo cambios documentales o tooling, o ningún cambio | No reconstruir contenedores solo para actualizar el SHA mostrado |

La clasificación usa **rutas modificadas**; no analiza el contenido de SQL ni compara workflows vivos con exports. Puede ser más restrictiva de lo necesario, nunca un permiso automático para PROD.

## Qué sigue fuera de alcance

- Promoción, importación o activación de workflows de n8n (TEST y PROD comparten instancia `:5678`, pero tienen workflows separados).
- Migraciones PostgreSQL: precheck, backup inmediato, aplicación y postcheck mantienen su procedimiento controlado.
- Construcción y publicación de imágenes Docker, creación de tags o releases GitHub, ejecución remota y rollback automático.
- Ejecutar pruebas de integración sobre `daubert_hub_test` desde GitHub Actions: requiere preparar una base temporal reproducible. No se conecta al servidor real.

## Fase 2A: plan local de solo lectura

`scripts/deploy/Invoke-DaubertRelease.ps1 -Plan -ExpectedCommit <SHA completo aprobado>`
es la entrada de preparación en Windows PowerShell 5.1. La Fase 1 sigue generando el
manifiesto/reporte y validando el código; la Fase 2A compara el SHA aprobado con `HEAD`
y reutiliza `Deploy-DaubertHub.ps1 -WhatIf`, incluido su preflight y las consultas del
estado actual del Hub. No ejecuta el plan ni descarga/ejecuta artifacts de Actions.

El operador debe comprobar que el SHA aprobado es el del reporte de Fase 1 y que su CI
está verde. El orquestador **no consulta CI ni autentica la aprobación**: `ExpectedCommit`
es la vinculación explícita con esa aprobación externa, no una firma. Un reporte de
clasificación no sustituye los gates locales ni autoriza migraciones o cambios en n8n.

Resultados: `0` APTO (solo plan), `1` BLOQUEADO, `2` SIN CAMBIOS, `3` uso inválido
detectado por el script. Errores de binding de PowerShell salen con `1`. Comandos,
restricciones y política heredada de advertencias en
[deployment-checklist](deployment-checklist.md#entrada-centralizada-de-planificación-fase-2a).

No genera archivos temporales ni logs de salida externa. Para evidencias de pruebas,
usar una carpeta **fuera de todos los worktrees**:

```powershell
Import-Module Pester -RequiredVersion 3.4.0
# La carpeta de evidencias debe existir y estar fuera del repositorio.
Invoke-Pester -Script scripts\deploy\tests -EnableExit -OutputFormat NUnitXml -OutputFile C:\evidencias\release-plan-tests.xml
```

CI añade el job `release-plan` en `windows-latest` con `shell: powershell`, Pester 3.4.0
y operaciones externas simuladas; no ejecuta el orquestador contra servicios reales.
El XML vive en `RUNNER_TEMP`, fuera del checkout, y se publica como artifact
`release-plan-tests` por 14 días. El job de validación API/Web de Fase 1 continúa vigente.

**Verificación local de esta entrega (2026-11-11):** Windows PowerShell
`5.1.26100.9711`, Pester `3.4.0`: **73 pruebas aprobadas, 0 fallidas, 0 omitidas**
(55 existentes + 18 del orquestador), con XML fuera del repositorio. Ambos scripts
nuevos pasan el parser de PowerShell 5.1; una invocación CLI con SHA inválido devuelve
`3` antes de operar. Solo se utilizaron mocks y valores ficticios; no se ejecutó el
plan real, preflight real ni pruebas contra PROD.

## Uso local del clasificador

Desde la raíz, en un checkout cuyo `HEAD` sea el commit candidato:

```powershell
node --test scripts/release/*.test.cjs
node scripts/release/plan-release.cjs --base <sha-de-PROD> --head <sha-candidato-HEAD> --out-dir .\release-local
```

**No añadir a Git los reportes generados ni introducir secretos en los argumentos.** Usar una carpeta fuera del repositorio para los reportes locales, o borrarlos antes del preflight de PROD (que exige árbol limpio).
