# Manufactura en PRODUCCIÓN · migraciones 020–024 (PREPARADAS, NO APLICADAS)

**Estado: PROPUESTA validada (dos veces) en una réplica desechable con la estructura real de PROD. NO aplicadas a `daubert_global`.** Requieren autorización expresa, respaldo nuevo con restauración probada y el rol administrativo (`psql -W` interactivo; nunca `daubert_hub_app`). Crean **solo** el esquema `manufactura` (vacío): no copian clientes, firmas, usuarios, abreviaturas ni documentos de TEST.

## 1. Qué son y cómo se generaron
| PROD | Origen (TEST, sin modificar) | Contenido |
|---|---|---|
| `20261108_020_manufactura_gestor_documental_prod` | 101 | esquema, documentos, revisiones, PDF, confirmaciones, RLS, triggers de inmutabilidad, auditoría redactora |
| `20261108_021_manufactura_responsables_firmas_prod` | 102 | firmas (imagen), autorizaciones de uso, responsables |
| `20261108_022_manufactura_inventario_firmas_admin_prod` | 103 | inventario administrativo de firmas (solo descripción, sin imágenes) |
| `20261108_023_manufactura_cliente_abreviaturas_prod` | 104 | catálogo de abreviaturas de cliente (vacío) y motor de sugerencias |
| `20261108_024_manufactura_consulta_compartida_borradores_prod` | 105 | consulta compartida de borradores (solo lectura) |

Los archivos PROD los produce `tools/generar-manufactura-prod.cjs` con sustituciones **explícitas y contadas** (si una no ocurre el número esperado de veces, falla). El diff contra TEST es la revisión: base `daubert_global`, rol `daubert_hub_app`, **`entorno_emision = 'PRODUCCION'`** (valor por defecto, CHECK y trigger), textos «TEST/PRUEBA», guarda inversa del precheck (aborta en `daubert_hub_test`), lista de roles que no deben tener acceso (en PROD el «otro» rol es `daubert_hub_test_user`), conteos del postcheck 020 (`>=` en lugar de `=`: con la aplicación en línea pueden aparecer filas de inicio de sesión/auditoría; la migración no escribe ninguna) y **frases de confirmación de DOWN explícitas de producción**. Los `smoke` de TEST se generan solo en `replica_only/` (escriben, aunque dentro de un ROLLBACK, y necesitan usuarios sintéticos): **se niegan a correr si no existe el esquema `replica_desechable`**.

### 1.1 Numeración (revisada el 2026-11-05 contra el árbol real de migraciones)
La serie `NNN` es **global** a TEST y PROD. En `main` (v1.1.0+) ya existen, para `daubert_global`: 009, 010, 011, 012 (asignación de archivos de pago), 013 (cancelación Caterpillar / resolución de pagos), 014, 015, 016 (admisión atómica Caterpillar / resolución de pagos), 017, 018 y 019 (recuperación de pagos); las más recientes versionadas llegan a la **019**. Por eso los números **012–016 propuestos al inicio chocaban con la serie existente** (los nombres de archivo no coincidían, pero el número sí) y las migraciones de Manufactura quedaron como **020–024**. El inventario de `daubert_global` del 2026-11-05 muestra objetos de varias de ellas (p. ej. recuperaciones de pago y cancelaciones/autorizaciones de regeneración de Caterpillar). **Confirmar con el directorio externo del operador que no existe una 020 o posterior no versionada** antes de aplicar.

## 2. Verificaciones incluidas
- **precheck / postcheck por migración** (los de TEST, adaptados): dependencias (`security.users`, `core.empresas`, `core.empresa_roles`, `audit.cambios`), rol de la aplicación sin atributos peligrosos, objetos esperados, privilegios y RLS.
- **`20261108_000_…_verificar_fuera_de_manufactura.readonly.sql`** (solo lectura; captura y comparación): huella de **todo lo que no es Manufactura** — relaciones con dueño/ACL/RLS, columnas, ACL de columnas, restricciones, índices, funciones (cuerpo, dueño, SECURITY DEFINER, config, ACL), triggers, políticas, esquemas, roles (atributos, membresías, configuración), ACL de bases, privilegios por defecto, extensiones — y, con `-v nivel=20…16`, la **matriz exacta**: `n8n_app`, `n8n_cat_prod`, `n8n_cat_test`, `n8n_app_test`, `daubert_docs_ro`, `daubert_hub_test_user`, `daubert_backup`, PUBLIC y cualquier rol no previsto **no tienen ningún privilegio** (esquema, tablas, columnas, secuencias, funciones); `daubert_hub_app` tiene exactamente `INSERT/SELECT` (y `UPDATE` en `revisiones`; `UPDATE` solo en columnas concretas de firmas, autorizaciones y abreviaturas; `DELETE` solo en `revision_responsables`), sin `TRUNCATE`/`REFERENCES`/`TRIGGER`, sin privilegios sobre secuencias, sin DDL, sin ser dueño, y `EXECUTE` solo en las 13 funciones previstas.
- **`20261108_000_…_smoke_solo_lectura.readonly.sql`** (el que sí se ejecuta en PROD): con `SET LOCAL ROLE` comprueba que `daubert_hub_app` lee las 9 tablas y que `n8n_app`, `n8n_cat_prod`, `daubert_docs_ro` y `daubert_hub_test_user` reciben «permission denied» en tablas y funciones. No escribe nada, ni siquiera dentro de una transacción revertida.

## 3. Resultado de la validación (réplica desechable con la estructura real de PROD)
`node database/migrations/daubert_global/tools/validar-manufactura-020-024-en-replica-prod.cjs --dump <pg_dump -F c de daubert_global> --estructura-prod <estructura_PROD.txt>` → **78 PASS / 0 FAIL**:
- réplica = `pg_restore --schema-only` de un respaldo REAL de `daubert_global` + roles reales; las 4 dependencias de Manufactura **idénticas** al inventario real del 2026-11-05;
- por cada migración: precheck ✔, UP ✔, postcheck ✔, verificación transversal ✔ (19 comprobaciones) y **smoke con escrituras como `daubert_hub_app`** ✔ (55 + 12 + 11 + 19 + 15 pruebas: RLS, triggers, inmutabilidad, permisos, firmas, autorizaciones, abreviaturas, consulta compartida);
- **detección:** el control FALLA si `n8n_app` recibe SELECT en `manufactura`, si PUBLIC lo recibe, si `daubert_hub_app` recibe DELETE o si cambia un privilegio fuera de `manufactura`; pasa de nuevo al revertir;
- negativas: precheck/UP/DOWN en otra base abortan; UP repetido y UP con `daubert_hub_app` abortan;
- DOWN 024→020 deja el catálogo **idéntico a la línea base**; reaplicar 020–024 vuelve a pasar; el DOWN 020 con datos **aborta** sin las confirmaciones de producción.
- Repetida con el respaldo `--schema-only` **del 2026-11-05** (`daubert_global_schema_20261105.dump`, 283 250 bytes, 0 entradas de datos): **78 PASS / 0 FAIL**, idéntico a la corrida con el respaldo del 2026-10-26. La réplica coincide con el inventario real de PROD salvo **un** objeto: `core.resultados_notificacion_pago.chk_resultado_estado`, cuya regla es la misma pero `pg_dump/restore` la serializa distinto (diferencia ya documentada en `docs/database/test-prod-drift.md`; no tiene relación con Manufactura). Los 93 objetos nuevos de Caterpillar/Pagos que faltaban en el respaldo anterior ya están en la réplica y **no alteran ningún resultado**. Antes de aplicar, repetir una vez más con un respaldo de la víspera (§5.1).

## 4. Reversión (DOWN) y sus límites
| Migración | DOWN | Límite |
|---|---|---|
| 024 | restaura las 3 políticas de lectura a la redacción de la 020 | no toca datos; seguro siempre |
| 023 | elimina `cliente_abreviaturas` y funciones | con filas exige `-v confirmar_borrado=SI_BORRAR_ABREVIATURAS_DE_PRODUCCION` y respaldo previo |
| 022 | elimina la función de inventario | sin datos que perder |
| 021 | elimina firmas, autorizaciones y responsables | con filas exige `SI_BORRAR_FIRMAS_Y_RESPONSABLES_DE_PRODUCCION`; las revisiones FINALIZADAS que usaron firmas **pierden esa constancia** |
| 020 | elimina el esquema documental | con documentos exige `SI_BORRAR_DATOS_DE_PRODUCCION_CON_RESPALDO_VERIFICADO` y, con revisiones FINALIZADAS o PDF, además `SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS_DE_PRODUCCION` |
**Una vez que existan documentos reales, el DOWN deja de ser una reversión y pasa a ser una pérdida de datos**: se trata como corrección hacia adelante o restauración del respaldo en un entorno aislado. Antes de ese momento (esquema vacío) el DOWN es seguro y se comprobó que devuelve el catálogo a la línea base exacta.

## 5. Procedimiento de ejecución manual (PowerShell; `psql` en `C:\Program Files\PostgreSQL\18\bin`)
Ejecute **todo** con el mismo rol (`postgres`, `-W`) desde `…\database\migrations\daubert_global`. Anote cada salida en una carpeta de la ventana.

### 5.1 Antes de la ventana (sin cambios en PROD)
1. **Autorización** escrita de las decisiones D1–D6 de `docs/hub/manufactura-produccion-diagnostico.md` y de la ventana.
2. **Hashes:** compare `Get-FileHash -Algorithm SHA256 *.sql` con la tabla de §6 (los hashes son del contenido en git con saltos de línea LF; si su copia tiene CRLF use `git show <commit>:<ruta> | sha256sum`).
3. **Inventario fresco** (solo lectura): `inventario_manufactura.readonly.sql` y `estructura_items.readonly.sql` de `database/maintenance/daubert_global` en PROD; compárelos con los analizados (misma `H_DEPENDENCIAS`, mismos roles).
4. **Esquema reciente para la réplica:** `pg_dump -h localhost -p 5432 -U postgres -W -d daubert_global --schema-only -F c -f daubert_global_schema_AAAAMMDD.dump` (solo lectura) y **repetir** `validar-manufactura-020-024-en-replica-prod.cjs --dump <ese archivo>`: debe dar `0 FAIL`.
5. **Respaldo completo:** `pg_dump -h localhost -p 5432 -U postgres -W -d daubert_global -F c -f daubert_global_antes_manufactura_AAAAMMDD_HHMM.dump`; `pg_restore -l <archivo>`; `Get-FileHash` del archivo.
6. **Restauración probada en un entorno aislado** (contenedor `postgres:18-alpine` o servidor distinto; **nunca** sobre `daubert_global`): `pg_restore --no-owner -d <base_aislada>`; compare conteos de `security.users`, `core.empresas`, `ops.ejecuciones_automatizacion`, `operacion.remisiones` y `audit.cambios` con los de PROD. **Si la restauración falla o los conteos no coinciden, NO continúe.**
7. **Ventana tranquila:** confirme que no hay ejecuciones en curso de Caterpillar/Audi/Pagos (consulta de solo lectura sobre `ops.ejecuciones_automatizacion` en estado no terminal) y avise a los usuarios. No se detiene ni reinicia ningún servicio.

### 5.2 Línea base (solo lectura)
```
psql -h localhost -p 5432 -d daubert_global -U postgres -W -X -v ON_ERROR_STOP=1 -f 20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql > linea_base.txt
```
La salida incluye `comando_comparacion` (con las 14 huellas): úselo después de cada migración añadiendo `-v nivel=20` … `-v nivel=24`.

### 5.3 Para cada migración N = 020, 021, 022, 023, 024 (en orden)
```
psql … -f 20261108_NNN_….precheck.sql > NNN_precheck.txt          # esperado: todo en t; anote la huella/línea base que imprime
psql … -v ON_ERROR_STOP=1 -f 20261108_NNN_….up.sql > NNN_up.txt    # esperado: UP_OK … COMMIT
psql … -v <huella o baseline_*=…> -f 20261108_NNN_….postcheck.sql  # 020: -v baseline_users=… (11 valores del precheck); 021: -v huella_101=…; 022/023: -v huella_manufactura=…; 024: -v huella_resto=…
psql … <comando_comparacion> -v nivel=NN                           # all_checks_pass = t
```
Cada UP es **una transacción** con `lock_timeout = 10 s`: si falla, no queda nada aplicado.

### 5.4 Cierre
```
psql … -f 20261108_000_manufactura_prod_smoke_solo_lectura.readonly.sql     # smoke_all_pass = t
psql … <comando_comparacion> -v nivel=24                                     # all_checks_pass = t
```
Guarde todas las salidas junto con los hashes del respaldo. **La API y la web NO forman parte de este procedimiento** (ver §7 del diagnóstico): las migraciones son aditivas y pueden aplicarse antes del despliegue sin afectar al código actual.

### 5.5 Criterios para DETENER
Interrumpa y no continúe si: (a) algún precheck tiene un `f`; (b) un UP falla (queda sin cambios; investigue); (c) un postcheck o la verificación transversal tiene un `f`, en especial `*_igual` (cambió algo fuera de Manufactura) o la matriz de privilegios; (d) espera de bloqueo > 10 s (otra sesión sostiene un bloqueo); (e) aparecen errores nuevos en Caterpillar/Audi/Pagos o en el Hub; (f) cualquier resultado distinto del esperado en la réplica. **Reversión:** solo mientras el esquema esté vacío, DOWN en orden inverso 024→020 y verificar que la comparación vuelve a pasar; si hubo datos, consulte §4.

## 6. SHA-256 de los archivos (contenido en git)
```
3f97ad8e868c75cd5d4b0fc19073fc1b1f2c3e715fc1e860b6e9b7fb093ef6ff  20261108_000_manufactura_prod_smoke_solo_lectura.readonly.sql
bf30eed3a5bb818edd4915a5f34ef848c77cb2cb937771d7b9d5f9bb5b34cdcd  20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql
ae9aeb0f778148b7b643812d643179fa4f364a4c78c9ff0f0818af64e57441e1  20261108_020_manufactura_gestor_documental_prod.down.sql
e99f28210ad4070b6f004287265a4aef04e663d5867d25456931228ad8837bd8  20261108_020_manufactura_gestor_documental_prod.postcheck.sql
49ddf21a5b21bf99c6abbf288891426fd6ecce77a40fbc94d93f701cf97d379f  20261108_020_manufactura_gestor_documental_prod.precheck.sql
ba37551d036b6c406c21c721e6f236d8bf215453e76d0d052d0d95e81ae4eebd  20261108_020_manufactura_gestor_documental_prod.up.sql
8bf0ae50ec878ba1ccb86c0c448a7732f7a083505abdfb8a17073025f8ff3e31  20261108_021_manufactura_responsables_firmas_prod.down.sql
0440dfb1a3fb31f306c35016f8cde4b928589f47117e6c8a2662848b0358f6c5  20261108_021_manufactura_responsables_firmas_prod.postcheck.sql
9318d023eba7d33011900fdfdd4e844bff05725fa9b9d6d680b4dd0551f641cf  20261108_021_manufactura_responsables_firmas_prod.precheck.sql
fa2efdcdc27644dbf99c58bc0ebd8fecf654b77404782109ddcb9576e6a2d607  20261108_021_manufactura_responsables_firmas_prod.up.sql
c92787eb22c8a6cf6320ae80db0a52349ad501eab8fe209db6c96d43d11aa95a  20261108_022_manufactura_inventario_firmas_admin_prod.down.sql
df34b6293794d1877c69b035d17b41cbd4bcf2c39a9938360d902a7496ddbef1  20261108_022_manufactura_inventario_firmas_admin_prod.postcheck.sql
0e33596940b76c312a9436e11610aefc4f5a3975fa3ffe0c0f8921f28fac9598  20261108_022_manufactura_inventario_firmas_admin_prod.precheck.sql
84a07ab6eaa7b98e2a59d10372432b499bfef548e5045bec735218432b4fe883  20261108_022_manufactura_inventario_firmas_admin_prod.up.sql
da8a0df5f8cea02a2e5814bfc712a40e9e4fc3f70530d6517ff0f03fa1c3fe68  20261108_023_manufactura_cliente_abreviaturas_prod.down.sql
e6cd1367cf119847de452337d6a29fa5a4683d739295288fbcb8dcc6a1a3b31a  20261108_023_manufactura_cliente_abreviaturas_prod.postcheck.sql
2a0e7ee4484215d9637c430eda03cb25daa6a1b5d277a7e870f55f94e7a34978  20261108_023_manufactura_cliente_abreviaturas_prod.precheck.sql
6a7bc4b3630aff07ece282f6e3a690010c334c15d08ce02447de3aaea53ddf20  20261108_023_manufactura_cliente_abreviaturas_prod.up.sql
ee8a9e49f4d970c1d5f95525c1924133b1d65e6b1a421273b331adbc561c7085  20261108_024_manufactura_consulta_compartida_borradores_prod.down.sql
3117f676dca012c72b15f4284d153b2faff4f92f0362b675978216cc1864ff04  20261108_024_manufactura_consulta_compartida_borradores_prod.postcheck.sql
27e282ff24b622f5eb6986dbcb6290c449c8241ccde461eed9a1be39142c6b9c  20261108_024_manufactura_consulta_compartida_borradores_prod.precheck.sql
074a39286453c7447414ae1dda5308b462b0a121507b644a0ddc0fbf275a58b7  20261108_024_manufactura_consulta_compartida_borradores_prod.up.sql
211014e2f8eb7d7e969b4cca08cfc649ed70e766933cd7a65b68c95dc419f873  replica_only/20261108_020_manufactura_gestor_documental_prod.smoke_replica.sql
5c846a17bb72897545020fb41582331cb482e027a04b03a6e84b7ff9178f10bc  replica_only/20261108_021_manufactura_responsables_firmas_prod.smoke_replica.sql
35a9f4606b2c5a12c134c37d8bd583db50b16f187b5040b4134d9a7409194ba0  replica_only/20261108_022_manufactura_inventario_firmas_admin_prod.smoke_replica.sql
01b76a52812e15888b0b8943c0dc89851b54466c6e12b983986e58db2c758cde  replica_only/20261108_023_manufactura_cliente_abreviaturas_prod.smoke_replica.sql
80828d9926fae95db2e77ad34adae98bf870add22d990bdef1c9da15cdacd7fe  replica_only/20261108_024_manufactura_consulta_compartida_borradores_prod.smoke_replica.sql
```

## 7. Rol de respaldos `daubert_backup`: lector autorizado (decisión del 2026-11-09, opción A)
- **Qué se descubrió:** en el clúster real, `daubert_backup` pertenece a `pg_read_all_data` (membresía creada para los respaldos automáticos, `docs/operations/postgresql-backup-automation.md`). Por pertenencia **lee todas las tablas y esquemas, incluido `manufactura`**, sin entradas en las ACL. Los controles originales lo incluían entre los roles «sin acceso» y medían privilegios efectivos, por lo que fallaban (11 FAIL en el ensayo con los 8 roles reales).
- **Decisión:** se conserva la membresía; se acepta **solo** la lectura. No se modificó ningún rol ni membresía, ni se eliminó o debilitó ninguna política RLS; los demás roles siguen sin ningún privilegio.
- **Archivos cambiados (y por qué)** — los UP, DOWN, precheck y smoke de 020–024 **no cambiaron** (sus hashes de §6 siguen idénticos):
  - `20261108_020_…postcheck.sql`: `daubert_backup` sale de `otros_roles_sin_acceso`; nueva comprobación `backup_solo_lectura` (incluida en `all_postchecks_pass`).
  - `20261108_021_…postcheck.sql`: `daubert_backup` sale de `ningun_otro_rol_con_acceso`; nueva `backup_solo_lectura`.
  - `20261108_000_…verificar_fuera_de_manufactura.readonly.sql`: `daubert_backup` sale de `roles_nombrados_sin_acceso`; nueva `backup_solo_lectura_efectivo` (en `all_checks_pass`).
  - Ambos postchecks son **generados**: el cambio vive en `tools/generar-manufactura-prod.cjs` (sustituciones contadas); los postchecks de TEST (101–105) no se tocan. `tools/validar-manufactura-020-024-en-replica-prod.cjs` añade `--roles`, `--con-datos`, `--mantener`, `--evidencia` y las detecciones de `daubert_backup`.
  - Hashes (§6) actualizados: los tres archivos de arriba.
- **Qué verifica `backup_solo_lectura` (privilegios EFECTIVOS, mismo criterio que el postcheck 013 de Caterpillar):** login sin SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/**BYPASSRLS**; única membresía heredada `pg_read_all_data` (ni `pg_write_all_data` ni otro rol: MEMBER/USAGE/SET); USAGE sin CREATE en el esquema; SELECT en todas las tablas y **ningún** INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (tabla ni columna); sin USAGE/UPDATE en secuencias; sin EXECUTE en funciones invocables (las de TRIGGER conservan el EXECUTE por omisión de PUBLIC y no se pueden invocar); **sin ninguna entrada ACL explícita** en tablas o esquema (el acceso es solo por la membresía). Si el rol no existe, no hay nada que evaluar.
- **Datos sensibles:** el rol de respaldos puede leer documentos, PDF y las **imágenes de firmas** de Manufactura. Sus credenciales (`pgpass`, gestor de secretos) y los archivos de respaldo (cifrados con age en los respaldos automáticos) deben protegerse igual que `daubert_global`.
- **Limitación conocida (RLS):** `pg_read_all_data` **no** salta RLS y `daubert_backup` no tiene BYPASSRLS (la política del proyecto lo trata como desviación, ver postcheck 013). Las políticas de `manufactura` son `TO daubert_hub_app`, así que `pg_dump` como `daubert_backup` **falla** con «query would be affected by row-level security policy» en cuanto existe `manufactura`. Ver `docs/hub/manufactura-ensayo-6b-resultados.md`: es un bloqueante previo a producción para los respaldos automáticos.
