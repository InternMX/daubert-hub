# Caterpillar — Paquete y procedimiento de corte a PROD (016)

> **Estado: PREPARADO OFFLINE. NADA SE HA APLICADO A PRODUCCIÓN** (la única interacción con `daubert_global` fue una lectura de solo lectura, sección 2). Veredicto: **NO LISTO** para solicitar la autorización del corte hasta cerrar los bloqueos de la sección 9: la decisión sobre la **reemisión por corrección** (hallazgo de la lectura real), los exports vivos de n8n y el respaldo restaurable de PROD.
> Principio: **TEST es la fuente de verdad de la lógica; PROD es la fuente de verdad de los datos y del entorno.** No se copia ninguna tabla, snapshot, contador ni fixture de TEST. No se crea un sistema paralelo: se moderniza el proceso productivo existente (misma base, mismo n8n, mismo Hub).

## 1. Qué contiene el paquete (todo en el repositorio, sin aplicar)

| Pieza | Archivo | Para qué |
| --- | --- | --- |
| Migración 016 (precheck / up / postcheck / down) | `database/migrations/daubert_global/20261024_016_caterpillar_atomic_admission_prod.*.sql` | Columna de snapshot (014) + funciones protegidas (015) para `daubert_global`. **Generadas** por `scripts/generate-caterpillar-016-prod.cjs` a partir de los archivos validados en TEST; `--check` falla si alguien las edita a mano |
| Rol del worker | `…20261024_016_caterpillar_worker_role_prod.template.sql` | Crea `n8n_cat_prod` (contraseña por variable de `psql`, nunca en el repo) |
| Inspección de solo lectura | `…20261024_016_caterpillar_prod_inspection.readonly.sql` + `apps/api/scripts/caterpillar-016-prod-inspect.cjs` | Estado real de PROD antes y después del corte (25 consultas `SELECT`, sesión de solo lectura verificada) |
| Ensayo desechable | `scripts/rehearse-caterpillar-016.cjs` | Restaura un respaldo en una base temporal y ejecuta precheck → up → postcheck → down → up → postcheck → prueba funcional → bypass; luego elimina base y rol temporales |
| Candidato n8n PROD | `n8n/workflows/remisiones-caterpillar/candidate-016-prod/` (`prepare-prod.cjs`, `caterpillar-prod-016.CANDIDATE.INACTIVE.json`) | Workflow productivo inactivo, sin `id`, sin secretos, con Schedule y Webhook deshabilitados |
| Pruebas | `apps/api/test/caterpillar-016-prod.spec.ts` (15) | Correspondencia migración ↔ workflow ↔ contrato del Hub |

### Decisión de diseño que necesita tu aprobación: rol dedicado `n8n_cat_prod`
Hoy Caterpillar usa `n8n_app`, **compartido con Remisiones Audi** (ver [production-runbook](production-runbook.md)). La protección contra el bypass de 015 consiste en que el rol del worker de Caterpillar **no tenga EXECUTE** sobre las 5 funciones antiguas (`fn_crear_ejecucion_automatizacion`, `reservar_folios_para_ejecucion`, `fn_registrar_remision_generada`, `fn_finalizar_ejecucion_automatizacion`, `fn_registrar_fallo_ejecucion`). Eso no puede hacerse sobre `n8n_app` sin romper Audi. Por eso el paquete crea **un rol y una credencial n8n nuevos** solo para Caterpillar (`n8n_cat_prod`, credencial `Postgres produccion CAT (n8n_cat_prod)`); `n8n_app` y Audi no se tocan. Si prefieres seguir con `n8n_app`, el gate seguiría existiendo pero **no habría protección contra el bypass**: no es lo validado en TEST.

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
6. **Hub:** desplegar la versión con `ADMISSION_REJECTED` (commit `461170c` en adelante) y configurar `CATERPILLAR_REPROCESS_WEBHOOK_URL` / `…_TOKEN` (ya existentes para `cat-reprocess`). Solo despliegue normal del Hub, sin reiniciar nada más.
7. **Inventario de archivos pendientes** en las carpetas de cliente (nombre, fecha, planta) y de ejecuciones en curso en n8n. Decidir con el negocio qué se espera emitir y qué debería salir como `REVIEW`.
8. **Confirmar con el operador:** credencial n8n nueva y su contraseña, ventana, responsable presente.

### 5.1 Ventana de corte (orden exacto)
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
11. **Prueba controlada:** con el operador presente, ejecución manual **con los archivos pendientes del inventario 5.0.7**. Verificar con la inspección: snapshot guardado, ejecución `COMPLETADA`, reserva `APLICADA` = remisiones `GENERADA`, PDFs en la carpeta productiva, folios contiguos desde el `siguiente_folio` registrado, ningún duplicado. Un segundo run idéntico debe dar `BLOCK PROGRAM_ALREADY_EMITTED` sin folios.
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
| Reproceso | `409 ADMISSION_REJECTED` = regla de negocio (remisiones vigentes, sin snapshot, conflicto); `502/504` = técnico: consultar la ejecución antes de reintentar (idempotente: `ALREADY_REPROCESSED`) |

## 7. Cambios en Daubert Hub

No hay cambios de código pendientes para PROD más allá de lo ya versionado: el Hub lee ejecuciones/remisiones de tablas que no cambian; el rechazo del gate (`ADMISSION_REJECTED` → 409) ya está en la API; la UI distingue solicitud aceptada (202 `REPROCESS_CREATED`) de ejecución `COMPLETADA` (aparece como hija en la lista). Se conservan ADMIN/GENERAL. **Acciones de despliegue:** publicar esa versión *antes* del corte y fijar `CATERPILLAR_REPROCESS_WEBHOOK_URL` (`…/webhook/cat-reprocess`) y el token del Header Auth `Daubert Hub - n8n PROD`.
Nota de mantenimiento: `CaterpillarExecutionsRepository.claimAdmissionAndReserve / claimReprocessAndReserve / findAdmissionSnapshot / storeAdmissionSnapshot` están preparados solo para TEST (nombres `_test`, guard `daubert_hub_test`) y ningún controlador los llama; no se usan en PROD y no deben cablearse sin adaptarlos.

## 8. Pruebas ejecutadas (todas offline, sin consumir folios de PROD)

- `caterpillar-016-prod.spec.ts` (15): archivos de migración = lo generado desde TEST (sin ediciones manuales); sin tokens TEST; cuerpos de funciones idénticos a TEST salvo 3 sustituciones; huellas `md5` de postcheck/down recomputadas y las 5 de las funciones antiguas; sin DML fuera de funciones; sin GRANT de funciones antiguas; candidato regenerable, inactivo y sin `id`; nodos de entorno idénticos a PROD; gating P2/P5/P6 y corte 22/09 conservados; sin rutas, credenciales, sandbox, fallo provocado ni funciones `_test`; credencial dedicada en los PG; llamadas SQL ↔ firmas creadas por 016 (tipos y cantidad); topología sin aristas colgantes; respuesta aceptada por el cliente real del Hub; inspección solo-lectura; plantilla de rol sin secretos ni privilegios.
- Ensayo `rehearse-caterpillar-016.cjs` sobre una restauración del respaldo pre-015 de TEST: precheck, up, postcheck, down, re-aplicación, historial/series/contadores intactos, snapshot, gate, segundo worker rechazado, propietario, error → reserva `ABANDONADA`, reproceso con folios **nuevos**, segundo reproceso sin emitir, bypass de funciones antiguas y DML directo denegados. `REHEARSAL_016_PASS` (16 comprobaciones); base y rol temporales eliminados.
- Las 25 consultas de inspección se ejecutaron contra TEST (`--self-test`) para validar que corren.

## 9. Bloqueos pendientes (indispensables)

1. **Decisión sobre la reemisión por corrección** (hallazgo de la sección 2). Opciones: (A) aceptar el bloqueo y resolver cada caso a mano mientras tanto; (B) implementar una regeneración autorizada mínima antes del corte; (C) permitir que el reproceso por botón acepte una ejecución `COMPLETADA` cuyas remisiones están **todas canceladas** (hijo único, folios nuevos, mismos controles). Recomendación: C — reutiliza el reproceso ya validado, pero cambia `fn_reprocesar_reservar_*`, la elegibilidad del nodo y la UI, y exige repetir la validación en TEST antes de PROD.
2. ~~Lectura real de `daubert_global`~~ **Realizada** (sección 2).
3. **Exports vivos** de `Remisiones CAT Produccion PG` y del FULL de TEST para reconciliar y regenerar el candidato con `--require-live` (el repositorio solo tiene una copia saneada con `<WINDOWS_USER>`).
4. **Respaldo de PROD restaurable** y ensayo de 016 sobre esa copia.
5. **Decisión del rol dedicado** `n8n_cat_prod` y alta de su credencial en n8n.
6. **Inventario de archivos pendientes y de ejecuciones en curso** en PROD.
7. **Verificar que el Hub PROD ya incluya `ADMISSION_REJECTED`.**
8. Verificaciones que requieren escritura (se hacen en la ventana, paso 11): primera emisión real con el candidato, PDFs, reproceso por botón, ciclo programado.
