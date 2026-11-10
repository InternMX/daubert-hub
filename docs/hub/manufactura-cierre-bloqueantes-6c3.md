# Manufactura · cierre de bloqueantes técnicos y preparación de la candidata (Fase 6C.3)

Estado: **preparado y ensayado en clones e instancias desechables. Nada desplegado; `daubert_global`, `daubert_hub_test`, el nginx de producción y su archivo montado, `scripts/backup/` del árbol operativo, las tareas programadas, n8n, Dropbox y los contenedores operativos NO se modificaron. Manufactura sigue apagada en PROD; versión 1.1.1; imágenes definitivas sin construir.**
Evidencia (fuera del repositorio): `C:\Users\06\Documents\Daubert\Evidencia_6C3_20261109\` (`nginx\`, `readiness\`, `ventana-respaldos\`, `reversion\`).

## 1. Nginx
### 1.1 Dónde está y por qué `docker/nginx.conf` no lo actualiza
- PROD monta **solo lectura** `C:\Users\06\AppData\Local\DaubertHub\maintenance-window\nginx-conf.d` sobre `/etc/nginx/conf.d` de `daubert-hub-web-1` (`deploy/closure/entry-closure-override.yaml`, presente en toda invocación de Compose; `create_host_path: false`). Verificado en solo lectura: el contenedor tiene ese montaje (`rw=false`) y `default.conf` tiene SHA-256 `4d9dfea5…0495` (el nginx **original** de v1.1.1). Junto a él: `..\default.conf.open` (copia abierta) y `..\entry-closure-policy.conf` (copia de la política).
- `docker/nginx.conf` se copia **dentro de la imagen** web. El montaje externo **tapa** ese directorio: nginx solo lee el archivo del host. Ese archivo se escribió una vez con `Set-EntryClosure.ps1 -Action Prepare` (extrae el `default.conf` de la imagen de ese momento) y no cambia al desplegar otra imagen. Por eso la ruta de firmas con 3 MB no existe hoy en PROD ni existiría tras desplegar.
- El hash que hay que esperar es el del archivo **dentro de la imagen validada** (`27c5b07c…7746` en la imagen de ensayo), **no** el de `docker/nginx.conf` en git (`a8e3316e…`: la imagen se construye con finales de línea CRLF). `New-ReleaseImages.ps1` ahora lo registra en el manifiesto de imágenes (`nginxConfSha256`).

### 1.2 Procedimiento seguro (futura liberación; no ejecutado en PROD)
Dentro de la ventana, con el script del commit candidato:
1. `Set-EntryClosure.ps1 -Action Status` (esperado OPEN, `activeSha256 = 4d9dfea5…`). Copia de seguridad de la carpeta `maintenance-window` (3 archivos).
2. `-Action Close` → cierre verificado con sondas (ahora incluye rutas de Manufactura).
3. `-Action Prepare -KeepClosure -WebImage daubert-hub-web:release-<commit> -ExpectedOpenSha256 <nginxConfSha256 del manifiesto de imágenes>`. Sin el SHA correcto **se niega**. **`-KeepClosure` es obligatorio dentro de la ventana** (desde la Fase 6D, sin él `Prepare` escribe el archivo abierto en `default.conf`); con él solo renueva `default.conf.open` (corrección de esta fase).
4. `-Action Close -Policy Manufactura -ExpectedPolicySha256 <sha>` otra vez; `-Action Status` debe decir `CLOSED` → despliegue (`Deploy-DaubertHub.ps1 … -RequireClosedWindow -ClosurePolicy Manufactura -ClosurePolicySha256 <sha>`) → `-Action Reload` (obligatorio tras reemplazar la API).
5. Al final de la ventana: `-Action Open` (instala el archivo nuevo, `nginx -t`, reload, sondas) y `Test-ManufacturaReleaseReadiness.ps1 -NginxConf <default.conf externo>`.
Reversión: `-Action Prepare -WebImage daubert-hub-web:rollback-<commit>` (línea base original por omisión) + `-Action Open`. **No es necesaria para revertir la aplicación**: v1.1.1 funciona con el `default.conf` nuevo (ensayado).

### 1.3 Política de ventana cerrada
> **Actualización (Fase 6D):** la política nueva ya **no** sustituye a la operativa. `deploy/closure/entry-closure-policy.conf` volvió a ser la política anterior y la de Manufactura vive en `entry-closure-policy.manufactura.conf`; se instala solo con `-Policy Manufactura -ExpectedPolicySha256 …` y `Prepare` conserva el cierre solo con `-KeepClosure`. Ver `manufactura-preparacion-junta-6d.md`.
La política aprobada bloqueaba escrituras de Pagos y Caterpillar; **no** las de Manufactura (ensayado: con la política anterior un `POST …/documents/drafts` llega al API). Cambio (`deploy/closure/entry-closure-policy.conf`): una línea `~*^/api/manufacturing-sheets(?:/|$) 1;` en el mapa de rutas objetivo. Toda escritura (cualquier método distinto de GET/HEAD/OPTIONS) bajo ese prefijo responde **503 con `X-Hub-Window: closed-v1`**, decidido a nivel de servidor **antes** de cualquier `location` o límite de tamaño; las lecturas (documentos, PDF almacenados) siguen disponibles. `Set-EntryClosure.ps1` añade 6 sondas y 3 escrituras reales de Manufactura a su verificación. La política sigue siendo válida sobre v1.1.1 (ensayado). **Es un cambio a un diseño aprobado: requiere el visto bueno de la junta** (ver §7). `Close` instala la política del árbol de trabajo: desde este commit, un cierre en PROD instalaría la política nueva.

### 1.4 Resultados (proyecto Compose aislado `daubert-hub-rbtest63`, carpeta de cierre de ensayo, script real del clon)
| Ensayo | Resultado |
|---|---|
| Política nueva sobre v1.1.1: Close / sondas / Open | CLOSURE ACTIVE y OFF verificados; 27/27 sondas de cierre PASS |
| Conf original, abierto | firma de 1,5 MB y 2,8 MB → **413 de nginx** (el hallazgo) |
| `Prepare` con imagen nueva sin SHA esperado | se niega |
| `Prepare` con SHA, ventana cerrada | conserva el cierre; solo cambia `default.conf.open` |
| Despliegue de la candidata dentro del cierre + `Reload` | web recreado **sigue cerrado**; verificado |
| Abierto con conf nueva (19 sondas) | firmas de 0,5 / 1,5 / 2,8 MB pasan al API; 3,5 MB → 413; **1,5 MB en cualquier otra ruta → 413** (`/signatures/`, `/signatures/0/authorize`, `/drafts`, `/client-abbreviations`, `/previews/pdf`, `/api/clients`, `/api/auth/login`); flujo real: firma de 1,5 MB **201**, PDF 92 KB |
| Cerrado con candidata (33 sondas, con y sin sesión) | 19 escrituras de Manufactura → 503; carga de firma de 0,5 / 1,5 / 3,5 MB → **503** (ni 413 ni llega al API); lectura, PDF finalizado, login y `/api/health` disponibles; Pagos sigue bloqueado; ninguna fila creada |
| `default.conf` inválido en disco | `Reload` se niega (`nginx -t failed: the previous configuration keeps running`), servicio 200; `Open` lo repara |
| Reversión de línea base y vuelta | 413 con la original, 401 (pasa) con la nueva |

## 2. Readiness (`scripts/deploy/Test-ManufacturaReleaseReadiness.ps1`)
- Revisión: la versión de 6C.2 tenía tres defectos, corregidos: buscaba la 025 de Caterpillar con un patrón que **no existe** (`%folio_recovery%`; el esquema real es `cat_recovery_test`); confiaba en `PGDATABASE` sin preguntar al servidor; y un control que no podía evaluarse se omitía. Ahora: funciones puras + costuras, **lo que no se puede comprobar es FALLO**, un marcador por migración (020 `documentos`, 021 `firmas`, 022 `fn_firmas_inventario`, 023 `cliente_abreviaturas`, 024 `pol_revisiones_sel` con consulta compartida, 026 `pol_respaldo_sel` SELECT para `daubert_backup` en las 9 tablas), 9 tablas exactas, 33 políticas, RLS en todas, `daubert_backup` sin SUPERUSER/BYPASSRLS, sin 025, coherencia respaldo↔026, configuración (`-EnvFile`: solo lee `DB_NAME`, `MANUFACTURING_ENABLED`, `MANUFACTURING_EMISSION_ENV`; replica `resolveManufacturing`), evidencia de migraciones, commit en ejecución, imágenes y nginx externo. Fases `PreDeploy` (la configuración **no** debe habilitar; web sin interfaz) y `PreEnable`. Consulta de solo lectura (prueba automatizada). `-EvidenceFile` (fuera del repo) recibe `MANUFACTURA_READINESS_PASS|FAIL phase=…`.
- **Pruebas automatizadas**: `scripts/deploy/tests/Test-ManufacturaReleaseReadiness.Tests.ps1`, **30 pruebas**: base equivocada (servidor, `PGDATABASE`, `DB_NAME`), esquema inexistente, migraciones incompletas (solo 020–021; falta solo la 022; falta solo la 024; evidencia sin marcadores), políticas RLS incompletas (cantidad, tabla sin RLS, tabla sin política de respaldo), 026 ausente (con y sin parche), configuración contradictoria (true sin PRODUCCION, PRUEBA, valores inválidos, habilitada con base sin preparar, PreDeploy ya habilitada, web con interfaz y API apagada), imágenes, nginx, salud, no imprime secretos, entorno preparado (PreDeploy y PreEnable).
- **Bloqueo antes de afectar servicios**: `Deploy-DaubertHub.ps1` lee `MANUFACTURING_ENABLED`/`MANUFACTURING_EMISSION_ENV` (archivo de entorno de PROD y entorno de la sesión) y **bloquea en la compuerta, antes de cualquier mutación**, si la configuración es contradictoria o si habilita Manufactura sin `-ManufacturingReadinessEvidence <archivo>` reciente con `MANUFACTURA_READINESS_PASS phase=PreEnable`. 5 pruebas Pester nuevas. Límite: protege el camino del script; un `docker compose up` manual fuera del script no pasa por la compuerta.
- **Contra PostgreSQL desechable** (respaldo autorizado restaurado; migraciones aplicadas una a una):
  | Estado | Resultado |
  |---|---|
  | sin migrar | exit 1, 10 FAIL |
  | tras 020 / 021 / 022 / 023 / 024 | exit 1 (7 / 6 / 5 / 3 / 2 FAIL), nombrando las migraciones que faltan |
  | tras 026 | **exit 0** |
  | base equivocada · credencial inválida | exit 1 · exit 1 («la base respondió…» FAIL) |
  | preparado: PreDeploy config apagada · PreEnable true+PRODUCCION | exit 0 · exit 0 (evidencia PASS) |
  | PreDeploy con config que ya habilita · true sin PRODUCCION · PRUEBA · módulo sin parche | exit 1 en los cuatro |
- Total Pester de `scripts/deploy/tests`: **109** (74 + 30 + 5), todas pasan.

## 3. Respaldos: secuencia coordinada de la ventana
El parche `tools/ensayo-liberacion/respaldo-rls/enable-row-security.patch` **sigue sin aplicarse** al árbol operativo. Las tareas `Daubert - PostgreSQL Frequent/Daily/Monthly` ejecutan `scripts\backup\commands\Start-DaubertPostgresBackup.ps1` **de este árbol**: el parche entra en vigor en el instante en que el árbol contiene el commit que lo incluye. Por eso el parche debe ser un **commit de la rama candidata que no esté extraído en el árbol operativo** hasta el paso 4 (se prepara en un clon/worktree; `New-ReleaseImages.ps1` construye con `git archive` y no necesita extraerlo).

| # | Paso | Comando / criterio | Si falla |
|---|---|---|---|
| 1 | Estado de las tareas | `Get-ScheduledTask 'Daubert - PostgreSQL*'` → las tres `Ready`, último resultado 0, ninguna `Running`, sin lock de respaldo | Esperar a que termine la corrida (no interrumpirla). Nada cambió |
| 2 | Respaldo previo **comprobado** | Respaldo completo + `verificar-respaldo-manufactura.cjs --previo --restaurar --filas-origen … --roles …` (catálogo, restauración en instancia sin red, conteos) | **No iniciar la ventana.** Sin respaldo previo íntegro no se migra |
| 3 | Pausar las tareas | `Disable-ScheduledTask` de las tres (ventana cerrada de nginx activa) | No continuar con tareas activas |
| 4 | Parche de respaldos | `git merge --ff-only <candidata>` en el árbol operativo; Pester de respaldos; **respaldo de control** con el parche y la base aún sin migrar + verificación `--previo` (debe ser idéntico: la bandera es inocua sin RLS) | `git reset --hard <commit previo>`, comprobar un respaldo, reanudar tareas, cancelar. La base no se tocó |
| 5 | Migraciones 020→021→022→023→024→026 | `Invoke-ManufacturaMigrations.ps1 -DatabaseManifestSha256 … -Apply -EvidenceFile …` **sin `-UntilStep`** (solo así escribe `SMOKE_READONLY_PASS` y `MANUFACTURA_SQL_COMPLETE`) | Ver §4 «migraciones parciales». Tareas siguen en pausa |
| 6 | Readiness `-Phase PreDeploy` | base + coherencia respaldo↔026 + evidencia | No desplegar. Corregir lo que falte y repetir |
| 7 | Respaldo nuevo + integridad + restauración aislada | respaldo con `daubert_backup` y el módulo parchado; `verificar-respaldo-manufactura.cjs --restaurar` (9 tablas, 9+33 políticas, bytes y SHA-256 de PDF y firmas, conteos incluidas las tablas de Manufactura) | **No darlo por bueno aunque el exit sea 0.** Manufactura apagada, tareas en pausa hasta que uno pase |
| 8 | Reanudar tareas | `Enable-ScheduledTask`; `Start-ScheduledTask 'Daubert - PostgreSQL Frequent'`; resultado 0 **y** comprobación de integridad del artefacto publicado | Volver a pausar y diagnosticar |

**Ensayo** (`tools/ensayo-liberacion/ensayo-ventana-respaldos.ps1`; control de tareas simulado, estado real solo leído; «árbol operativo» = clon; PostgreSQL desechable):
| Escenario | Resultado |
|---|---|
| completa | 4 respaldos, todos comprobados con restauración (6/6, 6/6, 20/20, 20/20); respaldo de control con parche = mismo tamaño que el previo (366 145 bytes); tareas simuladas vuelven a `Ready` |
| tarea en ejecución | detenido en el paso 1, nada cambió |
| respaldo previo truncado tras un exit 0 | detenido en el paso 2 (3 FAIL de integridad) |
| sin parche | readiness detiene en el paso 6; sin readiness, `pg_dump` falla en el paso 7 (error de RLS) |
| bandera sin la 026 | readiness detiene en el paso 6 (4 FAIL); sin readiness, **`pg_dump` termina con exit 0 y la integridad lo rechaza** (0 de 9 políticas de respaldo) |
Hallazgos del ensayo corregidos: una parada por etapas (`-UntilStep`) no escribe el marcador final y readiness la rechaza (correcto); el verificador no comparaba las filas de las tablas de Manufactura (ahora sí) y ganó el modo `--previo`.

## 4. Plan de reversión consolidado
Principios: **no se ejecuta ningún DOWN automáticamente** (la 020 DOWN aborta con documentos: ensayado, 3 documentos intactos); se prefiere **Manufactura apagada + aplicación estable**; el esquema migrado es compatible con v1.1.1 (ensayado con documentos presentes).

| Situación | Qué hacer | Qué NO hacer | Ensayado |
|---|---|---|---|
| **Fallo antes de las migraciones** (pasos 1–4) | Volver al commit previo al parche si ya se incorporó; reanudar tareas; `Open`; cancelar la ventana | Migrar «para aprovechar» | Sí (pasos 1, 2) |
| **Migraciones parcialmente aplicadas** | El procedimiento se detiene en el primer fallo; cada paso es una transacción (el paso fallido no deja nada). Las ya aplicadas se **quedan**: esquema inerte con Manufactura apagada y v1.1.1 sana. Diagnosticar con la evidencia; reanudar con `-FromStep` cuando esté corregido, o dejarlo así hasta otra ventana. **Coherencia de respaldos:** si la 026 no llegó a aplicarse, las tablas de manufactura existen con RLS y sin política de respaldo. Con el parche ya aplicado (paso 4) `pg_dump` termina bien y vuelca esas tablas **vacías**; mientras Manufactura siga apagada están realmente vacías, así que no se pierde nada, pero el verificador y readiness **rechazan** ese estado (correcto: no es un estado de liberación). Sin el parche `pg_dump` falla. Por tanto: completar hasta la 026 en la misma ventana; si no se puede, dejar Manufactura apagada, mantener el parche, y **no habilitar** hasta completar. Revertir el esquema (DOWN manuales con confirmaciones y respaldo comprobado) solo si la junta lo decide y no hay documentos | DOWN automático; reanudar tareas sin un respaldo íntegro; habilitar | Parada segura: 6C.1. Incoherencia 024-sin-026: sí |
| **Fallo del respaldo posterior** | Manufactura apagada; tareas en pausa; comprobar parche (readiness) y política 026; repetir paso 7 hasta que la integridad pase | Aceptar exit 0; reanudar tareas | Sí |
| **Fallo de nginx** | `nginx -t` impide aplicar un archivo inválido y el servicio sigue; `-Action Open` reinstala la copia abierta; si web no arranca tras recrearse, restaurar la carpeta respaldada y recrear | Editar el archivo a mano sin `nginx -t` | Sí |
| **Fallo de la API o web nuevas** | Etiquetar la fallida, `rollback-<commit>`→`latest`, `up -d --no-build`, `Reload`, `/api/health`. El `default.conf` nuevo y el esquema migrado **no estorban** a v1.1.1 | Revertir esquema | Sí (salud `16153a8`, módulos 200, datos intactos) |
| **Activación accidental** | Apagar `MANUFACTURING_ENABLED`, recrear la API, `Reload`. La compuerta ya bloquea el camino del script sin evidencia de readiness | Dejarla encendida «porque health dice ok» | 6C.2 + compuerta (Pester) |
| **Fallo de PDF tras activar** | Los documentos **ya finalizados siguen disponibles** (su PDF se sirve de la base). Finalizar falla con 500, la revisión **queda en BORRADOR y editable**, no se registra PDF. Recrear el contenedor de la API desde la misma imagen validada; si persiste, apagar Manufactura | Reintentar en bucle; tocar datos | Sí (500 / BORRADOR / PATCH 200 / PDF previo 200; tras recrear, finalización 200) |
Observación: el fallo de PDF llega al usuario como «Error interno del servidor» genérico y `/api/health` sigue «ok».

## 5. Preparación de la candidata
- **Rama**: 180+ commits sobre `main` (`16153a8` = commit en PROD); `main` sin cambios; versión `1.1.1`; `scripts/backup/` sin diferencias respecto de `main`.
- **Caterpillar**: ningún archivo con nombre de Caterpillar/025 en el delta contra `main`; ningún commit exclusivo de las ramas `feat/cat-*`, `fix/caterpillar-*` o `release/*` alcanzable solo desde esta rama; 0 archivos `_025_` versionados. Los dos documentos de Caterpillar sin seguimiento y `.opencode/` siguen sin tocar.
- **Manifiesto de `database/`**: `MANIFIESTO COINCIDE con HEAD (77 archivos, base 16153a8)`; SHA-256 de autorización `dc6d1133a4be2d6bbeff4440d02053c28ee2b0e62a3096ed114433524f0971a2` (sin cambios; ningún archivo de `database/` cambió en esta fase).
- **Qué habrá que actualizar al autorizar** (nada de esto se hizo):
  | Elemento | Cambio |
  |---|---|
  | Cambios que pida la junta | Código/migraciones → **regenerar el manifiesto de `database/`** si toca `database/` y repetir ensayos afectados |
  | `package.json` (y `environment.ts`, lockfile) | versión `1.2.0` |
  | Rama candidata | commit final + commit del parche de respaldos (en clon/worktree, sin extraer en el árbol operativo) |
  | Imágenes | `New-ReleaseImages.ps1 -Build` sobre el commit final: api, web sin interfaz y web con interfaz; registrar los SHA-256 de los manifiestos (incluye `nginxConfSha256`) |
  | `…\maintenance-window\default.conf.open` y `default.conf` | línea base nueva (§1.2) |
  | `deploy/pilot.prod.env` (sin versionar) | al habilitar: `MANUFACTURING_ENABLED=true`, `MANUFACTURING_EMISSION_ENV=PRODUCCION`; opcionales `BIND_API_KEY`, `BIND_SUBSCRIPTION_KEY` |
  | Árbol operativo | `git merge --ff-only` de la candidata en el paso 4 (activa el parche de respaldos) |
  | `daubert_global` | migraciones 020–024 y 026 |

### Lista de comprobación
**Antes (días previos)** ☐ Acta de la junta con cambios pedidos resueltos ☐ commit final y v1.2.0 ☐ Pester deploy y respaldos en verde ☐ manifiesto de `database/` regenerado/verificado y su SHA-256 en el acta ☐ imágenes construidas, validadas en entorno aislado, manifiestos y SHA-256 en el acta ☐ `/api/health` de PROD = base del manifiesto ☐ custodio de la clave privada de respaldos disponible ☐ aprobación visual de los 8 PDF ☐ decisión sobre la política de cierre.
**Durante** ☐ tareas `Ready` (paso 1) ☐ respaldo previo íntegro (2) ☐ `Close` verificado ☐ tareas en pausa (3) ☐ línea base de nginx renovada y `Close` (§1.2) ☐ parche + respaldo de control (4) ☐ migraciones con evidencia completa (5) ☐ readiness PreDeploy PASS (6) ☐ respaldo nuevo íntegro y restaurado (7) ☐ despliegue **apagado** con imágenes validadas, `Reload`, smoke (Manufactura 404, módulos 200) ☐ `Open` + readiness con `-NginxConf` ☐ tareas reanudadas y corrida comprobada (8).
**Después** ☐ respaldo programado siguiente con resultado 0 e íntegro ☐ evidencias archivadas ☐ (autorización aparte) readiness PreEnable → evidencia → habilitar → smoke habilitado, flujo de documento, firma de 1,5 MB, PDF ☐ respaldo con documentos verificado ☐ anclas `rollback-<commit>` conservadas.

## 6. Archivos modificados (commits locales, sin push)
`deploy/closure/entry-closure-policy.conf` · `scripts/deploy/Set-EntryClosure.ps1` · `scripts/deploy/Deploy-DaubertHub.ps1` · `scripts/deploy/Test-ManufacturaReleaseReadiness.ps1` · `scripts/deploy/New-ReleaseImages.ps1` · `scripts/deploy/tests/Deploy-DaubertHub.Tests.ps1` · `scripts/deploy/tests/Test-ManufacturaReleaseReadiness.Tests.ps1` (nuevo) · `tools/ensayo-liberacion/ensayo-ventana-respaldos.ps1`, `sondas-nginx-manufactura.cjs`, `finalizar-hoja.cjs` (nuevos) · `verificar-respaldo-manufactura.cjs` · `ensayo-despliegue/compose.ensayo.yaml` · este documento.

## 7. Bloqueantes que siguen pendientes
1. **Decisión de la junta sobre la política de cierre**: el cambio de §1.3 modifica un diseño aprobado (y ya está en el árbol de trabajo: un `Close` en PROD lo instalaría).
2. **Integridad del artefacto real de las tareas**: el respaldo publicado va cifrado con `age`; comprobarlo exige la clave privada en custodia. El ensayo comprobó el volcado de `pg_dump` del módulo, no el descifrado del artefacto publicado.
3. **Control real de las tareas programadas** (`Disable/Enable-ScheduledTask`): solo simulado.
4. `Deploy-DaubertHub.ps1` sigue sin poder ejecutarse de extremo a extremo fuera de PROD; su compuerta se prueba con Pester. Un `docker compose` manual evita la compuerta de habilitación.
5. Imágenes definitivas, congelación del commit, parche como commit de la candidata y **v1.2.0**: pendientes a propósito hasta la junta.
6. Aprobación visual de los 8 PDF; BIND real sin comprobar; 11 runners desfasados; `compose.prod-temp.yaml` sin versionar.
7. Migraciones parciales sin la 026 dejan un estado intermedio que solo es aceptable con Manufactura apagada (§4): la ventana debe dimensionarse para completar hasta la 026. El comportamiento de `pg_dump` sin parche entre la 020 y la 024 se deduce del de después de la 026 (no se ensayó por separado).
