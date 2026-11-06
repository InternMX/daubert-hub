# Asignación puntual: identidad persistente y contrato de extracción

## Alcance y estado de preparación

> **Actualización 2026-10-22.** La funcionalidad está **desplegada y habilitada (fases A y B) en PRODUCCIÓN** mediante las migraciones PROD 015–017 y el Hub `6370753`; pendiente de validar con el primer ZIP real. Estado, despliegue, rollback y checklist: [production-rollout](production-rollout.md). El resto de este documento conserva el contrato y el historial de las migraciones TEST 012–014 y de la validación en TEST.

Trabajo en `feat/payment-notification-file-assignment`, base `cbcb6f3`.
La migración 012 está restringida a **daubert_hub_test**. No contiene backfill,
no toca aliases permanentes ni tablas existentes y no modifica workflows.
La migración y los fixtures se aplicaron manualmente con conexión administrativa
TEST y después se verificaron mediante la conexión efectiva de la API. La API/UI
implementan creación, consulta persistente, cambio y revocación en este modelo.
Esto **no** constituye integración E2E con n8n ni autorización para PRODUCCIÓN.

## Identidad

`core.archivos_notificacion_pago` registra una **ocurrencia**, con PK `archivo_id`
y FK `correo_id` a `core.correos_notificacion_pago`. Su origen único es:

```text
correo_id + adjunto_origen_id + zip_sha256 + entrada_indice
```

- `correo_id`: el mismo que usa el workflow y el `executionId` del Hub.
- `adjunto_origen_id`: ID estable del adjunto obtenido del proveedor del correo,
  no su nombre. Debe conservarse/revalidarse al descargarlo para reproceso.
- `zip_sha256`: SHA-256 de los bytes del ZIP descargado.
- `entrada_indice`: ordinal de la entrada en el directorio del ZIP, base cero,
  no posición de una fila del Hub ni `binary_key_original` de una ejecución.
- `file_sha256`: SHA-256 de los bytes del PDF, calculado por el extractor.
- `nombre_archivo`: informativo y útil para correlacionar errores legados;
  nunca sustituye la identidad de procedencia.

Dos entradas idénticas generan dos `archivo_id` distintos. Registrar de nuevo
la misma procedencia y bytes devuelve el mismo ID. Si esa procedencia produce
otros bytes/nombre, o cambia el ZIP del mismo adjunto/correo, se marca ambigüedad
sin reemplazar los datos originales. No se reconcilia automáticamente.

Cuando el texto legado del error no permita asociar de forma única una fila a
un registro verificado —por ejemplo, mismo hash y nombre repetidos—, el Hub
deberá bloquear esa operación y explicar la ambigüedad. Sin registro individual,
un correo antiguo no será asignable puntualmente.

## Registro confiable, sin API de creación para el navegador

La conexión PostgreSQL del extractor futuro (`n8n_app`) ejecutará:

```sql
SELECT core.fn_registrar_archivo_notificacion_pago(
  $1::bigint,  -- correo_id resuelto desde PostgreSQL
  $2::text,    -- ID del adjunto, obtenido de Outlook/Graph
  $3::text,    -- SHA-256 del ZIP descargado
  $4::integer,-- ordinal de entrada ZIP
  $5::text,    -- SHA-256 del PDF extraído
  $6::text,    -- nombre informativo
  $7::text,    -- alias detectado
  $8::text,    -- código de incidencia o NULL
  $9::boolean,-- identidad de origen/bytes verificada por el extractor
  $10::boolean-- efectos previos descartados positivamente
);
```

Ambas afirmaciones son **false por defecto**. Se registrará antes de copiar el
PDF, crear/actualizar un borrador o producir otro efecto. La última afirmación
solo puede ser true en una ingestión inicial, después de verificar la ocurrencia
en el inventario completo de adjuntos/ZIP y descartar efectos previos de ella.
No se deduce de que falten resultados en PostgreSQL ni de que haya un error de
alias. Para un reproceso/histórico sin evidencia suficiente debe ser false.

La función exige además correo PENDIENTE y ausencia de resultados/borradores
para admitir SIN_EFECTOS. Si no puede asegurarlo, queda INCIERTO. Registrar de
nuevo **nunca** convierte un estado incierto/iniciado en seguro, aunque se envíen
de nuevo las afirmaciones. Esos casos quedan bloqueados para revisión explícita.

El Hub TEST solo recibe SELECT sobre el registro: no puede INSERT, UPDATE,
DELETE ni ejecutar el registrador/resolvedor confiable. No habrá endpoint HTTP
para fabricar o confirmar procedencias desde el frontend.

## Asignación y estados operativos

`core.asignaciones_archivo_notificacion_pago` tiene PK/FK `archivo_id`, FK a
empresa, `estatus` ACTIVA/REVOCADA, versión creciente, actor y fechas de
creación/modificación. Una fila vigente por ocurrencia; los cambios de empresa
y revocaciones conservarán la fila y el historial de auditoría existente.

El registro de origen conserva estados de identidad NO_VERIFICADA/VERIFICADA/
AMBIGUA y estados operativos INCIERTO/SIN_EFECTOS/REPROCESO_SOLICITADO/INICIADO.
Solo VERIFICADA + SIN_EFECTOS puede mutarse desde el Hub, con correo terminal,
sin resultados ni borradores. Se bloqueará el correo completo si esos efectos
agregados no pueden atribuirse con seguridad a un archivo.

`core.fn_archivo_notificacion_asignable(archivo_id, correo_id, bloquear)` permite comprobar
esa condición sin conceder al Hub acceso general a IDs de borradores de Outlook.
Para consultas `bloquear=false` (valor por defecto); las mutaciones deben pasar true.
El bloqueo transaccional común es:

```sql
SELECT pg_advisory_xact_lock(hashtextextended('PAYMENT_FILE:' || $1::bigint::text, 0));
```

El backend deberá mantenerlo durante comprobar versión/identidad y modificar la
asignación. El dispatcher del Hub lo mantendrá durante la comprobación de
asignaciones activas y entrega del reproceso. Antes de una entrega permitida,
`fn_bloquear_archivos_reproceso_pago(correo_id)` congela registros seguros como
REPROCESO_SOLICITADO; un resultado incierto del webhook no los devuelve a seguro.
Las filas de correo/resultados históricos no se reescriben por asignar.

## Consulta y toma futura por n8n

Después de revalidar adjunto, ZIP, ordinal y bytes:

```sql
SELECT * FROM core.fn_resolver_archivo_notificacion_pago(
  $1::bigint, $2::bigint, $3::text, $4::text, $5::integer, $6::text,
  $7::boolean -- false: consulta; true: toma atómica antes del primer efecto
);
```

Devuelve `archivo_id`, `empresa_id` y `asignacion_version`. Una empresa no nula
es la asignación puntual activa y tiene prioridad sobre el catálogo permanente.
Sin asignación activa, `empresa_id` es NULL y se sigue la clasificación habitual.
La empresa seleccionada deberá pasar por las mismas validaciones de configuración,
destino, destinatarios y pipeline existente. No se creará un camino alternativo
para documentos o borradores.

Procedencia incorrecta, identidad ambigua o efectos inciertos producen excepción:
se detiene el archivo, sin aplicar la asignación a otro ni caer silenciosamente
al catálogo de aliases. `tomar=true` resuelve la empresa y marca INICIADO bajo el
mismo bloqueo que las mutaciones del Hub. Una toma repetida también se bloquea;
no se implementa reconciliación automática de efectos.

El extractor conservará el `archivo_id` a lo largo del pipeline y utilizará la
procedencia para resolverlo nuevamente al reprocesar, sin confiar en el nombre.
La integración posterior deberá incorporar este protocolo también en sus entradas
manuales. El Hub no puede interceptar ejecuciones lanzadas directamente desde un
editor n8n que aún no tenga este protocolo.

## API e interfaz implementadas

```text
PATCH /api/automations/payment-notifications/:executionId/files/:fileId/assignment
{
  action: "ASSIGN" | "CHANGE" | "REVOKE",
  companyId?: "empresa existente y activa (salvo REVOKE)",
  expectedVersion: 0 | "versión actual recibida del servidor",
  confirmed: true
}
```

No existe una ruta HTTP para registrar identidades. El DTO rechaza hashes,
nombres, procedencias y actores enviados por el frontend. Se valida pertenencia
del ID registrado al correo y correlación única con la incidencia persistida.
ASSIGN usa versión cero si no hay fila; una revocada puede reactivarse con su
versión vigente. Cambios/revocaciones conservan el registro y su auditoría.

El GET de detalle existente enriquece cada archivo con `fileAssignment`: ID
registrado, habilitación, permiso efectivo, explicación de bloqueo, estados de
identidad/operación, asignación ACTIVA/REVOCADA y versión. No se devuelven al
navegador identificadores de adjuntos para que fabrique procedencias. La respuesta
incluye `fileAttentionSummary` con total, asignados pendientes, sin asignación y
puntuales pendientes, calculados desde la base actual y los aliases permanentes.
Se vuelve a consultar ese detalle después de guardar y al reabrir.

El modal existente ofrece los dos alcances y comparte el mismo buscador. Si no
hay identidad confiable, la opción puntual se muestra bloqueada con explicación;
el alias permanente sigue disponible. Una puntual activa tiene prioridad visual
y muestra aviso de integración pendiente, con cambio/revocación confirmados.

Para habilitar las mutaciones en una API de TEST:

```text
DB_NAME=daubert_hub_test
EXPECTED_DATABASE_NAME=daubert_hub_test
PAYMENT_FILE_ASSIGNMENTS_TEST_ENABLED=true
```

Se valida también la base efectiva antes de cada mutación. Fuera de
daubert_hub_test las operaciones se rechazan aunque alguien configure el
indicador. El valor por defecto es false. La compatibilidad n8n permanece false
en código, sin un indicador que permita fingir que esa integración ya existe.
El backend rechaza reprocesos con asignaciones ACTIVA, incluso si se desactiva la
función posteriormente. El listado oculta la disponibilidad y el POST vuelve a
comprobar bajo bloqueo. Un fallo de comprobación no debe convertirse en despacho.
El esquema ausente conserva el camino normal de aliases/reprocesos, sin depender
de estas tablas para funcionar antes de su instalación en otra base.

El dispatcher serializa con las asignaciones y COMMITea REPROCESO_SOLICITADO
antes de llamar al webhook. Así, la ventana del 202 asíncrono o una excepción de
red no vuelve a habilitar cambios de empresa sobre archivos que pudieron tomarse.
No se ejecuta HTTP dentro de una transacción larga. Solo el componente confiable
resolverá y tomará esos archivos con el contrato descrito antes del primer efecto.

## Aplicación manual en TEST

Con conexión administrativa y **base daubert_hub_test comprobada**, ejecutar en
orden (detenerse ante cualquier error, sin ignorarlo):

1. `database/migrations/daubert_global/20261019_012_payment_file_assignment_test.precheck.sql`
2. `database/migrations/daubert_global/20261019_012_payment_file_assignment_test.up.sql`
3. `database/migrations/daubert_global/20261019_012_payment_file_assignment_test.postcheck.sql`
4. `apps/api/test/payment-file-assignment.fixtures.sql`

El último archivo crea solo datos sintéticos prefijados
`HUB_TEST_FILE_ASSIGNMENTS_V1`, con empresas y correos aislados. También comprueba
el contrato SQL: idempotencia, copias idénticas, conflictos, ZIP cambiado,
procedencia NULL rechazada y que la toma no pueda resetearse. Las filas de
borradores/resultados son fixtures de base de datos; no se llama a Outlook ni n8n.
No crea ni elimina usuarios. No ejecutar de nuevo si ya existe ese juego de datos.

La migración down se niega a eliminar tablas que tengan datos. La limpieza de
fixtures se hará solo con confirmación posterior y por su marcador exacto, sin
afectar los usuarios sintéticos anteriores ni datos de otros desarrollos.

## Validación y revisión local

- SQL administrativo de fixtures: pruebas de registro idempotente, ocurrencias
  repetidas, conflictos de procedencia, ZIP cambiado, NULL rechazado y toma sin reset.
- `npm run test:integration:payment-file-assignments --workspace=@daubert/api`
  requiere `TEST_DATABASE_URL` y un juego de fixtures recién preparado. Rechaza
  otras bases y juegos ya utilizados, en lugar de borrar/reiniciar historia.
  Arranca la API con destino efectivo TEST verificado, primero con la función
  desactivada, luego activada y finalmente desactivada con asignaciones activas.
  Usa solo un receptor HTTP local simulado: no llama a n8n ni Outlook.
- Se comprueban HTTP/auth/CSRF, versiones y carreras, auditoría antes/después,
  resumen, persistencia, pertenencia de archivo/correo, ausencia de cambios en
  `core.alias_empresa` por operaciones puntuales y continuidad del camino permanente.
- Los fixtures y la identidad sintética nueva se conservan para revisión; no se
  limpian los usuarios de pruebas anteriores. No repetir la integración sobre el
  mismo juego modificado sin revisar/preparar de nuevo fixtures administrativamente.
- Vista temporal de componentes reales: `tmp/point-visual/`, ignorada por Git,
  servida solo en `http://127.0.0.1:5185/`, sin `.env` ni proxy/API real. Las
  interacciones se simulan en memoria y recargar restablece los ejemplos.
  Iniciar desde el worktree con:

```powershell
node node_modules/vite/bin/vite.js --config tmp/point-visual/vite.config.mts
```

Los mocks no forman parte del entry point productivo y su configuración rechaza
builds. La validación funcional real descrita arriba usa PostgreSQL TEST y la API,
no este mock visual. **La integración E2E con n8n está pendiente**: faltan el
registro confiable en la extracción, la preservación de procedencia/archivo_id,
el consumo prioritario y la toma antes de efectos en el pipeline existente,
validar rutas/destinatarios/configuración por empresa y pruebas de idempotencia
en todas las entradas, incluidas las manuales. No basta con cambiar un indicador.

## Integración n8n TEST (migraciones 013 y 014) y habilitación del reproceso puntual

Estado: el workflow de n8n TEST aislado ya registra la identidad por archivo, consulta la asignación puntual antes del
catálogo permanente y toma el archivo antes del primer efecto (ver `n8n-test-aislado/REPORTE.md`, fuera del repositorio).
Sigue siendo **solo TEST**: nada de esto está habilitado ni instalado en PRODUCCIÓN.

- **013** (`20261020_013_*`): `core.fn_consultar_archivo_notificacion_pago`, consulta/toma con resultado estructurado
  (`PROCESABLE_ASIGNADO`, `PROCESABLE_SIN_ASIGNACION`, `REINTENTO_ASIGNADO`, `COMPLETADO`, `YA_TOMADO`, `EFECTOS_INCIERTOS`,
  `IDENTIDAD_AMBIGUA`, `IDENTIDAD_NO_VERIFICADA`, `CONFLICTO_IDENTIDAD`, `CONFLICTO_VERSION`). EXECUTE solo para `n8n_app_test`.
- **014** (`20261021_014_*`): evaluador interno compartido (`fn_evaluar_archivo_notificacion_pago`, sin permisos para ningún
  rol) y `core.fn_reproceso_asignaciones_puntuales(correo_id)`, **solo lectura** (`STABLE`), con EXECUTE solo para
  `daubert_hub_test_user`. Evalúa todos los archivos con asignación activa con las mismas reglas de la 013 y devuelve
  `elegible`, `asignaciones_activas` y `bloqueos`. Sin asignaciones activas el correo es elegible. El Hub no recibe permisos de
  registro ni de toma.
- **Hub**: con `PAYMENT_FILE_ASSIGNMENTS_N8N_READY=true` el despacho y `reprocessAvailable` usan esa función en lugar de bloquear
  cualquier asignación activa. La integración solo es efectiva si TAMBIÉN se cumplen: base `daubert_hub_test`,
  `PAYMENT_FILE_ASSIGNMENTS_TEST_ENABLED=true` y que `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL` tenga el mismo origen que
  `PAYMENT_FILE_ASSIGNMENTS_N8N_TEST_ORIGIN`, y el destino sea uno de una lista cerrada de destinos TEST (host, puerto y ruta exactos, `http`, sin credenciales ni query): `host.docker.internal` (Hub en Docker), `127.0.0.1` o `localhost` (Hub como proceso de Windows) en el puerto 5678 con la ruta `/webhook/daubert-hub-test/notificaciones-pago/reprocesar`, y temporalmente la instancia aislada 5690. El webhook productivo se rechaza siempre. Además debe existir el token del webhook.
  Un fallo, una función ausente o un veredicto no afirmativo mantienen el bloqueo (`POINT_FILE_ELIGIBILITY_UNAVAILABLE` /
  `POINT_FILE_REPROCESS_BLOCKED`). El aviso «pendiente de integración n8n» solo desaparece cuando el estado de cada archivo
  informa `n8nReady=true`.

### Workflow n8n: validado en la instancia aislada vs. workflow real de TEST

| | Workflow validado (n8n aislado, 127.0.0.1:5690) | Workflow real de TEST (`Test Notificacion de pagos a Proveedores`) |
| --- | --- | --- |
| Estado | Validado E2E (Hub TEST → n8n aislado → `daubert_hub_test`) con Outlook y Dropbox **simulados** | **No está listo para ejecutarse**: no se ha importado ni probado con la integración |
| Credencial PostgreSQL | Solo `n8n_app_test` | `Postgres pruebas` = rol compartido `n8n_app`, **sin EXECUTE** sobre `fn_consultar_archivo_notificacion_pago` (013): fallaría y bloquearía cada archivo (fail-closed) |
| Outlook / Dropbox | Stubs sin efectos | Credenciales y carpetas reales |
| Webhook | `/webhook/daubert-hub-test-aislado/notificaciones-pago/reprocesar`, token propio | Misma ruta y credencial que el n8n productivo (instancia compartida) |
| `fflate` | Permitido en el contenedor aislado | Requiere `NODE_FUNCTION_ALLOW_EXTERNAL=fflate` en la instancia compartida con PRODUCCIÓN (reinicio) |

El export con la integración (registro **después** de clasificar y **antes** de cualquier efecto en la ingesta inicial, con el
código de la incidencia que el Hub correlaciona; registro previo solo en reprocesos; consulta/toma estructuradas con la 013) se
genera fuera del repositorio y no se versiona aquí. Antes de usarlo en el n8n compartido hay que decidir la credencial
(`n8n_app_test` o un permiso explícito para `n8n_app`), el `fflate` y la ruta/credencial del webhook.

### Paso a PRODUCCIÓN (hecho el 2026-10-21/22)

Las migraciones 012–014 siguen siendo exclusivas de `daubert_hub_test`. Sus equivalentes productivos son `20261022_015…017_*_prod` (guardadas para `daubert_global`, aplicadas manualmente), con permisos mínimos: `n8n_app` solo `EXECUTE` en registrar y consultar; el Hub con las funciones de lectura/bloqueo. El workflow de Pagos v2 (108 nodos) se construyó sobre el workflow vivo de PROD. Las banderas productivas (`PAYMENT_FILE_ASSIGNMENTS_PROD_*`) son independientes de las de TEST. Detalle, rollback y checklist del primer ZIP real: [production-rollout](production-rollout.md).
