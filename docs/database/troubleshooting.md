# Troubleshooting de base de datos

Formato por caso: **SÍNTOMA · CHEQUEO SOLO LECTURA · CAUSA PROBABLE · ACCIÓN SEGURA · NO HACER**. Todos los chequeos son de solo lectura y conviene ejecutarlos dentro de `BEGIN TRANSACTION READ ONLY; … ROLLBACK;`. Los chequeos marcados con 🔒 leen datos de negocio: requieren un rol con `SELECT` (**no** `daubert_docs_ro`) y deben limitarse a conteos/IDs, sin volcar contenido de contactos, correos, RFC ni tokens. Volver a [database](README.md). Runbooks por automatización: [Audi](../automations/audi/troubleshooting.md), [Caterpillar](../automations/caterpillar/troubleshooting.md), [Notificaciones](../automations/payment-notifications/troubleshooting.md); operación general: [operations/troubleshooting](../operations/troubleshooting.md).

Regla general: ante una duda, **no** reparar datos ni permisos por SQL directo. Diagnosticar, registrar el hallazgo y hacer el cambio como migración con precheck/postcheck ([migrations](migrations.md)).

## Connection denied

- **SÍNTOMA**: `FATAL: password authentication failed`, `no pg_hba.conf entry` o `permission denied for database`.
- **CHEQUEO**: `SELECT rolname, rolcanlogin, rolvaliduntil FROM pg_roles WHERE rolname = '<rol>';` y `SELECT has_database_privilege('<rol>', 'daubert_global', 'CONNECT');`. Revisar `host/port/db` de la credencial (n8n) o `DATABASE_URL` (Hub) — no imprimir la contraseña.
- **CAUSA PROBABLE**: credencial vencida/rotada; `pg_hba.conf` no admite el origen (Docker → host); nombre de base equivocado (TEST `daubert_hub_test` vs PROD `daubert_global`). Nota: `PUBLIC` tiene `CONNECT` en ambas bases, así que un rechazo de `CONNECT` sería anómalo.
- **ACCIÓN SEGURA**: corregir la credencial en el gestor (n8n / `.env` del operador) y reiniciar el servicio afectado.
- **NO HACER**: usar `postgres` como credencial de aplicación "para salir del paso"; pegar contraseñas en tickets/chats.

## Permission denied (tabla)

- **SÍNTOMA**: `permission denied for table X` en el Hub o en un nodo n8n.
- **CHEQUEO**: `SELECT has_table_privilege('<rol>', 'schema.tabla', 'SELECT,INSERT,UPDATE,DELETE');` y compara con [permissions-matrix](permissions-matrix.md). Confirma el **rol real** de la credencial (`SELECT current_user;` desde ese contexto).
- **CAUSA PROBABLE**: grant ausente (caso conocido: `daubert_hub_app` sobre `core.direcciones` en PROD, ver [hub-contract](hub-contract.md#brechas-detectadas)); objeto nuevo sin `GRANT` (no hay default privileges); TEST funciona porque `daubert_hub_test_user` es más ancho.
- **ACCIÓN SEGURA**: documentar el objeto, el rol y la operación; preparar una migración con `GRANT` mínimo y su `postcheck`; probarla primero en TEST con el rol **de PROD** (no con el usuario de TEST).
- **NO HACER**: `GRANT ALL`, `GRANT … ON ALL TABLES`, ejecutar como `postgres`, ni conceder `SELECT` a `daubert_docs_ro`.

## Function EXECUTE denied

- **SÍNTOMA**: `permission denied for function fn_…` / `reservar_folios_para_ejecucion`.
- **CHEQUEO**: `SELECT has_function_privilege('<rol>', 'ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)', 'EXECUTE');`; consultar `proacl`.
- **CAUSA PROBABLE**: se usa el rol equivocado (en TEST las funciones definer son de `n8n_cat_test`, no de `n8n_app`; en PROD, de `n8n_app`); función nueva sin `GRANT EXECUTE` (se revoca de `PUBLIC` por patrón); llamada desde el Hub, que **no** tiene `EXECUTE` de negocio a propósito.
- **ACCIÓN SEGURA**: apuntar la credencial al rol correcto; si falta el grant, migración `REVOKE … FROM PUBLIC` + `GRANT EXECUTE` al rol exacto (patrón 009).
- **NO HACER**: dejar `EXECUTE` en `PUBLIC`; dar `EXECUTE` de las funciones de n8n al Hub.

## View missing / column missing

- **SÍNTOMA**: `relation "core.vw_…" does not exist` o `permission denied for view`.
- **CHEQUEO**: `SELECT to_regclass('core.vw_catalogo_notificacion_pago_n8n');` y `has_table_privilege('n8n_app','core.vw_catalogo_notificacion_pago_n8n','SELECT')`. Comparar con [views](views/README.md).
- **CAUSA PROBABLE**: base equivocada (credencial de TEST apuntando a PROD o viceversa); privilegio faltante. Las 10 vistas existen y son idénticas en ambas bases.
- **ACCIÓN SEGURA**: verificar `SELECT current_database()` desde la misma conexión del workflow.
- **NO HACER**: recrear la vista a mano con otra definición; cambiar `security_invoker` (las vistas `_n8n` dependen de correr como propietario).

## Duplicate key (`23505`)

- **SÍNTOMA**: `duplicate key value violates unique constraint "…"` o `23505` devuelto por una función.
- **CHEQUEO**: identificar el índice en el mensaje y leer su definición en [indexes](indexes.md). Casos: `uq_ejecuciones_automatizacion_procesando`, `…_completada_original`, `…_reproceso_unico`, `uq_remisiones_serie_folio_no_cancelada`, `uq_reservas_folios_ejecucion_serie`, `uq_documentos_empresa_ruta_*`, `uq_alias_empresa_activo`, `uq_correos_notificacion_pago_message`.
- **CAUSA PROBABLE**: reintento legítimo (idempotencia: las funciones `fn_crear_ejecucion…`/`fn_registrar_remision…` ya lo traducen a `ya_existia`/`ALREADY_*`); Audi inserta ejecuciones con SQL directo y choca con una `PROCESANDO` previa; un alias o documento repetido.
- **ACCIÓN SEGURA**: tratar `23505` como señal de idempotencia primero; localizar la fila existente (🔒 por ID) antes de decidir.
- **NO HACER**: `DELETE` de la fila "en conflicto"; `ON CONFLICT DO UPDATE` improvisado; desactivar el índice.

## Serie inactiva

- **SÍNTOMA**: `Series with code X is inactive` (`55000`) o `is not an active route of execution …'s automation`.
- **CHEQUEO** 🔒: `SELECT codigo, estatus FROM operacion.series_documentales WHERE codigo = '<serie>';` y `SELECT estatus FROM ops.automatizacion_series_proceso WHERE serie_id = <id>;`.
- **CAUSA PROBABLE**: serie o ruta en `INACTIVA` (falla cerrado, intencional); serie de otra automatización.
- **ACCIÓN SEGURA**: decisión de negocio: reactivar mediante procedimiento aprobado (migración/cambio controlado con backup).
- **NO HACER**: cambiar `estatus` por SQL ad hoc con n8n corriendo; asignar la serie a otra automatización (el trigger `trg_automatizacion_series_proceso_dueno_unico` lo rechazará).

## Folio que no avanza

- **SÍNTOMA**: la numeración se repite, se detiene o el Hub muestra un `siguiente_folio` inesperado.
- **CHEQUEO** 🔒: `SELECT siguiente_folio, estatus, folio_minimo_ajustable FROM operacion.series_documentales WHERE codigo = '<serie>';`; últimas filas de `operacion.ajustes_series` de la serie; reservas `RESERVADA` de la serie (`ix_reservas_folios_serie_activa`).
- **CAUSA PROBABLE**: Caterpillar — reserva `RESERVADA` de una ejecución aún `PROCESANDO`; ajuste manual reciente (ver `ajustes_series`); Audi — el allocator legado avanza sin dejar rastro, un cambio directo no aparece en ninguna auditoría. Ver [folios](folios.md).
- **ACCIÓN SEGURA**: usar el ajuste del Hub (con `expectedCurrentFolio`, piso y verificación de solapes) si realmente hay que mover el contador.
- **NO HACER**: `UPDATE operacion.series_documentales SET siguiente_folio = …` directo; reutilizar folios sin revisar los PDFs emitidos.

## Reserva huérfana

- **SÍNTOMA**: una reserva `RESERVADA` cuya ejecución ya no avanza, o folios saltados.
- **CHEQUEO** 🔒: reservas `RESERVADA` unidas a `ops.ejecuciones_automatizacion` (estado y `updated_at`); remisiones `GENERADA` en su rango vs `cantidad`.
- **CAUSA PROBABLE**: ejecución `PROCESANDO` detenida (n8n caído, workflow sin `fn_registrar_fallo…`); folios abandonados **por diseño** (`ABANDONADA` no se recicla).
- **ACCIÓN SEGURA**: reprocesar/cancelar la ejecución con el flujo oficial (Caterpillar: reproceso desde el Hub; finaliza con `fn_finalizar…` que abandona la reserva).
- **NO HACER**: borrar filas de `reservas_folios` (FK `RESTRICT` lo impide) ni "reciclar" el rango.

## Ejecución en `PROCESANDO`

- **SÍNTOMA**: ejecución que no termina; nuevo intento sobre el mismo documento devuelve `ALREADY_PROCESSING` (Caterpillar) o error `23505` (Audi, `INSERT` directo).
- **CHEQUEO** 🔒: filas de `ops.ejecuciones_automatizacion` con `estado = 'PROCESANDO'` (ID, automatización, `iniciada_en`, `intentos_fallidos`, `max_intentos`); contrastar con la ejecución de n8n (`n8n_execution_id`). **No hay ningún job en la base** que recupere ejecuciones (solo existe la extensión `plpgsql`; sin `pg_cron`).
- **CAUSA PROBABLE**: Caterpillar — reintentos aún vigentes (`intentos_fallidos < max_intentos`) o workflow interrumpido; Audi — nunca llama a `fn_registrar_fallo_ejecucion`, así que un fallo tras `Crear ejecución PG` deja la ejecución `PROCESANDO` indefinidamente y el índice `uq_ejecuciones_automatizacion_procesando` bloquea un nuevo intento sobre el mismo documento.
- **ACCIÓN SEGURA**: Caterpillar → `fn_registrar_fallo_ejecucion`/`fn_finalizar_ejecucion_automatizacion` mediante el workflow o procedimiento aprobado. Audi → **PENDIENTE**: no existe procedimiento oficial; decidir con el responsable antes de tocar la fila.
- **NO HACER**: `UPDATE … SET estado = 'COMPLETADA'` a mano (se salta la verificación de integridad y deja reservas `RESERVADA`); borrar la ejecución (tiene FK `RESTRICT` desde remisiones/reservas).

## Reproceso: violación de unicidad

- **SÍNTOMA**: intento de reprocesar una ejecución que ya tiene hijo; en versiones sin la 009 aparecía `23505` crudo por `uq_ejecuciones_automatizacion_reproceso_unico`.
- **CHEQUEO** 🔒: `SELECT ejecucion_id FROM ops.ejecuciones_automatizacion WHERE reproceso_de_id = <padre>;` (máximo una fila por el índice). Confirmar que `fn_crear_ejecucion_automatizacion` tiene el cuerpo con md5 `929939dcc7cd3ef0e09b7b2a868b9616` (CR ignorado).
- **CAUSA PROBABLE**: reproceso repetido del mismo padre → la función devuelve `ALREADY_REPROCESSED` (comportamiento correcto desde la 009).
- **ACCIÓN SEGURA**: seguir la cadena hacia la hija y consultar su estado.
- **NO HACER**: eliminar el índice único; reprocesar desde una ejecución que no es el padre directo. Ver [reprocessing](../automations/caterpillar/reprocessing.md).

## TEST funciona, PROD falla

- **SÍNTOMA**: la misma operación pasa en TEST y da `permission denied` (u otro error) en PROD.
- **CHEQUEO**: comparar roles efectivos ([test-prod-drift](test-prod-drift.md#permisos)): el Hub usa `daubert_hub_test_user` (DML amplio) en TEST y `daubert_hub_app` (acotado) en PROD; Caterpillar usa `n8n_cat_test` en TEST y `n8n_app` en PROD. Estructura y funciones son iguales; **lo que difiere son los grants**.
- **CAUSA PROBABLE**: permission drift (p. ej. `core.direcciones`).
- **ACCIÓN SEGURA**: reproducir en TEST con el **mismo rol** que PROD (o dar a TEST los mismos grants por migración) antes de concluir.
- **NO HACER**: "arreglar" PROD copiando los grants de TEST.

## Schema drift

- **SÍNTOMA**: una migración `precheck` falla, o un objeto existe en una base y no en la otra.
- **CHEQUEO**: [test-prod-drift](test-prod-drift.md) (estado al 2026-09-24: sin drift estructural ni funcional). Reproducir: contar objetos por `relkind` y comparar `sha256(pg_get_functiondef)`/`pg_get_viewdef`.
- **CAUSA PROBABLE**: cambio manual fuera de migración; migración aplicada solo en un entorno. No hay tabla de control de migraciones que lo delate.
- **ACCIÓN SEGURA**: documentar la diferencia y su origen; regularizar con una migración versionada.
- **NO HACER**: igualar bases a ojo con DDL manual; usar el cuerpo de una función de TEST en PROD sin precheck de hash.

## Migración parcial

- **SÍNTOMA**: `up` interrumpido, objetos a medias, `postcheck` en falso.
- **CHEQUEO**: las migraciones versionadas (009) son transaccionales (`BEGIN … COMMIT`): una interrupción hace `ROLLBACK` completo. Confirmar con el `precheck` (todo booleano según su guía) y los hashes de línea base.
- **CAUSA PROBABLE**: migración sin transacción (históricas del directorio externo), `CREATE INDEX CONCURRENTLY`, o aplicada solo en parte manualmente.
- **ACCIÓN SEGURA**: no reintentar a ciegas: correr `precheck`, comparar con el `down`/línea base, decidir rollback (si sus guards lo permiten) o corrección hacia adelante. Backup verificado antes ([database-backup-restore](../operations/database-backup-restore.md)).
- **NO HACER**: re-ejecutar `up` "a ver si termina"; borrar objetos manualmente para "limpiar".

## SECURITY DEFINER issue

- **SÍNTOMA**: una función `SECURITY DEFINER` devuelve `permission denied` internamente, o se sospecha escalamiento.
- **CHEQUEO**: `SELECT proname, proowner::regrole, prosecdef, proconfig, proacl FROM pg_proc WHERE proname = '<fn>';` y comparar con [security-definer](security-definer.md). Un `permission denied` **dentro** de la función indica que el propietario (`postgres`) perdió un privilegio o que el objeto pertenece a otro rol; el llamador solo necesita `EXECUTE`.
- **CAUSA PROBABLE**: `search_path` alterado por un `CREATE OR REPLACE` sin `SET search_path`; `EXECUTE` concedido de más; propietario distinto tras un `ALTER OWNER`.
- **ACCIÓN SEGURA**: reemplazar la función por migración con hash-guard (patrón 009: negarse a sobrescribir un cuerpo desconocido).
- **NO HACER**: quitar `SECURITY DEFINER` para "arreglarlo" (n8n perdería acceso a `reservas_folios`); dejar `EXECUTE` a `PUBLIC`.

## Auditoría vacía o incompleta

- **SÍNTOMA**: un cambio no aparece en `audit.cambios`.
- **CHEQUEO**: ver en [triggers](triggers.md) si la tabla tiene trigger de auditoría (no lo tienen `operacion.*`, `ops.ejecuciones_automatizacion`, `core.documentos`, `security.sessions`, `staging.*`). Verificar que la transacción fijó `app.user_id`/`app.origin`.
- **CAUSA PROBABLE**: tabla sin trigger por diseño; escritura por n8n (origen `SISTEMA`, sin `app.*`).
- **ACCIÓN SEGURA**: usar `ajustes_series`/`ops.ejecuciones_automatizacion` como rastro alterno.
- **NO HACER**: escribir directamente en `audit.cambios` (los roles de aplicación no pueden; `daubert_hub_test_user` sí en TEST — no usarlo como práctica).
