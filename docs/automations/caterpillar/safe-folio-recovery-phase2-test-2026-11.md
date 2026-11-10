# Recuperación de folios Caterpillar — Fase 2 TEST

**Estado: integración aislada verificada; NO HABILITADA; E2E vivo y PR bloqueados.**
Fecha: 2026-11-06. Rama `feat/cat-safe-folio-recovery`, base `16153a8` (1.1.1).
Este informe continúa el [prototipo de Fase 1](safe-folio-recovery-prototype-test-2026-11.md),
sin sustituir sus archivos ni afirmar que la recuperación automática está terminada.

## 1. Preservación

Antes de editar, el worktree solo contenía los cuatro archivos de Fase 1 sin seguimiento.
Se respaldaron en `%TEMP%\opencode\cat-folio-phase1-20261106-phase2.zip`:
SHA-256 `b6450a27992fc3d66eb2a7e606f62d7c85f712d8c93fbb945c2b7edc37ad0691`.
Se cotejaron después contra el ZIP: los cuatro permanecen **idénticos byte por byte**.
Los 13 escenarios originales volvieron a pasar. No se crearon commits ni PR.
El respaldo final de los cambios locales de Fase 1 y Fase 2 se conserva en
`%TEMP%\opencode\cat-folio-phase2-20261106-reviewed.zip`.

## 2. Acceso de migración y privilegios

El procedimiento vigente (`docs/database/migrations.md`, `scripts/apply-caterpillar-sql-test.cjs`)
es manual, con `psql`, como propietario `postgres`, nunca desde el arranque de la API.
La herramienta exige `TEST_DATABASE_URL_MIGRATOR`, usuario `postgres`, base exacta
`daubert_hub_test` y URL sin opciones. Esa variable no está disponible en Process,
User ni Machine ni en las configuraciones TEST revisadas (`apps/api/.env`, `deploy/pilot.test.env`).
No se leyeron configuraciones de producción ni se reutilizaron sus credenciales.

El rol Hub de TEST puede leer el catálogo, pero no crear objetos en `ops`/`operacion`
ni cambiar funciones de las que no es propietario. **GRANT EXECUTE al Hub no resuelve
la necesidad de migración**. La instalación exige al propietario existente para
crear el esquema privado y reemplazar de forma controlada las dos funciones del gate.
No se conceden privilegios administrativos a roles de runtime.

Permisos nuevos, limitados a TEST:

| Rol | Permiso adicional |
| --- | --- |
| `daubert_hub_test_user` | USAGE del esquema privado y EXECUTE de evaluación/solicitud ADMIN |
| `n8n_cat_test` | EXECUTE de inicio/adaptador de admisión; sin DML directo en el ledger |
| `cat_recovery_test_coordinator` | Rol NOLOGIN sin privilegios administrativos ni membresías; EXECUTE de atestación de cuarentena |

El rol coordinador nunca debe compartirse con Hub o n8n. Un servicio automático
necesitará identidad/secreto TEST separado y un mecanismo de custodia revisado;
no se provisionó un login ni se almacenaron contraseñas en esta fase.

### Comandos mínimos para el operador TEST (NO ejecutados contra el TEST compartido)

Desde este worktree y con una sesión administrativa **autorizada para TEST**, sin
extraer contraseñas del despliegue productivo:

```powershell
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
& $psql -X -W -h localhost -p 5432 -U postgres -d daubert_hub_test -v ON_ERROR_STOP=1 -f tools/cat-folio-recovery/phase2/provision-coordinator.test.sql
if ($LASTEXITCODE -ne 0) { throw 'Provisionamiento TEST bloqueado' }
$prefix = 'database/migrations/daubert_global/20261106_025_caterpillar_folio_recovery_test'
foreach ($step in 'precheck','up','postcheck') {
    & $psql -X -W -h localhost -p 5432 -U postgres -d daubert_hub_test -v ON_ERROR_STOP=1 -f "$prefix.$step.sql"
    if ($LASTEXITCODE -ne 0) { throw "Migración TEST bloqueada: $step" }
}
```

`-W` solicita la contraseña al operador; no la imprime ni la incluye en argumentos.
Si no hay acceso administrativo TEST autorizado, no ejecutar estos comandos ni
intentar usar la identidad productiva. El ensayo aislado sigue disponible.
El script de provisionamiento solo crea/verifica un rol NOLOGIN; no lo promueve
ni le asigna membresías. Se probó de forma idempotente en el clúster privado.

## 3. Migración 025 preparada e integración en el gate

Archivos `20261106_025_caterpillar_folio_recovery_test.{precheck,up,postcheck,down}.sql`.
La carpeta histórica se llama `daubert_global`, pero el destino está restringido
por SQL a **`daubert_hub_test`**, propietario `postgres`. No es una migración productiva.
El número 025 evita los números 020–024 ya propuestos en la rama separada de Manufactura.

Se crea `cat_recovery_test`, con:

- `settings.enabled=false` al instalar, sin permisos de modificación para runtime.
- Solicitudes auditables: UUID, padre, reserva original, serie, ADMIN/email, motivo,
  confirmación, snapshot, SHA-256 de origen, manifiesto/hash, timestamps, worker,
  hija, reserva nueva, contador anterior y respuesta de admisión.
- `evaluate`, `request`, `attest`, `start` y `worker_admission`.
- Tablas privadas; SECURITY DEFINER con `search_path` fijo y EXECUTE explícito.
  Se depuran ACL predeterminadas heredadas de todos los objetos nuevos, siguiendo
  el patrón 015; no basta revocar PUBLIC. El ensayo inyecta grants predeterminados
  excesivos y verifica que el worker no pueda activar settings ni atestar archivos.

La migración **no crea un gate alternativo**. Conserva y respalda las definiciones
reales de `fn_admitir_reservar_caterpillar_test` y `fn_reprocesar_reservar_caterpillar_test`.
Solo sustituye la llamada final de reserva por la función privada que decide entre
reserva normal y recuperación. El retorno del reproceso se ajusta únicamente para
que una recuperación duplicada no conceda un segundo `can_emit=true`.
Snapshot, rutas, conflictos de programación, bloqueo de scope/documento/padre y
propiedad del worker siguen pasando por el gate existente.

Las huellas esperadas de las definiciones reales, normalizando exclusivamente CR
de los finales CRLF de `pg_dump` en Windows, son:

- Admisión: `ef6d6be62d23fa570eed7c7cb5c624da`.
- Reproceso: `c572b74411b12c3b43166c08b5c56501`.

La instalación aborta ante deriva de funciones, actividad Caterpillar PROCESANDO,
rol coordinador inseguro o bypass del worker por permisos de escritura/función legada.
El ensayo verificó que conceder artificialmente EXECUTE al reservador legado hace
fallar el precheck; no se concede ese permiso en la instalación.

### Invariantes

Solo original ERROR, reserva única ABANDONADA, último rango (`siguiente=final+1`),
sin reservas posteriores, sin solapes activos ni remisiones en cualquier estado,
sin otra ejecución Caterpillar PROCESANDO. Snapshot y hash de origen se revalidan.
Se copian los folios a una reserva nueva, sin UPDATE del contador ni de la reserva
original. Solicitudes PREPARING/READY mantienen un bloqueo lógico persistente de
la serie, respetado por ambos gates; la reserva recuperada lo conserva mientras
su hija está PROCESANDO. Una reserva convencional no puede adelantarse a la cuarentena.

Una solicitud repetida devuelve los mismos IDs y `can_emit=false` después de
adquirir la reserva. Una nueva recuperación explícita del hijo fallido conserva
la cadena de reservas y requiere otra autorización/evidencia.

### Reversión

Antes del primer uso, ejecutar `down` como propietario TEST: restaura exactamente
las funciones respaldadas, comprueba sus huellas instaladas y elimina el esquema vacío.
Si hay solicitudes/historial, **down se rechaza**. Deshabilitar no autoriza borrar
evidencia ni liberar ciegamente una serie: primero reconciliar solicitudes/archivos
y conservar el ledger. La reversión con historial requiere un procedimiento posterior
revisado; no se ha implementado una purga para facilitar rollback.

## 4. Cuarentena aislada y reconciliación

`tools/cat-folio-recovery/phase2/quarantine.cjs` está restringido a raíces nuevas
`%TEMP%\opencode\cat-recovery-phase2-*` con marcador de aislamiento. **Rechaza raíces
operativas/Dropbox**; no se quitó esa protección para aparentar integración viva.

Exige custodia `ISOLATED_UNRELEASED` ligada a reserva, SHA-256 de origen e inventario
esperado de nombres/folios. Entrega desconocida o conocida, identidad distinta,
archivos no atribuibles, enlaces simbólicos/reparse points/hard links bloquean.
No interpreta una casilla ADMIN como prueba de no entrega.

Cada movimiento registra INTENT → COPY_VERIFIED → MOVED en un diario sincronizado
a disco; la copia es exclusiva, con tamaño y SHA-256 verificados antes de retirar
el nombre original. Nunca se sobrescribe ni se elimina evidencia de cuarentena.
Una interrupción puede dejar ambas copias o un movimiento sin última línea de diario:
el reconciliador revalida bytes/rutas y continúa, o bloquea conservando la evidencia.
Un diario truncado, hash distinto o destino parcial requiere revisión: no se adivina.
El manifiesto COMPLETE solo se genera con salida vacía y cuarentena verificada.

PostgreSQL solo acepta su atestación desde el rol coordinador, comprueba el SHA-256
del texto recibido y su vínculo con solicitud/reserva/origen; usa vigencia de cinco
minutos para la adquisición inicial. Esto no convierte Dropbox en una transacción
distribuida ni demuestra no entrega fuera de la custodia privada de este ensayo.

## 5. NestJS, React y n8n

API nueva, ADMIN, separada del reproceso convencional:

- GET `.../executions/:id/folio-recovery`: condiciones, causas y resumen de cuarentena.
- POST en la misma ruta: crea/repite una solicitud PREPARING, con identidad del
  servidor, motivo, UUID y confirmación. **No inicia PDFs ni llama al webhook convencional**.
- Flag `CATERPILLAR_FOLIO_RECOVERY_TEST_ENABLED=false` por defecto y restricción
  adicional a base exacta TEST. Ni un flag TEST verdadero puede habilitar producción.

React prepara el panel «Reprocesar conservando folios — TEST» dentro del diálogo,
fuera del formulario convencional para evitar que Enter dispare un reproceso con
folios nuevos. Muestra original, planta, rango, reserva, checks, cuarentena y hash,
advertencia de entrega, motivo y confirmación ADMIN. General no consulta ni ve el panel.
Flag `VITE_CAT_FOLIO_RECOVERY_TEST_ENABLED` ausente/false por defecto; los rechazos
no hacen fallback. La acción preparada es autorización/cuarentena, no inicio de emisión.
Regeneración, cancelación y reproceso convencional conservan su lógica.

Se inspeccionó **en lectura la SQLite viva de n8n**, únicamente el workflow TEST
`AgWvTRatRujP9VfW` / `Caterpillar TEST 015 — FULL (INACTIVE, staged)`:
63 nodos, `active=0`, sin `activeVersionId`, entradas con `CAT_TEST_IO_HOLD`.
Su reserva usa el gate `_test`; su convertidor apunta al script TEST de Dropbox/Pruebas.
Este script TEST conserva `Remove-PdfIfExists` y timeout de 20 s: no se modificó.

Se preparó un [borrador de nodo y contrato](../../../n8n/workflows/remisiones-caterpillar/candidate-recovery-test/README.md)
con bloqueo explícito de la rama nueva. No se importó, publicó ni ejecutó el workflow.
El adaptador SQL `worker_admission(request,worker,parent)` devuelve el contrato
actual de diez columnas y se probó contra el gate real restaurado.

## 6. Resultados y evidencia

PostgreSQL 18 nativo, puerto **55441**, datadir privado comprobado antes de cualquier
escritura. Se restauraron con `pg_dump --schema-only --no-owner --no-privileges`
los esquemas reales core/ops/operacion/security/audit, incluidos FKs, índices y triggers,
**sin datos** y sin staging/Manufactura. Los roles runtime se recrearon con grants
acotados; no se afirma que esto sustituya la validación de ACL del TEST compartido.
El servidor privado se detiene al finalizar y conserva los artefactos.

Último ensayo: un sandbox nuevo bajo el patrón portable
`%TEMP%\opencode\cat-recovery-phase2-*` (raíz aislada verificada antes de
cualquier escritura). Allí quedan `test-schema.sql`, `postgres.log`,
`synthetic-conversion.log`, `synthetic-generation.json` y cuatro PDFs
sintéticos. Cada ejecución valida puerto, base y datadir; el helper de fixtures
también rechaza un pool del TEST compartido.

| Comprobación | Resultado |
| --- | --- |
| Prototipo original | 13/13, sin modificar sus cuatro archivos |
| Instalación | precheck/up/postcheck deshabilitado → down restaura gate exacto → up deshabilitado |
| Dos sesiones reales concurrentes | Ambas observadas esperando locks; una hija, una reserva nueva, un permiso de emisión |
| Carrera con admisión convencional | Convencional rechazada por fence; sin nuevo rango silencioso |
| Duplicado | Mismos IDs; segundo permiso de emisión denegado, también al reentrar al gate |
| Fallo de cuarentena | Sin reserva ni hija; diario/archivos conservados; reconciliación posterior aprobada |
| Cuarentena completa, antes de reservar | READY, todavía sin hija/reserva; siguiente 115 |
| Fallo después de insertar reserva, antes de COMMIT | ROLLBACK completo; READY; retry posterior aprobado |
| Nuevo error de la hija | Reserva ABANDONADA, historial intacto; otra solicitud explícita puede recuperar al hijo |
| Reserva posterior/custodia no demostrada | Rechazo sin fallback |
| Cadena parcial aislada con servicio NestJS compilado | Solicitud → atestación sintética sin PDFs previos → adaptador/gate real → 4 PDFs reales del convertidor TEST → registro → COMPLETADA/APLICADA; cuarentena física parcial probada en escenario separado |
| Invariantes del ensayo | Original intacta; 111–114 recuperados; siguiente 115; cuatro remisiones sintéticas |
| Cuarentena, pruebas Node | 9/9, incluidas interrupciones y hard links |
| API completa | **2.437 pruebas / 151 archivos aprobados**, incluidas 11 nuevas de acceso/validación/aislamiento |
| Web completa | **1.261 pruebas / 90 archivos aprobados**, incluidas 13 nuevas |
| Dev-guard | 19/19 |
| Typecheck, lint, build | Aprobados |
| Audit de producción de dependencias | `npm audit --omit=dev`: 0 vulnerabilidades; sin cambios de dependencias |

La primera corrida Web tuvo cinco timeouts de 5 s en archivos existentes ajenos
a Caterpillar. La corrida completa con `--maxWorkers=2 --minWorkers=1 --reporter=dot`
pasó sin aumentar timeouts ni modificar esos módulos. Un intento anterior de esa
corrida fue cortado por el límite del terminal; la corrida final concluyó en 342,88 s.
Se corrigieron el error de sintaxis del pin SQL, la normalización CRLF del dump y
la metadata de decoradores en el test HTTP (patrón existente de Vitest/esbuild).
No quedan fallos conocidos de esas validaciones.

## 7. Bloqueos y condiciones de habilitación

**No hay E2E vivo Hub → n8n TEST → PostgreSQL compartido → archivos.** No se
instaló 025 en el TEST compartido: el inspector sigue devolviendo `installed=false`.

Antes de habilitar cualquier recuperación allí:

1. Operador con acceso administrativo TEST dedicado: respaldo, revisión de SQL/ACL,
   coordinación de cutover sin PROCESANDO y precheck/up/postcheck, dejando enabled=false.
2. Aprobar custodia privada real y evidencia de entrega del flujo TEST. El coordinador
   actual es deliberadamente de sandbox; no basta quitar el guard de ruta ni mover en Dropbox.
3. Preparar una copia del workflow TEST vivo que transporte requestId/padre/hash sin
   cambios de identidad, use el adaptador y respete `can_emit=false`; adaptar staging
   sin quitar indiscriminadamente los controles actuales de rutas e I/O.
4. Reconciliar pérdida de respuesta después de COMMIT: un retry no puede volver a
   emitir automáticamente. Una hija PROCESANDO sin confirmación de archivos requiere
   revisar al worker antes de continuar. La prueba de duplicado demuestra cierre
   seguro, no recuperación automática completa de ese intervalo.
5. Ejecutar E2E autenticado y todos los fallos exigidos sobre fixtures, con dos
   sesiones y evidencia de archivos/SQL. Solo después evaluar flags TEST en sesión controlada.

Para considerar un PR: E2E anterior aprobado, permisos reales verificados, rollback
con historial revisado, revisión de seguridad del protocolo archivo/SQL y comprobación
de que los cambios convencionales siguen siendo equivalentes. No se ha publicado PR,
ni rama remota, ni se adelantó la versión; el alcance sigue separado de 1.2.0.

Producción, `daubert_global`, ejecuciones 27/28, reservas 16/17, ajuste 3, workflows
productivos, folios y convertidor productivo no recibieron cambios. No hubo despliegue,
envío de correos ni modificación del tag v1.1.1. Los cuatro archivos de Fase 1 quedan
como evidencia histórica; los avisos de sus pruebas embebidas no describen los ensayos
nativos nuevos de esta Fase 2.
