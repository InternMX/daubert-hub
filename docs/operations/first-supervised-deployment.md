# Primera publicación supervisada: validación y checklist

Revisión del [PR #27](https://github.com/InternMX/daubert-hub/pull/27), 2026-11-11.
Este documento conserva la preparación previa a la ventana: **no registra un despliegue
ni autoriza PROD**. El resultado real posterior, incluidas las anclas verificadas y el
rollback no ejecutado, está en el [expediente del 2026-11-11](../deployments/2026-11-11-hub-cicd-pilot-prod.md).
Para próximas entregas, aplicar también la [política de releases](release-policy.md).
Autoridad operativa: [deployment-checklist](deployment-checklist.md). Un solo operador.

## Resultado de la revisión

El flujo es `ExpectedCommit` → lectura de HEAD → `-WhatIf -RequireSynchronizedMain` →
resumen validado → script real `-Deploy -Candidate` en la misma consola → preflight/gates →
confirmación real → contexto y sincronización revalidados → anclas → build de `api web` →
health y estado de contenedores. El JSON es best-effort, fuera del repositorio.

Se reprodujeron y corrigieron únicamente estos defectos:

| Defecto | Reproducción antes del arreglo | Corrección |
| --- | --- | --- |
| Lectura nativa siempre bloqueada | Un comando Git correcto se convertía en exit `1`: un `$LASTEXITCODE` local vacío ocultaba el global actualizado por PowerShell | Leer e inicializar explícitamente el global; pruebas de exit `0` y `128` |
| Progreso de Docker tratado como excepción | Un proceso inerte que escribe stderr y sale con `0` lanzaba excepción en PS 5.1 con ErrorActionPreference Stop | Capturar stderr con stdout, filtrar ambos y decidir por exit code; restaurar la política de errores |
| Postcheck ambiguo aceptado | `compose ps` fallaba, mientras health/inspect respondían: se devolvía `0` | El fallo de `ps` ahora devuelve deployment fallido (`5`) |
| Rollback manual continuaba tras errores | El bloque real del checklist aceptaba ancla alterada y seguía después de fallar tag o Compose; no comprobaba health dentro del bloque | Verificar digests contra evidencia previa, cada exit code y health final; detenerse antes de Compose si falla preservar/restaurar imágenes |

El rollback ya no deduce el candidato fallido de `$env:GIT_COMMIT`: el deployment restaura
esa variable al salir. Los SHA y digests se conservan en el expediente **antes** del intento.

## Evidencia local

Worktree de desarrollo `daubert-hub-release-phase2b`, rama `feat/release-orchestrator-phase2b`.
Node `24.21.0`, npm `12.0.2`, Windows PowerShell `5.1.26100.9711`, Pester `3.4.0`.
Instalación desde lockfile: `npm ci --ignore-scripts`. No se modificó el lockfile.

| Equivalente de CI | Resultado |
| --- | --- |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npm run build` | Exit 0; advertencia no bloqueante de tamaño de bundle |
| `npm run test:dev-guard` | 19/19 |
| `node --test scripts/release/*.test.cjs` | 8/8 |
| `npm run test:api` | 2,426/2,426, 150 archivos, con coverage |
| `npm run test:web` | 1,248/1,248, 88 archivos, con coverage |
| `Invoke-Pester -Script scripts/deploy/tests -EnableExit` | 116/116; incluye 9 pruebas del rollback documental |
| `npm audit --omit=dev --json` | 0 vulnerabilidades de producción al momento de la consulta |

DB_HOST se sustituyó por `ci-db.invalid`; nombre, usuario y contraseña son ficticios.
Se limpiaron las variables de aplicación del proceso de pruebas. No se cargaron archivos
de credenciales. Las pruebas API/Web usan mocks y, donde corresponde, motores embebidos
temporales; no se ejecutó `npm run validate` (incluye integraciones con base externa).

Evidencia local externa: `%TEMP%\opencode\phase2b-operational-20261111\`:
`ci-summary.json`, logs por paso, `native-stderr-before.xml`, `native-exit-before.xml`,
`postcheck-before.xml`, `rollback-before.xml` y `pester-after.xml`. Los XML `before`
conservan las regresiones demostradas, no resultados de PROD.

Las pruebas de rollback extraen y ejecutan el bloque PowerShell del checklist, sustituyendo
solo entradas del operador; Docker es una función mock que no admite un ejecutable real.
Cubren recreación parcial, conservación de imágenes fallidas, anclas ausentes/alteradas,
no sobrescribir `failed-*`, fallos al preservar/restaurar/Compose y health incorrecto.
La regresión de stderr usa únicamente un proceso PowerShell inerte, no Docker.
Las listas de comandos y las trazas simuladas rechazan `down`, `prune`, `--remove-orphans`,
servicios adicionales, SQL y llamadas a n8n. No se inició ningún contenedor ni servicio.

## Checklist de la ventana futura

### Antes: todas las casillas son necesarias

- [ ] Actions recuperado: CI del PR y del **candidato final en main** verdes, incluido
  `release-plan`. La prueba local en Windows no sustituye la ejecución hospedada de Linux.
- [ ] PR revisado y fusionado **manualmente** por el responsable. Aprobar el SHA completo
  final de `main` y su reporte de Fase 1; no reutilizar el SHA de la rama del PR.
- [ ] El candidato tiene cambios reales de Hub/Docker y no exige database/n8n. Si el delta
  es solo tooling/docs, exit `2` es correcto: **no forzar un build ni cambiar versión solo
  para estrenar el orquestador**.
- [ ] Operador, ventana, contacto y criterio de abortar acordados. No hay otro proceso
  actualizando Git, Compose, imágenes o configuración durante la ventana.
- [ ] En el servidor autorizado, sincronizar a mano la `main` limpia mediante fetch y
  fast-forward según el checklist; candidato == HEAD == origin/main == main remoto.
  Si no coincide o hay archivos sin seguimiento, detenerse sin reset/clean.
- [ ] Mantener intactos `deploy/pilot.prod.env` y `compose.prod-temp.yaml`; no copiarlos a
  la rama de desarrollo ni imprimir Compose interpolado. Revisar que variables heredadas
  de la consola no anulen la configuración aprobada (sin imprimir sus valores).
- [ ] Preflight real de solo lectura apto en la ventana autorizada: health sano, commit
  anterior localmente disponible, backups válidos recientes, espacio libre, Docker/Compose
  accesibles e imágenes en ejecución iguales a `latest` por digest. Resolver cada WARN.
- [ ] Guardar fuera del repo/Dropbox: SHA completo y corto candidato, versión candidata,
  commit/versión anteriores y **digests de api/web anteriores**. Revisar el plan de anclas
  y el bloque ROLLBACK corregido. Las anclas existentes deben apuntar a esos mismos digests.
- [ ] Directorio externo de `conf.d` existente y override obligatorio disponible. Si se
  requiere cierre, seguir el procedimiento vigente y usar `-RequireClosedWindow`.
  El cierre no bloquea todos los módulos ni ejecuciones manuales de n8n.
- [ ] Consola interactiva PowerShell 5.1, no stdin redirigido; no automatizar la frase.
  No dejar el prompt abierto indefinidamente: si vence la ventana o la evidencia, cancelar
  y repetir preflight/plan. Tras confirmar se revalidan contexto/gates y remoto, no la edad
  del backup mediante un segundo preflight completo.

### Publicar y verificar

- [ ] Ejecutar **una vez**, sustituyendo el SHA aprobado (agregar `-RequireClosedWindow`
  si la ventana lo exige):

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy\Invoke-DaubertRelease.ps1 -Deploy -ExpectedCommit <SHA-completo-aprobado>
  $LASTEXITCODE
  ```

- [ ] Comparar SHA aprobado/anterior y versión mostrados con el expediente; escribir
  `DEPLOY DAUBERT HUB` solo si coinciden. No interpretar la confirmación como éxito.
- [ ] Exigir exit `0`; comprobar además commit/versión esperados y
  `status=ok`, `database=connected`, `environment=PRODUCTION` en `/api/health`.
- [ ] Verificar `api` healthy, `web` running y ambos servicios correctos mediante las
  lecturas del checklist. Revisar las anclas anteriores por digest, sin sobrescribirlas.
- [ ] Completar Reload/Open de la ventana según el procedimiento vigente; repetir health
  después. Si aparece 502 tras recrear API, revisar resolución Nginx y el paso Reload;
  no usar `down`, reiniciar PostgreSQL/n8n ni reintentar todo el deployment a ciegas.
- [ ] Humo de lectura: login, Home, Automatizaciones, Actividad reciente y directorios.
  No reprocesar pagos, emitir documentos ni ejecutar workflows como prueba.
- [ ] Verificar el JSON mínimo o registrar manualmente si hubo advertencia; guardar nota
  de release con hora, SHA, versión, resultados y cierre de ventana. Conservar anclas.

### Recuperación: detenerse y decidir, nunca rollback automático

| Resultado | Acción |
| --- | --- |
| `1` o `3`, antes de recrear | Corregir la causa o cancelación; comprobar estado antes de reintentar. Puede haber anclas parciales si falló su preservación |
| `2` | Nada que desplegar: terminar sin reinicios |
| `5`, excepción o proceso interrumpido | Estado incierto: consultar health y contenedores; conservar anclas/imágenes y mantener la ventana controlada |
| Sigue corriendo el commit anterior sano | Confirmar digests y servicios; no retaggear ni recrear solo por obtener exit 5 |
| Versión nueva, mezcla api/web o salud degradada | Responsable decide rollback por imagen, utilizando exclusivamente el bloque ROLLBACK del checklist corregido |

- [ ] Para rollback, en consola de recuperación dedicada: cargar `$cf` con los tres Compose
  obligatorios y completar SHA/digests previos del expediente. Verificar las dos anclas,
  preservar ambas imágenes fallidas y restaurar etiquetas comprobando cada resultado.
- [ ] Recrear únicamente `api web` con `--no-build`; verificar commit **anterior**, su
  versión, health, ambos servicios y humo. Completar Reload/Open y verificar de nuevo.
- [ ] Si falta una ancla, cambia su digest o ya existe `failed-*`, **no sobrescribir, borrar
  ni reconstruir desde Git como supuesto rollback exacto**. Detenerse y escalar recuperación.
- [ ] Si falla un paso, no repetir el bloque completo sin inspeccionar qué etiquetas y
  contenedores cambiaron. No ejecutar SQL, restores ni operaciones sobre n8n en esta ruta.

## Evaluación y pendientes

**Evaluación histórica previa al piloto** (el cierre real se consulta en el expediente anterior).

**Código preparado para revisión y validación operativa condicionada; todavía no es un GO
de producción.** Faltan CI hospedado verde y los checks del servidor en la ventana futura.
Los mocks comprueban decisiones y comandos, no Docker Desktop/containerd, descargas de
imágenes base, red de build, capacidad de disco real, Nginx ni salud/credenciales del host.
Build y recreación no son transaccionales: puede quedar una mezcla de contenedores.

No hay lock contra concurrencia, aprobación criptográfica, rollback automático ni log
transaccional. La salida libre del hijo se oculta: diagnóstico detallado queda a cargo
del runbook autorizado, sin volcar secretos. La instalación reportó 22 avisos de herramientas
de desarrollo (3 críticos); quedan para revisión de dependencias separada, sin `audit fix`
ni cambios de lockfile en este PR. El runtime auditado no presenta avisos conocidos en la
consulta realizada. El backup, configuración local y aislamiento efectivo del servidor
no se comprobaron aquí, y no se modificó el worktree productivo.
