# Roles y permisos

Fuentes: migraciones `20260827_004`, `20260911_002/003`, `20260922_001`, 009 (postcheck), paquete Caterpillar (`README_DEPLOY.md`), scripts `bootstrap-admin-prod.ts`, runner `caterpillar-model.integration.runner.cjs`. **No se documentan contraseñas ni cadenas de conexión.** La lista exhaustiva de grants no está en el repo: para el estado real consulta `information_schema`/`has_*_privilege` (los prechecks/postchecks ya lo hacen).

## Roles

| Rol | Entorno | Uso | Nunca debe usarse para |
| --- | --- | --- | --- |
| `postgres` | PROD y TEST | Superusuario: DDL de migraciones y administración manual | Conexión de la API o de n8n |
| `daubert_hub_app` | PROD | Runtime de la API del Hub | DDL |
| `n8n_app` | PROD | Runtime de n8n; **compartido** entre Remisiones Audi y Caterpillar ([ADR-002](../decisions/ADR-002-n8n-app-rol-compartido-prod.md)) | DDL |
| `daubert_hub_test_user` | TEST | Runtime de la API en TEST; también fixtures de las pruebas de integración | — |
| `n8n_cat_test` | TEST | Runtime de n8n para Caterpillar en TEST (sólo funciones, sin grants directos) | Usarse contra `daubert_global` (los roles son globales al clúster; el paquete PROD verifica que no tenga privilegios relevantes allí) |

## Principio de mínimo privilegio

- La **API** sólo escribe lo que su función administrativa necesita y **no puede ejecutar** el allocator de folios ni las funciones de n8n.
- **n8n** opera el modelo de Caterpillar exclusivamente vía funciones `SECURITY DEFINER`.
- Las funciones nuevas siguen el patrón `REVOKE … FROM PUBLIC` + `GRANT EXECUTE` al rol exacto.

## `daubert_hub_app` (Hub, PROD)

Verificado en migraciones/código:

| Objeto | Privilegio | Origen |
| --- | --- | --- |
| `ops.automatizacion_series_proceso`, `operacion.reservas_folios`, `operacion.remision_detalle`, `core.documentos` | `SELECT` | `20260922_001` |
| `ops.automation_trigger_requests` (+ secuencia) | `INSERT` / `USAGE` (sin `SELECT/UPDATE/DELETE`) | `20260911_003` |
| `ops.fn_resolver_ejecucion_para_reproceso(bigint)` | **Sin** `EXECUTE` (el postcheck 009 lo exige) | 009 |
| `operacion.series_documentales` (`UPDATE`) y `operacion.ajustes_series` (`INSERT`) | Requeridos por el ajuste de folio (`document-series.repository.ts`); grants en migraciones de permisos del Hub (`20260827_005`, `20260828_001`) | Lista exacta: PENDIENTE |
| `core.direcciones` | `INSERT/UPDATE` + secuencia | `20260902_002` |
| Esquema `security` y `ops.automation_review_acknowledgements` | Los necesarios para sesiones/usuarios/acuses | `20260904_002`, `20260910_001` |

Nota de implementación: el bloqueo de fila del ajuste usa `FOR UPDATE OF series` porque `daubert_hub_app` sólo tiene `SELECT` sobre las tablas unidas; un `FOR UPDATE` sin alcance intentaría bloquearlas y sería denegado.

## `n8n_app` (n8n, PROD)

| Objeto | Privilegio |
| --- | --- |
| `ops.fn_resolver_ruta_automatizacion`, `core.fn_crear_o_resolver_documento`, `ops.fn_crear_ejecucion_automatizacion`, `operacion.reservar_folios_para_ejecucion` | `EXECUTE` (`20260911_002`) |
| `ops.fn_finalizar_ejecucion_automatizacion`, `operacion.fn_registrar_remision_generada`, `ops.fn_registrar_fallo_ejecucion` | `EXECUTE` (paquete Caterpillar 006/008/013) |
| `ops.fn_resolver_ejecucion_para_reproceso` | `EXECUTE` (009) |
| Tablas (heredado de Remisiones Audi, `20260827_004`) | `SELECT, INSERT` en `core.documentos`; `SELECT` en `ops.automatizaciones`; `SELECT, INSERT, UPDATE` en `ops.ejecuciones_automatizacion`; `SELECT, UPDATE` en `operacion.series_documentales`; `SELECT, INSERT, UPDATE` en `operacion.remisiones`; `SELECT, INSERT` en `operacion.remision_detalle` (+ secuencias) |

> **Verificado en D2:** el workflow de Audi usa efectivamente SQL directo (INSERT/UPDATE sobre `core.documentos`, `ops.ejecuciones_automatizacion`, `operacion.remisiones`, `operacion.remision_detalle` y `SELECT` sobre series/automatizaciones/empresas) más `operacion.reservar_folios`; el workflow de Notificaciones de pago usa SQL directo sobre `core.correos_notificacion_pago`, `core.borradores_notificacion_pago`, `core.resultados_notificacion_pago` y la vista `core.vw_catalogo_notificacion_pago_n8n`; Caterpillar usa sólo funciones. Ver los `database-contract.md` de cada automatización. Qué rol respalda cada credencial n8n (`Postgres produccion`, `Postgres pruebas`, `cat_test`) no es demostrable desde los JSON: tarea de D3.

⚠️ **Riesgo conocido:** por ser un rol compartido y heredar los grants directos de Audi, `n8n_app` tiene `UPDATE` directo sobre `operacion.series_documentales` (puede alterar `siguiente_folio` fuera de las funciones). En TEST, `n8n_cat_test` **no** tiene ningún grant directo. El paquete de despliegue declara que **no** se redujeron los privilegios previos de `n8n_app`. Endurecer esto es candidato a Fase D2/seguridad (ver [ADR-002](../decisions/ADR-002-n8n-app-rol-compartido-prod.md)).

## `n8n_cat_test` (TEST)

Verificado por el runner `caterpillar-model`: puede `EXECUTE` exactamente las funciones aprobadas; **no** puede `EXECUTE` `operacion.reservar_folios(text,integer)` (allocator legacy de Audi), ni `UPDATE`/`SELECT` directo en series, ni `DELETE`, ni escribir acuses, ni leer `core.empresas` o `security.users`.

## Funciones `SECURITY DEFINER`: qué garantizan

- `search_path` fijo (`pg_catalog, ops[, operacion, core]`): evita secuestro por `search_path`.
- El propietario ejecuta con sus privilegios; el llamador sólo necesita `EXECUTE`.
- Validan argumentos y **ownership** dentro de la función (p. ej. la serie debe ser ruta activa de la automatización de la ejecución).
- Ejemplo de superficie mínima: `ops.fn_resolver_ejecucion_para_reproceso` recibe sólo un ID; una ejecución de otra automatización es **indistinguible** de una inexistente.

## Verificación rápida (solo lectura)

Los scripts `…precheck.sql` / `…postcheck.sql` de la 009 muestran el patrón para comprobar `has_function_privilege('n8n_app', …)`, `NOT has_function_privilege('public', …)` y `NOT has_function_privilege('daubert_hub_app', …)`. Reutilízalos como plantilla para futuras migraciones.
