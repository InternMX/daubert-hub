# TEST actualizado para la demostración de Manufactura · resultado (Fase 6F)

Fecha: 2026-11-11. Alcance autorizado: **solo TEST**. Producción, sus contenedores, `daubert_global`, n8n, Dropbox, `scripts/backup/` y las tareas programadas **no se modificaron**.
Evidencia (fuera del repositorio): `C:\Users\06\Documents\Daubert\Evidencia_6F_20261111\`.

## 1. Respaldo de TEST y restauración
| Elemento | Resultado |
|---|---|
| Respaldo (ejecutado por el responsable con `postgres`) | `respaldos-postgres-test\daubert_hub_test_pre_demo_6F_20261111-135627.dump`, 1 042 605 bytes, SHA-256 `fe8062a58415cda8e0d5e944c08e4e326884d90150986804ae0f6346f1c501b2`; 48 tablas con datos (9 de `manufactura`) |
| Restauración | PostgreSQL 18 desechable **sin red**, `pg_restore --exit-on-error` = 0; **conteos idénticos en las 48 tablas**; 9 tablas y 24 políticas de manufactura; 4/4 firmas con SHA-256 y tamaño correctos. Instancia eliminada |
| Hallazgo | El primer intento se detuvo en un GRANT al rol `cat_recovery_test_coordinator` (de la 025 de Caterpillar, aplicada en TEST): hay que crear ese rol antes de restaurar el respaldo en un clúster nuevo. Se creó solo en la instancia desechable |
| Datos previos de TEST | La RLS los ocultaba al diagnóstico: 4 documentos, 10 revisiones, 4 firmas, 2 autorizaciones, 5 abreviaturas confirmadas (AUD, DAN, IMP, SCH, SEN). **No se modificaron ni borraron** |

## 2. Aislamiento
| Control | Evidencia |
|---|---|
| Salidas de red de la API (auditoría del código) | Solo cuatro: webhook de reproceso de Caterpillar, webhook de Pagos, salud de n8n y BIND. Chromium del PDF sin resolución de nombres (`--host-resolver-rules=MAP * ~NOTFOUND`) y CSP `default-src 'none'`. Correo y Dropbox: la API no los contacta (Dropbox es solo una ruta de texto que usa n8n) |
| n8n operativo | El webhook de Caterpillar de TEST apuntaba a `host.docker.internal:5678/webhook-test/…` (n8n operativo). Ahora: `http://127.0.0.1:9/bloqueado-demo-test` **dentro** del contenedor y token sintético; prueba desde el contenedor: **conexión rechazada**. Pagos, salud de n8n y BIND: **vacíos** (funciones desactivadas) |
| Base | Variables efectivas: `DB_NAME=daubert_hub_test`, `DB_USER=daubert_hub_test_user`; la sesión real de la API informa `current_database() = daubert_hub_test`; `/api/health` → `environment: TEST` |
| Publicación | `127.0.0.1:8081` únicamente (antes `0.0.0.0:8081`) |
| Separación | Proyecto `daubert-hub-test`, red `daubert-hub-test_pilot`, imágenes `daubert-hub-test-*`; sin volúmenes; ningún archivo de PROD en la invocación |
| Configuración usada | `deploy/pilot.test.env` (sin cambios) + `deploy/pilot.test.manufacturing.env` (versionado) + `tools/ensayo-liberacion/test-demo/pilot.test.demo.env` (aislamiento, sin secretos) + override `tools/ensayo-liberacion/test-demo/compose.test-demo.yaml` (loopback, imágenes fijas) |
| **Riesgo pendiente** | `daubert_hub_test_user` **puede conectarse a `daubert_global`** (CONNECT concedido a PUBLIC, valor por omisión de PostgreSQL; comprobado con una consulta `select 1` en sesión de solo lectura). La API de TEST no lo hace (configuración verificada), pero la credencial de TEST tiene ese alcance. Medir qué podría leer o escribir allí y corregirlo (`REVOKE CONNECT … FROM PUBLIC` y concesiones explícitas) es un cambio del clúster/PROD: **requiere otra autorización**. El sistema de permisos de esta sesión bloqueó una segunda consulta de catálogo en `daubert_global` y no se insistió |

## 3. Reversión disponible
`daubert-hub-test-api:rollback-20261001` (`45efe067fef0`) y `daubert-hub-test-web:rollback-20261001` (`386af2bf6e80`): las imágenes anteriores. Configuración anterior de los contenedores (nombres de variables) en `Evidencia_6F_20261111\reversion\`. Para volver: retag `rollback-20261001` → `latest` y el mismo `up -d --no-build`. La base no se restauraría automáticamente.

## 4. Contenedores y salud
| | |
|---|---|
| Imágenes (desde `262cb4e`, `New-ReleaseImages.ps1 -ImagePrefix daubert-hub-test -ManufacturingUi`) | api `sha256:4c427a6c…`, web `sha256:8cf01781…`; manifiesto SHA-256 `fb20da49…9c22`; Chromium 156.0.8078.79; 4 variantes de Carlito; nginx con la ruta de firmas de 3 MB (`27c5b07c…`) |
| `daubert-hub-test-api-1` | `healthy`; imagen = manifiesto |
| `daubert-hub-test-web-1` | `Up`, `127.0.0.1:8081`; interfaz de Manufactura compilada |
| `/api/health` | `{"status":"ok","database":"connected","environment":"TEST","version":"1.1.1","commit":"262cb4e"}` |
| Migraciones | Ninguna ejecutada (101–105 ya estaban) |

## 5. Validación funcional (cuentas de demostración, por la API real)
43 comprobaciones + 5 complementarias; **todas correctas** tras corregir dos errores de la propia prueba (los borradores de otras cuentas están en `GET team`, no en `open`; el historial exige `?codigo=`).
- Inicio de sesión ADMIN y dos GENERAL; módulos existentes (`/clients`, `/automations/overview`, `/recent-activity`) 200 para ambos roles.
- Permisos: GENERAL no administra usuarios ni da de alta clientes (403); sin sesión 401; GENERAL no abre una nueva revisión de una hoja ajena (403) ni modifica un borrador ajeno (403).
- BIND sin credenciales → 503 (la interfaz lo presenta como no configurado); **captura manual**.
- Borrador `DEMOFPMG101` (Bolsa Plana 1) con cliente AUDI del catálogo; autoguardado (versión 1 → 2, se conserva al reabrir); versión desfasada → 409.
- Borradores del equipo: GENERAL 2 y ADMIN ven el borrador de GENERAL 1 en solo lectura.
- Firmas: GENERAL 1 y ADMIN cargan firma; usar la de ADMIN sin autorización se rechaza; ADMIN autoriza a GENERAL 1; responsables Generó (firma propia), Revisó (firma autorizada) y Aprobó (sin firma).
- Finalización REV01 (`entorno PRUEBA`), PDF descargado (≈100 KB, Carlito, 3 imágenes), hoja inmutable (409). Nueva revisión REV02 finalizada; la REV01 conserva su PDF.
- Actividad reciente: creación, nueva revisión y finalizaciones REV01/REV02 de `DEMOFPMG101` y de `DEMOFPMG102`, cada una con enlace a la hoja.
**Hallazgo para la demostración:** el PDF finalizado **no lleva leyenda de prueba** (diseño: la plantilla se respeta tal cual; TEST se identifica en la interfaz). Un PDF de TEST impreso no se distingue de uno válido. En las hojas de prueba el campo **Fecha** quedó vacío porque no se capturó `fechaEmision`: en la demostración, capturarla.

## 6. Preparado para la sesión (`http://127.0.0.1:8081`, desde este equipo)
| Elemento | Estado |
|---|---|
| Cuenta ADMIN | `demo.admin.manufactura@example.invalid` (Demo Admin Manufactura) |
| Cuentas GENERAL | `demo.general1.manufactura@example.invalid`, `demo.general2.manufactura@example.invalid` |
| Contraseñas | Aleatorias, ya cambiadas; solo en `C:\Users\06\Documents\Daubert\Ensayo_6F\credenciales-demo-TEST.json` (local, fuera del repositorio). Cambiarlas desde «Mi perfil» si se prefiere |
| Clientes | AUDI, CATERPILLAR, DANA, IMPRO, SCHAEFFLER, SENSATA HOLDINGS |
| Abreviaturas | AUD, DAN, IMP, SCH, SEN confirmadas (alcance general). Para proponer una en vivo: un código con prefijo de CATERPILLAR (no hay abreviatura) |
| Firmas | GENERAL 1 (propia) y ADMIN (autorizada a GENERAL 1). GENERAL 2 sin firma (sirve para mostrar el espacio vacío) |
| Hoja para crear en vivo | Código libre sugerido `DEMOFPMG103` (o uno real elegido por Manufactura, captura manual) |
| Hoja finalizada para el PDF | `DEMOFPMG102` (Hojas, REV01) |
| Documento con revisiones | `DEMOFPMG101` (Bolsa Plana 1, REV01 y REV02 finalizadas) |
| Borrador del equipo | `DEMOFPMG104` (abierto, de GENERAL 1) para mostrar la consulta compartida |
| BIND | **No disponible** (sin credenciales): mostrar con captura manual y decirlo; o cargar credenciales según `04-bind-real.md` |
**Disponibilidad real:** la demostración puede hacerse hoy **desde este equipo** (la web solo escucha en loopback). Para mostrarla en otra pantalla: compartir pantalla o, con autorización, publicar temporalmente en la red local.
No se cambiaron plantillas, colores, fuentes ni responsables de los PDF.

## 7. Riesgos pendientes
1. Credencial de TEST con alcance de conexión a `daubert_global` (§2).
2. PDF de TEST sin leyenda: riesgo de confusión si se imprime.
3. TEST y PROD comparten el clúster PostgreSQL; el respaldo de TEST requiere crear `cat_recovery_test_coordinator` para restaurarse en un clúster nuevo.
4. BIND real sin comprobar.
5. Los README de las migraciones de TEST dicen «no aplicada» y están desactualizados.
6. TEST queda encendido (política `unless-stopped`): decidir si se detiene después de la sesión.
