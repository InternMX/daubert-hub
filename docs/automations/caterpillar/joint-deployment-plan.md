# Plan de despliegue conjunto — Daubert Hub (Pagos #17 + Caterpillar) — documento único y definitivo

Estado al **2026-10-26**. Sin secretos. Este documento **sustituye** a `hub-deployment-b2.md` (opción B, superada) y concentra integración, cierre de entradas, procedimiento de la ventana y Fase F. **No autoriza ejecutar nada en PROD**: cada acción productiva de §6 requiere la autorización de la ventana.

## 1. Qué se despliega
| | |
| --- | --- |
| PROD hoy | Hub `6370753` (v1.0.6); Pagos 015/016/017 aplicadas; Caterpillar con el workflow vivo de 58 nodos |
| Release | `origin/main` (con Pagos PR #17) + rama `feat/caterpillar-remission-controls` (PR hacia `main`); el SHA de despliegue es el de `main` tras fusionar |
| SQL que falta en PROD | Pagos `20261023_019_payment_file_recovery_prod`; Caterpillar `20261020_013_caterpillar_cancellation`, rol `n8n_cat_prod` (plantilla) y `20261024_016_caterpillar_atomic_admission_prod`. Las `*_test` (014/015/017 Cat, 018 Pagos) **no se aplican**. Usar siempre el identificador completo |
| n8n | Pagos: hijo de recuperación (106 nodos, SHA `a63f2f4c…a9a`) + padre (111 nodos, `e4726245…1d5f9`, conserva id y webhook); Caterpillar: candidato PROD (62 nodos, `baee73d0…aaa8c`, `webhookId` propio `5d1c7a4e-…-d204`, deshabilitado) |
| Hub | un solo `Deploy-DaubertHub.ps1 -Deploy` (API y Web una vez) |

## 2. Cierre de entradas (política APROBADA, única)
- **Qué es**: `deploy/closure/entry-closure-policy.conf` (Nginx) + `deploy/closure/entry-closure-override.yaml` (Compose). Aprobada tras 1 373 comprobaciones HTTP con Nginx real 1.31.6 en dos imágenes Web (incluida la productiva), persistencia en recreación y rollback. **No se repite.**
- **Alcance**: responde **503** (cabecera `X-Hub-Window: closed-v1`) a todo método distinto de GET/HEAD/OPTIONS sobre: `/api/automations/(payment-notifications|remissions/caterpillar)…`, `/api/automations/(REMISIONES_CATERPILLAR|PAYMENT_NOTIFICATIONS)/(document-series|review-acknowledgements)…`, `/api/companies/:id/(payment-notification-settings|aliases)…`, `/api/aliases/:id/payment-notifications…`, insensible a mayúsculas y sobre el URI normalizado. Audi, autenticación, salud y lecturas siguen operando.
- **Persistencia**: el override monta, **solo lectura**, el directorio externo `C:\Users\06\AppData\Local\DaubertHub\maintenance-window\nginx-conf.d` sobre `/etc/nginx/conf.d` de Web, con `create_host_path: false` (si falta, Compose falla; nunca cae a la configuración de la imagen). El directorio contiene **solo** `default.conf`. **Obligatorio en TODA recreación de Web, también en el rollback**: `Deploy-DaubertHub.ps1` lo incluye siempre (tercer `-f`), y los comandos de rollback manuales lo llevan igual.
- **Operación**: `scripts/deploy/Set-EntryClosure.ps1` (`Prepare` | `Close` | `Open` | `Reload` | `Status`). Cerrar/abrir = reescribir `default.conf` en el mismo archivo + `nginx -t` + `nginx -s reload`, y **demostrarlo con sondas seguras** (GET con `X-Hub-Window-Probe: <MÉTODO>`, que la política evalúa como ese método sin cambiar la petición real, más 5 escrituras reales sin sesión solo a rutas objetivo). `Prepare` solo escribe el directorio externo (copia byte a byte del archivo original de la imagen, SHA `4d9dfea5…`, y copias de respaldo en el directorio padre).
- **Recarga al sustituir la API**: Nginx resuelve `api:3000` al arrancar; tras recrear **solo** la API ejecutar `Set-EntryClosure.ps1 -Action Reload` (verifica que el cierre sigue activo).
- **Puente del primer recreado**: el Web actual no monta el directorio; `Close` lo cierra con `docker cp` (se pierde al recrear) y el `up` del deploy ya trae el montaje con el archivo cerrado. Durante ese recreado el cierre no se interrumpe (ensayo: solo 503 o conexión rechazada).
- **No hay otro mecanismo**: el fragmento/override/`Set-PaymentsGate.ps1` anteriores fueron **eliminados** del repositorio. Una sola política, un solo override.
- **Límites (explícitos)**: controla clientes normales del Hub; **no** bloquea administradores del host/Docker ni la ejecución directa en n8n (editor, `Execute workflow`, CLI, reintentos `POST /rest/executions/:id/retry`, webhooks de prueba). Por eso se exige el control de n8n de §5.
- **Decisión operativa pendiente de aprobación**: la política pausa también la **edición de aliases compartidos** por empresa (`/api/companies/:id/aliases`) durante la ventana; debe aprobarla el responsable.

## 3. Correcciones y cambios de esta etapa
1. `webhookId` del candidato Caterpillar en la rama oficial (n8n 2.27.4 no publica `/webhook/<ruta>` sin él); regeneración verificada; prueba que lo exige.
2. `Deploy-DaubertHub.ps1`: override del cierre siempre presente en los comandos Compose; bloquea si falta `default.conf` externo; `-RequireClosedWindow` exige que el archivo montado sea la política cerrada; ancla existente reutilizable solo con digest idéntico; `-AcknowledgeMigrationsAlreadyApplied` con `-ExpectedMigrations`, evidencia y marcadores; `-ExpectedN8nPaths`; `GIT_COMMIT` = `git rev-parse --short=7 HEAD` en todo. Pester 55/55. `Test-DaubertDeployPreflight.ps1` valida Compose con el override.
3. `scripts/deploy/Invoke-JointMigrations.ps1`: 019 → 013 → rol → 016 con prechecks/postchecks y archivo de evidencia.
4. Ensayos reproducibles en `scripts/rehearsal/joint/`.

## 4. Evidencia vigente (no se repite)
| Verificación | Resultado |
| --- | --- |
| Migraciones conjuntas sobre restauración aislada del respaldo del 2026-10-23 (orden A y B, downs, privilegios, contadores) | **PASS 66/66** |
| `Invoke-JointMigrations.ps1 -Apply` sobre la restauración pre-ventana (BD desechable) | **PASS** (`POSTCHECK_013_PASS`, `POSTCHECK_016_PASS`, `JOINT_SQL_COMPLETE`; se niega con otra base) |
| Hub anterior y nuevo contra la BD migrada | **PASS 7/7** |
| n8n 2.27.4: estática 21/21; activación REST de los tres workflows a la vez; colisión de webhook = 409 | **PASS** |
| Política de cierre (Nginx real, 1 373 comprobaciones) | **PASS** (trabajo aprobado, no repetido) |
| Integración del cierre en esta etapa (`Rehearse-EntryClosure.ps1`, 22 comprobaciones: Prepare byte a byte, Close con puente, anclas, actualización única api+web con override de solo lectura, Reload tras reemplazar la API, rollback con override, 13 variantes de elusión, `api` sin puerto publicado) | **PASS 22/22**; durante la actualización solo 503 o conexión rechazada, igual en el rollback |
| Pester `scripts/deploy` | **PASS 55/55** |
| Candidato PROD Caterpillar | **PASS 71/71** |
| Respaldos de rollback de Web y API (`docker save` + `docker load`, hashes y estructura OCI verificados) | **PASS**: ya no es un pendiente |

Respaldos durables de recuperación (Dropbox `…\BACKUPS\DAUBERT HUB\RECOVERY_PREPARATION\phase0-6370753-20261026_140906\`): `hub-web-rollback-6370753.tar` SHA-256 `18f82da8723501b3a278cf1594dd90b585a0eb8288238f7d601d795bd8280753`; `hub-api-rollback-6370753.tar` SHA-256 `ddc6b77523751856e96653e47d86aedf1b802ff2140f4c8948c626d1daa58859`. Las etiquetas `daubert-hub-{api,web}:rollback-6370753` existen. **No se regeneran.**
Compatibilidad SQL/Hub: los cambios de esta etapa no tocan SQL ni código de la aplicación (solo `scripts/deploy`, `deploy/closure`, docs y ensayos); los contratos SQL ya validados siguen vigentes.

## 5. Control de n8n (obligatorio durante la ventana)
- **El cierre HTTP no bloquea** ejecuciones manuales desde el editor, CLI, reintentos de ejecución, `POST /rest/workflows/:id/run` ni webhooks de prueba.
- **Operador exclusivo**: una sola persona designada controla n8n durante toda la ventana; nadie más ejecuta, reintenta ni publica los workflows de Pagos y Caterpillar. Si no se puede garantizar, el cierre completo es NO-GO.
- Los **dos padres permanecen despublicados** (Pagos `pagosProdAsignaciones01` y Caterpillar `9Ngnrpi16b6GtOAX`) desde W1 hasta que todos los componentes estén listos. **Publicar un Schedule equivale a reabrir el procesamiento automático**, aunque Nginx siga cerrado.
- Comprobar la despublicación con el `activeVersionId` y los webhooks POST registrados (un GET 404 sobre un webhook solo-POST no prueba que esté cerrado).
- Audi (`iHN2zXtam9u1Qsn3`, cada 15 min) **sigue operando**. No tocar las **cinco ejecuciones *waiting* de Caterpillar** ni los correos **44, 38 y 45** de Pagos.
- Credenciales requeridas: `Daubert Hub - n8n PROD` (Header Auth, ya compartida) y la nueva `Postgres produccion CAT (n8n_cat_prod)` asignada a los 7 nodos PostgreSQL de Caterpillar **antes** de publicar (n8n rechaza publicar con credenciales sin asignar).
- Importación: siempre con n8n en marcha, por la interfaz o la API (no la CLI con el servicio activo). Hijo de Pagos → padre de Pagos (conserva id) → candidato de Caterpillar (con `webhookId`), los tres **sin publicar** hasta W7.

## 6. Procedimiento definitivo de la ventana
Sesión PowerShell 5.1 en el repositorio de despliegue (`$R = C:\Users\06\Documents\Daubert\daubert-hub-deploy-main`); `$EV` = archivo de evidencia fuera del repositorio. Cada paso es un *checkpoint*: si falla, se aplica §8 y no se sigue.

**Antes de la ventana (sin interrumpir PROD)**
- P1. PR de Caterpillar aprobado y fusionado; `origin/main` con el árbol del release ensayado.
- P2. **Respaldo fresco y ensayo SQL previos a la ventana** (obligatorio; el último ensayo usó un respaldo del 2026-10-23): `node scripts/backup-caterpillar-prod-db.cjs` (credencial de migración) → `node scripts/rehearse-joint-migrations-isolated.cjs --backup <nuevo.dump>` (66 comprobaciones; contenedores desechables).
- P3. `CAT_WORKER_PASSWORD` (fuera del repositorio), exports de los tres workflows vigentes, operador exclusivo de n8n designado, decisión sobre aliases compartidos.
- P4. `Set-EntryClosure.ps1 -Action Prepare` (solo escribe el directorio externo).

**Ventana**
- W0. `git -C $R checkout main; git -C $R merge --ff-only origin/main`; `.\scripts\deploy\Test-DaubertDeployPreflight.ps1` (o `Deploy-DaubertHub.ps1 -Preflight`): `WARN` esperados solo en migraciones y n8n.
- W1. **Cerrar y drenar**: `Set-EntryClosure.ps1 -Action Close` → `CLOSURE ACTIVE (verified)`. Pruebas por LAN (`http://192.168.1.100:8082`) y Tailscale/HTTPS (`dauberthub.tail85b7b3.ts.net`, vía Caddy → 8082) con la sonda GET + `X-Hub-Window-Probe: POST` sobre rutas objetivo (esperado 503 + `X-Hub-Window: closed-v1`) y una lectura de Audi (no 503). Operador exclusivo: despublicar ambos padres; esperar 0 ejecuciones en curso; 0 `PROCESANDO` de Caterpillar.
- W2. **Respaldos de la ventana** (tras el drenado): `Start-DaubertPostgresBackup.ps1` y `Start-DaubertN8nBackup.ps1` (verificar `.sha256`); exports de los workflows vigentes. Las anclas y archivos `.tar` de API y Web ya existen y están verificados (§4); comprobar `docker image inspect daubert-hub-{api,web}:rollback-6370753`.
- W3. **SQL** (sesión con `PGHOST/PGPORT/PGUSER/PGPASSWORD`, `PGDATABASE=daubert_global`, `CAT_WORKER_PASSWORD`): `.\scripts\deploy\Invoke-JointMigrations.ps1 -Apply -EvidenceFile $EV` (019 → 013 → rol → 016, cada una precheck/UP/postcheck; se detiene en el primer fallo). Si el rol ya existe, `-SkipRole`.
- W4. **n8n inactivo**: crear la credencial `n8n_cat_prod`; importar hijo de Pagos, padre de Pagos y candidato de Caterpillar, **sin publicar** (§5). Verificar hashes.
- W5. **Hub, una sola vez**: `.\scripts\deploy\Deploy-DaubertHub.ps1 -WhatIf` con los mismos argumentos, y luego `-Deploy` con `-RequireClosedWindow -AcknowledgeN8nAlreadyApplied -ExpectedN8nPaths 'n8n/workflows/payment-notifications/','n8n/workflows/remisiones-caterpillar/' -AcknowledgeMigrationsAlreadyApplied -ExpectedMigrations '20261020_013_','20261021_014_','20261022_015_caterpillar','20261023_018_','20261023_019_','20261024_016_','20261024_017_' -MigrationsEvidence $EV -EvidenceMarkers 'POSTCHECK_013_PASS','POSTCHECK_016_PASS','POSTCHECK_019_EXECUTED_OK','JOINT_SQL_COMPLETE'` (frase `DEPLOY DAUBERT HUB`). Después: `/api/health` con `commit` de 7 caracteres = `git rev-parse --short=7 HEAD`, versión y `database connected`; `docker inspect` de Web muestra el montaje de solo lectura; `Set-EntryClosure.ps1 -Action Reload` y `-Action Status` = `CLOSED`, `webMountsDir : True`; verificar imágenes (`docker ps --format '{{.Image}}'`, `docker image inspect` de `daubert-hub-api:latest`/`web:latest`).
- W6. **Validar Pagos y reabrir (independiente)**: con SQL, Hub, hijo y padre listos, el operador publica el padre de Pagos; comprobar su webhook real (403 sin token) y el hijo; abrir con `Set-EntryClosure.ps1 -Action Open` **solo si se acepta reabrir también Caterpillar en la interfaz** (la política cierra ambos módulos a la vez: si Caterpillar aún no está validado, mantener el cierre y validar Caterpillar primero con el cierre activo, porque la verificación de Caterpillar no depende de escrituras HTTP). Validación de negocio: primer ZIP real de Pagos.
- W7. **Validar Caterpillar**: publicar el candidato (webhook `/webhook/cat-reprocess` con Header Auth); primera emisión real controlada (los 11 históricos se omiten con `SKIPPED_HISTORICAL`; folios contiguos, PDFs válidos); habilitar después el Schedule (10 min). Con ambos validados: `Open` (si no se hizo), pruebas LAN/Tailscale de reapertura (escrituras ya no 503), y registrar las versiones finales en `docs/deployments/`.

## 7. Autorizaciones y bloqueos
- **Antes del merge**: revisión/aprobación del PR (checks automáticos verdes) y de la decisión operativa sobre aliases compartidos.
- **Antes del despliegue**: P2 (respaldo fresco + ensayo SQL: requiere credencial de migración); `CAT_WORKER_PASSWORD` y credencial `n8n_cat_prod`; operador exclusivo de n8n; ventana conjunta con Pagos; autorización de W1–W7. Validaciones solo posibles en la ventana: primer ZIP real de Pagos, webhook de Pagos tras publicar, primera emisión real de Caterpillar, pruebas remotas LAN/Tailscale.

## 8. Fallas y recuperación por componente (sin restaurar PostgreSQL globalmente, sin perder operaciones legítimas, sin reiniciar folios)
- **Regla**: nunca restaurar globalmente la base. Los datos escritos durante la ventana (correos, ejecuciones, reservas de folio) se conservan; el retroceso es por objeto.
- **Antes de W5** (Hub sin cambios): mantener el cierre; SQL → `016 down` → `013 down` (Caterpillar, solo si no hay emisiones nuevas) y `019 down` solo si no hay propietario de recuperación sin resolver (la 019 conserva tabla y columna por diseño y se niega a reaplicarse sin revisión); n8n: reimportar los exports previos y dejar sin publicar hasta decidir.
- **Falla en W5 o posterior (API/Web)**, siempre **con el override** y el cierre activo, de forma independiente por servicio con los respaldos ya verificados (`rollback-6370753`; `docker load -i …tar` si la etiqueta se perdió): `docker tag daubert-hub-<svc>:latest daubert-hub-<svc>:failed-<sha7>`; `docker tag daubert-hub-<svc>:rollback-6370753 daubert-hub-<svc>:latest`; `docker compose --project-name daubert-hub --env-file deploy/pilot.prod.env -f compose.pilot.yaml -f compose.prod-temp.yaml -f deploy/closure/entry-closure-override.yaml up -d --no-build <api|web>`; luego `Set-EntryClosure.ps1 -Action Reload`. La base migrada es compatible con el Hub anterior (7/7). Antes del rollback del Hub: Caterpillar despublicado y comprobar que el padre de Pagos publicado sea compatible con el Hub restante.
- **Falla en W6/W7**: `Close`, despublicar el workflow afectado, corregir hacia adelante. Caterpillar **tras emitir**: sin retroceso de base ni de folios; solo corrección hacia adelante.
- **Abandonar la ventana** si: `FAIL` inesperado del preflight; respaldo sin verificar; ejecuciones activas/`PROCESANDO` que no drenan; sonda de cierre que no devuelve 503; no se puede garantizar el operador exclusivo de n8n; precheck/postcheck fallido o deriva de la 019; credencial sin asignar; conflicto de webhook (409); 5xx en Audi o rutas ajenas; folios no contiguos o PDFs inválidos; tiempo agotado.

## 9. Veredicto (2026-10-26)
- **PR/merge de Caterpillar**: listo para revisión (no fusionado).
- **Despliegue**: **NO-GO hasta** cumplir §7 (autorizaciones, respaldo fresco + ensayo SQL, credencial, operador de n8n). No hay defecto técnico conocido.

## 10. Fase F — Limpieza y cierre técnico

**Regla**: durante los ensayos solo se *registra*. **Nada se elimina** hasta que Pagos y Caterpillar estén desplegados, validados y haya concluido su supervisión inicial. La limpieza es el **último** paso del proyecto, con su propio checklist y con autorización explícita antes de cada eliminación.

### F.1 Inventario (se actualiza con cada ensayo)
Generado en solo lectura por `scripts/inventory-ensayo-resources.cjs --out <archivo>` (no borra, no detiene, no hace `prune`). Resultado vigente: `C:\Users\06\Documents\Daubert\ensayo-integracion-conjunta\inventario-fase-f.json` (41 contenedores, 14 volúmenes anónimos, 5 redes, 28 etiquetas de imagen, ≈ 86 archivos/carpetas candidatos).

| Tipo | Recurso creado por los ensayos | Cantidad / ejemplo | Clasificación |
| --- | --- | --- | --- |
| Worktrees | `C:\Users\06\Documents\Daubert\ensayo-integracion-conjunta\release` (rama `release/hub-conjunto-pagos-caterpillar`, **conservar hasta fusionar**) y su clon LF `...\release-lf`; y `C:\Users\06\Documents\Daubert\ensayo-integracion-conjunta\combined` (rama `ensayo/integracion-conjunta-pagos-caterpillar`, commits `a0e6c78`, `eee85c9`, `34e4861`) | 1 | Candidato (`git worktree remove`, no borrando carpetas); **antes**, portar `34e4861` y consolidar la documentación |
| Ramas locales | `ensayo/integracion-conjunta-pagos-caterpillar` | 1 | Candidato (sus scripts ya están en `scripts/rehearsal/joint/` de la rama de release) |
| Ramas locales | `release/hub-conjunto-pagos-caterpillar` | 1 | **Conservar** (candidato al PR) |
| Ramas locales | `release/hub-caterpillar-b2` (`3f33103`) | 1 | **Conservar** hasta desplegar/fusionar; después decide el responsable |
| Ramas locales | `feat/caterpillar-remission-controls` | 1 | **Conservar** (rama del PR) |
| Referencias | `refs/sim/relB` (`dc649c3`, copia de la release B ensayada) | 1 | Candidato (`git update-ref -d`) |
| Contenedores | prefijo `daubert-hub-rbtest*`: proyectos `rbtest`, `rbtestb`, `rbtestc`, `rbtestd`, `rbtestf` (api/web/pg), `…-pg2*`, `…-joint-a-*`, `…-joint-b-*` (PostgreSQL desechables), `…-n8n-*` (17 instancias n8n aisladas, una de depuración `…-n8n-dbg`) | 41, **todos detenidos** | Candidatos, por nombre exacto |
| Volúmenes | volúmenes anónimos de los contenedores PostgreSQL anteriores (identificables solo por sus montajes) | 14 | Candidatos, **solo** tras eliminar su contenedor y por ID exacto verificado |
| Redes | `daubert-hub-rbtest_pilot`, `…rbtestb_pilot`, `…rbtestc_pilot`, `…rbtestd_pilot`, `…rbtestf_pilot` | 5 | Candidatos |
| Imágenes (etiquetas) | `daubert-hub-rbtest{,b,c,d,f}-{api,web}:{latest,rollback-6370753,failed-<commit>}` | 28 etiquetas | Candidatas **solo como etiqueta** (`docker rmi <etiqueta>`): `latest` y `rollback-6370753` comparten imagen con las de PROD, que no se tocan |
| Bases aisladas | PostgreSQL desechables dentro de los contenedores anteriores; carpetas `…\ensayo-postgres-prod\20261023_221512`, `_222211`, `_222228` (172 MB, servidor detenido) | 3 carpetas + contenedores | Candidatos |
| Respaldos | `C:\Users\06\Documents\Daubert\respaldos-postgres-prod\daubert_global_pre_caterpillar_016_20261023_220606.dump` (SHA-256 `CA8A82AA…8C6E26`) | 1 | **Conservar** (artefacto de recuperación y base de los ensayos) |
| Artefactos del ensayo | `…\ensayo-integracion-conjunta\{inventario-fase-f.json, joint-migrations-result.json, joint-migrations-state.json (credenciales de una BD desechable), schema-order-A.sql, schema-order-B.sql, n8n-coexistence-*.json, hub-on-joint-db.json, joint-deploy-rehearsal*.log, combined-logs, run-combined.sh}` | ≈ 12 | Candidatos, **después** de consolidar sus resultados en `docs/` |
| Clones de ensayo | `…\ensayo-integracion-conjunta\combined-lf` y `…\scratchpad\{b2-sim, b2-sim-crlf, b2-relB, b2-pf}` (≈ 1,3 GB con `node_modules`; `b2-pf` guarda una copia **redactada** del `.env`) | 5 | Candidatos |
| Ensayo del cierre final | proyectos `daubert-hub-rbtestg` y `daubert-hub-rbtesth` (contenedores `-api-1`, `-web-1`, red `daubert-hub-rbtestg_pilot`, etiquetas `daubert-hub-rbtestg-{api,web}:{latest,rollback-6370753,failed-<commit>}`), `%TEMP%\daubert-hub-rbtestg`, `%TEMP%\claude-ev`; PostgreSQL desechables `daubert-hub-rbtest-joint-{a,b}-*` (incluido el de `--restore-only`) | varios | Candidatos, por nombre exacto |
| Archivos temporales | `%TEMP%\daubert-hub-rbtest{,b,c,d,f}` (env de ensayo con contraseñas desechables, compose con el cierre, sondas), `%TEMP%\daubert-n8n-rehearsal-*` (16 carpetas), logs/scripts del `scratchpad` (≈ 40), `patch_docs*.cjs` | varios | Candidatos |
| TEST (Dropbox\Pruebas) | `00_ARCHIVOS A PROCESAR\…PRUEBA B1 20261026.xlsx` y la copia del histórico `…PG FINAL2.xlsx` (escenario B1) | 2 | Revisar primero: `prepare-caterpillar-b1-test-scenario.ps1 -Remove` quita exactamente esos dos; las filas de TEST (ejecución 239) quedan como evidencia |

**No creados por estos ensayos (no entran en la limpieza)**: `daubert-hub-api-1`, `daubert-hub-web-1` (PROD); `n8n-test-aislado` y el volumen `n8n_test_aislado_home`; `daubert-review17-*`, `pg-ensayo-013`, `daubert-hub-test-*` y las redes `daubert-review17-net`, `ensayo013`, `daubert-hub-test_pilot`, `daubert-hub_default`, `daubert-hub_pilot`; los demás worktrees del repositorio; el esquema de `daubert_hub_test`; **la etiqueta `daubert-hub-api:rollback-6370753`**, creada por la Fase 0 de Pagos (consta en `payment-recovery-deployment-PROPOSAL.ps1`) y que apunta a la imagen de PROD en ejecución.

### F.2 Qué nunca se elimina
- Etiquetas/anclas `daubert-hub-{api,web}:rollback-*` y `failed-*` de PROD, ni las imágenes de los contenedores en ejecución.
- Respaldos durables: el `.dump` anterior, `C:\ProgramData\DaubertHub\Backup`, los `.age` y sus `.sha256`.
- Datos históricos, ejecuciones, reservas, remisiones, correos de Pagos (44, 38, 45), las **cinco ejecuciones *waiting* de Caterpillar** y las evidencias TEST 237/238/239.
- Worktrees activos (`daubert-hub-caterpillar-remission-controls`, `daubert-hub-deploy-main`, los de Pagos y el principal).
- Workflows, credenciales y archivos de n8n/Dropbox de PROD.

### F.3 Procedimiento de limpieza controlada (futuro, tras la supervisión inicial)
1. **Condición de entrada**: Pagos y Caterpillar desplegados y validados; supervisión inicial concluida y registrada.
2. **Regenerar el inventario** (`inventory-ensayo-resources.cjs`) y compararlo con F.1: aparecer algo nuevo exige clasificarlo antes de seguir.
3. **Congelar lo que se conserva**: confirmar que existen las anclas `rollback-<prev>` de api y web (más su `docker save`), el respaldo `.dump` y la documentación consolidada (paso 6).
4. **Comprobar que cada candidato es solo del ensayo y no tiene trabajo pendiente**: contenedor sin dependientes ni montajes de PROD; volumen solo montado por su contenedor; etiqueta no usada por ningún contenedor de PROD (`docker ps -a --format '{{.Image}}'`); worktree sin cambios sin commit (`git -C <ruta> status --short`) ni commits que no estén en otra rama; carpeta sin archivos modificados después del ensayo.
5. **Presentar la lista exacta** (ruta o nombre completo, tamaño, motivo) y **pedir autorización**. Sin wildcards, sin sustitución de comandos, sin rutas calculadas; cada elemento por nombre exacto.
6. **Consolidar documentación** antes de eliminar evidencias: pasar los resultados (`joint-migrations-result.json`, informes de ensayo) a `docs/`, registrar las **versiones finales desplegadas** (commit/SHA de Hub, imágenes, migraciones aplicadas, workflows y versiones de n8n, `APP_VERSION`) en `docs/deployments/` y enlazar desde su `README.md`.
7. **Ejecutar, en este orden, por nombre exacto y con la autorización vigente**: (a) detener y eliminar contenedores `daubert-hub-rbtest*`; (b) eliminar sus volúmenes por ID verificado; (c) eliminar las redes `daubert-hub-rbtest*_pilot`; (d) quitar las **etiquetas** `daubert-hub-rbtest*` (`docker rmi <etiqueta>`; nunca por ID de imagen compartida); (e) retirar el worktree (`git worktree remove`) y borrar la rama y la referencia del ensayo; (f) eliminar carpetas y archivos temporales listados, la más interna primero y las carpetas padre al final y solo si quedan vacías.
8. **Verificar** con el checklist F.4 y registrar el cierre.

### F.4 Checklist de verificación de la limpieza
| # | Comprobación (solo lectura) | Esperado |
| --- | --- | --- |
| 1 | `docker ps -a --format '{{.Names}}' \| findstr daubert-hub-rbtest` | sin resultados |
| 2 | `docker volume ls` frente al inventario | ningún volumen listado en F.1; los de otros proyectos intactos |
| 3 | `docker network ls \| findstr rbtest` | sin resultados |
| 4 | `docker image ls \| findstr rbtest` | sin resultados; `docker image inspect daubert-hub-api:rollback-<prev>` y `…-web:rollback-<prev>` existen |
| 5 | `docker ps --format '{{.Names}} {{.Status}}'` | `daubert-hub-api-1` *healthy*, `daubert-hub-web-1` *Up*, `n8n-test-aislado` sin cambios; `/api/health` con el commit desplegado |
| 6 | `git worktree list`; `git branch --list "ensayo/*"`; `git for-each-ref refs/sim` | sin entradas del ensayo; `release/…` y `feat/…` según decisión del responsable |
| 7 | `Test-Path` de cada carpeta/archivo de F.1 | no existen; los de "Conservar" sí existen y mantienen su SHA-256 |
| 8 | Respaldos: `Get-FileHash` del `.dump` y de los `.age` más recientes frente a sus `.sha256` | coinciden |
| 9 | n8n (interfaz): las cinco ejecuciones *waiting* de Caterpillar siguen en espera; correos de Pagos 44, 38 y 45 sin cambios | sin cambios |
| 10 | Documentación: nota de despliegue final en `docs/deployments/` y enlace en su `README.md`; este plan marcado "cerrado" | presentes |
| 11 | Inventario regenerado | vacío de recursos del ensayo; solo lo conservado |

