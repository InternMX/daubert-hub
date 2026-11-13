# Actualización de TEST para la demostración de Manufactura · diagnóstico y procedimiento propuesto

**Estado: NO ejecutado.** Diagnóstico hecho en **solo lectura** el 2026-11-11. No se encendió, actualizó ni modificó ningún contenedor de TEST, ni la base `daubert_hub_test`. Se espera autorización para ejecutar el procedimiento.

## 1. Diagnóstico real de TEST
| Elemento | Estado comprobado |
|---|---|
| Contenedores | `daubert-hub-test-api-1` (detenido, código 137 = terminado a la fuerza) y `daubert-hub-test-web-1` (detenido, código 0). Ambos detenidos hace ~5 semanas. Política `unless-stopped`: no arrancan solos porque se detuvieron |
| Imágenes | `daubert-hub-test-api:latest` y `daubert-hub-test-web:latest`, construidas el **2026-10-01**, `APP_VERSION`/`GIT_COMMIT` = `unknown`. Sin código de Manufactura. No hay anclas de reversión para TEST |
| Compose | Proyecto `daubert-hub-test`, creado desde `compose.pilot.yaml` de este árbol (versión de entonces). Hoy `compose.pilot.yaml` añade variables (Manufactura, BIND, n8n, Pagos) con valores vacíos por omisión |
| Variables | `deploy/pilot.test.env` (**no versionado**): `HUB_PORT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `API_PORT`, `CATERPILLAR_REPROCESS_WEBHOOK_URL`, `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN`. `deploy/pilot.test.manufacturing.env` (versionado): `VITE_MANUFACTURING_UI=true`, `VITE_MANUFACTURING_DOCUMENTS=true`, `MANUFACTURING_ENABLED=true`, `MANUFACTURING_EMISSION_ENV=PRUEBA`. **Sin** variables de BIND |
| Puertos | Web en `8081`, publicado en **todas las interfaces** (`0.0.0.0`): accesible desde la red local. La API no se publica |
| Red / volúmenes | Red `daubert-hub-test_pilot` (bridge, con salida). **Sin volúmenes**. Sin montaje externo de nginx (TEST usa el `default.conf` de su imagen, que en la candidata ya trae la ruta de firmas de 3 MB) |
| PostgreSQL | `DB_HOST=host.docker.internal:5432` → el servicio **`postgresql-x64-18` del propio equipo**, el **mismo clúster que `daubert_global` (PROD)**. Base `daubert_hub_test`, rol `daubert_hub_test_user` |
| Migraciones de Manufactura en TEST | **101–105 ya aplicadas**: esquema `manufactura` con las 9 tablas, 24 políticas, `fn_firmas_inventario` (103), política de consulta compartida (105), RLS en todas las tablas. Los README de `database/migrations/daubert_hub_test` dicen «no aplicada»: **están desactualizados**. No hay 106 (TEST no tiene políticas de respaldo; no las necesita para la demostración) |
| Datos | 47 cuentas activas (2 ADMIN, 45 GENERAL; muchas sintéticas de los runners) y 6 empresas con rol CLIENTE. La cuenta de la aplicación, sin identidad de sesión, ve 0 documentos, 0 firmas y 0 abreviaturas (la RLS oculta lo que no es suyo, así que **no prueba** que no existan; `Entregables/Fase5_Gestor_Documental/PDF_finalizado_TEST/` indica que hubo hojas finalizadas en TEST) |
| Respaldo de TEST | El más reciente es `respaldos-postgres-test/daubert_hub_test_pre015_20261022-155448.dump` (22-oct), **anterior** a 101–105. **No hay respaldo vigente de TEST** |
| Dependencias | **Caterpillar:** `CATERPILLAR_REPROCESS_WEBHOOK_URL` apunta a `http://host.docker.internal:5678/webhook-test/<id>`; en el puerto 5678 del equipo escucha un proceso `node` nativo, que es el **n8n operativo**. **n8n de pruebas aislado** en `127.0.0.1:5690` (no lo usa TEST hoy). **BIND:** sin credenciales en TEST → la consulta responde «no configurado» |
| Herramientas de despliegue de TEST | Solo los comandos de `deploy/README.md` (`up -d --build` desde el árbol de trabajo). `Deploy-DaubertHub.ps1` y `Set-EntryClosure.ps1` son exclusivamente de PROD |
| Cookies | `AUTH_COOKIE_SECURE` no se define en TEST y su valor por omisión es `false`: el inicio de sesión funciona por `http://` |

## 2. Riesgos de la actualización
| # | Riesgo | Gravedad | Mitigación en el procedimiento |
|---|---|---|---|
| R1 | TEST comparte el **clúster PostgreSQL de producción**: respaldo, restauración o SQL mal dirigidos podrían afectar `daubert_global` | **Alta** | El procedimiento **no aplica migraciones** (ya están); todo SQL fija `PGDATABASE=daubert_hub_test`; el diagnóstico es de solo lectura y se niega con otra base; nunca restaurar sobre una base existente |
| R2 | El botón «Reprocesar» de Caterpillar en TEST llamaría al **n8n operativo** (`webhook-test`) | **Alta** | Archivo de entorno adicional de demostración que sustituye la URL por una inexistente (§3.2). No tocar n8n |
| R3 | Sin respaldo vigente de TEST | Media | Respaldo previo **comprobado** (paso 2) antes de arrancar nada |
| R4 | Las cuentas y datos de demostración se escriben en `daubert_hub_test` | Media (es TEST) | Requiere la misma autorización; los datos quedan en TEST |
| R5 | `8081` queda visible en la red local | Baja–media | Aceptarlo para la sesión o publicar solo en `127.0.0.1` con un archivo de override (§3.2) |
| R6 | Imágenes construidas desde el árbol operativo | Baja | Construir con `New-ReleaseImages.ps1` **desde el commit** (`git archive`), sin tocar archivos |
| R7 | Datos de TEST con hojas antiguas (fase 5) que la candidata interprete distinto | Baja | Detectable en la prueba; la reversión deja la base como estaba |
| R8 | El código 137 del contenedor API (finalización forzada) | Baja | Se recrea; revisar memoria y registros al arrancar |

## 3. Procedimiento propuesto (no ejecutado)
### 3.0 Autorización y ventana
Autorización escrita del responsable del Hub para: respaldo de `daubert_hub_test`, construcción de imágenes de TEST, arranque de TEST con la candidata y creación de cuentas/datos de demostración. Aviso de que TEST estará disponible en `8081`.

### 3.1 Comprobaciones previas (solo lectura)
1. `git -C <repo> rev-parse HEAD` = commit autorizado; árbol limpio salvo los tres elementos sin seguimiento conocidos.
2. `powershell -File tools\ensayo-liberacion\diagnostico-test-solo-lectura.ps1` → base `daubert_hub_test`, solo lectura `on`, esquema con 9 tablas, 24 políticas, marcadores 103 y 105 en 1, `sin_rls=0`. Si algo falta: **detener** (aplicar 101–105 es otra autorización, según sus README).
3. Producción intacta antes de empezar: `GET http://localhost:8082/api/health` → `1.1.1`, `16153a8`.

### 3.2 Archivo de entorno de demostración (crear con la autorización; no versionar)
`deploy/pilot.test.demo.env`, cargado **al final** (prevalece sobre los anteriores):
```
CATERPILLAR_REPROCESS_WEBHOOK_URL=http://webhook-bloqueado.invalid/demo
```
(El token puede quedarse; ya no se usa contra el n8n operativo.) Si se prefiere no exponer TEST a la red, añadir un override de Compose que publique `127.0.0.1:8081:80`.
Comprobación: `docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env --env-file deploy/pilot.test.manufacturing.env --env-file deploy/pilot.test.demo.env -f compose.pilot.yaml config` debe mostrar `DB_NAME: daubert_hub_test`, `MANUFACTURING_ENABLED: "true"`, `MANUFACTURING_EMISSION_ENV: PRUEBA`, `VITE_MANUFACTURING_UI: "true"` y la URL bloqueada. No imprimir la salida completa (contiene la contraseña): filtrar esas líneas.

### 3.3 Respaldo previo comprobado
1. Operador con la cuenta administrativa del clúster, en el equipo: `pg_dump -Fc -d daubert_hub_test -f <Daubert>\respaldos-postgres-test\daubert_hub_test_pre_demo_<fecha>.dump` (con `PGDATABASE`/`-d` explícitos).
2. `pg_restore -l` del archivo (catálogo legible; debe listar el esquema `manufactura`).
3. Restauración de prueba en un **contenedor PostgreSQL desechable sin red** (como en los ensayos), base `daubert_hub_test`, `--exit-on-error`, y conteo de filas con `tools/ensayo-liberacion/contar-filas.readonly.sql`. **Nunca** restaurar sobre `daubert_hub_test`.
4. SHA-256 del respaldo en la bitácora. Sin este paso completo, no se continúa.

### 3.4 Imágenes de TEST desde el commit
```
powershell -File scripts\deploy\New-ReleaseImages.ps1 -Commit <commit> -Build -ImagePrefix daubert-hub-test -ManufacturingUi -Manifest <fuera del repo>\imagenes-test.json
```
Registrar los ID, la versión de Chromium y el número de fuentes Carlito del manifiesto. (Estas imágenes son de TEST; **no** son las definitivas de producción.)

### 3.5 Anclas de reversión y promoción
```
docker tag daubert-hub-test-api:latest daubert-hub-test-api:rollback-20261001
docker tag daubert-hub-test-web:latest daubert-hub-test-web:rollback-20261001
docker tag daubert-hub-test-api:release-<commit7> daubert-hub-test-api:latest
docker tag daubert-hub-test-web:release-<commit7> daubert-hub-test-web:latest
```

### 3.6 Arranque
```
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env --env-file deploy/pilot.test.manufacturing.env --env-file deploy/pilot.test.demo.env -f compose.pilot.yaml up -d --no-build api web
```
Nunca con el nombre de proyecto `daubert-hub` ni con `pilot.prod.env`.

### 3.7 Comprobaciones de salud
1. `docker ps`: `daubert-hub-test-api-1` `healthy`; `daubert-hub-test-web-1` `Up`; las imágenes en ejecución tienen los ID del manifiesto.
2. `GET http://localhost:8081/api/health` → `status: ok`, `database: connected`, `environment: TEST`, `commit: <commit7>`.
3. Registros de la API sin errores al arrancar (`docker compose … logs api`, revisar sin copiar secretos).
4. Producción sigue igual: `GET http://localhost:8082/api/health` → `1.1.1`, `16153a8`.

### 3.8 Pruebas con ADMIN y GENERAL
Cuentas de demostración (§4) con la contraseña ya cambiada:
```
ENSAYO_PASSWORD=<contraseña> ENSAYO_ADMIN=<admin de demo> ENSAYO_GENERAL=<general de demo> node tools/ensayo-liberacion/smoke-http.cjs http://localhost:8081 enabled
```
Esperado: inicio de sesión de ambas; `/clients`, `/automations/overview`, `/recent-activity` 200; rutas de Manufactura responden; permisos ADMIN/GENERAL correctos; sin sesión 401. Después, a mano: crear un borrador, autoguardado, consulta del borrador por la otra cuenta GENERAL, firma de menos de 2 MB, finalizar y descargar el PDF (sin leyenda de prueba: ver el aviso de la guía), nueva revisión, **Actividad reciente** muestra los tres eventos con enlace.

### 3.9 Recuperación ante fallos
| Situación | Acción |
|---|---|
| Falla el diagnóstico, el respaldo o la construcción | Nada cambió: detener y diagnosticar |
| La API no queda `healthy` o la web no arranca | Volver a las imágenes anteriores: retag `rollback-20261001` → `latest` y `up -d --no-build api web` con los mismos archivos; o `docker compose --project-name daubert-hub-test … stop` (operación solo de TEST). La base no se tocó |
| Funciona pero Manufactura falla | En TEST Manufactura está **encendida por omisión**: quitar `pilot.test.manufacturing.env` no la apaga. Poner `MANUFACTURING_ENABLED=false` en `pilot.test.demo.env` y recrear la API (la interfaz compilada mostrará la sección, pero las rutas responderán 404), o volver a las imágenes anteriores |
| Datos de demostración no deseados | Quedan en TEST. Si hubiera que volver al estado previo: restaurar el respaldo del paso 3.3 en una **base nueva**, comparar y decidir (según el README de TEST) |
| Cualquier síntoma en PROD | Detener todo y comprobar `8082`; TEST no comparte contenedores, red ni imágenes con PROD, solo el clúster de base de datos |
Al terminar la sesión: decidir si TEST queda encendido o se detiene.

## 4. Preparación de la demostración
| Necesidad | Qué hay hoy | Qué preparar (con autorización) |
|---|---|---|
| **Usuarios** | 2 ADMIN y 45 GENERAL activos en TEST, sin saber cuáles son personas | 1 ADMIN y 2 GENERAL **de demostración**, con contraseña cambiada; no usar cuentas personales |
| **Productos** | Códigos ya usados: `SCHFPMG001` (Bolsa Plana 1), `DANFPMGOC04` (Bolsa Fuelle), `CONFPMG04` (COEX, confirmar) | Manufactura elige 3–5 códigos reales, idealmente uno por formato de interés |
| **Firmas** | 0 visibles para la aplicación | PNG de menos de 2 MB para Generó y Revisó, autorizadas; una persona en Aprobó **sin** firma (se ve el espacio vacío) |
| **Clientes y abreviaturas** | 6 empresas CLIENTE (entre ellas AUDI y CATERPILLAR); 0 abreviaturas | Confirmar 2–3 abreviaturas antes (p. ej. `AUD` → AUDI); dejar una sin registrar para proponerla en vivo; un prefijo compartido si se quiere mostrar la ambigüedad |
| **BIND** | Sin credenciales en TEST → «no configurado» | O las carga su custodio en el archivo de entorno de TEST (procedimiento de `04-bind-real.md`, sin pasarlas por chat o correo), **o** se demuestra con captura manual y se dice explícitamente |
| **Crear en vivo** | — | Un borrador desde un código (prellenado, confirmar un dato sugerido, autoguardado); consulta por la segunda GENERAL; asignar responsables y firmar; finalizar y descargar; una nueva revisión |
| **Dejar finalizado antes** | — | Una hoja finalizada por formato que se quiera mostrar (para ver el PDF sin esperar), una con **REV02** (historial), un borrador descartado (no aparece en Actividad reciente) |
| **Impresión** | — | Impresora del área para imprimir un PDF en Carta (márgenes) |
**Diferencias visuales de los PDF:** registradas en `03-revision-ocho-formatos.md` como **pendientes de aprobación de Manufactura** (letra Carlito, rótulos en azul marino en los formatos simples, tres responsables, posición en la hoja, orden de los primeros renglones, unidades). No se modificó ninguna plantilla, color, fuente ni responsable.
