# TEST vs PROD: drift

Comparación de `daubert_hub_test` (TEST) y `daubert_global` (PROD) hecha por catálogo, con hashes `sha256` de `pg_get_functiondef()`/`pg_get_viewdef()`. **Nada se corrigió.** Fecha: 2026-09-24. Volver a [database](README.md). Drift de workflows n8n: [n8n-test-prod-drift](../automations/n8n-test-prod-drift.md).

## Conclusión

Cuatro dimensiones distintas; **no** debe resumirse como «TEST y PROD son iguales»:

| dimensión | resultado |
| --- | --- |
| **SCHEMA** (schemas, tablas, vistas, columnas, constraints, índices, triggers, sequences) | **Equivalente.** Sin objetos `ONLY_TEST`/`ONLY_PROD`. Únicas diferencias: 2 columnas eliminadas en `core.empresas` de PROD (huecos de `attnum`, sin efecto) y la serialización textual de `chk_resultado_estado` (misma regla). |
| **FUNCTIONAL STRUCTURE** (13 funciones: firma, `SECURITY DEFINER`, owner, `search_path`, lógica) | **Equivalente.** Sin `FUNCTIONAL_DRIFT`. |
| **FUNCTION TEXT** (hash de `pg_get_functiondef`) | **6 diferencias no funcionales** (solo comentarios y saltos de línea CRLF/LF); 7 idénticas. |
| **PERMISSIONS** | **Drift real (`PERMISSION_DRIFT`).** TEST usa `daubert_hub_test_user` con privilegios más amplios (incluye `DELETE` sobre `audit.cambios`); PROD usa `daubert_hub_app`, más acotado. Caterpillar en TEST corre con `n8n_cat_test` (solo funciones) y en PROD con `n8n_app`. Excepción inversa: `operacion.remision_detalle` tiene `SELECT` para el Hub en PROD y no en TEST. |

Consecuencia: TEST **no** es representativo de PROD en permisos; una regresión de privilegios en PROD (p. ej. [DB-01](hub-contract.md#brechas-detectadas), `core.direcciones`) no se detecta en TEST.

Detalle de las 6 funciones con texto distinto: ver sección Funciones. - Sin `UNKNOWN` estructurales. Lo que **no** se pudo comparar (sin `SELECT`): datos, valores de sequences, filas de configuración (rutas, series, piso de folio).

## Estructura

| aspecto | resultado | clasificación |
| --- | --- | --- |
| Schemas (7) | mismos 7 y propietarios | sin drift |
| Tablas (31), vistas (10), sequences (26) | mismos nombres, tipos de relación y propietarios | sin drift |
| Columnas (467): nombre, tipo, nullable, default, identity, generated | idénticas | sin drift |
| `attnum` de `core.empresas` | PROD tiene 2 columnas eliminadas (attnum 7 y 11): las columnas posteriores tienen `attnum` +1/+2 respecto de TEST | EXPECTED_ENVIRONMENT_DIFFERENCE (historia de DDL distinta; ningún efecto) |
| Constraints (342) | idénticas; `chk_resultado_estado` se serializa distinto pero es la misma regla | EXPECTED_ENVIRONMENT_DIFFERENCE (cosmético) |
| Índices (89) | idénticos (nombre y definición) | sin drift |
| Triggers (25) | idénticos | sin drift |
| Vistas: definiciones (10) | idénticas (hash igual) | sin drift |
| Funciones: definiciones (13) | 7 IDENTICAL, 6 DIFFERENT (todas **solo comentarios/CRLF**) | sin drift funcional |
| SECURITY DEFINER / owner / `search_path` (13) | idénticos | sin drift |
| Extensiones | solo `plpgsql` 1.0 en ambas | sin drift |
| Roles (clúster) | los mismos 6 roles con los mismos atributos | sin drift |
| Grants (objetos, schemas, funciones, sequences, base) | ver sección Permisos | PERMISSION_DRIFT |
| Objetos ONLY_TEST / ONLY_PROD | ninguno | — |

## Funciones

| función | sha256 PROD | sha256 TEST | md5 cuerpo PROD | md5 cuerpo TEST | estado | clasificación |
| --- | --- | --- | --- | --- | --- | --- |
| `audit.fn_registrar_cambio()` | 095703295f4e | 095703295f4e | d165640eb1dc3c1f11cc85bd7ae1f6e3 | d165640eb1dc3c1f11cc85bd7ae1f6e3 | IDENTICAL | — |
| `audit.fn_registrar_cambio_security_users()` | 0e5918ea3778 | 0e5918ea3778 | 767c3c24e968275c3e11fd2c34fc87c6 | 767c3c24e968275c3e11fd2c34fc87c6 | IDENTICAL | — |
| `core.fn_actualizar_updated_at()` | 3eaee6212619 | 3eaee6212619 | 06bcf30ac3d0a7f279a54cbf228a7bec | 06bcf30ac3d0a7f279a54cbf228a7bec | IDENTICAL | — |
| `core.fn_crear_o_resolver_documento(bigint,text,text,text,text,date,text)` | 7a2460627a65 | d28d5823cd35 | 86b765f1db4fff494424b5aea4309ba8 | 86b765f1db4fff494424b5aea4309ba8 | DIFFERENT | TEST_AHEAD (solo comentarios; sin drift funcional) |
| `operacion.fn_registrar_remision_generada(bigint,text,bigint,date,text,jsonb)` | eea96144b57d | df3b2d987b93 | 0137ef4e66a93fecb79fa2f987ef2c23 | 6efa9ced75530e72a3b79825c86ba3db | DIFFERENT | TEST_AHEAD (solo comentarios; sin drift funcional) |
| `operacion.reservar_folios(text,integer)` | 3cd20f24eda1 | 3cd20f24eda1 | 888b4c2e13bc465862c4b374dc6167d3 | 888b4c2e13bc465862c4b374dc6167d3 | IDENTICAL | — |
| `operacion.reservar_folios_para_ejecucion(bigint,text,integer)` | 4f518964c9c7 | c75f9b16c5bd | d8d857473ba3355db4595582461dc9a1 | 26719b6e9d322575673348111bc1279e | DIFFERENT | TEST_AHEAD (solo comentarios; sin drift funcional) |
| `ops.fn_crear_ejecucion_automatizacion(text,bigint,text,text,bigint)` | 2b9571cc8060 | 68ab4ada7963 | 929939dcc7cd3ef0e09b7b2a868b9616 | 929939dcc7cd3ef0e09b7b2a868b9616 | DIFFERENT | EXPECTED_ENVIRONMENT_DIFFERENCE (solo comentarios/CRLF) |
| `ops.fn_finalizar_ejecucion_automatizacion(bigint,text,text,text)` | 057f92afc919 | bfb78eba68f8 | 6060f6f5838ed0b1de6152d3ccd580cb | faf128cb79f25abbf723014a41165822 | DIFFERENT | TEST_AHEAD (solo comentarios; sin drift funcional) |
| `ops.fn_registrar_fallo_ejecucion(bigint,text,text,text)` | 43e6749427c0 | 43e6749427c0 | a2d6151b712cf07836e49f0cbf4e8948 | a2d6151b712cf07836e49f0cbf4e8948 | IDENTICAL | — |
| `ops.fn_resolver_ejecucion_para_reproceso(bigint)` | 6c477c77163e | 99b3e4c605d7 | 4d4d231cbbd868aa339ab65e4105e002 | 4d4d231cbbd868aa339ab65e4105e002 | DIFFERENT | EXPECTED_ENVIRONMENT_DIFFERENCE (solo comentarios/CRLF) |
| `ops.fn_resolver_ruta_automatizacion(text,text)` | 540563c54740 | 540563c54740 | 3071b4875a01a81e7849dcd60d438e62 | 3071b4875a01a81e7849dcd60d438e62 | IDENTICAL | — |
| `ops.fn_validar_dueno_unico_serie_proceso()` | 5d0960b57f3e | 5d0960b57f3e | dc3e77d5306974df2e669b2ec6deb75e | dc3e77d5306974df2e669b2ec6deb75e | IDENTICAL | — |

Comprobación cruzada con la migración 009: `ops.fn_crear_ejecucion_automatizacion` tiene md5 (sin CR) `929939dcc7cd3ef0e09b7b2a868b9616` en PROD **y** TEST, igual al esperado por el `postcheck` y el `down` de la 009 (**CONFIRMED**: 009 aplicada en PROD; TEST tiene el mismo cuerpo).

Los "DIFFERENT" se verificaron eliminando comentarios `--` y normalizando espacios/CR: el texto resultante es igual. Es una comparación textual, no semántica formal (un cambio dentro de una cadena que contenga `--` podría ocultarse), pero la lectura de los diffs confirma que solo cambian comentarios. Los comentarios de TEST citan la migración `20260918_004` (corrección de ambigüedad `remision_id`) y "Phase 11A.4a".

## Vistas

| vista | sha256 PROD | sha256 TEST | estado |
| --- | --- | --- | --- |
| `core.vw_carga_empresas_inicial` | 44541a79f922 | 44541a79f922 | IDENTICAL |
| `core.vw_catalogo_nombres_empresa` | d2d1db12afae | d2d1db12afae | IDENTICAL |
| `core.vw_catalogo_notificacion_pago_n8n` | fe4e796f69db | fe4e796f69db | IDENTICAL |
| `core.vw_contactos_notificacion_pago` | b3062154b71c | b3062154b71c | IDENTICAL |
| `core.vw_contactos_notificacion_pago_detalle` | 3eff4b803392 | 3eff4b803392 | IDENTICAL |
| `core.vw_contactos_notificacion_pago_n8n` | d4da4c5b22d3 | d4da4c5b22d3 | IDENTICAL |
| `core.vw_empresas_con_fiscal_vigente` | 239f614feb94 | 239f614feb94 | IDENTICAL |
| `core.vw_empresas_hub` | 618267e50d5b | 618267e50d5b | IDENTICAL |
| `core.vw_empresas_pendientes_fiscal` | d89a323d514e | d89a323d514e | IDENTICAL |
| `core.vw_estado_catalogo_empresas` | c1c934a9c46f | c1c934a9c46f | IDENTICAL |

## Permisos

Equivalencia de roles: Hub PROD `daubert_hub_app` ↔ TEST `daubert_hub_test_user`; Caterpillar PROD `n8n_app` ↔ TEST `n8n_cat_test`; Audi/Notificaciones `n8n_app` ↔ `n8n_app` (INFERRED).

### Hub: `daubert_hub_app` (PROD) vs `daubert_hub_test_user` (TEST)

| objeto | PROD hub_app | TEST hub_test_user | diferencia |
| --- | --- | --- | --- |
| `audit.cambios` | R | RIUD | TEST más ancho |
| `core.alias_empresa` | RID | RIUD | TEST más ancho |
| `core.borradores_notificacion_pago` | - | RIUD | TEST más ancho (solo TEST) |
| `core.contactos` | RIU | RIUD | TEST más ancho |
| `core.correos_notificacion_pago` | R | RIUD | TEST más ancho |
| `core.direcciones` | - | RIUD | TEST más ancho (solo TEST) |
| `core.documentos` | R | RIUD | TEST más ancho |
| `core.empresa_roles` | RIU | RIUD | TEST más ancho |
| `core.empresas` | RIU | RIUD | TEST más ancho |
| `core.empresas_fiscales` | RIU | RIUD | TEST más ancho |
| `core.empresas_notificacion_pago` | RIU (desde `20260925_011`; D3 lo midió sin grants) | RIUD | TEST más ancho (`DELETE`) |
| `core.medios_contacto` | RIU | RIUD | TEST más ancho |
| `core.resultados_notificacion_pago` | R | RIUD | TEST más ancho |
| `core.snapshot_carga_empresas_inicial` | - | RIUD | TEST más ancho (solo TEST) |
| `core.stg_contactos_notificacion_pago` | - | RIUD | TEST más ancho (solo TEST) |
| `operacion.ajustes_series` | RI | RID | TEST más ancho |
| `operacion.remision_detalle` | R | - | PROD más ancho |
| `operacion.series_documentales` | RU | RIUD | TEST más ancho |
| `ops.automatizacion_series_proceso` | R | RID | TEST más ancho |
| `ops.automatizaciones` | R | RID | TEST más ancho |
| `core.vw_carga_empresas_inicial` | - | RIUD | TEST más ancho (solo TEST) |
| `core.vw_catalogo_nombres_empresa` | - | RIUD | TEST más ancho (solo TEST) |
| `core.vw_catalogo_notificacion_pago_n8n` | - | RIUD | TEST más ancho (solo TEST) |
| `core.vw_contactos_notificacion_pago` | - | RIUD | TEST más ancho (solo TEST) |
| `core.vw_contactos_notificacion_pago_detalle` | - | RIUD | TEST más ancho (solo TEST) |
| `core.vw_contactos_notificacion_pago_n8n` | - | RIUD | TEST más ancho (solo TEST) |
| `core.vw_empresas_con_fiscal_vigente` | - | RIUD | TEST más ancho (solo TEST) |
| `core.vw_empresas_hub` | - | RIUD | TEST más ancho (solo TEST) |
| `core.vw_empresas_pendientes_fiscal` | - | RIUD | TEST más ancho (solo TEST) |
| `core.vw_estado_catalogo_empresas` | - | RIUD | TEST más ancho (solo TEST) |

Lectura: TEST concede a su usuario `DELETE`/`UPDATE`/`INSERT` (incluida `audit.cambios` y **las vistas**) donde PROD solo concede `SELECT`, y concede acceso a `core.direcciones`, que PROD **no** concede. Consecuencia: pruebas de integración en TEST pueden pasar operaciones que en PROD darían `permission denied` (caso real: `core.direcciones`). Excepción en sentido contrario: `operacion.remision_detalle` tiene `SELECT` para el Hub en PROD y **ninguno** en TEST, así que el detalle de remisiones Caterpillar en el Hub (`caterpillar-executions.repository.ts`) fallaría en TEST (**PERMISSION_DRIFT** con TEST más estrecho). Clasificación: **PERMISSION_DRIFT** (TEST con más privilegios; PROD con brecha en `direcciones`).

### `n8n_app`: PROD vs TEST (tablas/vistas)

Idénticos: 12 objetos con los mismos privilegios en ambas bases (**sin drift** de tabla).

### `EXECUTE` de funciones definer

| rol | PROD | TEST |
| --- | --- | --- |
| `n8n_app` | 9 funciones de negocio (8 definer + `reservar_folios`) | solo `operacion.reservar_folios` |
| `n8n_cat_test` | ninguna | 8 funciones definer (no `reservar_folios`) |
| `daubert_hub_app` / `daubert_hub_test_user` | ninguna | ninguna |

**PERMISSION_DRIFT esperado y consistente con D1/D2**: TEST separa credenciales por automatización; PROD las comparte.

### Caterpillar: privilegios de tabla efectivos

| objeto | PROD `n8n_app` | TEST `n8n_cat_test` |
| --- | --- | --- |
| `core.borradores_notificacion_pago` | RIU | - |
| `core.correos_notificacion_pago` | RIU | - |
| `core.documentos` | RI | - |
| `core.empresas` | R | - |
| `core.resultados_notificacion_pago` | RIU | - |
| `operacion.remision_detalle` | RI | - |
| `operacion.remisiones` | RIU | - |
| `operacion.series_documentales` | RU | - |
| `ops.automatizaciones` | R | - |
| `ops.ejecuciones_automatizacion` | RIU | - |
| `core.vw_catalogo_notificacion_pago_n8n` | R | - |
| `core.vw_contactos_notificacion_pago_n8n` | R | - |

TEST prueba Caterpillar con **0** privilegios de tabla; PROD lo ejecuta con `n8n_app` (12 objetos). Eso hace a TEST **más estricto** que PROD (el riesgo no es que TEST oculte una falla de permisos de tabla para Caterpillar, sino que PROD sea más ancho de lo que se prueba).

### Otros

- ACL de base: PROD `daubert_docs_ro=c`; TEST además `daubert_hub_test_user=c` (ambas con `PUBLIC=Tc`).
- Schemas: en PROD `daubert_hub_app` tiene `USAGE` en `audit/core/operacion/ops/security`; en TEST lo tiene `daubert_hub_test_user` (y `n8n_cat_test` en `core/operacion/ops`).
- `staging`: sin grants de aplicación en ninguna base.

## Representatividad de TEST

| riesgo | descripción | severidad |
| --- | --- | --- |
| Roles distintos para el Hub | `daubert_hub_test_user` con DML amplio (incluye vistas y `audit.cambios`); una regresión de privilegios en PROD (p. ej. `core.direcciones`) no la detectan las pruebas de TEST | Alta |
| Caterpillar: rol distinto | TEST valida con `n8n_cat_test` (solo funciones); PROD usa `n8n_app` | Media |
| Auditoría manipulable en TEST | `DELETE/UPDATE/INSERT` sobre `audit.cambios` para el usuario del Hub | Baja (TEST) |
| Historia de DDL distinta | 2 columnas eliminadas en `core.empresas` de PROD | Baja |
| Datos | No comparables con `daubert_docs_ro` (sin `SELECT`); series/rutas/piso de folio pueden diferir | Desconocida (UNKNOWN) |

## Objetos ONLY_TEST / ONLY_PROD

Ninguno: schemas, tablas, vistas, funciones, triggers, índices, sequences y extensiones coinciden por nombre.
