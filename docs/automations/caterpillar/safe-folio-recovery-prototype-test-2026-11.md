# Recuperación conservadora de folios Caterpillar — prototipo TEST

Estado: **PROTOTIPO AISLADO; NO HABILITADO; NO APTO PARA PR FUNCIONAL**.
Fecha: 2026-11-06. Base: `origin/main`, `16153a8a7dda7c5845eae32be5a696f92c71c631` (1.1.1).
Rama: `feat/cat-safe-folio-recovery`. Worktree: `daubert-hub-cat-folio-recovery`.

## Punto de partida y límite alcanzado

Se reutilizó el informe existente `audit-recuperacion-folios-2026-11.md`, ubicado en
el worktree principal, sin modificarlo ni copiar documentación de Audi. No se encontró
un `audi.md` dentro de la carpeta Caterpillar. No se repitió una auditoría general.

El incidente productivo confirmado por el usuario (ejecución 27 ERROR, reserva 16
ABANDONADA, 111–114; hija 28 COMPLETADA, reserva 17 APLICADA sobre el mismo rango;
siguiente P2 115; ajuste auditado ID 3) es **referencia histórica, no fixture**.
No se consultaron ni modificaron esos registros. Los IDs sintéticos del ensayo
empiezan en 10000, en una base embebida independiente.

TEST sí es accesible. Se comprobaron conexiones exclusivas a `daubert_hub_test` con
los roles `daubert_hub_test_user` y `n8n_cat_test`, ambos con `default_transaction_read_only=on`.
No está disponible `TEST_DATABASE_URL_MIGRATOR`; el rol Hub no tiene CREATE en
`ops`, `operacion` ni en la base. No se reutilizaron credenciales productivas ni se
intentó elevar privilegios. Por ello no se aplicó una migración a TEST.

La otra garantía esencial pendiente es un coordinador verificable de archivos y
entrega. Una casilla ADMIN y un hash declarado por el navegador no demuestran que
los PDFs fueron aislados ni que nadie pudo entregarlos. Se dejó **sin endpoints,
sin botón habilitado y sin cambios/importaciones en n8n**.

## Funciones reales de TEST inspeccionadas

Definiciones obtenidas con `pg_get_functiondef`, no inferidas de fichas:

| Función | MD5 de la definición consultada |
| --- | --- |
| `operacion.reservar_folios(text,integer)` | `b446bfe1d1670bb71b6250897bd2345d` |
| `operacion.reservar_folios_para_ejecucion(bigint,text,integer)` | `392851edaeb28df161b0c10ec98c193a` |
| `ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)` | `4d7bfd2e46b2e14a32c092004007e445` |
| `ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)` | `f8b918d196606e9586847bcdf0190548` |
| `ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)` | `3a9b440b7a511e330569a35aa9e7af7c` |
| `operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)` | `8c00ed6bf286e3b4b66068b0524e8b7f` |
| `ops.fn_reprocesar_reservar_caterpillar_test(bigint,text,text,integer)` | `c572b74411b12c3b43166c08b5c56501` |

También se inspeccionaron columnas, CHECK/PK/UNIQUE/FK e índices de los ledgers.
Hallazgos concretos que condicionan esta implementación:

- Ambas reservas serializan el contador con `FOR UPDATE` de `series_documentales`.
  La variante por ejecución usa además advisory lock de `(ejecución,serie)` y UNIQUE
  de esa pareja; la misma cantidad devuelve la reserva existente.
- Finalizar ERROR abandona reservas y nunca retrocede `siguiente_folio`; finalizar
  COMPLETADA exige todas las remisiones GENERADA del rango.
- El fallo es idempotente por el último `n8n_execution_id`; al agotar intentos finaliza ERROR.
- El registro de remisiones valida pertenencia al rango y detalles. El índice único
  real es parcial: `(serie_id,folio) WHERE estatus <> 'CANCELADA'`. Por ello la
  recuperación debe bloquear **cualquier remisión**, también CANCELADA.
- El hijo directo es único por `reproceso_de_id`; hay un índice único parcial de
  PROCESANDO por automatización/documento. Esto no serializa una serie entera.
- El gate moderno TEST tiene sufijo **`_test`**. Exige READ COMMITTED, snapshot
  operativo, bloqueo de scope, documento y padre, validación de rutas, ausencia de
  conflictos, propiedad del worker y permiso `can_emit`. Al final siempre llama a
  la reserva convencional. **No se puede insertar un hook después de ese gate**:
  ya habría consumido folios nuevos. Tampoco es aceptable crear un hijo por el
  helper legado y saltarse las verificaciones del gate.

## Diseño elegido

Transferencia auditable del **último rango abandonado**, sin decrementar contador:

1. Verificar ADMIN activo, motivo y confirmación expresa.
2. Revalidar snapshot/documento y todas las guardas del gate actual.
3. Bajo exclusión de productores de la serie, verificar/aislar archivos y generar
   evidencia confiable; ningún resultado desconocido se interpreta como «no entregado».
4. En una sola transacción, crear/adquirir la hija, copiar el rango a una nueva
   reserva RESERVADA y enlazar reserva origen/destino, hija, solicitud, ADMIN y evidencia.
5. Continuar por el gate existente, que encuentra esa reserva con la cantidad
   exacta; un retry de transporte devuelve la misma solicitud, **no un segundo permiso de emisión**.

**Política más estricta que el informe anterior:** `siguiente_folio` debe ser
`folio_final + 1`; cualquier reserva posterior de la serie, incluso ABANDONADA,
bloquea. No se recuperan huecos intermedios. Una modificación manual del contador
o una reserva posterior incompatibles tampoco autorizan la recuperación.

El primitivo aislado implementa las guardas del ledger y recibe una hija ya creada
en la transacción del ensayo. **No implementa todavía los pasos 2–3 ni el protocolo
de exclusión de todos los productores**. No es una sustitución del gate 015.

## Código implementado

- `tools/cat-folio-recovery/prototype.sql`: esquema privado de ensayo, tabla de
  evidencias sintéticas, ledger de recuperaciones y función SECURITY INVOKER sin
  grants al Hub/worker. Usa advisory lock por padre y lock de fila de serie; guarda
  solicitud única, reserva original única, reserva nueva e hija únicas. No actualiza
  el padre, su reserva ni el contador. Rechaza ADMIN inválido, falta de confirmación,
  estados incorrectos, remisiones, rangos posteriores/solapados, hija incorrecta,
  evidencia vencida/desconocida y ejecuciones en curso. En este prototipo el bloqueo
  de actividad es deliberadamente más estricto: cualquier otra ejecución Caterpillar PROCESANDO.
- `prototype.down.sql`: revierte solo el esquema vacío; rechaza eliminarlo si
  existe evidencia o historial de recuperación. El down tampoco modifica los ledgers base.
- `rehearse.cjs`: toma **solo metadatos** del TEST real, cierra esa conexión y
  reproduce columnas, CHECK/PK/UNIQUE/índices y las seis funciones base en PGlite
  en memoria. No copia datos. No replica FKs externos ni triggers de auditoría:
  se declara ensayo parcial, no integración completa. Cada escenario hace ROLLBACK.

Los archivos SQL abortan tanto en `daubert_global` como en `daubert_hub_test`;
requieren además la marca `cat_recovery.sandbox=isolated`. Están fuera del directorio
de migraciones y no son una migración numerada lista para instalar.

### NestJS y React: contrato pendiente, sin funcionalidad habilitada

El futuro GET de evaluación será ADMIN y devolverá original, planta/serie, reserva,
rango, checks y motivos de rechazo. El POST deberá tomar identidad del servidor,
confirmación expresa, motivo y clave idempotente; nunca aceptar del navegador una
atestación de archivos como prueba confiable. Un rechazo no ejecutará el reproceso
convencional ni asignará folios nuevos silenciosamente.

En `CaterpillarReprocessDialog` se conservará el reproceso convencional y se añadirá
«Reprocesar conservando folios» solo cuando la evaluación del servidor sea positiva.
El panel mostrará datos, checks, advertencia de ausencia de entrega, motivo y
confirmación explícita. Los cambios de estado posteriores se revalidarán en POST.
No se cambió la API/Web para ofrecer una operación cuyo coordinador aún no existe.

### n8n TEST y archivos: integración mínima evaluada, no aplicada

Se contrastaron los exports versionados `test/workflow.json` y
`candidate-015/caterpillar-test-015.FULL.INACTIVE.json`, sin tratarlos como prueba
del workflow actualmente cargado. El FULL usa el gate `_test` y valida `can_emit`.
No hay acceso autenticado verificado al workflow TEST vivo en esta sesión.

El punto de integración requerido es **dentro de la admisión transaccional**,
después de las validaciones existentes y antes de reservar folios convencionales,
con una autorización/evidencia recuperable de servidor. Se debe compartir ese
código de validación, no duplicarlo en una ruta que lo eluda. Hasta probarlo,
no se importó ni activó un workflow ni se alteró el convertidor.

Procedimiento de aislamiento a implementar/validar antes de habilitar:

1. Exclusión efectiva de escritores de la serie (también auto-polling y reintentos),
   sin confiar solo en un archivo `.lock` que los workflows actuales no respetan.
2. Inventario completo vinculado a documento, snapshot, ejecución, reserva y rango;
   SHA-256 y tamaño por PDF, paths canónicos bajo raíz TEST, sin enlaces/reparse points.
3. Ante entrega conocida, entrega desconocida, archivos no atribuibles o inventario
   incompleto: rechazo. Confirmación ADMIN adicional, nunca reemplazo del inventario.
4. Apartar en una carpeta exclusiva de evidencia no sincronizada/entregable; sin
   sobrescritura ni eliminación. Registrar origen/destino/hash y comprobar contenido
   de destino y ausencia de colisiones antes de permitir al convertidor reusar nombres.
5. Conservar manifiesto y evidencia si falla cualquier paso. Reconciliar fallos entre
   filesystem y COMMIT; no prometer transacción distribuida con una mera casilla.
6. Emisión nueva en staging aislado y promoción controlada. El convertidor actual
   puede borrar PDFs homónimos; mientras no exista exclusión y revisión de destinos,
   **no habilitar recuperación automática**.

## Pruebas y resultados de esta sesión

Ejecución desde el nuevo worktree:

```powershell
node tools/cat-folio-recovery/rehearse.cjs --test-env-file "apps/api/.env"
```

Solo se lee `TEST_DATABASE_URL` de ese archivo; otras claves, incluidas productivas,
no se usan. Se valida nombre de base, protocolo, host local, usuario TEST y ausencia
de opciones de URL, y se comprueba `current_database()` con sesión de solo lectura.

| Escenario sintético | Resultado del prototipo |
| --- | --- |
| 1. Fallo antes de PDFs | Recupera 111–114; siguiente 115 |
| 2. Fallo con tres PDFs parciales | Rechaza mientras permanecen en salida; movimiento de carpeta sintética a cuarentena conserva hashes; luego admite evidencia sintética |
| 3. Reutilización completa | Reserva hija, cuatro remisiones 111–114 mediante función real copiada, COMPLETADA/APLICADA; siguiente 115 |
| 4. Reserva posterior | Rechazo aunque la posterior esté ABANDONADA; contador conserva su valor 116 |
| 5. Remisión registrada | Rechazo, incluida CANCELADA; remisión y siguiente 115 intactos |
| 6. Entregado/desconocido/sin evidencia | Todos rechazados; sin reserva nueva |
| 7. Dos solicitudes competidoras | Simulación **serializada**, solo una transferencia; no prueba concurrencia real de la recuperación |
| 8. Duplicado | Misma solicitud devuelve misma reserva; payload incompatible se rechaza |
| 9. Nuevo error de la hija | Su reserva pasa a ABANDONADA; padre/reserva original intactos; siguiente 115 |
| 10. Auditoría y autorización | ADMIN/confirmación obligatorios; enlace y motivo preservados; down con historial rechazado |
| 11. Otra ejecución en curso | Rechazo incluso si aún no tiene reserva |
| 12. Evidencia vencida/cuarentena no verificada | Rechazo |
| 13. Cantidad diferente | Reserva idempotente rechaza cantidad 5; no consume folios nuevos |

**13/13 escenarios aprobados**, integridad de contador, estado original y remisiones
comprobada después de cada escenario. Up aislado sin marca rechazado; down vacío aprobado.
Los PDFs son bytes sintéticos, no documentos emitidos. Evidencia conservada de la
última corrida: `%TEMP%\opencode\cat-recovery-synthetic-VGI2Do`.

Se probó además **el primitivo advisory lock** con dos conexiones READ ONLY reales
a TEST y una clave sintética aleatoria: la segunda no pudo adquirirlo hasta el
ROLLBACK de la primera. Esto **no demuestra** exclusión de la serie frente al gate,
al reservador normal o a escritores de archivos. El escenario obligatorio de dos
reprocesos simultáneos completos permanece pendiente.

Validaciones adicionales aprobadas:

- `npm ci`; `node --check tools/cat-folio-recovery/rehearse.cjs`.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- API relacionadas: **218 pruebas / 7 archivos**.
- Web relacionadas: **134 pruebas / 3 archivos** (diálogo, página y cliente Caterpillar).
- `npm run test:dev-guard`: **19/19**.
- `npm audit --omit=dev`: **0 vulnerabilidades**. No se aplicó audit fix ni se cambiaron dependencias.

## Condiciones exactas para continuar

1. Disponer de `TEST_DATABASE_URL_MIGRATOR` dedicado y validado exclusivamente para
   TEST (sin pegar credenciales en documentación ni chat), para aplicar y revertir
   una migración revisada y probar permisos reales.
2. Export autenticado del workflow TEST vivo y confirmación de credencial, rutas y
   ausencia de procesos que ignoren la exclusión. El TEST vivo es la fuente de verdad.
3. Coordinador y evidencia verificable de archivos/entrega, incluyendo fallo entre
   aislamiento y COMMIT y protección contra nuevos PDFs durante el reproceso.
4. Integración dentro del gate actual preservando snapshot, ownership y `can_emit`;
   repetir los 10 escenarios obligatorios en TEST, con al menos dos sesiones reales
   y combinación recuperación/reserva convencional. Prueba E2E Hub → n8n TEST → SQL → archivos.
5. Solo entonces completar endpoints/UI, migración versionada y reversible y abrir
   PR funcional. No se publicó una rama/PR con recuperación potencialmente insegura.

Producción no recibió conexiones SQL ni cambios en esta tarea. No se tocaron sus
registros 27/28, reservas 16/17 ni ajuste 3. Tampoco se modificaron el checkout
productivo, los worktrees principales, Audi, Pagos, n8n vivo, el convertidor o las
versiones de aplicación. La recuperación sigue sin habilitar en ambos entornos.
