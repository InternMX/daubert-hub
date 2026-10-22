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
| Snapshot NULL legacy con nombre coincidente (ámbito desconocido) | REVIEW / LEGACY_NAME_MATCH |
| Snapshot NULL legacy con otro nombre | No veto global; cobertura incompleta explícita |
| Snapshot no NULL inválido o almacenamiento no preparado | REVIEW / HISTORY_UNAVAILABLE |

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
Sin persistencia disponible, la integración no admite. El operador confirmó aplicación de 014 y prueba
real de persistencia en 5C; 5D no realiza nuevas conexiones ni cambios operativos.

## Persistencia mínima — 014 aplicada según evidencia del operador

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

La fase 5A prepara migración y métodos explícitos de persistencia sin sobrescritura en el repositorio;
no los invoca en Daubert ni los conecta al workflow. Estado, históricos y límites de arranque:
[admission-persistence-test](admission-persistence-test.md).

Antes de conectar TEST: revisar captura restringida preagrupación y aceptar el alcance prospectivo
explicado en [atomic-admission-test](atomic-admission-test.md). Los históricos NULL protegen sus nombres
sin que se les invente un ámbito; un nombre distinto no prueba ausencia de coincidencia V1 antigua.
No inventar snapshots, no excluir por fecha y no sobrescribir silenciosamente el snapshot aceptado.

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

La existencia de historias sin ámbito/manifest fiables impide garantizar comparación retrospectiva
completa. 5D protege coincidencias legacy por nombre y deja visible la cobertura de contenido faltante;
no declara esa ausencia como comprobación de entrega nueva. El gate preparado y su validación real
pendiente se documentan por separado. No se cambia cancelación, ajuste de folios, workflows o PROD.
