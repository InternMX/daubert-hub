# Ensayo aislado de las candidatas productivas del PR #17

Fecha: 2026-10-23. Candidata: commit `02d0b87`.
**No hubo cambios productivos, reprocesos reales, cambios del correo 44 ni merge.**

## Aislamiento y fidelidad

- Red Docker nueva `daubert-review17-net`, `Internal=true`, sin gateway externo ni
  puertos publicados al host. Cinco contenedores propios, identificados con
  `daubert.rehearsal=pr17`; no se adoptó ningún servicio existente.
- PostgreSQL desechable 18.6, con esquema productivo sin datos y ACL de objetos.
  El nombre `daubert_global` existió **dentro del contenedor aislado**, no en el
  servicio Windows productivo. Roles recreados con credenciales sintéticas.
- n8n 2.27.4 nuevo, home SQLite nuevo y credenciales nuevas falsas. No se montaron
  el home de n8n real, Dropbox real, archivos de pagos reales ni secretos productivos.
- Nodos Microsoft Outlook y HTTP originales conservados: Graph se resolvió por DNS
  interno a un doble HTTPS local. La excepción de TLS autofirmado se limitó al proceso
  desechable, nunca a una candidata o configuración productiva.
- Hub candidato: imagen local con el dist aprobado montado en el contenedor nuevo;
  conexión exclusiva al PostgreSQL desechable. Login, sesión, permisos y PATCH/POST
  reales del Hub, sin bypass de autenticación.
- Los SHA-256 de padre/hijo preparados no cambiaron:
  `e472624557987d4f0b42306cb074daa4f731e6b7fa64b3629e3ccec37af1d5f9` y
  `a63f2f4c291851d7f15fe5a27d0346a663f544f53feacae276032740fa592a9a`.

Adaptaciones exclusivas del ensayo: referencias de credenciales, conexiones/DNS,
raíz de archivos y logs bajo `/data/review`, destinatarios del resumen a direcciones
`.example.test` y selección de un correo sintético en la entrada manual. Ningún
algoritmo, consulta SQL, condición, conexión del grafo o política de error de la
candidata se corrigió para hacer pasar los casos.

El Error Workflow vigente se obtuvo en lectura y se reprodujo con su código real,
cambiando solamente la ruta de logs. Tiene dos nodos: Error Trigger y escritura de
error crítico; **no tiene nodos de notificación**.

## Resultados

| Caso | Resultado y evidencia |
|---|---|
| A. Ingesta normal | APROBADO: tres PDF, dos empresas, dos resultados LISTO y dos borradores. Nodos Outlook/Graph nativos y programación semanal XLSX sintética completa. |
| B. Parcial | APROBADO: correo sintético 10003, doce resultados y doce borradores previos, archivo desconocido 10021 con ALIAS_NO_CATALOGADO. |
| C. Recuperación/asignación | APROBADO: Hub POST → padre → hijo → confirmación auditada → SIN_EFECTOS/canManage → PATCH de asignación. Filas completas y bytes previos idénticos; ningún alias permanente creado. |
| D. Concurrencia | APROBADO: dos POST simultáneos al Hub devolvieron 202 y 409. Un resultado, un borrador y un adjunto PDF nuevos; sin duplicados ni cambios a los doce previos. |
| E. Fallo del hijo | APROBADO el fallo seguro: error Graph sintético propagado del hijo al padre, ambos terminados en error; no confirmación de recuperación ni envío de resumen. Dos invocaciones del Error Workflow y dos registros críticos. |
| F. Interrupción | APROBADO el bloqueo: transporte del hijo retenido por el doble y proceso desechable interrumpido. Propietario PROCESANDO, sin evidencia fabricada, reintento 409 y DOWN rechazado. Sigue bloqueado después de reiniciar solo el n8n desechable. |

E y F son errores provocados: su resultado correcto es **no** rehabilitar ni permitir
un nuevo procesamiento. No son fallos de la prueba por terminar la ejecución en error.

Controles adicionales:

- Schedule original observado automáticamente, sin cambiar la regla: ejecuciones
  3, 4 y 7 del n8n desechable, con cadencia de cinco minutos. El sondeo repetido
  no reprocesó correos registrados ni creó nuevos borradores. La ingesta de datos
  completos también se disparó por la API nativa de n8n desde el propio Schedule
  Trigger, sin sustituirlo por un Code/Manual Trigger.
- La validación FACTURAS se conservó: fixtures iniciales sin programación completa
  quedaron MANUAL. Se completó el XLSX sintético, no se debilitó el workflow.
- Entrada manual probada: solo se cambió el ID seleccionado por un correo sintético;
  recorrió propietario/padre/hijo y rehabilitación real.
- Histórico sin registro individual: un resultado MANUAL y borrador CREADO existentes
  terminaron LISTO reutilizando el mismo ID de borrador, sin crear otro.
- `waitForSubWorkflow=true` contrastado con ejecuciones persistidas: padre 10/hijo 11
  y padre 12/hijo 13; el nodo de confirmación empezó después del retorno completo de
  la llamada y el hijo terminó antes que el padre.
- Todos los requests Graph fueron atendidos por el doble local. Cero entregas reales.

## Fallo del hijo: qué se duplica realmente

En E, padre 14 e hijo 15 fallaron. El Error Workflow tuvo ejecuciones 16 y 17:

- Un ERROR_CRITICO para el padre, nodo `Procesar reproceso y esperar`.
- Otro ERROR_CRITICO para el hijo, nodo `Obtener adjuntos del correo`.

Son dos registros de la misma cadena de fallo, con IDs diferentes. No hubo dos
correos/avisos enviados: el manejador actual solo escribe logs. Se acepta por ahora
conservar ambos registros como dos ejecuciones de la misma cadena. No se modifica el
Error Workflow ni la política de propagación en este PR.

## UP, DOWN y recuperación de versiones

1. Precheck, UP y postcheck **019 reales**, sin sustituir la guarda de base, se ejecutaron
   en el PostgreSQL desechable con el esquema previo y sus permisos. APROBADOS.
2. DOWN inicial sin trabajo: restauró los fingerprints anteriores. APROBADO.
3. Con datos: se despublicó el padre, se comprobó webhook cerrado (404) y se drenaron
   las ejecuciones. DOWN conservó todas las filas de pagos, asignaciones, archivos,
   propietarios y evidencia; se restauraron workflow anterior e imagen anterior del
   Hub. El GET anterior devolvió 200 y los datos/bytes de PDF siguieron idénticos.
4. Se probó además la restauración de una versión publicada anterior mediante la API
   nativa de n8n: sin reiniciar ese n8n entre despublicación y activación. Se verificó
   `StartedAt` del contenedor, no solo un contador de reinicios.
5. Con un propietario interrumpido: DOWN abortó. No se borró la fila ni se confirmó
   artificialmente. Para comparar las ramas del ensayo se conservaron ambas bases
   sintéticas (checkpoint limpio e interrumpida); no se propone ese intercambio de
   bases como procedimiento productivo.

**El rollback está probado con trabajo drenado/finalizado. No es un rollback universal
para un incidente con propietario sin resolver.** En ese supuesto se mantienen las
entradas cerradas y se requiere conciliación con evidencia o avance correctivo.

## Condición de disponibilidad que debe añadirse al procedimiento

Se observó `health=200` antes de que n8n terminara de registrar las rutas activas.
Una solicitud demasiado temprana recibió 502 en el Hub y dejó SOLICITADO; el sistema
no lo desbloqueó por adivinar si n8n había aceptado.

Antes de abrir mutaciones debe comprobarse la ruta real del webhook sin token:

- 404: despublicado/no registrado; no abrir.
- 403: registrado y con autenticación efectiva, observado en n8n 2.27.4 del ensayo.

Ese chequeo no ejecuta el workflow: falla en autenticación. La publicación/activación
por interfaz/API de n8n quedó probada sin reiniciar el servicio. No tratar el éxito
de una CLI que solo cambia metadatos ni GET health como prueba de registro efectivo.

## ¿Son necesarios 106 nodos?

No todos: 97 son alcanzables desde `Entrada recuperacion`, incluyendo dependencias
nominales `$()`, `$node[]` y `$items()`. Nueve quedan fuera:

`BASELINE CORREOS`, `Obtener correos Outlook`, `Registrar correo pendiente`,
`Sticky Note`, `Sticky Note1`, `Tomar un correo por ejecución`,
`Verificar correo procesado`, `¿Correo nuevo?`, `¿Correo válido de pagos?`.

Una poda potencial reduce 106 → 97 (8,5 %), sin cambiar la necesidad del procesamiento
restante. Es una medida estructural, no una validación de eliminación: antes de podar
habría que contrastar referencias dinámicas y repetir el ensayo focalizado. No se
eliminaron nodos. No es una simplificación sustancial de arquitectura.
El mayor ahorro potencial sería un único procesamiento compartido por ingesta y
reproceso, evitando la copia de nodos comunes. Eso movería la ruta Schedule aprobada
y exige demostrar otra vez su equivalencia: no se ha probado una alternativa que sea
sustancialmente más sencilla **y** conserve todas las garantías. No se implementó.

## Dictamen y estado de los artefactos

- Candidata funcionalmente validada en el alcance aislado solicitado. No se encontró
  un bloqueo funcional de API/SQL/procesamiento que obligue a rehacer la arquitectura.
- Evidencia y gate de publicación incorporados al procedimiento; se aceptan los dos
  logs y se explicita el rollback condicionado a drenaje y propietarios finalizados.
- Se mantiene la arquitectura padre/hijo y los nueve nodos potencialmente inalcanzables.
  No se implementa otra arquitectura ni recuperación histórica del correo 44.
- Se puede pasar a revisión final/merge y planificar una ventana controlada con esas
  condiciones. No equivale a autorizar ni ejecutar un despliegue. Si se exige rollback
  automático aun tras una interrupción sin evidencia, esa garantía no está implementada.
- No se repitieron suites generales. No se probaron Azure/Outlook o Dropbox reales,
  cuotas/refresh reales ni cargas productivas; esos servicios quedaron aislados.

Los cinco contenedores del ensayo se detuvieron. Evidencia, snapshots y bases
sintéticas se conservaron privadamente en
`%LOCALAPPDATA%\Temp\opencode\payment-recovery-rehearsal\`, incluido `report.json`.
No se versionan exports reales, esquema privado, claves del doble o dumps.

Herramientas locales: `scripts/n8n/rehearse-payment-recovery.py` y
`payment-recovery-graph-double.cjs`. Requieren Docker, Python/openpyxl y los insumos
privados del ensayo. Rechazan adoptar un entorno existente en `--setup`; los mounts
de escritura deben estar bajo el scratch aprobado, sin junctions a datos reales.
