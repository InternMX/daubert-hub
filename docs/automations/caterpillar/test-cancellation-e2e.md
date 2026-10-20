# Cancelación Caterpillar — preparación E2E TEST (fase 2B)

## Estado y límites

Código revisado. **No se aplicó 013 a Daubert ni se ejecutó el runner E2E TEST**.
Los tests locales usan mocks/PGlite y un clúster nativo propio, efímero, no Docker.
Este procedimiento requiere autorización posterior para migración y escrituras sintéticas en
`daubert_hub_test`. No requiere tocar n8n ni generar/leer archivos operativos de Dropbox.

### Decisión de migración

El repo gestiona SQL manual con un operador, sin migraciones al arrancar la API ni historial central
comprobado. `docs/database/migrations.md` describe también paquetes externos y está parcialmente
desactualizado respecto a los archivos locales 010–013. No se consultó ese directorio externo.
013 no colisiona en el directorio local; un paquete histórico `000…013` de otra fecha no es el mismo
identificador. Confirmar registro externo antes de aplicar. No se duplicó el SQL en una variante TEST:
la misma fuente tiene guardas por base/rol y el runner de abajo impone exclusivamente TEST.

Los cuatro archivos son `database/migrations/daubert_global/20261020_013_caterpillar_cancellation.*.sql`.
Precheck/up rechazan objetos existentes (incluidas secuencias huérfanas y sobrecargas). No son scripts
"IF NOT EXISTS": una segunda ejecución aborta de forma controlada; una instalación existente se
comprueba con postcheck. Si es parcial o tiene otra definición, investigar; no borrar/reemplazar a ciegas.

Preflight comprueba tipos/NULL, PK requeridas, trigger BEFORE ROW UPDATE de revisión, rol de runtime
y ausencia de privilegios de actualización general o por columna. Postcheck exige tabla/identity,
defaults, PK/UNIQUE/FK/CHECK, propietario, función SECURITY DEFINER, search_path y huella de cuerpo,
sin sobrecargas ni triggers ajenos y con privilegios efectivos mínimos (incluidas membresías).
Cambiar el cuerpo de la función exige actualizar y revisar las huellas de postcheck/down.

### Política de lectura del respaldo (fase 2C)

`daubert_backup` puede conservar SELECT heredado de `pg_read_all_data` sobre el ledger y su
secuencia identity. SELECT de secuencia permite leer su estado; no autoriza `nextval`/`setval`.
El postcheck exige un login INHERIT no administrativo, sin BYPASSRLS, con membresía efectiva de
lectura y sin otros caminos de membresía/herencia/SET ROLE ni CREATE sobre `operacion`.
La excepción es exclusivamente para ese principal verificado: no permite EXECUTE de cancelación,
escritura de tabla/columna ni USAGE/UPDATE de secuencia. Otros roles de aplicación y PUBLIC siguen
sin lectura del ledger o secuencia. Los roles predefinidos `pg_*` conservan el tratamiento del
postcheck original; sus capacidades heredadas por logins no quedan exentas.
Esta corrección solo modifica validación de lectura; no cambia up.sql, grants, membresías ni función.

Regresiones nativas aisladas (sin leer conexiones TEST/DB):

```powershell
node apps/api/test/caterpillar-cancellation-privileges.ephemeral.runner.cjs --bin "C:\Program Files\PostgreSQL\18\bin"
```

## Seguridad revisada

- React solo manda motivo/revisión; IDs int8 van en la ruta. `userId`, `usuario_id`, `requestId`, folio,
  planta, serie y rutas en el body se rechazan. El controlador usa la identidad de AuthGuard, que
  resuelve una sesión vigente; el request ID lo genera el servidor, no el navegador.
- PostgreSQL vuelve a validar ADMIN/ACTIVE y contraseña no pendiente; toma nombre/email históricos
  de `security.users`, sin leer credenciales. No se concede EXECUTE a PUBLIC/n8n.
- **Límite residual del rol compartido:** quien controle las credenciales SQL de Hub puede pasar el ID
  de otro ADMIN. Ni un parámetro ni `app.user_id`/GUC demuestran la identidad humana: ambos son
  manipulables por ese login. No se añadió una comprobación falsa entre dos valores controlables.
  Mitigación actual: credencial solo servidor, queries parametrizadas, guards de sesión/rol, grants
  mínimos, snapshots de identidad y request ID. El login compartido sigue siendo un principal técnico
  confiable, como en el modelo existente. Si se exige atribución resistente a compromiso del backend,
  hará falta otro límite de confianza (fuera de esta fase), no un header/GUC adicional.
- Función con `search_path=pg_catalog, pg_temp`, relaciones totalmente calificadas, sin SQL dinámico
  de usuario. Advisory compartido de esquema → usuario FOR SHARE → ejecución FOR UPDATE → remisión
  FOR UPDATE. Cancelaciones de una ejecución se serializan; las de ejecuciones distintas no comparten
  bloqueo exclusivo. El down toma el advisory exclusivo antes de inspeccionar/bloquear el ledger.
- No hay camino conocido inverso de esos locks en finalización (bloquea ejecución, no usuario).
  Locks tomados por administración arbitraria pueden causar timeout/deadlock; la transacción revierte
  y la API devuelve error saneado. Reconsultar antes de reintentar; nunca restaurar filas automáticamente.
- Revisión exacta: UTC con seis fracciones de segundo, comparación textual sin JS Date. El preflight
  exige timestamptz NOT NULL y trigger habilitado; no se elimina la concurrencia optimista.
- COMPLETADA es un hecho histórico: cancelar una remisión no la cambia ni vuelve a finalizar la
  ejecución. Los agregados de GENERADA son de remisiones actualmente vigentes, no un snapshot del
  número emitido originalmente. Conservar fila/PDF y auditoría evita confundir ambos conceptos.
- Retry CANCELADA conserva la evidencia original incluso con revisión antigua. Una CANCELADA
  histórica sin ledger sigue sin actor/fecha inventados. La cancelación no demuestra ausencia de envío.

## Pruebas locales seguras (no Daubert)

`caterpillar-cancellation.sql.spec.ts` prueba SQL en memoria; `caterpillar-cancellation-preflight.spec.ts`
ensaya esquema incompatible, instalación parcial y privilegios por columna. `caterpillar-cancellation-guards.spec.ts`
solo importa guardas puras: no ejecuta el runner TEST.

Con PostgreSQL instalado localmente, el runner nativo crea su propio data directory aleatorio bajo
`node_modules/.cache`, escucha solo en loopback/puerto libre, verifica `data_directory` y crea una base
sintética en ese clúster. No lee DB_* ni TEST_* ni toca el servicio PostgreSQL instalado.

```powershell
node apps/api/test/caterpillar-cancellation.ephemeral.runner.cjs --bin "C:\Program Files\PostgreSQL\18\bin"
```

Comprueba dos backends reales: el primero mantiene la cancelación sin commit, el segundo espera un
lock visible en pg_stat_activity; después devuelve ALREADY_CANCELLED y hay una sola auditoría.
Detiene exclusivamente su clúster y elimina su directorio propio. Se ejecutó localmente con resultado
`NATIVE_CONCURRENCY_PASS`; esto no equivale a E2E contra el esquema/datos reales de Daubert TEST.

## Autorización y configuración previa de TEST

Requiere autorización explícita del operador para pasos de escritura y una ventana TEST sin actividad
concurrente sobre los datos observados. No se desactivan workflows desde el runner. Si hay actividad
de fondo, una comparación puede fallar: investigar; nunca restaurar un baseline sobre datos nuevos.

Preparar fuera de logs, usando el mecanismo autorizado de credenciales:

- `TEST_DATABASE_URL_MIGRATOR`: postgres, base exactamente daubert_hub_test.
- `TEST_DATABASE_URL`: daubert_hub_test_user, misma base/servidor.

No se leen `.env` ni variables DB_* como fallback. Se rechazan URL con query/hash que puedan
sobrescribir base/host/rol y se verifica current_database/current_user en ambas conexiones antes de
cualquier escritura. Ninguna URL/cookie/password se imprime o se guarda en evidencia.

El runner arranca una API local propia con el runtime TEST y un puerto libre. El hijo recibe solo
variables permitidas; no recibe el URL administrativo y tiene todos los webhooks explícitamente vacíos
(incluida sobreescritura de un .env local). No se acepta una URL de API externa. Autenticación real
con el helper existente `support/test-auth.cjs`: usuarios/sesiones sintéticos, sin bypass de producción.

## Comandos exactos (PowerShell, desde el worktree)

No ejecutados en esta fase. Conservar `$RunId` entre comandos/sesiones; no usar IDs operativos.

```powershell
$RunId = [guid]::NewGuid().ToString()
$Runner = 'apps/api/test/caterpillar-cancellation.test-e2e.runner.cjs'
```

### 1. Prechecks — solo lectura de TEST, con autorización de acceso

```powershell
node $Runner precheck --run-id $RunId
```

Registra evidencia local sin secretos en `node_modules/.cache/cat-cancel-e2e/<RunId>.json`: servidor,
huella del SQL y fingerprints de tablas protegidas. El directorio es local e ignorado, no un backup.

### 2. Aplicar exclusivamente a TEST — requiere autorización de DDL y backup

Confirmar precheck aprobado, numeración, revisión de triggers y punto de restauración TEST.

```powershell
node $Runner apply --run-id $RunId --allow-test-writes
```

El comando exige evidencia de precheck de ese mismo servidor y SQL, y que el baseline no haya cambiado.
Ejecuta el up transaccional una sola vez. NO ejecuta E2E ni fixture alguno por sí mismo.

### 3. Postchecks — solo lectura

```powershell
node $Runner postcheck --run-id $RunId
```

Si 013 ya estaba instalada con esta definición exacta, se puede empezar con postcheck y un RunId nuevo
sin intentar reaplicarla. Toda diferencia implica revisión; no se actualiza el cuerpo unilateralmente.

### 4. E2E sintético — requiere autorización de escrituras y failpoint TEST

```powershell
npm run build --workspace=@daubert/api
node $Runner e2e --run-id $RunId --allow-test-writes
```

El runner crea empresa, documentos ficticios, serie INACTIVA propia `HUB_CAT_CANCEL_E2E_<UUID>`,
ejecuciones y remisiones con detalles. Los IDs los asigna TEST: no usa ejecuciones 14/22, serie P5 ni
folios históricos. Inserta un rango sintético en la serie nueva sin invocar el allocator ni avanzar
ninguna serie existente. Las rutas PDF son marcadores `E2E-NO-FILE`, nunca se generan archivos.

Comprueba:

1. Detalle con revisión exacta y autenticación real; 401/403/400.
2. ADMIN cancela una remisión; actor, motivo, fecha/request ID confirmados.
3. Reintento sin otra auditoría y CANCELADA histórica sin evidencia fabricada.
4. Rechazo de remisión de otra ejecución/automatización y ejecución PROCESANDO.
5. Revisión obsoleta → 409 tras cambiar solo un registro sintético.
6. Fallo de auditoría → 503 y rollback de la remisión. Para este caso instala temporalmente un trigger
   **solo en TEST**, con nombre UUID y WHEN limitado a una remisión sintética. Lo retira en finally.
7. Dos HTTP concurrentes reales, ambas esperando el lock de una ejecución sintética; una CANCELLED,
   otra ALREADY_CANCELLED. No se reporta concurrencia aprobada si no se observan las esperas.
8. Estado histórico, detalles, PDFs, hermanos y fingerprints de series/reservas/ejecuciones/pagos intactos.
9. GET autenticados de Audi y Pagos siguen respondiendo 200. Es smoke read-only, no prueba de sus automatizaciones.

La API hija se detiene al finalizar. Los fixtures **se conservan para inspección** hasta limpieza.
Si el proceso se interrumpe, conservar RunId; el comando cleanup descubre filas por marcador exacto.

### 5. Validación independiente de resultados — solo lectura

```powershell
node $Runner verify --run-id $RunId
```

Exige las dos auditorías esperadas, siete remisiones sintéticas con estados correctos, siete detalles,
actor/fecha/request ID y tablas protegidas intactas. No lee archivos PDF ni llama a n8n.

### 6. Limpieza — requiere autorización para borrar solo datos sintéticos

```powershell
node $Runner cleanup --run-id $RunId --allow-test-writes
```

Retira failpoint UUID y elimina en orden FK solo ledger/detalles/remisiones/reservas/ejecuciones/
documentos/serie/empresa/automatización auxiliar/usuarios/sesiones/audit de ese marcador. No resetea
secuencias, no hace TRUNCATE ni toca una fila por un ID operativo proporcionado manualmente.
Conserva el JSON de evidencia con estado cleaned. Si había baseline, lo compara sin restaurarlo.
La migración permanece instalada: limpiar fixtures NO es rollback de infraestructura.

## Rollback de infraestructura (no automático)

Requiere otra autorización, sin actividad y con definición conocida. El down toma el lock de esquema
exclusivo y rechaza ledger con cualquier fila. No borra cancelaciones reales para forzar rollback.
Después de datos reales, usar corrección hacia adelante. El runner no incluye comando down.

## n8n y pendientes antes de activar deduplicación

No hay conector autorizado de lectura al workflow TEST vivo en esta sesión. Obtener export vivo con
fecha/versión, nodos/conexiones, respuestas reales del reproceso y salida normalizada preagrupación;
ejemplos autorizados de NUEVOS/ULTIMO_GLOBAL y reglas de revisiones/entregas. Comparar con vectores V1
y confirmar el control entre normalización y reserva. Esto no bloquea validar cancelación: no usa n8n.
