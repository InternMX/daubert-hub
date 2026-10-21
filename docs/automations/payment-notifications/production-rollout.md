# Asignación puntual de archivos — puesta en PRODUCCIÓN (preparación, NO ejecutada)

Estado: **migraciones 015–017 ya aplicadas manualmente en `daubert_global` (21/10/2026, ver sección 7); workflow candidato y Hub (banderas apagadas) pendientes: no se han importado ni desplegado.**
La funcionalidad quedó validada en TEST (PostgreSQL `daubert_hub_test`, n8n Windows 5678, Hub TEST): ingesta ZIP/PDF con `fflate`, asignación puntual de un PDF
con alias desconocido, reproceso, otro PDF con el mismo alias intacto, catálogo de aliases sin cambios, sin duplicados.

## 1. Cambios exactos

### 1.1 Workflow `Produccion Notificacion de pagos a Proveedores` (n8n 5678)

Se prepara como **workflow nuevo e inactivo** (`pagos_produccion_asignaciones_candidata.json`, 108 nodos) construido sobre la versión **viva** de PROD
(`887c122b…`, 100 nodos). El workflow actual no se toca: queda como respaldo y vía de rollback.

| Tipo | Nodos | Origen |
| --- | --- | --- |
| **Nuevos (8)** | Registrar archivo (identidad), Aplicar registro de archivo, Resolver asignacion puntual, Aplicar asignacion puntual, Registrar archivo (incidencia), Aplicar registro de incidencia, Tomar archivo (inicio de procesamiento), Aplicar toma de archivo | idénticos al paquete TEST validado; credencial = la PostgreSQL de PROD |
| **Modificados, idénticos a TEST (7)** | Preparar metadatos ZIP, Separar archivos descomprimidos, Calcular identidad PDF, Clasificar con catalogo, Verificar duplicados, ¿Procesar en esta ejecución?, Registrar correo pendiente | idénticos al paquete TEST validado (partían de una base idéntica a PROD) |
| **Modificados con configuración PROD (2)** | `Configurar entorno` (política de zona, `MODO="PRODUCCION"`, base esperada `daubert_global`, historial `archivos_procesados.json`); `Preparar correo para reproceso` (consulta de PROD + una columna `current_database() AS base_datos`) | ver 1.1.1 |
| **Conexiones** | 3 reconectadas (Calcular identidad PDF → Registrar archivo; Clasificar con catalogo → Registrar archivo (incidencia); ¿Procesar en esta ejecución? → Tomar archivo) + las de los 8 nodos nuevos | iguales al paquete TEST |
| **Conservados tal cual están en PROD (≥ 90)** | incluidos: Schedule Trigger (activo), Obtener correos Outlook (carpeta y `limit` 20), ¿Correo válido de pagos? (`@ocaadministradores.net`), Send a message (resumen real a Sofi), Preparar resumen Sofi, Seleccionar correo a reprocesar, webhook `daubert-hub/notificaciones-pago/reprocesar`, todos los nodos Outlook/HTTP, credenciales y `settings` (workflow de error) | — |

#### 1.1.1 Por qué NO se puede copiar el workflow TEST a PRODUCCIÓN

El TEST se construyó sobre el workflow TEST histórico, que **ya difiere** de PROD: PROD tiene lógica más nueva en `Preparar correo para reproceso` (reintenta
también empresas `OMITIDO` cuya notificación se activó después), en `Preparar resumen Sofi`, en el filtro de remitente, en la carpeta/`limit` de Outlook y en el envío del
resumen. Copiar el paquete TEST **regresionaría esos comportamientos**. La candidata aplica únicamente el delta de la integración sobre PROD y lo demuestra
(`verificar_candidata.py`: 9 nodos modificados exactos, 8 nuevos, 0 credenciales nuevas, ningún rastro de TEST, conexiones coherentes, sintaxis de todo el código,
`Configurar entorno` produce **la misma configuración que PROD** sobre las rutas reales y se detiene con `BASE_NO_CORRESPONDE_AL_ENTORNO` si la base no es `daubert_global`).

### 1.2 PostgreSQL `daubert_global` (migraciones nuevas, **no ejecutadas**)

`database/migrations/daubert_global/` — cada una con `precheck`, `up`, `postcheck` y `down`:

| Migración | Equivale a (TEST) | Contenido |
| --- | --- | --- |
| `20261022_015_payment_file_assignment_prod` | 012 | tablas `archivos_notificacion_pago` y `asignaciones_archivo_notificacion_pago`, auditoría, `fn_registrar…`, `fn_resolver…`, `fn_archivo_notificacion_asignable`, `fn_bloquear_archivos_reproceso_pago` |
| `20261022_016_payment_file_resolution_prod` | 013 | `fn_consultar_archivo_notificacion_pago` (resultados estructurados, toma) |
| `20261022_017_payment_file_reprocess_eligibility_prod` | 014 | `fn_evaluar_archivo_notificacion_pago` (interna) + `fn_reproceso_asignaciones_puntuales` (Hub, solo lectura); la consulta 016 delega en el evaluador |

Solo **objetos nuevos**: no altera tablas, vistas, funciones ni datos existentes. Cuerpos idénticos a TEST; cambian guardas (`daubert_global`) y permisos.
Ensayadas en un PostgreSQL desechable (copia del esquema TEST con la base renombrada `daubert_global`, ya eliminada): precheck → up → postcheck para las tres,
prueba de permisos con `SET ROLE`, `down` en orden inverso, `up` de nuevo, y rechazo del `up` en otra base y en doble aplicación.

### 1.3 Permisos mínimos (rol PROD de n8n = `n8n_app`, **compartido con Caterpillar y Audi**)

| Rol | Permisos nuevos | No tiene |
| --- | --- | --- |
| `n8n_app` | `EXECUTE` sobre `fn_registrar_archivo_notificacion_pago` y `fn_consultar_archivo_notificacion_pago` (únicas dos funciones que usa el workflow) | acceso directo a las tablas nuevas; `fn_resolver`, `fn_archivo_notificacion_asignable`, `fn_bloquear…`, `fn_evaluar…`, `fn_reproceso…` |
| `daubert_hub_app` | `SELECT` en `archivos_notificacion_pago`; `SELECT, INSERT, UPDATE` en `asignaciones_archivo_notificacion_pago`; `EXECUTE` en `fn_archivo_notificacion_asignable`, `fn_bloquear_archivos_reproceso_pago`, `fn_reproceso_asignaciones_puntuales` | registrar/resolver/consultar identidades; `DELETE`; escritura en `archivos_…` |
| `PUBLIC` | nada (todo `REVOKE`) | — |

Las funciones son `SECURITY DEFINER` con `search_path` fijo; los `postcheck` verifican esta matriz y que `PUBLIC` no conserve `EXECUTE`.
Consecuencia a decidir: como `n8n_app` es compartido, las credenciales de Caterpillar/Audi también podrían ejecutar esas dos funciones. Las funciones exigen un `correo_id`
existente y una procedencia coherente, y no exponen datos; la alternativa (rol dedicado `n8n_pagos_app` y credencial nueva) añade una credencial y se deja como mejora posterior.

### 1.4 Daubert Hub (rama `feat/payment-file-assignments-prod-readiness`, sobre `f1bf30c`; **sin commit, sin push, sin PR**)

Habilitación **independiente** de TEST. Las banderas `*_TEST_*` nunca activan producción y las `*_PROD_*` nunca activan TEST:

| Variable | Efecto |
| --- | --- |
| `PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED` | solo con `DB_NAME=daubert_global`: el Hub consulta las tablas nuevas y permite **guardar** asignaciones. Con `false` (por defecto) el Hub no toca las tablas y se comporta como hoy |
| `PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_READY` + `PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_ORIGIN` | permiten **reprocesar** con asignaciones solo si `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL` es exactamente `http://<host.docker.internal\|127.0.0.1\|localhost>:5678/webhook/daubert-hub/notificaciones-pago/reprocesar`, hay token y el origen coincide. Las rutas TEST se rechazan |

Archivos: `config/environment.ts`, `payment-file-n8n-target.ts` (`isProductionN8nTarget`, lista cerrada), `payment-file-assignments.service.ts`, `payment-file-assignments.repository.ts`
(mensajes y base permitida), `AssignPaymentAliasDialog.tsx` (texto ya no dice «PostgreSQL TEST»), `test/payment-file-prod-readiness.spec.ts` (30 pruebas), `compose.pilot.yaml`
(**ahora sí pasa** `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL/TOKEN` —hoy ausentes, inconsistencia #13— y las tres variables nuevas, todas opcionales y apagadas), `deploy/pilot.prod.env.example`,
`docs/00-overview/environments.md`.
Verificado: 89 pruebas de las dos especificaciones de n8n-ready, 95 pruebas web de los diálogos/página de Pagos y `tsc --noEmit` sin errores. No se repitió la suite completa (según lo indicado); la CI debe ejecutarla en el PR.

## 2. Diferencias que deben validarse antes de activar

| Tema | Hallazgo | Estado |
| --- | --- | --- |
| Identidad del adjunto real | La respuesta real de Outlook trae `id` del adjunto y `contentType: application/x-zip-compressed`; el workflow usa ese `id` solo si el correo tiene **un único ZIP** (con varios, `ADJUNTO_SIN_ID`: el procesamiento por catálogo sigue, sin asignación puntual) | verificado en ejecuciones reales |
| Identidad del ZIP real | Se aplicó la regla (`fflate` + nombre base + tamaño, entrada única) a **6 ZIP reales de PROD ya almacenados por n8n**: 72/72 entradas `CONFIABLE`, 0 ambiguas, 0 sin correspondencia, 0 perdidas. Todos tienen **subcarpetas** (las entradas se llaman `carpeta/archivo.pdf`; el nodo Compression entrega el nombre base) y compresión deflate | verificado (solo lectura) |
| `fflate` en el n8n productivo | `NODE_FUNCTION_ALLOW_EXTERNAL=fflate` ya activo en el proceso 5678 (reinicio del supervisor del 21/10). Es el mismo proceso que ejecuta PROD | hecho |
| Política de zona nueva en PROD | En TEST era nueva; en PROD bloquea rutas fuera de `Dropbox` o por enlace simbólico. `Configurar entorno` se ejecutó con rutas reales (sin crear carpetas): acepta la configuración. Sin enlaces simbólicos en Dropbox hasta 3 niveles. **Pendiente:** precheck 015 §3 sobre el catálogo real (`ruta_destino`) y escaneo de enlaces en carpetas de proveedor | parcial |
| Correos históricos | Los correos anteriores no tienen archivos registrados: en un reproceso se registran con estado operativo `INCIERTO` y, **sin asignación activa, siguen por el catálogo** como hoy; con asignación activa el flujo bloquea. Hay que probar un reproceso de un correo antiguo en el ensayo | pendiente |
| Credencial PostgreSQL de PROD | Debe conectarse como `n8n_app`. La contraseña no se consultó; confirmar el usuario en la ficha de la credencial | pendiente |
| Webhook y token del Hub | `Daubert Hub - n8n PROD` (Header Auth) debe coincidir con `PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN` | pendiente |
| Aliases permanentes y borradores | No se tocan nodos de aliases ni de borradores/Outlook; los 90+ nodos restantes son idénticos a PROD | verificado |

## 3. Riesgos concretos que impiden habilitarlo hoy

1. **La candidata nunca se ha ejecutado contra Outlook/Dropbox reales.** Sus componentes están validados (ingesta y reproceso en TEST Windows con stubs, ZIP real en solo lectura), pero la
   primera ejecución real será en producción: la ventana de cambio debe vigilarse y el rollback debe estar ensayado.
2. **Rol `n8n_app` compartido** con Caterpillar y Audi (1.3): decisión de aceptar o crear rol dedicado.
3. **Política de zona** nueva en PROD: un `ruta_destino` fuera de `Dropbox` o un enlace detendrá ese archivo con `RUTA_FUERA_DE_ZONA_AUTORIZADA` (queda como error visible, sin escribir). Se detecta con el precheck.
4. **El Hub desplegado no tiene las variables de Pagos** (`compose.pilot.yaml`): hasta el despliegue de este cambio, reprocesar desde el Hub no funciona en el piloto Docker.
5. **Orden de integración:** `f1bf30c` (destino TEST 5678) y esta rama deben integrarse antes; ni el Hub ni las migraciones se han fusionado.
6. **Un solo workflow activo:** el candidato usa el mismo webhook que PROD; los dos no pueden estar activos a la vez, ni procesar el mismo buzón.
7. **Migraciones TEST y PROD conviven** en `database/migrations/daubert_global/` (012-014 TEST-only con guarda; 015-017 PROD-only con guarda).
8. **Falta la suite completa** del Hub en esta rama (se ejecutó solo lo específico).

## 4. Procedimiento mínimo (cada paso requiere autorización explícita; ninguno se ha ejecutado)

**0. Antes (sin cambios):** respaldo OnChange de n8n (`Start-DaubertN8nBackup.ps1 -Tier OnChange`); volcado de `daubert_global` (al menos esquema `core`/`audit`); export del workflow PROD vivo
(`prod_snapshot_origen.json`); `precheck` 015 y registro de la línea base (correos, resultados, borradores, catálogo, alias, PENDIENTE); confirmar usuario de la credencial PostgreSQL PROD.

**1. Base de datos (aditivo, sin parada):** `precheck` → `up` → `postcheck` de 015, 016 y 017, en ese orden, con un administrador. El workflow actual sigue funcionando sin cambios.
*Rollback:* `down` 017 → 016 → 015 (válido mientras las tablas estén vacías).

**2. Hub (banderas apagadas):** fusionar PRs, construir y desplegar con el `compose.pilot.yaml` nuevo; añadir al env de PROD `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL=http://host.docker.internal:5678/webhook/daubert-hub/notificaciones-pago/reprocesar`
y el token. `PAYMENT_FILE_ASSIGNMENTS_PROD_*` en `false`. *Rollback:* imagen anterior.

**3. Workflow (ventana corta, sin ejecuciones `running` ni correos `PENDIENTE`):** importar la candidata **desde la interfaz** como inactiva; verificar nodos con credencial PostgreSQL de PROD y 0 nodos sin credencial;
desactivar `Produccion Notificacion de pagos a Proveedores` y activar la candidata; observar el primer ciclo (correo nuevo → `PROCESADO`, `archivos_notificacion_pago` poblada, PDF en carpeta, borrador, resumen).
*Rollback (≈1 minuto):* desactivar la candidata y activar el workflow anterior; las tablas nuevas permanecen inertes. No requiere reiniciar n8n.

**4. Hub fase A:** `PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED=true` (solo guardar asignaciones). **Fase B:** tras confirmar el paso 3, `…_PROD_N8N_READY=true` y `…_PROD_N8N_ORIGIN=http://host.docker.internal:5678`.
Se recrea solo el contenedor de la API del Hub. *Rollback:* banderas a `false`.

**5. Piloto supervisado:** un caso real de alias desconocido con asignación puntual y reproceso, con el equipo de Contabilidad avisado. *Rollback:* Hub a `false`; workflow anterior (3).

Caterpillar y Audi no se modifican en ningún paso (solo comparten el rol `n8n_app`, con dos `EXECUTE` más).

## 5. Artefactos

- Hub (rama `feat/payment-file-assignments-prod-readiness`): migraciones `20261022_015…017` (+ `precheck/postcheck/down`), cambios de la sección 1.4, este documento.
- n8n (`C:\Users\06\Documents\Daubert\n8n-test-aislado\produccion\`): `build_prod_candidate.py`, `verificar_candidata.py`, `verificacion_candidata.txt`,
  `pagos_produccion_asignaciones_candidata.json` (candidata, inactiva, no importada), `prod_snapshot_origen.json` (PROD vivo en solo lectura).

## 6. Resultado del paso 0 (21/10/2026, solo lectura; no se aplicó ninguna migración)

- Respaldos: n8n OnChange `n8n_ON_CHANGE_20261021_161927.age` y PostgreSQL `daubert_global_DAILY_20261021_161958.age` (dump + esquema; `pg_restore -l` validado por el pipeline); SHA-256 verificado en ambos.
- Precheck 015 ejecutado con el usuario de respaldos (solo lectura): guardas OK; catálogo con 198 filas y 0 plantillas rechazables; línea base: 20 correos, 115 resultados, 145 borradores, 144 alias, 1 correo `PENDIENTE` (id 38, desde el 14/09/2026: atasco conocido, no es un proceso activo).
- Las 198 rutas del catálogo, expandidas con la fecha actual, son aceptadas por la política de zona (0 bloqueadas, 0 enlaces, 0 caracteres inválidos; todas las carpetas de proveedor existen).
- Solo `n8n_app` (y `postgres`) tienen INSERT en `correos/borradores/resultados`: evidencia de que la credencial de Pagos PROD usa `n8n_app`; falta confirmar el campo «User» en la ficha de la credencial.
- Correo histórico (sin archivos registrados) reprocesado en un PostgreSQL desechable: `EFECTOS_INCIERTOS` sin asignación → `LEGACY_SIN_ASIGNACION` → sigue por catálogo sin tomar el archivo; la misma respuesta en una ingesta inicial bloquea.

## 7. Migraciones 015–017 aplicadas en `daubert_global` (21/10/2026)

Aplicadas manualmente por el administrador (precheck → up → postcheck, una por una; 017 postcheck A OK y humo `CONFLICTO_IDENTIDAD / ARCHIVO_NO_REGISTRADO`).
Verificación posterior en solo lectura: 2 tablas nuevas vacías con 2 triggers de auditoría; 6 funciones `SECURITY DEFINER`; `n8n_app` con `EXECUTE` solo en registrar y consultar (4 funciones de `core` en total, antes 2) y sin permisos sobre las tablas;
`daubert_hub_app` con `SELECT` en archivos, `SELECT/INSERT/UPDATE` en asignaciones y `EXECUTE` en asignable, bloquear y reproceso; `PUBLIC` sin privilegios; ningún otro rol con `EXECUTE`;
datos operativos iguales a la línea base (20 correos, 115 resultados, 145 borradores, 144 alias, 198 filas de catálogo) y 63/63 ejecuciones de n8n en `success` en la última hora.
El Hub de este PR **no habilita nada por sí mismo**: las tres banderas `PAYMENT_FILE_ASSIGNMENTS_PROD_*` son `false` por defecto.
