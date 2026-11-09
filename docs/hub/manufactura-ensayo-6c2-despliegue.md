# Manufactura · ensayo de despliegue y reversión en entorno aislado (Fase 6C.2)

Estado: **ensayado de extremo a extremo en un entorno aislado y desechable; NO se desplegó nada, NO se tocó `daubert_global`, `daubert_hub_test`, contenedores/volúmenes/puertos/credenciales de PROD, tareas programadas, n8n, Dropbox ni `scripts/backup/` del árbol operativo. Manufactura sigue sin habilitarse en PROD; la versión sigue en 1.1.1.**
Evidencia (fuera del repositorio): `C:\Users\06\Documents\Daubert\Evidencia_6C2_20261109\`.

## 1. Diagnóstico del despliegue real (Fase A)
1. `Deploy-DaubertHub.ps1` **construye en el servidor** (`up -d --build api web`) con etiquetas flotantes `daubert-hub-<svc>:latest`. Lo que se prueba antes no es, byte a byte, lo que se despliega. Ancla de reversión: `docker tag …:latest …:rollback-<commit>`; la reversión es manual (retag + `up -d --no-build`). Las constantes del script apuntan a PROD: **no puede apuntarse a un entorno aislado ni ejecutarse "en seco" sin leer PROD**; por eso el ensayo reproduce su secuencia con los mismos comandos sobre un proyecto Compose aparte (`ens62`) y su compuerta se prueba con Pester y con git real (6C.1).
2. **El `default.conf` de nginx de PROD es externo** (montado desde `…\DaubertHub\maintenance-window\nginx-conf.d`, copia del nginx **original** de la imagen, línea base `4d9dfea5…`). El `docker/nginx.conf` nuevo (límite de 3 MB para firmas) **no surte efecto en PROD** mientras ese archivo externo no se renueve. Reproducido en el ensayo (§4).
3. Las tareas de respaldo ejecutan los scripts **desde este árbol de trabajo**: cualquier commit sobre `scripts/backup/` en la rama activa cambia los respaldos reales. La política 026 y `--enable-row-security` deben entrar **juntas** (§4).
4. **Supuesto de base verificado (solo lectura):** `GET /api/health` de PROD informa `version 1.1.1, commit 16153a8` = la base con que se generó el manifiesto de `database/`.

## 2. Cambios al repositorio (commits locales, sin push)
| Archivo | Qué hace |
|---|---|
| `scripts/deploy/Deploy-DaubertHub.ps1` | Modo **opcional** `-UseValidatedImages -ImagesManifest -ImagesManifestSha256`: la compuerta exige que las imágenes locales `daubert-hub-<svc>:release-<commit>` tengan **exactamente** el ID del manifiesto de imágenes (cuyo SHA-256 se entrega fuera del repo) y que el manifiesto sea del commit candidato; el plan etiqueta `release-<commit>`→`latest` (tras las anclas) y corre `up -d --no-build api web` (**no reconstruye**). Sin el interruptor, comportamiento idéntico al anterior. Pester: 68 → **74** pruebas, todas pasan. |
| `scripts/deploy/New-ReleaseImages.ps1` | Construye api y web **desde `git archive <commit>`** (no del árbol de trabajo), etiqueta `release-<commit>` (nunca flotante), escribe el manifiesto de imágenes (commit, versión, ID, Chromium, fuentes, SHA-256 del `docker save`). Sin `-Build` solo imprime el plan. El ensayo encontró y corrigió tres errores propios (nombre de función que sombreaba `git`, Dockerfile tomado del árbol de trabajo en vez del commit, sonda de Chromium en imágenes que no lo traen). |
| `scripts/deploy/Test-ManufacturaReleaseReadiness.ps1` | Verificación **solo lectura** previa a habilitar (§5.3). |
| `tools/ensayo-liberacion/ensayo-despliegue/` | `compose.ensayo.yaml` (override del compose de PROD: sin build, red interna, loopback, conf.d de ensayo), `ensayo.env` (variables sintéticas), `probar-pgdump-modulo.ps1` (ejecuta el `Invoke-PgDump` real del clon contra la instancia desechable). |
| `tools/ensayo-liberacion/flujo-documento.cjs` | Acepta `ENSAYO_EMPRESA` (cliente de catálogo existente). |

## 3. Entorno aislado (Fase B)
Red `ens62-net` **interna** (sin salida) + `ens62-host` solo para publicar loopback; PostgreSQL 18 desechable restaurado con `pg_restore --exit-on-error` desde el respaldo autorizado (`daubert_global_completo_20261109_140238.dump`, roles reales con contraseña sintética) en `127.0.0.1:55433`; web en `127.0.0.1:18082`; webhooks a un host inexistente; sin BIND real; usuarios sintéticos (ids 9001+) con hash argon2 generado en el contenedor. "PROD simulado" = v1.1.1 construido de `16153a8` con el `default.conf` **original** de su imagen (SHA `4d9dfea5…`, idéntico a la línea base de PROD). Candidata = `d56fb5c` (Chromium 156.0.8078.79, fuentes Carlito). El clon aislado `Ensayo_6C2\clone` recibió el parche de respaldos; el árbol operativo no (`git status scripts/backup` limpio).

## 4. Resultados de la simulación (Fase C)
| # | Paso | Resultado |
|---|---|---|
| 1 | Preflight / base | `/api/health` del PROD simulado = `16153a8`; manifiesto de `database/` verificado contra esa base (77 archivos, SHA-256 de la compuerta `dc6d1133…`); Pester deploy 74/74 |
| 2 | Respaldo previo + restauración | Respaldo del módulo (sin parche, `daubert_backup`) OK antes de migrar; el respaldo autorizado se restauró en la instancia desechable |
| 3 | Parche solo en el clon | `git apply --check` limpio; Pester de respaldos **885/885**; árbol operativo sin cambios |
| 4 | Migraciones 020→021→022→023→024→026 | `Invoke-ManufacturaMigrations.ps1 -Apply`: exit 0, todos los `POSTCHECK_0NN_PASS`, `VERIFY_0NN_PASS`, `SMOKE_READONLY_PASS`, `MANUFACTURA_SQL_COMPLETE`; huellas de datos fuera de manufactura **idénticas** antes/después; evidencia sin secretos; v1.1.1 siguió sano durante y después de migrar |
| 5 | **Acoplamiento respaldo↔026 (confirmado)** | Tras la 026 el módulo **sin** parche **falla** (`query would be affected by row-level security policy for table "cliente_abreviaturas"`); **con** parche OK |
| 6 | Imágenes validadas | Anclas `rollback-16153a8`; `release-d56fb5c`→`latest`; `up --no-build`: los contenedores en ejecución tienen **los IDs del manifiesto** (§7); salud `commit d56fb5c` |
| 7 | Módulos existentes + Manufactura apagada | smoke: login ADMIN/GENERAL, `/clients`, `/automations/overview`, `/recent-activity` 200; todas las rutas de manufactura 404; sin sesión 401 — **todo PASS** |
| 8 | Activación simulada | web reconstruida con `VITE_MANUFACTURING_UI/DOCUMENTS=true` + API con `MANUFACTURING_ENABLED=true`, `EMISSION_ENV=PRODUCCION`: smoke habilitado **26 PASS** |
| 9 | **Hallazgo nginx (reproducido)** | Con el `default.conf` externo **original**: flujo borrador→cliente→finalizar→PDF (Chromium del contenedor, 92 KB) PASS, pero la **firma de 1,5 MB recibe 413**. Tras renovar el conf externo con el de la imagen candidata (`nginx -t` + `reload`): **201**. |
| 10 | Funcional completo | `validacion-funcional-manufactura.cjs`: **73 PASS / 11 FAIL**; los 11 son solo BIND (no hay BIND ni simulador en este entorno: 503 `NOT_CONFIGURED`) |
| 11 | Respaldo posterior con documentos | Módulo parchado, `daubert_backup`: exit 0; `verificar-respaldo-manufactura.cjs --restaurar --roles …`: catálogo 45 tablas, 9+33 políticas, **restauración en otra instancia sin red**, filas (documentos 7, firmas 2, pdf_contenidos 4, pdfs 4), bytes y SHA-256 de cada PDF y firma, ninguna revisión finalizada sin PDF, ninguna tabla ajena con menos filas: **íntegro** |

## 5. Reversión y negativos (Fases D y F)
### 5.1 Qué revierte cada mecanismo (no hay un "DOWN" universal)
| Mecanismo | Cuándo | Qué hace | Qué NO hace |
|---|---|---|---|
| **Reversión de aplicación** (retag `rollback-<commit>`→`latest`, `up --no-build` con el compose estable) | La API/web nuevas no arrancan o fallan | Vuelve a v1.1.1 | No toca el esquema. **Ensayado**: v1.1.1 corre sin problema sobre el esquema ya migrado y con 7 documentos (smoke PASS, documentos intactos) |
| **Desactivación funcional** (`MANUFACTURING_ENABLED=false` y recrear api) | Cualquier problema funcional/PDF/BIND | Rutas de manufactura → 404, resto intacto, datos y esquema intactos, reversible (**ensayado** apagar y reencender) | No cambia imágenes |
| **Reversión de esquema** (DOWN 024…020, 026) | Solo si no hay datos o con respaldo verificado y confirmaciones | Quita objetos | **La 020 DOWN aborta con datos** (ensayado: "Se perderían 7 documentos… ABORTO", documentos intactos). No es el camino normal |
| **Restauración de respaldo** | Pérdida/corrupción de datos | Recupera estado | Última opción |
Se prefiere: **desactivar Manufactura + mantener la app estable** antes que revertir esquema.

### 5.2 Escenarios ensayados
- **Migración falla** → se detiene en el primer fallo, sin DOWN automático (6C.1: privilegio indebido provocado → se detiene en la verificación transversal de la 022 y no llega a la 023; repetir sobre base migrada se detiene en el precheck de la 020).
- **API nueva no arranca** (contraseña inválida): salud `database: unavailable`, contenedor sin `healthy`; rollback con anclas → salud `16153a8`, IDs = v1.1.1; luego se re-promovió la candidata validada.
- **Web falla** (default.conf externo inválido): `nginx -t` lo detecta **antes** del reload y el web en marcha sigue sirviendo; si se recrea con la conf rota queda en reinicio (HTTP caído); restaurar el conf bueno + recrear lo recupera.
- **Fallo de PDF**: con Chromium inutilizado los PDF ya finalizados se siguen descargando (se sirven de `pdf_contenidos`); lo que fallaría es **finalizar** nuevas hojas. **No se ejercitó** de extremo a extremo la finalización con Chromium roto (el script de flujo usa un código fijo); queda cubierto por pruebas unitarias y por la desactivación funcional como salida.
- **Respaldo falla**: el módulo sin parche falla tras la 026 (paso 5) → el release debe detenerse.
- **Activación accidental antes de migrar** (instancia aparte restaurada del respaldo autorizado, API candidata con `MANUFACTURING_ENABLED=true` y sin esquema): **`/api/health` sigue "ok"**; `/clients` 200; las rutas con base de manufactura dan **500**; apagar la bandera y recrear la API → 404 y todo lo demás intacto (sin tocar la base). *Conclusión: el health no detecta la falta de esquema; la verificación §5.3 es obligatoria antes de encender.*

### 5.3 Negativos (Fase F)
Compuerta de `database/` (6C.1, git real, 13 escenarios): commit base distinto, manifiesto/SHA alterado, migración inesperada o ausente, CAT 025 → bloquea. Compuerta de imágenes (Pester nuevos): SHA del manifiesto distinto/ausente, manifiesto inexistente, imagen distinta o ausente, manifiesto de otro commit, comandos fuera de la lista → bloquea sin mutar. Migraciones (ensayo real): SHA-256 incorrecto → "Nothing was run"; `PGDATABASE=postgres` → "PGDATABASE must be daubert_global". `Test-ManufacturaReleaseReadiness.ps1` (ensayo real): positivo PASS con clon parchado + nginx nuevo + imágenes validadas + base esperada = commit en ejecución; **FAIL** correctamente con: parche de respaldo no aplicado (política 026 presente), nginx externo original, commit en ejecución ≠ base, SHA de manifiesto de imágenes incorrecto, imagen en ejecución ≠ validada, base equivocada.

## 6. Reproducibilidad de artefactos (Fase E)
- Las imágenes se construyen **de un commit identificado** (`git archive`) y se etiquetan `release-<commit>`; el despliegue exige el ID exacto; no se confía en etiquetas flotantes; **sin reconstruir** (`--no-build`).
- **Observación:** reconstruir la misma entrada **no** da el mismo ID de imagen (la API de la variante "con UI" difirió de la candidata: `1859…` vs `cc4b…`). Por eso el artefacto autorizado es **la imagen construida y validada** (ID + `docker save` con SHA-256), no "la receta". Una reconstrucción exige volver a validar.
- Candidata de ensayo `d56fb5c` (los commits posteriores solo añaden archivos del ensayo y documentación; **la imagen final debe construirse en el commit final de la rama y revalidarse**).
- Chromium **156.0.8078.79-r0** (Alpine 3.24) y 4 variantes de Carlito en la imagen API, medidos por la sonda de `New-ReleaseImages.ps1`.
- Promoción preparada, **no ejecutada**: `docker load` de los `.tar` (SHA-256 en el manifiesto) o reutilizar las imágenes locales → `Deploy-DaubertHub.ps1 -Deploy -UseValidatedImages -ImagesManifest … -ImagesManifestSha256 …` (con las banderas de migraciones de `manufactura-compuerta-despliegue.md`).

## 7. Identificadores
| Elemento | Valor |
|---|---|
| PROD simulado v1.1.1 (`16153a8`) | api `sha256:a68e21cb…3013`, web `sha256:2e95377e…6f01`; manifiesto SHA-256 `13fdd56a…a5ac` |
| Candidata `d56fb5c` | api `sha256:cc4b6abc…8edd`, web (sin UI) `sha256:cb688b45…1b96`; manifiesto SHA-256 `80012a2f…2749`; tar api `496a0e67…e45c`, web `55e223e0…d697` |
| Candidata, web con UI de Manufactura | `sha256:2abfec42…32edee`; manifiesto SHA-256 `53c3e0b1…6626` (su API `1859…` no se usó) |
| Manifiesto de `database/` | SHA-256 `dc6d1133a4be2d6bbeff4440d02053c28ee2b0e62a3096ed114433524f0971a2` (77 archivos, base `16153a8`) |
| Respaldo restaurado | `daubert_global_completo_20261109_140238.dump`, SHA-256 `F2F85D8D…C902F939` |

## 8. Variables necesarias (nombres, sin valores)
**API** (compose.pilot.yaml): `DB_HOST`, `DB_PORT`, `DB_NAME` (=`daubert_global`), `DB_USER`, `DB_PASSWORD`, `API_PORT`, `CATERPILLAR_REPROCESS_WEBHOOK_URL`, `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN` (obligatorias); `N8N_HEALTH_WEBHOOK_URL/TOKEN`, `PAYMENT_NOTIFICATIONS_*`, `PAYMENT_FILE_ASSIGNMENTS_PROD_*`, `AUTH_COOKIE_SECURE`, `HUB_PORT` (como hoy). **Manufactura (nuevas):** `MANUFACTURING_ENABLED` y `MANUFACTURING_EMISSION_ENV` (en PROD ambas: `true` y `PRODUCCION`; vacías = apagada), `BIND_API_KEY`, `BIND_SUBSCRIPTION_KEY`, `BIND_API_BASE_URL` (opcionales). **Compilación de la web:** `VITE_MANUFACTURING_UI`, `VITE_MANUFACTURING_DOCUMENTS` (`false` por omisión; `true` exige reconstruir/usar la imagen web con UI). **Imágenes:** `APP_VERSION`, `GIT_COMMIT` (los fija `New-ReleaseImages.ps1`). **Operador:** `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` para migraciones y verificación.

## 9. Procedimiento ordenado de liberación (propuesto; nada ejecutado)
0. Junta autoriza; se fija el commit final y se registran **fuera del repo**: SHA del manifiesto de `database/` y SHA del manifiesto de imágenes.
1. Preflight: PROD sano, `/api/health` commit = base del manifiesto de `database/` (si no, regenerarlo con ese `--base`), árbol limpio, Pester deploy y respaldos verdes.
2. Respaldo completo previo con restauración de prueba (`respaldar-daubert-global.ps1` o el respaldo del día) y su verificación.
3. Construir las imágenes en el commit final (`New-ReleaseImages.ps1 -Build -SaveDir …`), revalidar en el entorno aislado y registrar IDs; variante web **con** UI en un manifiesto aparte.
4. **Renovar el `default.conf` externo de nginx** (Prepare `-AcceptNewBaseline` con la imagen web nueva → Open/Reload con `nginx -t`) y decidir la política de cierre (§10).
5. Aplicar el parche de respaldos **en el mismo acto** que la 026 (con la ventana abierta y sin tareas de respaldo en curso), y correr una ejecución manual de respaldo para confirmar.
6. Migraciones: `Invoke-ManufacturaMigrations.ps1 -DatabaseManifestSha256 … -Apply -EvidenceFile …` (020→021→022→023→024→026).
7. `Test-ManufacturaReleaseReadiness.ps1` (base, 9 tablas, 33 políticas, coherencia respaldo↔026, commit, imágenes, nginx).
8. Desplegar **apagado**: `Deploy-DaubertHub.ps1 -Deploy -UseValidatedImages … -AcknowledgeMigrationsAlreadyApplied …`; smoke con Manufactura 404 y módulos existentes 200.
9. Respaldo de prueba posterior + `verificar-respaldo-manufactura.cjs --restaurar`.
10. (Autorización aparte) Activación: web con UI + `MANUFACTURING_ENABLED/EMISSION_ENV`; smoke habilitado; flujo de documento + firma de 1,5 MB + PDF; respaldo con documentos y verificación.

## 10. Procedimiento de recuperación ante fallos
| Fallo | Acción |
|---|---|
| Una migración falla | El procedimiento se detiene solo. No ejecutar DOWN a ciegas: diagnosticar con la evidencia; si hubo cambios parciales, la transacción de cada paso ya los deshizo; restaurar respaldo solo si hay daño. |
| La API nueva no arranca | Retag `rollback-<commit>`→`latest` (api y web), `up -d --no-build` con el compose vigente, comprobar `/api/health`. El esquema migrado no estorba a v1.1.1. |
| Web no arranca / conf externo inválido | `nginx -t` antes de reload; restaurar `default.conf` previo; recrear web. |
| Problema funcional / de PDF / de BIND | Desactivar Manufactura (`MANUFACTURING_ENABLED=false`, recrear api); datos y esquema quedan. |
| Se encendió la bandera sin esquema | Apagar bandera y recrear api; el health no lo avisa. |
| Respaldo falla tras la 026 | Detener; verificar que el parche esté aplicado (readiness); no habilitar. |
| Datos dañados | Restaurar el respaldo verificado en instancia aparte, comparar, y decidir con la junta. |

## 11. Bloqueos pendientes
1. **`default.conf` externo de nginx** debe renovarse (sin esto la firma de 1–2 MB da 413 en PROD). La **política de cierre** (`entry-closure-policy.conf`) tampoco incluye la ruta de firmas: decisión pendiente (diseño aprobado).
2. **Parche de respaldos sin aplicar** (debe ir junto con la 026); aplicar antes de que las tareas lo necesiten implica commit sobre `scripts/backup/` de la rama activa (las tareas leen este árbol).
3. Imagen final aún por construir en el commit final y por validar (no es reproducible bit a bit).
4. Aprobación visual de los 8 PDF por Manufactura; BIND real sin comprobar (aquí 11 pruebas BIND no aplicables); 11 runners desfasados; versión 1.2.0 pendiente; `compose.prod-temp.yaml` sin versionar.
5. Escenario "finalizar con Chromium roto" no ejercitado de extremo a extremo; `Test-ManufacturaReleaseReadiness.ps1` sin pruebas Pester propias (solo ensayo).
