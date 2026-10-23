# Caterpillar — Paquete y procedimiento de corte a PROD (016)

> **Estado: PREPARADO OFFLINE. NADA SE HA APLICADO A PRODUCCIÓN** (la única interacción con `daubert_global` fue una lectura de solo lectura, sección 2). Veredicto: **NO LISTO todavía** para solicitar la autorización del corte; la lógica está validada de punta a punta en TEST (incluida la regeneración comercial) y solo quedan los bloqueos reales de la sección 9: inventario de archivos pendientes y la compatibilidad final que se cierra con él. El respaldo de `daubert_global` y el ensayo completo 013 → 016/017 sobre una restauración real ya se hicieron (sección 12). Los exports vivos de n8n ya se reconciliaron (sección 11.1) y el candidato productivo se generó con el export real.
> Principio: **TEST es la fuente de verdad de la lógica; PROD es la fuente de verdad de los datos y del entorno.** No se copia ninguna tabla, snapshot, contador ni fixture de TEST. No se crea un sistema paralelo: se moderniza el proceso productivo existente (misma base, mismo n8n, mismo Hub).

## 1. Qué contiene el paquete (todo en el repositorio, sin aplicar)

| Pieza | Archivo | Para qué |
| --- | --- | --- |
| Migración 016 (precheck / up / postcheck / down) | `database/migrations/daubert_global/20261024_016_caterpillar_atomic_admission_prod.*.sql` | Columna de snapshot (014) + funciones protegidas (015) para `daubert_global`. **Generadas** por `scripts/generate-caterpillar-016-prod.cjs` a partir de los archivos validados en TEST; `--check` falla si alguien las edita a mano |
| Rol del worker | `…20261024_016_caterpillar_worker_role_prod.template.sql` | Crea `n8n_cat_prod` (contraseña por variable de `psql`, nunca en el repo) |
| Inspección de solo lectura | `…20261024_016_caterpillar_prod_inspection.readonly.sql` + `apps/api/scripts/caterpillar-016-prod-inspect.cjs` | Estado real de PROD antes y después del corte (25 consultas `SELECT`, sesión de solo lectura verificada) |
| Ensayo desechable | `scripts/rehearse-caterpillar-016.cjs` | Restaura un respaldo en una base temporal y ejecuta precheck → up → postcheck → down → up → postcheck → prueba funcional → bypass; luego elimina base y rol temporales |
| Regeneración comercial (017, dentro de 016) | `…20261024_017_caterpillar_regeneration_test.*` (TEST, validada) y su versión PROD dentro de 016 | Tabla de autorizaciones + función del Hub + reproceso con regeneración; ver sección 10 |
| Candidato n8n PROD | `n8n/workflows/remisiones-caterpillar/candidate-016-prod/` (`prepare-prod.cjs`, `caterpillar-prod-016.CANDIDATE.INACTIVE.json`) | Workflow productivo inactivo, sin `id`, sin secretos, con Schedule y Webhook deshabilitados |
| Pruebas | `apps/api/test/caterpillar-016-prod.spec.ts` (15) | Correspondencia migración ↔ workflow ↔ contrato del Hub |

### Decisión tomada: rol dedicado `n8n_cat_prod` (separado de `n8n_app`, compartido con Audi)
Hoy Caterpillar usa `n8n_app`, **compartido con Remisiones Audi** (ver [production-runbook](production-runbook.md)). La protección contra el bypass de 015 consiste en que el rol del worker de Caterpillar **no tenga EXECUTE** sobre las 5 funciones antiguas (`fn_crear_ejecucion_automatizacion`, `reservar_folios_para_ejecucion`, `fn_registrar_remision_generada`, `fn_finalizar_ejecucion_automatizacion`, `fn_registrar_fallo_ejecucion`). Eso no puede hacerse sobre `n8n_app` sin romper Audi. Por eso el paquete crea **un rol y una credencial n8n nuevos** solo para Caterpillar (`n8n_cat_prod`, credencial `Postgres produccion CAT (n8n_cat_prod)`); `n8n_app` y Audi no se tocan. Confirmado: ningún grant ni credencial del paquete menciona `n8n_app` (solo la inspección de solo lectura lo consulta), y los 7 nodos PostgreSQL del candidato usan `Postgres produccion CAT (n8n_cat_prod)`.

## 2. Estado real de PostgreSQL PROD (lectura 2026-10-23, solo lectura)

Obtenido con `caterpillar-016-prod-inspect.cjs --reuse-postgres-from-test-url`: la sesión se abre con `default_transaction_read_only=on`, el script verifica `current_database()='daubert_global'`, `transaction_read_only='on'` y el puerto 5432 antes de leer, y ejecuta solo los `SELECT` revisados (25 bloques, 0 errores). No se modificó nada.

| Tema | Resultado |
| --- | --- |
| Servidor | PostgreSQL 18.4, UTF8, collation `pg_unicode_fast` presente (requisito de 016 cumplido) |
| Estructura | Tablas requeridas presentes; **no existe** `core.documentos.caterpillar_admission` (016 la crea); ninguna función de 016 existe (sin colisión de nombres); el rol `n8n_cat_prod` no existe |
| Roles | `n8n_app` (LOGIN, no admin) ejecuta las 5 funciones antiguas y los resolvedores; `daubert_hub_app` no ejecuta ninguna; en el momento de la lectura solo había una sesión del Hub (el flujo n8n estaba en reposo) |
| Funciones antiguas | Las 5 existen (dueño `postgres`, `SECURITY DEFINER`). **Su código es idéntico al validado en TEST** (huella sin comentarios coincide en las 5). Tres difieren de TEST solo en comentarios, por eso el pin de 016 se calcula sin comentarios |
| Ejecuciones Caterpillar | 13, todas `COMPLETADA`; **0 `PROCESANDO`**, 0 `ERROR`, 0 reprocesos |
| Reservas | 13, todas `APLICADA` (50 folios); ninguna `RESERVADA` vieja |
| Series | `REMISION_CAT_P2`: siguiente folio **108** (23 remisiones `GENERADA`, 85–107). `REMISION_CAT_P5`: siguiente **134** (15 `GENERADA` 119–133 y 10 `CANCELADA` 128–137). `REMISION_CAT_P6`: siguiente **9** (2 `GENERADA`, 7–8) |
| Documentos | 118 documentos en total (huella de datos `775b62cfc7ca0c13c1030bd12c0e5b4c`, sin la columna nueva); 13 de Caterpillar, empresa **122**, todos con hash y **ninguno con nombre no verificable** |
| Integridad | Sin folios vivos duplicados ni reservas vivas solapadas; sin remisiones Caterpillar fuera de reserva; sin discrepancias en `COMPLETADA` |

**Discrepancia explicada (no la causa 016, no se corrige):** en P5 el contador (134) es menor que el mayor folio usado (137). Las ejecuciones 14 (128–131) y 22 (132–137) tienen todas sus remisiones `CANCELADA`; después del ajuste de folio, la ejecución 23 volvió a emitir 128–133. Es el mecanismo vigente (cancelación 013 + ajuste de folio): los números 134–137 siguen libres, de modo que el siguiente P5 emitirá 134 y repetirá números de remisiones canceladas. 016 no cambia el asignador (`reservar_folios_para_ejecucion`), así que este comportamiento se conserva.

**Hallazgo de negocio importante:** 2 de las 13 ejecuciones fueron **reemisiones por corrección** de un programa ya emitido: la 14 (mismo nombre `…PLANTA 5 260929 TEMPLATE`, contenido distinto de la 13) y la 23 (el mismo archivo de la 22, byte a byte, renombrado `…261020 CORREGIDO`, tras cancelar la 22). Con 016 el gate bloquea exactamente ese tipo de reingreso: para programas históricos responde `REVIEW` (`LEGACY_NAME_MATCH` / `LEGACY_FILE_MATCH`) y para programas emitidos con 016 que luego se cancelan, `BLOCK / REGENERATION_AUTHORIZATION_REQUIRED`; el reproceso del botón solo acepta padres `ERROR`/`CANCELADA` (una ejecución `COMPLETADA` cuyas remisiones se cancelaron no es elegible). Hoy no existe un camino autorizado de regeneración. Ver decisión en la sección 9.

El reporte completo (JSON, sin secretos) se generó en el scratchpad de la sesión y no se guarda en el repositorio porque contiene datos operativos. Para repetirlo, mismo comando:
```powershell
node apps\api\scripts\caterpillar-016-prod-inspect.cjs --reuse-postgres-from-test-url > prod-inspeccion.json
```
(o con `PROD_DATABASE_URL_READONLY` si se prefiere una cuenta de solo lectura con SELECT sobre las tablas indicadas; `daubert_docs_ro` hoy no las tiene).

## 3. Diferencias funcionales TEST / PROD

| COMPONENTE | TEST (validado) | PROD actual | CAMBIO NECESARIO | RIESGO |
| --- | --- | --- | --- | --- |
| Admisión / reserva | Gate atómico 015 (`ADMIT/BLOCK/REVIEW`, propietario = id de ejecución n8n) | Crear ejecución + reservar con funciones antiguas | Migración 016 + 6 nodos nuevos + `¿Puede emitir CAT?` | Alto valor / medio: es el cambio central; probado en TEST y ensayado |
| Snapshot V1 | Columna `core.documentos.caterpillar_admission` + `fn_guardar_snapshot_*` | No existe | 016 crea la columna (nullable, sin backfill) | Bajo: `ADD COLUMN` sin default |
| Manejo de errores | Finaliza `ERROR` (reserva `ABANDONADA`), solo propietario, solo fallo de PDF | `fn_fallo`: deja `PROCESANDO` | Nodos `Registrar fallo PG` / `Preparar error CAT` de FULL | Medio: es la corrección validada con el fallo real 204 |
| Respuesta de reproceso | `REPROCESS_CREATED / ALREADY_PROCESSING / ALREADY_REPROCESSED` + `409 ADMISSION_REJECTED` | Estados del contrato 12C | Nodos `Mapear…` y `Responder reproceso aceptado` de FULL | Bajo: probado contra el cliente real del Hub |
| Rol / credencial n8n | `n8n_cat_test` / `cat_test` | `n8n_app` / `Postgres produccion` (compartido) | `n8n_cat_prod` / credencial nueva en los 7 nodos PG | Medio: credencial nueva; Audi intacto |
| Funciones SQL | `*_caterpillar_test`, guard `daubert_hub_test` | Funciones antiguas | 016 las crea sin sufijo, guard `daubert_global` | Bajo: generadas, cuerpos idénticos salvo 3 sustituciones (probado) |
| Empresa origen | 1207 | 122 | Ninguno (se conserva 122 de PROD) | Bajo: probado que no queda 1207 |
| Detección y rutas | `00_ARCHIVOS A PROCESAR` + `Filtrar solo pruebas locales1` | Rutas reales de clientes, `PROCESOS_HABILITADOS_PROD` = P2/P5/P6, corte 22/09/2026 | Ninguno (nodos de PROD intactos, byte a byte) | Bajo |
| Sandbox de rutas / temp por ejecución / sin barrido HTML | Sí (aislamiento de TEST) | No | **No se traslada** (PROD conserva su comportamiento) | Bajo: eran protecciones de aislamiento de TEST, no lógica |
| Webhook y Header Auth | `cat-test-reprocess-015` | `cat-reprocess`, `Daubert Hub - n8n PROD` | Ninguno (se conserva PROD; candidato deshabilitado) | Bajo |
| Schedule | Deshabilitado | Cada 10 min | Candidato deshabilitado; se habilita en el paso 14 | — |
| Hub | `ADMISSION_REJECTED` → 409 | (verificar versión desplegada) | Desplegar antes del corte | Medio si se olvida: el Hub mostraría 502 ante un rechazo del gate |

Nodos de PROD que **no cambian**: todo lo demás (≈45): detección, filtros, lectura, catálogo, PDF, carpetas, `Detectar/Validar … reproceso`, `Resolver documento origen PG` (empresa 122), `Filtrar archivos nuevos` (corte 22/09), disparadores y webhook.

## 4. Compatibilidad histórica y riesgos

1. **Sin snapshots inventados.** Los documentos anteriores conservan `caterpillar_admission = NULL`. El gate los trata de forma conservadora: mismo nombre normalizado (`LEGACY_NAME_MATCH`) o mismo hash de archivo (`LEGACY_FILE_MATCH`) → `REVIEW` **sin folios**. Evita que un archivo ya emitido por el flujo anterior se emita de nuevo.
2. **Límite de la verificación histórica.** Un archivo ya emitido por el flujo anterior, re-subido con **otro nombre** y **sin hash** coincidente, no puede reconocerse como duplicado (el contenido histórico no se guardó). El gate lo informa como `legacy_unverified` (cantidad de documentos históricos sin snapshot de la empresa). Mitigación: revisar los `REVIEW` y el inventario de archivos pendientes antes del corte.
3. **Nombres históricos no verificables bloquean toda la empresa.** Si un documento histórico tiene un nombre con caracteres prohibidos o sin extensión Excel, el gate responde `HISTORY_UNAVAILABLE` (REVIEW) a **cualquier** programación nueva. Por eso el precheck lo rechaza y el postcheck lo repite con el helper exacto.
4. **Las ejecuciones históricas en ERROR/CANCELADA no se podrán reprocesar con el botón** (no tienen snapshot): el Hub mostrará el 409 `ADMISSION_REJECTED`. Es deliberado; regenerar histórico no está en alcance.
5. **Archivos pendientes en carpetas al momento del corte.** Los ya procesados por el flujo anterior darán `REVIEW` (no es un error). Los realmente nuevos se emitirán normalmente. Inventariarlos antes (paso 5.0.7).
6. **Funciones antiguas con definición distinta a la validada.** El precheck compara las 5 huellas (`md5` del código **sin comentarios** y con espacios colapsados) contra TEST y **aborta si difieren**. En PROD las 5 coinciden hoy (3 difieren de TEST solo en comentarios).
7. **Series y contadores.** 016 no toca `series_documentales`, `reservas_folios`, `remisiones` ni documentos (el ensayo compara huellas antes/después). Discrepancias entre contador y folios usados, si existen, las reporta la inspección; **no se corrigen en este corte**.
8. **Dos workflows activos a la vez.** Procesarían los mismos archivos: el workflow anterior se desactiva *antes* de la migración y no se reactiva mientras el nuevo esté publicado.
9. **Cancelaciones (013).** PROD ya tiene remisiones `CANCELADA` y folios reutilizados tras cancelar (sección 2). 016 no depende de 013 ni cambia el asignador, pero sí cambia lo que pasa al **reingresar** un programa cancelado (punto 10).
10. **Reemisión por corrección bloqueada (decisión pendiente).** El gate trata un mismo nombre, o un mismo archivo renombrado, como duplicado (`REVIEW`/`BLOCK`), y no existe regeneración autorizada. En PROD 2 de 13 ejecuciones fueron reemisiones de ese tipo (14 y 23). Tras el corte esas correcciones **no podrán hacerse como hasta hoy**.

## 5. Procedimiento de corte (futuro; requiere autorización explícita)

### 5.0 Antes de la ventana (sin cambios en PROD)
1. **Versión funcional confirmada:** commit local del paquete, `vitest test/caterpillar*` verde, `scripts/generate-caterpillar-016-prod.cjs --check` sin diferencias, ensayo `REHEARSAL_016_PASS` con un respaldo de TEST.
2. **Exports vivos de n8n** (UI → Download): el workflow PROD (`Remisiones CAT Produccion PG`, id `9Ngnrpi16b6GtOAX`) y el FULL que corre en TEST. Reconciliar con el repositorio antes de seguir:
   `node …\candidate-016-prod\prepare-prod.cjs compare-prod <prod-vivo.json>` y `… compare-full <full-vivo.json>`. Cualquier nodo distinto se revisa y se integra al generador.
3. **Inspección de solo lectura de PROD** (sección 2). Condiciones para continuar: 0 `PROCESANDO`; `legacy_function_pins` todas `matches_test_validated = true`; `new_object_name_collisions` vacío; `n8n_cat_prod` inexistente; sin folios duplicados ni solapados; `names_the_gate_cannot_verify = 0`; discrepancias de series explicadas.
4. **Respaldo y restauración comprobada:** `pg_dump -Fc daubert_global` fuera de Dropbox y de los worktrees, SHA-256, y restaurar en una base desechable. Ensayar 016 sobre esa copia: `node scripts\rehearse-caterpillar-016.cjs <respaldo-prod.dump>` (usa credenciales de TEST solo para crear/borrar la base y el rol temporales; no toca `daubert_global`).
5. **Regenerar el candidato desde el export vivo:** `node …\prepare-prod.cjs --prod-export <prod-vivo.json> --require-live` (falla si queda `<WINDOWS_USER>`). Revisar que ninguna ruta TEST aparezca (los tests ya lo vigilan para la versión del repositorio).
6. **Hub:** el Hub de PROD (contenedores `daubert-hub-api-1`/`daubert-hub-web-1`, commit `6370753`, v1.0.6) **no** incluye nada de esta rama (sección 13.3). Hay que integrar la rama a `main` (decisión y PR del responsable; un merge limpio con `origin/main` se comprobó en seco) y desplegarla con el procedimiento de [deployment-checklist](../../operations/deployment-checklist.md) (comandos manuales: el script bloquea los releases con migraciones). No requiere variables nuevas (`CATERPILLAR_REPROCESS_WEBHOOK_URL/TOKEN` ya existen). Solo `api` y `web`; no tocar PostgreSQL, n8n ni Pagos.
7. **Inventario de archivos y ejecuciones:** `node scripts\inventory-caterpillar-prod-files.cjs --db` (solo lectura) y la revisión de n8n de la sección 13.2. Resultado de referencia: sección 13.1.
8. **Confirmar con el operador:** credencial n8n nueva y su contraseña, ventana, responsable presente.

### 5.1 Ventana de corte (orden exacto)
0. **013 (cancelación formal) primero**, porque la regeneración se define sobre remisiones canceladas formalmente y PROD aún no la tiene: `20261020_013_caterpillar_cancellation.precheck.sql` → `.up.sql` → `.postcheck.sql` (ya contemplan `daubert_global` y `daubert_hub_app`). Se hace con el workflow anterior ya desactivado (paso 1) y sin ejecuciones en curso.
1. **Impedir nuevas entradas:** desactivar `Remisiones CAT Produccion PG` (apaga Schedule y webhook; durante la ventana el botón Reprocesar devolverá 502 por diseño). No tocar Audi, Pagos ni reiniciar n8n.
2. Confirmar **0 ejecuciones en curso** en n8n y **0 `PROCESANDO`** en `ops.ejecuciones_automatizacion` (Caterpillar).
3. Exportar y conservar el JSON del workflow anterior (rollback antes de emitir).
4. Crear el rol: `psql … -d daubert_global -v ON_ERROR_STOP=1 -v worker_password="$CAT_WORKER_PASSWORD" -f …worker_role_prod.template.sql`.
5. `…016….precheck.sql` → debe imprimir `PRECHECK_016_PASS` (guardar la huella de documentos).
6. `…016….up.sql` (una sola transacción; `lock_timeout 5s`; falla sin cambios).
7. `…016….postcheck.sql` → `POSTCHECK_016_PASS`. Repetir la inspección y comprobar `worker_effective_privileges`: `n8n_cat_prod` ejecuta solo las 6 entradas protegidas y los 2 resolvedores; `n8n_app` y `daubert_hub_app` no ejecutan ninguna función nueva; series, reservas y remisiones idénticas a las de 5.0.3.
8. En n8n crear la credencial `Postgres produccion CAT (n8n_cat_prod)` (host, `daubert_global`, usuario `n8n_cat_prod`) y probar la conexión.
9. Importar `caterpillar-prod-016.CANDIDATE.INACTIVE.json` como workflow **nuevo** (verificar otro id; el anterior no cambia). Asignar la credencial dedicada a los 7 nodos PostgreSQL y el Header Auth `Daubert Hub - n8n PROD` al webhook. Confirmar que el sticky note y los nodos no mencionan rutas de prueba.
10. Validar nodos y llamadas SQL (sin ejecutar): cada consulta apunta a `*_caterpillar` o a los 2 resolvedores; ninguna a funciones antiguas.
11. **Primera emisión real controlada, sin documentos ficticios** (sección 13.5): con el Schedule aún deshabilitado, esperar a que llegue una programación **real** de una planta habilitada (P2, P5 o P6) y ejecutar el workflow nuevo **manualmente** con el operador presente. Verificar con la inspección: snapshot guardado, ejecución `COMPLETADA`, reserva `APLICADA` = remisiones `GENERADA`, PDFs en la carpeta productiva, folios contiguos desde el `siguiente_folio` registrado, ningún duplicado. Un segundo run inmediato debe dar `BLOCK PROGRAM_ALREADY_EMITTED` sin folios.
12. Si algo falla: sección 6; **no** continuar.
13. Habilitar el webhook (`Webhook Reproceso CAT (PROD)`) y publicar el workflow nuevo. Probar el botón Reprocesar con una ejecución COMPLETADA (debe responder 409 `NOT_ELIGIBLE_STATE`, sin crear nada).
14. Habilitar el Schedule (cada 10 min) solo cuando 11 y 13 estén verificados.
15. El workflow anterior queda desactivado y conservado (no se elimina durante la estabilización).

### 5.2 Después del corte
Inspección diaria durante la primera semana (`caterpillar-016-prod-inspect.cjs`): sin `PROCESANDO` viejas, `completed_reservation_mismatch` vacío, `series_gaps_and_overlaps` sin filas, `counter_minus_highest_used = 0`.

## 6. Recuperación

Regla de oro: **no restaurar el respaldo ni reiniciar contadores después de emitir remisiones nuevas** (perdería registros y la correspondencia de folios). Nada de lo anterior toca las funciones antiguas ni `n8n_app`, por eso el flujo anterior sigue siendo viable mientras no haya evidencia nueva.

| Falla | Qué hacer |
| --- | --- |
| Rol / precheck / up | Nada se aplicó (transacción). Corregir la causa y repetir. `PROCESANDO` presente → esperar o conciliar primero (runbook 015, sección 6); huella de función distinta → revisión humana |
| Postcheck | `…016….down.sql` (permitido: aún no hay snapshots) y volver a reactivar el workflow anterior |
| Importación n8n | Eliminar el workflow importado (inactivo); la base queda lista; el anterior puede reactivarse |
| **Antes de la primera emisión** (sin snapshot ni ejecución nueva) | Desactivar el nuevo, `…016….down.sql`, reactivar el anterior. `down` **se niega** si existe cualquier snapshot |
| **Después** de emitir | Solo corrección hacia adelante: el candidato y el esquema se quedan; se corrige la causa. Reactivar el flujo anterior sería posible técnicamente, pero perdería la prevención de duplicados por snapshot de lo ya emitido; solo con decisión explícita |
| Snapshot (`CONFLICT`, `HISTORICAL_LOCKED`, error SQL) | Aborta antes de crear ejecución: sin folios. Revisar el archivo/documento |
| Admisión (`BLOCK` / `REVIEW`) | Sin folios; es el resultado esperado de duplicados o históricos. Revisión humana |
| Reserva hecha y falla el PDF | Rama de error: ejecución `ERROR`, reserva `ABANDONADA` (folios consumidos, no reutilizables). Reprocesar con el botón (folios nuevos) |
| Fallo entre registro y finalización | Ejecución puede quedar `PROCESANDO` con dueño caído: conciliación manual y registrada con las funciones protegidas (runbook 015, sección 6); nunca editar folios ni contadores |
| Regeneración: autorización registrada pero n8n no respondió | Seguro reintentar el mismo botón: la autorización es única (`ALREADY_AUTHORIZED`) y el webhook es idempotente (`ALREADY_PROCESSING` / `ALREADY_REGENERATED`) |
| Regeneración fallida (la ejecución nueva queda `ERROR`) | Reproceso técnico normal sobre la ejecución nueva (folios nuevos; la original cancelada ya no bloquea). No se crea otra autorización |
| Reproceso | `409 ADMISSION_REJECTED` = regla de negocio (remisiones vigentes, sin snapshot, conflicto); `502/504` = técnico: consultar la ejecución antes de reintentar (idempotente: `ALREADY_REPROCESSED`) |

## 7. Cambios en Daubert Hub

No hay cambios de código pendientes para PROD más allá de lo ya versionado: el Hub lee ejecuciones/remisiones de tablas que no cambian; el rechazo del gate (`ADMISSION_REJECTED` → 409) ya está en la API; la UI distingue solicitud aceptada (202 `REPROCESS_CREATED`) de ejecución `COMPLETADA` (aparece como hija en la lista). Se conservan ADMIN/GENERAL. **Acciones de despliegue:** publicar esa versión *antes* del corte y fijar `CATERPILLAR_REPROCESS_WEBHOOK_URL` (`…/webhook/cat-reprocess`) y el token del Header Auth `Daubert Hub - n8n PROD`.
Nota de mantenimiento: `CaterpillarExecutionsRepository.claimAdmissionAndReserve / claimReprocessAndReserve / findAdmissionSnapshot / storeAdmissionSnapshot` están preparados solo para TEST (nombres `_test`, guard `daubert_hub_test`) y ningún controlador los llama; no se usan en PROD y no deben cablearse sin adaptarlos.

## 8. Pruebas ejecutadas (todas offline, sin consumir folios de PROD)

- `caterpillar-016-prod.spec.ts` (15): archivos de migración = lo generado desde TEST (sin ediciones manuales); sin tokens TEST; cuerpos de funciones idénticos a TEST salvo 3 sustituciones; huellas `md5` de postcheck/down recomputadas y las 5 de las funciones antiguas; sin DML fuera de funciones; sin GRANT de funciones antiguas; candidato regenerable, inactivo y sin `id`; nodos de entorno idénticos a PROD; gating P2/P5/P6 y corte 22/09 conservados; sin rutas, credenciales, sandbox, fallo provocado ni funciones `_test`; credencial dedicada en los PG; llamadas SQL ↔ firmas creadas por 016 (tipos y cantidad); topología sin aristas colgantes; respuesta aceptada por el cliente real del Hub; inspección solo-lectura; plantilla de rol sin secretos ni privilegios.
- Ensayo `rehearse-caterpillar-016.cjs` sobre una restauración del respaldo pre-015 de TEST: precheck, up, postcheck, down, re-aplicación, historial/series/contadores intactos, snapshot, gate, segundo worker rechazado, propietario, error → reserva `ABANDONADA`, reproceso con folios **nuevos**, segundo reproceso sin emitir, bypass de funciones antiguas y DML directo denegados. `REHEARSAL_016_PASS` (16 comprobaciones); base y rol temporales eliminados.
- Las 25 consultas de inspección se ejecutaron contra TEST (`--self-test`) para validar que corren.

## 9. Bloqueos reales pendientes

Cerrado y verificado (ya no son bloqueos): lectura de solo lectura de `daubert_global`; decisión del rol dedicado `n8n_cat_prod`; opción B (regeneración comercial) implementada y probada de punta a punta en TEST (sección 10 y runbook de integración, sección 14: ejecuciones **237 → 238**); **013 es prerrequisito y PROD cumple lo que 013 exige** (rol Hub `daubert_hub_app` sin escritura sobre remisiones ni CREATE, con USAGE; trigger de `updated_at` activo; columnas de `security.users` correctas; 4 usuarios ADMIN utilizables).

Pendiente, con la acción exacta:
1. ~~Exports vivos de n8n~~ **Hecho** (2026-10-23): reconciliados en la sección 11.1; el candidato se regeneró con el export real de PROD (`--require-live`, 0 marcadores).
2. ~~Respaldo de `daubert_global` restaurable y ensayo~~ **Hecho** (2026-10-23, sección 12). Se repite el respaldo y el ensayo justo antes de la ventana para validar el estado vigente.
3. ~~Inventario de archivos pendientes y de ejecuciones en curso~~ **Hecho** (2026-10-23, sección 13): 0 archivos pendientes, 0 ejecuciones en curso, 0 sesiones bloqueantes.
4. **Nuevos bloqueos reales** (sección 13.4):
   - **B1 — el candidato no tolera releer los 11 archivos ya emitidos**: devuelve `HISTORICAL_LOCKED` y `Verificar snapshot CAT` lanza error, así que cada ciclo fallaría antes de llegar a un archivo nuevo. Requiere un ajuste del flujo y de su prueba antes de pedir autorización.
   - **B2 — el Hub de PROD (`6370753`) no tiene la rama**: ni `ADMISSION_REJECTED`, ni cancelación formal, ni regeneración, ni botón. Requiere integrar a `main` y desplegar (decisión del responsable).
   - **B3 — decisión del responsable de Pagos/Audi y de n8n**: confirmar que `Generación PDFs` y `Generación Hojas Identificación` no leen las carpetas Caterpillar (no se pudo comprobar sin la interfaz de n8n).
5. Lo que solo puede verificarse con escritura (primera emisión real con el candidato, PDFs, reproceso y regeneración por botón en PROD, ciclo programado) queda para la ventana de corte, paso 11 de la sección 5.1.

## 10. Regeneración comercial (decisión B) — diseño, casos históricos, validación y efecto en el corte

### 10.1 Los dos casos históricos de PROD (lectura de solo lectura; nada se modificó)
| | Caso 1: ejecuciones 13 → 14 (P5) | Caso 2: ejecuciones 22 → 23 (P5) |
| --- | --- | --- |
| Qué ocurrió | El 29/09 se emitió `…260929 TEMPLATE` (ej. 13, folios 124–127). El 01/10 el **mismo nombre** con contenido distinto (hash distinto) se procesó otra vez (ej. 14, folios 128–131, mismos 4 artículos): una **duplicidad**, no una corrección | El 20/10 `…261020 TEMPLATE` (ej. 22, folios 132–137, 6 remisiones). Tras la incidencia se reingresó el **mismo archivo, byte a byte, renombrado** `…261020 CORREGIDO` (ej. 23, folios 128–133) |
| Cancelaciones | 128–131 (ej. 14) canceladas el 20/10 20:26:56 con el motivo «Generación incorrecta por duplicidad P5. Incidencia 20/10/2026.»; las remisiones de la ej. 13 siguen vigentes | 132–137 (ej. 22) canceladas en el mismo instante y con el mismo motivo |
| ¿Cancelación formal? | **No.** Un único `UPDATE` masivo (misma marca de tiempo en las 10 filas) sobre `remisiones.estatus/motivo_cancelacion`. `operacion.cancelaciones_remisiones` y `fn_cancelar_remision_caterpillar` **no existen en PROD** (013 sin aplicar): no hay quién autorizó ni cuándo | Igual |
| Cómo se corrigió | Se canceló; el contador se rebobinó con un ajuste de serie (`operacion.ajustes_series`, mínimo ajustable 119) | Se reutilizaron los folios 128–133: la ej. 23 reservó el 20/10 20:32 (después de cancelar 20:26) |
| Relación con lo nuevo | Remisiones originales (14) y nuevas (23) se relacionan **solo por número de folio repetido** y por el motivo textual; no hay vínculo `reproceso_de_id` ni autorización | Igual (ej. 23 no referencia a 22 ni a 14) |

**Conclusión y decisión manual necesaria.** Las ejecuciones 14 y 22 son históricas (sin snapshot) y se cancelaron sin registro formal, así que **no son elegibles** para regeneración: ni se inventan registros de cancelación ni se autoriza nada automáticamente. Además ya fueron "corregidas" a mano por la ej. 23, por lo que regenerarlas otra vez duplicaría la emisión. Si el negocio necesitara algo sobre ellas, es una decisión manual fuera del Hub. El Hub lo muestra: «No se puede regenerar desde el Hub…» (`NO_SNAPSHOT` / `CANCELLATION_NOT_FORMAL`).

### 10.2 Diseño mínimo (reutiliza lo existente; 1 tabla nueva, 1 función nueva, 1 endpoint)
- **Cancelación**: se reutiliza tal cual la formal de 013 (`fn_cancelar_remision_caterpillar`, botón del Hub, ledger con actor y motivo). No hay otro sistema de cancelación.
- **Autorización** (ADMIN, única y trazable): `operacion.autorizaciones_regeneracion_caterpillar` (una fila por ejecución original: motivo, usuario/correo/nombre, fecha, request id y la ejecución nueva que la consumió) + `operacion.fn_autorizar_regeneracion_caterpillar` (solo el rol del Hub; `SECURITY DEFINER`). Exige: ADMIN activo, ejecución `COMPLETADA`, **con snapshot**, remisiones ≥ 1 y **todas canceladas formalmente (con registro en el ledger)**, sin hijo. Es idempotente (`ALREADY_AUTHORIZED`). Nadie escribe la tabla directamente.
- **Ejecución**: se reutiliza el gate de reproceso (`fn_reprocesar_reservar_*`, mismo permiso del worker, misma admisión atómica, snapshot, conflictos y reserva de folios nuevos). Cambio mínimo en esa función: un padre `COMPLETADA` se acepta **solo si existe la autorización** y sus remisiones siguen todas canceladas; las reglas ERROR/CANCELADA no cambian. Sin autorización el resultado sigue siendo `PARENT_NOT_REPROCESSABLE`. La autorización queda consumida por el único hijo (`uq_ejecuciones_automatizacion_reproceso_unico` + `UNIQUE` en la tabla). Una regeneración fallida (`ERROR`) se recupera con el reproceso técnico normal (la original cancelada ya no bloquea el programa).
- **Recargar o modificar el Excel no regenera nada**: el gate sigue respondiendo `BLOCK / REGENERATION_AUTHORIZATION_REQUIRED` (mismo nombre) o `REVIEW / MANIFEST_MATCH_REVIEW` (copia renombrada); y la regeneración autorizada vuelve a leer el archivo y exige que su snapshot coincida (`ALREADY_STORED`), de lo contrario `CONFLICT` aborta antes de reservar.
- **Sin bypass desde n8n**: el worker no puede ejecutar la función de autorización ni leer/escribir la tabla; solo puede pedir el gate, que exige la autorización registrada por un ADMIN.
- **Hub/n8n**: endpoint propio `POST …/executions/:id/regenerate` (ADMIN) con estados propios (`REGENERATION_STARTED`, `ALREADY_PROCESSING`, `ALREADY_REGENERATED`); primero registra la autorización en PostgreSQL y luego llama al **mismo webhook** con `kind: "REGENERATION"` (solo cambia la elegibilidad del nodo de entrada: COMPLETADA en lugar de ERROR/CANCELADA). El botón **Reprocesar** no cambia; **Regenerar** es otra acción, otro diálogo y otros mensajes, y solo aparece cuando la API informa `regeneration.eligible`. 202 significa «iniciada», nunca «completada».

### 10.3 Validación real en `daubert_hub_test`
- Migración `20261024_017_caterpillar_regeneration_test`: precheck, up y postcheck aplicados (`PRECHECK_017_PASS`, `POSTCHECK_017_PASS`); 015 sin regresión (`TEST_015_REAL_PASS`).
- `apps/api/test/caterpillar-017-real.test-runner.cjs`: **`TEST_017_REAL_PASS`, 54 comprobaciones** (fase A en ROLLBACK + fase B con dos backends y fixtures `HUB_TEST_017_*`). Cubre: ejecución completada, cancelación formal (parcial no basta), motivo obligatorio, actor no ADMIN, histórico sin snapshot, autorización idempotente, Hub/worker sin escritura directa, gate sin autorización, ejecución nueva con folios nuevos y propietario, consumo único, segundo worker, reintento, original y remisiones canceladas intactas, Excel modificado o renombrado bloqueado, recuperación de una regeneración fallida, y defensa en profundidad. **Carreras reales**: dos autorizaciones simultáneas → una sola fila; dos workers simultáneos → un hijo, una reserva.
- Hub: servicio, controlador, cliente del webhook, diálogo y página con pruebas (API 590+, web 87 archivos / 1223+ pruebas, `tsc` y `eslint` limpios).
- **Pendiente (lo ejecuta el operador en n8n TEST)**: actualizar los dos nodos de entrada del FULL (instrucciones en la sección 13 del runbook de integración) y repetir el ciclo completo con PDFs reales: cancelar las remisiones de una ejecución con el botón de cancelación, pulsar **Regenerar**, verificar la ejecución nueva y sus folios.

### 10.4 Efecto sobre el corte productivo
1. **013 es ahora prerrequisito** y aún no está en PROD: hay que aplicar `20261020_013_caterpillar_cancellation.{precheck,up,postcheck}` (ya preparada para `daubert_global` / `daubert_hub_app`) **antes** de 016. Sin 013 no hay cancelación formal y el Hub muestra la regeneración como no disponible.
2. 016 (generada) ya incluye 017: tabla, función del Hub, reproceso con regeneración y ACLs (`daubert_hub_app` ejecuta solo la autorización y lee la tabla). El precheck falla si falta 013; el postcheck verifica huellas, ACL y unicidad.
3. Los nodos `Normalizar y validar entrada reproceso CAT` y `Validar elegibilidad reproceso CAT` del candidato PROD conservan el código de PROD más la edición mínima compartida con TEST (`regeneration-entry.cjs`).
4. Hub: se despliega primero (incluye `ADMISSION_REJECTED`, el endpoint y la UI; es tolerante a bases sin 013/017).
5. Operación: tras el corte, la corrección de una programación emitida por 016 es: cancelar remisiones (Hub) → **Regenerar** (Hub, ADMIN, motivo) → verificar la ejecución nueva. Las programaciones históricas siguen necesitando decisión manual.

## 11. Procedimiento para obtener los exports vivos (solo lectura sobre n8n; no se activa ni edita nada)

Carpeta de destino sugerida (fuera del repositorio y de Dropbox): `C:\Users\06\Documents\Daubert\exports-n8n\`. El botón *Download* de n8n exporta el JSON del workflow **sin secretos** (solo nombres/ids de credenciales); aun así, no lo subas a ningún servicio externo.

1. **FULL TEST**: en `http://localhost:5678` abre el workflow `Caterpillar TEST 015 — FULL (INACTIVE, staged)` → menú **⋯** (arriba a la derecha) → **Download** → guarda como `full-test-AAAAMMDD.json`. No lo ejecutes ni lo publiques.
2. **PROD**: abre `Remisiones CAT Produccion PG` (id `9Ngnrpi16b6GtOAX`) → **⋯** → **Download** → `prod-AAAAMMDD.json`. Solo descarga; no lo desactives, no lo edites y no ejecutes nada.
3. En PowerShell, desde la raíz del worktree:
   ```powershell
   cd n8n\workflows\remisiones-caterpillar\candidate-016-prod
   node prepare-prod.cjs compare-full C:\Users\06\Documents\Daubert\exports-n8n\full-test-AAAAMMDD.json
   node prepare-prod.cjs compare-prod C:\Users\06\Documents\Daubert\exports-n8n\prod-AAAAMMDD.json
   ```
   - `compare-full` debe listar como diferencias solo cosas de entorno de importación (ids, posiciones no cuentan: compara los parámetros de cada nodo). Cualquier nodo de lógica distinto (los 10 de lógica, los 6 nuevos y los 2 de entrada) significa que el FULL vivo tiene una edición manual que falta en el repositorio: se me comparte el nombre del nodo y se reconcilia antes de seguir.
   - `compare-prod` compara un export vivo nuevo con la referencia vivo guardada (`prod/workflow.live-20261023.json`): parámetros, conexiones, nombres de credencial y banderas. Los nodos distintos son deriva de PROD posterior y deben revisarse; la comparación distingue lo cosmético (reescritura del editor) de lo real.
4. Con ambos reconciliados: `node prepare-prod.cjs --prod-export C:\Users\06\Documents\Daubert\exports-n8n\prod-AAAAMMDD.json --require-live` genera el candidato productivo real (falla si queda algún `<WINDOWS_USER>`). Ese archivo se revisa y **no** se importa hasta la ventana de corte.

### 11.1 Resultado de la reconciliación de los exports vivos (2026-10-23)
Exports: `full-test-20261023.json` (FULL TEST, 61 nodos, inactivo) y `prod-20261023.json` (`Remisiones CAT Produccion PG`, 58 nodos, activo). Se compararon parámetros, **conexiones**, nombres de credencial y banderas (`prepare-prod.cjs compare-full|compare-prod`; la comparación ahora clasifica lo cosmético).

**FULL TEST — 5 nodos con "parameters differ": ninguno es funcional.** Conexiones idénticas; mismos 61 nodos.
| Nodo | Diferencia | Clasificación | Se conserva |
| --- | --- | --- | --- |
| `Reservar folios PG` | El editor guardó la consulta como `{{ … }}` sin el `=` inicial | Cosmético: misma expresión (gate de admisión o de reproceso) y mismas funciones | Repositorio (`={{ … }}`, forma estándar; las ejecuciones 193/194 corrieron con ella) |
| `¿Puede emitir CAT?` y `¿Ejecución propia confirmada?` | El editor agregó `options: {}` | Cosmético | Repositorio (condiciones idénticas) |
| `Registrar fallo PG` | Consulta reformateada en varias líneas | Cosmético: misma `fn_finalizar_caterpillar_test(…, 'ERROR', …)` y mismas columnas (cierre terminal y titularidad del worker intactos) | Repositorio |
| `Validar elegibilidad reproceso CAT` | Mi comentario quitado y el ternario en varias líneas | Cosmético: misma regla (regeneración solo desde `COMPLETADA`; reproceso técnico solo `ERROR`/`CANCELADA`) | Repositorio |

Además, y solo como **entorno de TEST**: el webhook del FULL vivo tiene asignado el Header Auth `Daubert Hub - n8n TEST` y está habilitado (el repositorio lo deja deshabilitado y sin credencial); el disparador manual figura sin la bandera `disabled`. Nada de esto pasa al candidato productivo. Resultado: **el FULL vivo y el del repositorio son funcionalmente idénticos**; la lógica validada (gate, titularidad, cierre en ERROR, regeneración 017) no necesita cambios.

**PROD — 5 nodos con "parameters differ": falso positivo del comparador.** El saneador del usuario de Windows de `prepare-prod.cjs` tenía un error (la clase de caracteres consumía el resto de la ruta) y recortaba `Detectar archivos CAT1`, `Registrar log error CAT`, `Preparar archivo CAT`, `Validar elegibilidad reproceso CAT` y `Detectar archivo REPROCESS CAT1`. Corregido y, mejor aún, eliminado: **el export vivo de PROD se guarda ahora en el repositorio** (`n8n/workflows/remisiones-caterpillar/prod/workflow.live-20261023.json`, sin metadatos de instancia) y es la base del candidato. Comparado con la copia saneada anterior: **0 diferencias** en parámetros, conexiones, nombres de credencial y banderas; solo cambian los ids de credencial (el export vivo los incluye) y el usuario de Windows real en las rutas.

**Qué se conservó de PROD en el candidato** (byte a byte): rutas reales de cliente (`CLIENTES\\…\\SOLICITUD DE MATERIAL`) y carpeta de herramientas (`HERRAMIENTAS AUTOMATIZACION\\REMISIONES CAT`), detección, `PROCESOS_HABILITADOS_PROD` (P2, P5, P6), corte 22/09/2026, empresa 122, log de errores, preparación de archivo, validación de elegibilidad con la tabla de rutas productivas (más únicamente la edición compartida de regeneración), schedule (10 min) y webhook `cat-reprocess` con el Header Auth `Daubert Hub - n8n PROD` (referencia por id al credencial existente; no hay secretos).

**Candidato regenerado** (`candidate-016-prod/caterpillar-prod-016.CANDIDATE.INACTIVE.json`, 60 nodos): lógica de TEST (gate, snapshot, titularidad, cierre terminal en ERROR, respuesta `REPROCESS_CREATED`, regeneración) + entorno de PROD; 7 nodos PostgreSQL con `Postgres produccion CAT (n8n_cat_prod)`; funciones `*_caterpillar` de 016/017 y los dos resolvedores; sin `id` de workflow ni `webhookId`; `active=false`, Schedule y Webhook deshabilitados; sin rutas, credenciales ni funciones de TEST. Nada se importó ni se ejecutó en n8n.

## 12. Respaldo restaurable y ensayo 013 → 016/017 sobre una copia real de PROD (2026-10-23)

**Respaldo** (`scripts/backup-caterpillar-prod-db.cjs`, solo lectura: `pg_dump` toma una instantánea consistente con bloqueos ACCESS SHARE; no interrumpe n8n ni el Hub):
- Archivo: `C:\Users\06\Documents\Daubert\respaldos-postgres-prod\daubert_global_pre_caterpillar_016_20261023_220606.dump` (fuera del repositorio y de Dropbox; ignorado por Git por estar fuera del árbol).
- Tamaño: **291 072 bytes** (base de 13 MB; 390 entradas de catálogo). SHA-256: **`CA8A82AAEC4B89D0595C20CC675732C27D6B2A6C90CDE0687EAE48F8F28C6E26`**. Servidor y herramientas: PostgreSQL **18.4** (`pg_dump`/`pg_restore`/`initdb` 18.4). `pg_restore --list` lo lee, y además se **restauró de verdad** (abajo). Espacio: 251 GB libres.

**Restauración real, aislada** (`scripts/rehearse-caterpillar-prod-copy.cjs`): inicia un PostgreSQL 18 propio (carpeta nueva en `ensayo-postgres-prod\<fecha_hora>\data`, solo loopback `127.0.0.1:55432`, sin contraseñas guardadas), crea los **nombres** de rol de producción (sin contraseñas, con sus límites de conexión y la única membresía que PROD tiene, `daubert_backup` ∈ `pg_read_all_data`, que es estado de clúster y no viaja en el respaldo) y una base **vacía** llamada `daubert_global` con la localización de producción (`Spanish_Spain.1252`); `pg_restore --exit-on-error` termina sin errores con propietarios y ACL conservados. Nunca se conecta al servidor operativo ni a `daubert_hub_test`; solo detiene **su** instancia y no borra nada (las carpetas del ensayo se conservan). Como en la ventana real, los archivos de migración se ejecutan **sin modificar** (la base se llama de verdad `daubert_global`).

**Resultado: `PROD_COPY_REHEARSAL_PASS`, 52 comprobaciones.**
| Área | Resultado |
| --- | --- |
| Estado restaurado | 24 ejecuciones (13 Caterpillar `COMPLETADA`, 0 `PROCESANDO`), 64 remisiones, 13 reservas, series P2/P5/P6 siguientes **108 / 134 / 9** idénticas al respaldo, huellas por tabla registradas; las 5 funciones antiguas coinciden con las validadas |
| 013 | precheck, up y postcheck pasan sobre datos reales; no cambia ninguna tabla histórica ni contador; el Hub gana solo la función de cancelación y lectura del ledger; `n8n_app` queda exacto |
| Rol | La plantilla crea `n8n_cat_prod` (sin EXECUTE legado ni privilegios de tabla) |
| 016/017 | precheck (`PRECHECK_016_PASS`), up y postcheck (`POSTCHECK_016_PASS`) pasan; historia y contadores idénticos; **0 snapshots históricos inventados**; siguientes folios idénticos; sin ejecuciones, reservas ni remisiones nuevas |
| Privilegios | `n8n_cat_prod` ejecuta **exactamente** las 6 entradas protegidas + los 2 resolvedores (8 funciones) y no tiene ningún privilegio de tabla; `n8n_app` (Audi) conserva todos sus privilegios y no gana ninguno; el Hub gana solo `fn_autorizar_regeneracion_caterpillar` y lectura de la tabla de autorizaciones; ningún otro rol ni PUBLIC ejecuta las funciones nuevas (PUBLIC solo conserva dos funciones de trigger preexistentes) |
| Bypass | El worker no puede ejecutar ninguna función antigua, ni hacer DML directo, ni autorizar; `n8n_app` sí conserva las funciones antiguas (Audi) |
| Contratos del candidato | Las 8 sentencias SQL de los nodos PostgreSQL del candidato PROD se `PREPARE`n como `n8n_cat_prod` contra la copia migrada |
| Históricos | Un reingreso como el 13→14 (mismo nombre, otro contenido) → `REVIEW / LEGACY_NAME_MATCH`; como el 22→23 (mismos bytes, renombrado) → `REVIEW / LEGACY_FILE_MATCH`; ambos **sin folios**. Las ejecuciones 14, 22 y 23 **no se pueden reprocesar** (sin snapshot) y la regeneración de la 14 y la 22 **no es autorizable** (cancelación informal y sin snapshot). Un programa realmente nuevo se admite y reserva exactamente el folio 108 de P2. Ningún registro histórico se modificó (el humo no dejó rastro: huellas idénticas) |
| Rollback antes de emitir | `016 down` deja el estado de 013; `013 down` (ledger vacío) devuelve la base **exactamente** al respaldo (historia, contadores, privilegios del Hub y de Audi); 013 y 016 se vuelven a aplicar sin problema |
| Rollback después de emitir | Tras una emisión (snapshot + remisión + `COMPLETADA`), `016 down` **se niega** (`rollback refused`); no pierde datos ni toca el contador (P2 avanzó exactamente un folio: 108 → 109) |

**Problemas detectados durante el ensayo** (ninguno estaba en las migraciones):
1. Del script: una transacción de lectura de mi inspección quedaba abierta y bloqueaba el `ALTER TABLE` de 016 (`lock timeout`); corregido. Es útil como recordatorio operativo: **la ventana real no debe tener sesiones propias abiertas sobre las tablas**; `lock_timeout=5s` hace que 016 falle limpio, sin cambios, si hay una.
2. El estado de clúster no viaja en el respaldo: sin `daubert_backup` ∈ `pg_read_all_data`, el postcheck de 013 (`backup role policy drift`) falla. En PROD esa membresía **existe** (se verificó en solo lectura); en una restauración nueva hay que reproducirla.
3. `pg_ctl start` con la salida capturada bloqueaba el script; corregido.

**Recuperación** (confirmada con el ensayo):
- *Falla antes de emitir remisiones nuevas* (precheck/up/postcheck de 013 o 016, importación, o antes de la primera emisión): cada migración es una transacción y falla sin cambios; si ya se aplicó, `016 down` y luego `013 down` devuelven la base al estado original y se reactiva el workflow anterior (que sigue usando `n8n_app` y las funciones antiguas, intactas).
- *Falla después de emitir remisiones nuevas*: **no** se restaura el respaldo (perdería registros y rompería la secuencia documental) y **no** se reinician contadores. `016 down` se niega mientras exista un snapshot o evidencia de ejecución; `013 down` se niega con historial de cancelaciones y las autorizaciones de regeneración también bloquean el retroceso. Solo corrección hacia adelante: reproceso técnico o regeneración autorizada desde el Hub, y conciliación manual con las funciones protegidas (runbook 015, sección 6).
- Qué cubre el rollback: 016 (columna de snapshot, funciones `*_caterpillar`, tabla de autorizaciones y ACL) y 013 (ledger y función de cancelación); el rol `n8n_cat_prod` y su credencial no se eliminan automáticamente (decisión manual).

**Repetir el ensayo**: `node scripts\rehearse-caterpillar-prod-copy.cjs <respaldo.dump>` (cada corrida usa una carpeta nueva con marca de tiempo; limpiar carpetas viejas es una decisión manual y explícita).

## 13. Inventario operativo, compatibilidad del Hub y preparación de la ventana (2026-10-23, solo lectura)

Todo se obtuvo sin escribir en PostgreSQL PROD, n8n, Dropbox ni el Hub: lectura de carpetas (`scripts/inventory-caterpillar-prod-files.cjs`, hash SHA-256 por lectura), una transacción `READ ONLY` con `ROLLBACK`, el registro de eventos de texto de n8n (`n8nEventLog.log`; no se abrió su base SQLite ni su API) y `docker inspect`/`grep` sobre los contenedores del Hub.

### 13.1 Archivos (detector real de `Remisiones CAT Produccion PG`)
El detector solo mira `PROGRAMACION DE ENTREGA` `.xls*` en: P2 (`…\CATERPILLAR MEXICO - P2\SOLICITUD DE MATERIAL`), P3-P6 (`…\MAS INFORMACION\SOLICITUD DE MATERIAL\<año>`), Nuevo Laredo, Torreón y la carpeta legacy; procesa solo P2, P5 y P6 con fecha de modificación ≥ 22/09/2026 (`PROCESOS_HABILITADOS_PROD`). Las carpetas `00_ARCHIVOS A PROCESAR` y `04_ERRORES` **no existen** (la primera está desactivada en PROD; la segunda se crea al primer error) y `06_ARCHIVOS TEMPORALES` está vacía; `01_ENTRADA` guarda 154 copias de archivos ya leídos (histórico, no pendiente).

| Planta | Antes del corte (histórico) | Candidatos del detector (≥ 22/09) | Pendientes (sin documento/ejecución en PG) |
| --- | --- | --- | --- |
| P2 | 27 | 6 (25/09, 02/10, 09/10, 12/10, 16/10, 23/10) | **0** |
| P5 | 17 | 3 (22/09, 29/09, 20/10 `CORREGIDO`) | **0** |
| P6 | 6 | 2 (22/09, 06/10) | **0** |
| No habilitadas (Nuevo Laredo 52, Torreón 12, legacy 1) | — | no se procesan | — |

Los 11 candidatos coinciden por **hash** con un documento con ejecución `COMPLETADA` (P2: 12, 15, 18, 19, 21, 24; P5: 10, 14, 22 y 23; P6: 11, 17). No hay duplicados por contenido dentro de las carpetas. El P5 `260929` en disco es la versión de 683 (ejecución 14), la anterior 431 (ejecución 13) ya no está; el P5 `261020 CORREGIDO` tiene los mismos bytes que `TEMPLATE` (ejecuciones 22 y 23), y `TEMPLATE` ya no está. **Lo pendiente hoy es nada; lo histórico son 11 archivos que el detector sigue releyendo en cada ciclo.** Ningún archivo `~$`.

### 13.2 n8n PROD (solo lectura; faltan 3 comprobaciones de interfaz)
- `Remisiones CAT Produccion PG` (`9Ngnrpi16b6GtOAX`): **activo**; Schedule cada **10 min** (`:x0:38`); webhook `cat-reprocess`. Desde el último arranque de n8n (10:18) el registro muestra 37 ejecuciones, **37 correctas**, duración ≈ 0,5–2 s, **ninguna sin fin**. PostgreSQL: 24 ejecuciones `COMPLETADA`, **0 `PROCESANDO`/`PENDIENTE`**.
- Activos en la misma instancia: Audi, Pagos (`pagosProdAsignaciones01` y su manejador de errores), Health Check, `Generación PDFs`, `Generación Hojas Identificación`. Los workflows TEST de Caterpillar siguen **inactivos** (staged). Solo Audi y Pagos tienen carpetas propias conocidas; **no se pudo comprobar** si los dos de generación tocan carpetas Caterpillar.
- **Comprobar en la interfaz de n8n** (no puedo leerlo sin su API): (a) *Executions* filtrado por `Remisiones CAT Produccion PG` justo antes de la ventana, sin ninguna en curso; (b) abrir `Generación PDFs` y `Generación Hojas Identificación` y confirmar que no apuntan a `SOLICITUD DE MATERIAL` de Caterpillar; (c) que el workflow nuevo se importa sin colisión del path `cat-reprocess` (n8n lo rechaza si el anterior sigue activo).

### 13.3 Hub de PROD: qué está desplegado realmente
La ruta de PROD es Caddy (`dauberthub…ts.net`, LAN) → `127.0.0.1:8082` → contenedor `daubert-hub-web-1` → `daubert-hub-api-1` (proyecto Compose `daubert-hub`, carpeta `daubert-hub-deploy-main`, base `daubert_global`, usuario `daubert_hub_app`). El `localhost:5173` y el API de `:3000` que corre desde el worktree de esta rama son TEST y no cuentan.

| Elemento | Repositorio (rama) | Desplegado en PROD (`6370753`, v1.0.6, imagen del 21/10) |
| --- | --- | --- |
| `ADMISSION_REJECTED` (API) | sí | **no** |
| Cancelación formal (`fn_cancelar_remision_caterpillar`, diálogo) | sí | **no** (tampoco la función en PG: 013 aún no se aplicó) |
| Endpoint de reproceso | sí | **sí** (estado `REPROCESS_CREATED`, ruta `/webhook/cat-reprocess`, token configurado) |
| Endpoint de regeneración y `fn_autorizar_regeneracion_caterpillar` | sí | **no** |
| Botón y diálogo Regenerar (web) | sí | **no** |
| Roles ADMIN/GENERAL | sí | solo lo anterior |
| Variables nuevas | ninguna | no hacen falta |

`main` está en `6370753` localmente y `origin/main` tiene 6 commits de documentación más; la rama tiene 24 commits propios y un merge de prueba con `origin/main` no produce conflictos (`git merge-tree`). **Orden seguro:** las migraciones 013 → 016/017 primero (el Hub viejo las ignora), luego el despliegue del Hub nuevo y recién entonces habilitar el candidato (que devuelve estados que solo el Hub nuevo traduce).

### 13.4 Riesgos específicos y ajustes requeridos
1. **B1 — releer un archivo ya emitido sin snapshot (los 11 de 13.1).** En la ventana el flujo nuevo ya no llama a `fn_crear_ejecucion_automatizacion`: por cada archivo hace `Resolver documento` → `Normalizar` → `fn_guardar_snapshot_caterpillar`. Para un documento con ejecución terminal sin snapshot la función devuelve `HISTORICAL_LOCKED` (verificado hoy en TEST con `ROLLBACK`) y `Verificar snapshot CAT` lanza `CAT_015_SNAPSHOT_NOT_STORED` en un nodo sin salida de error: la ejecución de n8n falla en el primer histórico y, como los candidatos se ordenan del más antiguo al más reciente, **un archivo nuevo quedaría sin procesar en cada ciclo**. No es seguro (no se emiten folios), pero deja el servicio parado. El runbook anterior (sección 4, punto 5) suponía `REVIEW`; ese supuesto es incorrecto. **Ajuste necesario antes de pedir autorización:** en el candidato, tratar `HISTORICAL_LOCKED` como "archivo ya emitido, omitir y seguir con el siguiente" (rama al `Loop Over Items`), con prueba en TEST con un histórico real y con un archivo nuevo detrás. Subir la fecha de corte **no** es suficiente (basta que Dropbox cambie la fecha de un archivo viejo).
2. **Pagos/Audi/otras automatizaciones:** el cambio solo toca `Remisiones CAT Produccion PG`, el rol `n8n_cat_prod`, 013/016/017 y los contenedores `api`/`web`. `n8n_app` no cambia. No reiniciar n8n; no usar `docker compose down/--remove-orphans`.
3. **Sesiones que bloquean migraciones:** hoy hay 11–12 sesiones (10 de pgAdmin con el usuario `postgres`, 1 del Hub, ninguna `idle in transaction`, ninguna esperando bloqueos). Antes de cada migración repetir la consulta; si aparece `idle in transaction`, cerrar esa ventana de pgAdmin (no terminar sesiones desde SQL sin aviso).
4. **Tarea de respaldo frecuente:** `Daubert - PostgreSQL Frequent` (cada 4 h) toma `pg_dump`; no compite (solo ACCESS SHARE), pero conviene que no coincida con el `ALTER TABLE` de 016.
5. **Folios y ventana:** durante la ventana (Schedule apagado) los archivos reales que lleguen esperan; no se pierden ni se emiten fuera de orden (el detector ordena por fecha). Hoy: P2 siguiente **108**, P5 **134**, P6 **9**.

### 13.5 Procedimiento de la ventana (ajustes al 5.1; no ejecutar todavía)
1. **Antes (sin cambios):** repetir `inventory-caterpillar-prod-files.cjs --db` y `caterpillar-016-prod-inspect.cjs`; nuevo respaldo (`backup-caterpillar-prod-db.cjs`) justo antes; confirmar B1 corregido y probado, B2 desplegable y la comprobación de interfaz 13.2.
2. **Detener solo Caterpillar:** desactivar `Remisiones CAT Produccion PG` (no Audi, Pagos ni el servicio de n8n). Anotar la hora. El botón Reprocesar devolverá 502 durante la ventana.
3. **Esperar ejecuciones activas:** n8n *Executions* de ese workflow sin "Running" y `PROCESANDO` = 0 en PG (consulta de 13.1). Si alguna dura más de 5 min, no seguir (sección 6).
4. **Sin ejecución simultánea:** el workflow anterior queda **desactivado y exportado**; el nuevo se importa inactivo y su Schedule/webhook se habilitan solo en los pasos 13–14 de 5.1. Nunca dos activos con el mismo path.
5. **Archivos pendientes:** repetir el inventario. Si hay alguno, queda esperando y se emite al habilitar (o en la primera emisión controlada); si es un histórico, tras B1 se omite. Prohibido mover, renombrar o editar archivos para "forzar" casos.
6. **Sesiones:** consulta de 13.4.3 antes de 013 y de 016.
7. **Hub:** 013 → rol → 016/017 → postcheck → **despliegue del Hub** con verificación (`/api/health` con el commit nuevo, `grep` de `ADMISSION_REJECTED`, `regenerate` y "Regenerar" en las imágenes) → recién entonces el candidato.
8. **Primera emisión real, sin documentos ficticios:** con el Schedule apagado y el webhook habilitado, esperar a la siguiente programación real de P2/P5/P6 (P2 llega aproximadamente semanal) y ejecutar el workflow nuevo manualmente con el operador. Una vez correcta, habilitar el Schedule.
9. **Comprobar PDFs y folios:** snapshot guardado, ejecución `COMPLETADA`, reserva `APLICADA` = remisiones `GENERADA`, un PDF por remisión en la carpeta de salida, folios contiguos desde 108/134/9 según la planta, siguiente folio = último + 1, y un segundo run sin folios nuevos.
10. **Después:** inspección diaria la primera semana (5.2) y conservar el workflow anterior desactivado.

