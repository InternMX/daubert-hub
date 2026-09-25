# Catálogo de funciones

13 funciones propias (12 `plpgsql`, 1 `sql`), 0 procedimientos, 0 agregadas. 10 son `SECURITY DEFINER` ([clasificación](../security-definer.md)). Volver a [database](../README.md).

| función | tipo | seguridad | clasificación | propósito |
| --- | --- | --- | --- | --- |
| [`audit.fn_registrar_cambio`](audit.fn_registrar_cambio.md) | trigger | DEFINER | OK | Trigger genérico de auditoría. |
| [`audit.fn_registrar_cambio_security_users`](audit.fn_registrar_cambio_security_users.md) | trigger | DEFINER | OK | Variante para `security.users`: excluye `password_hash` de los JSONB, ignora cambios que solo alteran `updated_at`/`last_login_at` y agrega `password_changed: true` cuando cambió el hash. |
| [`core.fn_actualizar_updated_at`](core.fn_actualizar_updated_at.md) | trigger | INVOKER | N/A (INVOKER) | Trigger `BEFORE UPDATE` que fija `NEW.updated_at = NOW()`. |
| [`core.fn_crear_o_resolver_documento`](core.fn_crear_o_resolver_documento.md) | función | DEFINER | OK | Crea un documento origen en `core.documentos` o devuelve el existente (mismo `empresa_id` + ruta normalizada [+ hash]). |
| [`operacion.fn_registrar_remision_generada`](operacion.fn_registrar_remision_generada.md) | función | DEFINER | OK | Persiste una remisión `GENERADA` y sus renglones. |
| [`operacion.reservar_folios`](operacion.reservar_folios.md) | función | INVOKER | N/A (INVOKER) | **Allocator legado (Audi).** Bloquea la serie por código (`FOR UPDATE`), verifica que el rango pedido no choque con remisiones no canceladas y avanza `siguiente_folio`. |
| [`operacion.reservar_folios_para_ejecucion`](operacion.reservar_folios_para_ejecucion.md) | función | DEFINER | OK | Reserva atómica e idempotente de un rango de folios para una ejecución `PROCESANDO`: valida serie existente, ruta ACTIVA de la automatización y serie ACTIVA; inserta `reservas_folios` (`RESERVADA`) y avanza `siguiente_folio`. |
| [`ops.fn_crear_ejecucion_automatizacion`](ops.fn_crear_ejecucion_automatizacion.md) | función | DEFINER | REVIEW | Crea o recupera la ejecución de un documento. |
| [`ops.fn_finalizar_ejecucion_automatizacion`](ops.fn_finalizar_ejecucion_automatizacion.md) | función | DEFINER | OK | Cierra una ejecución (`COMPLETADA`/`ERROR`/`CANCELADA`). |
| [`ops.fn_registrar_fallo_ejecucion`](ops.fn_registrar_fallo_ejecucion.md) | función | DEFINER | OK | Registra el fallo de un intento de n8n sin doble conteo del mismo `n8n_execution_id`; incrementa `intentos_fallidos`; al agotar `max_intentos` finaliza en `ERROR` llamando a `fn_finalizar_ejecucion_automatizacion` (abandona reservas). |
| [`ops.fn_resolver_ejecucion_para_reproceso`](ops.fn_resolver_ejecucion_para_reproceso.md) | función | DEFINER | OK | Lectura mínima para el webhook de reproceso: une ejecución ↔ automatización `REMISIONES_CATERPILLAR` ↔ documento origen. |
| [`ops.fn_resolver_ruta_automatizacion`](ops.fn_resolver_ruta_automatizacion.md) | función | DEFINER | OK | Devuelve la ruta ACTIVA (serie, estatus de serie, cliente y su nombre comercial) para (`codigo`, `llave_proceso`). |
| [`ops.fn_validar_dueno_unico_serie_proceso`](ops.fn_validar_dueno_unico_serie_proceso.md) | trigger | INVOKER | N/A (INVOKER) | Trigger `BEFORE INSERT/UPDATE OF serie_id, automatizacion_id` en `ops.automatizacion_series_proceso`: impide que una serie quede ruteada bajo dos automatizaciones distintas. |
