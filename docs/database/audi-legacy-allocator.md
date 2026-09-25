# Allocator legado de Audi: `operacion.reservar_folios`

D2 detectó que el workflow de Remisiones Audi (PROD y TEST) usa `operacion.reservar_folios(text, integer)`. Aquí se inspecciona su **definición real** en PostgreSQL (`pg_get_functiondef`, sin ejecutarla) y se compara con `operacion.reservar_folios_para_ejecucion`, el allocator del modelo Caterpillar. **No se propone ni se ejecuta ninguna migración.** Volver a [database](README.md). Ver también [folios](folios.md).

## Comparación

| Aspecto | `reservar_folios` (legado, Audi) | `reservar_folios_para_ejecucion` (Caterpillar) |
| --- | --- | --- |
| Ficha | [functions/operacion.reservar_folios](functions/operacion.reservar_folios.md) | [functions/operacion.reservar_folios_para_ejecucion](functions/operacion.reservar_folios_para_ejecucion.md) |
| Firma | `(p_serie_codigo text, p_cantidad integer)` → `TABLE(folio_inicial, folio_final, cantidad)` | `(p_ejecucion_id bigint, p_serie_codigo text, p_cantidad integer)` → `TABLE(reserva_id, folio_inicial, folio_final, cantidad)` |
| Seguridad | `SECURITY INVOKER`, **sin** `search_path` fijo | `SECURITY DEFINER`, `search_path = pg_catalog, operacion, ops` |
| `EXECUTE` | `postgres` + `n8n_app` (PROD y TEST); `PUBLIC` revocado | `postgres` + `n8n_app` (PROD) / `n8n_cat_test` (TEST); `PUBLIC` revocado |
| Privilegios de tabla que necesita el llamador | `SELECT, UPDATE` en `operacion.series_documentales` y `SELECT` en `operacion.remisiones` (por ser INVOKER) | Ninguno (corre como propietario) |
| Valida ejecución | **No** (ni siquiera recibe `ejecucion_id`) | Sí: debe existir y estar `PROCESANDO` |
| Valida ruta/ownership de la serie | **No**: acepta cualquier serie `ACTIVA` por código | Sí: la serie debe ser ruta `ACTIVA` de la automatización de la ejecución |
| Bloqueo | `SELECT … FOR UPDATE` de la serie | Advisory lock (ejecución:serie) + `FOR UPDATE` de la serie |
| Tablas modificadas | Solo `operacion.series_documentales` (`siguiente_folio`) | `operacion.reservas_folios` (INSERT) y `series_documentales` (`siguiente_folio`) |
| Deja rastro de la reserva | **No** | Sí (`reservas_folios`, ligada a la ejecución) |
| Idempotencia | **No**: cada llamada consume folios nuevos | Sí, por (ejecución, serie); cantidad distinta → `23505` |
| Comprobación de choque | Rechaza (`23505`) si el rango pedido coincide con una remisión **no cancelada** | No revisa `remisiones`; confía en la monotonía del contador |
| Códigos de error | `22023`, `P0002`, `55000`, `23505` | `22023`, `P0002`, `55000`, `23505` |
| Ciclo de vida posterior | Ninguno: nadie "aplica" o "abandona" el rango; los folios simplemente quedaron consumidos | `APLICADA` al completar / `ABANDONADA` al fallar |
| Consumidor | n8n Audi: nodo `Reservar folios PostgreSQL` (PROD y TEST): `SELECT * FROM operacion.reservar_folios('REMISION_AUDI', <cantidad>)` | n8n Caterpillar: nodo `Reservar folios PG` |
| Hub | Sin `EXECUTE` | Sin `EXECUTE` |
| TEST vs PROD | Definición idéntica (mismo hash) | Solo difiere en comentarios |

## Garantías del legado (verificadas en el código)

- Serialización por serie (`FOR UPDATE`): dos llamadas simultáneas no reciben el mismo rango.
- Serie inexistente (`P0002`) o `INACTIVA` (`55000`) se rechaza; cantidad ≤ 0 o serie vacía (`22023`).
- No entrega un rango que solape una remisión activa.
- Atomicidad: si el llamador hace `ROLLBACK` de su transacción, el avance de `siguiente_folio` también se revierte. **Pero** el workflow de Audi lo ejecuta en un nodo `postgres` **independiente** de los siguientes (INFERRED: el nodo n8n `postgres` confirma su propia sentencia; el export no muestra una transacción que abarque varios nodos): fallos posteriores no revierten los folios ya consumidos.

## Deuda técnica

1. **Sin rastro ni ownership**: no hay reserva ni relación folio → ejecución. La integridad folio↔ejecución depende del workflow.
2. **Folios perdidos**: si el proceso falla después de reservar, el rango queda consumido; solo se advierte por saltos de numeración.
3. **Acoplamiento a privilegios de tabla**: por ser `INVOKER`, obliga a que `n8n_app` conserve `UPDATE` directo sobre `operacion.series_documentales` (ver [n8n-app-audit](n8n-app-audit.md)), lo que a su vez permite a ese rol alterar `siguiente_folio`, `estatus` y `codigo` fuera de cualquier función.
4. **Sin control de ruta**: cualquier llamador con `EXECUTE` puede consumir folios de **cualquier** serie activa (incluidas series de Caterpillar), porque la función no consulta `ops.automatizacion_series_proceso`.
5. **Sin `search_path` fijo** (es `INVOKER`, sin `SET search_path`): las referencias están calificadas (`operacion.*`), riesgo bajo, pero es inconsistente con el resto.
6. **Coexistencia de dos modelos** sobre las mismas tablas (`series_documentales`, `remisiones`) con garantías distintas: el ajuste manual del Hub y su detección de conflictos (`remisiones` + `reservas`) no ve los folios consumidos por Audi sin remisión.
7. **Audi ya tiene ruta en el modelo nuevo** (según D2, la migración `20260922_004` sembró su fila en `ops.automatizacion_series_proceso`; los datos no se pudieron leer aquí; el Hub usa esa tabla para el ajuste de folio), pero el workflow no la consulta.

## No confirmado

- Cuántos folios de `REMISION_AUDI` se han consumido sin remisión (requiere leer datos).
- Si existe algún proceso externo que compense huecos.
