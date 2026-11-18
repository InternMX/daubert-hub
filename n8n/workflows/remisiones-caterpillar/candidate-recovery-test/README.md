# Reserva recuperada Caterpillar — borrador TEST, no importado

Fuente viva inspeccionada en lectura: workflow `AgWvTRatRujP9VfW`,
`Caterpillar TEST 015 — FULL (INACTIVE, staged)`, 63 nodos, inactivo y sin versión publicada.
Se conservan sus bloqueos `CAT_TEST_IO_HOLD` y su credencial TEST. No se cambió el workflow vivo.

`recovery-reservation-node.paste.json` es **solo un borrador de parámetros**,
no un workflow instalable. Su rama de recuperación lanza un bloqueo explícito.
No contiene credenciales, IDs de conexiones ni cambios de rutas.

Después de revisar y aprobar el E2E, el nodo de reserva para la rama explícita de
recuperación debe ejecutar únicamente:

```sql
SELECT * FROM cat_recovery_test.worker_admission($1::uuid,$2::text,$3::bigint);
```

Parámetros: `[recovery_request_id, String($execution.id), reproceso_de_id]`.
La función devuelve las mismas diez columnas del contrato de admisión actual,
verifica que la solicitud corresponde al padre del archivo en curso y llama al
gate existente. Un duplicado devuelve `BLOCK`, `ALREADY_REPROCESSED`, `can_emit=false`.
Nunca reemplazar un error de recuperación por la consulta convencional.

Prerrequisitos antes de preparar una copia ejecutable:

1. Migración 025 aplicada por operador autorizado en TEST, inicialmente deshabilitada.
2. Coordinador confiable, separado del Hub/n8n, con custodia de generación y diario de
   entrega verificables; atestación de cuarentena completa con el rol dedicado.
3. Transportar `recovery_request_id` desde una entrada autenticada, sin perderlo en
   los nodos de normalización/snapshot/reserva. Comprobar que padre, SHA-256 del Excel,
   snapshot y manifiesto normalizado son los mismos en toda la cadena.
4. Conservar sin cambios las validaciones de `Propagar admisión CAT`, `¿Puede emitir CAT?`,
   ownership y finalización. No convertir cuando `can_emit=false`.
5. Usar un directorio nuevo de staging por ejecución hija. El convertidor TEST borra
   homónimos: no debe recibir una salida operativa compartida ni una carpeta reutilizada.
6. Probar fallos de transporte después de COMMIT: el retry no concede otra emisión;
   requiere reconciliar el estado del worker y sus archivos, no asumir que puede volver a generar.
7. Ejecutar el E2E real en n8n TEST sin entradas automáticas ni rutas productivas.

El convertidor TEST fue ejecutado sin cambios con HTML sintético y cuatro PDFs en
el PostgreSQL/archivo aislado. Esto **no** acredita el E2E del workflow n8n vivo.

Semántica del manifiesto de cuarentena (hash del nodo `Preparar archivo CAT`): es
evidencia de custodia de los PDFs *existentes no entregados* en la carpeta de
salida de la generación al momento de atestar, no un inventario de lo que
producirá el reproceso. `files=[]` es el estado legítimo cuando la ejecución
original falló antes de generar su primer PDF (ningún archivo por custodiar) y
el E2E positivo aprobado despachó con un manifiesto vacío y después produjo los
cuatro PDFs desde el Excel fuente. `attest` tampoco exige files no vacíos:
producir los PDFs es responsabilidad del flujo posterior con el gate real, y un
hijo que no completa deja `ERROR` + reserva `ABANDONADA` + recibo
`CHILD_FAILED_REVIEW_REQUIRED` (nunca reemisión automática). El tooling de
custodia además rechaza archivos no declarados (`UNATTRIBUTED_OUTPUT_FILE`) y el
estado aislado no liberado se reverifica en el recibo del coordinador.

## Alcance integrable y renovación de custodia

Este PR es una **etapa preparatoria deshabilitada**, no una recuperación operativa
Hub → n8n. Al fusionarlo quedan API de preparación/recibo, panel ADMIN, SQL y
herramientas aisladas. La API no despacha solicitudes ni hay un consumidor de
PREPARING incluido en el PR. El coordinador privado y el workflow usados en los
E2E son infraestructura de ensayo excluida; no acreditan el cutover del workflow
compartido. Antes de activar cualquiera de los flags se requiere implementar y
revisar el coordinador operativo y el transporte autenticado descritos arriba.

025 mantiene un fence persistente mientras la solicitud está PREPARING/READY;
apagar flags o cerrar el diálogo no lo libera. No hay cancelación ni liberación
automática: una preparación abandonada requiere reconciliación operativa con
conservación del historial, nunca borrar la solicitud para desbloquear la serie.

La migración incremental **026 (TEST, preparada localmente)** corrige la renovación
de READY: tras cinco minutos, el coordinador debe volver a verificar físicamente
custodia, ausencia de entrega, inventario completo, hashes y salida vacía antes de
repetir `attest` con el mismo texto/hash. Esto renueva `verified_at`, no la emisión.
Un manifiesto distinto o una solicitud RESERVED se rechaza. Los recibos nunca
renuevan la vigencia. Instalar 026 requiere una sesión de operador autorizada,
025 presente, flags SQL apagados y ningún worker Caterpillar PROCESANDO; no forma
parte del arranque ni se ha aplicado al TEST compartido durante esta auditoría.

**Renovación operativa bloqueada:** PostgreSQL verifica identidad/permisos y el
vínculo criptográfico, pero no inspecciona archivos ni acredita no entrega. Una
identidad con EXECUTE de `attest` puede reenviar la evidencia antigua; SQL no puede
distinguir ese replay de una inspección física reciente. Por ello se debe mantener
`settings.enabled=false` y no habilitar la identidad de servicio para operación
hasta contar con el coordinador operativo revisado. Cada renovación debe comprobar
nuevamente los archivos y sus hashes, inventario completo, custodia vigente,
ausencia de entrega y salida vacía, y registrar esa comprobación antes de llamar
a `attest`. El hash anterior por sí solo no acredita custodia vigente.

## Reproducción SQL aislada

```powershell
npm run build --workspace=@daubert/api
node tools/cat-folio-recovery/phase2/native-rehearsal.cjs --reference-schema "<esquema-TEST-pre025-revisado.sql>" --converter-script "<copia-aislada-del-convertidor.ps1>"
```

Requiere PostgreSQL 18 local y un dump **solo de esquema, sin datos**, anterior a
025, con SHA-256 `d11f301535753b5872bb68cd0b798c11e3183bd5e37ba2b230806b4809f31eeb`.
El archivo de referencia se entrega por el canal privado del operador, no en el
PR. Este modo no abre conexiones compartidas ni depende de phase3/phase4.
`--test-env-file` es el modo histórico de extracción read-only; rechaza una fuente
con 025 ya instalada para evitar restaurar gates parcheados y reinstalar 025.

La copia del convertidor debe estar bajo `%TEMP%\opencode`, sin enlaces ni hard
links. El ensayo la copia a su sandbox nuevo antes de ejecutarla, con HTML, salida
y TEMP del navegador privados. No ejecuta placeholders de usuario ni lee scripts
de Dropbox. Rechaza entradas no aisladas antes de abrir PostgreSQL.

La suite prueba SQL, concurrencia, cuarentena y el servicio NestJS compilado;
además exige cuatro PDFs con cabecera `%PDF-`, registra sus hashes/remisiones y
finaliza la hija. Esto no sustituye el E2E Hub → n8n. Los informes de fases 1/2 son
históricos y sus afirmaciones/comandos describen aquel momento.
