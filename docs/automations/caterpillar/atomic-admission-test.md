# Fase 5D — admisión atómica Caterpillar, preparada exclusivamente TEST

**NO APLICADA. NO CONECTADA A N8N. NO HABILITA EMISIÓN.** El PASS 5C es evidencia comunicada por el
operador; en 5D solo se ejecutan unitarias/SQL en memoria. No se consulta ni modifica Daubert.

## Cambio mínimo

No se agregan tablas, columnas, estados de negocio, colas ni leases. Se reutilizan:

- `core.documentos.caterpillar_admission` (014) como snapshot inmutable capturado antes de emitir.
- `ops.ejecuciones_automatizacion.n8n_execution_id` como propietario fijo del worker.
- `ops.fn_crear_ejecucion_automatizacion` para la creación normal, sin modificar su cuerpo.
- `operacion.reservar_folios_para_ejecucion` y sus índices/locks/aritmética, intactos.
- Registro/finalización/fallo existentes, invocados desde wrappers que comprueban propietario.

015 crea cuatro entradas SQL TEST (SECURITY DEFINER, postgres, search_path fijo):

1. `ops.fn_admitir_reservar_caterpillar_test(documento,worker,serie,cantidad)`.
2. `operacion.fn_registrar_remision_caterpillar_test(ejecucion,worker,serie,folio,fecha,pdf,detalles)`.
3. `ops.fn_finalizar_caterpillar_test(ejecucion,worker,estado,nodo,error)`.
4. `ops.fn_fallo_caterpillar_test(ejecucion,worker,nodo,error)`.

Tres helpers privados verifican claves Unicode/snapshot y worker. No son API ejecutable del runtime.
El JavaScript/V1 no se reescribe: SQL valida el envelope persistido por el writer confiable y compara
su manifest JSON; no reconstruye Excel ni cantidades de presentación. El snapshot debe seguir siendo
calculado y validado por V1/adaptador; el rol emisor no puede escribirlo directamente.

## Transacción y concurrencia

El gate exige TEST y aislamiento READ COMMITTED. No es seguro usar una vista REPEATABLE READ anterior
al lock para decidir; se rechaza ese aislamiento. Toma advisory transaccional de esquema compartido
y luego por empresa/cliente_grupo/planta/subplanta. Esa única llave de ámbito serializa tanto nombres
como contenido equivalente de nombres distintos, sin un bloqueo global entre ámbitos distintos.

Dentro de la misma llamada/transacción:

1. Valida documento, snapshot, cantidad esperada y routing activo único a la serie solicitada.
2. Relee/valida el snapshot bajo lock y revisa TODAS las versiones/ejecuciones Caterpillar de la empresa.
3. Nombre/clave emitido, cancelado o ERROR no recibe nueva emisión automática.
4. Otra clave con contenido equivalente emitido/cancelado/en curso pasa a revisión.
5. Crea ejecución solo si procede; fija el worker del servidor. Bloquea la ejecución y delega la reserva.
6. Devuelve `can_emit=true` solo con decisión ADMIT, propietario confirmado y rango obtenido.

Mismo documento/worker PROCESANDO → OWNED_RETRY y la misma reserva. Otro worker → PROGRAM_IN_PROGRESS,
sin derecho a emitir. Un ERROR terminal requiere reproceso manual; no se reabre ni cambia owner.
Un fallo SQL en el reservador revierte también la creación: no hay dos operaciones independientes.
Si se pierde la respuesta tras COMMIT, puede existir reserva: consultar/reintentar con el mismo worker,
no fabricar otra ejecución. No mantener la transacción abierta durante filesystem/PDF.

El worker es el `$execution.id` real de n8n 5678, no un campo editable del navegador. La credencial SQL
es un principal técnico confiable: quien la comprometa puede falsificar IDs de worker. No se afirma
una prueba criptográfica de identidad humana ni aislamiento físico frente a otros roles privilegiados.
No hay expiración/transferencia automática. Recuperar un worker muerto exige conciliación y una fase
administrativa posterior; no reutilizar su ID desde otro workflow para simular continuidad.
El contador legado deduplica fallos por ID de n8n: los reintentos de nodo con el mismo ID conservan
la reserva, pero un workflow que termine dejando PROCESANDO no se transfiere a un nuevo ID. La
adaptación de recuperación manual debe resolverse antes del rollout, sin resetear intentos/owner.

## Permisos y despliegue coordinado

015 exige rol dedicado `n8n_cat_test`, sin administración, memberships/SET ROLE, CREATE o DML directo
que permita eludir el gate. Si no cumple, precheck/up fallan; no alteran membresías ni limpian permisos
ajenos automáticamente. También exige grants directos revisados para hacer reversible el cutover.

Se retira a ese rol, **solo en TEST**, EXECUTE directo de crear ejecución, reservar, registrar,
finalizar y registrar fallo. Se conceden solo las cuatro entradas protegidas. Otros roles y PROD no
se alteran. Los ACL por defecto de los objetos nuevos se retiran; PUBLIC/Hub/Pagos no reciben EXECUTE.
El repositorio tiene un método de contrato worker-only; el rol HTTP de Hub no obtiene permiso de reserva.

**No aplicar 015 aisladamente al workflow viejo**: sus llamadas directas dejarían de estar permitidas.
Se necesita una ventana sin ejecuciones TEST en curso y sin entradas TEST capaces de iniciarlas,
revisión real de hashes/contratos legado y prueba de todos los caminos. No detener la instancia 5678
ni cambiar opciones globales de PROD. El precheck exige ausencia de PROCESANDO y de ejecuciones con
snapshot antes del cutover inicial. Resolver casos pendientes expresamente, no borrar o resetear filas.

Postcheck verifica propietarios, volatilidad/strictness, search_path, huellas de cuerpo, ausencia de overloads, ACL efectivos,
grant options y bypass legado/DML. Down solo en mantenimiento, con lock exclusivo de esquema y sin
ninguna ejecución Caterpillar respaldada por snapshot; rechaza retirar evidencia o definiciones ajenas.
No modifica los cuerpos existentes, cancelación 013, reservas, pisos ni ajuste seguro de folios.

## Históricos sin V1: política prospectiva explícita

Los 17 documentos legacy comunicados permanecen intactos, con snapshot NULL:

- Nombre normalizado coincidente dentro de la empresa fuente → LEGACY_NAME_MATCH, revisión sin folios.
  No se les atribuye la planta/subplanta del nuevo archivo ni se infiere una ruta desde serie compartida.
- Hash físico no vacío coincidente con un legacy renombrado → LEGACY_FILE_MATCH, revisión. Es señal
  de posible copia binaria, NO identidad de entrega ni prueba suficiente de duplicado comercial.
- Otro nombre y ningún conflicto observable con snapshots completos → puede continuar prospectivamente.
  SQL informa `legacy_unverified`; la evaluación TS expone los IDs de cobertura incompleta.
- Snapshot no NULL pero inválido/corrupto → HISTORY_UNAVAILABLE; no se lo disfraza de legacy ni se ignora.
- Nombre legacy inválido/no normalizable → revisión; no se extrae una identidad inventada de una ruta.
- No hay corte por fecha, manifests vacíos, cambios de ámbito o backfill para forzar ADMIT.

**Límite irreducible:** sin manifest antiguo no se puede detectar que un Excel antiguo renombrado y
reexportado (hash físico distinto) tenga el mismo contenido. La política no declara esa comparación
resuelta ni confirma identidad de entrega.
El arranque prospectivo evita bloquear todo por mera ausencia de V1, pero requiere aceptación de este
alcance antes de aplicar. Si se exige garantía anti-renombrado retrospectiva completa, hay que recuperar
evidencia original o mantener revisión manual para esas entradas; no es solucionable con otro hash.
Los nombres nuevos/contenido modificado siguen el límite de la política por nombre acordada anteriormente.

## Nodos TEST que deberán cambiar (NO modificados en 5D)

Fuente funcional: export `MANUAL TEST REMISIONES CAT.json`, no PROD.

| Nodo | Ajuste posterior exacto |
|---|---|
| `Resolver documento origen PG` / `Propagar documento origen PG` | Conservar registro del documento; no confundirlo con análisis de solo lectura: puede insertar metadata |
| `Crear o recuperar ejecución PG` | No llamarlo en el camino automático previo al manifest; la creación pasa al gate |
| `Propagar ejecución PG` | Reubicar después del gate; solo permitir `can_emit === true`, worker correcto y rango válido; nunca continuar por ALREADY_PROCESSING sin propiedad |
| `¿Procesar según PG?` / `¿Es reproceso?` | Separar caminos no emisores; no conectar rechazos/revisiones a render ni al camino manual como atajo |
| `Normalizar datos CAT` | Tomar contexto desde documento/copia y no exigir ejecución emisora previa; conservar algoritmo, captura preagrupación y cardinalidad de 3E; no IDs ficticios |
| Captura de snapshot | Persistir desde writer confiable tras normalizar y antes del gate; falta enlazar ese servicio interno, no otorgar UPDATE genérico al emisor |
| `Preparar reserva folios PG` | Resolver serie/cantidad esperadas y documento, sin exigir ejecución previa; conservar manifest |
| `Reservar folios PG` | Sustituir query por el gate de cuatro parámetros con worker del servidor |
| `Asignar folios PG CAT` | Usar ejecución y reserva devueltas por gate; conservar lectura nominal del normalizador, orden y aritmética originales |
| `Registrar remisión PG` | Wrapper protegido con worker; mantener payload, rango y contrato idempotente existentes |
| `Finalizar ejecución PG` / `Registrar fallo PG` | Wrappers del mismo owner, conservar estados, validación de integridad y abandono de reservas |
| `Preparar error CAT` / `Registrar log error CAT` | Distinguir errores de análisis/gate sin ejecución confirmada de fallos posteriores a can_emit; no inventar ejecución ni registrar fallo sobre una ajena |
| Webhook de reproceso manual y sus ramas | No eludir el gate ni ampliar ERROR/CANCELADA a COMPLETADA; su adaptación autorizada queda pendiente, no se habilita regeneración |

El candidato completo sigue bloqueado. La normalización de análisis debe separarse de creación emisora;
ninguna reserva/registro/PDF debe alcanzarse sin el resultado verdadero del gate. Un worker distinto,
una respuesta inesperada o revisión terminan sin emisión. El gate no protege filesystem por sí solo:
se conservan las guardas de TEST/temporales/sin barrido global y su revisión runtime pendiente.

## Evidencia offline y siguiente validación

PGlite usa un solo backend con DOBLES del contrato legado, no el allocator real de Daubert. Se compila
y ejecuta la nueva SQL en memoria, adaptando solo current_database y las huellas de esas copias de test.
Las pruebas de dos contendientes son secuenciales/serializadas: **NO prueban esperas ni concurrencia
real de dos backends PostgreSQL**. Los TS mocks tampoco conceden permiso ni llaman a una API/n8n vivo.

Siguiente etapa, previa autorización: revisar precheck/permisos y huellas en TEST, preparar ventana y
respaldo recuperable, aplicar/validar 015 solo si se autoriza, y usar DOS backends reales con fixtures
aislados para observar espera de advisory lock y un único propietario/rango. Probar también nombres
distintos equivalentes, fallo dentro de reserva, reintento tras respuesta perdida y bypass de permisos.
No consumir ni restaurar folios operativos para simular la prueba. No habilitar n8n automáticamente
después del test; adaptar y revisar la copia TEST y la cobertura legacy antes de otra autorización.
