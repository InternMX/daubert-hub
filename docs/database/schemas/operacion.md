# Schema `operacion`

> Fuente: `pg_namespace`, `pg_class`, `pg_proc`, `pg_constraint` (PROD y TEST). Propietario del esquema: `postgres`. Índice: [schemas](README.md).

## Propósito

Documentos operativos y folios: series documentales (contadores), reservas de folios, remisiones y sus renglones, historial de ajustes manuales de folio.

## Tablas (5)

- [`operacion.ajustes_series`](../tables/operacion.ajustes_series.md) — Historial de ajustes manuales de `siguiente_folio` hechos desde el Hub: folio anterior/nuevo, motivo, usuario.
- [`operacion.remision_detalle`](../tables/operacion.remision_detalle.md) — Renglones de una remisión (`codigo_interno`, `part_number`, `descripcion`, `cantidad_texto`).
- [`operacion.remisiones`](../tables/operacion.remisiones.md) — Remisión emitida: serie + folio, cliente, ejecución que la generó, fecha, `pdf_path`, estado (`PENDIENTE`/`GENERADA`/`CANCELADA`).
- [`operacion.reservas_folios`](../tables/operacion.reservas_folios.md) — Rango contiguo de folios `[folio_inicial, folio_final]` reservado por una ejecución en una serie.
- [`operacion.series_documentales`](../tables/operacion.series_documentales.md) — Serie documental: contador de folios (`siguiente_folio`), `estatus`, piso `folio_minimo_ajustable`.

## Vistas (0)

Ninguna.

## Funciones (3)

- [`operacion.fn_registrar_remision_generada`](../functions/operacion.fn_registrar_remision_generada.md) — SECURITY DEFINER
- [`operacion.reservar_folios`](../functions/operacion.reservar_folios.md) — INVOKER
- [`operacion.reservar_folios_para_ejecucion`](../functions/operacion.reservar_folios_para_ejecucion.md) — SECURITY DEFINER

## Sequences (5)

Todas son sequences de PostgreSQL ligadas a columnas (identity o serial); no son series documentales. Ver [sequences](../sequences.md).

## Relaciones

Referencias hacia otros esquemas (FK):

- `operacion.remisiones` → `ops.ejecuciones_automatizacion`
- `operacion.remisiones` → `core.empresas`
- `operacion.reservas_folios` → `ops.ejecuciones_automatizacion`

Referenciado por FK desde: `ops.automatizacion_series_proceso`.

Diagramas: [relationships](../relationships.md).

## Consumidores

Hub (lectura de series/reservas/remisiones; ajuste manual de `siguiente_folio`); n8n Caterpillar (funciones `SECURITY DEFINER`); n8n Audi (allocator legado `reservar_folios` + SQL directo).

## Automatizaciones

Audi, Caterpillar.

## Roles y permisos (`USAGE` de esquema)

| Rol | PROD | TEST |
| --- | --- | --- |
| `daubert_hub_app` | USAGE | - |
| `n8n_app` | USAGE | USAGE |
| `n8n_cat_test` | - | USAGE |
| `daubert_hub_test_user` | - | USAGE |
| `daubert_docs_ro` | USAGE | USAGE |

Ningún rol de aplicación tiene `CREATE` en el esquema. No hay privilegios por defecto (`pg_default_acl` vacío): los objetos nuevos **no** heredan grants. Detalle: [roles](../roles.md), [permissions-matrix](../permissions-matrix.md).

## Riesgos

- `n8n_app` tiene `UPDATE` directo sobre `series_documentales` (puede alterar `siguiente_folio` sin pasar por reservas).
- El allocator legado de Audi no deja rastro en `reservas_folios` ni en `ajustes_series` (ver [audi-legacy-allocator](../audi-legacy-allocator.md)).
- Ninguna tabla de `operacion` tiene trigger de auditoría (`audit.cambios` no registra cambios de folio).

## TEST vs PROD

- Objetos (tablas, vistas, funciones, índices, triggers, sequences): **mismos nombres y estructura** en ambas bases. Diferencias: [test-prod-drift](../test-prod-drift.md).
