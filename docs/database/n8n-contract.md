# Contrato n8n ↔ PostgreSQL

Objetos que cada workflow **realmente usa**, extraídos de los exports versionados en D2 (`n8n/workflows/**`, nodos `postgres` y nodos `code` que arman SQL), y contrastados con los privilegios del rol correspondiente. No se asume uso porque un objeto exista. Volver a [database](README.md). Detalle por automatización: [Audi](../automations/audi/database-contract.md), [Caterpillar](../automations/caterpillar/database-contract.md), [Notificaciones de pago](../automations/payment-notifications/database-contract.md).

> Rol efectivo por credencial (INFERRED, D1/D2): `Postgres produccion` → `n8n_app`; `Postgres pruebas` → `n8n_app`; `cat_test` → `n8n_cat_test`. El JSON del workflow solo guarda el nombre de la credencial. La cadena SQL de los exports **no** contiene la base; TEST/PROD se deducen del nombre de la credencial.

## Audi PROD (rol `n8n_app`, base daubert_global)

| objeto | tipo | operaciones (R/I/U/D/X) | nodos | privilegio del rol | contraste |
| --- | --- | --- | --- | --- | --- |
| `core.documentos` | tabla | RI | `Preparar documento origen PG`, `Preparar validación candidato PG` | n8n_app: RI | OK |
| `core.empresas` | tabla | R | `Leer cliente Audi PG` | n8n_app: R | OK |
| `operacion.remision_detalle` | tabla | RI | `Preparar remisiones generadas PG` | n8n_app: RI | OK |
| `operacion.remisiones` | tabla | RI | `Preparar remisiones generadas PG` | n8n_app: RIU | OK |
| `operacion.reservar_folios` | función | X | `Reservar folios PostgreSQL` | n8n_app: X | OK |
| `operacion.series_documentales` | tabla | R | `Leer automatización Audi` | n8n_app: RU | OK |
| `ops.automatizaciones` | tabla | R | `Leer automatización Audi`, `Preparar validación candidato PG` | n8n_app: R | OK |
| `ops.ejecuciones_automatizacion` | tabla | RIU | `Cerrar ejecución COMPLETADA PG`, `Crear ejecución PG`, `Preparar validación candidato PG`, `Validar idempotencia PG` | n8n_app: RIU | OK |

Brechas: **0**. `X` = llamada a función. Las lecturas hechas dentro de funciones `SECURITY DEFINER` no aparecen (corren con los privilegios del propietario).

## Audi TEST (rol `n8n_app`, base daubert_hub_test)

| objeto | tipo | operaciones (R/I/U/D/X) | nodos | privilegio del rol | contraste |
| --- | --- | --- | --- | --- | --- |
| `core.documentos` | tabla | RI | `Preparar documento origen PG` | n8n_app: RI | OK |
| `core.empresas` | tabla | R | `Leer cliente Audi PG` | n8n_app: R | OK |
| `operacion.remision_detalle` | tabla | RI | `Preparar remisiones generadas PG` | n8n_app: RI | OK |
| `operacion.remisiones` | tabla | RI | `Preparar remisiones generadas PG` | n8n_app: RIU | OK |
| `operacion.reservar_folios` | función | X | `Reservar folios PostgreSQL` | n8n_app: X | OK |
| `operacion.series_documentales` | tabla | R | `Leer automatización Audi` | n8n_app: RU | OK |
| `ops.automatizaciones` | tabla | R | `Leer automatización Audi` | n8n_app: R | OK |
| `ops.ejecuciones_automatizacion` | tabla | RIU | `Cerrar ejecución COMPLETADA PG`, `Crear ejecución PG`, `Validar idempotencia PG` | n8n_app: RIU | OK |

Brechas: **0**. `X` = llamada a función. Las lecturas hechas dentro de funciones `SECURITY DEFINER` no aparecen (corren con los privilegios del propietario).

## Caterpillar PROD (rol `n8n_app`, base daubert_global)

| objeto | tipo | operaciones (R/I/U/D/X) | nodos | privilegio del rol | contraste |
| --- | --- | --- | --- | --- | --- |
| `core.fn_crear_o_resolver_documento` | función | X | `Resolver documento origen PG` | n8n_app: X | OK |
| `operacion.fn_registrar_remision_generada` | función | X | `Registrar remisión PG` | n8n_app: X | OK |
| `operacion.reservar_folios_para_ejecucion` | función | X | `Reservar folios PG` | n8n_app: X | OK |
| `ops.fn_crear_ejecucion_automatizacion` | función | X | `Crear o recuperar ejecución PG`, `Mapear resultado creación reproceso CAT` | n8n_app: X | OK |
| `ops.fn_finalizar_ejecucion_automatizacion` | función | X | `Finalizar ejecución PG` | n8n_app: X | OK |
| `ops.fn_registrar_fallo_ejecucion` | función | X | `Registrar fallo PG` | n8n_app: X | OK |
| `ops.fn_resolver_ejecucion_para_reproceso` | función | X | `Resolver ejecución original PG` | n8n_app: X | OK |

Brechas: **0**. `X` = llamada a función. Las lecturas hechas dentro de funciones `SECURITY DEFINER` no aparecen (corren con los privilegios del propietario).

## Caterpillar TEST (rol `n8n_cat_test`, base daubert_hub_test)

| objeto | tipo | operaciones (R/I/U/D/X) | nodos | privilegio del rol | contraste |
| --- | --- | --- | --- | --- | --- |
| `core.fn_crear_o_resolver_documento` | función | X | `Resolver documento origen PG` | n8n_cat_test: X | OK |
| `operacion.fn_registrar_remision_generada` | función | X | `Registrar remisión PG` | n8n_cat_test: X | OK |
| `operacion.reservar_folios_para_ejecucion` | función | X | `Reservar folios PG` | n8n_cat_test: X | OK |
| `ops.fn_crear_ejecucion_automatizacion` | función | X | `Crear o recuperar ejecución PG`, `Mapear resultado creación reproceso CAT` | n8n_cat_test: X | OK |
| `ops.fn_finalizar_ejecucion_automatizacion` | función | X | `Execute a SQL query`, `Finalizar ejecución PG` | n8n_cat_test: X | OK |
| `ops.fn_registrar_fallo_ejecucion` | función | X | `Registrar fallo PG` | n8n_cat_test: X | OK |
| `ops.fn_resolver_ejecucion_para_reproceso` | función | X | `Resolver ejecución original PG`, `Sticky Note Reprocess` | n8n_cat_test: X | OK |

Brechas: **0**. `X` = llamada a función. Las lecturas hechas dentro de funciones `SECURITY DEFINER` no aparecen (corren con los privilegios del propietario).

## Notificaciones de pago

Los exports PROD/TEST de este workflow están **clasificados DO_NOT_VERSION** (contienen datos de personas): no hay JSON en el repo para extraer, así que la tabla siguiente sale de la lectura hecha en D2 ([database-contract](../automations/payment-notifications/database-contract.md)) y es **INFERRED**, contrastada con los grants reales de `n8n_app`:

| objeto | uso según D2 | privilegio real `n8n_app` PROD | TEST `n8n_app` | contraste |
| --- | --- | --- | --- | --- |
| `core.correos_notificacion_pago` | INSERT, UPDATE, SELECT | RIU | RIU | OK |
| `core.borradores_notificacion_pago` | INSERT, UPDATE, SELECT | RIU | RIU | OK |
| `core.resultados_notificacion_pago` | INSERT … ON CONFLICT DO UPDATE, SELECT | RIU | RIU | OK |
| `core.empresas` | SELECT (nombre comercial en el resumen) | R | R | OK |
| `core.vw_catalogo_notificacion_pago_n8n` | SELECT (catálogo) | R | R | OK |

- Sin funciones y sin `operacion.*`/`ops.*`: coherente con que `n8n_app` tenga esos grants por **otras** automatizaciones.
- `core.vw_contactos_notificacion_pago_n8n` (grant real `R`) es dependencia de la vista de catálogo; no consta que el workflow la consulte directamente.
- El uso de `UPDATE` sobre `correos/borradores/resultados` es de tabla completa; no hay `DELETE` (correcto).

## Objetos con grant a `n8n_app` sin uso demostrable

| objeto | grant | comentario |
| --- | --- | --- |
| `operacion.remisiones` | U | Ningún workflow exportado hace `UPDATE`. |
| `core.vw_contactos_notificacion_pago_n8n` | R | Solo indirecto (dependencia de la vista de catálogo); acceso directo no demostrado. |
| `ops.fn_resolver_ruta_automatizacion` | X | Ningún workflow la llama. |

## Funciones y consumidores

| función | Audi | Caterpillar PROD/TEST | Hub |
| --- | --- | --- | --- |
| `core.fn_crear_o_resolver_documento` | no | sí | no |
| `operacion.fn_registrar_remision_generada` | no | sí | no |
| `operacion.reservar_folios` | sí | no | no |
| `operacion.reservar_folios_para_ejecucion` | no | sí | no |
| `ops.fn_crear_ejecucion_automatizacion` | no | sí | no |
| `ops.fn_finalizar_ejecucion_automatizacion` | no | sí | no |
| `ops.fn_registrar_fallo_ejecucion` | no | sí | no |
| `ops.fn_resolver_ejecucion_para_reproceso` | no | sí | no |
| `ops.fn_resolver_ruta_automatizacion` | no | no | no |

Histórico: `n8n/workflows/remisiones-caterpillar/historical/pg-pre-reprocess-candidate.json` usa las mismas 6 funciones sin la rama de reproceso; **inactivo**, no se considera consumidor vigente.
