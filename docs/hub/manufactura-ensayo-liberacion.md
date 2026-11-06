# Manufactura · preparación del ensayo de liberación (Fase 6A)

Estado: **solo preparación. No se leyó ni se respaldó `daubert_global`, no se ejecutó el ensayo, no se aplicó ninguna migración real y no se tocó ningún servicio operativo.** Todo lo medido aquí se hizo con contenedores y bases desechables.

## 1. Decisiones D1 y D3: referencias exactas

> **Aviso de numeración.** Hay **dos listas «D1…D6» distintas** en la documentación de Manufactura, y los informes de fases anteriores las mezclaron. Para evitar confusiones, a partir de aquí se citan con su documento.

| Etiqueta | Documento | Significado real | ¿Implementado? | Decisión que requiere |
|---|---|---|---|---|
| **D1 (decisión)** | `docs/hub/manufactura-produccion-diagnostico.md` §5, línea 73 | **PDF en PROD**: (A) Chromium dentro de la imagen de la API, (B) contenedor «renderizador» dedicado, (C) otro host. Recomendación del diagnóstico: **A**, tras un spike y con aprobación visual de Manufactura | **Sí, opción A** (Fase 5: `docker/api.Dockerfile`; spike y comparación visual en §4 de este documento) | **Aprobar la opción A** (o elegir B/C) y la aprobación visual del PDF con Carlito por parte de Manufactura |
| **D1 (cambio visible)** | `docs/hub/manufactura-diferencias-rama-vs-main.md` §2, tabla, fila D1 | **Clientes: alta, edición, desactivar y reactivar son solo ADMIN** (`@Roles('ADMIN')` en 4 rutas de `apps/api/src/clients/clients.controller.ts`; la web oculta «Nuevo cliente» a GENERAL en `ClientsPage.tsx`) | Sí (ya en la rama; aprobado para TEST) | **Confirmarlo para PROD** y avisar a futuras cuentas GENERAL. Hoy PROD tiene 4 ADMIN y 0 GENERAL (inventario del 2026-11-05), así que nadie pierde acceso |
| **D3** | `docs/hub/manufactura-produccion-diagnostico.md` §5, línea 75 (riesgo R13, línea 44) | **Cliente manual sin verificar**: ¿se permite en PROD o solo clientes del catálogo? | Sí: se permite en TEST **y** en PROD | **Decidir si se restringe en PROD** (no se agregó ninguna restricción) |

El informe de la Fase 5 llamó «D1» al cambio de clientes (segunda fila) y «D3» al cliente manual (tercera). La primera fila —la decisión del PDF— quedó implementada en esa fase pero **no estaba formalmente aprobada**.

### D3 · qué ocurre con un cliente manual al finalizar
- **Captura:** `DocumentsService.resolverCliente` acepta `nombre` sin `empresaId` y guarda `cliente_verificado = false`, `cliente_empresa_id = NULL`. No hay comprobación de entorno: vale igual en TEST y PROD.
- **Finalización:** `motivosNoLista` solo exige que exista `cliente_nombre`; el paso «cliente vinculado sigue activo y con el mismo nombre» se aplica **solo** a clientes verificados. Un cliente manual finaliza sin más.
- **Base de datos:** el CHECK `ck_manufactura_revisiones_cliente` (`cliente_verificado = false OR cliente_empresa_id IS NOT NULL`) es coherente con ambos casos; el nombre queda inmutable al finalizar (trigger de inmutabilidad). Las migraciones 020 (PROD) y 101 (TEST) son idénticas en esto.
- **Documento/interfaz:** el PDF imprime el nombre tal cual, sin marca de «no verificado»; la interfaz sí muestra la marca (chip) mientras se consulta el documento.
- **Riesgo de integridad:** **no es de integridad referencial** (no hay FK rota ni estado inconsistente). Es de **calidad de dato**: el nombre puede tener errores o duplicar a un cliente del catálogo con otra grafía, y como el documento es inmutable no se puede vincular después (habría que emitir una revisión nueva). Además no hay listado/informe de documentos con cliente sin verificar. En PROD hoy solo hay 2 empresas con rol CLIENTE, así que probablemente se usaría mucho la captura manual.
- **Cambios hechos (solo textos, sin cambiar comportamiento):** se corrigieron los comentarios y mensajes que decían «solo en TEST» (`documents.dto.ts`, `documents.service.ts`, `ManufacturingSpecificationPage.tsx`, `manufacturingDocuments.ts`), el mensaje de `CLIENTE_REQUERIDO` («…o escrito manualmente») y la etiqueta del chip («Cliente sin verificar (captura manual)», antes «manual de TEST», que en PROD era falsa). Las migraciones no se tocaron (sus hashes están en el README 020–024).

## 2. Configuración de TEST y de PROD

| Elemento | Versionado | Secreto/local | ¿Se usa en la compilación de la web? | ¿Se usa en ejecución de la API? |
|---|---|---|---|---|
| `compose.pilot.yaml` | sí | — | Declara los *build args* `VITE_MANUFACTURING_UI/DOCUMENTS` (por omisión `false`) | Pasa `MANUFACTURING_*` y `BIND_*` |
| `deploy/pilot.test.manufacturing.env` (**nuevo**) | **sí, sin secretos** | — | **Sí** (`VITE_MANUFACTURING_UI=true`, `VITE_MANUFACTURING_DOCUMENTS=true`) | Sí (`MANUFACTURING_ENABLED=true`, `MANUFACTURING_EMISSION_ENV=PRUEBA`) |
| `deploy/pilot.test.env.example` / `pilot.prod.env.example` | sí (plantillas) | — | — | Plantillas de `DB_*`, webhooks, `BIND_*` vacías |
| `deploy/pilot.test.env`, `deploy/pilot.prod.env` | **no** (`.gitignore`) | **sí** | `HUB_PORT`, etc.; solo se leen sus variables mediante `--env-file` | Credenciales, tokens, claves BIND |
| `apps/web/.env.local` | no | local de desarrollo | solo `npm run dev` | — |

- **Hallazgo:** el `deploy/pilot.test.env` real **no contiene** `VITE_MANUFACTURING_UI`, `VITE_MANUFACTURING_DOCUMENTS` ni `MANUFACTURING_*` (se comprobó solo la presencia de las claves; no se leyó ningún valor). Con el comando de despliegue anterior, la próxima reconstrucción de la web de TEST habría ocultado Manufactura.
- **Solución versionada:** `deploy/pilot.test.manufacturing.env` se pasa como **segundo** `--env-file`; el comando de TEST quedó en `deploy/README.md`:
  `docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env --env-file deploy/pilot.test.manufacturing.env -f compose.pilot.yaml up -d --build`.
  Comprobado con `docker compose config`: la web recibe `true/true` y la API `MANUFACTURING_ENABLED=true`, `EMISSION_ENV=PRUEBA`. Para PROD, sin ese archivo, todo queda `false/vacío`. No se modificó el archivo secreto ni se reinició ningún contenedor.
- **Variables de compilación ≠ de ejecución:** `VITE_*` solo cuentan al construir la imagen web; cambiarlas en el `.env` de una web ya construida no hace nada. Las `MANUFACTURING_*` solo las lee la API al arrancar.

## 3. Reproducibilidad de Docker y PDF

### Versiones medidas (imagen construida el 2026-11-06 con `docker/api.Dockerfile`)
| Componente | Versión |
|---|---|
| Base | `node:24-alpine` (Node v24.21.0, Alpine 3.24.2) · digest `sha256:ebfe2f90…905ec1c1` |
| Chromium | **156.0.8078.79-r0** (`apk`, 318 MB instalado en `/usr/lib/chromium`) |
| Fuentes | `font-carlito 20130920-r1` (sustituye Calibri), `fontconfig 2.17.1-r1`, `ttf-dejavu` (respaldo) |
| Otras dependencias de Chromium | `nss 3.124-r0`, `harfbuzz 13.2.1-r0`, `mesa 26.1.6-r0` |
| nginx (web) | `nginx:alpine` · digest `sha256:df221db8…abeac2` |
| Tamaño | Contenido de la imagen **≈406 MB** (`docker image inspect`); uso en disco de Docker Desktop **≈1.48 GB** (descomprimido); la capa `apk` pesa 820 MB. *(El informe de la Fase 5 dio solo la cifra de disco.)* |

### Conservar una imagen verificable (recomendación)
Los paquetes `apk` **no se fijan por versión** a propósito: la rama estable de Alpine retira versiones antiguas de Chromium al publicar parches de seguridad, y un `chromium=156.0.8078.79-r0` fijo dejaría de poder construirse. En su lugar, **construir una sola vez y desplegar esa misma imagen**:
1. Construir con `APP_VERSION`/`GIT_COMMIT` (etiqueta `daubert-hub-api:<versión>-<commit>`).
2. Registrar `docker image inspect --format '{{.Id}}'` (ID de contenido) y, si se usa registro, el digest.
3. `docker save daubert-hub-api:<tag> -o daubert-hub-api_<tag>.tar` y `Get-FileHash -Algorithm SHA256` del `.tar`; guardarlo junto al respaldo de la base. El ensayo y el despliegue usan **la misma imagen** (`docker load` si hace falta), nunca una reconstrucción.
4. Cualquier reconstrucción posterior exige repetir la comparación visual (§ siguiente) y la regresión `sheet-pdf-sin-leyendas.real.spec.ts`.
Opcional (no implementado, decisión de infraestructura): fijar el digest de la imagen base `node:24-alpine`.

### `--no-sandbox`: riesgos y mitigaciones
- **Por qué:** Chromium como usuario `node` sin privilegios en Docker no puede crear el sandbox (espacios de nombres de usuario). Se comprobó que **sin el flag la generación falla** (`ERROR`).
- **Riesgo:** sin sandbox, una vulnerabilidad del motor de renderizado ejecutaría código con los permisos del proceso (usuario `node`, que **comparte el contenedor con la API y sus variables de entorno, incluida la contraseña de la base**).
- **Reducen el riesgo:** el HTML lo genera el propio sistema con escape de contenido (pruebas «sin insertarse como contenido activo»); sin JavaScript de terceros ni URLs remotas; `--host-resolver-rules=MAP * ~NOTFOUND` (no resuelve nombres); `--disable-extensions`, sin red de fondo, perfil temporal nuevo por solicitud que se borra; límites del renderer (25 s, 2 simultáneos, cola de 4, HTML ≤2 MB, PDF ≤10 MB).
- **Mitigaciones adicionales, probadas en un contenedor desechable** (todas juntas generan el PDF): `--read-only` con `--tmpfs /tmp:rw,noexec,nosuid` y **`HOME=/tmp`** (sin esto falla: Chromium necesita un HOME escribible), `--cap-drop ALL`, `--security-opt no-new-privileges`, `--memory 1g`, `--pids-limit 256`, `--network none`. Para producción son equivalentes de compose: `read_only: true`, `tmpfs: [/tmp]`, `environment: HOME=/tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `mem_limit`, `pids_limit`. **No se aplicaron** (no son un cambio de infraestructura pequeño: afectan a toda la API); queda como decisión para la Fase 6B/de liberación. `--network none` no es aplicable a la API (necesita la base), solo al ensayo del PDF.
- **Alternativa de fondo:** contenedor «renderizador» aparte (opción B de D1), sin credenciales de la base. Mayor aislamiento, mayor complejidad; no es bloqueante.
- **Usuario y privilegios:** `uid=1000(node)`, sin `sudo`. El binario `chrome-sandbox` de Alpine sí es setuid root (`-rwsr-xr-x`), pero aun así Chromium no consigue su sandbox en este contenedor (comprobado: sin `--no-sandbox` falla), de modo que el flag es necesario con esta imagen. Sistema de archivos: el proceso escribe solo en el directorio temporal por solicitud (`mkdtemp` en `os.tmpdir()`), que se elimina siempre.

### Integridad visual de las ocho plantillas (medida)
PDF **finalizado** de los ocho formatos (Bolsa Plana 1, Hojas, Bolsa Fuelle, Bolsa Natural, Rollo Continuo, Termoencogible, COEX Azul, COEX Verde) con firmas, generado con (a) Chrome de Windows con **Calibri** y (b) Chromium del contenedor con **Carlito**, en el perfil endurecido de arriba. Comparación palabra por palabra con PyMuPDF:

| Resultado | Valor |
|---|---|
| Páginas (host / contenedor) | **1 / 1 en los 8**, Carta 612×792 |
| Texto | **idéntico** en los 8 (mismas palabras en el mismo orden) |
| Desviación máxima de posición | **x ≤ 0.1 pt, y ≤ 1.5 pt** (ninguna palabra desplazada más de 2 pt) |
| Fuentes incrustadas | host: Calibri/Calibri-Bold · contenedor: Carlito/Carlito-Bold |

Herramientas versionadas: `tools/ensayo-liberacion/generar-ocho-formatos.cjs` y `comparar_pdfs.py`. **Esto no sustituye la aprobación visual de Manufactura** (pendiente de D1): los PDF de ejemplo quedaron en `C:\Users\06\Documents\Daubert\_f6_pdf_cont\` (contenedor) y `_f6_pdf_host\` (host), fuera del repositorio.

## 4. Requisitos de la réplica de producción
- **Servidor:** PostgreSQL **18** desechable (`postgres:18-alpine`), misma versión mayor que los respaldos existentes; sin puertos publicados salvo `127.0.0.1`; red Docker propia; contraseña desechable (`scratch`) **distinta** de la de PROD.
- **Respaldo:** `pg_dump -F c` completo de `daubert_global` + `pg_dumpall --globals-only --no-role-passwords` (definición de roles sin contraseñas). Espacio: ≥2× el tamaño del dump. Ambos con SHA-256 y fuera del repositorio.
- **Roles:** los mismos nombres que PROD (`daubert_hub_app`, `n8n_app`, `n8n_cat_prod`, `n8n_cat_test`, `n8n_app_test`, `daubert_docs_ro`, `daubert_hub_test_user`) con contraseña desechable: los ACL del dump los referencian.
- **Datos:** restauración **completa** (con datos reales de PROD) dentro de la réplica aislada. Es información real: la réplica no sale de la máquina, no se publica ningún puerto externo y se destruye al terminar (`docker rm -f` + borrar volumen). Alternativa si se prefiere no copiar datos reales: restaurar solo la estructura (`--schema-only`, ya probada) y sembrar datos sintéticos, perdiendo la prueba de volumen/conteos.
- **Imágenes:** la imagen de API y la web construidas **una vez** (§3), cargadas en la réplica.
- **Usuarios de prueba:** en la réplica con datos se necesita un ADMIN y un GENERAL con contraseña conocida: se **crean con un hash generado dentro de la imagen** (`argon2`) en la réplica; nunca se usan ni se modifican cuentas reales (alternativa: reutilizar el flujo `createUser` de la API dentro de la réplica).

## 5. Procedimiento del ensayo (paso a paso; NO ejecutado)
Prerrequisitos: autorización explícita de la Fase 6B; D1 (PDF), D1 (clientes) y D3 resueltas; Docker y PostgreSQL 18 cliente en el equipo.

| # | Paso | Criterio de aprobación | Toca PROD |
|---|---|---|---|
| 0 | Congelar commit y construir **una** imagen API y web (§3); registrar IDs/hashes | Imágenes etiquetadas, `.tar` y SHA-256 guardados | No |
| 1 | **Respaldo de `daubert_global`**: `pg_dump -F c` + `pg_dumpall --globals-only` + `pg_restore -l` (TOC) + SHA-256; en la misma conexión de solo lectura: `contar-filas.readonly.sql` y la línea base del verificador transversal | Dump sin errores, TOC legible, conteos guardados | **Sí, lectura** (único paso) |
| 2 | **Restauración real** en `postgres:18-alpine` desechable (roles → `createdb` → `pg_restore --exit-on-error`) | Restauración sin errores | No |
| 3 | **Fidelidad de la réplica:** `contar-filas.readonly.sql` en la réplica = conteos del origen; huellas del verificador transversal iguales | `diff` vacío; 14 huellas iguales | No |
| 4 | **Validador de migraciones** con el dump: `validar-manufactura-020-024-en-replica-prod.cjs --dump <completo> --con-datos` (aplica 020→024 con precheck/up/postcheck, verificación transversal y de privilegios por paso, DOWN 024→020, vuelta a la línea base, reaplicación) | 0 FAIL | No |
| 5 | Réplica con **020–024 aplicadas** (dejar la réplica en ese estado) y crear ADMIN/GENERAL de prueba (§4) | `to_regnamespace('manufactura')` existe; 9 tablas | No |
| 6 | **API en modo producción** (contenedor `NODE_ENV=production`, `DB_NAME=daubert_global`, `DB_USER=daubert_hub_app`) con Manufactura **apagada** | `/api/health` → `PRODUCTION`; `smoke-http.cjs … disabled` → todo PASS (404 en las rutas de Manufactura) | No |
| 7 | Configuraciones inválidas | Las combinaciones contradictorias **no arrancan** | No |
| 8 | **Manufactura habilitada** (`MANUFACTURING_ENABLED=true` + `MANUFACTURING_EMISSION_ENV=PRODUCCION`) detrás del nginx real y la web compilada con la interfaz encendida | `smoke-http.cjs … enabled` → todo PASS; `capabilities.entorno = PRODUCCION` | No |
| 9 | **Documentos:** `flujo-documento.cjs` (borrador → cliente del catálogo → finalizar → PDF → `entorno = PRODUCCION` → inmutabilidad → firma 1.5 MB por nginx); repetir con cliente **manual** y registrar el resultado (D3); ocho formatos (`generar-ocho-formatos.cjs` + `comparar_pdfs.py`) | Todo PASS; PDF con Chromium del contenedor | No |
| 10 | **Roles, RLS, firmas, revisiones:** `…_smoke_solo_lectura.readonly.sql` (el mismo que se usará en PROD) y comprobaciones de ADMIN/GENERAL, borradores compartidos, autorización de firmas, revisor, cancelar finalización, nueva revisión | Todas las comprobaciones en `t`; GENERAL sin acceso a rutas ADMIN | No |
| 11 | **Regresión de módulos existentes** en la réplica: clientes, proveedores, contactos, automatizaciones (Caterpillar, Audi, Pagos), Actividad reciente, login/roles; corrida de la web y de la API unitaria sobre el mismo commit | Mismo resultado que antes de migrar | No |
| 12 | **Reversión:** (a) apagar `MANUFACTURING_ENABLED` y reiniciar la API de la réplica → 404; (b) arrancar la imagen **anterior** (sin Manufactura) contra la réplica migrada → módulos existentes OK; (c) `.down.sql` 024→020 en la réplica (con y sin documentos; con datos exige las confirmaciones) y comparar contra la línea base; (d) **restaurar el dump** en una réplica nueva y comprobar que es idéntica a la original | Cada reversión deja el sistema en el estado esperado | No |
| 13 | **Destrucción** de contenedores, redes y volúmenes de la réplica; conservar solo dump, hashes e informe | `docker ps -a` limpio | No |
| 14 | Informe y **decisión de despliegue** (autorización aparte) | — | — |

## 6. Pruebas que deben aprobarse antes del despliegue
1. Pasos 1–13 del ensayo, sin FAIL.
2. Suites: API (`npm test -w @daubert/api`) y web completas; typecheck, lint y build; `test:desechable`; regresión real de PDF (`sheet-pdf-sin-leyendas.real.spec.ts`) y `npm run test:sheets-*`.
3. Aprobación visual de Manufactura de los ocho PDF con Carlito (D1 PDF).
4. BIND (§7) aprobado, o **decisión expresa** de habilitar sin BIND (la captura manual sigue funcionando).
5. Runners de Caterpillar, Pagos y Actividad reciente repetidos donde sea seguro (§8) y pendientes clasificados.
6. Respaldo de PROD inmediatamente antes de aplicar, con restauración ya verificada en el ensayo.

## 7. Validación de BIND
- **Qué es:** cliente **solo lectura**: `GET {BIND_API_BASE_URL}/api/Products` (`bind-erp.client.ts`), `Authorization: Bearer <BIND_API_KEY>` y, si existe, `Ocp-Apim-Subscription-Key`. Solo `https://*.bind.com.mx`, sin puerto ni credenciales en la URL; no sigue enlaces fuera del host. Reintentos acotados (500 ms, 1.5 s), 10 s por intento, 30 s en total.
- **Variables:** `BIND_API_KEY` (necesaria), `BIND_SUBSCRIPTION_KEY` (opcional), `BIND_API_BASE_URL` (dejar vacía: por omisión `https://api.bind.com.mx`). Solo en `deploy/pilot.prod.env` / `pilot.test.env` (sin versionar). **Nunca** en la web ni en logs.
- **Endpoints de comprobación (autenticados, ADMIN o GENERAL):** `GET /api/manufacturing-sheets/bind-products/recent?skip=0&limit=5` y `GET /api/manufacturing-sheets/bind-products/by-code/<código DCMX conocido>`.
- **Comportamiento sin conexión/sin clave:** sin clave → **503** `BIND_NOT_CONFIGURED` (verificado en la Fase 5); credencial inválida → 502 «no autorizado»; `429` → 503 `BIND_RATE_LIMITED`; sin red o error del proveedor → **502** `BIND_UNAVAILABLE`; tiempo agotado → **504** `BIND_TIMEOUT`. La captura manual de la hoja sigue funcionando en todos los casos (no se bloquea el arranque).
- **Evidencia para aprobar:** (1) la clave se carga desde el archivo de entorno sin imprimirla (`docker compose config` **no** se pega en reportes); (2) `recent` devuelve 200 con productos; (3) `by-code` de un código real devuelve el producto y sus campos mapeados; (4) con la clave quitada → 503; (5) en la réplica **sin salida a internet**: 502/504 sin colgar la API; (6) no aparece la clave en logs (`docker logs | findstr` del prefijo, sin imprimir el valor). **El ensayo en la réplica no necesita BIND real**: se prueba aparte, desde TEST, con una clave de TEST.
- **Estado:** pendiente (no hay credenciales en esta fase).

## 8. Runners pendientes: ¿se pueden repetir en la réplica sin sistemas reales ni notificaciones?
Todos los runners `*.integration.runner.cjs` exigen que la URL de la base se llame **`daubert_hub_test`**: por diseño **no corren contra una réplica llamada `daubert_global`**. Se repiten en una **instancia desechable de TEST** (restaurada del respaldo de TEST, como en la Fase 3), nunca en la réplica de PROD ni en el TEST real. Ninguno envía notificaciones: arrancan su propia API con solo `DB_*` (webhooks sin configurar) o con un servidor falso local `127.0.0.1`.

| Runner | Causa del fallo en la Fase 3 | ¿Repetible? | Qué falta |
|---|---|---|---|
| `automations`, `security-phase6` | Fallo **preexistente en `main`**: la sesión de prueba es GENERAL y la ruta de ajuste de folios es ADMIN | Sí, pero fallará igual | Corregir el helper/runner (solicitud aparte) |
| `document-series-folio-adjustment` | Faltaba `TEST_DATABASE_URL_MIGRATOR` | **Sí, ya pasó** con la URL | `TEST_DATABASE_URL_MIGRATOR` apuntando al superusuario de la instancia desechable |
| `recent-activity` | Fixture: el correo 32 debe estar `PROCESADO` (en el respaldo estaba `PENDIENTE`); luego falla el ajuste de folios **también con el código de la rama real** | Parcial | Fixture y ver el ajuste de folios |
| `payment-notifications-reprocess-eligibility` | `Cannot read properties of undefined (reading 'reprocessBlockedCorreoIds')` (código idéntico a `main`) | Sí | Diagnosticar; probablemente un campo que el endpoint ya no devuelve |
| `payment-file-assignments` | «This fixture set was already used»: depende de un conjunto de datos virgen | Sí (usa un n8n **falso** local `127.0.0.1`) | Base recién restaurada |
| `payment-file-recovery` | Faltaba `TEST_DATABASE_URL_N8N_APP`; con `RUN_N8N_PAYMENT_RECOVERY=true` **arranca un n8n real** (`N8N_TEST_HOME`) | Solo la parte de base de datos | **No** activar `RUN_N8N_PAYMENT_RECOVERY` ni `N8N_TEST_HOME` |
| `caterpillar-model`, `-execution-finalization`, `-remision-persistence`, `-completion-integrity` | «permission denied for function fn_crear_ejecucion_automatizacion» y el estado de folio esperado: en el respaldo de TEST la función solo tiene `REVOKE … FROM PUBLIC` (sin `GRANT` a `n8n_cat_test`) | Sí | Determinar si el respaldo de TEST carece de una migración/grant que los runners suponen (comparar contra `20261022_015_caterpillar_atomic_admission_test` y `20261024_017…`) o si el rol correcto es otro |
| `caterpillar-admission` | Bandera `CAT_SNAPSHOT_WRITE_FLAG_REQUIRED` | Sí (escribe en la base desechable) | Activar la bandera en el entorno del runner |
| `caterpillar-cancellation.test-e2e` | No ejecutado | A evaluar | Revisar si necesita n8n real |
| Efímeros de cancelación (2) | — | **Ya pasan** (clúster nativo propio) | — |

## 9. Riesgos de despliegue

| # | Riesgo | Clasificación | Justificación |
|---|---|---|---|
| R1 | Migraciones 020–024 sin ensayo con datos reales ni respaldo restaurado | **Bloqueante** | Es la única operación irreversible sin restauración; el ensayo (§5) existe para cerrarlo |
| R2 | Orden de aplicación: 021 exige la 020 (huella 101), 022–024 dependen de las anteriores; cada una tiene precheck/postcheck con huellas | No bloqueante | Cada precheck verifica el estado previo (huella de la migración anterior) y aborta en base equivocada (probado: aborta en `otra_base`, UP repetido y UP con el rol de la aplicación) |
| R3 | Habilitación accidental de Manufactura | No bloqueante (mitigado) | Apagada por omisión; encender exige dos variables coherentes con la base; combinaciones contradictorias no arrancan; el cambio de web es de compilación. Riesgo residual: encenderla antes de migrar → 500/errores de base (no hay pérdida de datos) |
| R4 | Configuración divergente API/web (UI visible con API apagada o viceversa) | No bloqueante, con control | Pantallas rotas, no daño. Control: checklist del paso 8; la web de TEST necesita el segundo `--env-file` (§2) |
| R5 | Generación de PDF: Carlito ≠ Calibri; Chromium sin versión fija; `--no-sandbox` | **Bloqueante hasta la aprobación visual** (D1 PDF); no bloqueante el resto | Diferencia medida ≤1.5 pt, pero el PDF es el documento definitivo e inmutable: la aprobación de Manufactura es condición previa. El resto se gestiona con imagen conservada y endurecimiento opcional (§3) |
| R6 | Firmas: límites (2 MB API, 3 MB nginx), imagen reducida a ≤256 KB | No bloqueante | Probado: 1.5 MB pasa, 2.5 MB lo rechaza la API, 3.5 MB nginx. Falta probar con JPG real y la autorización de uso en la réplica |
| R7 | Tamaño de imagen API (~406 MB de contenido, ~1.5 GB en disco) y espacio en el host de PROD | No bloqueante | Comprobar espacio libre antes de cargar la imagen; el rollback conserva la imagen anterior |
| R8 | Dependencias operativas existentes (Caterpillar, Audi, Pagos, n8n) | **Bloqueante parcial** | La integración no cambió su código, pero los runners de Caterpillar/Pagos/Actividad reciente nunca corrieron completos sobre el código integrado (§8). Deben repetirse o aceptarse expresamente |
| R9 | D3: cliente manual en PROD (calidad de dato en documentos inmutables) | No bloqueante, **requiere decisión** | No hay riesgo de integridad referencial; sí de calidad. Decidir antes de habilitar para usuarios |
| R10 | D1 clientes solo ADMIN | No bloqueante, requiere confirmación | Nadie pierde acceso hoy (4 ADMIN, 0 GENERAL) |
| R11 | Restauración y reversión (restaurar dump tarda lo que pese; `.down.sql` de la 020 con datos exige confirmaciones y destruye documentos) | No bloqueante, con control | La reversión preferida es apagar la bandera (instantánea y sin tocar la base); el `down` solo sin datos o con respaldo |
| R12 | BIND sin validar | No bloqueante | La captura manual funciona; decidir si se habilita sin BIND |
| R13 | Pruebas HTTP intermitentes de Manufactura bajo carga; `sheets-regression` con metadatos de fuente | No bloqueante | Pasan individualmente / son preexistentes |
| R14 | Datos reales en la réplica | No bloqueante, con control | Aislar (sin puertos externos, red propia), cifrar el equipo, destruir al terminar |

## 10. Comandos de la Fase 6B (referencia; se ejecutan solo con autorización)
Variables (PowerShell): `$PG='C:\Program Files\PostgreSQL\18\bin'`, `$R='C:\Users\06\Documents\Daubert\Respaldos_PostgreSQL'`, `$TS=Get-Date -Format yyyyMMdd_HHmm`. La contraseña de PROD la pide `-W` o se toma de `PGPASSFILE`; **no** se escribe en comandos ni en archivos del repositorio.

```powershell
# 0. Imagen única verificable (desde la raíz del repo, en la rama integrada)
$env:APP_VERSION = (node -p "require('./package.json').version"); $env:GIT_COMMIT = (git rev-parse --short HEAD)
docker build -f docker/api.Dockerfile --build-arg APP_VERSION=$env:APP_VERSION --build-arg GIT_COMMIT=$env:GIT_COMMIT -t daubert-hub-api:ensayo-$env:GIT_COMMIT .
docker build -f docker/web.Dockerfile --build-arg VITE_MANUFACTURING_UI=true --build-arg VITE_MANUFACTURING_DOCUMENTS=true -t daubert-hub-web:ensayo-$env:GIT_COMMIT .
docker image inspect --format '{{.Id}}' daubert-hub-api:ensayo-$env:GIT_COMMIT
docker save daubert-hub-api:ensayo-$env:GIT_COMMIT -o "$R\daubert-hub-api_ensayo-$env:GIT_COMMIT.tar"; Get-FileHash -Algorithm SHA256 "$R\daubert-hub-api_ensayo-$env:GIT_COMMIT.tar"

# 1. Respaldo de daubert_global (ÚNICO paso que lee PROD; solo lectura)
& "$PG\pg_dump" -h localhost -p 5432 -U postgres -W -d daubert_global -F c -Z 6 -f "$R\daubert_global_completo_$TS.dump"
& "$PG\pg_dumpall" -h localhost -p 5432 -U postgres -W --globals-only --no-role-passwords -f "$R\daubert_global_roles_$TS.sql"
& "$PG\pg_restore" -l "$R\daubert_global_completo_$TS.dump" | Out-File "$R\daubert_global_completo_$TS.toc.txt"
Get-FileHash -Algorithm SHA256 "$R\daubert_global_completo_$TS.dump","$R\daubert_global_roles_$TS.sql" | Format-Table -Auto
# conteos del origen (sesión de solo lectura) para comparar con la réplica:
& "$PG\psql" -h localhost -p 5432 -U postgres -W -d daubert_global -X -At -F '|' -v ON_ERROR_STOP=1 -f tools/ensayo-liberacion/contar-filas.readonly.sql | Out-File "$R\filas_origen_$TS.txt"

# 2-4. Réplica, validación de migraciones sobre ella (con datos) y huellas: el validador crea y destruye su propio contenedor
node database/migrations/daubert_global/tools/validar-manufactura-020-024-en-replica-prod.cjs --dump "$R\daubert_global_completo_$TS.dump" --con-datos
```
Para dejar una réplica **persistente** con 020–024 aplicadas (pasos 5-12), repetir manualmente en un contenedor `postgres:18-alpine` en la red `ensayo`: crear roles (`daubert_global_roles_$TS.sql` con contraseñas desechables), `createdb daubert_global`, `pg_restore --exit-on-error`, `contar-filas.readonly.sql` y `diff` contra `filas_origen_$TS.txt`, y por cada migración `precheck → up → postcheck` (mismo orden y variables que `aplicarMigracion` del validador, ver `README-manufactura-020-024.md`). Luego:

```powershell
# 6. API en modo producción contra la réplica (Manufactura apagada)
docker run -d --name ens-api --network ensayo --network-alias api -p 127.0.0.1:58421:3000 `
  -e DB_HOST=ens-pg -e DB_PORT=5432 -e DB_NAME=daubert_global -e DB_USER=daubert_hub_app -e DB_PASSWORD=<desechable> -e API_PORT=3000 -e AUTH_COOKIE_SECURE=false `
  daubert-hub-api:ensayo-$env:GIT_COMMIT
$env:ENSAYO_PASSWORD='<contraseña de los usuarios sintéticos>'
node tools/ensayo-liberacion/smoke-http.cjs http://127.0.0.1:58421 disabled
# 8. Habilitada (reiniciar solo el contenedor de la réplica)
docker rm -f ens-api; docker run -d --name ens-api ... -e MANUFACTURING_ENABLED=true -e MANUFACTURING_EMISSION_ENV=PRODUCCION daubert-hub-api:ensayo-$env:GIT_COMMIT
node tools/ensayo-liberacion/smoke-http.cjs http://127.0.0.1:58421 enabled
# web real (nginx) delante, para firmas y límites:
docker run -d --name ens-web --network ensayo -p 127.0.0.1:58422:80 daubert-hub-web:ensayo-$env:GIT_COMMIT
node tools/ensayo-liberacion/flujo-documento.cjs http://127.0.0.1:58422 .\documento-final.pdf
# 9. Ocho formatos en el contenedor endurecido y comparación con el host
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m -e HOME=/tmp --cap-drop ALL --security-opt no-new-privileges --memory 1g --pids-limit 256 --network none `
  -v "$PWD\tools\ensayo-liberacion:/x:ro" -v "$PWD\_pdf_cont:/out" --entrypoint node daubert-hub-api:ensayo-$env:GIT_COMMIT /x/generar-ocho-formatos.cjs /app/apps/api/dist/src /usr/bin/chromium /out true
node tools/ensayo-liberacion/generar-ocho-formatos.cjs apps/api/dist/src "C:\Program Files\Google\Chrome\Application\chrome.exe" _pdf_host false
python tools/ensayo-liberacion/comparar_pdfs.py _pdf_host _pdf_cont
# 13. Destrucción
docker rm -f ens-api ens-web ens-pg; docker network rm ensayo; docker volume prune -f   # solo volúmenes de la réplica
```
Los usuarios de prueba (ADMIN/GENERAL) se insertan en la **réplica** con un hash generado dentro de la imagen: `docker run --rm --entrypoint node <imagen> -e "require('argon2').hash(process.env.P,{type:2}).then(console.log)"` (con `P` desechable). Los scripts de `tools/ensayo-liberacion/` se probaron en la Fase 5/6A sobre réplicas con la **estructura** real de PROD (sin sus datos).
