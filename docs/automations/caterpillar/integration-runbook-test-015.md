# Fase 5E — compatibilidad 015 y runbook de integración coordinada en TEST (handoff)

**015 NO APLICADA. Ningún workflow n8n, dato, PROD, Dropbox ni Notificaciones de Pago tocados.**
Rama `feat/caterpillar-remission-controls`, base `da15d70`. Alcance 5E: revisión + preparación + lecturas autorizadas.

## 1. Compatibilidad de 015 con el workflow TEST actual

Fuente: export `MANUAL TEST REMISIONES CAT.json` (credencial Postgres única `cat_test`, id `xK9CGscXx6kKLZTi`; inactivo en el export).
Es evidencia de un export local, **no** del inventario vivo de n8n.

| Nodo / camino | Función usada | Efecto tras 015 |
|---|---|---|
| Resolver documento origen PG | `core.fn_crear_o_resolver_documento` | Sin cambio (015 no la toca) |
| Crear o recuperar ejecución PG | `ops.fn_crear_ejecucion_automatizacion` | **Falla** (EXECUTE retirado a `n8n_cat_test`) |
| Reservar folios PG | `operacion.reservar_folios_para_ejecucion` | **Falla** |
| Registrar remisión PG | `operacion.fn_registrar_remision_generada` | **Falla** |
| Finalizar ejecución PG | `ops.fn_finalizar_ejecucion_automatizacion` | **Falla** |
| Registrar fallo PG | `ops.fn_registrar_fallo_ejecucion` | **Falla** |
| Resolver ejecución original PG (reproceso) | `ops.fn_resolver_ejecucion_para_reproceso` | Sigue funcionando (no se revoca) |
| `Execute a SQL query` | `pg_get_functiondef(finalizar)` (diagnóstico) | Funciona (catálogo, sin EXECUTE) |

Hallazgos:

1. **Aplicar 015 con el workflow actual lo rompe por completo** salvo el resolutor de documento y el de elegibilidad. Confirma la regla: sin aplicación aislada.
2. **Reproceso manual (webhook `cat-test-reprocess`)**: reutiliza `Crear o recuperar ejecución PG` con `p_reproceso_de_id`. El gate `fn_admitir_reservar_caterpillar_test` llama a `fn_crear_ejecucion_automatizacion(..., NULL, NULL)`: **no soporta crear hija de reproceso**. Tras 015 el reproceso TEST queda inoperante hasta definir una entrada protegida (p. ej. extender el gate con `p_reproceso_de_id` validando que el original sea ERROR/CANCELADA y sin hijo; el índice único `uq_ejecuciones_automatizacion_reproceso_unico` ya limita a un hijo). **Es decisión pendiente; no se implementó** (regeneración excluida de 5E).
3. **Recuperación de workers**: el owner es `n8n_execution_id` fijo; un worker muerto con ejecución `PROCESANDO` bloquea la programación (`PROGRAM_IN_PROGRESS`) para cualquier otro worker, sin expiración. Recuperación = conciliación manual administrativa (marcar la ejecución huérfana mediante `fn_fallo_caterpillar_test`/finalizar con el MISMO worker id, solo con ventana y evidencia). No reutilizar el ID desde otro workflow. Pendiente fase administrativa.
4. **Consumidores del rol `n8n_cat_test`**: el repositorio solo prueba un consumidor (workflow TEST con credencial `cat_test`). Que `cat_test` use el usuario `n8n_cat_test` y que ningún otro workflow la comparta **no está verificado en vivo** (`liveCredentialUserVerified=false`, `liveCredentialExclusiveVerified=false`). Se verifica en n8n UI (Credentials → `cat_test` → usuario y "Used by"), sin leer secretos. El Hub/API no llama estas funciones con ese rol (los runners de integración usan roles de test propios).
5. El precheck exige: sin `PROCESANDO`, sin snapshots previos, rol sin memberships/DML, grants directos legado intactos y huellas/contratos de resultado esperados.

## 2. Runbook de integración coordinada (solo TEST, con autorización por paso)

**Condiciones previas:** autorización explícita del operador para cada etapa B+; PowerShell con variables (ver §4); numeración 015 confirmada externamente.

**A. Lecturas (sin escritura)** — autorizado en 5E
1. `node apps/api/scripts/caterpillar-015-readonly-check.cjs` → debe dar `TEST_015_READONLY_COMPLETE_NOT_READY` con `precheck.pass=true`, rol sin memberships, `workerTablePrivileges.direct_mutation=false`, funciones `available` y `worker_direct_execute=true`.
2. Contar `executions` / `snapshots` / `legacy_documents` (salen en el reporte). Esperado: 0 PROCESANDO.
3. En n8n UI, verificar `cat_test` → usuario `n8n_cat_test` y que solo lo usa el workflow TEST. Confirmar instancia 5678 sin ejecuciones en curso y workflow inactivo/sin triggers.

**B. Respaldo (requiere autorización)**
1. `pg_dump -Fc` de `daubert_hub_test` hacia `C:\Users\06\Documents\Daubert\respaldos-postgres-test\` (nombre con fecha); verificar con `pg_restore --list`.
2. Dump de definiciones: `pg_dump --schema-only -n core -n ops -n operacion` + export de ACL de las 5 funciones legado. Guardar hashes (`body_fingerprint` del reporte A).
3. Exportar (archivo local, sin importar) el workflow TEST actual de n8n y la lista de credenciales.
4. Probar restauración del respaldo en una base desechable, no en TEST.

**C. Ventana** — sin ejecuciones TEST, workflow viejo desactivado y sin webhook activo; no detener la instancia 5678 ni cambiar opciones globales de PROD.

**D. Adaptación n8n (copia, aún sin importar)** según la tabla de nodos de `atomic-admission-test.md`. Para esta ventana además: decidir y probar el camino de reproceso (hallazgo 2) y de recuperación (hallazgo 3). Validar la copia con `validate-candidate.cjs`/specs existentes. **No importar sin autorización.**

**E. Aplicar 015** (autorizado explícitamente): `precheck` → `up` → `postcheck` por el runner de migración habitual con `postgres` en TEST. Verificar que el postcheck pasa.

**F. Validación de permisos (lectura)** — repetir A; esperar `worker_effective_execute=false` en las 5 legado y `true` en las 4 entradas protegidas, `direct_mutation=false`. Con `n8n_cat_test`: `SELECT ops.fn_crear_ejecucion_automatizacion(...)` debe dar `permission denied`; PUBLIC/Hub sin EXECUTE.

**G. Concurrencia real** (§3) con fixture aislado. Luego probar nombres equivalentes, fallo dentro de reserva, reintento tras respuesta perdida (mismo worker → `OWNED_RETRY`), bypass de permisos.

**H. Importar el workflow adaptado** (autorizado aparte), ejecución manual de un fixture aislado, comparar con la corrida V1 previa. No activar triggers automáticamente.

**Rollback:** `down.sql` solo con mantenimiento, lock exclusivo y sin ejecuciones respaldadas por snapshot; si no es posible, restaurar el dump de B en base nueva y reapuntar. Reimportar el workflow viejo desde el export de B.3.

## 3. Prueba de concurrencia con dos conexiones reales

Archivo: `apps/api/test/caterpillar-015-concurrency.test-runner.cjs`. Requiere 015 ya aplicada y un documento fixture aislado con snapshot válido, routing a una serie de pruebas y cantidad esperada (no folios operativos).

```
$env:TEST_DATABASE_URL_WORKER   = '<postgres://n8n_cat_test:...@host:5432/daubert_hub_test>'
$env:TEST_DATABASE_URL_MIGRATOR = '<postgres://postgres:...@host:5432/daubert_hub_test>'
cd apps/api
node test/caterpillar-015-concurrency.test-runner.cjs --document <id> --series <serie> --quantity <n>
```

- Modo por defecto (sin escritura persistente): A adquiere sin commit, B se observa esperando `Lock/advisory` desde `pg_stat_activity`, A hace ROLLBACK, B adquiere; ambos revierten.
- `--commit --allow-test-writes`: A hace COMMIT; B debe recibir `PROGRAM_IN_PROGRESS`, `can_emit=false`, y se verifica 1 ejecución PROCESANDO + 1 reserva. Deja la ejecución fixture que debe resolverse por §2-G (no se limpia sola).
- Valida base `daubert_hub_test`, usuarios exactos y dos PIDs distintos; los errores crudos se suprimen.
- Verificado hoy solo sintaxis y guardas (sin variables TEST no se conecta).

## 4. Ejecutar las lecturas desde PowerShell configurada

```
$env:TEST_DATABASE_URL_MIGRATOR = '<postgres://postgres:...@host:5432/daubert_hub_test>'
$env:TEST_DATABASE_URL          = '<postgres://daubert_hub_test_user:...@host:5432/daubert_hub_test>'
cd C:\Users\06\Documents\Daubert\daubert-hub-caterpillar-remission-controls\apps\api
node scripts\caterpillar-015-readonly-check.cjs
```

Solo `BEGIN READ ONLY`; el precheck corre y se revierte. Limitación: el script exige ambas URLs; no lee `.env`.

## 5. Estado 5E

- Hecho: revisión de compatibilidad, runbook, runner de concurrencia, ejecución del check (resultado hoy: `TEST_015_READONLY_BLOCKED`, `MISSING_AUTHORIZED_TEST_CONNECTIONS`; no hay variables TEST en esta sesión).
- Archivos nuevos (sin commit): `apps/api/scripts/caterpillar-015-readonly-check.cjs`, `apps/api/test/caterpillar-015-concurrency.test-runner.cjs`, este documento.
- Bloqueos: lecturas vivas sin variables; credencial `cat_test` sin verificar; reproceso y recuperación de workers sin entrada protegida; prueba de concurrencia no ejecutada (necesita 015 aplicada).
- Siguiente paso: el operador ejecuta §4 y comparte el JSON; decidir diseño de reproceso/recuperación; luego autorizar B.

## 6. Fase 5F — compatibilidad preparada (SIN aplicar, SIN importar)

**Estado:** 015 sigue NO aplicada; el candidato `n8n/workflows/remisiones-caterpillar/candidate-015/` sigue BLOQUEADO.
La ejecución 117 (documento 214, worker 4471, reserva 89 folios 81–84 RESERVADA, sin remisiones) no se tocó; el precheck 015 no se debilitó
(no se modificó el archivo `.precheck.sql`; su hash fijado en `caterpillar-015-readonly-check.cjs` sigue vigente).

### Entrada protegida de reproceso (añadida a 015)
`ops.fn_reprocesar_reservar_caterpillar_test(p_parent bigint, p_worker text, p_series text, p_quantity integer)` — mismo contrato de
columnas que el gate, SECURITY DEFINER, `search_path` fijo, READ COMMITTED, EXECUTE solo para `n8n_cat_test`. Se agregó a `up`, `down` y
`postcheck` (huella `da2088a4bb82bffb90ccd632d6108dde`); el `precheck` no cambió.

- Padre solo `ERROR`/`CANCELADA` (si no: `BLOCK PARENT_NOT_REPROCESSABLE`); COMPLETADA y PROCESANDO nunca se amplían.
- El documento hijo es SIEMPRE el del padre (no se acepta uno del llamador). Sin snapshot V1 válido: `REVIEW REPROCESS_SNAPSHOT_REQUIRED`
  (los históricos —17 legacy— quedan bloqueados explícitamente; no se inventan snapshots).
- Padre con remisiones vivas (no CANCELADA) = emisión parcial: `REVIEW PARENT_HAS_ACTIVE_REMISSIONS`. **Restricción nueva** respecto
  al reproceso actual (que no la tenía); se añadió para no duplicar emisión. Revisar si se acepta.
- Reutiliza `ops.fn_crear_ejecucion_automatizacion(…, p_parent)` (conserva `reproceso_de_id`, un solo hijo directo y su idempotencia) y
  `operacion.reservar_folios_para_ejecucion` (folios nuevos). Hijo existente: mismo worker → `OWNED_RETRY` (misma reserva); otro worker con hijo
  PROCESANDO → `REPROCESS_IN_PROGRESS`; hijo terminado → `ALREADY_REPROCESSED`.
- Conflictos con OTROS documentos (mismo nombre/clave, manifest equivalente, legacy por nombre, historial inválido) → `REVIEW`, misma política del gate.
- Misma autoridad: ADMIN sigue en Hub/n8n; no se restauró ningún privilegio directo a `n8n_cat_test`.
- Pregunta abierta: el gate llama `REGENERATION_AUTHORIZATION_REQUIRED` a un CANCELADA; el reproceso de un padre CANCELADA se conserva porque
  el requerimiento lo pide, pero conviene confirmar que no equivale a regeneración comercial.

Contrato TS preparado (no llamado por controladores): `CaterpillarExecutionsRepository.claimReprocessAndReserve` (acepta solo
`REPROCESS_ACQUIRED`/`OWNED_RETRY` como derecho de emisión).

### Recuperación manual de un worker con ejecución PROCESANDO (sin automatizar)
1. Confirmar que no continúa: historial de n8n 5678 para `n8n_execution_id` (ejecución terminada/fallida/inexistente) y sin backends
   `n8n_cat_test` activos. Si corre, esperar.
2. Ejecutar `caterpillar-015-idle-diagnosis.cjs` (solo lectura) y clasificar por ejecución: reservas (estado/rango), remisiones, documento y snapshot.
3. Clasificar: **sin remisiones** = fallo sin emisión; **remisiones parciales** = emisión parcial (conciliar PDFs/remisiones antes de nada);
   **remisiones = reservas** = emisión completa sin finalizar.
4. Con autorización expresa y SOLO con el mismo ID de worker mediante los wrappers existentes (no SQL manual): fallo sin emisión →
   `fn_fallo_caterpillar_test` hasta ERROR terminal o `fn_finalizar_caterpillar_test(…,'ERROR')` (abandona la reserva, conserva fila y folios, sin reabrir);
   emisión completa → `fn_finalizar_caterpillar_test(…,'COMPLETADA')` solo si la integridad lo permite; parcial → no cerrar hasta conciliar.
5. Nunca: expirar por timeout, reasignar propietario, reutilizar el ID desde otro workflow, borrar filas, tocar secuencias/folios.
6. Si la ejecución es anterior a 015 y no tiene snapshot (caso 117), los wrappers no aplican (`CAT_ATOMIC_SNAPSHOT_REQUIRED`): se cierra ANTES del
   corte con las funciones legado existentes, mientras `n8n_cat_test` aún las tiene, o con el rol administrativo y autorización, y el precheck debe pasar sin cambios.

### Candidato de workflow
Ver `candidate-015/README.md`. Flujo: documento → normalización/manifest V1 → snapshot (BLOQUEADO) → serie/cantidad → gate atómico → derecho
verificado → asignar/registrar/finalizar por wrappers; fallos previos a la admisión no tocan SQL; reproceso con camino explícito.

### Pruebas (offline; NO son validación real de PostgreSQL ni de n8n)
- `caterpillar-atomic-admission.spec.ts` (PGlite, un solo backend, dobles del contrato legado): 41 pruebas, 11 nuevas de reproceso.
- `caterpillar-atomic-admission-contract.spec.ts`: 15 (incl. contrato TS de reproceso).
- `caterpillar-015-candidate.spec.ts`: 19 (estructura inactiva/bloqueada, alcanzabilidad, cuerpos puros, Torreón, fallos previos/posteriores).
- Suite completa de la API: 142 archivos / 2158 pruebas OK; `tsc --noEmit` y eslint de lo tocado limpios.

### Sigue bloqueando aplicar 015
1. Ejecución 117 PROCESANDO (más cualquier otra) — conciliar antes del corte.
2. ~~Escritor de snapshot~~ (5G-A): entrada SQL `ops.fn_guardar_snapshot_caterpillar_test` en 015, huella `e8a39d9e2d9b64e40cc42f9fd9e979d0`, ya enlazada en el candidato; falta validarla contra PostgreSQL real tras aplicar 015.
3. Credencial `cat_test` sin exclusividad verificada; instancia 5678 compartida con PROD.
4. Prueba de concurrencia real con dos backends (runner listo, requiere 015 aplicada) y prueba real del reproceso (el runner actual solo cubre el gate de primera emisión).
5. Respuesta de reproceso al Hub (10 s) y rechazos sin código conocido por el Hub.
6. Aceptar por escrito la política legacy (17 históricos) y la restricción nueva de remisiones vivas.
7. Respaldo, ventana sin ejecuciones TEST y autorización explícita (§2 B–E).

### Siguiente validación concreta antes del corte
Ejecutar (solo lectura) `caterpillar-015-idle-diagnosis.cjs` y `caterpillar-015-readonly-check.cjs`; verificar `cat_test` en n8n; decidir cómo se
persiste el snapshot (servicio interno vs. otra vía revisada); con esa decisión reabrir el candidato, y recién entonces solicitar ventana y respaldo.

## 7. Fase 5G-A — captura de snapshot (preparada, sin aplicar)

- **Por qué SQL y no HTTP/NestJS**: no hay llamada autenticada n8n→Hub (los únicos tokens son Hub→n8n); un endpoint nuevo exigiría autenticación nueva.
  La entrada SQL reutiliza la credencial `cat_test` (`n8n_cat_test`), sin UPDATE sobre `core.documentos` ni tablas nuevas, y vive en 015 (sin migración nueva).
- **Qué hace** (`ops.fn_guardar_snapshot_caterpillar_test(p_document bigint, p_manifest text) → text`): TEST-only; bloquea la fila del documento;
  empresa y nombre salen de ese documento; n8n solo envía `JSON.stringify(manifest)` ya calculado por V1 antes de agrupar Torreón; construye la clave
  (texto idéntico al `JSON.stringify` de TypeScript, verificado en pruebas) y la valida con `fn_cat_snapshot_015`. Resultado: `STORED`,
  `ALREADY_STORED`, `CONFLICT` (nunca sobrescribe) o `HISTORICAL_LOCKED` (documento con intentos terminales, remisiones o reservas: sin backfill).
  Errores (`SOURCE_NOT_FOUND`, `SNAPSHOT_INVALID`) abortan.
- **Workflow**: Normalizar → Preparar snapshot → Guardar snapshot (SQL) → `¿Histórico ya emitido?` → Verificar snapshot (solo STORED/ALREADY_STORED; re-emite los items normalizados) →
  Preparar reserva → gate. Sin snapshot no hay ejecución ni folios (el gate responde `HISTORY_UNAVAILABLE`). `HISTORICAL_LOCKED` es un **valor devuelto** (no una excepción):
  en el escaneo automático se omite el archivo (`Omitir histórico CAT` → `SKIPPED_HISTORICAL` → `Loop Over Items`); ver sección 15.
- **Reproceso**: el mismo documento ya tiene snapshot → `ALREADY_STORED`; contenido distinto → `CONFLICT`; histórico sin snapshot → `HISTORICAL_LOCKED`
  (reproceso bloqueado explícitamente, sin manifests inventados).
- **Límite**: un fallo de captura (CONFLICT, UNAVAILABLE, error SQL) aborta la ejecución de n8n (no hay log por Preparar error) y, dentro de un lote, detiene los archivos siguientes. El único resultado de captura que **no** detiene el lote es `HISTORICAL_LOCKED` en el escaneo automático (sección 15).

## 8. Preparación integral del corte (estado y procedimiento) — NO EJECUTAR sin autorización

**Veredicto de preparación: NO LISTO para solicitar la autorización del corte.** Código preparado y probado offline; nada validado contra PostgreSQL real
(015), ni n8n real, ni E2E. Faltan, en orden: (1) ejecutar las lecturas reales y el respaldo (comandos abajo; esta sesión no tiene variables TEST);
(2) un procedimiento revisado para **desbloquear** el candidato por etapas (hoy todos los nodos PostgreSQL/archivo/comando tienen hold incondicional y no
existe aún el generador de la copia habilitada, ni la revisión de sus dependencias Windows: scripts PowerShell, conversor PDF, temporales);
(3) descartar manualmente que otra credencial n8n use `n8n_cat_test`; (4) prueba de restauración del respaldo en una base desechable.

### Cambios de esta preparación
- `precheck.sql` ahora también rechaza si ya existen `fn_reprocesar_reservar_caterpillar_test` y `fn_guardar_snapshot_caterpillar_test`
  (SHA-256 normalizado nuevo `f0e7413d134a42e73c63e90efeb10d0f5695da5397bf563d8af162878c6d0253`, actualizado en `caterpillar-015-readonly-check.cjs`).
  El PASS anterior del usuario fue contra el texto previo: **repetir el precheck**. No se debilitó ninguna condición.
- `caterpillar-015-readonly-check.cjs` reporta además `workerExecutableFunctions` (toda función de core/ops/operacion que `n8n_cat_test` puede ejecutar hoy)
  para revisar que no exista otro camino hacia folios fuera del gate. `scripts/backup-caterpillar-test-db.ps1` crea el respaldo.
- Revisión de 015 final: up/down/postcheck/precheck listan las funciones nuevas (key_text, snapshot, worker, admitir, reprocesar, guardar y 3 wrappers) con huellas
  vigentes; PUBLIC/otros roles sin EXECUTE sobre objetos nuevos; `n8n_cat_test` pierde EXECUTE directo de las 5 legado y se verifica que no lo recupere por membresía/PUBLIC.
  Los wrappers de registro/finalización/fallo verifican propietario antes de delegar; reserva y reproceso solo existen dentro de sus entradas. Contratos SQL y consultas del
  candidato revisados por pruebas (parámetros y columnas coinciden).
- Revisión del candidato: la captura de snapshot es predecesor obligatorio del gate; fallos previos a la admisión no registran sobre ejecuciones ajenas (contexto del
  documento actual); un timeout del Hub se informa como TIMEOUT (no como éxito) y un reintento posterior devuelve `ALREADY_PROCESSING`/`ALREADY_REPROCESSED`
  (idempotente); el reproceso solo admite ERROR/CANCELADA, un hijo, sin remisiones vivas, folios nuevos, propietario exclusivo.

### Comandos exactos para el usuario (PowerShell con variables TEST autorizadas)
```
cd C:\Users\06\Documents\Daubert\daubert-hub-caterpillar-remission-controls
$env:TEST_DATABASE_URL_MIGRATOR = '<postgres://postgres:...@host:5432/daubert_hub_test>'
$env:TEST_DATABASE_URL          = '<postgres://daubert_hub_test_user:...@host:5432/daubert_hub_test>'
node apps\api\scripts\caterpillar-015-idle-diagnosis.cjs      # esperado: blockers: []
node apps\api\scripts\caterpillar-015-readonly-check.cjs      # esperado: precheck.pass=true; revisar workerExecutableFunctions
.\scripts\backup-caterpillar-test-db.ps1                      # crea daubert_hub_test_pre015_<fecha>.dump fuera de Git/Dropbox
```
El script de respaldo no sobrescribe, verifica código de salida, tamaño, SHA-256, `pg_restore --list` y que el archivo declare `daubert_hub_test`.
`pg_restore --list` **no** prueba la restauración: antes del corte restaurar en una base desechable (`createdb daubert_restore_check`;
`pg_restore -d daubert_restore_check <dump>`; comparar conteos; `dropdb`). Nunca restaurar sobre TEST ni PROD.

Credenciales n8n (manual, sin ver contraseñas): en n8n → Credentials, abrir cada credencial Postgres y revisar solo Database/User; ninguna distinta de `cat_test`
debe usar `n8n_cat_test`. Apoyo desde PostgreSQL: `SELECT application_name,count(*) FROM pg_stat_activity WHERE usename='n8n_cat_test' GROUP BY 1;` (no prueba exclusividad).

### Antes del corte (todas deben cumplirse)
1. Respaldo fresco verificado y restaurado en base desechable. 2. `cat_test`=`n8n_cat_test` y sin otra credencial con ese usuario.
3. Idle diagnosis `blockers: []` y 0 ejecuciones Caterpillar PROCESANDO. 4. Precheck (texto nuevo) PASS. 5. `node candidate-015/prepare-candidate.cjs` reproduce el mismo SHA-256 y las pruebas pasan.
6. Procedimiento de desbloqueo por etapas revisado (pendiente). 7. Ninguna ejecución PROD en curso; la instancia 5678 no se detiene ni se cambian opciones globales.

### Durante el corte (documentado, NO ejecutar ahora)
1. Desactivar el workflow `MANUAL TEST REMISIONES CAT` (0hUrQ64tpD2yI2MZ) y sus entradas; exportar copia de respaldo. 2. Esperar y comprobar 0 ejecuciones activas.
3. Aplicar 015 solo en `daubert_hub_test` como `postgres` (precheck, up, postcheck). 4. Revisar `workerExecutableFunctions`: solo funciones protegidas y resolutores de lectura/documento.
5. Importar como workflow NUEVO la copia habilitada por etapas, con la credencial `cat_test` y rutas TEST; nunca sobrescribir PROD ni el workflow anterior (el anterior falla por diseño con 015: sus llamadas directas pierden EXECUTE).
6. Etapa 1: importar con todos los holds e inspeccionar. Etapa 2: quitar holds de PostgreSQL y validar snapshot+gate con un fixture aislado. Etapa 3: habilitar I/O de archivos solo en la raíz TEST. Etapa 4: ejecución manual de un programa. Sin schedule hasta el final.

### Validación futura (criterios esperados)
| Prueba | Esperado |
|---|---|
| Captura inicial | `STORED`; snapshot idéntico al de TypeScript |
| Repetición | `ALREADY_STORED`, sin UPDATE |
| Excel ya procesado modificado | nuevo hash = otro documento; mismo documento con otro manifest = `CONFLICT`, sin folios |
| Nombre nuevo + contenido distinto | `ADMIT`, 1 ejecución, 1 reserva |
| Nombre distinto, mismo manifest V1 | `REVIEW MANIFEST_MATCH_REVIEW`, sin folios |
| Reproceso ADMIN de ERROR/CANCELADA | `REPROCESS_ACQUIRED`, hijo único, folios nuevos; repetido: `ALREADY_PROCESSING`/`ALREADY_REPROCESSED` |
| Reproceso rechazado (COMPLETADA, remisiones vivas, histórico) | `PARENT_NOT_REPROCESSABLE` / `PARENT_HAS_ACTIVE_REMISSIONS` / `HISTORICAL_LOCKED`; sin escritura |
| Error antes de reservar | sin ejecución ni reserva |
| Error después de reservar | fallo registrado solo por el propietario; el mismo worker reintenta la misma reserva |
| Dos workers | runner `caterpillar-015-concurrency.test-runner.cjs`: B espera `Lock/advisory`; un único propietario y rango |
| Finalización | `COMPLETADA` solo con remisiones = reservas; sin duplicados |
| Torreón | una reserva por documento OC; todas las partidas repetidas en el manifest |

Concurrencia: primero modo por defecto (todo ROLLBACK) con documento/serie fixture aislados; `--commit` requiere autorización aparte y conciliación explícita; no usar series ni folios operativos.

### Recuperación y rollback
- **Falla `up`/postcheck**: `up` es una transacción; si falla, no queda nada. Si el postcheck falla tras COMMIT, no usar el workflow; corregir hacia adelante o aplicar `down` solo si no hay ejecuciones con snapshot.
- **`down.sql` se niega** si existe cualquier ejecución Caterpillar cuyo documento tenga snapshot (evidencia). Tras un E2E con ejecuciones no hay `down`. Opciones:
  (a) corregir hacia adelante; (b) emergencia, con firma: re-conceder a `n8n_cat_test` el EXECUTE legado SIN borrar 015 (reabre el bypass, solo para el workflow anterior y solo en TEST);
  (c) restaurar el respaldo en una base nueva y decidir el cambio de base fuera de este alcance. Nunca borrar remisiones, retroceder contadores ni "limpiar" reservas.
- **Falla la captura, reserva o reproceso en validación**: detener, no reintentar con otros IDs de worker; conciliar con el procedimiento de la sección 6 (mismo worker, wrappers).
- **Falla el workflow candidato**: desactivar la copia; el anterior no sirve con 015 aplicada; volver a él solo reimportando el export de respaldo tras (b) con autorización.

### Estado por capa
Código preparado: sí. PostgreSQL real validado: solo 014 (snapshot); 015 no. n8n real validado: manifest V1 (sintético); candidato 015 no. Migración 015 aplicada: no. E2E demostrado: no.

## 9. Integración y validación real en TEST — ejecución guiada

**Estado al escribir esto:** la sesión de la IA no tiene `TEST_DATABASE_URL_MIGRATOR`, `TEST_DATABASE_URL` ni acceso autenticado a la API de n8n, por lo que **015 NO se aplicó y
nada se importó ni se ejecutó**. Todo lo siguiente está preparado y probado offline; las tablas de resultados reales quedan por completar con la salida de los comandos.

### 9.1 Piezas preparadas
- `candidate-015/prepare-enabled.cjs` genera dos copias INACTIVAS derivadas del candidato bloqueado (sin `id`, por lo que n8n las importa como workflows NUEVOS):
  - `caterpillar-test-015.INSPECT.INACTIVE.json` (Etapa 0): lee Excel, clasifica, normaliza y calcula el manifest V1; documento sintético; PostgreSQL, escritura de archivos y PowerShell siguen bloqueados; termina en *Preparar snapshot admisión CAT*.
  - `caterpillar-test-015.FULL.INACTIVE.json`: todas las acciones habilitadas pero confinadas: rutas solo dentro de la raíz TEST (lectura en toda la raíz; escritura únicamente en `01_ENTRADA`, `02_SALIDAS`, `03_LOGS`, `04_ERRORES` y `06_ARCHIVOS TEMPORALES\cat-test-5678`; borrado solo de `.html` temporales),
    PowerShell solo con los dos scripts fijos de TEST y argumentos sin metacaracteres, PostgreSQL solo con las entradas protegidas de 015 y la credencial `cat_test` (referencia por id `xK9CGscXx6kKLZTi`, sin secreto). Webhook deshabilitado y con ruta nueva `cat-test-reprocess-015`; Schedule deshabilitado; solo disparador manual.
- `scripts/apply-caterpillar-015-test.ps1`: corte con compuertas (identidad `postgres@daubert_hub_test`, hash del respaldo, 0 PROCESANDO, precheck, up, postcheck). Sin `-Apply` es un ensayo que no cambia nada. Nunca ejecuta `down`.
- `apps/api/scripts/caterpillar-015-verify.cjs`: verificación de solo lectura (folios duplicados, un hijo por padre, rangos solapados, COMPLETADA = reservas, snapshot presente, worker sin EXECUTE legado).
- Hub: nuevo rechazo de dominio `ADMISSION_REJECTED` (HTTP 409 con mensaje claro) en vez de un 502 cuando el gate rechaza un reproceso. El candidato responde `NOT_ELIGIBLE_STATE` o `ADMISSION_REJECTED`; un error técnico (incluido un fallo de snapshot) sigue siendo error técnico, y un timeout del Hub se informa como timeout.

### 9.2 Dependencias Windows (comprobadas en solo lectura el 2026-10-22)
Presentes en `…\REMISIONES CAT`: `00_ARCHIVOS A PROCESAR`, `01_ENTRADA`, `02_SALIDAS`, `03_LOGS`, `04_ERRORES`, `05_ARCHIVOS AUXILIARES\{CATALOGO\Catalogo_Caterpillar.xlsx, SCRIPTS\convertir-cat-pdf.ps1, SCRIPTS\limpiar-temp-cat.ps1, TEMPLATES\*.html + fonts + images}`, `06_ARCHIVOS TEMPORALES`.
Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) y Edge existen. `convertir-cat-pdf.ps1` exige que exista `-TempDir` (lo crea *Renderizar HTML* con `mkdirSync` confinado) y crea `-OutDir`.
No se instaló ni modificó nada. No se probó la escritura real (requiere ejecutar el workflow). Observación: `detectar-archivos-cat.ps1` está vacío y no lo usa el flujo.

### 9.3 Secuencia (en orden; cada paso depende del anterior)
1. Variables y comprobaciones (sección 8): `idle-diagnosis` (`blockers: []`), `readonly-check` (precheck PASS, revisar `workerExecutableFunctions`). Revisión manual de credenciales n8n por usuario `n8n_cat_test`.
2. En n8n (sin tocar PROD): exportar `MANUAL TEST REMISIONES CAT` (0hUrQ64tpD2yI2MZ); **desactivarlo**; confirmar 0 ejecuciones en curso. Importar `…INSPECT.INACTIVE.json` (Workflows → Import from file). Verificar que se creó un workflow NUEVO (otro id) y que PROD no cambió.
3. **Etapa 0**: colocar un Excel de prueba en `00_ARCHIVOS A PROCESAR`, ejecutar manualmente. Esperado: item final de *Preparar snapshot admisión CAT* con `documento_origen_id: "0"` y `manifest_canonical` V1; sin filas nuevas en PostgreSQL ni archivos nuevos. Revisar clasificación P5/P6/Torreón y cantidades.
4. `.\scripts\apply-caterpillar-015-test.ps1 -BackupFile <dump> -BackupSha256 <hash> -OldWorkflowDeactivated` (ensayo). Si da PASS, repetir con `-Apply`. Después `readonly-check` y `caterpillar-015-verify.cjs` (esperado `TEST_015_VERIFY_PASS`).
5. Importar `…FULL.INACTIVE.json`; comprobar en la UI que los 7 nodos PostgreSQL muestran `cat_test`. Ejecutar manualmente un programa nuevo (**Etapa 1–3**) y verificar: snapshot `STORED`, ejecución COMPLETADA, reserva APLICADA = remisiones GENERADAS, PDFs en `02_SALIDAS`, HTML temporales borrados, `caterpillar-015-verify.cjs` PASS.
6. **Etapa 4 (reproceso)**: asignar *Header Auth* al webhook en la UI, habilitarlo, apuntar `CATERPILLAR_REPROCESS_WEBHOOK_URL` de TEST del Hub a `/webhook/cat-test-reprocess-015` (cambio de configuración del Hub de TEST, no de n8n global) y reprocesar desde Hub una ejecución ERROR/CANCELADA creada con las pruebas.
7. **Etapa 5 (concurrencia)**: con `TEST_DATABASE_URL_WORKER` (n8n_cat_test) y `TEST_DATABASE_URL_MIGRATOR`, ejecutar `caterpillar-015-concurrency.test-runner.cjs` en modo ROLLBACK sobre un documento con snapshot y una serie/ruta de pruebas DEDICADAS (crear esos fixtures requiere SQL de escritura contra el esquema real; no se incluye hasta confirmarlo). `--commit` solo con autorización aparte.
8. Schedule: no habilitar hasta cerrar la tabla de abajo.

### 9.4 Escenarios y verificación (completar con resultados reales)
| Caso | Cómo | Esperado / verificación | Resultado real |
|---|---|---|---|
| Programación nueva | Excel nuevo en `00_…` | COMPLETADA; PDFs; `verify` PASS | pendiente |
| Segunda ejecución idéntica | Reponer el mismo archivo | `BLOCK PROGRAM_ALREADY_EMITTED`; 0 folios nuevos | pendiente |
| Mismo archivo modificado tras emitirse | Editar copia, mismo nombre | `CONFLICT` en snapshot (mismo documento) o `BLOCK` por nombre; sin emisión | pendiente |
| Archivo nuevo, contenido distinto | Nombre y datos nuevos | `ADMIT` | pendiente |
| Nombre distinto, contenido V1 equivalente | Renombrar copia | `REVIEW MANIFEST_MATCH_REVIEW` | pendiente |
| Snapshot repetido / conflictivo | Releer / cambiar manifest | `ALREADY_STORED` / `CONFLICT`, sin folios | pendiente |
| Histórico sin snapshot (reproceso) | Reproceso de los 17 históricos | `HISTORICAL_LOCKED`, error técnico controlado (falla cerrado), sin escritura | pendiente |
| Histórico sin snapshot (escaneo automático) | Histórico ya emitido seguido de un Excel P2 nuevo | `SKIPPED_HISTORICAL` y el siguiente archivo termina `COMPLETADA` (sección 15) | **pendiente de ejecución real** |
| Reproceso ERROR / CANCELADA / COMPLETADA | Desde Hub (ADMIN) | hijo único con folios nuevos / rechazo `NOT_ELIGIBLE_STATE` | pendiente |
| Error antes / después de reservar | Excel inválido / forzar fallo de PDF | sin folios / reserva conservada, fallo del propietario | pendiente |
| Dos workers | runner de concurrencia | un propietario, B espera `Lock/advisory` | pendiente |
| Torreón con partidas repetidas | Excel Torreón | una remisión por OC; partidas completas en el manifest | pendiente |
| P5/P6 | Excel P5 y P6 | series y cantidades como validado | pendiente |
| Timeout del Hub | n8n lento | Hub informa timeout, nunca éxito; reintento idempotente | pendiente |
| Worker interrumpido | cortar ejecución tras la reserva | conciliar con la sección 6 sin duplicar | pendiente |

## 10. Resultado real del corte 015 en `daubert_hub_test` (2026-10-22)

- **Compuertas**: worktree/commit `461170c`; workflow anterior despublicado y `cat_test` exclusiva de ese workflow (confirmado por el usuario en la UI de n8n; la IA no tiene API key de n8n);
  0 ejecuciones PROCESANDO y 0 backends de `n8n_cat_test`; respaldo `daubert_hub_test_pre015_20261022-155448.dump` con SHA-256 validado. **No verificado**: que otra credencial de n8n distinta de `cat_test` use `n8n_cat_test` (sin acceso de solo lectura); una credencial así dejaría de funcionar para las cinco funciones legado.
- **Aplicación**: `apply-caterpillar-015-test.ps1 -Apply` => `PRECHECK_015_PASS`, `UP applied`, `POSTCHECK_015_PASS`. 015 quedó **APLICADA Y VALIDADA (SQL)** en TEST.
- **Permisos reales**: `n8n_cat_test` sin EXECUTE en las 5 funciones legado; EXECUTE solo en admitir, reprocesar, guardar snapshot, registrar, finalizar y fallo (los helpers `_015` no son ejecutables); `daubert_hub_test_user` y PUBLIC sin EXECUTE; sin DML directo sobre las tablas protegidas.
  El worker conserva `fn_crear_o_resolver_documento`, `fn_resolver_ejecucion_para_reproceso` y `fn_resolver_ruta_automatizacion` (lectura/metadatos) y dos funciones de trigger.
- **`caterpillar-015-verify.cjs`**: `TEST_015_VERIFY_PASS`. Su línea base por defecto es `--since 169` (mayor ejecución en el corte): las filas anteriores incluyen fixtures históricos `*_SERIE_OVERLAP` (reservas solapadas deliberadas, 58/59 y 66/67) y ejecuciones sin snapshot previas a 014; no son defectos de 015.
  `readonly-check` ya no sirve como precheck tras el corte (su precheck falla a propósito: el contrato legado desapareció).
- **Pruebas SQL reales** (`apps/api/test/caterpillar-015-real.test-runner.cjs`; usa la conexión `postgres` con `SET LOCAL ROLE n8n_cat_test`): `TEST_015_REAL_PASS`, 42 comprobaciones.
  Fase A (todo en ROLLBACK, nada persiste): captura inicial / repetida / conflicto / documento inexistente / manifest inválido / histórico 214 protegido; gate sin snapshot no reserva; admisión con propietario y rango; reintento del mismo worker; segundo worker sin derecho;
  cantidad y serie incorrectas; registro y finalización solo del propietario e idempotentes; programa emitido no se reemite; nombre distinto con contenido V1 idéntico => `MANIFEST_MATCH_REVIEW` sin folios; nombre nuevo con contenido distinto admitido;
  reproceso de COMPLETADA rechazado, de ERROR crea un hijo con folios nuevos, repetido no emite, histórico sin snapshot rechazado; bypass con funciones legado, DML directo y rol Hub denegados.
  Fase B (dos backends reales): B queda esperando `Lock/advisory`; si A hace ROLLBACK, B adquiere. Fase C (con COMMIT): B ve `PROGRAM_IN_PROGRESS` con propietario A, queda una sola ejecución y una sola reserva; el fixture se cerró como ERROR por el wrapper del propietario (reserva ABANDONADA).
- **Datos de prueba que quedaron en TEST** (identificables, no operativos): 3 documentos `HUB_TEST_015_*` con snapshot, sus 3 series `HUB_TEST_015_B…/B…/C…` con ruta, y 1 ejecución fixture (192, ERROR, reserva 900000-900001 ABANDONADA). Los 209 documentos originales, las series operativas y la ejecución 117 no se tocaron.
  Los identity de ejecuciones avanzaron por las fases con ROLLBACK (comportamiento normal de PostgreSQL).
- **n8n**: no se importó nada (sin API key). Pendiente importar `INSPECT` y luego `FULL` con la UI, según la sección 9.

## 11. Prueba de fallo y recuperación (copia FAILURE TEST)

- `candidate-015/caterpillar-test-015.FAILURE.INACTIVE.json` (generada por `prepare-enabled.cjs`) es FULL con tres diferencias: `Convertir PDF CAT` siempre termina con `exit 1` (tras reservar folios, antes de registrar remisiones); `Registrar fallo PG` finaliza la ejecución como `ERROR` terminal con `ops.fn_finalizar_caterpillar_test`; `Preparar error CAT` atribuye un fallo de PowerShell a `Convertir PDF CAT`. FULL e INSPECT no cambian. Solo manual; Schedule y webhook deshabilitados (ruta distinta de la de FULL).
- Defecto encontrado en la rama de errores de FULL: `ops.fn_fallo_caterpillar_test` solo cuenta un intento (1 de 2) y deja la ejecución en `PROCESANDO`; bajo 015 ningún reintento puede volver a ser propietario (`PROGRAM_IN_PROGRESS`), por lo que la ejecución quedaría atascada. Un error controlado debe finalizar con `ERROR`. Pendiente de promover a FULL tras validar esta prueba.
- Esperado: ejecución `ERROR`, reserva `ABANDONADA` (folios consumidos, no reutilizados), 0 remisiones, 0 PDFs, log en `04_ERRORES`, HTML temporal eliminado. Recuperación: reproceso con FULL normal.

### 11.1 Resultado real (ejecución 204) y promoción a FULL
- n8n 10569 / ejecución PG 204 (documento 330): fallo provocado en `Convertir PDF CAT`; `ERROR`, reserva 137 (P2, folios 157–160) `ABANDONADA`, 0 remisiones, 0 PDFs nuevos, log en `04_ERRORES`, sin HTML temporal; `caterpillar-015-verify.cjs` PASS; 193/194/199/200/201/202 sin cambios.
- Promovido a FULL (solo `Registrar fallo PG` y `Preparar error CAT`; el comando de conversión no cambia): el error se finaliza como `ERROR` con `ops.fn_finalizar_caterpillar_test` (propietario verificado) y solo un fallo de `Convertir PDF CAT` con admisión propia confirmada puede finalizar; un error de `Normalizar` nunca usa contexto de otra iteración.
- Comprobado en TEST con ROLLBACK: si se finalizara `ERROR` con remisiones ya registradas, el reproceso queda `REVIEW / PARENT_HAS_ACTIVE_REMISSIONS` (sin folios); finalizar `ERROR` sobre una ejecución `COMPLETADA` falla (`55000`). Estructuralmente solo `Normalizar` y `Convertir PDF CAT` llegan a la rama de error, y la conversión ocurre antes de registrar remisiones.

## 12. Integración Hub TEST → n8n (botón Reprocesar)
- Arranque: `npm run dev` en la raíz (`scripts/dev-test-only.cjs`): exige `TEST_DATABASE_URL` → `daubert_hub_test` (guard en vivo al arrancar), API en :3000 y Vite en :5173 con proxy `/api`. `apps/api/.env` (ignorado por git) debe tener `CATERPILLAR_REPROCESS_WEBHOOK_URL` y `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN` (igual al Header Auth del webhook).
- Test URL de n8n: pulsar *Listen for test event* en el nodo webhook antes de cada solicitud (sirve una sola).
- Defecto corregido: el candidato 015 respondía `status: PROCESSING`, que el cliente del Hub no acepta (`INVALID_RESPONSE` → 502 aunque la hija se hubiera creado). Ahora responde `REPROCESS_CREATED` / `ALREADY_PROCESSING` / `ALREADY_REPROCESSED` (contrato del Hub), con test que pasa la respuesta real del nodo por `CaterpillarReprocessWebhookClient`.

## 13. Regeneración comercial (017) — validación y actualización del FULL

**Migración**: `20261024_017_caterpillar_regeneration_test.{precheck,up,postcheck,down}.sql` (aplicada en TEST con `scripts/apply-caterpillar-sql-test.cjs`). `down` se niega si existe cualquier autorización.
**SQL real**: `node apps/api/test/caterpillar-017-real.test-runner.cjs` (fase A en ROLLBACK) y `… --commit --allow-test-writes` (fase B: dos autorizaciones simultáneas → una fila; dos workers simultáneos → un hijo y una reserva). Resultado: `TEST_017_REAL_PASS`, 54 comprobaciones. Tras 017, `caterpillar-015-real.test-runner.cjs` sigue en `TEST_015_REAL_PASS`.

**Actualizar el FULL ya importado (solo 2 nodos de código; credenciales, rutas y disparadores no cambian)** — el código exacto sale de `caterpillar-test-015.FULL.INACTIVE.json` (se regenera con `node n8n/workflows/remisiones-caterpillar/candidate-015/prepare-enabled.cjs`):
1. Nodo `Normalizar y validar entrada reproceso CAT`: tras `const reasonRaw = cleanText(body.reason);` agregar
   `const kindRaw = cleanText(body.kind); const regeneracion = kindRaw === "REGENERATION"; const kindValido = kindRaw === "" || regeneracion;`; en el objeto de salida agregar `regeneracion,` después de `reproceso_reason: reasonRaw,`; y cambiar `entrada_valida: executionIdValido && reasonValida,` por `entrada_valida: executionIdValido && reasonValida && kindValido,`.
2. Nodo `Validar elegibilidad reproceso CAT`: reemplazar `const estadoElegible = ["ERROR", "CANCELADA"].includes(estado);` por `const estadoElegible = entrada.regeneracion === true ? estado === "COMPLETADA" : ["ERROR", "CANCELADA"].includes(estado);`.
(La corrección `REPROCESS_CREATED` del nodo `Mapear resultado creación reproceso CAT` debe estar ya aplicada.) Guardar sin publicar.

**Prueba de punta a punta en n8n TEST (la ejecuta el operador)**: 1) con un programa P2 nuevo ya COMPLETADO (PDFs reales), cancelar **todas** sus remisiones con el botón de cancelación del Hub; 2) *Listen for test event* en el webhook y, como ADMIN, pulsar **Regenerar** con un motivo; 3) esperar 202 «Regeneración iniciada»; 4) verificar en PostgreSQL: una fila en `autorizaciones_regeneracion_caterpillar` con tu usuario y motivo, ejecución nueva `COMPLETADA` con `reproceso_de_id` = la original, folios nuevos, PDFs nuevos, original y remisiones canceladas intactas, `caterpillar-015-verify.cjs` PASS; 5) repetir el botón: debe responder `ALREADY_REGENERATED` sin emitir; 6) volver a copiar el Excel (mismo nombre o modificado) a `00_ARCHIVOS A PROCESAR` y comprobar que el gate lo bloquea sin folios.

## 14. Resultado E2E real de la regeneración comercial (n8n TEST, 2026-10-23) — CERRADO

Recorrido real **Hub (ADMIN) → webhook n8n TEST → PostgreSQL → PDFs**, con un caso nuevo y aislado (`PROGRAMACION DE ENTREGA CAT P2 PRUEBA REGEN 017 20261023.xlsx`, documento 361). Las ejecuciones 201, 202, 207 y 210 no se tocaron.

| Paso | Evidencia (consultas de solo lectura + `caterpillar-017-e2e-report.cjs 237`) |
| --- | --- |
| Generación normal (FULL) | Ejecución **237** `COMPLETADA` (n8n 10812), snapshot V1 guardado, reserva **170** `APLICADA` folios **173–176**, 4 remisiones, 4 PDFs |
| Cancelación formal (Hub, ADMIN) | Las 4 remisiones `CANCELADA` con **4 registros** en `cancelaciones_remisiones`; 0 vigentes |
| Regenerar (Hub, ADMIN, motivo) | Autorización **9** (usuario ADMIN, motivo y request id registrados) vinculada a la ejecución nueva |
| Ejecución regenerada | Ejecución **238** `COMPLETADA` (n8n 10832, `reproceso_de_id` = 237, mismo documento 361), reserva **171** `APLICADA` folios **177–180** (nuevos), 4 remisiones `GENERADA`, 4 PDFs; **8 PDFs** en total, todos existen en disco |
| Original conservada | 237 sigue `COMPLETADA`, reserva 170 `APLICADA`, remisiones 173–176 `CANCELADA` con su historial |
| Idempotencia | Segunda solicitud desde el Hub: **HTTP 200 `ALREADY_REGENERATED`**; existe una sola hija (238); sin folios extra |
| Reingreso del Excel original | Se reutilizó el mismo documento 361 (no se creó otro); **sin ejecuciones nuevas, sin reservas, sin remisiones**; `REMISION_CAT_P2` sigue en **181**. El motivo exacto, reproducido sin efectos (el gate en una transacción que siempre se revierte): `BLOCK / REGENERATION_AUTHORIZATION_REQUIRED` apuntando a la ejecución 237 |
| Verificadores finales | `caterpillar-015-verify.cjs`: `TEST_015_VERIFY_PASS` (0 violaciones, 0 funciones antiguas ejecutables por el worker). Reporte 017: 0 `PROCESANDO`; las **51 reservas `RESERVADA` históricas de TEST** son exactamente las del baseline previo (ids idénticos), sin modificarlas |

Reconciliación del FULL: los cambios manuales hechos en el FULL de TEST (cierre terminal en `ERROR`, `REPROCESS_CREATED`, los dos nodos de entrada de la regeneración) ya están en el candidato del repositorio (`caterpillar-test-015.FULL.INACTIVE.json`, generado por `prepare-enabled.cjs`); la comparación contra el export vivo se hace con `compare-full` (ver el procedimiento de exports en `prod-cutover-016.md`, sección 11).

## 15. B1 — omitir históricos ya emitidos sin detener el lote (preparado; pendiente de la prueba real en n8n TEST)

**Causa.** Un documento anterior a 015 con ejecución terminal, remisiones o reservas y sin snapshot no puede capturar uno: `ops.fn_guardar_snapshot_caterpillar(_test)` **devuelve** el texto `HISTORICAL_LOCKED` (no lanza excepción). `Verificar snapshot CAT` solo admite `STORED`/`ALREADY_STORED` y falla en un nodo sin salida de error, así que el primer histórico detenía todos los archivos siguientes. En PROD hay 11 de esos archivos en las carpetas escaneadas.

**Corrección mínima** (FULL TEST y candidato PROD, mismos nodos): entre `Guardar snapshot admisión CAT` y `Verificar snapshot CAT` se agregan
- `¿Histórico ya emitido?` (IF booleano estricto): `$json.estado === "HISTORICAL_LOCKED" && ($("Propagar documento origen PG").first().json || {}).mode !== "REPROCESS"`. Verdadero → `Omitir histórico CAT`; falso → `Verificar snapshot CAT` sin cambios.
- `Omitir histórico CAT` (Code, sin SQL ni I/O): devuelve `{ resultado: "SKIPPED_HISTORICAL", snapshot_estado, documento_origen_id, file_name, file_path, hash_archivo, motivo }` y se conecta a `Loop Over Items`.

Qué **no** cambia: solo el valor exacto `HISTORICAL_LOCKED` se omite; en reproceso (`mode = REPROCESS`) sigue fallando cerrado; `CONFLICT`, `UNAVAILABLE`, texto distinto o ausente llegan al verificador y abortan; un error de PostgreSQL (conexión, permisos, `P0002`, `22023`, `55000`) se produce en `Guardar snapshot`, antes del IF. No se escribe nada, no se inventa snapshot, no hay ejecución, reserva, folios ni PDF, y el archivo no se mueve.

**Evidencia automatizada (sin n8n).** `caterpillar-b1-historical-skip.spec.ts` ejecuta el código real de los nodos, las expresiones del IF y las conexiones reales de FULL y del candidato PROD (47 pruebas: topología, omisión, reproceso, 12 valores que no se omiten, continuidad del lote, propagación de errores SQL y paridad con el export vivo de PROD). `caterpillar-b1-historical.test-runner.cjs` repite el recorrido contra `daubert_hub_test` con la función real, siempre con `ROLLBACK`, y comprueba que ejecuciones, reservas, remisiones, snapshots y folios no cambian.

### Prueba real en n8n TEST (la ejecuta el operador)
1. **Aplicar el cambio al FULL vivo** (no hace falta reimportar: se conservan sus ajustes manuales). Abrir `Caterpillar TEST 015 — FULL`, copiar el contenido de `n8n/workflows/remisiones-caterpillar/candidate-015/b1-historical-skip.FULL.paste.json`, pegarlo en el lienzo (Ctrl+V; crea los dos nodos ya conectados entre sí) y reconectar:
   - borrar la conexión `Guardar snapshot admisión CAT → Verificar snapshot CAT`;
   - `Guardar snapshot admisión CAT → ¿Histórico ya emitido?`;
   - `¿Histórico ya emitido?` salida **true** → `Omitir histórico CAT` (ya conectada) y `Omitir histórico CAT → Loop Over Items` (entrada);
   - `¿Histórico ya emitido?` salida **false** → `Verificar snapshot CAT`.
   Guardar. Es la única modificación.
2. **Preparar los archivos** (solo carpeta TEST): `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prepare-caterpillar-b1-test-scenario.ps1`. Deja en `Pruebas\REMISIONES CAT\00_ARCHIVOS A PROCESAR`: la copia del histórico `…SC PLANTA 2 PRUEBA PG FINAL2.xlsx` (documento 268: `COMPLETADA`, 4 remisiones, sin snapshot; modificado 07:00) y el nuevo `…P2 PRUEBA B1 20261026.xlsx` (08:00, contenido nuevo). El `REGEN 017` (documento 361, con snapshot) ya estaba y debe dar `BLOCK` sin folios. Orden esperado: REGEN → histórico → nuevo.
3. **Anotar el estado previo**: `siguiente_folio` de `REMISION_CAT_P2` y el máximo de `ejecucion_id` (`caterpillar-015-verify.cjs` o la consulta de siempre).
4. **Ejecutar** el FULL con el disparador manual (Schedule y webhook siguen deshabilitados).
5. **Esperado en la ejecución de n8n:** estado *Success* (no se detiene en el histórico); `Omitir histórico CAT` con una salida `SKIPPED_HISTORICAL` (`documento_origen_id` 268); el REGEN llega al gate con `BLOCK`/`PROGRAM_ALREADY_EMITTED`; el B1 recorre generación, registro y finalización.
6. **Esperado en PostgreSQL TEST:** una ejecución nueva `COMPLETADA` para el documento B1 con su reserva `APLICADA` y 2–4 remisiones `GENERADA` con PDF en `02_SALIDAS`; **ninguna** ejecución, reserva ni remisión nueva para los documentos 268 y 361; el documento 268 sigue sin snapshot; `REMISION_CAT_P2` avanza solo lo que emitió el B1; ejecuciones 237/238 y las reservas `RESERVADA` sin cambios.
7. **Repetir** la ejecución una vez: no debe haber ejecuciones ni folios nuevos (el B1 da `BLOCK PROGRAM_ALREADY_EMITTED`, los demás se omiten/bloquean).
8. **Limpieza opcional** de los dos archivos: el mismo script con `-Remove`.
Avisar el resultado; con él se cierra B1 en este documento.
