# n8n — Diferencias TEST vs PROD y drift

Comparación **nodo por nodo y conexión por conexión** de los exports reales (Fase D2, 2026-09-24). No se corrigió nada.

Clasificación usada:

| Etiqueta | Significado | Equivalente en la clasificación por automatización |
| --- | --- | --- |
| `EXPECTED_ENVIRONMENT_DIFFERENCE` | Diferencia esperada por entorno (rutas, credenciales, base, flags, webhooks, ámbito) | ESPERADA POR ENTORNO |
| `FUNCTIONAL_DRIFT` | Lógica que existe en un entorno y no en el otro, o comportamiento distinto sin justificación de entorno | DRIFT |
| `LEGACY_CONFIGURATION` | Configuración/nodos heredados sin uso | DEUDA |
| `UNKNOWN_REQUIRES_REVIEW` | No se puede juzgar desde el export | REQUIERE REVISIÓN |

Contexto: **TEST y PROD viven en la misma instancia n8n** (el `instanceId` es idéntico en los 12 exports) y comparten algunos IDs (manejador de errores, subworkflows de Audi). Ver [n8n-dependencies](n8n-dependencies.md).

## Resumen

| Automatización | Nodos TEST / PROD | Nodos con parámetros distintos | Conclusión |
| --- | --- | --- | --- |
| Caterpillar | 60 / 58 | 11 (de 57 compartidos) | Diferencias casi todas de entorno; **sin drift funcional grave**. Gating de procesos habilitados no se prueba en TEST. |
| Audi | 44 / 39 | 3 de 36 compartidos | **PROD adelantada a TEST** (detección con PostgreSQL); TEST conserva lógica legada y usa el manejador de errores de PROD. |
| Notificaciones de pago | 100 / 100 | 6 | **PROD adelantada a TEST** en el resumen por correo; TEST comparte credencial de Outlook y lee datos reales. |

## Caterpillar

Exports: [PROD](../../n8n/workflows/remisiones-caterpillar/prod/workflow.json) (`Remisiones CAT Produccion PG`) vs [TEST](../../n8n/workflows/remisiones-caterpillar/test/workflow.json) (`MANUAL TEST REMISIONES CAT`).

| Aspecto | TEST | PROD | Clasificación |
| --- | --- | --- | --- |
| `active` al exportar | no | sí | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Schedule | 10 min | 10 min | Igual |
| Conexiones | Añade `Filtrar archivos nuevos → Filtrar solo pruebas locales1 → Loop Over Items` y `Webhook … (TEST)` | `Filtrar archivos nuevos → Loop Over Items` y `Webhook … (PROD)` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Nodos exclusivos | `Filtrar solo pruebas locales1` (aislamiento: ruta bajo `Pruebas\…\00_ARCHIVOS A PROCESAR` **y** nombre con "PRUEBA"), `Webhook Reproceso CAT (TEST)`, `Execute a SQL query` (**suelto**, sólo consulta `pg_get_functiondef` de `fn_finalizar…`) | `Webhook Reproceso CAT (PROD)` | Aislamiento: esperado · nodo suelto: `LEGACY_CONFIGURATION` |
| Credencial PostgreSQL | `cat_test` | `Postgres produccion` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Credencial Header Auth | `Daubert Hub - n8n TEST` | `Daubert Hub - n8n PROD` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Webhook | `POST cat-test-reprocess` (uso con `webhook-test`) | `POST cat-reprocess` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Base de trabajo | `…\Dropbox\Pruebas\REMISIONES CAT` | `…\Dropbox\HERRAMIENTAS AUTOMATIZACION\REMISIONES CAT` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Origen de archivos | `ACTIVAR_APARTADO_PRUEBAS = true`, `ACTIVAR_RUTAS_REALES = false` → sólo `00_ARCHIVOS A PROCESAR` | `false` / `true` → `RUTAS_REALES` de `…\CLIENTES\…` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Fecha de corte (`Filtrar archivos nuevos`) | 2026-09-21 | 2026-09-22 | `EXPECTED_ENVIRONMENT_DIFFERENCE` (a confirmar) |
| `empresa_id` fijo en `Resolver documento origen PG` | valor de TEST | valor de PROD | `EXPECTED_ENVIRONMENT_DIFFERENCE` (pero hardcodeado: `LEGACY_CONFIGURATION`) |
| `PROCESOS_HABILITADOS_PROD` | **No existe**: TEST procesa cualquier planta clasificable de la carpeta de pruebas | P2, P5, P6 (en `Detectar archivos CAT1` y `Validar elegibilidad reproceso CAT`) | `FUNCTIONAL_DRIFT` (bajo): la rama `OUTSIDE_ALLOWED_SCOPE` y el gating por proceso **no se ejercitan en TEST** |
| Alcance del reproceso | `OUTSIDE_TEST_SCOPE` (ruta fuera de la carpeta de pruebas o nombre sin "PRUEBA") | `OUTSIDE_ALLOWED_SCOPE` (ruta real + proceso habilitado) | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Comentarios en código | "Para producción, cambiar a: …" en `BASE_HERRAMIENTA`; sticky de reproceso obsoleta ("requiere una función PG nueva, aún no creada" — la función ya existe) | Comentarios "PROD" | `LEGACY_CONFIGURATION` |
| Modo de promoción | Se promueve **editando constantes** (`BASE_HERRAMIENTA`, flags, empresa, corte) | — | `LEGACY_CONFIGURATION`: riesgo de error humano en cada promoción |
| Funciones PG usadas | Las mismas 7 | Las mismas 7 | Igual |
| Error Workflow | Ninguno | Ninguno | Igual (carencia común) |
| Resto de la lógica (46 de 57 nodos compartidos con parámetros idénticos; los otros 11 difieren sólo por lo anterior) | Igual | Igual | Igual |

Otros exports Caterpillar: el **candidato PG** (histórico) es PROD actual **menos** la rama de reproceso (17 nodos) y con diferencias en `Crear o recuperar ejecución PG` / `Propagar ejecución PG`; el **legado** (contadores JSON) es de otra generación. Ver [inventory](../../n8n/inventory.md).

## Audi

Exports: [PROD](../../n8n/workflows/remisiones-audi/prod/workflow.json) vs [TEST](../../n8n/workflows/remisiones-audi/test/workflow.json).

| Aspecto | TEST | PROD | Clasificación |
| --- | --- | --- | --- |
| `active` | no | sí | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Schedule | 15 min | 15 min | Igual (**el catálogo del Hub dice 10 min**) |
| Credencial PostgreSQL | `Postgres pruebas` | `Postgres produccion` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Origen de archivos | `Pruebas\REMISIONES AUDI\00_ARCHIVOS A PROCESAR` | `CLIENTES\AUDI\<año>\<carpeta de info. adicional>` (recursivo) | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| **Detección / idempotencia** | `Buscar programaciones Audi` lee el estado JSON `archivos_procesados_audi.json` (carpeta "EN DESUSO"), toma **1 archivo por corrida**, con `MODO_INICIALIZAR_ESTADO` | Sin JSON: hasta 20 candidatos, y `Preparar validación candidato PG → Validar candidato PG → Elegir archivo pendiente PG` descartan archivos ya `COMPLETADA` o `PROCESANDO` en PostgreSQL | **`FUNCTIONAL_DRIFT`: TEST está detrás de PROD** (PROD contiene lógica ausente en TEST) |
| Nodos exclusivos TEST | 5 nodos deshabilitados del contador/estado JSON (`Registrar archivo procesado Audi`, `Leer contador remisiones`, `Asignar no.Rem`, `Preparar contador actualizado`, `Guardar contador actualizado`) y 3 sticky ("LEGACY NODES", "Pendiente", "Posibles mejoras") | — | `LEGACY_CONFIGURATION` |
| Nodo suelto | `Execute a SQL query` (`current_database()`, `current_user`) | Igual, también en PROD | `LEGACY_CONFIGURATION` |
| **Error Workflow** | `Manejador de errores Audi Remisiones` (el **de PROD**) | El mismo | `FUNCTIONAL_DRIFT`: los errores de TEST se registran en la carpeta `04_ERRORES` **de PROD** |
| Subworkflows | Los mismos IDs que PROD (`Generación PDFs`, `Generación Hojas Identificación`) | ídem | Compartidos: un cambio afecta a ambos entornos (`UNKNOWN_REQUIRES_REVIEW`) |
| Funciones/SQL PG | Mismas consultas directas (`reservar_folios` legacy, INSERT/UPDATE directos) | ídem | Igual |
| Config. legada en PROD | — | `counterPath` (`contador_remisiones_audi.json`) sigue definido en `Preparar archivo trigger` aunque el contador ya no se usa; los JSON de contador/estado siguen en `05_ARCHIVOS AUXILIARES\ESTADO` | `LEGACY_CONFIGURATION` |
| Texto de log | `REEMPLAZADO_POR_POSTGRESQL_EN_PRUEBAS` | `REEMPLAZADO_POR_POSTGRESQL` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |

**¿PROD está detrás de TEST?** No: al revés. PROD tiene la validación de candidatos con PostgreSQL que TEST no tiene.

## Notificaciones de pago

Exports (no versionados, ver [security-notes](../../n8n/security-notes.md)): `Produccion Notificacion de pagos a Proveedores` vs `Test Notificacion de pagos a Proveedores`. Ambos: 100 nodos, 91 conexiones idénticas; 94 nodos con parámetros idénticos.

| Aspecto | TEST | PROD | Clasificación |
| --- | --- | --- | --- |
| `active` | no | sí | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| `MODO` en `Configurar entorno` | `PRUEBAS` (raíz `Pruebas\NOTIFICACIONES DE PAGO`) | `PRODUCCION` (raíz Dropbox completa; sistema en `HERRAMIENTAS AUTOMATIZACION\NOTIFICACIONES DE PAGO`) | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Credencial PostgreSQL | `Postgres pruebas` | `Postgres produccion` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Credencial Header Auth | `Daubert Hub - n8n TEST` | `Daubert Hub - n8n PROD` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| **Credencial Outlook** | `Outlook LOGIN OAUT2` | **La misma** | `UNKNOWN_REQUIRES_REVIEW`: TEST opera sobre el mismo buzón/OAuth que PROD |
| Filtro de remitente (`¿Correo válido de pagos?`) | dominio interno de la empresa | dominio del administrador de pagos (tercero) | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Carpeta de buzón y límite (`Obtener correos Outlook`) | carpeta distinta, `limit: 4` | carpeta de producción, `limit: 10` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| Destinatarios del resumen (`Send a message`) | sólo el correo de pruebas | destinatario operativo + CC | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| `correo_id` del reproceso manual (`Seleccionar correo a reprocesar`) | dato de prueba fijo | `0` | `EXPECTED_ENVIRONMENT_DIFFERENCE` |
| **Resumen por correo** (`Preparar resumen Sofi`) | Sin `extraerErroresArchivo` / motivos por archivo | Con extracción de errores por archivo (código, detalle y `HASH=` de 64 hex) | **`FUNCTIONAL_DRIFT`: TEST detrás de PROD** |
| Error Workflow | Ninguno | `errorWorkflow` → un ID **sin export** (DEPENDENCIA AUSENTE) | `FUNCTIONAL_DRIFT` |
| Webhook Hub | `daubert-hub/notificaciones-pago/reprocesar` | **Mismo `path`** | `UNKNOWN_REQUIRES_REVIEW`: sólo uno puede estar activo en la URL de producción |
| `firma` y `programacion_semanal` | TEST usa la firma de la carpeta de **PROD** y lee la programación semanal **real** (`Dropbox\CXP\CXP\PROGRAMACIÓN SEMANAL`) | igual (por diseño en `Configurar entorno`) | `UNKNOWN_REQUIRES_REVIEW` |
| Etiquetas del workflow en n8n | — | PROD tiene la etiqueta "Prueba" | `LEGACY_CONFIGURATION` |
| Nodo suelto | `BASELINE CORREOS` | `BASELINE CORREOS` (inserta correos como `PROCESADO`; sin conexiones) | `LEGACY_CONFIGURATION` (herramienta manual de línea base) |
| Schedule | Sin `minutesInterval` explícito | ídem | Igual |

## Drift crítico (según los criterios de la fase)

| Criterio | Hallazgo |
| --- | --- |
| TEST con lógica nueva ausente en PROD | **No** se detectó. |
| PROD con lógica ausente en TEST | Sí: Audi (validación de candidatos con PG) y Notificaciones (resumen con errores por archivo). Caterpillar: gating por procesos habilitados. |
| Funciones PG distintas | Sólo dentro de Caterpillar histórico (candidato sin resolver de reproceso). TEST y PROD vigentes usan las mismas funciones. |
| Credenciales incorrectas / cruzadas | Audi TEST usa el manejador de PROD; Outlook compartida; el candidato de Caterpillar (carpeta de pruebas) usa `Postgres produccion`. |
| Error Workflows distintos | Caterpillar: ninguno en ambos; Audi: el mismo; Notificaciones: PROD con handler ausente, TEST ninguno. |
| Schedules inesperados | Audi: **15 min** vs 10 min del catálogo del Hub. Caterpillar: 10 min (catálogo del Hub: 15). |
| Procesos habilitados distintos sin explicación | TEST no restringe procesos (explicado: entorno de pruebas). |
| Rutas antiguas / contadores JSON | Audi y Caterpillar PROD conservan `ESTADO\*.json` y config de contador sin uso. |
| JSON counters en un entorno y PG en otro | Audi TEST todavía **filtra con JSON de estado** (deshabilitado el registro); PROD usa PostgreSQL. |
| Nodos desconectados / sueltos | `Execute a SQL query` (Audi TEST y PROD, Caterpillar TEST), `BASELINE CORREOS` (Notificaciones). |
| Nodos deshabilitados | 5 en Audi TEST (contador JSON). Ninguno en el resto. |
| Ramas muertas | Config de contador Audi PROD; `RUTAS_PRUEBA` y `INPUT_TEST_DIR` presentes en el detector PROD con `ACTIVAR_APARTADO_PRUEBAS=false`. |
| Comentarios de prueba dentro de PROD | Sticky "Posibles mejoras" vacía y sticky de estado en el workflow PROD de Caterpillar; etiqueta "Prueba" en PROD de Notificaciones. |
