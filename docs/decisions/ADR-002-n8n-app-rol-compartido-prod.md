# ADR-002 `n8n_app` como rol n8n de PROD compartido

- **Status:** Aceptado (implementado), con riesgo conocido. Registrado retroactivamente el 2026-09-24.

## Context

Remisiones Audi ya operaba en PROD con el rol `n8n_app` (migración `20260827_004`, que le concedió permisos directos sobre tablas y secuencias). Al integrar Caterpillar:

- La migración `20260911_002_caterpillar_n8n_permissions_prod` declara que concede `EXECUTE` al **rol compartido existente** `n8n_app` "matching this project's existing production credential strategy" y que "no dedicated … production role was requested".
- La nota de despliegue 12C confirma: "PROD n8n role: `n8n_app` (shared with Remisiones Audi). No dedicated Caterpillar role was created."
- En TEST, en cambio, Caterpillar usa un rol dedicado `n8n_cat_test`, sin ningún grant directo sobre tablas (verificado por el runner `caterpillar-model`).
- El paquete de despliegue Caterpillar declara que **no** reduce los privilegios previos de `n8n_app`.

## Decision

En PROD, n8n (Audi y Caterpillar) usa un único rol de aplicación, `n8n_app`. Las funciones nuevas conceden `EXECUTE` a ese rol (incluida `ops.fn_resolver_ejecucion_para_reproceso` en la 009). No se crea un rol dedicado para Caterpillar. `n8n_app` **nunca** se usa para DDL y n8n **nunca** se conecta como `postgres`.

## Consequences

- Menos credenciales que administrar en PROD; un solo rol en n8n.
- **Riesgo:** blast radius compartido. `n8n_app` conserva grants directos heredados de Audi (p. ej. `UPDATE` sobre `operacion.series_documentales`), más amplios que los de `n8n_cat_test` en TEST. Un error en un workflow de una automatización puede afectar datos de la otra.
- La postura de mínimo privilegio de TEST **no es idéntica** a la de PROD; no asumir que una prueba en TEST cubre el alcance de privilegios de PROD.
- Rotar la credencial de `n8n_app` afecta a ambas automatizaciones a la vez.
- Endurecimiento futuro posible (no decidido): retirar grants directos y dejar sólo funciones, o separar roles por automatización.

## Alternatives Considered

La evidencia muestra una alternativa **implementada en TEST**: un rol dedicado por automatización (`n8n_cat_test`) sin grants directos. No se adoptó en PROD (según la propia migración, porque no se solicitó un rol dedicado para PROD). No hay más alternativas documentadas.
