# B2 — Integración y despliegue coordinado de Daubert Hub con Caterpillar (preparado; NO ejecutado)

Estado al **2026-10-26**: preparado y ensayado en un entorno aislado. **Nada de esto se ha ejecutado en PROD**: ni merge, ni push, ni migraciones, ni recreación de contenedores.
Complementa [prod-cutover-016](prod-cutover-016.md) (migraciones, rol, n8n) y [deployment-checklist](../../operations/deployment-checklist.md) (procedimiento general del Hub). Sin secretos.

## 1. Qué entra al PR (`feat/caterpillar-remission-controls` → `main`)

- **28 commits** (más el de esta documentación), todos de Caterpillar; **139 archivos** (+29 425 / −1 373) contra `origin/main` (`c856763`). **Ningún archivo de Pagos, Audi ni de otro módulo**, y **ningún cambio** en `docker/`, `compose*`, `deploy/` ni variables de entorno.
- **Hub API** (10 archivos de `src`): cancelación formal de remisiones, autorización de regeneración comercial, contrato `ADMISSION_REJECTED` del reproceso, lectura de detalle con historial de cancelaciones/regeneración. Las lecturas **toleran** una base sin 013/016 (`to_regclass`); solo las acciones de escritura (cancelar, regenerar) requieren las migraciones.
- **Hub Web** (12 archivos): botón y diálogo *Regenerar*, diálogo de cancelación, mensajes del reproceso.
- **Base de datos** (`database/migrations/daubert_global`, 22 archivos): en PROD solo se aplican **013**, la plantilla de rol y **016** (que ya incluye 017). Los archivos `014`, `015` y `017` de nombre `*_test` son de TEST, tienen guarda de base y **no se aplican en PROD**.
- **n8n** (32 archivos): candidatos TEST y el candidato PROD inactivo. El Hub no los usa; solo se importan a mano en la ventana.
- **Pruebas, scripts y documentación**: pruebas (35 archivos), inspección/respaldo/ensayo de solo lectura o aislados (`scripts/*caterpillar*`), runbooks.
- **Dependencias**: solo `@electric-sql/pglite` como `devDependency` de la API (pruebas); no entra a la imagen (`npm ci --omit=dev`).

### Acoplamiento con Pagos (BLOQUEANTE de decisión)
`origin/main` ya contiene el PR #17 de Pagos (recuperación individual de archivos, **preparado y no desplegado**): su código del Hub llama a `core.fn_destino_asignacion_pago_disponible`, creada por la migración **PROD 019** de Pagos, que **aún no está aplicada**. Un Hub construido desde `main` después de integrar este PR incluye ese código. Sin la 019, solo la asignación puntual de archivos de Pagos (habilitada en PROD) devolvería error en ese paso (función inexistente); el resto del Hub no se ve afectado. Opciones, a decidir con quien lleva Pagos:
1. **Recomendada:** que la promoción 019 de Pagos (su propio plan y ensayo) esté aplicada **antes** del despliegue del Hub, o que el Hub de Caterpillar se despliegue **junto con** esa promoción en la misma ventana, sin mezclar sus pasos.
2. Construir el Hub desde un commit que contenga Caterpillar pero **no** el #17 (rama de release a partir de `6370753`). Es una desviación del preflight (exige candidato == `origin/main`) y requiere aprobación explícita.

## 2. Compatibilidad del Hub nuevo con 013 y 016/017

| Objeto que usa el Hub | Origen en PROD | Permiso de `daubert_hub_app` |
| --- | --- | --- |
| `ops.ejecuciones_automatizacion`, `ops.automatizaciones`, `core.documentos`, `operacion.remisiones/series_documentales/reservas_folios/remision_detalle` | ya existen en el respaldo de PROD | los que ya tiene |
| `operacion.cancelaciones_remisiones`, `operacion.fn_cancelar_remision_caterpillar` | crea **013** | `SELECT` sobre la tabla y `EXECUTE` de la función (013) |
| `operacion.autorizaciones_regeneracion_caterpillar`, `operacion.fn_autorizar_regeneracion_caterpillar` | crea **016** (con 017) | `SELECT` sobre la tabla y `EXECUTE` de la función (016) |
| `core.documentos.caterpillar_admission` | crea **016** | lectura vía las tablas ya concedidas |
| `ops.fn_*_caterpillar_test`, snapshot del Hub | solo TEST (guarda `current_database()='daubert_hub_test'`) | inertes en PROD: devuelven `UNAVAILABLE` |

Comprobado: el ensayo 013 → 016/017 sobre la copia restaurada del respaldo (52 comprobaciones) deja a `daubert_hub_app` exactamente con esos permisos; las consultas del Hub para detalle y regeneración usan `to_regclass(...)` y devuelven "no disponible" sin las tablas (no hay error 500).

## 3. Orden del despliegue coordinado (ventana)

0. **Antes:** PR revisado y aprobado; **decisión de Pagos** (sección 1); respaldo nuevo, inventario e inspección (prod-cutover-016 §13.5).
1. Desactivar solo `Remisiones CAT Produccion PG`; esperar 0 ejecuciones y 0 `PROCESANDO`.
2. Migraciones **013 → rol → 016** (prod-cutover-016 §5.1 pasos 0–7). El Hub viejo ignora lo nuevo.
3. **Hub** (sección 4) y verificación.
4. Credencial, importación del candidato, primera emisión real controlada y habilitación (prod-cutover-016 §5.1 pasos 8–15).

Si el Hub se desplegara antes que las migraciones, el sistema sigue funcionando (lecturas tolerantes) y solo fallarían "Cancelar" y "Regenerar"; el orden anterior evita esa ventana.

## 4. Procedimiento exacto del Hub (PowerShell, `C:\Users\06\Documents\Daubert\daubert-hub-deploy-main`)

> Es la secuencia de `deployment-checklist.md` aplicada a este release. **No se ejecuta hasta la ventana autorizada.** Nunca `down`, `--remove-orphans`, `rm`, `rmi` ni `prune`.

```powershell
cd C:\Users\06\Documents\Daubert\daubert-hub-deploy-main
$cf = @('--project-name','daubert-hub','--env-file','deploy/pilot.prod.env','-f','compose.pilot.yaml','-f','compose.prod-temp.yaml')

# 1. Traer el commit aprobado (solo avance rapido) y revisar el delta
git fetch origin
git merge --ff-only origin/main
git log --oneline -1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy\Test-DaubertDeployPreflight.ps1   # esperado: sin FAIL salvo "migraciones nuevas"/n8n = WARN; Deploy-DaubertHub.ps1 -Deploy las BLOQUEA -> usar los comandos manuales

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
# 3. Copia fuera del almacen de Docker (recomendado)
docker save "daubert-hub-api:rollback-$prev" "daubert-hub-web:rollback-$prev" -o "<carpeta-local-fuera-del-repo>\hub-rollback-$prev.tar"

# 4. Despliegue (solo api y web)
$env:APP_VERSION = (node -p "require('./package.json').version")
$env:GIT_COMMIT  = (git rev-parse --short HEAD)
docker compose @cf up -d --build api web

# 5. Verificacion
docker compose @cf ps
Invoke-RestMethod http://localhost:8082/api/health        # status ok, database connected, environment PRODUCTION, commit = el nuevo
docker exec daubert-hub-api-1 sh -c "grep -rl ADMISSION_REJECTED /app/apps/api/dist | wc -l; grep -rl fn_autorizar_regeneracion_caterpillar /app/apps/api/dist | wc -l"
docker exec daubert-hub-web-1 sh -c "grep -rl Regenerar /usr/share/nginx/html | wc -l"             # los tres > 0
docker compose @cf logs --tail 100 api
```

Humo posterior (sin tocar datos reales): iniciar sesión como ADMIN y como usuario GENERAL; Home, Automatizaciones, Notificaciones de pago (Pagos sigue igual), Remisiones Caterpillar (listado y detalle); el botón *Regenerar* y *Cancelar remisión* solo para ADMIN y deshabilitados o con mensaje cuando no aplican. **No** reprocesar, cancelar ni regenerar ejecuciones reales.

## 5. Rollback

### 5.1 Hub (api y web) — verificado en un ensayo aislado
```powershell
$prev = '<commit anterior, el usado al crear el ancla>'      # 6370753
$new  = $env:GIT_COMMIT                                       # commit con falla (misma sesion del deploy)
foreach ($v in $prev, $new) { if ($v -notmatch '^[0-9a-f]{7,40}$') { throw "Commit invalido: '$v'" } }
foreach ($svc in 'api','web') {
    docker image inspect "daubert-hub-${svc}:rollback-$prev" 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Falta el ancla de ${svc}" }
    docker image inspect "daubert-hub-${svc}:failed-$new" 2>$null | Out-Null;    if ($LASTEXITCODE -eq 0) { throw "failed-$new ya existe: no se sobrescribe" }
}
foreach ($svc in 'api','web') {
    docker tag "daubert-hub-${svc}:latest" "daubert-hub-${svc}:failed-$new"      # conserva la imagen nueva para analizarla
    docker tag "daubert-hub-${svc}:rollback-$prev" "daubert-hub-${svc}:latest"   # :latest vuelve a la imagen anterior
}
docker compose @cf up -d --no-build api web
Invoke-RestMethod http://localhost:8082/api/health        # commit = $prev
```
El rollback del Hub **no revierte datos**: lo escrito mientras corría el Hub nuevo se conserva. El Hub anterior desconoce `ADMISSION_REJECTED`, la cancelación formal y la regeneración, pero lista, muestra detalle y reprocesa como antes.

### 5.2 Qué revertir según el momento
| Momento | Hub | Migraciones | n8n |
| --- | --- | --- | --- |
| Falla antes de emitir remisiones nuevas (Hub, migración o importación) | Rollback 5.1 si ya se desplegó | `016 down` y luego `013 down` (el orden importa: el Hub nuevo, si siguiera arriba, perdería las tablas que consulta; con el Hub anterior no hay dependencia) | Reactivar el workflow anterior exportado |
| Falla después de emitir remisiones nuevas | Rollback 5.1 solo si el fallo es del Hub; es seguro | **No** revertir: `016 down` se niega a perder snapshots/ejecuciones, `013 down` se niega con cancelaciones | Corrección hacia adelante: reproceso o regeneración autorizada. Reactivar el workflow anterior es técnicamente posible (la función antigua reconoce las ejecuciones `COMPLETADA` y no duplica), pero **sin** la compuerta de folios: solo como último recurso y con aprobación |
| Nunca | — | Restaurar el respaldo `pg_dump` sobre `daubert_global` (perdería registros y rompería la secuencia documental) | — |

Con el Hub anterior y el workflow nuevo activos, un rechazo del gate llega al Hub viejo como respuesta desconocida: el reproceso falla cerrado (error técnico), sin emitir nada.

## 6. Criterios para autorizar el corte
1. PR aprobado y mezclado; `main` de `daubert-hub-deploy-main` == `origin/main` == el commit revisado; `npm run validate` sin integración (lint, typecheck, pruebas, build) en verde sobre ese commit.
2. **Decisión de Pagos** resuelta (sección 1) y documentada.
3. Preflight sin `FAIL` (los `WARN` de migraciones/n8n explicados), respaldo `FREQUENT` < 6 h con SHA-256 correcto, y un respaldo propio nuevo justo antes de la ventana.
4. Ensayo del rollback del Hub repetido con las imágenes del commit final (script de la sección 7) y anclas `rollback-<prev>` creadas más `docker save` fuera de Docker.
5. Inventario sin ejecuciones en curso; 0 `PROCESANDO`; sin sesiones `idle in transaction`; Frequent/Daily no coinciden con el `ALTER TABLE` de 016.
6. Comprobación manual de interfaz de n8n pendiente: `Generación PDFs` y `Generación Hojas Identificación` no usan carpetas Caterpillar.
7. Responsable presente y ventana fuera de horas de uso de Pagos/Audi.

## 7. Ensayo aislado del Hub (cómo repetirlo)
`scripts/rehearse-hub-rollback-isolated.ps1 -OldDir <deploy-main> -NewDir <checkout del commit final>`: usa su **propio** proyecto Compose (`daubert-hub-rbtest`), puerto 18082 y un PostgreSQL desechable; solo toma de producción la **imagen** (añade una etiqueta). Despliega el release anterior, crea anclas, despliega el nuevo, escribe un dato, hace el rollback con los mismos comandos de la sección 5.1 y comprueba que el dato sigue. Solo detiene sus contenedores; no usa `down`, `rm`, `rmi` ni `prune`.

### Resultado del ensayo (2026-10-26)
`HUB_ROLLBACK_REHEARSAL_PASS`, 13 comprobaciones: la imagen del release anterior es la de PROD (`6370753`, v1.0.6); las anclas `rollback-6370753` apuntan a la imagen en ejecución (misma comprobación de manifiesto del checklist); el release nuevo (candidato `9ecd1c4` = rama + `origin/main`, construido con `up -d --build api web`) queda `healthy` con `ADMISSION_REJECTED`, regeneración, cancelación y la interfaz *Regenerar*; el dato escrito con el release nuevo sigue después del rollback; `/api/health` vuelve a `6370753`; el API anterior ya no contiene la regeneración ni la web *Regenerar*; la imagen fallida queda como `failed-9ecd1c4`; el proyecto aislado solo tiene `api` y `web`. Los contenedores y el puerto 8082 de PROD no se tocaron (siguieron *Up* sin reinicio). Límites: la base del ensayo es un PostgreSQL vacío (prueba el cambio y la vuelta de imágenes, no las consultas; esas se cubren con las pruebas y la tabla de la sección 2) y el `WEBHOOK_URL` apunta a un puerto cerrado (no se contacta ninguna instancia de n8n).
