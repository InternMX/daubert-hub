# Manufactura → Producción · diagnóstico, matriz de riesgos y propuesta

**Estado: DIAGNÓSTICO Y PROPUESTA. No se aplicó nada en `daubert_global`, no se tocaron credenciales, servicios ni n8n.** Fecha: 2026-11-05. Rama: `feat/manufacturing-sheets-coex-baseline`.

## 0. Qué se verificó y con qué evidencia
| Origen | Qué cubre |
|---|---|
| **Código y documentación del repositorio** (verificado) | arquitectura, guards, migraciones 101–105, configuración, imágenes Docker, nginx, documentación de entornos/roles/drift TEST-PROD |
| **Consultas de lectura a PROD** (PENDIENTE: las ejecuta usted) | existencia/ausencia de objetos, roles y privilegios reales, defaults, triggers de evento, tamaños. Script listo: `database/maintenance/daubert_global/inventario_manufactura.readonly.sql` (el mismo para PROD y TEST; una sola transacción READ ONLY, sin leer datos de negocio) |
| **Réplica desechable** (verificado) | el inventario corre sin error antes y después de las migraciones, y la huella `H_ESTRUCTURA_SIN_MANUFACTURA` es **idéntica antes y después** de aplicar 101–105: las migraciones no alteran nada fuera del esquema `manufactura` |

No se usó ninguna credencial de TEST contra PROD. No hay acceso de lectura a PROD desde esta sesión.

## 1. Estado actual (hechos)
1. **Manufactura no existe en el código desplegado de PROD.** `main` (= v1.1.0) no tiene `ManufacturingSheetsModule` ni `ManufacturingDocumentsModule`. La rama añade **133 commits / 472 archivos / +43 k líneas** (44 líneas eliminadas): es casi totalmente aditiva, pero incluye cambios transversales (sección 4, R8).
2. **El gestor documental está bloqueado por diseño a TEST.** `TestOnlyGuard` compara la base configurada con la constante `daubert_hub_test`; en cualquier otra base **todas** las rutas de documentos y de abreviaturas responden 404. En PROD funcionaría solo la consulta de BIND y la vista previa/PDF de borrador (módulo `manufacturing-sheets`).
3. **La web activa el gestor solo con `VITE_MANUFACTURING_DOCUMENTS=true` en tiempo de compilación** (por defecto apagado; `docker/web.Dockerfile` no lo pasa).
4. **Las migraciones 101–105 están escritas para TEST**: base `daubert_hub_test`, rol de aplicación `daubert_hub_test_user` (136 referencias entre los 25 archivos 101–105: GRANT, POLICY, guards, smoke), comentarios «TEST», y una restricción `entorno_emision = 'PRUEBA'` (CHECK + trigger) que **impide** guardar un documento que no sea de prueba.
5. **Roles distintos por entorno.** PROD: `daubert_hub_app` (mínimo privilegio) + `n8n_app`; TEST: `daubert_hub_test_user` (más amplio: p. ej. DELETE en `audit.cambios`). Los roles son del clúster: ambos existen en las dos bases, con privilegios distintos.
6. **Dependencias de Manufactura con el resto de la base** (solo lectura, más escritura de auditoría): `security.users` (autor, revisor, rol ADMIN), `core.empresas` y `core.empresa_roles` (clientes), `audit.cambios` (escrita únicamente por `manufactura.fn_auditar_manufactura`, SECURITY DEFINER). Según la matriz de permisos documentada, `daubert_hub_app` ya tiene `RIU` en `security.users`, `core.empresas`, `core.empresa_roles` y `R` en `audit.cambios`: **no haría falta ampliar privilegios de objetos existentes** (a confirmar con la sección S7 del inventario).
7. **Nada compartido con las automatizaciones operativas.** Caterpillar, Audi y Notificaciones de Pago usan `ops.*`, `operacion.*`, `core.documentos` y las vistas de `n8n_app`; Manufactura crea un esquema **nuevo** (`manufactura`) y no altera ninguna tabla, función, trigger ni privilegio existente (comprobado en la réplica con la huella de estructura). `n8n_app` no recibe ningún privilegio en `manufactura`. Existe `staging.manufactura_*` en PROD (carga histórica): esquema distinto, sin conflicto.
8. **PDF.** La imagen de la API (`node:24-alpine`) **no incluye navegador ni fuentes de Office**: sin `MANUFACTURING_PDF_CHROME_PATH` el servicio responde 501 y **no se puede finalizar** ninguna hoja. Las regresiones de PDF se validaron con Chrome + Calibri en Windows. Las banderas de Chrome no incluyen `--no-sandbox` ni `--disable-dev-shm-usage` (necesarias o a evaluar en contenedor).
9. **Respaldo.** Existen respaldos diarios/mensuales cifrados con age, pero la documentación indica que **el descifrado y la restauración completa nunca se han demostrado**.
10. **nginx de la web** (`docker/nginx.conf`) no define `client_max_body_size` (por defecto 1 MB), mientras la API acepta firmas de hasta 2 MB.
11. **Procedimiento de refresco TEST←PROD** (`docs/operations/test-refresh-from-prod.md`): una vez exista `manufactura` en PROD, un refresco traería documentos y firmas reales a TEST con privilegios de otro rol; hay que actualizarlo antes de usarlo.

## 2. Matriz de riesgos y dependencias
Prob./Impacto: B=bajo, M=medio, A=alto.

| # | Riesgo / dependencia | Prob. | Imp. | Mitigación propuesta | Compuerta |
|---|---|---|---|---|---|
| R1 | La migración afecta objetos o procesos operativos de PROD | B | A | Solo crea esquema nuevo; guards (`lock_timeout`, base, rol, «no existe»); huella de estructura fuera de `manufactura` antes/después; ventana sin ejecuciones n8n en curso | Precheck/postcheck |
| R2 | Privilegios mal asignados (rol de TEST en PROD, o falta de grants a `daubert_hub_app`) | M | A | Migraciones PROD generadas con rol `daubert_hub_app`; postcheck verifica grants **exactos** y que `daubert_hub_test_user`/`n8n_app`/PUBLIC no tienen nada | Postcheck |
| R3 | La RLS no protege si `daubert_hub_app` fuera dueño de las tablas o tuviera BYPASSRLS | B | A | Inventario S2/S3; guard del UP (`NOT rolbypassrls`, dueño = administrador) | Precheck |
| R4 | Derivar a mano las migraciones PROD introduce divergencias respecto a TEST | M | A | **Generador determinista** TEST→PROD con sustituciones declaradas y contadas (falla si no coinciden); diff revisado; misma batería de pruebas desechables con el rol de PROD | Réplica desechable |
| R5 | `entorno_emision = 'PRUEBA'` (CHECK/trigger/API/UI) impide o falsea documentos de PROD | A | A | Decisión de negocio (ver §5-D2); migración PROD con valor `PRODUCCION` y textos/UI dependientes del entorno (`/api/health`) | Cambio de código revisado |
| R6 | `TestOnlyGuard` mal relajado expone el gestor donde no hay esquema | M | M | Sustituir por habilitación explícita (variable de entorno + comprobación de que el esquema/versión existen); mantener 404 si falta | Pruebas HTTP |
| R7 | Sin Chrome/fuentes en la imagen: no hay PDF finalizado; con Carlito en lugar de Calibri puede cambiar la forma de letra | A | A | Decisión §5-D1; spike en contenedor (sandbox, `/dev/shm`, memoria, fuentes) y repetir la regresión de posiciones en la imagen real; aprobación visual de Manufactura | Spike + aprobación |
| R8 | Alcance de la liberación: la rama incluye cambios transversales (clientes **solo ADMIN** para altas/ediciones/baja; pipe de validación global; Actividad reciente; Automatizaciones; usuarios/perfil/firmas; dependencias `jpeg-js` y `pngjs`) | M | M | Regresión de las pantallas existentes; avisar a usuarios GENERAL del cambio en clientes; revisar `package-lock` | Plan §4 |
| R9 | nginx 1 MB vs firma 2 MB; tiempos de proxy en PDF | M | B | Definir `client_max_body_size 3m` y `proxy_read_timeout` ≥ 60 s en el nginx de la web; probar con firma de 1.5–2 MB | Smoke |
| R10 | Restauración no demostrada | A | A | Prueba de restauración en entorno aislado **antes** de cualquier DDL | Compuerta obligatoria |
| R11 | Crecimiento de `audit.cambios` por autoguardado/auditoría y de la base por PDF/firmas (bytea) | M | B | Medir S8 del inventario; estimar volumen; plan de retención/archivo | Revisión |
| R12 | Copiar datos de TEST (firmas, abreviaturas, documentos) a PROD | M | A | **No copiar**: los ids de usuarios/empresas difieren y las firmas son de prueba; el catálogo de abreviaturas se carga por importación revisada o por la UI ADMIN | Política |
| R13 | Cliente «manual» (texto libre, sin verificar) en documentos reales | M | M | Decisión §5-D3 | Negocio |
| R14 | Privilegios por defecto (`pg_default_acl`) o triggers de evento que otorguen/bloqueen al crear objetos | B | M | Inventario S7/S9 | Precheck |
| R15 | Secretos de BIND en PROD | B | M | Variables solo en `deploy/pilot.prod.env` (no versionado); sin BIND la API responde `NOT_CONFIGURED` sin caerse | Checklist |
| R16 | Reversión después de crear documentos | M | A | Esquema aditivo: la reversión de **aplicación** no necesita tocar la base; el `DOWN` de esquema solo con tablas vacías y confirmación explícita; después de usar, corrección hacia adelante | Plan §4 |
| R17 | Superficie de ataque de Chromium | B | M | Procesos hijos aislados (ya sin red: `host-resolver-rules`), usuario sin privilegios, límites de memoria/CPU del contenedor, concurrencia 2 | Spike |

## 3. Estrategia de migración (propuesta)
1. **No tocar** `database/migrations/daubert_hub_test/*` (101–105). Nuevos archivos en `database/migrations/daubert_global/` con la convención existente `YYYYMMDD_NNN_<descripcion>_prod.{precheck,up,postcheck,down}.sql`. Numeración a confirmar contra el directorio externo de migraciones (en el repo la última es la 011): propuesta **012–016**.
2. **Generador determinista** (`tools/` de la rama, sin dependencias nuevas): lee cada archivo de TEST y aplica sustituciones **explícitas y contadas** — base `daubert_hub_test`→`daubert_global`; rol `daubert_hub_test_user`→`daubert_hub_app`; marcas «TEST/PRUEBA» en comentarios y mensajes; `entorno_emision` (según §5-D2); marcas de la 105. Si alguna sustitución no ocurre exactamente el número esperado de veces, el generador falla. Se revisa el `diff` generado contra TEST y se versiona el resultado (los archivos PROD son los revisados y firmados con SHA-256, no el generador).
3. **Cada migración PROD conserva** precheck (solo lectura + línea base `H_ESTRUCTURA_SIN_MANUFACTURA` y huella de privilegios), UP transaccional con guards (`lock_timeout = 10s`, base = `daubert_global`, rol administrativo, el esquema/objeto no existe, `daubert_hub_app` sin BYPASSRLS/CREATEROLE/…), postcheck (con la línea base: lo anterior **no cambió**), y DOWN seguro (aborta si hay filas).
4. **Qué se crea en PROD (todo vacío):** esquema `manufactura`, 9 tablas, funciones, triggers, políticas RLS y grants **solo** a `daubert_hub_app`. **Qué NO se copia:** datos de TEST (documentos, firmas, autorizaciones, abreviaturas), usuarios, clientes, `audit.cambios`, configuración de TEST, el rol `daubert_hub_test_user` (nunca recibe privilegios en PROD).
5. **Validación previa en réplica desechable de la estructura de PROD:** (a) levantar PostgreSQL 18 desechable; (b) reconstruir la estructura con el **esquema real de PROD** (`pg_dump --schema-only` de `daubert_global`, sin datos, ejecutado por usted, restaurado solo en la réplica) más los roles con sus privilegios reales; (c) aplicar precheck → UP → postcheck → smoke (con el rol `daubert_hub_app`) → DOWN → UP; (d) ejecutar la batería desechable de la API contra esa réplica con `DB_USER=daubert_hub_app`; (e) comparar `H_ESTRUCTURA_SIN_MANUFACTURA` antes/después.

## 4. Preparación de la aplicación
| Área | Cambio mínimo necesario | Tipo |
|---|---|---|
| Separación TEST/PROD | Sustituir `TestOnlyGuard` por habilitación explícita (`MANUFACTURING_DOCUMENTS_ENABLED=true` **y** esquema presente); `/api/health` ya distingue `TEST`/`PRODUCTION` | Código pequeño |
| Etiquetas de entorno | Textos «PRUEBA/TEST» de la interfaz (≈10) y `entorno` del documento dependientes del entorno; el chip de TEST se conserva en TEST | Código pequeño |
| Web | Pasar `VITE_MANUFACTURING_DOCUMENTS=true` como `ARG` en `docker/web.Dockerfile` solo para la compilación de PROD | Configuración |
| Roles | ADMIN/GENERAL ya salen de `security.users`; no se agrega autenticación nueva. Revisor, creador y ADMIN siguen aplicándose en API + RLS | Sin cambios |
| BIND | `BIND_API_KEY` (+ `BIND_SUBSCRIPTION_KEY`) en `deploy/pilot.prod.env`; `BIND_API_BASE_URL` por defecto | Configuración (secreto) |
| PDF | Chromium + fuentes métricamente compatibles en la imagen de la API (o servicio dedicado), `MANUFACTURING_PDF_CHROME_PATH`, límites de memoria, `/dev/shm`; evaluar sandbox | **Decisión + spike** |
| nginx | `client_max_body_size` ≥ 3 MB; `proxy_read_timeout` ≥ 60 s | Configuración |
| Firmas / responsables | Sin semillas: cada persona sube su firma; ADMIN custodio para personas sin cuenta; autorizaciones por la propietaria | Procedimiento |
| Historial/auditoría/Actividad reciente | Ya implementados; en PROD empezarán vacíos. Actividad reciente devuelve vacío si no existe el esquema | Sin cambios |
| Errores | Códigos existentes (`INACTIVE`, `PDF_NOT_AVAILABLE`, `FIRMAS_NO_DISPONIBLES`, `CATALOGO_NO_HABILITADO`) ya explican la indisponibilidad | Sin cambios |
| Respaldo | Añadir `manufactura` al alcance del respaldo existente (ya es por base completa) y documentar la restauración | Documentación |

## 5. Decisiones que necesito
- **D1 · PDF en PROD:** (A) Chromium dentro de la imagen de la API [simple; +~400 MB; Carlito en lugar de Calibri]; (B) contenedor dedicado «renderizador»; (C) otro host. Recomendación: **A**, tras un spike y con aprobación visual de Manufactura.
- **D2 · `entorno_emision`:** en PROD ¿los documentos finalizados son documentos reales (`PRODUCCION`) o se mantendrán como «PRUEBA» hasta una segunda fase? Recomendación: `PRODUCCION` con textos dependientes del entorno.
- **D3 · Cliente manual sin verificar:** ¿se permite en PROD o solo clientes del catálogo?
- **D4 · Alcance del release:** la rama se libera completa (no se puede aislar Manufactura por commits); confirmar versión (propuesta v1.2.0) y aviso a usuarios GENERAL por el cambio de permisos en clientes.
- **D5 · Catálogo de abreviaturas inicial:** importación revisada (con su evidencia) o carga manual por ADMIN.
- **D6 · Ventana y operador** de la migración y del despliegue.

## 6. Qué se puede hacer desde ahora / qué requiere pruebas / qué requiere autorización
| Categoría | Elementos |
|---|---|
| **Ya, sin riesgo para PROD** (solo repo/réplica) | inventario de solo lectura (listo); generador y migraciones PROD 012–016 (borradores, sin aplicar); réplica desechable de la estructura de PROD; sustitución de `TestOnlyGuard` y etiquetas por entorno; ARG de la web; nginx; actualización del procedimiento de refresco; documentación y runbook |
| **Requiere pruebas adicionales** | spike de Chromium en contenedor (sandbox/shm/fuentes/memoria) y repetición de la regresión de posiciones; ensayo de restauración del respaldo; pruebas de carga ligera de PDF (concurrencia 2, cola 4); regresión de pantallas existentes del release; subida de firma 2 MB a través de nginx |
| **Requiere su autorización expresa** | ejecutar el inventario en PROD (solo lectura); decisiones D1–D6; generar el respaldo de PROD y restaurarlo en el entorno aislado; aplicar migraciones PROD; construir/desplegar imágenes; configurar secretos de BIND en PROD; reiniciar servicios; cualquier carga de datos |

## 7. Plan de liberación (esquema; se detalla tras D1–D6)
1. **Previos:** inventario PROD revisado; D1–D6 resueltas; imágenes construidas y probadas en TEST con la configuración de PROD; migraciones PROD validadas en la réplica; pruebas desechables verdes; typecheck/lint/build.
2. **Respaldo:** `pg_dump -F c` de `daubert_global` + copia de `deploy/pilot.prod.env` y estado de n8n; **restauración probada** en un PostgreSQL aislado y verificada (conteos + huellas). Si falla, **se detiene**.
3. **Ventana:** sin ejecuciones n8n en curso (Caterpillar/Audi/Pagos) y con la web en mantenimiento breve.
4. **Migraciones en orden:** precheck 012 → UP 012 → postcheck 012 (con línea base) → … → 016; tras cada una, comparar `H_ESTRUCTURA_SIN_MANUFACTURA`.
5. **Aplicación:** primero API (nueva imagen, `MANUFACTURING_DOCUMENTS_ENABLED=true`, BIND, Chromium); comprobar `/api/health`; después web. El esquema es aditivo, así que la API anterior sigue funcionando si se revierte.
6. **Smoke:** `/api/health` = `PRODUCTION`; con un usuario **ADMIN**: crear hoja desde BIND, guardar, finalizar un PDF de prueba interno, registrar firma/autorización, abreviatura; con un usuario **GENERAL**: crear/editar su borrador, consultar borrador ajeno en solo lectura, intento de edición ajena rechazado; Actividad reciente; pantallas de Caterpillar/Audi/Pagos sin cambios; revisar logs y `audit.cambios`.
7. **Detener o revertir si:** falla cualquier postcheck; cambia la huella de estructura fuera de `manufactura`; un proceso n8n reporta errores nuevos; el PDF no pasa la aprobación visual; hay errores 5xx sostenidos. **Revertir:** volver a las imágenes anteriores (sin tocar la base); `DOWN` del esquema solo si está vacío; si ya hay documentos reales, corregir hacia adelante. **Recuperación ante daño de datos:** restaurar el respaldo en un entorno aislado y reconciliar, nunca sobre `daubert_global` sin autorización.
8. **Después:** registrar la nota de despliegue en `docs/deployments/`, actualizar roles/permisos y la matriz de drift TEST-PROD.

## 8. Resultados del inventario real (ejecutado por el operador el 2026-11-05; PROD vs TEST)
Archivos analizados: `Inventarios_PostgreSQL\inventario_PROD.txt` e `inventario_TEST.txt` (UTF-16, generados con `>` de PowerShell; para el siguiente use `-o archivo`). **Ambas bases están en el MISMO servidor** PostgreSQL 18.4 (Windows).

### 8.1 Compatible / sin conflicto
| Comprobación | PROD (`daubert_global`) |
|---|---|
| Esquema `manufactura` | no existe, 0 objetos → los UP «no existe» pasarán |
| Conflictos de nombres | ninguno (solo `core.documentos` y `staging.manufactura_*`, esquemas distintos) |
| Rol `daubert_hub_app` | sin superusuario, sin CREATEROLE/CREATEDB, **sin BYPASSRLS**; no es dueño de ninguna dependencia |
| Dependencias (`security.users`, `core.empresas`, `core.empresa_roles`, `audit.cambios`) | **mismas columnas y tipos que TEST** (`H_DEPENDENCIAS` coincide); dueño `postgres`, sin RLS |
| Privilegios de `daubert_hub_app` sobre ellas | `security.users` SIU-, `core.empresas` SIU-, `core.empresa_roles` SIU-, `core.alias_empresa` SIUD, `audit.cambios` S--- ; USAGE en `audit/core/security` → **suficientes, no hace falta ampliar nada** |
| Auditoría | `audit.fn_registrar_cambio*` con el mismo cuerpo que TEST; `audit.cambios` sin triggers propios |
| Mecanismos que interfieren | sin triggers de evento, sin publicaciones, sin privilegios por defecto (`pg_default_acl`), solo la extensión `plpgsql` (`gen_random_uuid()` y `sha256()` son nativas de PG 18) |
| `daubert_hub_test_user` en PROD | **cero** privilegios de tabla y sin USAGE en esquemas (solo el CONNECT por defecto de la base) |
| Tamaño y carga | base de 13 MB; `audit.cambios` 146 filas; una sola conexión de la aplicación (`daubert_hub_app`, inactiva) y sesiones de pgAdmin inactivas |

### 8.2 Diferencias PROD ↔ TEST relevantes
1. **La huella de estructura fuera de `manufactura` NO coincide** (`8e9162…` PROD vs `e47f44…` TEST) aunque los conteos por esquema sí (tablas, vistas, secuencias, funciones, triggers). Hay una diferencia a nivel de columna, índice, restricción, vista o texto de función que **no se puede identificar con este inventario**. Es la prioridad #1: la rama usa TEST como fuente de verdad y podría depender de un objeto o columna que PROD no tiene. Para localizarla: `database/maintenance/daubert_global/estructura_items.readonly.sql` (una línea por objeto; se compara con `diff`).
2. **Usuarios:** PROD tiene **4 ADMIN y 0 GENERAL**; TEST, 2 ADMIN y 45 GENERAL. Para la prueba «con un usuario GENERAL» habrá que crear una cuenta GENERAL en PROD (cambio de datos que requiere autorización).
3. **Clientes:** PROD tiene 124 empresas y **solo 2 con rol CLIENTE** (TEST: 207 y 5). El catálogo de abreviaturas necesita clientes con rol CLIENTE activo: antes de importar abreviaturas hay que dar de alta/clasificar los clientes reales (ADMIN). Los ids difieren entre bases: confirma que **no se copia nada de TEST**.
4. **Roles:** en PROD existe además `n8n_cat_prod` (con USAGE en `core/operacion/ops`; la documentación decía que Caterpillar usaba `n8n_app`: **actualizar `roles.md`**). TEST tiene `n8n_app_test` y `n8n_cat_test`. El postcheck de PROD debe comprobar que **ninguno** de `n8n_app`, `n8n_cat_prod`, `daubert_docs_ro`, `daubert_hub_test_user` ni PUBLIC recibe privilegios en `manufactura` (`daubert_docs_ro` tiene USAGE por esquema y SELECT en las demás tablas: debe quedar fuera de `manufactura`).
5. **`daubert_hub_test_user` conserva CONNECT sobre `daubert_global`** (por el valor por defecto de PostgreSQL). Sin privilegios sobre objetos no hay acceso, pero conviene un `REVOKE CONNECT` en una migración aparte y autorizada.
6. **Configuración del servidor:** `archive_mode = off` → no hay recuperación a un punto en el tiempo; el respaldo es `pg_dump` (con la prueba de restauración como compuerta). `lock_timeout` y `statement_timeout` globales en 0: los scripts ya fijan los suyos con `SET LOCAL`.
7. **Volumen:** auditoría de TEST tras todo el desarrollo: 322 filas de `manufactura` y 3.5 MB en total; el riesgo R11 (crecimiento) baja a **bajo**.

### 8.3 Efecto en los riesgos y en el plan
- R1/R2/R3/R14 **bajan** (privilegios y dependencias verificados; sin interferencias).
- **Sube a prioridad 1** la diferencia de estructura (8.2-1) y la falta de usuarios GENERAL / clientes en PROD (8.2-2, 8.2-3), que condicionan la validación y la carga inicial.
- El plan de migración no cambia: esquema nuevo, grants solo a `daubert_hub_app`, postcheck con la huella de estructura (corregida cuando se identifique la diferencia) y comprobación negativa de privilegios.
