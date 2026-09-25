# Series documentales y folios

Fuentes: `apps/api/src/automations/document-series.repository.ts`, `automations.service.ts`, `adjust-document-series.dto.ts`, migraciones `20260911_001`, `20260922_002/003/004`, `operacion.reservar_folios_para_ejecucion`, `fn_finalizar_ejecucion_automatizacion`, `fn_registrar_remision_generada`.

## Conceptos

| Concepto | Dónde | Significado |
| --- | --- | --- |
| Serie | `operacion.series_documentales` | Contador de folios de un tipo de remisión. Campos: `codigo`, `nombre`, `siguiente_folio`, `estatus` (`ACTIVA`/`INACTIVA`), `folio_minimo_ajustable`. |
| `siguiente_folio` | serie | Próximo folio **libre**. Sólo avanza al reservar; sólo baja por un ajuste manual seguro. |
| `folio_minimo_ajustable` | serie (nullable, `> 0`) | **Piso histórico/de corte**: nadie puede mover el siguiente folio por debajo de él. `NULL` = sin configurar → los ajustes hacia atrás **fallan cerrado**. Nunca se infiere de `MIN(folio)` de remisiones/reservas (la ausencia de filas en PostgreSQL no prueba que un folio anterior no se usó). Audi se sembró con 969 (primer folio bajo control de PostgreSQL). |
| Reserva | `operacion.reservas_folios` | Rango contiguo `[folio_inicial, folio_final]` (`cantidad` = `final − inicial + 1`) que una ejecución toma de una serie. |
| Aplicación | estado `APLICADA` | La reserva se confirma al **completar** la ejecución. |
| Abandono | estado `ABANDONADA` | La reserva se libera del control (los folios **no** se reciclan) al terminar en `ERROR`/`CANCELADA`. |
| Ruta | `ops.automatizacion_series_proceso` | Vincula `llave_proceso` con una serie y un cliente; define qué series puede usar cada automatización. |

## Series conocidas

`REMISION_AUDI` y ocho series Caterpillar: `REMISION_CAT_P2`, `_P3`, `_P4`, `_P5`, `_P6`, `_NL_FINSA_1`, `_NL_FINSA_3`, `_TORREON`. Torreón y Torreón Planta 2 son **dos rutas que comparten una sola serie** (`REMISION_CAT_TORREON`) y por tanto un solo piso. Estado actual de habilitación de Caterpillar en PROD: [caterpillar/production-runbook](../automations/caterpillar/production-runbook.md#procesos-habilitados-hoy).

## Ciclo de vida: reserva → ejecución → remisión

```text
ejecución (PROCESANDO)
   └─ reservar_folios_para_ejecucion(ejecución, serie, cantidad)
        ├─ valida: ejecución PROCESANDO; serie existe; serie es ruta ACTIVA de la automatización; serie ACTIVA
        ├─ bloquea (advisory lock por ejecución+serie, y fila de la serie FOR UPDATE)
        ├─ si ya existe reserva para (ejecución, serie): devuelve la misma (misma cantidad) o falla 23505 (cantidad distinta)
        └─ inserta reserva RESERVADA y avanza siguiente_folio = folio_final + 1   (atómico)
   └─ fn_registrar_remision_generada(ejecución, serie, folio, fecha, pdf_path, detalles)
        ├─ el folio debe caer dentro de una reserva de esa ejecución/serie
        ├─ idempotente (ya_existia)
        └─ inserta remisión (GENERADA) + renglones
   └─ fn_finalizar_ejecucion_automatizacion(ejecución, 'COMPLETADA')
        ├─ integridad: cada reserva RESERVADA debe tener exactamente `cantidad` remisiones GENERADA en su rango
        └─ reservas → APLICADA
   (ERROR / CANCELADA → reservas → ABANDONADA)
```

`remisiones.ejecucion_id` y `reservas_folios.ejecucion_id` enlazan cada folio con su ejecución. Un **reproceso** es una ejecución nueva: **reserva folios nuevos**; nunca reutiliza los de la ejecución original ([reprocessing](../automations/caterpillar/reprocessing.md)).

Errores de las funciones (códigos SQLSTATE usados): `22023` argumento inválido, `P0002` no existe, `55000` estado/ámbito no permitido (ejecución no `PROCESANDO`, serie inactiva o ajena), `23505` conflicto (cantidad distinta para la misma reserva).

## Ajuste seguro de `siguiente_folio` desde el Hub

`PATCH /api/automations/:automationCode/document-series/:seriesCode` — **sólo `ADMIN`**. Compartido por Audi y Caterpillar. Cuerpo: `expectedCurrentFolio`, `nextFolio`, `reason` y, si es hacia atrás, `backwardFilesystemAcknowledged`.

Dentro de **una transacción con bloqueo de fila**:

1. Ownership: la serie debe pertenecer a la automatización vía `ops.automatizacion_series_proceso`. Una combinación incorrecta se reporta como "no encontrada" (no revela series de otras automatizaciones).
2. Concurrencia optimista: `expectedCurrentFolio` debe coincidir con el valor bajo bloqueo (`SERIES_FOLIO_STALE` si n8n reservó entretanto).
3. `nextFolio` ≠ actual (`DOCUMENT_SERIES_FOLIO_UNCHANGED`).
4. Si hay piso configurado, `nextFolio ≥ folio_minimo_ajustable` (`SERIES_FOLIO_BELOW_FLOOR`).
5. **Hacia atrás** además exige: confirmación de revisión de archivos de salida (`BACKWARD_ACKNOWLEDGEMENT_REQUIRED`), piso configurado (`SERIES_FOLIO_FLOOR_UNCONFIGURED`), ninguna remisión no cancelada en el rango que se reutilizaría (`SERIES_FOLIO_REMISSION_CONFLICT`) y **ninguna reserva de cualquier estado** (incluida `ABANDONADA`) que se solape (`SERIES_FOLIO_RESERVATION_CONFLICT`).
6. Se actualiza `siguiente_folio` e inserta `operacion.ajustes_series` (folio anterior/nuevo, motivo, usuario) en la misma transacción.

Nunca hace `UPDATE`/`DELETE` sobre remisiones ni reservas, y nunca toca el filesystem.

### Por qué no editar `siguiente_folio` directamente en la BD

- Se salta la **concurrencia optimista** y el **bloqueo de fila**: n8n puede reservar en el mismo instante y producir folios duplicados.
- Se salta el **piso histórico** y la verificación de **solapes** con remisiones/reservas (incluidas las abandonadas, que no deben reciclarse silenciosamente).
- No deja **rastro de auditoría** (`ajustes_series` con usuario y motivo).
- Los folios existen también como **archivos PDF** fuera de la BD: reutilizar un folio puede sobrescribir/duplicar documentos ya emitidos. Por eso el ajuste hacia atrás exige confirmar revisión del filesystem.
- Un cambio manual en SQL con el rol `postgres` no pasa por ninguna de estas defensas. Si es absolutamente necesario, hágase como cambio controlado, con backup, sin n8n procesando esa serie, y regístrelo en `docs/deployments/`.

## Cómo consultar el estado (solo lectura)

- Hub: pantalla de la automatización (Series) o `GET /api/automations/:automationCode/document-series/:seriesCode` (incluye historial de ajustes).
- SQL de referencia: precheck sección 7 de la 009 (`SELECT … FROM operacion.series_documentales WHERE codigo ILIKE '%CAT%'`).
