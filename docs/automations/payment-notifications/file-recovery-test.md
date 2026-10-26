# Recuperación individual sin efectos — validación en TEST

Estado: implementado y probado el 2026-10-23 en `daubert_hub_test`, API local temporal
en 3127 y `n8n-test-aislado` (5690). Sin cambios en PRODUCCIÓN.
Preparación productiva posterior (019 y delta sobre el export real, todavía sin desplegar):
[procedimiento de promoción y caso histórico](payment-file-recovery-promotion.md).
La migración 018 fue aplicada manualmente por el administrador, después de confirmar
el precheck; las pruebas verificaron la base conectada antes de escribir.

## Regla

El estado terminal del correo no demuestra que n8n terminó: una rama puede escribir
`ERROR` mientras otras siguen generando borradores. Por eso el despacho y el ejecutor
comparten el bloqueo `PAYMENT_FILE:<correo>` y una fila de propiedad en
`core.recuperaciones_notificacion_pago`:

- `SOLICITADO`: el Hub congeló archivos antes de llamar al webhook.
- `PROCESANDO`: un único ejecutor de n8n adquirió el correo.
- `FINALIZADO`: el padre esperó que terminara el subworkflow completo y confirmó su cierre.

Antes de los efectos de proveedor, el hijo registra únicamente archivos con incidencia
`ALIAS_NO_CATALOGADO` / `ALIAS_AMBIGUO`, identidad registrada, resolución sin asignación
y `archivo_tomado=false`. PostgreSQL comprueba archivo, correo, adjunto, hash del ZIP,
índice, hash del PDF, nombre, código de error y estado nunca tomado.

Solo después del retorno exitoso de **Execute Workflow, waitForSubWorkflow=true**,
el padre confirma el cierre. Se revalidan los candidatos y se cambian solo esos archivos
de `REPROCESO_SOLICITADO` a `SIN_EFECTOS`, guardando `sin_efectos_ejecucion`.
La actualización y el cierre del propietario son atómicos y auditados.

`fn_archivo_notificacion_asignable` acepta un correo parcialmente procesado solo con
esta evidencia positiva. Sin evidencia nueva conserva la regla anterior. Un archivo
`INICIADO`, `INCIERTO`, ambiguo o de otro correo no se rehabilita. La API tampoco permite
elegir una empresa que ya tenga resultado o borrador en ese correo: se evita agregar
silenciosamente el PDF a un agregado ya procesado.

El Hub no puede registrar ni confirmar evidencia ni cambiar la propiedad directamente.
Los ejecutores usan las funciones estrechas con `SECURITY DEFINER` y `search_path` fijo;
no reciben UPDATE sobre la tabla nueva.

Un timeout, caída o ejecución sin confirmación deja el propietario cerrado a nuevos
intentos. No hay expiración por tiempo, desbloqueo desde GET ni backfill histórico.
Recuperar un propietario caído requiere revisión independiente; no se inventa evidencia.

## Cambios

- Migración `20261023_018_payment_file_recovery_test.{precheck,up,postcheck}.sql`:
  una tabla, una columna de evidencia, inicio/observación/finalización, elegibilidad
  y comprobación de empresa destino. Rechaza cualquier base distinta de TEST.
- `payment-file-assignments.repository.ts`: conflicto 409 al existir propietario;
  comprobación del destino dentro de la transacción de asignación. El contrato
  `canManage` / `safe`, la identidad, las versiones y la autenticación se conservan.
- `scripts/n8n/build-payment-recovery-test.cjs`: delta offline sobre el harness TEST
  ya existente. Genera un padre y un hijo separados, sin modificar ese harness.
  Rechaza IDs productivos, nodos Outlook/HTTP reales y credenciales ajenas al TEST aislado.
- Pruebas unitarias del delta y del conflicto, y runner de integración dedicado.

No se versiona el export completo de Pagos ni credenciales.

## Repetir la prueba

1. Aplicar precheck, up y postcheck de 018 en una conexión administrativa TEST,
   con `ON_ERROR_STOP=1`. No volver a aplicar el up si ya existe la tabla.
2. Disponer del n8n aislado y del harness previo en
   `<N8N_TEST_HOME>/wf/out/harness_reproceso.json`, con credencial
   `pgTestAisladoCred01` apuntando exclusivamente a `daubert_hub_test`.
3. Proporcionar en el entorno del proceso, sin imprimir secretos:
   `TEST_DATABASE_URL` (rol Hub TEST), `TEST_DATABASE_URL_N8N_APP`
   (rol `n8n_app_test`), `N8N_TEST_HOME` y `RUN_N8N_PAYMENT_RECOVERY=true`.
4. Ejecutar desde la raíz:

   ```powershell
   npm run test:integration:payment-file-recovery --workspace=@daubert/api
   ```

El runner necesita Docker, Python (biblioteca estándar) y PostgreSQL TEST.
Crea fixtures con prefijo `HUB_TEST_RECOVERY_`, nunca utiliza el correo productivo 44,
y conserva las filas sintéticas para revisión. Arranca y detiene su propia API local.
Genera PDFs/ZIP sintéticos, escenarios y eventos bajo un subdirectorio único de
`<N8N_TEST_HOME>/data/payment-recovery-<uuid>`; no sobrescribe escenarios previos.

Importa exclusivamente `pnRecoveryParentTest01` y `pnRecoveryBodyTest01` en el contenedor
`n8n-test-aislado`. Publica el hijo porque n8n requiere un subworkflow publicado;
ese hijo solo tiene Execute Workflow Trigger, sin Schedule ni webhook.
El padre tiene inicio manual y además verifica el prefijo sintético del correo.
No hay llamadas reales a Outlook o Dropbox. Los eventos de borrador/adjunto son stubs.

## Evidencia obtenida

- 11 grupos de comprobaciones de integración aprobados.
- Caso SQL/API: correo sintético **549**, archivo **480**, recuperado y asignado.
- Caso n8n completo: correo sintético **553**, archivo **508**. ZIP con 13 PDF:
  doce ya tomados con resultados/borradores y uno sin alias. Tras la primera ejecución
  terminó rehabilitado; luego se asignó por la API y se lanzaron dos invocaciones
  concurrentes. Resultado: un resultado, un borrador y un adjunto nuevos, sin duplicados.
- Las doce filas de resultados, doce de borradores y doce de archivos previos se
  compararon completas (JSON), no solo por conteo: permanecieron idénticas.
- Hash incorrecto, ZIP incorrecto, índice incorrecto, dueño ajeno, atestación ausente,
  correo pendiente y archivo tomado después de observarlo: rechazo.
- Cierre repetido: sin segunda rehabilitación. Dos adquisiciones concurrentes:
  un solo ganador. Terminar sin evidencia no abre el archivo.
- Alias permanentes intactos; cambios de recuperación presentes en `audit.cambios`.
- API: 1870 pruebas / 132 archivos aprobados, typecheck, lint y build aprobados.
  Para la suite unitaria completa se suministraron variables DB ficticias de TEST
  (algunos módulos validan configuración al importarse); no credenciales productivas.

Los fixtures de bloqueo deliberado quedan cerrados como representación de estados
inciertos. No son ejecuciones reales de n8n aún corriendo. También se conservaron
fixtures sintéticos de los ensayos fallidos de preparación; no se hizo limpieza global.

## Promoción posterior: requiere autorización y preparación específica

Este directorio contiene una migración **solo TEST** y un generador de harness,
no un paquete listo para ejecutar en PRODUCCIÓN. Los pasos siguientes describen la
separación de responsabilidades; la preparación 019 está detallada en el enlace anterior.

1. Revisar el delta probado y preparar una contraparte PROD de 018, con guarda
   `daubert_global`, roles `daubert_hub_app` y el rol n8n autorizado, preservando el
   resto del cuerpo y los permisos mínimos. Preparar sus pre/postchecks y guardar
   las definiciones anteriores de las dos funciones reemplazadas para rollback.
2. Sobre un export autorizado y actualizado del workflow productivo, preparar el
   padre/hijo equivalente. Conservar las credenciales, rutas, validaciones de zona,
   borradores y destinatarios reales. No importar los JSON del harness de TEST.
3. Encaminar **todas** las entradas de reproceso, incluido el inicio manual, por el
   mismo propietario. El hijo no debe tener un inicio alterno que lo evite. El padre
   debe esperar el retorno completo del hijo y no continuar al fallar este.
4. En una ventana sin ejecuciones de Pagos ni nuevas solicitudes de reproceso,
   respaldar y aplicar SQL, instalar el delta de n8n y desplegar la API coordinadamente.
   SQL debe existir antes de ejecutar la API nueva; el SQL de propiedad no debe quedar
   atendido por el workflow antiguo, que no sabe finalizar propietarios.
5. Verificar permisos y realizar una validación autorizada. Ninguna migración debe
   rehabilitar filas existentes ni asignar automáticamente empresas. El caso real
   necesita evidencia obtenida por el flujo nuevo y confirmación de empresa/configuración.
6. Si se decide revertir: sin ejecuciones en curso, volver coordinadamente a API,
   workflows y definiciones anteriores; conservar tabla, columna y auditoría nuevas.
   No borrar borradores, resultados o propietarios para simular que no hubo efectos.

No se ejecutó ninguno de estos pasos productivos ni se reprocesó el correo 44.
