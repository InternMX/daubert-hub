# B2 — Integración y despliegue coordinado de Daubert Hub con Caterpillar (preparado; NO ejecutado)

Estado al **2026-10-26**: preparado y ensayado en entornos aislados. **Nada se ha ejecutado en PROD**: ni push, ni merge, ni migraciones, ni recreación de contenedores.
Complementa [prod-cutover-016](prod-cutover-016.md) (migraciones, rol, n8n) y [deployment-checklist](../../operations/deployment-checklist.md) (procedimiento general del Hub). Sin secretos.

## 1. El problema: `origin/main` incluye el PR #17 de Pagos

`origin/main` (`c856763`) contiene el PR #17 (recuperación individual de archivos de Pagos), **preparado y no desplegado**. Su único cambio de runtime en el Hub está en `payment-file-assignments.repository.ts`:

| Código nuevo del Hub (#17) | Objeto que exige en la base | Estado en PROD |
| --- | --- | --- |
| `mutate()` con acción `ASSIGN` o `CHANGE`: `SELECT core.fn_destino_asignacion_pago_disponible($1,$2)` | función creada por la migración **019** | **no existe** |
| `protectReprocess()`: traduce el SQLSTATE `P4091` (`PAYMENT_RECOVERY_BUSY`) a `POINT_REPROCESS_BUSY` | lo lanza una función de la 019 | inocuo sin la 019 (nunca ocurre) |

PROD tiene la asignación puntual **habilitada** (`PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED=true`, `…N8N_READY=true`). **Si se desplegara un Hub construido desde `main` sin la 019**:
- **Fallarían** "asignar" y "cambiar" la empresa de un archivo de pago (error SQL `42883`, función inexistente; la transacción se revierte y el Hub responde error 500). Es la operación principal de la función.
- **Seguirían funcionando**: "revocar" asignación, listados y detalles de Pagos, el reproceso normal y todo lo demás (no se llama a ninguna otra función de la 019 desde el código nuevo).

La 019 no es solo "una función": agrega una columna y una tabla, **reemplaza** dos funciones vivas de Pagos, y su promoción exige además importar dos workflows en el n8n compartido (padre 108→111 nodos e hijo nuevo), cerrar mutaciones de Pagos durante la ventana, un respaldo consistente de n8n y una comprobación de la ruta real del webhook (403 sin token) antes de reabrir.

## 2. Alternativas

| | **A. Promoción 019 de Pagos coordinada** | **B. Release exclusivo de Caterpillar sobre `6370753`** |
| --- | --- | --- |
| Qué se despliega | Hub de `main` + 019 + workflows de Pagos (padre/hijo) + 013 + 016/017 + workflow Caterpillar | Hub = `6370753` + solo los commits de Caterpillar + 013 + 016/017 + workflow Caterpillar |
| Cambios en Pagos | Sí: columna, tabla, 2 funciones reemplazadas, 2 workflows en n8n compartido, nuevas rutas de recuperación | **Ninguno**: el código de Pagos del Hub es byte a byte el de PROD hoy |
| Dueño de la aprobación | Caterpillar **y** Pagos; su plan exige validación funcional real propia y autorización aparte | Solo Caterpillar |
| Ventana | Dos automatizaciones en el mismo n8n y la misma base a la vez | Solo Caterpillar |
| Recuperación | Cruzada: el rollback de la 019 está condicionado a "propietarios finalizados" (DOWN aborta con uno sin resolver); un fallo de Pagos puede bloquear revertir Caterpillar y viceversa | Independiente: imágenes `rollback-6370753` + `016 down`/`013 down` (antes de emitir) |
| Preflight | Cumple la política (candidato == `origin/main`) | **Dos `FAIL` esperados** (rama ≠ `main`, candidato ≠ `origin/main`); excepción documentada y aprobada |
| Deuda | Ninguna | Hay que reconciliar después: cuando Pagos promueva, desplegará desde `main`, que ya contendrá Caterpillar + #17 |

### B: ¿se puede construir de forma limpia y completa? Sí (verificado)
- **Combinación sin conflictos**: `6370753` + la rama (31 commits en total, incluida la fusión) se fusiona sin conflictos (`git merge`).
- **Nada se pierde de `main`**: entre `6370753` y `origin/main` solo hay documentación (#15, #16) y el PR #17 completo. No hay correcciones de seguridad ni dependencias actualizadas: `package.json`/`package-lock.json` de `main` solo agregan un script de pruebas de Pagos. El código de Pagos y las migraciones 015–017 de PROD quedan idénticos.
- **Diferencia con PROD** en archivos de runtime: solo Caterpillar y la `devDependency` `@electric-sql/pglite` (pruebas, no entra a la imagen).
- **Diferencia con `main`**: exactamente los archivos del PR #17 (código del repositorio de Pagos, sus pruebas, migraciones 018/019, manifiestos y scripts de n8n de Pagos, `.env.example`) y la documentación de #15/#16.
- Validación de B: ver sección 7.

## 3. Recomendación: **B** para el corte
1. No acopla Caterpillar a una promoción de Pagos con n8n compartido y cuya validación real aún no está autorizada.
2. No cambia nada del comportamiento de Pagos en PROD; cero riesgo de regresión sobre la asignación puntual.
3. Recuperación independiente y ya ensayada.
4. El PR de Caterpillar a `main` **sigue siendo válido y se puede aprobar ya**: la integración a `main` no despliega nada. La rama de release solo define **qué se construye** el día del corte.
5. Costo asumido: una excepción puntual al preflight (rama de release en vez de `main`), con las demás comprobaciones intactas.

Si Pagos prefiere A, el procedimiento de la sección 5 se mantiene, pero la ventana debe ejecutar primero su promoción completa (con su propio plan, ensayo y preflight del webhook) y esa decisión no se mezcla con los pasos de Caterpillar.

## 4. Qué entra al PR (`feat/caterpillar-remission-controls` → `main`)
- 139 archivos (+29 425 / −1 373), **ninguno de Pagos o Audi**; sin cambios en `docker/`, `compose*`, `deploy/` ni variables de entorno.
- Hub API (10 archivos): cancelación formal, autorización de regeneración, `ADMISSION_REJECTED`, detalle con historial. Hub Web (12): botón/diálogo *Regenerar*, cancelación, mensajes.
- Migraciones (22): en PROD solo **013**, plantilla de rol y **016** (incluye 017). Los `*_test` (014, 015, 017) no se aplican en PROD.
- n8n (32): candidatos; solo se importan a mano en la ventana. Pruebas, scripts y runbooks.
- El texto del PR está preparado (sin publicar); ver el resumen entregado con este documento.

## 5. Procedimiento del despliegue coordinado (ventana; **no ejecutar todavía**)

Orden: 1) desactivar solo el workflow de Caterpillar → 2) migraciones **013 → rol → 016** → 3) **Hub** → 4) credencial, importación del candidato, primera emisión real controlada y habilitación ([prod-cutover-016](prod-cutover-016.md) §5.1 y §13.5). El Hub viejo ignora las migraciones; el Hub nuevo con la base sin migrar solo falla en "Cancelar" y "Regenerar" (lecturas tolerantes), por eso el orden evita incluso esa ventana.

### 5.1 Preparar la rama de release (antes de la ventana; no toca PROD)
```powershell
git checkout -b release/hub-caterpillar-b2 6370753          # el commit que corre en PROD hoy
git merge --no-ff feat/caterpillar-remission-controls         # o el commit del PR aprobado
git diff --stat 6370753 HEAD -- apps docker compose.pilot.yaml deploy package.json package-lock.json   # solo Caterpillar y la devDependency
# npm run validate (sin integracion) en verde sobre este commit; ensayo aislado (seccion 7) con sus imagenes
```
Para el despliegue la rama debe existir en el host (`git fetch` / `git checkout release/hub-caterpillar-b2` en `daubert-hub-deploy-main`); publicar la rama es una decisión aparte.

### 5.2 Actualización de `api` y `web` (PowerShell, `daubert-hub-deploy-main`)
> Es la secuencia del checklist para este release. Nunca `down`, `--remove-orphans`, `rm`, `rmi` ni `prune`.

```powershell
cd C:\Users\06\Documents\Daubert\daubert-hub-deploy-main
$cf = @('--project-name','daubert-hub','--env-file','deploy/pilot.prod.env','-f','compose.pilot.yaml','-f','compose.prod-temp.yaml')

# 1. Cambiar el checkout a la rama de release y confirmar el candidato
git fetch origin
git checkout release/hub-caterpillar-b2
git status --short                       # debe estar limpio
git log --oneline -1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy\Test-DaubertDeployPreflight.ps1
# Esperado: SOLO fallan "rama actual = main" y "candidato == origin/main"; migraciones/n8n en delta = WARN.
# Deploy-DaubertHub.ps1 -Deploy no aplica (bloquea releases con migraciones y exige main): usar los comandos manuales.

# 2. Ancla de rollback por nombre (aborta si ya existe o si la imagen en ejecucion no es :latest)
$prev = [string](Invoke-RestMethod http://localhost:8082/api/health).commit        # hoy 6370753
if ($prev -notmatch '^[0-9a-f]{7,40}$') { throw "Commit desplegado invalido: '$prev'" }
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
docker save "daubert-hub-api:rollback-$prev" "daubert-hub-web:rollback-$prev" -o "<carpeta-local-fuera-del-repo>\hub-rollback-$prev.tar"

# 3. Despliegue (solo api y web)
$env:APP_VERSION = (node -p "require('./package.json').version")
$env:GIT_COMMIT  = (git rev-parse --short HEAD)
docker compose @cf up -d --build api web

# 4. Verificacion
docker compose @cf ps
Invoke-RestMethod http://localhost:8082/api/health        # status ok, database connected, environment PRODUCTION, commit = el de la rama de release
docker exec daubert-hub-api-1 sh -c "grep -rl ADMISSION_REJECTED /app/apps/api/dist | wc -l; grep -rl fn_autorizar_regeneracion_caterpillar /app/apps/api/dist | wc -l"
docker exec daubert-hub-web-1 sh -c "grep -rl Regenerar /usr/share/nginx/html | wc -l"             # los tres > 0
docker compose @cf logs --tail 100 api
```
Humo posterior (sin tocar datos reales): ADMIN y GENERAL; Home, Automatizaciones, **Notificaciones de pago** (listado, detalle y la pantalla de asignación puntual sin confirmar cambios), Remisiones Caterpillar (listado y detalle); *Regenerar* y *Cancelar remisión* solo para ADMIN. **No** reprocesar, cancelar, regenerar ni asignar archivos reales.

## 6. Rollback

### 6.1 Hub (api y web)
```powershell
$prev = '6370753'                                             # el commit anterior, el usado al crear el ancla
$new  = $env:GIT_COMMIT                                       # commit con falla (misma sesion del deploy)
foreach ($v in $prev, $new) { if ($v -notmatch '^[0-9a-f]{7,40}$') { throw "Commit invalido: '$v'" } }
foreach ($svc in 'api','web') {
    docker image inspect "daubert-hub-${svc}:rollback-$prev" 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Falta el ancla de ${svc}" }
    docker image inspect "daubert-hub-${svc}:failed-$new" 2>$null | Out-Null;    if ($LASTEXITCODE -eq 0) { throw "failed-$new ya existe: no se sobrescribe" }
}
foreach ($svc in 'api','web') {
    docker tag "daubert-hub-${svc}:latest" "daubert-hub-${svc}:failed-$new"
    docker tag "daubert-hub-${svc}:rollback-$prev" "daubert-hub-${svc}:latest"
}
docker compose @cf up -d --no-build api web
Invoke-RestMethod http://localhost:8082/api/health        # commit = 6370753
git checkout main                                             # el checkout vuelve a la rama habitual; las imagenes ya estan por etiqueta
```
El rollback del Hub **no revierte datos**. Compatibilidad con la base ya migrada: el Hub `6370753` lee exactamente los mismos datos (mismos resúmenes, sin errores) con la base después de 013 y 016/017 (ensayo de la sección 7).

### 6.2 Detener la automatización antes de un rollback que deje al Hub sin los contratos nuevos
El Hub anterior desconoce `ADMISSION_REJECTED`, la cancelación formal y la regeneración. Si el workflow nuevo seguiera activo con el Hub anterior, un rechazo del gate llega al Hub viejo como respuesta desconocida: **falla cerrado** (502, sin emitir), pero el operador no ve el motivo. Por eso, si el rollback del Hub es por un defecto de datos o comportamiento y no solo visual:
1. **Parar la entrada**: en n8n desactivar `Remisiones CAT Produccion PG` (Schedule y webhook; no Audi, Pagos ni el servicio de n8n). Anotar hora.
2. **Drenar**: *Executions* sin ninguna "Running" de ese workflow y `PROCESANDO = 0` en `ops.ejecuciones_automatizacion` (Caterpillar). Si alguna dura > 5 min, no seguir: conciliar con `fn_fallo_caterpillar`/finalización protegida, nunca con SQL directo.
3. **Rollback del Hub** (6.1) y verificación de `/api/health`.
4. **No tocar la base**: ni `016 down`, ni `013 down`, ni respaldo, ni contadores. Si hubo emisiones, esos `down` se niegan por diseño.
5. **Decidir el estado de Caterpillar** (con el responsable):
   - *Reanudar con el workflow nuevo y el Hub anterior*: el escaneo y la emisión no dependen del Hub; se pierden temporalmente cancelación formal, regeneración y el motivo legible de un rechazo de reproceso. Aceptable para un rollback visual o de rendimiento.
   - *Mantener detenido* hasta volver al Hub nuevo corregido (la opción segura si el defecto afecta datos).
   - *Reactivar el workflow anterior*: último recurso. Es técnicamente seguro respecto a duplicados (la función antigua reconoce las ejecuciones `COMPLETADA`) pero **sin** la compuerta de folios ni snapshots; requiere aprobación explícita.
6. Los archivos que lleguen mientras está detenido esperan en sus carpetas y se procesan en orden (el detector ordena por fecha) al reanudar; los históricos ya emitidos se omiten (`SKIPPED_HISTORICAL`).

### 6.3 Qué revertir según el momento
| Momento | Hub | Migraciones | n8n |
| --- | --- | --- | --- |
| Falla antes de emitir remisiones nuevas | Rollback 6.1 si ya se desplegó | `016 down` y luego `013 down`; con el Hub anterior no hay dependencia (si el Hub nuevo siguiera arriba, perdería las tablas que consulta: revertir el Hub primero) | Reactivar el workflow anterior exportado |
| Falla después de emitir remisiones nuevas | Solo si el fallo es del Hub; seguro (6.1, precedido de 6.2) | **No revertir**: `016 down` se niega con snapshots/ejecuciones y `013 down` con cancelaciones | Corrección hacia adelante: reproceso o regeneración autorizada desde el Hub nuevo |
| Nunca | — | Restaurar el respaldo `pg_dump` sobre `daubert_global` (perdería registros y rompería la secuencia documental) | — |

## 7. Evidencia y ensayos (todos aislados)
- **Simulación del merge con `origin/main`** (clon aislado): sin conflictos; lint, typecheck, build API+Web, generador PROD, dev-guard; API 2425/2425 y Web 1226/1226.
- **Release B (`6370753` + rama)**: ver el resultado de validación y de los ensayos al final de este documento.
- **Ensayo del rollback de contenedores** (`scripts/rehearse-hub-rollback-isolated.ps1 -OldDir <deploy-main> -NewDir <checkout> [-Project daubert-hub-rbtestX -Port … -DbPort …]`): proyecto Compose propio, puerto propio y PostgreSQL desechable; solo toma de producción la imagen (añade una etiqueta); nunca usa `down`, `rm`, `rmi` ni `prune`.
- **Compatibilidad de contratos Hub ↔ base** (`scripts/rehearse-hub-contracts-isolated.cjs --backup <dump> --old <imagen> --new <imagen>`): la copia restaurada del respaldo de PROD en un contenedor desechable; el repositorio **real compilado** de cada imagen corre contra ella como `daubert_hub_app`, antes y después de 013 → rol → 016/017.

## 8. Criterios para autorizar el corte
1. PR aprobado; rama de release creada desde `6370753` + el commit aprobado; `npm run validate` (sin integración) en verde sobre ese commit.
2. Decisión de la sección 3 aprobada por Caterpillar y Pagos (B por defecto) y la excepción al preflight registrada.
3. Preflight: sin `FAIL` salvo los dos esperados; respaldo `FREQUENT` < 6 h con SHA-256 correcto; respaldo propio nuevo justo antes.
4. Ensayos de la sección 7 repetidos con las imágenes del commit final; anclas `rollback-<prev>` y `docker save` fuera de Docker.
5. Inventario sin ejecuciones en curso, 0 `PROCESANDO`, sin sesiones `idle in transaction`, `Frequent`/`Daily` fuera de la ventana de `ALTER TABLE`.
6. Comprobación en la interfaz de n8n: sin ejecuciones de `Remisiones CAT Produccion PG` en curso y sin colisión del path `cat-reprocess` al importar. (Los workflows `Generación PDFs` y `Generación Hojas Identificación` son de Audi y quedan fuera.)
7. Responsable presente; ventana fuera de horas de uso de Pagos/Audi.

## 9. Resultados de los ensayos (2026-10-26)
| Ensayo | Resultado |
| --- | --- |
| Merge de la rama con `origin/main` (clon aislado, `9ecd1c4`) | sin conflictos; lint, typecheck, build API+Web, generador PROD y dev-guard en verde; API 2425/2425, Web 1226/1226 |
| **Release B** (`6370753` + rama, `dc649c3`) | sin conflictos; lint, typecheck, build API+Web y generador PROD en verde; API **2420/2420** (las 5 pruebas menos son las de Pagos #17, que no entran); Web 1225/1226 con un solo fallo por tiempo de espera de 5 s en `DropboxPathSuggestion.test.tsx` (módulo Proveedores, ajeno al PR) bajo carga de la máquina, que pasa 17/17 al ejecutarlo solo |
| Rollback de `api`/`web` con la imagen de **B** (`rehearse-hub-rollback-isolated.ps1`) | `HUB_ROLLBACK_REHEARSAL_PASS`, 13 comprobaciones: anclas, release nuevo `healthy` con todas las funciones, dato escrito conservado, `/api/health` vuelve a `6370753`, imagen fallida preservada como `failed-dc649c3`; PROD no se tocó |
| Contratos Hub ↔ base (`rehearse-hub-contracts-isolated.cjs`), imagen de **B** y de la combinación con `main` | `HUB_CONTRACTS_REHEARSAL_PASS`, 27 comprobaciones cada una (copia restaurada del respaldo de PROD en un contenedor desechable): el Hub anterior (producción) lee **exactamente los mismos datos** (mismos resúmenes, sin errores) antes y después de 013 y 016/017 (compatibilidad del rollback); el Hub nuevo, sin las migraciones, lee bien y degrada (`cancelaciones = []`, `regeneración no disponible`) y solo falla en cancelar/regenerar; con las migraciones, todas las lecturas funcionan y las funciones protegidas responden con sus errores de dominio; `daubert_hub_app` ejecuta exactamente las dos funciones nuevas y no tiene escritura directa sobre las tablas nuevas |

Los contenedores de PROD (`daubert-hub-api-1`, `daubert-hub-web-1`) y el puerto 8082 no se tocaron; los contenedores y etiquetas `daubert-hub-rbtest*` del ensayo están detenidos y se conservan (limpieza manual, con nombres exactos, si se desea).
