# Funciones SECURITY DEFINER

Inventario de las **10** funciones `SECURITY DEFINER` de PROD (las mismas 10 en TEST). Clasificación **documental** (`OK` / `REVIEW` / `HIGH_RISK`); no se corrigió nada. Fuente: `pg_proc` (`prosecdef`, `proconfig`, `proacl`, `proowner`) y `pg_get_functiondef()`. Volver a [database](README.md).

## Resultado

- **HIGH_RISK: 0** · **REVIEW: 1** · **OK: 9**.
- Las 10 tienen `search_path` fijo (`pg_catalog, <schemas>`), **ninguna** deja `EXECUTE` en `PUBLIC` salvo las 2 funciones trigger de auditoría (no invocables directamente).
- Ninguna usa SQL dinámico (`EXECUTE format(...)`): superficie de inyección nula dentro de las funciones.
- **Todas pertenecen a `postgres` (superusuario)**: si una función tuviera un defecto, se ejecutaría con privilegios de superusuario. Mejora futura (no aplicada): un propietario `NOLOGIN` dedicado con los grants mínimos.
- `pg_temp` no aparece explícito en ningún `search_path`; PostgreSQL lo busca primero para relaciones cuando se omite. Como todos los cuerpos usan nombres calificados por schema y `PUBLIC` tiene `TEMPORARY`, el riesgo práctico es bajo, pero la práctica recomendada es añadir `pg_temp` al final del `search_path`.

## Inventario

| función | owner | search_path | `EXECUTE` a PUBLIC | roles con EXECUTE (PROD) | objetos accedidos | clasificación | motivo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [`audit.fn_registrar_cambio`](functions/audit.fn_registrar_cambio.md) | postgres | `search_path=pg_catalog, audit` | sí | PUBLIC (todos los roles) | `audit.cambios` | **OK** | Solo trigger; `search_path` fijo; escribe únicamente en `audit.cambios` (calificado por esquema). `EXECUTE` por defecto en `PUBLIC` sin efecto práctico (no invocable fuera de un trigger). |
| [`audit.fn_registrar_cambio_security_users`](functions/audit.fn_registrar_cambio_security_users.md) | postgres | `search_path=pg_catalog, audit` | sí | PUBLIC (todos los roles) | `audit.cambios` | **OK** | Igual que la anterior; además elimina `password_hash` del payload. |
| [`core.fn_crear_o_resolver_documento`](functions/core.fn_crear_o_resolver_documento.md) | postgres | `search_path=pg_catalog, core` | no | n8n_app | `core.documentos` | **OK** | `EXECUTE` solo `postgres` + `n8n_app`/`n8n_cat_test`; el rol ya tiene `INSERT` directo en `core.documentos` (Audi), por lo que no hay escalamiento. |
| [`operacion.fn_registrar_remision_generada`](functions/operacion.fn_registrar_remision_generada.md) | postgres | `search_path=pg_catalog, operacion, ops` | no | n8n_app | `operacion.remision_detalle`, `operacion.remisiones`, `operacion.reservas_folios`, `operacion.series_documentales`, `ops.automatizacion_series_proceso`, `ops.ejecuciones_automatizacion` | **OK** | Deriva el cliente en servidor; valida reserva y ownership; nombres calificados. |
| [`operacion.reservar_folios_para_ejecucion`](functions/operacion.reservar_folios_para_ejecucion.md) | postgres | `search_path=pg_catalog, operacion, ops` | no | n8n_app | `operacion.reservas_folios`, `operacion.series_documentales`, `ops.automatizacion_series_proceso`, `ops.ejecuciones_automatizacion` | **OK** | Valida ejecución, ruta y estado; sin SQL dinámico. |
| [`ops.fn_crear_ejecucion_automatizacion`](functions/ops.fn_crear_ejecucion_automatizacion.md) | postgres | `search_path=pg_catalog, ops` | no | n8n_app | `ops.automatizaciones`, `ops.ejecuciones_automatizacion` | **REVIEW** | No valida el padre de un reproceso (estado, automatización, documento): la regla de elegibilidad no está en la base. Sin escalamiento de privilegios (el rol ya puede `INSERT` en la tabla). |
| [`ops.fn_finalizar_ejecucion_automatizacion`](functions/ops.fn_finalizar_ejecucion_automatizacion.md) | postgres | `search_path=pg_catalog, ops, operacion` | no | n8n_app | `operacion.remisiones`, `operacion.reservas_folios`, `ops.ejecuciones_automatizacion` | **OK** | Opera sobre cualquier `ejecucion_id`; el rol ya tiene `UPDATE` directo sobre la tabla (Audi). |
| [`ops.fn_registrar_fallo_ejecucion`](functions/ops.fn_registrar_fallo_ejecucion.md) | postgres | `search_path=pg_catalog, ops, operacion` | no | n8n_app | `operacion.reservas_folios`, `ops.ejecuciones_automatizacion` | **OK** | Igual que la anterior. |
| [`ops.fn_resolver_ejecucion_para_reproceso`](functions/ops.fn_resolver_ejecucion_para_reproceso.md) | postgres | `search_path=pg_catalog, ops` | no | n8n_app | `core.documentos`, `ops.automatizaciones`, `ops.ejecuciones_automatizacion` | **OK** | Superficie mínima, solo lectura, restringida a una automatización. |
| [`ops.fn_resolver_ruta_automatizacion`](functions/ops.fn_resolver_ruta_automatizacion.md) | postgres | `search_path=pg_catalog, ops, operacion, core` | no | n8n_app | `core.empresas`, `operacion.series_documentales`, `ops.automatizacion_series_proceso`, `ops.automatizaciones` | **OK** | Solo lectura; sin uso conocido (candidata a retiro/uso). |

## Por qué `ops.fn_crear_ejecucion_automatizacion` es REVIEW y no HIGH_RISK

- **Qué hay que revisar**: al crear un reproceso no valida al padre (que exista, su estado, su automatización ni su documento). La regla de elegibilidad de un reproceso **no vive en la base**; depende de que quien llama (Hub/n8n) la haya aplicado. Es una laguna de integridad, no de seguridad.
- **Por qué no es HIGH_RISK**: (a) el único rol con `EXECUTE` es `n8n_app`, que ya tiene `INSERT` directo sobre `ops.ejecuciones_automatizacion`, así que la función **no le otorga nada nuevo** (sin escalamiento de privilegios); (b) `search_path` fijo, nombres calificados, sin SQL dinámico; (c) `PUBLIC` sin `EXECUTE`; (d) los índices únicos parciales de la tabla siguen aplicando. Criterio de HIGH_RISK usado: función definer que permita a un rol obtener acceso/escritura que no tendría de otro modo, o con superficie de inyección. Ninguna cumple.
- No se modificó la función; cualquier cambio es decisión de una fase posterior.

## Posible escalamiento: análisis

- **Del Hub (`daubert_hub_app`)**: sin `EXECUTE` de negocio → no puede invocar ninguna definer. Descartado.
- **De `n8n_app`**: las definer no le otorgan nada que no tenga ya por grants directos (`INSERT` en `documentos`; `INSERT/UPDATE` en `ejecuciones_automatizacion`; `INSERT/UPDATE` en `remisiones`; `UPDATE` en `series_documentales`), **con una excepción**: `operacion.reservas_folios` solo es escribible por las definer (ningún rol de aplicación tiene `INSERT/UPDATE` directo), y `n8n_app` puede provocar esas escrituras con las reglas de las funciones. Es el comportamiento buscado.
- **Atribución de auditoría**: los triggers definer leen `app.*` de la sesión; un cliente con SQL directo puede fijar cualquier `app.user_id`. Es un límite de confianza de la aplicación, no de privilegios.
- **Cadena `fn_registrar_fallo_ejecucion` → `fn_finalizar_ejecucion_automatizacion`**: ambas definer del mismo owner; la llamada interna usa el `search_path` de la primera (`pg_catalog, ops, operacion`), que resuelve `ops.fn_finalizar…` calificada. Sin riesgo.

## Funciones no definer

Las 3 funciones `SECURITY INVOKER`: `core.fn_actualizar_updated_at` (trigger), `ops.fn_validar_dueno_unico_serie_proceso` (trigger) y `operacion.reservar_folios` (**allocator legado de Audi**: depende de que `n8n_app` tenga `UPDATE` directo sobre `operacion.series_documentales`; ver [audi-legacy-allocator](audi-legacy-allocator.md)).
