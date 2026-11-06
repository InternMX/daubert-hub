# Asignación puntual de archivos — puesta en PRODUCCIÓN

Estado al **2026-10-22**: **desplegada y habilitada (fases A y B) en PRODUCCIÓN; pendiente de validar con el primer ZIP real.**
Todo lo marcado como *validado* se refiere únicamente al entorno indicado; **nada se ha probado todavía en PRODUCCIÓN con un comprobante real**.
Sin secretos: solo se nombran variables, no sus valores. Contrato técnico de la función: [file-assignment-contract](file-assignment-contract.md). Operación diaria: [production-runbook](production-runbook.md#asignación-puntual-de-comprobantes).

## A. Resumen de la actualización

**Problema.** Cuando Contabilidad genera un comprobante cuyo alias no coincide con el catálogo, ese PDF queda en `ERROR` (`ALIAS_NO_CATALOGADO`) y no se notifica.
Hasta ahora la única salida era crear un **alias permanente** para la empresa, lo que afecta a todos los comprobantes futuros con ese nombre.

**Asignación puntual vs. alias permanente.**

| | Alias permanente | Asignación puntual (nuevo) |
| --- | --- | --- |
| Alcance | Todos los comprobantes futuros con ese alias | **Un solo archivo** de **un solo correo** (identidad individual del PDF) |
| Dónde se guarda | `core.alias_empresa` (catálogo) | `core.asignaciones_archivo_notificacion_pago` |
| Efecto sobre otros PDF | Los afecta | **No**: los demás PDF del correo, aunque tengan el mismo alias, siguen en error |
| Reversible | Se desactiva el alias | Se cambia o se revoca (con control de versión) |

**Flujo objetivo.** Contabilidad genera un comprobante con alias desconocido → queda en `ERROR` → desde el Hub se elige la empresa correcta para **ese PDF** → *Reprocesar* → n8n procesa el comprobante con la empresa asignada, sin crear alias permanente ni afectar otros archivos.

**Alcance de la actualización.**

| Componente | Cambio |
| --- | --- |
| Daubert Hub (API + Web) | Interfaz y API de asignación puntual; guarda y consulta en PostgreSQL; despacho de reproceso con elegibilidad por archivo. Commit `6370753` |
| PostgreSQL `daubert_global` | Migraciones **015, 016 y 017** (tablas y funciones nuevas; sin tocar objetos existentes) |
| n8n 5678 | Workflow de Pagos **v2**: de 100 a **108 nodos** (ID nuevo `pagosProdAsignaciones01`); el anterior queda inactivo como rollback |
| Sin cambios | Catálogo de aliases permanentes, borradores/Outlook, resumen a Sofía, Caterpillar, Audi |

## B. Implementación técnica

**PR #14** (`feat/payment-file-assignments-prod-readiness`) — merge commit `637075315918e732510d1a5ed903ca5937a6da23` (`6370753`). Incluye el commit `f1bf30c` (destino TEST compartido) y la preparación productiva.

**Hub.**
- API: `payment-file-assignments.service.ts` / `.repository.ts` / `payment-file-n8n-target.ts`, `config/environment.ts`. Web: diálogo de asignación puntual y control por archivo (`AssignPaymentAliasDialog.tsx`, `PaymentNotificationFileErrors.tsx`).
- Habilitación **independiente de TEST**: cada entorno solo respeta sus propias banderas. El destino de n8n productivo está en una **lista cerrada** (host `host.docker.internal`/`127.0.0.1`/`localhost`, puerto `5678`, ruta exacta `/webhook/daubert-hub/notificaciones-pago/reprocesar`); las rutas de TEST se rechazan.
- `compose.pilot.yaml` ahora pasa (opcionales) `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL/TOKEN` y las tres banderas de producción.

**Variables de entorno** (solo nombres; los valores viven en `deploy/pilot.prod.env`, no versionado).

| Variable | Valor actual en PROD | Efecto |
| --- | --- | --- |
| `PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED` | `true` (fase A) | El Hub consulta las tablas nuevas y permite guardar, cambiar y revocar asignaciones |
| `PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_READY` | `true` (fase B) | El reproceso usa la elegibilidad por archivo (`fn_reproceso_asignaciones_puntuales`) en lugar de bloquear cualquier asignación activa |
| `PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_ORIGIN` | origen del n8n productivo (`http://host.docker.internal:5678`) | Debe coincidir con el origen del webhook |
| `PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL` / `PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN` | Webhook productivo y token compartido | Sin cambios; el token es el de la credencial Header Auth `Daubert Hub - n8n PROD` (la misma de los webhooks de health y Caterpillar) |

Las banderas `PAYMENT_FILE_ASSIGNMENTS_TEST_*`/`_N8N_*` no se pasan al contenedor productivo y no pueden activar producción.

**Migraciones PROD** (`database/migrations/daubert_global/20261022_015…017_*_prod.*`; cada una con `precheck`, `up`, `postcheck`, `down`; aplicadas **manualmente** por el administrador el 2026-10-21; las 012–014 son las equivalentes TEST-only, con guarda de base):

| Migración | Contenido |
| --- | --- |
| 015 | Tablas `core.archivos_notificacion_pago` (identidad individual del PDF) y `core.asignaciones_archivo_notificacion_pago`; triggers de auditoría; funciones `fn_registrar_archivo_notificacion_pago`, `fn_resolver_archivo_notificacion_pago`, `fn_archivo_notificacion_asignable`, `fn_bloquear_archivos_reproceso_pago` |
| 016 | `fn_consultar_archivo_notificacion_pago`: consulta/toma con resultado estructurado (`PROCESABLE_ASIGNADO`, `PROCESABLE_SIN_ASIGNACION`, `REINTENTO_ASIGNADO`, `COMPLETADO`, `YA_TOMADO`, `EFECTOS_INCIERTOS`, `IDENTIDAD_*`, `CONFLICTO_*`) |
| 017 | `fn_evaluar_archivo_notificacion_pago` (interna) y `fn_reproceso_asignaciones_puntuales` (solo lectura, para el Hub); la consulta 016 delega en el evaluador |

**Permisos** (verificados en solo lectura tras aplicar): todas las funciones son `SECURITY DEFINER` con `search_path` fijo.

| Rol | Tiene | No tiene |
| --- | --- | --- |
| `n8n_app` (compartido con Caterpillar/Audi) | `EXECUTE` solo en `fn_registrar_archivo_notificacion_pago` y `fn_consultar_archivo_notificacion_pago` | Acceso a las tablas nuevas; el resto de funciones |
| `daubert_hub_app` | `SELECT` en archivos; `SELECT/INSERT/UPDATE` en asignaciones; `EXECUTE` en `fn_archivo_notificacion_asignable`, `fn_bloquear_archivos_reproceso_pago`, `fn_reproceso_asignaciones_puntuales` | Registrar/resolver/consultar identidades; `DELETE` |
| `PUBLIC` | Nada | — |

**Workflow de Pagos: 100 → 108 nodos.** Se construyó sobre el workflow **vivo de PROD** (`887c122b`, no sobre el histórico de TEST, que ya difería de PROD) aplicando solo el delta de la integración:
- **8 nodos nuevos:** `Registrar archivo (identidad)`, `Aplicar registro de archivo`, `Resolver asignacion puntual`, `Aplicar asignacion puntual`, `Registrar archivo (incidencia)`, `Aplicar registro de incidencia`, `Tomar archivo (inicio de procesamiento)`, `Aplicar toma de archivo`.
- **9 modificados:** `Preparar metadatos ZIP` (SHA-256 del ZIP, ID del adjunto e inventario real del directorio central con `fflate`), `Separar archivos descomprimidos` (identidad por nombre base + tamaño, entrada única), `Calcular identidad PDF`, `Clasificar con catalogo` (la asignación puntual tiene prioridad y no cae al catálogo si falla), `Verificar duplicados`, `¿Procesar en esta ejecución?`, `Registrar correo pendiente`, `Preparar correo para reproceso` (una columna `base_datos`) y `Configurar entorno` (política de zona: las rutas deben quedar dentro de Dropbox y la base debe ser `daubert_global`).
- **Conservados idénticos a PROD:** credenciales, filtro de remitente, Schedule, webhook y autenticación, rutas de Dropbox, borradores/envíos reales, resumen a Sofía, lógica de reproceso `OMITIDO`.
- Requiere `NODE_FUNCTION_ALLOW_EXTERNAL=fflate` en el proceso de n8n (variable de usuario de Windows, ya efectiva).
- Los JSON no se versionan en este repositorio (ver [n8n/security-notes](../../../n8n/security-notes.md)).

**Identificación individual de PDF.** Cada PDF de un ZIP se registra con: correo, ID del adjunto, SHA-256 del ZIP, índice real de la entrada, SHA-256 del PDF y nombre. Solo con **un único ZIP** en el correo hay ID de adjunto confiable; con varios, se procesa por catálogo pero sin asignación puntual. Un cambio posterior del ZIP o del PDF marca la identidad como ambigua y bloquea (nunca cae al catálogo en silencio).

**Reproceso desde el Hub.** `POST /api/automations/payment-notifications/:executionId/reprocess` → bloquea archivos en `REPROCESO_SOLICITADO` → webhook de n8n → el workflow consulta cada archivo (`fn_consultar_archivo_notificacion_pago`) y usa la empresa asignada. Un fallo, una función ausente o un veredicto no afirmativo **mantienen el bloqueo** (fail-closed).

## C. Funcionamiento operativo

La guía paso a paso está en el [runbook](production-runbook.md#asignación-puntual-de-comprobantes). Resumen:
- Un archivo con `ALIAS_NO_CATALOGADO` (o `ALIAS_AMBIGUO`) aparece en el detalle del correo con su propio control de asignación.
- Solo se puede asignar un archivo con identidad **VERIFICADA**, estado operativo **SIN_EFECTOS**, sin resultados ni borradores previos del correo, y cuya incidencia coincida con el registro del extractor.
- El reproceso del correo se bloquea si hay una asignación cuyo estado no permite reprocesar con seguridad; sin asignaciones, el reproceso se comporta como siempre.
- Los demás PDF del mismo correo no se ven afectados.

## D. Despliegue y rollback

| Elemento | Valor |
| --- | --- |
| Hub desplegado | `6370753` (`1.0.6`), 2026-10-21 (proyecto Compose `daubert-hub`, puerto `8082`). Nota: [2026-10-22-payment-file-assignments-prod](../../deployments/2026-10-22-payment-file-assignments-prod.md) |
| Hub anterior | `cbcb6f3` — imágenes ancla `daubert-hub-api:rollback-cbcb6f3` y `daubert-hub-web:rollback-cbcb6f3` y `docker save` en `_hub_rollback\` |
| Workflow nuevo (activo) | `pagosProdAsignaciones01` — «Produccion Notificacion de pagos a Proveedores - v2 asignaciones puntuales», 108 nodos, publicado el 2026-10-22 |
| Workflow anterior (inactivo, rollback) | `3Dh72JJYROHtaw1X` — «Produccion Notificacion de pagos a Proveedores», 100 nodos, versión `887c122b`, **sin editar** |
| Fases | A (2026-10-22): `PROD_ENABLED=true`. B (2026-10-22): `PROD_N8N_READY=true` + origen. Respaldos del `pilot.prod.env` previos a cada fase en `_hub_rollback\` |
| Respaldos | n8n OnChange cifrados (age) en `…\BACKUPS\DAUBERT HUB\N8N\ON_CHANGE\` (último previo al cambio: 2026-10-22); PostgreSQL en `…\BACKUPS\DAUBERT HUB\POSTGRESQL\` (Daily del 2026-10-21); export exacto del workflow anterior (JSON + fila SQLite) en `n8n-test-aislado\produccion\respaldo_prod_887c122b\` |

**Deshabilitar las asignaciones sin desactivar Pagos** (solo el Hub; n8n, PostgreSQL y el procesamiento de correos no se tocan):
1. Copiar `deploy/pilot.prod.env` a `_hub_rollback\` y poner `PAYMENT_FILE_ASSIGNMENTS_PROD_N8N_READY=false` y `…_N8N_ORIGIN=` (vacío) → vuelve a la **fase A** (se pueden guardar asignaciones, el reproceso con asignaciones queda bloqueado).
2. Para apagar también la gestión: `PAYMENT_FILE_ASSIGNMENTS_PROD_ENABLED=false`.
3. Recrear solo el `api`: `docker compose --project-name daubert-hub --env-file deploy/pilot.prod.env -f compose.pilot.yaml -f compose.prod-temp.yaml up -d --no-build api` (nunca `down`).
4. Las asignaciones ya guardadas permanecen en la base; mientras estén apagadas no se usan.

**Volver al workflow anterior** (si falla el v2, < 1 minuto, sin reiniciar n8n): en la interfaz de n8n, **despublicar** `pagosProdAsignaciones01`, **publicar** `3Dh72JJYROHtaw1X` sin editarlo y comprobar con `n8n-test-aislado\produccion\estado_cambio.py` (un solo workflow de Pagos activo, webhook registrado a su nombre y respondiendo 403 sin token, siguiente ciclo `success`). Si hubo asignaciones, deshabilitarlas primero en el Hub (paso anterior): el workflow antiguo no las entiende.

**Rollback del Hub** (imagen anterior): procedimiento del [deployment-checklist](../../operations/deployment-checklist.md#rollback) (anclas `rollback-cbcb6f3`, sin `down`).

**Qué NO debe revertirse automáticamente:** las migraciones 015–017 (los `down` solo proceden con las tablas vacías; tras el primer uso la recuperación es apagar el Hub y volver al workflow anterior, conservando las tablas), los registros de `archivos_notificacion_pago`/`asignaciones_…` ni los correos ya procesados, y los borradores ya creados en Outlook.

## E. Validación y pendientes

**Validado en TEST (no es validación de producción):**
- E2E Hub TEST → n8n aislado (5690) → `daubert_hub_test` con Outlook y Dropbox simulados: 18/18 comprobaciones (asignación, reproceso, idempotencia, bloqueos y alias permanente); política de rutas probada aparte en Docker y en Windows.
- n8n Windows 5678 con el workflow de pruebas: ingesta de un ZIP sintético con `fflate` (2 PDF identificados); correo con 2 PDF del mismo alias desconocido → asignación de **un** PDF a una empresa sintética desde el Hub TEST → reproceso → empresa asignada procesada, borrador simulado único, el otro PDF intacto, catálogo de aliases sin cambios, sin duplicados.
- **Prueba visual** del correo sintético **528** en la interfaz: dos PDF visibles, asignación del primero a la empresa 1921 («Cambio guardado»), el segundo sin asignación, reproceso bloqueado en fase A; la asignación se devuelve al consultar por API y no se creó ningún alias.

**Verificado sobre la base y el código de PRODUCCIÓN (sin efectos):**
- Migraciones 015–017: prechecks y postchecks OK; permisos (`n8n_app`, `daubert_hub_app`, `PUBLIC`) comprobados en solo lectura; tablas nuevas vacías; datos operativos intactos.
- Ensayo de las migraciones (up, postcheck, down, up) en un PostgreSQL desechable.
- Regla de identidad aplicada, solo lectura, a 6 ZIP reales de producción ya almacenados por n8n: 72/72 entradas confiables, 0 ambiguas (todos con subcarpetas).
- Las 198 rutas del catálogo pasan la política de zona contra el disco real.
- Un correo histórico (sin archivos registrados) reprocesado en un entorno desechable sigue por el catálogo.
- Hub: pruebas (API 1867, Web 1194), `typecheck`, `lint`, `build`; el frontend servido en `:8082` es idéntico byte a byte al probado en TEST; las banderas efectivas en el contenedor se verificaron.
- Workflow v2: 56 comprobaciones estáticas (credenciales, filtro, Schedule, webhook, rutas, envíos/borradores reales, aliases, reprocesos) y primera ejecución programada de PROD **9716** (2026-10-22 19:45 UTC): `success`, sin correos nuevos.

**PENDIENTE EXPLÍCITO — primer ZIP real en PRODUCCIÓN.** Ningún correo real ha pasado todavía por el workflow v2: no está validada en producción la ingesta con registro de archivos, ni la asignación ni el reproceso puntual con datos reales. Hasta completar el checklist no se debe usar la asignación ni el reproceso puntual con comprobantes reales.

**Checklist para validar el primer ZIP real** (solo lectura salvo indicación; antes de autorizar el uso operativo):
1. El correo termina en el estado esperado (`PROCESADO`, o `ERROR` si hay archivos con incidencia), sin quedar `PENDIENTE`, y la ejecución de n8n correspondiente es `success`.
2. `core.archivos_notificacion_pago` tiene **una fila por cada PDF** del ZIP (índice real, SHA-256 del ZIP y del PDF, ID de adjunto), con identidad `VERIFICADA`; los PDF con `ALIAS_NO_CATALOGADO` quedan `SIN_EFECTOS` y los procesados `INICIADO`.
3. Cada PDF clasificado está en la carpeta de su proveedor (ruta del catálogo, dentro de Dropbox) y no hay copias duplicadas; los errores están en `04_ERRORES\PDF`.
4. Hay **un solo borrador** por empresa (`borradores_notificacion_pago` en `CREADO` con `outlook_draft_id`) y el borrador existe en Outlook con la firma y los adjuntos esperados.
5. El resumen a Sofía se envió una vez (`resumen_enviado = true`) con los conteos correctos.
6. `core.asignaciones_archivo_notificacion_pago` sigue vacía y no se crearon alias (`core.alias_empresa` sin cambios).
7. Sin errores nuevos en `04_ERRORES\OUTLOOK`, el log diario ni la ejecución de n8n; el Hub (`/api/health`, logs) sin errores.
8. En el Hub, el detalle del correo muestra los PDF con error como archivos individuales con el control de asignación habilitado solo para los elegibles.
9. Solo después, con el primer caso real de alias desconocido, ejecutar la asignación y el reproceso de **un** archivo con supervisión y repetir 2–7 para esa empresa.

Si el primer ZIP falla en la ingesta (p. ej. módulo `fflate` no disponible, o `RUTA_FUERA_DE_ZONA_AUTORIZADA`), se aplica el rollback de la sección D (volver al workflow anterior) antes de procesar más correos.

**Otros pendientes:** el correo `PENDIENTE` histórico **38** (desde 2026-09-14, sin ejecución activa) se mantiene sin tocar y se excluye de las comprobaciones de ventana; el rol `n8n_app` es compartido con Caterpillar/Audi (dos `EXECUTE` más; un rol dedicado queda como mejora futura).
