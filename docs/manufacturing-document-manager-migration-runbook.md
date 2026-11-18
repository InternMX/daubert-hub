# Gestor documental · procedimiento definitivo del operador para `daubert_hub_test`

**Estado: APLICADA en `daubert_hub_test` el 2026-10-30** (ver «Resultado de la aplicación en TEST» al final). Nada se corrió contra `daubert_global`. Requiere autorización expresa del responsable. Sin contraseñas: use `%APPDATA%\postgresql\pgpass.conf` o `PGPASSWORD` solo en la sesión del operador, y no copie salidas con credenciales a ningún informe.

**Decisión de recuperación (2026-10-30).** `daubert_hub_test` se considera un entorno de pruebas **reconstruible**: por decisión del proyecto, **un respaldo completo previo de TEST ya no es condición obligatoria** para esta migración (el `pg_dump` pasa a ser opcional). Se mantienen: verificación inequívoca del destino, hashes de los scripts, rol administrativo autorizado, precheck, UP transaccional, postcheck inmediato, pruebas de permisos y auditoría, y registro de resultados. Si el UP falla **no se ejecuta ninguna operación destructiva por reflejo**: primero se investiga el estado resultante (§4). El refresco futuro de TEST desde un respaldo de `daubert_global` se documenta aparte en [operations/test-refresh-from-prod](operations/test-refresh-from-prod.md) y **no forma parte de esta migración**.

Scripts (revisión 3), en `database/migrations/daubert_hub_test/`, prefijo `20261030_101_manufactura_gestor_documental_test`: `precheck`, `up`, `postcheck`, `down`, `smoke` e `inventario_connect.readonly.sql`. Descripción y alcance: `database/migrations/daubert_hub_test/README.md` e informe `manufacturing-document-manager-migration-approval.md`.

## 1. Resultado de la revisión del SQL vigente (2026-10-30)

| Requisito | Resultado | Dónde |
| --- | --- | --- |
| Aborta si la base no es `daubert_hub_test` | Sí, en los cinco scripts (`current_database()`), antes de cualquier otra acción; imprimen `base_actual` | precheck L17-25, up L25-27, postcheck L15-20, down L36-38, smoke L14-17 y L27 |
| Privilegios previstos | UP/precheck/postcheck/DOWN exigen superusuario (`rolsuper`); el smoke exige lo contrario (no superusuario ni `BYPASSRLS`) | up L28-34, down L39-41, smoke L28 |
| No modifica `daubert_global` | Ninguna sentencia nombra otra base; el análisis estático no encontró DDL/DCL fuera de `manufactura.*` (solo `CREATE SCHEMA/TABLE/FUNCTION/TRIGGER/POLICY/INDEX`, `ALTER TABLE manufactura.*`, `GRANT/REVOKE` sobre `manufactura`, `COMMENT`). Las líneas base ampliadas (tablas, funciones, columnas, triggers, privilegios y dueños, roles, ACL de bases y esquemas) lo comprueban en el postcheck | precheck L74-91, postcheck L79-96 |
| Solo crea lo autorizado | 5 tablas, 15 funciones, 11 triggers de integridad + 4 de auditoría, 11 políticas RLS; el UP se autovalida (5 tablas con RLS, sin DELETE/UPDATE indebidos, sin `CREATE`) y todo está en una transacción | up L571-579 |
| Integridad conservada | PK/UNIQUE/CHECK, un solo borrador abierto por documento (índice parcial), coherencia de estado, huella calculada por la base, FK `ON DELETE RESTRICT` | up L143-290 |
| FK compatibles con el esquema existente | `security.users.user_id` y `core.empresas.empresa_id` son `bigint` (fichas de catálogo) y `audit.cambios.usuario_id` es `text`, igual que lo que inserta la función de auditoría. El precheck comprueba que las 11 columnas existan, **no su tipo**: si un tipo no coincidiera, el `CREATE TABLE` fallaría y la transacción se revertiría sin dejar nada | docs/database/tables/*.md |
| Auditoría sin exponer borradores ajenos | `fn_auditar_manufactura` (SECURITY DEFINER, `search_path` fijo) omite la especificación, los nombres impresos, el cliente y el código/variante del documento; el contenido del PDF no se audita. Siguen en `audit.cambios` metadatos (ids, estado, versión, huella, familia, actores). `manufactura` no está en el catálogo de entidades de la pantalla de Auditoría (solo ADMIN), así que no se muestra en el Hub | up L108-129, L518-521; smoke T11 |
| RLS con ADMIN y GENERAL | Finalizadas visibles a todos; borradores/finalizando/descartadas solo para su creador, su revisor y ADMIN; UPDATE solo creador/ADMIN; el dueño de las tablas (administrador) omite RLS. El smoke prueba tres identidades (1 ADMIN + 2 GENERAL) | up L535-551; smoke |
| Finalizadas inmutables | `fn_revisiones_before_update` rechaza cualquier cambio sobre `FINALIZADA`/`DESCARTADA`; sin `DELETE`/`TRUNCATE` para la app; triggers de inmutabilidad en documentos, PDF y confirmaciones | up L131-137, L348-350, L435 |
| PDF y hashes | La base verifica SHA-256 y tamaño de los bytes recibidos, que la huella de la especificación coincida con la revisión y el nombre `CODIGO[-VARIANTE]_REVnn.pdf`; no se finaliza sin PDF íntegro | up L437-481, L411-418 |
| Smoke sin residuos | Rol de la app, una sola transacción terminada en `ROLLBACK`, y el propio script comprueba después que no quedaron filas de auditoría ni de negocio; solo quedan huecos en los ids de las secuencias. Usa cuentas **existentes** de `security.users` solo para fijar la identidad de sesión (no las modifica) | smoke L5, L27-48, L236-240 |
| DOWN no destruye datos reales por accidente | Idempotente; imprime lo que perdería; con datos exige `confirmar_borrado` y con finalizadas/PDF además `confirmar_finalizadas`; sin `CASCADE`; conserva `audit.cambios` | down L8-9, L55-60, L69-90 |
| Hashes de los archivos | Coinciden con los del informe de aprobación (`down 4400b324…`, `postcheck 2b9f86e4…`, `precheck d8335a2d…`, `smoke 1078c985…`, `up de2a55e6…`, `inventario 435a3c55…`) | `sha256sum` |

**Observaciones (no bloqueantes):**
1. **El postcheck solo es válido inmediatamente después del UP**: exige las cinco tablas vacías (`tablas_vacias_o_con_datos_de_prueba_esperados`) y la línea base de conteos de `audit.cambios`. Ejecutarlo después de usar el módulo dará `all_checks_pass = false` por diseño.
2. **El smoke exige ≥ 1 ADMIN y ≥ 2 GENERAL activos** en `security.users` de TEST; confírmelo antes (consulta de conteo, solo lectura).
3. **Mantenimiento manual:** incluso con el rol administrativo, un `UPDATE`/`INSERT` en estas tablas falla sin `app.user_id`/`app.user_email` (los triggers exigen identidad). Es deliberado.
4. **Efecto fuera de `manufactura` (deliberado):** bloqueo breve `SHARE ROW EXCLUSIVE` sobre `security.users` y `core.empresas` (con `lock_timeout` de 10 s) y que un usuario o empresa referenciados por un documento no puedan borrarse (`RESTRICT`).
5. Los hashes del informe corresponden a los archivos tal como están en disco: calcule el `sha256` de los archivos **que va a ejecutar** (un checkout con otra conversión de fin de línea los cambiaría).

## 2. Secuencia del operador (rol administrativo `postgres`, siempre `-d daubert_hub_test`)

Directorio de trabajo: `C:\Users\06\Documents\Daubert\daubert-hub\database\migrations\daubert_hub_test`. Guarde la **evidencia de cada paso** (salida sin credenciales) en una carpeta nueva fuera del repositorio, por ejemplo `C:\Users\06\Documents\Daubert\_archivo\migracion-gestor-documental-test\` (no sobrescriba nada existente). Un `pg_dump` previo de TEST es **opcional** (si lo hace: `-F c`, `pg_restore --list` y SHA-256, y nunca restaurarlo sobre `daubert_hub_test` sin autorización).

| # | Paso | Comando / criterio de paso | Si falla |
| --- | --- | --- | --- |
| 0 | Integridad de scripts y ventana | `Get-FileHash -Algorithm SHA256 .\20261030_101_*.sql` = hashes de §1. Ventana tranquila: nadie usa TEST (el UP toma un bloqueo breve). Confirme ≥ 1 ADMIN y ≥ 2 GENERAL activos (conteo de solo lectura) | No continuar |
| 1 | Identidad inequívoca del destino | `psql -h localhost -p 5432 -U postgres -d daubert_hub_test -X -w -c "SELECT current_database(), current_user, inet_server_port(), version();"` → `daubert_hub_test`, puerto 5432, rol administrativo. Comprobar que **no** es `daubert_global`. Cada script vuelve a abortar si la base no es la esperada | No continuar |
| 2 | Estado previo (solo lectura, sin respaldo de datos) | Opcional pero recomendado: `pg_dump -h localhost -p 5432 -U postgres -d daubert_hub_test --schema-only -f <carpeta>\esquema_antes.sql`; confirmar que el esquema `manufactura` **no existe** (el precheck lo hace) | No continuar |
| 3 | Precheck | `psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.precheck.sql` → `all_prechecks_pass = t`. **Anote los 11 valores de la línea base** | No se escribió nada: corregir causa |
| 4 | UP (transaccional) | Mismo comando con `…up.sql` → `UP_OK …` y `COMMIT` | Ver §4 (no ejecutar nada destructivo antes de investigar) |
| 5 | Postcheck inmediato | Mismo comando con `…postcheck.sql` y `-v baseline_users=<n> -v baseline_empresas=<n> -v baseline_audit_cambios=<n> -v baseline_tablas_fp=<md5> -v baseline_funciones_fp=<md5> -v baseline_columnas_fp=<md5> -v baseline_triggers_fp=<md5> -v baseline_privilegios_fp=<md5> -v baseline_roles_fp=<md5> -v baseline_acl_bases_fp=<md5> -v baseline_esquemas_acl_fp=<md5>` → `all_checks_pass = t` | Ver §4 |
| 6 | Pruebas de permisos y auditoría (smoke) | Con `-U daubert_hub_test_user` y `…smoke.sql` → `smoke_all_pass = t` (55 pruebas, incluidas RLS con 1 ADMIN + 2 GENERAL, sin DDL/DELETE para la app y auditoría redactora con usuario y request reales) y las dos columnas de residuos en `t`. Termina en `ROLLBACK` | Ver §4 (nada persiste; solo huecos de ids) |
| 7 | Permisos de `daubert_hub_test_user` | Los cubre el postcheck (`app_usage`, `app_sin_create_*`, `permisos_*`, `otros_roles_sin_acceso`, `public_sin_acceso`). Evidencia adicional, solo lectura: `SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee='daubert_hub_test_user' AND table_schema='manufactura' ORDER BY 1,2;` → solo los privilegios del README de la migración | Ver §4 |
| 8 | Nada fuera de alcance cambió | Las columnas `*_igual` del postcheck (usuarios, empresas, `audit.cambios`, tablas, funciones, columnas, triggers, privilegios y dueños, roles, ACL de bases y de esquemas) deben ser `t` | Ver §4 |
| 9 | Registro del estado del esquema | Guarde: salida del precheck (línea base), `UP_OK`, salida completa del postcheck y del smoke, `\dn+ manufactura`, `\dt+ manufactura.*`, `\df+ manufactura.*` y el `SELECT version()` del paso 1; opcionalmente `pg_dump --schema-only -n manufactura`. Sin contraseñas | — |

## 3. Después de la migración (activación controlada; aún NO hecha)

1. **Migración y postcheck exitosos** (pasos 1-9).
2. **Registrar `ManufacturingDocumentsModule` en `AppModule`** (`apps/api/src/app.module.ts`), en un commit de la rama de manufactura. Solo el API de TEST puede incluirlo: el Hub de producción se construye desde `main`, que no contiene el módulo ni la rama de manufactura. El API de TEST debe conectarse como `daubert_hub_test_user` (el lanzador `npm run dev` fuerza `daubert_hub_test`).
3. **Activar el frontend** solo en el build/entorno de TEST con `VITE_MANUFACTURING_DOCUMENTS=true` (hoy apagado por defecto).
4. **Chrome para finalizar PDF:** comprobar que existe (`Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe"`) o fijar `MANUFACTURING_PDF_CHROME_PATH`; sin Chrome la finalización responde `501 PDF_NOT_AVAILABLE` y el borrador queda intacto.
5. **Pruebas de extremo a extremo con usuarios de TEST** (1 ADMIN + 2 GENERAL): guardar y abrir borrador (incluido sin BIND), «Elaboró», revisor y revisión, finalizar, descargar PDF, nueva revisión, descartar y reabrir; borrador ajeno invisible para otra cuenta GENERAL y visible para ADMIN; revisión finalizada en solo lectura.
6. **Comprobar permisos, auditoría y revisiones:** que `audit.cambios` registre `manufactura` con el usuario real y **sin** especificación, nombres impresos, cliente ni código/variante; que el PDF almacenado coincida con su SHA-256; que no haya `FINALIZANDO` abandonadas.
7. **Reversión de la activación:** retirar el registro del módulo y apagar la variable del frontend; la base se conserva.

## 4. Si algo falla: investigar primero, no destruir

Regla general: **no ejecute `DOWN`, `DROP` ni restauraciones como primera reacción.** Primero determine el estado real (solo lectura) y regístrelo.

| Situación | Investigación (solo lectura) | Acción |
| --- | --- | --- |
| Falla en pasos 0-3 | Nada se escribió. | Corregir la causa y repetir. |
| Falla durante el UP | El UP es una transacción: lo esperado es que no quede nada. Verifique `SELECT nspname FROM pg_namespace WHERE nspname='manufactura';` (debe estar vacío), conexiones colgadas (`pg_stat_activity` de `daubert_hub_test`), bloqueos pendientes (`pg_locks`) y el mensaje exacto del error (p. ej. `lock_timeout` sobre `security.users`/`core.empresas`, tipo incompatible, rol inexistente). | Si no existe el esquema: corregir la causa y repetir desde el precheck. Si apareciera algo parcial (no debería): detenerse, registrar `\dn+` y `\dt+ manufactura.*` y consultar antes de actuar. |
| Postcheck con diferencias | Identifique qué columna dio `f` y por qué (objeto faltante, privilegio, línea base distinta por actividad concurrente en TEST). Verifique si las cinco tablas siguen vacías. | No habilitar el módulo. Si es solo ruido de actividad concurrente, repetir el postcheck con una línea base fresca; si es un defecto real, decide el responsable. |
| Smoke falla | Nada persiste. Identifique la prueba fallida en la salida. | No habilitar el módulo; corregir y repetir el smoke. |
| Retirar el módulo con tablas **vacías** | Confirmar que el DOWN imprime «Se perderían: 0…». | Con autorización: `…down.sql` sin parámetros (idempotente). |
| Retirar el módulo con datos de prueba o finalizadas | El DOWN imprime cuántas filas y bytes de PDF perdería. | Solo con autorización explícita: `-v confirmar_borrado=SI_BORRAR_DATOS_DE_PRUEBA` y, si hay finalizadas o PDF, además `-v confirmar_finalizadas=SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS`. Como TEST es reconstruible no se exige respaldo previo, pero un `pg_dump -n manufactura` es barato si se quiere conservar evidencia. |
| Daño que no pueda corregirse | — | TEST se **reconstruye**, no se repara a mano: ver el [refresco de TEST](operations/test-refresh-from-prod.md) (procedimiento futuro, no autorizado todavía) y reaplicar esta migración. |
| Finalización en `FINALIZANDO` | — | La reclama el creador o un ADMIN pasados 10 minutos; el contenido permanece congelado. |

## 5. Condiciones para ejecutar el paso 4 (UP)

1. Autorización expresa y por escrito del responsable, con la ventana y el operador identificados.
2. Hashes de los scripts iguales a los del informe de aprobación.
3. Destino verificado (paso 1) y precheck con `all_prechecks_pass = t`, con la línea base anotada.
4. Aceptación de que **TEST no tiene respaldo previo obligatorio** (datos reconstruibles) y de las consecuencias de `ON DELETE RESTRICT` hacia `core.empresas` y `security.users`.
5. Nadie usando TEST durante el UP, y carpeta de evidencias lista (paso 9).

## 6. Riesgos residuales

- **Sin respaldo previo obligatorio de TEST:** si el UP o el uso posterior dañara datos de TEST, la recuperación es reconstruir (refresco futuro desde `daubert_global`, aún no autorizado). Producción no se ve afectada.
- El **descifrado y la restauración completa** de los respaldos de producción (`.age`) siguen sin demostrarse; el refresco de TEST depende de ello (llave privada fuera de línea).
- El administrador (dueño) omite RLS y puede inhabilitar triggers: la inmutabilidad protege contra la aplicación, no contra un administrador deliberado.
- La huella usa `jsonb::text`; puede cambiar tras una actualización **mayor** de PostgreSQL (la integridad del PDF no depende de ella).
- `audit.cambios` es legible por el rol de la aplicación: conserva metadatos de borradores ajenos (no su contenido) y solo ADMIN los ve por la API.
- Un cliente «manual» es solo de TEST y queda marcado como no verificado.
- Los ids de identidad dejan huecos tras el smoke (inocuo).

## 7. Resultado de la aplicación en TEST (2026-10-30)

Ejecutada por el responsable desde una sesión administrativa interactiva (contraseña pedida por `psql -W`, sin credenciales en argumentos, archivos ni registros); sin respaldo previo, conforme a la decisión de TEST reconstruible.

| Paso | Resultado |
| --- | --- |
| Identidad | `daubert_hub_test`, rol `postgres`, puerto 5432 |
| Precheck | `all_prechecks_pass = t` (19 comprobaciones en `t`). Línea base: 47 usuarios, 204 empresas, 2 901 filas en `audit.cambios` y 8 huellas md5 |
| UP | `UP_OK manufactura (5 tablas, RLS, 15 funciones, 4 triggers de auditoría redactores, privilegios mínimos)` y `COMMIT` |
| Postcheck | 38 de 39 campos en `t`; todos los `*_igual` (nada fuera de `manufactura` cambió) en `t` |
| Smoke (rol de la app) | `smoke_all_pass = t`, 55 pruebas; sin residuos de auditoría ni de negocio |

**Desviación aceptada: `otros_roles_sin_acceso = f`.** El único rol con `USAGE` efectivo es `daubert_backup`, por ser miembro de `pg_read_all_data` (atributo del rol, no una concesión). La ACL del esquema es `{postgres=UC/postgres, daubert_hub_test_user=U/postgres}`; los demás seis roles revisados no tienen acceso. Es un falso positivo de la prueba, que debe excluir a los miembros de `pg_read_all_data` en una revisión futura del script (cambiaría su hash). Nota: `pg_read_all_data` no omite RLS; un `pg_dump` de `daubert_hub_test` con `daubert_backup` fallaría en lugar de omitir filas (hoy los respaldos programados son de `daubert_global`).

**Activación en TEST (misma fecha):** `ManufacturingDocumentsModule` registrado en `AppModule` con `TestOnlyGuard` (404 salvo que la base configurada sea `daubert_hub_test`); panel encendido solo con `VITE_MANUFACTURING_DOCUMENTS=true` en `apps/web/.env.local` (ignorado por Git); las pruebas web fijan el flag en `false` para no depender de ese archivo.
