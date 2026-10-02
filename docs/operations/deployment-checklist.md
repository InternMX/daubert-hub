# Checklist de deployment del Hub (PROD)

Complementa a [deployment](deployment.md) (orden, trampas) y a [`deploy/README.md`](../../deploy/README.md) (comandos genéricos). Este documento fija el **procedimiento de PROD tal como corre hoy** (proyecto `daubert-hub`, `compose.pilot.yaml` + `compose.prod-temp.yaml`, puerto `8082`; ver [nota 2026-10-01](../deployments/2026-10-01-hub-v1-prod.md)). **Sin secretos.**

> **Estado: preparado, no ejecutado.** Solo el preflight (solo lectura) se ha ejecutado contra PROD. Ni el deploy, ni el ancla de rollback, ni el rollback se han ejecutado: **sus comandos solo se revisaron estáticamente** (sintaxis y semántica de Docker leída de `--help` y de `docker inspect`), no se probaron.
>
> **No existe ningún script de deploy ni de rollback**: solo existe el preflight. Los comandos de abajo son para copiar y ejecutar a mano. "Automatizable" significa que *podría* scriptarse, no que ya exista el script.

## Referencia (2026-10-02)

| Elemento | Valor |
| --- | --- |
| Commit desplegado en PROD | `fbda7c6` (`0.9.0-pilot.2`, leído de `GET /api/health`) |
| `main` / `origin/main` | `add458c` |
| Commits nuevos sobre PROD | `7d85978` (docs), `71ea2fd` (scripts de backup), `add458c` (docs) |
| Archivos Hub (`apps/`, `package*.json`) | **0 cambios** |
| Docker/Compose (`docker/`, `compose*`) | **0 cambios** |
| Migraciones (`database/`) | **0 cambios** (última aplicada: `011`) |
| n8n (`n8n/`) | **0 cambios** |

**Conclusión:** el código del Hub en `main` es el que ya corre en PROD. Mientras no haya cambios en `apps/`, `docker/` o `compose*`, el preflight termina con **exit 2 — "SIN CAMBIOS DE HUB/DOCKER — NO HAY NADA QUE DESPLEGAR"**. Eso **no** es un deployment exitoso y **no** es una recomendación de reiniciar PROD: reconstruir solo cambiaría el commit que muestra `/api/health`. Los scripts de `scripts/backup` los toma el host del repositorio, no los contenedores.

Este release no requiere migraciones (0 cambios en `database/`) ni cambios en n8n (0 cambios en `n8n/`).

## Configuración específica de la máquina (no se versiona)

| Elemento | Dónde | Por qué no se versiona |
| --- | --- | --- |
| `deploy/pilot.prod.env` | `.gitignore` | Credenciales de BD y tokens de webhooks |
| `compose.prod-temp.yaml` | `.git/info/exclude` (solo en el host de deployment) | Pasa `AUTH_COOKIE_SECURE` y las variables `PAYMENT_NOTIFICATIONS_*`, que `compose.pilot.yaml` no pasa |
| `%ProgramData%\DaubertHub\Backup\config.json`, `pgpass`, `age-recipients.txt` | Fuera del repositorio | Configuración externa del backup |
| Proyecto Compose `daubert-hub`, puerto `8082` | Nombres reales de PROD | Difieren del ejemplo genérico (`daubert-hub-prod`, `8080`) |

## Operaciones prohibidas

El proyecto `daubert-hub` es **también** el proyecto por defecto de `compose.yaml` (desarrollo, `postgres-test`), y comparte nombre con los contenedores de PROD. Por eso **nunca**, ni en deploy ni en rollback:

- `docker compose … down` (en cualquier forma);
- `docker compose … up --remove-orphans`;
- `docker compose … rm`, `docker rm`, `docker rmi`;
- `docker system prune`, `docker image prune`, `docker builder prune` durante un deploy;
- `up` sin nombrar los servicios (siempre `api web`).

El procedimiento recrea únicamente `api` y `web`; no toca PostgreSQL ni n8n (corren en el host Windows) ni `postgres-test`.

## Preflight de solo lectura

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy\Test-DaubertDeployPreflight.ps1
```

| Exit | Significado |
| --- | --- |
| `0` | Apto: el candidato cambia Hub/Docker y no hay `FAIL` |
| `1` | **No apto**: hay al menos un `FAIL` |
| `2` | **Sin cambios de Hub/Docker: no hay nada que desplegar** (no es un deploy exitoso) |

No cambia nada: no hace `git fetch/pull/checkout/reset` (usa `git --no-optional-locks`), ni `docker build/up/down/restart/rm/rmi/tag/commit`, ni SQL, ni llama a n8n, ni imprime secretos (del `.env` solo comprueba que las variables tengan valor; `docker compose config` va con `--quiet`). Su red se limita a `GET /api/health` en el puerto del Hub y `git ls-remote`. Para PostgreSQL y n8n solo consulta la **tabla local de puertos en escucha**: no abre ninguna conexión contra ellos (que `api` llegue a la base lo prueba `database: connected` de `/api/health`).

Comprueba, entre otros:

- **Bloqueantes (`FAIL`):** rama `main`; árbol limpio (incluye archivos sin seguimiento); **candidato == `HEAD`** (el build toma `GIT_COMMIT` de `HEAD`); candidato == `origin/main` (ref local y `ls-remote`); `/api/health` en `ok`/`connected`/`PRODUCTION`; commit desplegado legible; variables obligatorias, `DB_NAME`, `DB_USER`, `API_PORT`; Compose válido; `api` *healthy* y `web` *running*; backup válido de ≤ 6 h; espacio en disco; puerto del Hub y PostgreSQL en escucha.
- **Rollback (`FAIL` si el release requiere reconstruir, `WARN` si no hay nada que desplegar):** que la imagen en ejecución de `api` y `web` coincida, por **digest de manifiesto**, con la etiqueta `:latest` (así se puede preservar por nombre).
- **No bloqueantes (`WARN`):** release sin tag, backup `FREQUENT` atrasado (si algún tier tiene backup válido reciente), variables de `compose.prod-temp.yaml` vacías, n8n sin escuchar, tareas de backup con resultado anómalo, migraciones o cambios de n8n en el delta.

## Estado real de la imagen Web y alternativas de preservación

**Hallazgo (2026-10-02, solo lectura).** Docker usa el almacén de imágenes *containerd*. En él, `docker inspect <contenedor> --format '{{.Image}}'` **no es un ID direccionable para todos los contenedores**: para `daubert-hub-web-1` devuelve `sha256:49e460d8…`, que `docker image inspect` rechaza (`No such image`), por lo que un `docker tag` hecho con ese valor **falla**. En cambio, el *digest de manifiesto* con el que se creó el contenedor (`docker inspect … .ImageManifestDescriptor.digest`) **sí coincide** con el de `daubert-hub-web:latest` (`docker image inspect … --platform linux/amd64 --format '{{.Id}}'` → `sha256:cb967dfe…`), y el contenedor se creó 0,5 s después de esa imagen. Es decir: el `web` en ejecución **es** la imagen etiquetada; lo que no sirve es el ID de `.Image`. Con `api` ocurre lo mismo con otros valores y ambos IDs coinciden. Además, el bundle servido en `:8082` contiene la interfaz de V1 ("Activa pero incompleta"), ausente en el commit anterior.

Por eso el ancla **se crea por nombre, tras comprobar que el digest de manifiesto del contenedor es el de `:latest`**, no con `.Image`. Si esa comprobación falla, no hay ancla fiable y el deploy no debe continuar.

| Alternativa | ¿Recupera exactamente el estado actual? | ¿Depende de Git? | ¿Depende de que la imagen original siga disponible? | ¿Operación mutante? | ¿Rollback real o aproximado? |
| --- | --- | --- | --- | --- | --- |
| **1. Conservar la imagen existente** (etiquetarla por nombre tras comprobar el digest) — **recomendada** | Sí: misma imagen, mismo digest | No | Sí: debe seguir en el almacén de Docker (un `prune` no la borra mientras tenga etiqueta) | Mínima: solo añade una etiqueta; no toca contenedores | **Real** |
| 1b. Lo anterior + `docker save` a un archivo local fuera del repositorio (opcional) | Sí | No | No: el archivo sobrevive a una pérdida del almacén de Docker | Escribe un archivo (≈ 100 MB) | **Real**, con respaldo fuera de Docker |
| **2. `docker commit` del contenedor** | **No**: congela el sistema de archivos del contenedor (incluida su capa de escritura), crea una imagen con otro ID y su configuración puede diferir | No | No (usa el contenedor en ejecución) | **Sí**: crea una imagen y, salvo `--no-pause`, **pausa el contenedor de PROD** durante el commit | Solo aproximado; **no verificado** en este entorno. Únicamente como último recurso si la alternativa 1 no fuera posible |
| **3. Reconstruir desde el commit/tag anterior** | **No**: reconstruye, no recupera (imágenes base y dependencias pueden haber cambiado; ID distinto) | **Sí** (el commit debe existir localmente) | No | Sí (build + recrear) | **Reconstrucción aproximada**, no rollback exacto. Es lenta y no determinista. No presentarla como equivalente a la imagen actual |
| **4. Lo que ya soporta el Compose actual** | `up -d --no-build api web` usa la imagen que tenga la etiqueta `daubert-hub-<servicio>:latest`; por sí solo no conserva nada | No | Sí | Recrea `api` y `web` | Solo es el *mecanismo* para usar la alternativa 1. Las imágenes `daubert-hub-prod-temp-*` (2026-09-25) son anteriores a V1 y no equivalen al estado actual |

**Opción correcta: la 1** (más la 1b si se quiere independencia del almacén de Docker). La preservación es una operación **previa** y forma parte del PRE-DEPLOY (paso 8 de abajo); no se ha ejecutado.

## Checklist

Leyenda: **A** = automatizable (lo cubre el preflight, o se podría scriptar; **solo el preflight existe**), **M** = manual / requiere decisión o intervención del operador.

### PRE-DEPLOY

| # | Paso | A/M |
| --- | --- | --- |
| 1 | `main` limpia y sincronizada con `origin/main`; candidato **== `HEAD`** (el build toma `GIT_COMMIT` de `HEAD`) | A (preflight) |
| 2 | Revisar el delta contra PROD. Sin cambios en `apps/`, `docker/`, `compose*` (preflight exit `2`): **no desplegar** | A (preflight) + M (decisión) |
| 3 | Suite completa en verde: `npm run validate`. Las pruebas de integración exigen `TEST_DATABASE_URL` apuntando a `daubert_hub_test` y **rechazan cualquier otra base**; `compose.yaml` define para eso el servicio de desarrollo `postgres-test` (puerto `5433`). Nunca apuntarlas a `daubert_global` | M (el operador levanta/usa la BD de pruebas) |
| 4 | Si hay migración: **backup inmediato previo** (ver paso 6), luego precheck (solo lectura) → `up` → postcheck, **a mano con `psql` y rol administrativo**, antes del Hub ([migrations](../database/migrations.md)) | M |
| 5 | Si hay cambio de n8n: preparar/activar workflow y credencial **antes** del Hub | M |
| 6 | Backup válido reciente (SHA-256 verificado) y tareas de backup sanas. **Si el release incluye migraciones: tomar un backup justo antes de aplicarla** (no basta con el "reciente") y verificar su SHA-256 | A (preflight, solo la comprobación) + M (lanzar el backup previo a la migración) |
| 7 | Preflight sin `FAIL` y con exit `0` | A |
| 8 | **Ancla de rollback** por nombre, con validación de `$prev` y sin sobrescribir (comandos abajo). Sin ancla fiable no se despliega | M (copiar/pegar; scriptable, el script no existe) |
| 9 | Opcional: `docker save` de las anclas a un archivo local fuera del repositorio (alternativa 1b) | M |
| 10 | Avisar a usuarios de la ventana (los contenedores `api` y `web` se recrean) | M |

### DEPLOY

| # | Paso | A/M |
| --- | --- | --- |
| 1 | Fijar `APP_VERSION` y `GIT_COMMIT` en el shell | M (copiar/pegar) |
| 2 | `docker compose @cf up -d --build api web` | M (copiar/pegar) |
| 3 | Esperar a que `api` quede *healthy* | M |

### POST-DEPLOY

| # | Paso | A/M |
| --- | --- | --- |
| 1 | `GET /api/health`: `status: ok`, `database: connected`, `environment: PRODUCTION`, `version`/`commit` = los esperados | M (la consulta es automatizable; el preflight ya la hace) |
| 2 | `docker compose @cf ps`: `api` healthy, `web` running, y **solo** esos servicios afectados | M |
| 3 | Re-ejecutar el preflight: las imágenes deben seguir en `PASS` y el commit desplegado debe ser el nuevo | A |
| 4 | **PostgreSQL y n8n no se modificaron** (si el release no los incluye): ver comprobación abajo | M (comprobación de solo lectura) |
| 5 | Humo del Hub: login, Home, Automatizaciones, Actividad reciente, Proveedores, Contactos. **No** probar reprocesos con ejecuciones reales | M |
| 6 | Revisar logs de `api` (`docker compose @cf logs --tail 100 api`) | M |
| 7 | Registrar la nota en `docs/deployments/` y enlazarla desde su `README.md` | M |

### ROLLBACK

| # | Paso | A/M |
| --- | --- | --- |
| 1 | Decidir el rollback (health `!= ok`, humo fallido). **Sin `down`** | M |
| 2 | Comprobar que existen las anclas del commit anterior; preservar la imagen nueva como `failed-<commit>` (sin sobrescribir); devolver las anclas a `:latest`; `up -d --no-build api web` (comandos abajo) | M (copiar/pegar; scriptable, el script no existe) |
| 3 | Si hubo migración: `down.sql` con sus guards (aborta si es inseguro), en `psql` con rol administrativo | M |
| 4 | Si hubo cambio de n8n: revertir el workflow según su runbook | M |
| 5 | Verificar con el post-deploy (`/api/health` con el commit anterior) | M / A |

## Comandos (PowerShell, desde la raíz del repositorio)

> Revisados estáticamente; **no ejecutados**. Todos se ejecutan en la misma sesión de PowerShell. `docker compose @cf …` usa siempre ruta relativa a la raíz del repositorio.

```powershell
# Constantes de PROD (compose.yaml NO se carga a propósito)
$cf = @('--project-name','daubert-hub','--env-file','deploy/pilot.prod.env','-f','compose.pilot.yaml','-f','compose.prod-temp.yaml')

# PRE-DEPLOY: preflight (solo lectura). Exit 0 = apto; 1 = no apto; 2 = nada que desplegar
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy\Test-DaubertDeployPreflight.ps1
```

**Ancla de rollback (PRE-DEPLOY, paso 8).** Etiqueta por nombre la imagen que corre hoy. No usa `docker inspect … .Image` (no es direccionable para `web`). Aborta si `$prev` es inválido, si el ancla ya existe o si la imagen en ejecución no es la etiquetada `:latest`:

```powershell
$prev = [string](Invoke-RestMethod http://localhost:8082/api/health).commit
if ($prev -notmatch '^[0-9a-f]{7,40}$') { throw "Commit desplegado invalido: '$prev' (no se crea ancla)" }

foreach ($svc in 'api','web') {
    $anchor = "daubert-hub-${svc}:rollback-$prev"
    docker image inspect $anchor 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { throw "${anchor} ya existe: no se sobrescribe" }
    $run = docker inspect "daubert-hub-${svc}-1" --format '{{.ImageManifestDescriptor.digest}}'
    $tag = docker image inspect "daubert-hub-${svc}:latest" --platform linux/amd64 --format '{{.Id}}'
    if (-not $run -or $run -ne $tag) { throw "${svc}: la imagen en ejecucion no es daubert-hub-${svc}:latest; no hay ancla fiable" }
    docker tag "daubert-hub-${svc}:latest" $anchor
    $chk = docker image inspect $anchor --platform linux/amd64 --format '{{.Id}}'
    if ($chk -ne $run) { throw "${anchor} no apunta al manifiesto en ejecucion" }
    "OK ${anchor} -> $run"
}
```

La comprobación posterior (`$chk -eq $run`) deja confirmado que **cada ancla existe y apunta exactamente a la imagen en ejecución**. Opcional (alternativa 1b), a una ruta local fuera del repositorio:

```powershell
$tar = Join-Path '<carpeta-local-fuera-del-repo>' "hub-rollback-$prev.tar"   # sustituir la carpeta por una ruta real
docker save "daubert-hub-api:rollback-$prev" "daubert-hub-web:rollback-$prev" -o $tar
```

**Deploy:**

```powershell
$env:APP_VERSION = (node -p "require('./package.json').version")   # = package.json raiz (hoy 0.9.0-pilot.2)
$env:GIT_COMMIT  = (git rev-parse --short HEAD)                     # = el candidato (el preflight exige candidato == HEAD)
docker compose @cf up -d --build api web                            # solo api y web; nunca down
```

`APP_VERSION` y `GIT_COMMIT` llegan al `api` como `ARG`→`ENV` del Dockerfile (`compose.pilot.yaml` los pasa como `build.args`); el `web` no los recibe ni los necesita. Compose construye antes de recrear: si el build falla, los contenedores actuales siguen sirviendo.

**Post-deploy:**

```powershell
docker compose @cf ps
Invoke-RestMethod http://localhost:8082/api/health

# PostgreSQL y n8n NO se modificaron (si el release no los incluye): sus procesos arrancaron ANTES del deploy
Get-Date
foreach ($port in 5432, 5678) {
    $pid_ = (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if ($pid_) { $c = Get-CimInstance Win32_Process -Filter "ProcessId=$pid_"; "{0}: {1} (PID {2}) arranco {3}" -f $port,$c.Name,$c.ProcessId,$c.CreationDate } else { "{0}: nada escucha" -f $port }
}
```

La fecha de arranque de ambos procesos debe ser anterior al momento del deploy (se usa `Win32_Process.CreationDate` porque `Get-Process … StartTime` no es legible para el proceso de PostgreSQL sin elevación). Si el release incluyera migraciones o n8n, esta comprobación no aplica y se sustituye por el postcheck de la migración o el runbook de n8n.

**Rollback del Hub** (solo `api` y `web`; **sin `down`**):

```powershell
$prev = '<commit anterior, el usado al crear el ancla>'
$new  = $env:GIT_COMMIT      # commit con falla (misma sesion del deploy); si no, escribirlo a mano
foreach ($v in $prev, $new) { if ($v -notmatch '^[0-9a-f]{7,40}$') { throw "Commit invalido: '$v'" } }

foreach ($svc in 'api','web') {
    $anchor = "daubert-hub-${svc}:rollback-$prev"
    $failed = "daubert-hub-${svc}:failed-$new"
    docker image inspect $anchor 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falta el ancla ${anchor}: no hay rollback por imagen" }
    docker image inspect $failed 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { throw "${failed} ya existe: no se sobrescribe" }
}
foreach ($svc in 'api','web') {
    docker tag "daubert-hub-${svc}:latest" "daubert-hub-${svc}:failed-$new"     # conserva la imagen nueva para analizarla
    docker tag "daubert-hub-${svc}:rollback-$prev" "daubert-hub-${svc}:latest"  # :latest vuelve a la imagen anterior
}
docker compose @cf up -d --no-build api web                                     # --no-build: usa la etiqueta, no reconstruye
```

`--no-build` es una opción documentada de `docker compose up` ("Don't build an image, even if it's policy"); `up` recrea los servicios nombrados cuando su imagen cambió. El rollback no depende de Git, pero sí de que las imágenes ancla sigan en el almacén de Docker, de `deploy/pilot.prod.env` y de los archivos Compose. Después: `Invoke-RestMethod http://localhost:8082/api/health` debe mostrar el commit anterior. Las imágenes `failed-<commit>` se conservan para el análisis y se eliminan a mano más tarde (no forma parte de este procedimiento).

`docker compose … config` imprime secretos interpolados: usarlo siempre con `--quiet`, o no usarlo.

## Rollback: qué existe y qué falta

| Pieza | Estado |
| --- | --- |
| Rollback del Hub antes documentado | Solo "reconstruir la versión anterior" ([deployment](deployment.md#rollback-del-hub)): reconstrucción aproximada, lenta y dependiente de Git |
| Preservar la imagen exacta | Mecanismo definido (ancla por nombre con comprobación de digest). **No ejecutado, no probado** en PROD |
| Imagen `web` en ejecución | **Es** la imagen etiquetada (mismo manifiesto); el ancla debe crearse por nombre, no con `docker inspect … .Image` |
| Script de ancla/rollback | **No existe**: son comandos manuales |
| Prueba del rollback | **Pendiente**: ni el ancla ni `up --no-build` se han ejecutado en PROD |
| Rollback de PostgreSQL | Cada migración trae `down.sql` con guards; manual |
| Rollback de n8n | Por workflow, ver [runbook de Caterpillar](../automations/caterpillar/production-runbook.md#rollback) |

## Pendientes y riesgos conocidos (no bloquean el preflight)

- **Pruebas automatizadas de `Test-DaubertDeployPreflight.ps1`: pendientes** (recomendado, aún no implementado). Deberían vivir en `scripts/deploy/tests` para no alterar el conteo de las 884 pruebas de backup, y cubrir: ausencia de cmdlets de escritura y de verbos mutantes de Docker/Git, asignación de `PASS`/`WARN`/`FAIL`, los tres códigos de salida (incluido el exit `2`) y que no se impriman secretos.
- La tarea `Daubert - PostgreSQL Frequent` no ha publicado backup desde 2026-10-01 16:30 aunque figura con resultado `0`; Daily y Monthly están al día. Causa no determinada (posible suspensión del equipo).
- El commit `add458c` no tiene tag; el último es `v0.9.0-pilot.2` (`bdf6e66`).
- `compose.prod-temp.yaml` vive solo en el host de deployment (ver [nota](../deployments/2026-10-01-hub-v1-prod.md)); si se pierde el host, hay que reconstruirlo desde su descripción en esa nota.
- El ancla vive en el almacén de imágenes de Docker Desktop; sin `docker save` (1b) depende de que ese almacén no se pierda.
- Pendientes de Disaster Recovery (restore en otra estación, `globals`): **no bloquean** el deployment.
