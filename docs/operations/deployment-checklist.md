# Checklist de deployment del Hub (PROD)

> **Actualización documental de estado (2026-11-11):** el [primer deployment supervisado](../deployments/2026-11-11-hub-cicd-pilot-prod.md) terminó correctamente y sus anclas fueron verificadas. **No se ejecutó rollback real.** Las instantáneas anteriores conservadas abajo son históricas. Para identificar y aprobar versión/SHA/tags, consultar la [política de releases](release-policy.md); este checklist mantiene la autoridad del procedimiento PROD.

Complementa a [deployment](deployment.md) (orden, trampas) y a [`deploy/README.md`](../../deploy/README.md) (comandos genéricos). Este documento fija el **procedimiento de PROD tal como corre hoy** (proyecto `daubert-hub`, `compose.pilot.yaml` + `compose.prod-temp.yaml`, puerto `8082`; ver [nota 2026-10-01](../deployments/2026-10-01-hub-v1-prod.md)). **Sin secretos.**

> **Estado (actualizado 2026-10-22): en uso.** `Deploy-DaubertHub.ps1 -Deploy` (con su ancla de rollback) se usó en los releases de 2026-10-07 (v1.0.1), 2026-10-09 (v1.0.5) y 2026-10-12 (v1.0.6); ver [deployments](../deployments/README.md). El release de 2026-10-21 (`6370753`, asignación puntual de Pagos) incluía migraciones ya aplicadas a mano y el script **bloquea siempre** los releases con migraciones, por lo que se desplegó con los **comandos manuales** de este documento ([nota](../deployments/2026-10-22-payment-file-assignments-prod.md)). El **rollback por imagen no se ha ejecutado nunca en PROD**: está preparado (anclas y `docker save`) y sus comandos solo se revisaron estáticamente.
>
> **Existe `scripts/deploy/Deploy-DaubertHub.ps1`** (modos `-Preflight`, `-WhatIf`, `-Deploy`; ver [abajo](#script-de-deployment-deploy-dauberthubps1)). **No existe un modo `-Rollback`**: el rollback sigue siendo manual (comandos de la sección ROLLBACK). Los cambios solo de configuración del Hub (p. ej. banderas) se aplican editando `deploy/pilot.prod.env` (con copia previa) y recreando solo el `api`: `docker compose … up -d --no-build api`.

## Referencia (2026-10-02, histórica)

> Instantánea de un preflight anterior, conservada como ejemplo del formato. **Estado vigente (2026-10-22):** Hub en PROD `6370753` (`1.0.6`); `main` solo difiere por documentación; migraciones aplicadas hasta la `20261022_017`; workflow de Pagos `pagosProdAsignaciones01`.

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
| `deploy/closure/entry-closure-override.yaml` | Repositorio | Monta de solo lectura el directorio externo de `conf.d` (cierre de entradas). **Obligatorio en toda recreación de Web**, incluido el rollback; ver [joint-deployment-plan](../automations/caterpillar/joint-deployment-plan.md) §2 |
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

### Entrada centralizada de planificación (Fase 2A)

Desde un checkout operativo **en `main`, limpio y sincronizado**, con el SHA completo
aprobado en el expediente de autorización (no obtener la aprobación de `HEAD`):

```powershell
$approved = '<SHA hexadecimal aprobado de 40 caracteres>'
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts\deploy\Invoke-DaubertRelease.ps1 -Plan -ExpectedCommit $approved
$LASTEXITCODE
```

`Invoke-DaubertRelease.ps1 -Plan` exige el SHA aprobado y compara el SHA completo con `HEAD`
antes y después de las comprobaciones. Acepta hexadecimal en mayúsculas o minúsculas;
rechaza ramas, tags, SHA abreviados y argumentos adicionales de operación.
Reutiliza **una sola ejecución de `Deploy-DaubertHub.ps1 -WhatIf -Candidate <SHA>`**:
este ya ejecuta el preflight, comprueba rama/limpieza/sincronización, consulta
`/api/health`, calcula el delta y valida/simula el plan. No vuelve a implementar esos checks.
Con preflight bloqueado o sin cambios, el procedimiento existente termina antes de simular.

| Exit del orquestador | Resultado |
| --- | --- |
| `0` | **APTO**: preflight y simulación completados; no es un despliegue ni una autorización |
| `1` | **BLOQUEADO**: SHA distinto de `HEAD`, comprobación fallida, excepción o código inesperado del hijo |
| `2` | **SIN CAMBIOS DE HUB/DOCKER**: no desplegar ni reiniciar para refrescar el SHA |
| `3` | Uso incorrecto detectado por el orquestador: falta modo efectivo o SHA de formato inválido |

Los errores del enlazador de parámetros de `powershell -File` (parámetro obligatorio omitido,
parámetro desconocido como `-Rollback`) terminan con `1` antes de ejecutar el cuerpo.

**Límites y decisiones operativas:**

- `-Plan` es solo lectura: Git con `--no-optional-locks`; Docker únicamente mediante las lecturas
  del procedimiento existente. Nunca build/tag/up/down/restart, inicio de servicios,
  SQL ni importación/activación/desactivación de n8n. Para publicar, ver Fase 2B abajo; no hay `-Rollback`.
- No recibe credenciales ni opciones para reconocer migraciones/n8n ya aplicados o saltar
  compuertas. Un release con estos cambios que necesite excepciones queda bajo el runbook
  manual; esta entrega no concede esas excepciones.
- `-Plan` no escribe logs, transcripciones ni temporales. La salida del hijo queda en memoria;
  solo publica el resumen numérico del preflight y el commit desplegado si tienen formato
  conocido, además de mensajes fijos y el SHA aprobado. Descarta stderr y no imprime
  excepciones ni salida cruda (ni siquiera secretos sin etiqueta). Los detalles del plan
  siguen disponibles en el `-WhatIf` existente, para revisión en el entorno autorizado.
- **Conserva la política de WARN de Fase 1/preflight**: si `git ls-remote` no responde,
  el preflight puede advertir sin bloquear aunque compruebe `origin/main` local.
  `APTO` no acredita por sí solo sincronización remota verificada ni CI verde. El resumen
  conserva el número de advertencias; revisar su causa y la aprobación antes de publicar.
  Fase 2B endurece esta política exclusivamente para `-Deploy`: remoto inaccesible bloquea.
- El plan es una observación, no un bloqueo contra concurrencia ni un permiso reutilizable.
  Revalidar en la ventana autorizada; no copiar secretos al worktree de desarrollo.
- El desarrollo ocurre en una rama/worktree independiente; las pruebas usan mocks y no
  ejecutan el plan real contra PROD. Un worktree de feature no supera el gate de rama `main`.

Relación con los artifacts y el CI de Fase 1: [release-pipeline](release-pipeline.md#fase-2a-plan-local-de-solo-lectura).

### Publicación supervisada con un comando (Fase 2B)

**Solo en el servidor autorizado, en consola interactiva.** Aprobar el SHA completo del
reporte de Fase 1 y comprobar su CI. Antes de invocar el orquestador, el operador sincroniza
el worktree productivo: verificar que está en `main`, sin cambios ni archivos sin seguimiento;
si no lo está, detenerse y resolverlo sin borrar trabajo. Luego:

```powershell
$approved = '<SHA completo del expediente de aprobacion>'
git fetch origin main
# Exigir exit 0 y verificar que origin/main es EXACTAMENTE $approved antes de continuar.
git rev-parse origin/main
git merge --ff-only $approved
# Exigir exit 0; nunca sustituir un rechazo por reset --hard, clean o un merge forzado.
git status --short --branch
git rev-parse HEAD
# Con main limpia y HEAD == origin/main == SHA aprobado:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy\Invoke-DaubertRelease.ps1 -Deploy -ExpectedCommit $approved
$LASTEXITCODE
```

La sincronización es **manual y previa**, nunca parte del orquestador. Si `main` remoto ya
avanzó, detenerse y revisar una nueva aprobación; no desplegar el SHA anterior por fuerza.
`-Plan` y `-Deploy` son mutuamente excluyentes; sin modo o con ambos se devuelve `3`.

`-Deploy` primero ejecuta el `-WhatIf` existente con `-RequireSynchronizedMain`: SHA completo
igual a `HEAD`, ref local `origin/main` y **una única respuesta válida** para `refs/heads/main`
de `git ls-remote`; exige `main` limpia y bloquea cualquier error o ambigüedad del remoto.
Reutiliza preflight, delta y gates existentes: sin cambios Hub/Docker devuelve `2`; cambios
`database/` o `n8n/` bloquean sin opciones para exceptuarlos.

Después invoca **el script real** `Deploy-DaubertHub.ps1 -Deploy -Candidate <SHA>` con el
control estricto, en la misma consola PowerShell. Su `Read-Host` pide la frase exacta
`DEPLOY DAUBERT HUB`: el operador la escribe, no se inyecta stdin ni se usa `-NonInteractive`.
Tras confirmar se vuelven a consultar contexto, gates, salud, delta y sincronización remota,
inmediatamente antes de preservar anclas y reconstruir. Solo el script existente crea/verifica
anclas, recrea `api web` y verifica Docker y health posterior; el orquestador no duplica esa lógica.

**Ventana cerrada:** agregar `-RequireClosedWindow` al mismo comando cuando el procedimiento
lo exija. Se transmite a simulación, deployment y revalidación. El cierre se prepara, cierra,
recarga y abre únicamente mediante el procedimiento de cierre de entradas existente; el
orquestador no cambia su estado. No declarar la ventana finalizada hasta completar ese runbook.

Resultados de `-Deploy`: `0` deployment y verificaciones posteriores correctos; `1` bloqueado
o cancelado (puede haber etiquetas de anclas creadas si se abortó su preservación); `2` sin
cambios, no desplegado; `3` uso inválido; `5` deployment fallido o resultado incierto.
Ante `5`, comprobar el estado y consultar **ROLLBACK** abajo: no hay rollback automático.

La pantalla muestra SHA aprobado, anterior, versión candidata, estado de checks y resultado
de deployment/postchecks. Descarta salida libre y errores externos; para diagnóstico detallado
seguir este checklist en el entorno autorizado, sin transcripciones de credenciales.

**Registro mínimo:** al terminar una delegación de deployment (incluida cancelación), escribe
un JSON con UTC, SHA aprobado/anterior, versión, código, postchecks y requisito de cierre en
`%LOCALAPPDATA%\DaubertHub\releases\<GUID>.json`. No contiene stdout, stderr, tokens ni rutas
de credenciales. No escribe dentro del repo, en rutas con Dropbox ni mediante ancestros
redirigidos/junctions. La escritura es best-effort: si no es segura o falla, muestra una
advertencia fija y conserva el resultado del deployment; registrar entonces la evidencia
manualmente fuera del repo y Dropbox. No genera registro para `-Plan` ni para rechazos previos
a delegar `-Deploy`. Una interrupción del proceso puede impedir la evidencia final.

Usar un único operador y mantener el worktree sin cambios durante toda la ventana. La
revalidación no es un lock contra otros procesos; la aprobación externa y CI siguen siendo
responsabilidad del operador. No usar esta entrega para SQL, n8n, rollback automático o cambios
solo de configuración. Esta funcionalidad se valida en desarrollo exclusivamente con mocks.

### Preflight directo

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

## Script de deployment: `Deploy-DaubertHub.ps1`

`scripts/deploy/Deploy-DaubertHub.ps1` envuelve el preflight y este checklist en tres **modos mutuamente excluyentes**. Sin ningún modo (o con más de uno) no hace nada: muestra el uso (o rechaza con exit `3`).

```powershell
.\scripts\deploy\Deploy-DaubertHub.ps1 -Preflight   # solo lectura
.\scripts\deploy\Deploy-DaubertHub.ps1 -WhatIf      # solo lectura: valida y muestra el plan
.\scripts\deploy\Deploy-DaubertHub.ps1 -Deploy      # el ÚNICO modo que modifica PROD
```

| Modo | Qué hace | ¿Modifica algo? |
| --- | --- | --- |
| `-Preflight` | Ejecuta `Test-DaubertDeployPreflight.ps1` y **propaga su exit code**: `0` apto, `1` bloqueado, `2` sin cambios de Hub/Docker | No |
| `-WhatIf` | Ejecuta el preflight y **las mismas validaciones que `-Deploy`**; si todo pasa imprime el plan: commit actual de PROD, commit a desplegar (== `HEAD`), `APP_VERSION`, cambios de Hub/Docker que se desplegarían, servicios afectados (`api`, `web`), las anclas de rollback que se crearían, el comando Compose exacto, los checks post-deploy y el procedimiento de rollback. Con preflight `1` → "bloqueado"; con `2` o sin cambios de Hub/Docker → "SIN CAMBIOS DE HUB/DOCKER — NO HAY NADA QUE DESPLEGAR" y no imprime plan | **No**: nunca llega a la función mutante (bloqueada fuera de `-Deploy`) |
| `-Deploy` | 1) preflight (aborta con `1`; con `2` informa que no hay nada que desplegar); 2) vuelve a comprobar `HEAD == candidato`, árbol limpio, commit anterior (SHA hexadecimal válido), `/api/health` de PROD sano, `APP_VERSION`, imágenes de Compose, que la imagen en ejecución de `api` y `web` sea la etiquetada (digest de manifiesto) y que las etiquetas `rollback-<commit anterior>` **no existan**; 3) imprime el plan y pide escribir **exactamente** `DEPLOY DAUBERT HUB` (cualquier otra entrada, incluidas variantes en minúscula o con espacios, cancela sin tocar nada); 4) crea las anclas por nombre y comprueba que cada una existe y apunta al digest esperado; 5) fija `APP_VERSION` (del `package.json` raíz) y `GIT_COMMIT` (`git rev-parse --short=7 HEAD`) y ejecuta `docker compose … up -d --build api web`; 6) espera a `api` *healthy* y a `web`, verifica `/api/health` (`status=ok`, `database=connected`, `environment=PRODUCTION`, `commit` = candidato, `version` = `APP_VERSION`), `docker compose ps` (solo lectura) y que ambos servicios estén en ejecución | **Sí**, y solo `api` y `web` |

Códigos de salida: `0` correcto · `1` bloqueado o abortado (PROD no cambió) · `2` nada que desplegar · `3` error de uso · `5` **DEPLOYMENT FALLIDO**.

**Si el post-deploy falla**, `-Deploy` **no hace rollback automático**: se detiene, conserva el estado y muestra `DEPLOYMENT FALLIDO` y `ROLLBACK DISPONIBLE` con el procedimiento (sección ROLLBACK).

**Garantías de seguridad (verificadas por pruebas):**

- Todo proceso externo pasa por dos únicos puntos: una lectura con lista de comandos permitidos (`git` y `docker` solo de lectura, y el preflight) y una mutación con una lista **exacta**: `docker tag daubert-hub-<svc>:latest daubert-hub-<svc>:rollback-<sha>` y `docker compose --project-name daubert-hub --env-file deploy/pilot.prod.env -f compose.pilot.yaml -f compose.prod-temp.yaml up -d --build api web`. Cualquier otro comando (incluidos `down`, `rm`, `rmi`, `prune`, `restart`, `commit`, `save`, `--remove-orphans` o servicios distintos de `api`/`web`) es **rechazado antes de ejecutarse**.
- Una etiqueta de rollback existente **aborta**; nunca se sobrescribe. No usa `docker commit` ni `docker save`.
- No ejecuta SQL ni migraciones, no toca n8n ni PostgreSQL y no ejecuta `git fetch/pull/checkout/reset`. Un release con migraciones se **bloquea siempre** (se despliega siguiendo el checklist manual). Un release con cambios bajo `n8n/` también se **bloquea**, salvo que se pase `-AcknowledgeN8nAlreadyApplied`: confirmación explícita de que esos archivos son exports versionados de workflows **ya aplicados y verificados en PROD**. El switch solo levanta ese motivo de bloqueo (muestra una advertencia), no importa, activa ni modifica nada en n8n, y no afecta a migraciones ni a ninguna otra validación.
- No imprime secretos: toda la salida pasa por un filtro que oculta contraseñas, tokens y secretos, y del archivo de entorno solo se lee `HUB_PORT`.

**Pruebas:** `scripts/deploy/tests/Deploy-DaubertHub.Tests.ps1` (Pester 3.4; carpeta separada de las 884 pruebas de backup). Simulan Docker y Git con mocks y **nunca ejecutan un deploy**:

```powershell
Import-Module Pester -RequiredVersion 3.4.0
Invoke-Pester scripts\deploy\tests
```

Los comandos manuales de abajo quedan como **referencia equivalente** (y para el rollback, que aún no tiene modo propio).

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

**Opción correcta: la 1** (más la 1b si se quiere independencia del almacén de Docker). La preservación es una operación **previa** y forma parte del PRE-DEPLOY (paso 8 de abajo). Las anclas del piloto de 2026-11-11 quedaron verificadas según su expediente; esto no equivale a ejecutar rollback real ni acredita un `docker save` de ese piloto.

## Checklist

Leyenda: **A** = automatizado por el preflight o por `Deploy-DaubertHub.ps1`; **M** = manual / requiere decisión o intervención del operador (incluye todo el rollback: aún no tiene modo propio).

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
| 8 | **Ancla de rollback** por nombre, con validación de `$prev` y sin sobrescribir. Sin ancla fiable no se despliega | A (`Deploy-DaubertHub.ps1 -Deploy` la crea y la verifica; comandos manuales abajo como referencia) |
| 9 | Opcional: `docker save` de las anclas a un archivo local fuera del repositorio (alternativa 1b) | M |
| 10 | Avisar a usuarios de la ventana (los contenedores `api` y `web` se recrean) | M |

### DEPLOY

| # | Paso | A/M |
| --- | --- | --- |
| 1 | Fijar `APP_VERSION` y `GIT_COMMIT` | A (`-Deploy`) |
| 2 | `docker compose @cf up -d --build api web` | A (`-Deploy`, tras la confirmación `DEPLOY DAUBERT HUB`) |
| 3 | Esperar a que `api` quede *healthy* y `web` responda | A (`-Deploy`) |

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

### Ventana con cierre de entradas (procedimiento usado en el release 1.1.0)

Orden verificado el 2026-10-28 (detalle en la [nota](../deployments/2026-10-28-hub-v1.1.0-prod.md)); ejecutar desde `daubert-hub-deploy-main` en `main` y en el commit aprobado:

1. Preflight (`Deploy-DaubertHub.ps1 -Preflight`) sin `FAIL`; respaldos PostgreSQL y n8n recientes con hash coincidente; anclas o `docker save` de rollback disponibles; un único operador de n8n durante la ventana (el cierre HTTP **no** bloquea ejecuciones manuales de n8n, CLI ni reintentos).
2. `.\scripts\deploy\Set-EntryClosure.ps1 -Action Close` → debe terminar en `CLOSURE ACTIVE (verified)`.
3. `.\scripts\deploy\Deploy-DaubertHub.ps1 -WhatIf -RequireClosedWindow` y después `-Deploy -RequireClosedWindow`. El script pide escribir `DEPLOY DAUBERT HUB` con `Read-Host`: requiere una consola interactiva (un `powershell.exe` hijo con la frase por stdin funciona desde un entorno no interactivo).
4. Verificar `/api/health` (versión y commit esperados, `database: connected`).
5. `Set-EntryClosure.ps1 -Action Reload` (refresca la resolución de `api:3000` tras recrear la API) → `RELOADED`.
6. `Set-EntryClosure.ps1 -Action Open` → `CLOSURE OFF (verified)`; repetir health y humo. No declarar éxito con el cierre activo.

### ROLLBACK

| # | Paso | A/M |
| --- | --- | --- |
| 1 | Decidir el rollback (health `!= ok`, humo fallido). **Sin `down`** | M |
| 2 | Comprobar que existen las anclas del commit anterior; preservar la imagen nueva como `failed-<commit>` (sin sobrescribir); devolver las anclas a `:latest`; `up -d --no-build api web` (comandos abajo) | M (copiar/pegar; **no existe un modo `-Rollback`**) |
| 3 | Si hubo migración: `down.sql` con sus guards (aborta si es inseguro), en `psql` con rol administrativo | M |
| 4 | Si hubo cambio de n8n: revertir el workflow según su runbook | M |
| 5 | Verificar con el post-deploy (`/api/health` con el commit anterior) | M / A |

## Comandos (PowerShell, desde la raíz del repositorio)

> Revisados estáticamente; **no ejecutados**. Todos se ejecutan en la misma sesión de PowerShell. `docker compose @cf …` usa siempre ruta relativa a la raíz del repositorio.

```powershell
# Constantes de PROD (compose.yaml NO se carga a propósito)
$cf = @('--project-name','daubert-hub','--env-file','deploy/pilot.prod.env','-f','compose.pilot.yaml','-f','compose.prod-temp.yaml','-f','deploy/closure/entry-closure-override.yaml')

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
$env:APP_VERSION = (node -p "require('./package.json').version")   # = package.json raiz. SUBIRLA ANTES (chore(release)): el Hub muestra lo que valga aqui
$env:GIT_COMMIT  = (git rev-parse --short=7 HEAD)                     # = el candidato (el preflight exige candidato == HEAD)
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
$new = '<commit corto del candidato aprobado, registrado ANTES del deploy>'
$rollbackDigests = @{ api = '<sha256 registrado antes del deploy>'; web = '<sha256 registrado antes del deploy>' }
# Consola de recuperacion dedicada: stderr nativo puede ser progreso; validar CADA exit code.
$ErrorActionPreference = 'Continue'
foreach ($v in $prev, $new) { if ($v -notmatch '^[0-9a-f]{7,40}$') { throw "Commit invalido: '$v'" } }

$latestDigests = @{}
foreach ($svc in 'api','web') {
    $anchor = "daubert-hub-${svc}:rollback-$prev"
    $failed = "daubert-hub-${svc}:failed-$new"
    $digest = @(docker image inspect $anchor --platform linux/amd64 --format '{{.Id}}' 2>$null)
    if ($LASTEXITCODE -ne 0 -or $digest.Count -ne 1 -or $rollbackDigests[$svc] -cnotmatch '^sha256:[0-9a-f]{64}$' -or $digest[0] -cne $rollbackDigests[$svc]) { throw "Ancla ausente o distinta de la evidencia previa: $svc" }
    docker image inspect $failed 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { throw "${failed} ya existe: no se sobrescribe" }
    $current = @(docker image inspect "daubert-hub-${svc}:latest" --platform linux/amd64 --format '{{.Id}}' 2>$null)
    if ($LASTEXITCODE -ne 0 -or $current.Count -ne 1) { throw "No se puede preservar latest: $svc" }
    $latestDigests[$svc] = $current[0]
}
# Primero preservar AMBAS imagenes; un fallo detiene el procedimiento antes de recrear.
foreach ($svc in 'api','web') {
    docker tag "daubert-hub-${svc}:latest" "daubert-hub-${svc}:failed-$new" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo preservar la imagen fallida: $svc" }
    $saved = @(docker image inspect "daubert-hub-${svc}:failed-$new" --platform linux/amd64 --format '{{.Id}}' 2>$null)
    if ($LASTEXITCODE -ne 0 -or $saved.Count -ne 1 -or $saved[0] -cne $latestDigests[$svc]) { throw "Imagen fallida no preservada correctamente: $svc" }
}
foreach ($svc in 'api','web') {
    docker tag "daubert-hub-${svc}:rollback-$prev" "daubert-hub-${svc}:latest" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo devolver el ancla a latest: $svc" }
    $restored = @(docker image inspect "daubert-hub-${svc}:latest" --platform linux/amd64 --format '{{.Id}}' 2>$null)
    if ($LASTEXITCODE -ne 0 -or $restored.Count -ne 1 -or $restored[0] -cne $rollbackDigests[$svc]) { throw "latest no coincide con la imagen anterior: $svc" }
}
docker compose @cf up -d --no-build api web 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Rollback Compose fallido: conservar anclas y diagnosticar, no repetir ciegamente.' }
# Verificacion posterior (solo lectura). Con containerd, .Image del contenedor NO es direccionable y el
# digest de 'latest' no prueba que el contenedor lo use: se compara el manifiesto con el que se creo cada
# contenedor (.ImageManifestDescriptor.digest) con el digest del ancla registrado ANTES del deploy.
# Limite unico de $limitSec s desde aqui: ninguna espera ni GET /api/health termina despues del plazo (el GET usa
# como -TimeoutSec el tiempo restante, maximo 10 s; con menos de 1 s restante no se consulta y queda pendiente).
$limitSec = 180; $pollMs = 5000; $httpMaxSec = 10
$fmtRun = '{{if .ImageManifestDescriptor}}{{.ImageManifestDescriptor.digest}}{{end}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}'
$deadline = (Get-Date).AddSeconds($limitSec)
while ($true) {
    $pending = @()
    foreach ($svc in 'api','web') {
        $info = @(docker inspect "daubert-hub-${svc}-1" --format $fmtRun 2>$null)
        $f = @(); if ($LASTEXITCODE -eq 0 -and $info.Count -eq 1) { $f = @(([string]$info[0]).Split('|')) }
        if ($f.Count -ne 3) { throw "Rollback NO completado: no se pudo inspeccionar daubert-hub-${svc}-1." }
        if ($f[0] -cnotmatch '^sha256:[0-9a-f]{64}$') { throw "Rollback NO completado: ${svc} no expone un digest de manifiesto valido." }
        if ($f[0] -cne $rollbackDigests[$svc]) { throw "Rollback NO completado: ${svc} ejecuta $($f[0]), no el ancla registrada." }
        if ($f[1] -ne 'running') { $pending += "${svc}: estado '$($f[1])', no running" }
        if ($svc -eq 'api' -and $f[2] -ne 'healthy') { $pending += "api: salud '$($f[2])', no healthy" }
    }
    $health = $null
    $leftSec = [math]::Floor(($deadline - (Get-Date)).TotalSeconds)
    if ($leftSec -ge 1) {
        try { $health = Invoke-RestMethod -Uri http://localhost:8082/api/health -TimeoutSec ([int][math]::Min($httpMaxSec, $leftSec)) -ErrorAction Stop } catch { $health = $null }
    }
    if (-not $health) { $pending += 'health: sin respuesta (o plazo agotado)' }
    elseif ($health.status -ne 'ok' -or $health.database -ne 'connected' -or $health.environment -ne 'PRODUCTION' -or $health.commit -ne $prev) { $pending += 'health: no confirma el commit anterior sano' }
    if ($pending.Count -eq 0) { break }
    $leftMs = [math]::Floor(($deadline - (Get-Date)).TotalMilliseconds)
    if ($leftMs -le 0) { break }
    Start-Sleep -Milliseconds ([int][math]::Min($pollMs, $leftMs))
}
if ($pending.Count -gt 0) {
    foreach ($p in $pending) { Write-Host "PENDIENTE: $p" }
    throw "Rollback NO completado: comprobaciones pendientes al agotar el limite de $limitSec s. Ejecutar el diagnostico de rollback-rehearsal.md; no repetir el bloque."
}
Write-Host 'Rollback por imagen completado: api y web ejecutan las anclas registradas, api healthy y health confirma el commit anterior. Continuar con el humo de solo lectura.'
```

Los SHA y digests se toman del expediente previo, **no** del health posterior al fallo.
`Deploy-DaubertHub.ps1` restaura `GIT_COMMIT` al salir: no usar esa variable para deducir
el candidato fallido. El bloque solo declara el rollback completado cuando `api` y `web`
están `running` con el manifiesto exacto de su ancla, `api` está `healthy` y `/api/health`
confirma el commit anterior sano; un contenedor ilegible o con otra imagen falla al instante
y los estados transitorios (`starting`, contenedor no `running`, health sin respuesta) se
reintentan dentro de un **límite único de 180 s** (`$limitSec`) medido desde el final de Compose:
las esperas (5 s) y cada `GET /api/health` (`-TimeoutSec` = tiempo restante, máximo 10 s) nunca
terminan después del plazo; solo `docker inspect`, local y sin timeout propio, puede añadir su
propia duración a la última vuelta. Agotado el plazo, falla con `PENDIENTE: …`. Ante cualquier rechazo o interrupción,
detenerse; no borrar etiquetas `failed-*` ni repetir el bloque completo: ejecutar el
[diagnóstico de solo lectura](rollback-rehearsal.md#3-diagnóstico-de-recuperación-solo-lectura)
y seguir únicamente el paso que indique su veredicto. Si el proxy devuelve 502 tras
recrear solo API, seguir el paso de `Set-EntryClosure.ps1 -Action Reload` del procedimiento
de ventana y repetir únicamente las verificaciones; no volver a etiquetar por ese motivo.

`--no-build` es una opción documentada de `docker compose up` ("Don't build an image, even if it's policy"); `up` recrea los servicios nombrados cuando su imagen cambió. El rollback no depende de Git, pero sí de que las imágenes ancla sigan en el almacén de Docker, de `deploy/pilot.prod.env` y de los archivos Compose. Después: `Invoke-RestMethod http://localhost:8082/api/health` debe mostrar el commit anterior. Las imágenes `failed-<commit>` se conservan para el análisis y se eliminan a mano más tarde (no forma parte de este procedimiento).

`docker compose … config` imprime secretos interpolados: usarlo siempre con `--quiet`, o no usarlo.

## Rollback: qué existe y qué falta

| Pieza | Estado |
| --- | --- |
| Rollback del Hub antes documentado | Solo "reconstruir la versión anterior" ([deployment](deployment.md#rollback-del-hub)): reconstrucción aproximada, lenta y dependiente de Git |
| Preservar la imagen exacta | Anclas API/Web `rollback-16153a8` comprobadas por digest contra la evidencia predeploy (2/2), según el expediente del piloto de 2026-11-11; no es una prueba de restauración |
| Imagen `web` en ejecución | **Es** la imagen etiquetada (mismo manifiesto); el ancla debe crearse por nombre, no con `docker inspect … .Image` |
| Script de ancla | Usado por el orquestador en el primer deployment supervisado. El rollback sigue siendo manual, sin modo `-Rollback` |
| Prueba del rollback | **Pendiente**: no se ejecutó rollback real en el piloto; verificar anclas no demuestra restauración de contenedores |
| Rollback de PostgreSQL | Cada migración trae `down.sql` con guards; manual |
| Rollback de n8n | Por workflow, ver [runbook de Caterpillar](../automations/caterpillar/production-runbook.md#rollback) |

## Pendientes y riesgos conocidos (no bloquean el preflight)

Las incidencias con fechas antiguas corresponden a esas revisiones, no a un diagnóstico actual del host. El expediente del piloto registra las comprobaciones de su ventana.

- **Primer deployment supervisado ejecutado el 2026-11-11**, con anclas comprobadas por digest. El rollback real sigue sin ejecutarse en ese piloto; pendiente un modo `-Rollback` separado, con confirmación explícita.
- **Pruebas automatizadas de `Test-DaubertDeployPreflight.ps1`: pendientes** (recomendado, aún no implementado). Deberían vivir en `scripts/deploy/tests` para no alterar el conteo de las 884 pruebas de backup, y cubrir: ausencia de cmdlets de escritura y de verbos mutantes de Docker/Git, asignación de `PASS`/`WARN`/`FAIL`, los tres códigos de salida (incluido el exit `2`) y que no se impriman secretos.
- La tarea `Daubert - PostgreSQL Frequent` no ha publicado backup desde 2026-10-01 16:30 aunque figura con resultado `0`; Daily y Monthly están al día. Causa no determinada (posible suspensión del equipo).
- Referencia histórica de 2026-10-02: `add458c` no tenía tag y el último de aquella revisión era `v0.9.0-pilot.2` (`bdf6e66`). La política y el caso posterior `v1.1.1` se documentan en [release-policy](release-policy.md).
- `compose.prod-temp.yaml` vive solo en el host de deployment (ver [nota](../deployments/2026-10-01-hub-v1-prod.md)); si se pierde el host, hay que reconstruirlo desde su descripción en esa nota.
- El ancla vive en el almacén de imágenes de Docker Desktop; sin `docker save` (1b) depende de que ese almacén no se pierda.
- Pendientes de Disaster Recovery (restore en otra estación, `globals`): **no bloquean** el deployment.
