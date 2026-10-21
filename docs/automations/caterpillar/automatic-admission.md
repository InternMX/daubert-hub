# Caterpillar — admisión automática por nombre y contenido

## Alcance implementado

La clave de esta política es **ámbito + nombre normalizado**, no una identidad inequívoca de entrega.
`caterpillar-automatic-admission.ts` reutiliza V1/adaptador sin modificar sus algoritmos.
`CaterpillarExecutionsService.assessAutomaticAdmission` es un método interno, sin endpoint ni conexión
a n8n. No llama a webhooks ni reserva, cancela, crea ejecuciones o autoriza regeneraciones.

Ámbito: empresa propietaria del documento + `cliente_grupo`, `planta_codigo` y `subplanta_codigo`,
es decir, el ámbito del routing actual. El nombre descriptivo del cliente y RFC permanecen en V1,
pero no crean otro namespace para eludir un nombre ya procesado. Se aplica NFC, trim, colapso de
espacios y mayúsculas solo a la clave lógica.
El nombre debe ser un basename Excel; se normaliza igual y se elimina `.xlsx`/`.xlsm`/`.xls`.
No se eliminan acentos, puntuación, números, fechas ni sufijos como «copia». La carpeta no participa.
El manifest se compara como **JSON canónico V1 exacto**, sin normalizarlo de nuevo ni usar el hash físico.
La empresa y el ámbito deben proceder de la configuración interna y del normalizador autorizado,
no de un ámbito editable por el navegador. No se añade un endpoint para aceptar esos datos de clientes.

| Antecedente dentro del mismo ámbito | Decisión |
|---|---|
| Sin nombre procesado ni contenido conocido | ADMIT / NEW_NAME_AND_CONTENT |
| Mismo nombre PROCESANDO | BLOCK / PROGRAM_IN_PROGRESS |
| Mismo nombre con ejecución CANCELADA o remisiones canceladas | BLOCK / REGENERATION_AUTHORIZATION_REQUIRED |
| Mismo nombre COMPLETADA o con remisiones GENERADA | BLOCK / PROGRAM_ALREADY_EMITTED |
| Mismo nombre ERROR o con remisiones PENDIENTE | BLOCK / MANUAL_REPROCESS_REQUIRED |
| Otro nombre con el mismo contenido emitido, históricamente cancelado o en proceso | REVIEW / MANIFEST_MATCH_REVIEW |
| Falta cobertura, snapshot fiable o almacenamiento preparado | REVIEW / HISTORY_UNAVAILABLE |

Todos los resultados incluyen `canReserveFolios:false`, `requiresAtomicDatabaseCheck:true` y
`deliveryIdentity:'UNCONFIRMED'`. Son resultados de evaluación, no nuevos estados de la base.
No se implementa la autorización/botón de regeneración ni se acepta un flag de cliente para omitirla.

## Antecedentes y límite del esquema actual

`findAutomaticAdmissionHistory` hace una sola lectura sobre `core.documentos`, todas sus ejecuciones
de `REMISIONES_CATERPILLAR` y agregados de `operacion.remisiones`. Filtra empresa, no hash o carpeta;
no usa paginación, LIMIT ni selección de la última versión. Cuenta GENERADA, CANCELADA y PENDIENTE.
Incluye snapshots ya analizados aunque todavía no tengan ejecución. No adivina ámbito desde una serie:
Torreón comparte serie entre subplantas. Los datos actuales de detalle tampoco reconstruyen V1.

La consulta usa `to_jsonb(d)->'caterpillar_admission'`, que devuelve NULL si la columna no existe;
consulta además `pg_attribute` para comprobar su presencia y tipo JSONB. No referencia directamente
una columna futura. Fuera de `daubert_hub_test` no recoge antecedentes y el servicio devuelve REVIEW.
Con el esquema documentado actual, sin esa persistencia, la integración queda pendiente y **no admite**.
No se ha conectado a PostgreSQL para comprobar su estructura ni se ha aplicado cambio alguno.

## Cambio mínimo propuesto, NO aplicado

Una columna nullable `core.documentos.caterpillar_admission jsonb`, exclusivamente para snapshots
Caterpillar, con este contrato:

```json
{
  "version": "CAT_ADMISSION_V1",
  "programmingKey": "<JSON de versión de clave, empresa, ámbito y nombre normalizado>",
  "manifestCanonical": "<JSON.stringify del manifest CAT_OPERATIONAL_CONTENT_V1>"
}
```

No se propone tabla nueva ni unicidad del manifest. El helper `createCaterpillarAdmissionSnapshot`
prepara el objeto, pero no lo escribe. El servidor comprueba versión, clave y canonicalización V1
del snapshot histórico: metadata manipulada, incompleta o incoherente no se trata como ausencia.

Antes de conectar el workflow TEST: autorizar y revisar ese cambio, su escritura restringida y la
captura del ámbito/manifest preagrupación por cada versión física. Los históricos relevantes deben
tener evidencia verificable; si no puede recuperarse, permanecen pendientes de revisión. No inventar
snapshots a partir de cantidades de presentación, no excluir históricos para forzar ADMIT y no
sobrescribir silenciosamente el snapshot aceptado si cambia el catálogo o normalizador.

## Concurrencia: protección pendiente de conexión

Dos consultas simultáneas sin antecedentes pueden devolver ADMIT. Eso no prueba exclusión mutua.
La integración posterior necesita una decisión/claim durable y una reserva coordinadas atómicamente
en PostgreSQL, revalidando nombre/ámbito y contenido bajo bloqueo antes de usar el reservador existente.
El workflow actual crea la ejecución antes de normalizar: llamar después a este método bloquearía
también la propia PROCESANDO. Hay que separar el análisis previo de la creación emisora, o diseñar
la comprobación transaccional de propietario; no excluir un executionId/documento recibido del cliente.
El control también debe considerar contenido reclamado pero aún no emitido para evitar carreras de
dos nombres distintos equivalentes. No mantener una transacción abierta durante PDF/PowerShell.
`ALREADY_PROCESSING` no equivale a propiedad del worker. No se ha modificado el allocator ni su SQL.

## Límite funcional explícito

Un archivo **renombrado y con contenido operativo modificado** puede superar ambos criterios y
resultar ADMIT. Es la consecuencia de la política solicitada, no prueba de nueva entrega. Si se quiere
reconocer también ese caso como corrección, hace falta otra referencia de programación o revisión
manual; el código no lo deduce de la ruta o la fecha. Un nombre reutilizado para una entrega legítima
nueva seguirá bloqueado: también es parte de esta política por nombre.

La existencia de historias sin ámbito/manifest fiables impide garantizar una comparación completa.
Se falla cerrado, incluso si el candidato tiene otro nombre. No cambia cancelación, reproceso,
ajuste de folios, workflows o producción. Las pruebas son unitarias con persistencia mock, no E2E.
