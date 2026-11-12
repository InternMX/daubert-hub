# Ensayo del rollback del Hub (Fase 3D)

Fecha: 2026-11-12. Rama `feat/cicd-phase3-rollback-tests`.

Este documento **no autoriza ni registra** ningún rollback. La autoridad operativa sigue siendo
el bloque **Rollback del Hub** de [deployment-checklist](deployment-checklist.md#comandos-powershell-desde-la-raíz-del-repositorio);
aquí se documenta:

1. qué garantiza hoy ese bloque y qué no (análisis);
2. la cobertura automatizada con mocks que lo respalda;
3. un **diagnóstico de solo lectura** para saber, tras un fallo o una interrupción, en qué
   estado quedó la recuperación y cuál es el único paso seguro siguiente;
4. el diseño de un **ensayo real aislado** con Docker, que **no se ha ejecutado**.

Contexto de PROD (2026-11-11): Hub en `de13370`; anclas `daubert-hub-api:rollback-16153a8` y
`daubert-hub-web:rollback-16153a8` verificadas por digest contra el expediente previo
(fuera del repositorio). **El rollback real nunca se ha ejecutado en PROD.**

## 1. Procedimiento actual y limitaciones

El bloque del checklist: valida `$prev`/`$new`; para `api` y `web` comprueba que el ancla
existe y coincide con el digest registrado **antes** del deploy, que `failed-<new>` no existe y
que `latest` es legible; preserva **ambas** imágenes nuevas como `failed-<new>`; devuelve las
anclas a `latest` verificando digests; ejecuta `docker compose @cf up -d --no-build api web`;
y exige `/api/health` con `status=ok`, `database=connected`, `environment=PRODUCTION` y
`commit=$prev`. Cada exit code se comprueba y cualquier fallo lanza una excepción.

| # | Limitación | Consecuencia | Mitigación en esta entrega |
| --- | --- | --- | --- |
| L1 | Tras Compose solo verifica el health HTTP (que responde la `api`); **no compara la imagen de cada contenedor** con el ancla | Un Compose con exit `0` que recrea solo `api` (o deja `web` detenido) se declara recuperado con `web` en la versión fallida | Diagnóstico de solo lectura (§3): exige que `api` y `web` ejecuten el digest del ancla y estén `running`. Prueba de caracterización que deja constancia de L1 |
| L2 | No es idempotente: una segunda ejecución tras un fallo o interrupción se detiene en "`failed-*` ya existe" | Correcto (no sobrescribe), pero no indica cómo continuar | El diagnóstico clasifica el estado parcial; con `LISTO_PARA_COMPOSE` solo se repite la cola Compose + health del mismo bloque |
| L3 | No consulta el estado Docker de `api` (`healthy`) ni de `web` (`running`) | Un health HTTP momentáneo podría ocultar un contenedor reiniciándose | Diagnóstico de solo lectura (§3) |
| L4 | Depende de evidencia externa (`$prev`, `$new`, digests) introducida a mano | Un dato mal copiado bloquea (seguro) o, si la evidencia era errónea desde el origen, restaura otra imagen | El bloque y el diagnóstico rechazan formatos inválidos; la evidencia se revisa antes del deploy (expediente) |
| L5 | El ancla solo vive en el almacén de Docker Desktop | Perder el almacén impide el rollback exacto | `docker save` opcional (checklist, alternativa 1b); fuera del alcance de esta entrega |
| L6 | Solo se ha validado con mocks | No prueba containerd, `--platform`, Compose real ni Nginx | Ensayo real aislado diseñado en §4, no ejecutado |
| L7 | No hay modo `-Rollback` ni rollback automático | Recuperación manual (copiar/pegar) | Intencional en esta fase; no se implementa automatización en PROD |

No se modificaron `Deploy-DaubertHub.ps1`, el checklist ni ningún otro script productivo. L1
se documenta aquí y se propone, para revisión humana, añadir al bloque del checklist la
comparación de imágenes en ejecución (o invocar el diagnóstico de §3 tras Compose).

## 2. Cobertura automatizada

`scripts/deploy/tests/Recovery-DaubertRelease.Tests.ps1` extrae y ejecuta **el bloque real**
del checklist y el bloque de diagnóstico de este documento, sustituyendo solo las entradas
del operador. `docker` es una función que lanza excepción fuera del mock; el mock mantiene un
almacén de etiquetas y contenedores en memoria y rechaza cualquier comando distinto de
`image inspect`, `inspect`, `tag` y el `compose up -d --no-build api web` exacto.
`Invoke-RestMethod` también está simulado. No se ejecuta Docker, SQL ni n8n.

```powershell
Import-Module Pester -RequiredVersion 3.4.0
Invoke-Pester -Script scripts\deploy\tests
```

| Escenario | Prueba (Describe / It) | Resultado esperado |
| --- | --- | --- |
| Anclas correctas | Rollback documental: recreación parcial previa; Diagnóstico: `SIN_INICIAR` y `RECUPERADO` | Recupera ambos servicios; preserva `failed-*` |
| Ancla inexistente | Rollback documental: sin una de las anclas; Diagnóstico: ancla inexistente | Excepción sin `tag`/`compose`; `BLOQUEADO` |
| Digest distinto al registrado | Rollback documental: ancla alterada; Diagnóstico: digest distinto, evidencia mal formada | Excepción sin mutar; `BLOQUEADO` |
| Fallo al preservar una imagen | Rollback documental (api); Interrumpida: preservar web tras api | Sin Compose; `PARCIAL` |
| Fallo al restaurar una etiqueta | Rollback documental (web); Interrumpida: restaurar web tras api | Sin Compose; `PARCIAL` |
| Error durante Compose | Rollback documental: compose fallido; Interrumpida: Compose fallido | Excepción; `LISTO_PARA_COMPOSE`; reanudación sin re-etiquetar |
| API que no llega a healthy | API no healthy: health inaccesible, `status`/`database`/`environment` incorrectos; Parcial: `RECREADO_NO_SANO` | Excepción; nunca se declara recuperado |
| Commit incorrecto tras restaurar | Rollback documental: commit anterior no vuelve; API no healthy: `commit=ccccccc`; Parcial: commit HTTP incorrecto | Excepción; `RECREADO_NO_SANO` |
| Recreación parcial de API/Web | Parcial: Compose solo recrea `api` (caracteriza L1), `web` detenido, reanudación | El bloque no lo detecta; el diagnóstico sí (`LISTO_PARA_COMPOSE`) |
| Recuperación interrumpida | Interrumpida: mutaciones 2–5, imágenes `failed-*` y anclas intactas | Diagnóstico correcto; repetir el bloque completo no muta nada |
| Solo comandos permitidos | Rollback documental: comandos limitados; Diagnóstico: solo lecturas | Sin `down`, `prune`, `--remove-orphans`, SQL ni n8n |

Las garantías previas al deploy (anclas inexistentes/alteradas/reutilizables, fallo al crear
el ancla, `compose up` fallido, health posterior incorrecto, sin rollback automático) ya están
en `Deploy-DaubertHub.Tests.ps1` y no se duplican.

## 3. Diagnóstico de recuperación (solo lectura)

Usar **antes** de iniciar el rollback, **después** de cualquier excepción del bloque y
**después** de un Compose correcto. Solo lee: `docker image inspect`, `docker inspect` de
`daubert-hub-api-1`/`daubert-hub-web-1` y `GET /api/health`. No etiqueta, no recrea, no
reinicia, no lee el archivo de entorno ni imprime secretos. Usa las mismas entradas que el
bloque de rollback, tomadas del expediente previo.

<!-- bloque-probado: diagnostico-recuperacion -->
```powershell
$prev = '<commit anterior, el usado al crear el ancla>'
$new = '<commit corto del candidato fallido, registrado ANTES del deploy>'
$rollbackDigests = @{ api = '<sha256 registrado antes del deploy>'; web = '<sha256 registrado antes del deploy>' }
# SOLO LECTURA: docker image inspect, docker inspect y GET /api/health. Ningun tag, compose ni reinicio.
$ErrorActionPreference = 'Continue'
foreach ($v in $prev, $new) { if ($v -notmatch '^[0-9a-f]{7,40}$') { throw "Commit invalido: '$v'" } }
$fmt = @('--platform', 'linux/amd64', '--format', '{{.Id}}')
$svcState = @{}
foreach ($svc in 'api', 'web') {
    $read = @{}
    foreach ($k in 'rollback', 'failed', 'latest') {
        $ref = if ($k -eq 'rollback') { "daubert-hub-${svc}:rollback-$prev" } elseif ($k -eq 'failed') { "daubert-hub-${svc}:failed-$new" } else { "daubert-hub-${svc}:latest" }
        $o = @(docker image inspect $ref @fmt 2>$null)
        $read[$k] = if ($LASTEXITCODE -eq 0 -and $o.Count -eq 1 -and $o[0] -cmatch '^sha256:[0-9a-f]{64}$') { [string]$o[0] } else { '' }
    }
    $o = @(docker inspect "daubert-hub-${svc}-1" --format '{{if .ImageManifestDescriptor}}{{.ImageManifestDescriptor.digest}}{{end}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>$null)
    $parts = @('', '', '')
    if ($LASTEXITCODE -eq 0 -and $o.Count -eq 1 -and ([string]$o[0]).Split('|').Count -eq 3) { $parts = ([string]$o[0]).Split('|') }
    $expected = [string]$rollbackDigests[$svc]
    $svcState[$svc] = [pscustomobject]@{
        Servicio = $svc
        AnclaOk  = ($expected -cmatch '^sha256:[0-9a-f]{64}$' -and $read['rollback'] -ceq $expected)
        Failed   = $(if (-not $read['failed']) { 'ausente' } elseif ($read['failed'] -ceq $expected) { 'igual-al-ancla' } else { 'preservada' })
        Latest   = $(if (-not $read['latest']) { 'ausente' } elseif ($read['latest'] -ceq $expected) { 'ancla' } else { 'otra' })
        Ejecuta  = $(if (-not $parts[0]) { 'desconocida' } elseif ($parts[0] -ceq $expected) { 'ancla' } else { 'otra' })
        Estado   = $parts[1]
        Salud    = $parts[2]
    }
    $x = $svcState[$svc]
    Write-Host ('{0}: ancla_ok={1} failed={2} latest={3} ejecuta={4} estado={5} salud={6}' -f $x.Servicio, $x.AnclaOk, $x.Failed, $x.Latest, $x.Ejecuta, $x.Estado, $x.Salud)
}
$health = $null
try { $health = Invoke-RestMethod -Uri http://localhost:8082/api/health -TimeoutSec 10 -ErrorAction Stop } catch { $health = $null }
$httpOk = [bool]($health -and $health.status -eq 'ok' -and $health.database -eq 'connected' -and $health.environment -eq 'PRODUCTION' -and $health.commit -eq $prev)
Write-Host ('health: respuesta={0} commit_anterior_sano={1}' -f [bool]$health, $httpOk)
$s = @($svcState['api'], $svcState['web'])
$verdict = if (@($s | Where-Object { -not $_.AnclaOk }).Count -gt 0) { 'BLOQUEADO' }
elseif (@($s | Where-Object { $_.Failed -eq 'ausente' -and $_.Latest -eq 'otra' }).Count -eq 2) { 'SIN_INICIAR' }
elseif (@($s | Where-Object { $_.Failed -eq 'preservada' -and $_.Latest -eq 'ancla' }).Count -eq 2) {
    if (@($s | Where-Object { $_.Ejecuta -eq 'ancla' -and $_.Estado -eq 'running' }).Count -eq 2) {
        if ($svcState['api'].Salud -eq 'healthy' -and $httpOk) { 'RECUPERADO' } else { 'RECREADO_NO_SANO' }
    } else { 'LISTO_PARA_COMPOSE' }
}
else { 'PARCIAL' }
Write-Host "VEREDICTO: $verdict"
$verdict
```

| Veredicto | Significado | Único paso permitido |
| --- | --- | --- |
| `BLOQUEADO` | Falta un ancla, su digest no coincide con el expediente o la evidencia está mal formada | **Detenerse.** No etiquetar, no reconstruir desde Git como "rollback exacto". Escalar |
| `SIN_INICIAR` | Anclas correctas, sin `failed-*`, `latest` es la imagen nueva en ambos servicios | Ejecutar el bloque completo del checklist |
| `LISTO_PARA_COMPOSE` | Ambas imágenes nuevas preservadas y ambas anclas ya en `latest`, pero algún contenedor no ejecuta el ancla o no está `running` (Compose falló, se interrumpió o recreó parcialmente) | Diagnosticar primero la causa del fallo de Compose; después ejecutar **solo** las líneas finales del bloque del checklist, desde `docker compose @cf up -d --no-build api web` hasta el final. Repetir este diagnóstico |
| `RECREADO_NO_SANO` | Ambos contenedores ejecutan el ancla, pero `api` no está `healthy` o el health HTTP no confirma el commit anterior sano | **No** volver a etiquetar ni recrear. Revisar logs de `api` (`docker compose @cf logs --tail 100 api`), proxy (`Set-EntryClosure.ps1 -Action Reload` si hay 502) y BD. Escalar |
| `RECUPERADO` | Ambos contenedores ejecutan el ancla, `api` healthy, `web` running y health con `commit=$prev` | Continuar con el humo de solo lectura, Reload/Open de la ventana y el registro |
| `PARCIAL` | Cualquier otra combinación (p. ej. solo una imagen preservada, solo un `latest` restaurado, `latest` sin cambios) | **Detenerse.** Revisar la tabla impresa; completar a mano **solo** el paso pendiente de ese servicio con los mismos comandos y comprobaciones del bloque, con autorización del responsable. Nunca borrar ni sobrescribir `failed-*` ni anclas |

El diagnóstico usa el puerto `8082` de PROD. En el ensayo aislado (§4) se sustituye por el
puerto del entorno de ensayo.

## 4. Ensayo real aislado (diseño; **no ejecutado**)

Los mocks no prueban el almacén containerd, `--platform linux/amd64`, el comportamiento real
de `compose up --no-build` ni Nginx. Para eso se requiere un ensayo con Docker real que
**no puede ejecutarse en este equipo** (es el host de PROD y comparte el proyecto
`daubert-hub`, `compose.yaml` y el almacén de imágenes).

### Requisitos previos

- **Otro host o VM** con su propio Docker Engine/Desktop, sin acceso de red a PROD, a su
  PostgreSQL ni a n8n. Antes de cada comando: `docker context show` y `docker info` deben
  identificar ese motor, nunca el de PROD.
- Checkout limpio del repositorio con los commits `16153a8` y `de13370` disponibles (o dos
  commits cualesquiera con cambios de Hub entre ellos).
- Archivo de entorno **de ensayo** (no `deploy/pilot.prod.env`): base de datos desechable
  (p. ej. un PostgreSQL temporal local con datos ficticios) y webhooks/tokens vacíos o ficticios.
  `compose.prod-temp.yaml` de ensayo sin valores reales. Directorio `conf.d` de ensayo para el
  override de cierre.
- Nombre de proyecto Compose propio (p. ej. `daubert-rollback-rehearsal`) y puerto propio.
  Como el bloque del checklist fija `daubert-hub` y `8082`, el ensayo usa una **copia** del bloque
  en la que solo cambian `$cf`, el puerto y los nombres de contenedor; la copia se compara con
  `git diff --no-index` contra el bloque original y se archiva junto a la evidencia.
- Operador único, ventana sin otros procesos Docker, espacio en disco para cuatro imágenes.

### Prohibido en el ensayo

`docker compose down`, `rm`, `rmi`, `prune`, `--remove-orphans`, `up` sin nombrar servicios,
SQL contra cualquier base real, importación/activación de workflows de n8n y cualquier
archivo de configuración de PROD.

### Pasos

1. Construir y levantar la versión anterior (`16153a8`) con `APP_VERSION`/`GIT_COMMIT`
   correspondientes; registrar en un expediente de ensayo los digests de `api` y `web`.
2. Crear las anclas `rollback-<prev>` por nombre con el mismo procedimiento que
   `Deploy-DaubertHub.ps1` (o el bloque PRE-DEPLOY paso 8) y verificarlas por digest.
3. Construir y levantar la versión nueva (`de13370`); registrar `$new`.
4. Ejecutar el diagnóstico (§3): debe dar `SIN_INICIAR`.
5. Ejecutar la copia del bloque de rollback; después el diagnóstico: `RECUPERADO`.
   Comprobar el bundle web y `/api/health` (commit anterior).
6. Repetir desde el paso 3 inyectando cada fallo, uno por ronda, y comprobando el
   veredicto y que no hubo mutaciones posteriores al fallo:

| Ronda | Inyección (solo en el entorno de ensayo) | Esperado |
| --- | --- | --- |
| A | Ancla `web` retiquetada a otra imagen antes del rollback | Excepción antes de `tag`; `BLOQUEADO` |
| B | Crear previamente `daubert-hub-api:failed-<new>` | Excepción antes de `tag` |
| C | Cancelar la consola (Ctrl+C) tras preservar `api` | `PARCIAL`; segunda ejecución no muta |
| D | Mover temporalmente el `--env-file` de ensayo para que Compose falle | Excepción; `LISTO_PARA_COMPOSE`; restaurar el archivo y reanudar solo Compose → `RECUPERADO` |
| E | Base desechable detenida antes de Compose | Excepción en health; `RECREADO_NO_SANO` |
| F | Recrear solo `api` a mano con `up -d --no-build api` (simula L1) | El diagnóstico no da `RECUPERADO` hasta recrear `web` |

### Evidencia y criterio de éxito

Guardar fuera del repositorio y de Dropbox: `docker context show`, digests antes/después,
salida del diagnóstico de cada ronda, exit codes y hora. El ensayo se acepta si las 6 rondas
y el camino feliz producen exactamente los veredictos esperados, sin pérdida de anclas ni
de imágenes `failed-*`. Cualquier desviación bloquea declarar el rollback "probado".
La limpieza de etiquetas del ensayo se hace a mano al final y **solo** en ese motor.

## 5. Riesgos restantes

- **El rollback no se ha ejecutado contra Docker real** (ni en PROD ni en un ensayo aislado):
  las pruebas validan decisiones y comandos, no el motor.
- **L1 sigue en el bloque del checklist**: hasta que se incorpore la comparación de imágenes
  en ejecución, el operador debe ejecutar el diagnóstico tras Compose. Modificar el checklist
  queda pendiente de revisión humana y coordinación con la Fase 3A/3C (que edita ese archivo).
- El diagnóstico depende de `ImageManifestDescriptor` (containerd), igual que el preflight;
  si Docker Desktop cambia de almacén devolverá `desconocida` y nunca `RECUPERADO` (falla
  cerrado, pero bloquearía una recuperación correcta).
- La recuperación de BD (`down.sql`) y n8n no forma parte de este ensayo; un release con
  migraciones exige su propio plan.
- Sin lock de concurrencia: otro proceso que cambie etiquetas durante el rollback no se detecta
  hasta el siguiente diagnóstico.
- `docker save` de las anclas `rollback-16153a8` no está acreditado: si se pierde el almacén
  de Docker, no hay rollback exacto.
