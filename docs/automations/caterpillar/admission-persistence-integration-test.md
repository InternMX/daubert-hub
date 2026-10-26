# Fase 5C — snapshot real en TEST con ROLLBACK

## Estado y alcance

El operador comunicó aplicación manual de 014 en `daubert_hub_test`: POSTCHECK_014_PASS,
209 documentos originales conservados, fingerprint original sin cambios, 0 snapshots y PostgreSQL 18.4.
También indicó 17 documentos históricos que no deben modificarse. Es evidencia recibida, no una
comprobación independiente realizada en esta sesión.

Durante la preparación 5C del agente faltaban ambas variables TEST: no hubo conexión ni escrituras
desde esa sesión. Al iniciar 5D, el operador confirmó **TEST_SNAPSHOT_INTEGRATION_PASS**, persistencia,
idempotencia y ROLLBACK satisfactorios, 209 documentos conservados y 17 históricos sin snapshot,
sin cambios en PROD. Es evidencia recibida; no se repite la integración ni se afirma validación HTTP.
No se aportó aquí un runId/archivo de salida adicional. No aplicar nuevamente 014 ni ejecutar su up/down.

## Comando preparado (PowerShell desde el worktree)

Requiere `TEST_DATABASE_URL_MIGRATOR` (postgres) y `TEST_DATABASE_URL` (daubert_hub_test_user),
URLs explícitas de la misma instancia/base TEST, sin query/hash. Configurarlas por el mecanismo
autorizado en la MISMA consola; no imprimirlas ni escribir contraseñas literales en historial/archivos.
Las variables de otra consola no se propagan al agente ya iniciado. No hay fallback DB_* ni dotenv.

```powershell
$CompanyId = Read-Host 'empresa_id de origen Caterpillar TEST autorizado'
node apps/api/test/caterpillar-admission.integration.runner.cjs --company-id $CompanyId --allow-test-writes
```

La empresa se valida como ACTIVO y debe tener un documento histórico Caterpillar del ámbito indicado
para la comprobación de rechazo. No se crea/modifica empresa ni se adivina su ID. Si el baseline ya no
coincide con 209 documentos / 17 históricos / 0 snapshots, el runner se detiene ANTES del INSERT; revisar
la nueva evidencia, no relajar el control para conseguir PASS.

## Identidad, permisos y aislamiento de sesión

- Verifica ambas conexiones reales: base exacta TEST, roles esperados y mismo servidor/puerto.
- Ejecuta únicamente el postcheck 014 read-only; no hay DDL ni migraciones.
- Verifica permisos efectivos de SELECT sobre las relaciones que usa el repositorio, USAGE en esquemas,
  UPDATE de la columna y que el runtime no sea administrativo. No concede permisos.
- Revisa esquema, reglas, checks y triggers de documentos antes de crear el fixture. Una definición
  desconocida requiere revisión. Esto evita aceptar efectos auxiliares no recuperables por rollback.
- Usa las clases TypeScript actuales del repositorio, compiladas en memoria por ts-node, SIN bootstrap
  Nest/API, config de conexión de la aplicación, cookies, webhooks o .env.

`DatabaseService.query` normalmente usa Pool.query, que NO fija un backend entre llamadas.
El runner no lo instancia: inyecta un adaptador query vinculado al único PoolClient de la transacción.
No se modifica la clase de producción. Antes de cada llamada comprueba base, current_user, PID y xid.
Una sesión nueva, transacción terminada o rol incorrecto detiene la prueba.

El fixture lo inserta el migrador dentro de BEGIN; SET LOCAL ROLE limita después las operaciones
del repositorio a los privilegios efectivos de daubert_hub_test_user. Su login real se comprobó además
por una conexión independiente solo de lectura. El runner prueba código de API y permisos SQL,
no un endpoint HTTP de una API desplegada.

## Fixture y garantía de reversión

- Únicamente un documento nuevo con marcador UUID, empresa TEST aprobada, tipo PROGRAMACION_ENTREGA
  y rutas `E2E-NO-FILE` de metadatos: no crea ningún archivo real.
- Identificador int8 positivo aleatorio, comprobado libre, con INSERT OVERRIDING SYSTEM VALUE.
  Así no se consume nextval de la identity: una secuencia normal NO se revierte con ROLLBACK.
- Todas las columnas se suministran explícitamente para no disparar defaults no revisados.
- La transacción del fixture no tiene camino de COMMIT. El postcheck previo usa su propia transacción
  READ ONLY. ROLLBACK del fixture se ejecuta en finally, también ante fallo de una aserción.
- El adaptador permite UPDATE solo de caterpillar_admission sobre el ID sintético y empresa aprobada.
  Si el repositorio intentase actualizar el histórico de prueba, lo rechaza ANTES de enviarlo al servidor.
- Rechaza inicialización distinta de la columna conocida y efectos no revisados de triggers/reglas.
- Después de ROLLBACK comprueba ausencia del fixture, fingerprints/conteos originales de documentos,
  ejecuciones, remisiones, detalles, reservas, series y cancelaciones, y estado de la secuencia identity.
  No restaura ninguna tabla o contador si hay diferencias: informa fallo y exige diagnóstico.

Los casos esperados son STORED, FOUND, ALREADY_STORED, CONFLICT, HISTORICAL_LOCKED y NOT_FOUND
(empresa fuera de ámbito). No genera ejecuciones, remisiones, reservas o PDFs.

No ejecutar más de una prueba de escritura simultánea ni durante actividad que cambie el baseline.
El runner no detiene n8n ni otras automatizaciones para obtener esa ventana.

## Validación local

Las pruebas de `caterpillar-snapshot-rollback.spec.ts` usan cliente ficticio y el repositorio real;
comprueban la sesión única, rollback en éxito/fallo, rechazo de escrituras ajenas y falta de variables.
La persistencia SQL se sigue probando en PGlite en memoria. Ninguna de estas unitarias usa Daubert.

El TEST_SNAPSHOT_INTEGRATION_PASS comunicado acredita captura/readback/idempotencia/conflicto
y rollback según el operador. No habilita admisión automática, regeneración, n8n ni reserva;
la cobertura histórica y el control transaccional de emisión siguen pendientes.
