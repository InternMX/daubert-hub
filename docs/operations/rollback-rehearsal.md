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
y, desde la corrección de Fase 3D, **verifica después de Compose** que `api` y `web` están
`running` con el manifiesto exacto de su ancla (`.ImageManifestDescriptor.digest` frente al
digest registrado antes del deploy, no el digest de `latest`), que `api` está `healthy` y que
`/api/health` devuelve `status=ok`, `database=connected`, `environment=PRODUCTION` y
`commit=$prev`. Un contenedor ilegible, sin digest válido o con otra imagen falla al instante;
los estados transitorios (`starting`, contenedor no `running`, sin respuesta HTTP) se reintentan
dentro de un límite único de 180 s: esperas y `GET /api/health` (timeout = tiempo restante,
máximo 10 s) nunca terminan después del plazo.
Solo con todo verificado imprime "Rollback por imagen completado". Cada exit code se comprueba
y cualquier fallo lanza una excepción.

| # | Limitación | Consecuencia | Mitigación en esta entrega |
| --- | --- | --- | --- |
| L1 | **Corregida.** Antes, tras Compose solo verificaba el health HTTP (que responde la `api`) y no comparaba la imagen de cada contenedor | Un Compose con exit `0` que recreaba solo `api` (o dejaba `web` detenido) se declaraba recuperado con `web` en la versión fallida | El bloque del checklist verifica estado y manifiesto de ambos contenedores; pruebas que fallan si se elimina esa verificación |
| L2 | No es idempotente: una segunda ejecución tras un fallo o interrupción se detiene en "`failed-*` ya existe" | Correcto (no sobrescribe), pero no indica cómo continuar | El diagnóstico clasifica el estado parcial; con `LISTO_PARA_COMPOSE` solo se repite la cola Compose + health del mismo bloque |
| L3 | **Corregida.** No consultaba el estado Docker de `api` (`healthy`) ni de `web` (`running`) | Un health HTTP momentáneo podía ocultar un contenedor reiniciándose | El bloque exige `running` en ambos y `healthy` en `api`; el diagnóstico (§3) hace lo mismo |
| L4 | Depende de evidencia externa (`$prev`, `$new`, digests) introducida a mano | Un dato mal copiado bloquea (seguro) o, si la evidencia era errónea desde el origen, restaura otra imagen | El bloque y el diagnóstico rechazan formatos inválidos; la evidencia se revisa antes del deploy (expediente) |
| L5 | El ancla solo vive en el almacén de Docker Desktop | Perder el almacén impide el rollback exacto | `docker save` opcional (checklist, alternativa 1b); fuera del alcance de esta entrega |
| L6 | Solo se ha validado con mocks | No prueba containerd, `--platform`, Compose real ni Nginx | Ensayo real aislado diseñado en §4, no ejecutado |
| L7 | No hay modo `-Rollback` ni rollback automático | Recuperación manual (copiar/pegar) | Intencional en esta fase; no se implementa automatización en PROD |

No se modificaron `Deploy-DaubertHub.ps1` ni ningún otro script productivo. Del checklist solo
cambió el bloque **Rollback del Hub** (verificación posterior) y su párrafo de instrucciones.

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
| Ausencia confirmada de `failed-*` | Ausencia confirmada: etiqueta inexistente (se lista antes de cada `tag`), existente en api/web, existente con inspect fallido (con listado que la muestra o también fallido), listado que la omite junto con una etiqueta conocida, listado ambiguo (línea mal formada, repositorio ajeno, vacío, sin ancla, sin `latest`), `<none>` válido, `docker image ls` fallido, Docker caído, lectura fallida de `latest`/ancla, inspect con exit 0 ilegible | Solo se etiqueta con ausencia confirmada; cualquier error o ambigüedad lanza excepción **sin ninguna mutación**, y el diagnóstico da `NO_VERIFICABLE` (o `BLOQUEADO`). En ningún modo de fallo se sobrescribe una `failed-*` preexistente |
| Cambios concurrentes detectables | Ausencia confirmada: `failed-web` creada tras preservar api, `latest` movida antes de preservar, `failed-api` alterada antes de restaurar | Se detiene sin sobrescribir ni restaurar `latest` |
| Fallo al preservar una imagen | Rollback documental (api); Interrumpida: preservar web tras api | Sin Compose; `PARCIAL` |
| Fallo al restaurar una etiqueta | Rollback documental (web); Interrumpida: restaurar web tras api | Sin Compose; `PARCIAL` |
| Error durante Compose | Rollback documental: compose fallido; Interrumpida: Compose fallido | Excepción; `LISTO_PARA_COMPOSE`; reanudación sin re-etiquetar |
| API que no llega a healthy | API no healthy: health inaccesible, `status`/`database`/`environment` incorrectos; Verificación posterior: API nunca healthy, API detenida, `starting` que pasa a `healthy`; Parcial: `RECREADO_NO_SANO` | Excepción tras el límite con `PENDIENTE: …`; nunca se declara recuperado. Si la API se recupera dentro del límite, completa |
| Commit incorrecto tras restaurar | Rollback documental: commit anterior no vuelve; API no healthy: `commit=ccccccc`; Parcial: commit HTTP incorrecto | Excepción; `RECREADO_NO_SANO` |
| Recreación parcial de API/Web | Parcial: Compose solo recrea `api`, reanudación; Verificación posterior: API correcta con Web en la imagen fallida, en otra imagen o en la de `api` | Excepción inmediata (`web ejecuta …`) sin mensaje de completado; el diagnóstico da `LISTO_PARA_COMPOSE` y la reanudación solo de Compose completa |
| Web o API detenida | Verificación posterior: Web `exited`/`created`/`restarting`, API `exited`; Parcial: `web` detenido | Excepción tras el límite con `PENDIENTE: … estado` |
| Digest en ejecución inválido | Verificación posterior: sin `ImageManifestDescriptor`, truncado, mayúsculas | Excepción inmediata, sin reintentos |
| Error al inspeccionar Docker | Verificación posterior: `docker inspect` con exit no cero (api y web), salida mal formada | Excepción inmediata (`no se pudo inspeccionar …`) |
| Inspección no verificable en el diagnóstico | Diagnóstico: `docker inspect` de api o web con exit no cero, salida mal formada, varias líneas, digest vacío/truncado/en mayúsculas o estado vacío, en los estados que darían `SIN_INICIAR`, `LISTO_PARA_COMPOSE` y `RECUPERADO`; etiqueta con digest ilegible | Siempre `NO_VERIFICABLE`, sin mutaciones; nunca un veredicto que autorice ejecutar el bloque, Compose o etiquetar |
| Límite de espera verificable | Límite: reloj simulado (`Get-Date`, `Start-Sleep` e `Invoke-RestMethod` lo avanzan); health que agota siempre su timeout, Web detenida, API que se recupera cerca del plazo | Tiempo simulado total ≤ 180 s; cada `-TimeoutSec` ≤ tiempo restante y ≤ 10 s; ninguna espera cruza el plazo |
| Recuperación completa | Verificación posterior: mensaje de completado solo en el camino feliz; compara el manifiesto de cada contenedor; tras Compose solo hay lecturas | Un único mensaje "completado" |
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
$unverifiable = @()
foreach ($svc in 'api', 'web') {
    $read = @{}
    # Misma regla que el bloque de rollback: "ausente" solo si inspect falla Y un listado valido del repositorio no la muestra.
    $repo = "daubert-hub-${svc}"
    $tags = @(docker image ls $repo --format '{{.Repository}}:{{.Tag}}' 2>$null | ForEach-Object { [string]$_ })
    $listOk = ($LASTEXITCODE -eq 0 -and @($tags | Where-Object { $_ -cnotmatch ('^' + $repo + ':([A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|<none>)$') }).Count -eq 0)
    if (-not $listOk) { $unverifiable += "${svc}: no se pudo listar de forma fiable las etiquetas de ${repo}" }
    foreach ($k in 'rollback', 'failed', 'latest') {
        $ref = if ($k -eq 'rollback') { "daubert-hub-${svc}:rollback-$prev" } elseif ($k -eq 'failed') { "daubert-hub-${svc}:failed-$new" } else { "daubert-hub-${svc}:latest" }
        $o = @(docker image inspect $ref @fmt 2>$null)
        $read[$k] = ''
        if ($LASTEXITCODE -eq 0) {
            if ($o.Count -eq 1 -and $o[0] -cmatch '^sha256:[0-9a-f]{64}$') { $read[$k] = [string]$o[0] }
            else { $unverifiable += "${svc}: la imagen ${ref} existe pero su digest es ilegible" }
            if ($listOk -and $tags -cnotcontains $ref) { $unverifiable += "${svc}: inspect y listado discrepan sobre ${ref}" }
        } elseif ($listOk -and $tags -ccontains $ref) { $unverifiable += "${svc}: ${ref} figura en el listado pero inspect fallo" }
    }
    $o = @(docker inspect "daubert-hub-${svc}-1" --format '{{if .ImageManifestDescriptor}}{{.ImageManifestDescriptor.digest}}{{end}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>$null)
    $parts = @('', '', '')
    if ($LASTEXITCODE -eq 0 -and $o.Count -eq 1) {
        $p3 = @(([string]$o[0]).Split('|'))
        if ($p3.Count -eq 3 -and $p3[0] -cmatch '^sha256:[0-9a-f]{64}$' -and $p3[1]) { $parts = $p3 }
    }
    if (-not $parts[0]) { $unverifiable += "${svc}: contenedor no verificable (inspect fallido, salida mal formada o sin digest de manifiesto valido)" }
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
foreach ($u in $unverifiable) { Write-Host "NO VERIFICABLE: $u" }
$s = @($svcState['api'], $svcState['web'])
$verdict = if ($unverifiable.Count -gt 0) { 'NO_VERIFICABLE' }
elseif (@($s | Where-Object { -not $_.AnclaOk }).Count -gt 0) { 'BLOQUEADO' }
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
| `NO_VERIFICABLE` | No se puede conocer la imagen o el estado real de algún contenedor (`docker inspect` falló, salida mal formada, sin digest de manifiesto válido), una etiqueta existente devuelve un digest ilegible, o no se puede **confirmar** si una etiqueta existe (`docker image ls` falló o es ambiguo, o contradice a `docker image inspect`). Tiene prioridad sobre los demás veredictos | **Detenerse.** No ejecutar el bloque, ni Compose, ni etiquetar. Comprobar Docker (`docker info`, `docker ps -a` de solo lectura) y repetir el diagnóstico; escalar si persiste |
| `SIN_INICIAR` | Anclas correctas, sin `failed-*`, `latest` es la imagen nueva en ambos servicios | Ejecutar el bloque completo del checklist |
| `LISTO_PARA_COMPOSE` | Ambas imágenes nuevas preservadas y ambas anclas ya en `latest`, pero algún contenedor no ejecuta el ancla o no está `running` (Compose falló, se interrumpió o recreó parcialmente) | Diagnosticar primero la causa del fallo de Compose; después ejecutar **solo** las líneas finales del bloque del checklist, desde `docker compose @cf up -d --no-build api web` hasta el final (incluye la verificación posterior; requiere `$cf`, `$prev` y `$rollbackDigests` cargados en la consola). Repetir este diagnóstico |
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
- La verificación posterior del bloque y el diagnóstico (§3) duplican la lectura de
  contenedores con el mismo formato; si se cambia uno, revisar el otro (ambos están cubiertos
  por pruebas que extraen el texto real de cada documento).
- El límite de 180 s es fijo (solo `docker inspect`, local y sin timeout propio, puede
  prolongar la última vuelta); un arranque de `api` más lento termina en
  `Rollback NO completado` aunque luego se recupere: ejecutar el diagnóstico, no repetir el bloque.
- El diagnóstico depende de `ImageManifestDescriptor` (containerd), igual que el preflight;
  si Docker Desktop cambia de almacén devolverá `desconocida` y nunca `RECUPERADO` (falla
  cerrado, pero bloquearía una recuperación correcta).
- La recuperación de BD (`down.sql`) y n8n no forma parte de este ensayo; un release con
  migraciones exige su propio plan.
- Sin lock de concurrencia: otro proceso que cambie etiquetas durante el rollback no se detecta
  hasta el siguiente diagnóstico.
- **Concurrencia entre la última comprobación y cada `docker tag`** (no eliminable sin cambiar la
  arquitectura): `docker tag` mueve en silencio una etiqueta existente y no tiene modo «crear solo
  si no existe». El bloque la reduce a la ventana mínima (ausencia re-confirmada justo antes de
  cada `tag`, `latest` y `failed-*` re-verificadas antes de restaurar, digest comprobado después)
  y las pruebas demuestran que detecta cambios concurrentes fuera de esa ventana. Dentro de ella,
  la única protección es operativa: un solo operador y ningún otro proceso Docker en la ventana.
  Una alternativa estructural sería preservar con `docker save` a un archivo nuevo (falla si
  existe) en lugar de una etiqueta; queda como propuesta.
- La confirmación de ausencia depende de que `docker image ls <repo>` liste las etiquetas por
  nombre; si el almacén devolviera otra forma (p. ej. solo `<none>` para etiquetas reales), el
  control del ancla y `latest` en el listado hace que se detenga (falla cerrado).
- `docker save` de las anclas `rollback-16153a8` no está acreditado: si se pierde el almacén
  de Docker, no hay rollback exacto.
