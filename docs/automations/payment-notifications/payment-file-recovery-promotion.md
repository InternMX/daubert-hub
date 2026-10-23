# Promoción preparada: recuperación individual de archivos de Pagos

**PREPARADO, NO DESPLEGADO.** Base `origin/main` = `d9ea09c`. La rama incluye
únicamente la corrección TEST aprobada y su preparación productiva. No hubo cambios
en daubert_global, importaciones/publicaciones en n8n PROD, reprocesos del correo 44,
cambios de archivos reales ni reinicios productivos. No hay cambios de Audi o Caterpillar.

Ensayo aislado posterior de estas candidatas, UP/DOWN y versiones anteriores:
[resultados y condiciones de liberación](file-recovery-rehearsal.md).

## Entregables

- `database/migrations/daubert_global/20261023_019_payment_file_recovery_prod.*.sql`:
  precheck, UP, postcheck y DOWN lógico. Contraparte de la 018 TEST aprobada.
- API: el cambio aprobado en `payment-file-assignments.repository.ts`, con conflictos
  `POINT_REPROCESS_BUSY` / `POINT_DESTINATION_HAS_EFFECTS`. No cambian rutas ni DTO.
- Exportador SQLite **solo lectura** y transformador offline:
  `scripts/n8n/export-payment-workflow-readonly.py` y `build-payment-recovery-prod.cjs`.
- Verificador focalizado: `verify-payment-recovery-promotion.cjs`, pruebas de promoción
  y runner que comprueba las cuatro guardas productivas en transacciones READ ONLY de TEST.
- Manifiesto sin contactos/credenciales en
  `n8n/workflows/payment-notifications/prod/recovery-promotion.manifest.json`.

Los exports contienen filtros, firma y correos operativos reales; conforme a
`n8n/security-notes.md`, **no se suben al PR**. Se generaron fuera del repositorio en
`%LOCALAPPDATA%\Temp\opencode\payment-recovery-prod-preparation\`:

- `payment-production-source.json`: export actualizado publicado, respaldo de referencia.
- `payment-recovery-prod-parent.json`: padre candidato, ID `pagosProdAsignaciones01`.
- `payment-recovery-prod-child.json`: hijo nuevo, ID `pagosProdRecuperacion01`.
- Manifiestos locales con hashes. Todos los candidatos están **inactivos**.

La carpeta temporal es un artefacto de preparación, no el respaldo durable del despliegue.
Antes de promover, guardarla en el almacenamiento privado aprobado y verificar sus hashes.

## Fuente y diferencias exactas

Se leyó SQLite con URI `mode=ro`, `PRAGMA query_only=ON` y una transacción de lectura;
no se utilizó la CLI contra la instancia productiva ni se exportaron credenciales.
Fuente capturada el **2026-10-23 21:00:21 UTC**:

| Dato | Valor |
|---|---|
| Workflow activo | `pagosProdAsignaciones01`, 108 nodos |
| Versión publicada | `38dcf262-fa5a-45c1-b79c-8f03d95f4cc1` |
| Copia editable | `488ece04-1c01-420d-90ca-fe519439a43f` |
| Diferencia editable/publicada | Solo posiciones visuales; código, conexiones y credenciales iguales |
| SHA-256 del export fuente | `47e15801d582e1f00d866e3dd21575907b492e61170e84750aca1055806e6295` |

El transformador fija este hash: una fuente diferente obliga a revisar el drift,
actualizar el manifiesto y revisar el PR; no se adapta silenciosamente a otra versión.

**Padre: 108 → 111 nodos.** Los 108 nodos originales permanecen idénticos, incluidos
parámetros, SQL, código, credenciales, paths y posiciones. Conserva settings, estáticos,
Schedule, filtro Outlook, webhook/autenticación y selección manual. Cambian exactamente
dos conexiones: las salidas de `Seleccionar correo a reprocesar` y
`Preparar solicitud Hub reproceso` pasan por:

1. Adquirir exclusividad de reproceso (SQL, propietario = ejecución del padre).
2. Procesar reproceso y esperar (Execute Workflow, espera obligatoria y error propagado).
3. Confirmar fin de reproceso (SQL, mismo propietario).

La ingesta programada conserva su recorrido original. El reproceso que antes entraba
directamente a `Preparar correo para reproceso` ahora entra al hijo. El nodo original
permanece en el padre para conservar el export, pero ninguna entrada soportada de
reproceso llega a él directamente.

**Hijo: 106 nodos.** Sale del export productivo, no de un harness: conserva los 103 nodos
de procesamiento tras retirar Schedule, manual, selector, webhook y preparación de
solicitud Hub. Añade Execute Workflow Trigger, registro de evidencia y conservación de
items tras el SQL. Mantiene la lógica de clasificación, duplicados, Outlook y Dropbox
literalmente. Solo acepta llamadas de workflows del mismo propietario. No tiene entrada
manual, Schedule ni webhook. Reutiliza la referencia actual de PostgreSQL productivo.

Los logs/IDs del procesamiento de un reproceso corresponderán al hijo; la fila de
propiedad guarda el ID del padre. Registrar ambos IDs en la evidencia operativa.
Se conserva la referencia al Error Workflow en ambos contextos. El ensayo aislado
confirmó dos invocaciones y dos logs críticos por un fallo hijo/padre, sin correos:
el manejador actual solo escribe logs. Se acepta expresamente mantener esos dos
ERROR_CRITICO: representan dos ejecuciones de la misma cadena, no correos duplicados.
Se conserva la arquitectura validada y no se eliminan los nueve nodos potencialmente
inalcanzables ni se implementa otra arquitectura en este PR.

**SQL 019:** los cuerpos de las seis funciones son iguales a TEST 018. Cambian la guarda,
roles y controles de instalación/rollback. Se añaden tabla/columna y cuatro funciones;
se reemplazan solo `fn_archivo_notificacion_asignable` y
`fn_bloquear_archivos_reproceso_pago`. No hay UPDATE/backfill de comprobantes en el UP.
Los fingerprints de las definiciones vigentes se obtuvieron con SELECT y protegen
contra reemplazar una revisión diferente. Se normaliza únicamente CR/LF al comparar.

Permisos: `postgres` propietario; n8n_app recibe EXECUTE en inicio/observación/finalización;
daubert_hub_app recibe SELECT en la tabla de propiedad y EXECUTE en comprobación de destino.
Sin escritura directa sobre la tabla nueva para los roles de aplicación ni EXECUTE público.
La instalación aborta si los privilegios por defecto introducen accesos inesperados.

## Caso histórico LUA TANY: decisión explícita

Consulta de solo lectura del **2026-10-23 14:58 UTC−06**:

- Correo 44 `ERROR`; archivo 3 `VERIFICADA`, `REPROCESO_SOLICITADO`, sin asignación.
- Hash `ab7a8cd0cf8e14e51cf1c4c90d23f3ad3ce957bbd091bb2b2707289e28c8ef80`.
- 12 resultados y 12 borradores. Auditoría del archivo: registro `SIN_EFECTOS` a las
  10:55:14 y congelación por el Hub a las 11:52:58; ninguna rehabilitación posterior.
- Reprocesos históricos revisados: 10243, 10265 y 10271, posteriores a ingesta 10101.
  No produjeron evidencia del nuevo contrato. La tabla 019 no existe aún en PROD.
- PRINTME (85) es una candidata que debe confirmar Contabilidad, no una asignación
  deducida por código. Actualmente no tiene configuración operativa de pagos ni
  resultados/borradores en el correo 44.

**El despliegue no recupera este caso por sí solo.** No ejecutar `fn_finalizar` con un
ID histórico, inventar un propietario, marcar `tomado=false` desde el Hub o restaurar
`SIN_EFECTOS` con un UPDATE. Los logs anteriores son evidencia de investigación, no una
ejecución adquirida/finalizada por el contrato nuevo.

El camino normal podría generar evidencia nueva mediante un reproceso nuevo: los
filtros existentes excluyen efectos de PDFs/empresas ya resueltos, como se probó en TEST.
Pero vuelve a descargar/leer/clasificar el ZIP completo y puede escribir logs, carpeta
de errores y resumen. **No hay en este PR un verificador histórico exclusivo del archivo 3
que garantice no volver a recorrer los otros comprobantes.** No se propone ejecutar ese
reproceso como parte del despliegue ni se garantiza el desbloqueo de 44 sin otra acción.

Para atender solo ese pago con las restricciones actuales, la alternativa mínima es
una **operación manual supervisada**, autorizada por separado:

1. Contabilidad confirma empresa, destinatarios y comprobante. No crear un alias
   permanente para sortear el bloqueo ni activar PRINTME automáticamente.
2. Volver a verificar hash/procedencia del PDF de errores; revisar Outlook en vivo para
   descartar un envío/adjunto manual previo (no cubierto por las trazas del workflow).
3. Archivar/adjuntar únicamente ese PDF y revisar un único borrador, con doble
   comprobación de empresa antes de un eventual envío autorizado.
4. Registrar en ticket/acta la identidad correo 44/archivo 3, hash, empresa confirmada,
   operador y referencia del borrador/envío. El Hub permanece bloqueado; no fingir una
   transición de recuperación en PostgreSQL.

Si se exige asignarlo desde el Hub sin recorrer el ZIP completo, hace falta un flujo
de verificación exclusiva con evidencia nueva, transición auditada y validación TEST
adicional. **No está implementado ni aprobado por este PR**; no se fuerza una excepción
histórica dentro de la migración.

## Despliegue coordinado — procedimiento FUTURO, requiere autorización

1. **Antes de la ventana:** confirmar el commit aprobado, respaldo durable de PostgreSQL,
   respaldo consistente de n8n (base/config/claves según operación existente), export de
   la versión publicada, definiciones/ACL de las funciones, imágenes/Compose/env del Hub.
   Verificar restaurabilidad y hashes. No usar una copia simple de SQLite abierto sin WAL.
2. **Cerrar entradas:** bloquear mutaciones de Pagos en el acceso al Hub durante la
   ventana y despublicar solamente el workflow de Pagos. No reiniciar n8n. Esperar a que
   no haya ejecuciones activas/en espera de Pagos; no confundir el PENDIENTE histórico 38
   con una ejecución activa. No comenzar SQL mientras puedan entrar llamadas manuales.
3. **Revalidar fuente:** export actualizado solo lectura y contraste de hash/versión.
   Si cambió, detener y revisar el delta. Asegurar que el ID del hijo nuevo no colisiona
   con otro workflow. Conservar el padre anterior listo para restaurar, sin activarlo.
4. **SQL:** como propietario postgres, conexión explícita a daubert_global y
   `ON_ERROR_STOP=1`: precheck → UP 019 → postcheck. Cada archivo tiene guarda de base.
   No ejecutar la 018 TEST ni ejecutar funciones de toma/recuperación como verificación.
5. **Workflow candidato:** importar el hijo inactivo y publicarlo (solo Execute Workflow
   Trigger); importar el padre candidato inactivo, conservando su ID y webhook original.
   Revisar referencias de credenciales, hijo correcto, Error Workflow y ausencia de
   una entrada alternativa de reproceso. No ejecutar nodos manualmente para probarlo.
6. **Hub:** actualizar exclusivamente el Hub mediante el procedimiento existente,
   con SQL ya disponible y manteniendo el bloqueo de mutaciones. No cambiar banderas,
   webhooks ni credenciales por simple suposición. Verificar GET health y versión.
7. **Activación:** publicar el padre nuevo, comprobar que solo él posee el webhook y
   Schedule de Pagos, y retirar el bloqueo de acceso únicamente con SQL/API/workflow
   compatibles. Usar activación/publicación por interfaz/API de n8n que registre los
   triggers sin reiniciar el servicio. No dejar la versión antigua atendiendo las
   funciones nuevas. **GET health no basta:** comprobar el webhook real sin token;
   debe rechazar con 403 antes de abrir entradas (404 implica ruta aún no registrada).
8. **Verificación:** metadatos/ACL, GET del Hub, `canManage` sin mutaciones y ausencia de
   ejecuciones/errores inesperados. La primera validación funcional con efectos reales
   necesita autorización y supervisión propias. No utilizar automáticamente el correo 44.

## Rollback coordinado

### Preflight obligatorio antes de reabrir entradas

- Registrar ID y versión publicada efectiva de padre `pagosProdAsignaciones01` e hijo
  `pagosProdRecuperacion01`, y contrastar sus artefactos con el manifiesto. La versión
  publicada es la que cuenta, no una copia editable ni solo el ID del workflow.
- Confirmar que el hijo está publicado/disponible para Execute Workflow, que el padre
  apunta a ese hijo, conserva `waitForSubWorkflow=true` y propaga sus errores. No ejecutar
  el hijo con datos reales para hacer este chequeo.
- Confirmar padre publicado, Schedule activo y webhook registrado una sola vez a su
  nombre: `POST /webhook/daubert-hub/notificaciones-pago/reprocesar`.
- Desde el entorno de red del **API del Hub**, comprobar la URL exacta configurada en
  `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL`, no la URL del editor, `/webhook-test/`,
  una ruta de TEST o una comprobación hecha únicamente desde el servidor n8n.
  Enviar POST con JSON vacío **sin** `X-Daubert-Automation-Token`: debe responder **403**
  en autenticación, sin crear una ejecución. No imprimir ni transmitir el token real.
- Si hay 404, timeout, error TLS/DNS, otra respuesta o discrepancia de versión/identidad,
  mantener las entradas cerradas. Health=200 por sí solo no habilita la apertura.
- No reabrir mutaciones de Pagos hasta que SQL, Hub, hijo, padre y ruta autenticada estén
  listos y se haya guardado la evidencia del preflight. Este documento no autoriza
  ejecutar ahora esa comprobación en PROD ni reprocesar el correo 44.

### Interrupción, 502 o falta de confirmación

SOLICITADO puede significar que el despacho se congeló antes de una entrega incierta;
PROCESANDO identifica un propietario adquirido, no prueba que todavía esté ejecutándose.
Ni un 502 ni un correo en ERROR demuestran que n8n no produjo efectos.

1. Cerrar entradas afectadas y conservar request ID, correo, propietario, ID del padre,
   IDs de hijos, versiones, tiempos, respuestas y logs. No hacer reintentos ciegos.
2. Conciliar la fila de propiedad con las ejecuciones reales de n8n, incluyendo hijos,
   ejecuciones activas/en espera/fallidas y posibles efectos de archivos/borradores.
3. No inventar evidencia de finalización, reutilizar IDs históricos, actualizar estados
   arbitrariamente ni borrar propietarios/registros para permitir un reintento o DOWN.
4. Si no se puede demostrar el resultado, mantener el bloqueo y escalar a intervención
   controlada con evidencia independiente. No hay expiración automática ni un comando
   de desbloqueo genérico en este PR.

**Rollback completo** significa restaurar SQL, workflow y Hub compatibles después de
drenar y finalizar el trabajo. **Cierre seguro de entradas** solo contiene el incidente:
no es un rollback completo ni autoriza DOWN cuando un propietario sigue sin resolver.
La recuperación histórica del correo 44 permanece fuera del PR y del despliegue.

- Mantener/cerrar nuevamente las mutaciones. Despublicar padre nuevo y esperar a sus
  hijos. Conservar exports, IDs de ejecución, filas y auditoría antes de intervenir.
- Si el UP falló, su transacción revierte; confirmar la baseline y restaurar el padre
  anterior sin publicar una combinación incompatible.
- Si falló antes de procesar trabajo, o todos los propietarios están FINALIZADO:
  ejecutar DOWN 019; restaurar la imagen anterior del Hub y el export anterior inactivo;
  verificar fingerprints y publicar la versión anterior antes de reabrir acceso.
- DOWN es **lógico**: restaura los dos cuerpos previos y revoca accesos a funciones/tabla
  nuevas, pero conserva tabla, columna y auditoría. No borra pagos, asignaciones, borradores,
  evidencia ni estados de archivos. No reutilizar el UP para reactivar: exige revisión
  específica si detecta objetos retenidos por un rollback.
- Si hay un propietario SOLICITADO/PROCESANDO, DOWN **aborta**. No borrar la fila, inventar
  una finalización o dejar un workflow antiguo atendiendo. Mantener la ventana cerrada,
  analizar el fallo y resolver mediante avance correctivo autorizado o conciliación
  sustentada en evidencia independiente. Un proceso caído no expira por tiempo.

## Verificaciones de esta preparación y riesgos pendientes

- Comparación focalizada: seis cuerpos SQL idénticos a TEST y dos cuerpos de DOWN
  idénticos a la 015, normalizando solo saltos de línea.
- Comparación profunda sobre el export real: 108 nodos del padre idénticos; solo dos
  aristas originales redirigidas; 103 nodos conservados en el hijo; settings/estáticos
  originales del padre intactos. Grafo y referencias válidos; 72 nodos Code compilados
  **sin ejecutar** código ni expresiones de n8n.
- Dos pruebas nuevas de promoción y dos pruebas SQLite del exportador aprobadas
  (sin modificación del origen y rechazo del drift). Los cuatro archivos 019 rechazaron TEST
  en transacciones READ ONLY, antes de cualquier cambio.
- No se repitieron las suites generales aprobadas. No se ejecutaron UP/DOWN en PROD,
  importaciones/publicaciones de candidatos ni pruebas con Outlook/Dropbox reales.
- El ensayo aislado posterior completó UP/DOWN, padre/hijo y restauración de versiones
  anteriores con datos sintéticos sin pérdidas. Siguen fuera de alcance los servicios
  externos reales y el manejo supervisado del caso histórico. Ver el informe enlazado
  antes de autorizar despliegue; con propietarios sin finalizar el rollback sigue bloqueado.
