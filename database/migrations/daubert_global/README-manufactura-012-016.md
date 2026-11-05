# Manufactura en PRODUCCIÓN · migraciones 012–016 (PREPARADAS, NO APLICADAS)

**Estado: PROPUESTA validada en una réplica desechable con la estructura real de PROD. NO aplicadas a `daubert_global`.** Requieren autorización expresa, respaldo nuevo con restauración probada y el rol administrativo (`psql -W` interactivo; nunca `daubert_hub_app`). Crean **solo** el esquema `manufactura` (vacío): no copian clientes, firmas, usuarios, abreviaturas ni documentos de TEST.

## 1. Qué son y cómo se generaron
| PROD | Origen (TEST, sin modificar) | Contenido |
|---|---|---|
| `20261108_012_manufactura_gestor_documental_prod` | 101 | esquema, documentos, revisiones, PDF, confirmaciones, RLS, triggers de inmutabilidad, auditoría redactora |
| `20261108_013_manufactura_responsables_firmas_prod` | 102 | firmas (imagen), autorizaciones de uso, responsables |
| `20261108_014_manufactura_inventario_firmas_admin_prod` | 103 | inventario administrativo de firmas (solo descripción, sin imágenes) |
| `20261108_015_manufactura_cliente_abreviaturas_prod` | 104 | catálogo de abreviaturas de cliente (vacío) y motor de sugerencias |
| `20261108_016_manufactura_consulta_compartida_borradores_prod` | 105 | consulta compartida de borradores (solo lectura) |

Los archivos PROD los produce `tools/generar-manufactura-prod.cjs` con sustituciones **explícitas y contadas** (si una no ocurre el número esperado de veces, falla). El diff contra TEST es la revisión: base `daubert_global`, rol `daubert_hub_app`, **`entorno_emision = 'PRODUCCION'`** (valor por defecto, CHECK y trigger), textos «TEST/PRUEBA», guarda inversa del precheck (aborta en `daubert_hub_test`), lista de roles que no deben tener acceso (en PROD el «otro» rol es `daubert_hub_test_user`), conteos del postcheck 012 (`>=` en lugar de `=`: con la aplicación en línea pueden aparecer filas de inicio de sesión/auditoría; la migración no escribe ninguna) y **frases de confirmación de DOWN explícitas de producción**. Los `smoke` de TEST se generan solo en `replica_only/` (escriben, aunque dentro de un ROLLBACK, y necesitan usuarios sintéticos): **se niegan a correr si no existe el esquema `replica_desechable`**.

## 2. Verificaciones incluidas
- **precheck / postcheck por migración** (los de TEST, adaptados): dependencias (`security.users`, `core.empresas`, `core.empresa_roles`, `audit.cambios`), rol de la aplicación sin atributos peligrosos, objetos esperados, privilegios y RLS.
- **`20261108_000_…_verificar_fuera_de_manufactura.readonly.sql`** (solo lectura; captura y comparación): huella de **todo lo que no es Manufactura** — relaciones con dueño/ACL/RLS, columnas, ACL de columnas, restricciones, índices, funciones (cuerpo, dueño, SECURITY DEFINER, config, ACL), triggers, políticas, esquemas, roles (atributos, membresías, configuración), ACL de bases, privilegios por defecto, extensiones — y, con `-v nivel=12…16`, la **matriz exacta**: `n8n_app`, `n8n_cat_prod`, `n8n_cat_test`, `n8n_app_test`, `daubert_docs_ro`, `daubert_hub_test_user`, `daubert_backup`, PUBLIC y cualquier rol no previsto **no tienen ningún privilegio** (esquema, tablas, columnas, secuencias, funciones); `daubert_hub_app` tiene exactamente `INSERT/SELECT` (y `UPDATE` en `revisiones`; `UPDATE` solo en columnas concretas de firmas, autorizaciones y abreviaturas; `DELETE` solo en `revision_responsables`), sin `TRUNCATE`/`REFERENCES`/`TRIGGER`, sin privilegios sobre secuencias, sin DDL, sin ser dueño, y `EXECUTE` solo en las 13 funciones previstas.
- **`20261108_000_…_smoke_solo_lectura.readonly.sql`** (el que sí se ejecuta en PROD): con `SET LOCAL ROLE` comprueba que `daubert_hub_app` lee las 9 tablas y que `n8n_app`, `n8n_cat_prod`, `daubert_docs_ro` y `daubert_hub_test_user` reciben «permission denied» en tablas y funciones. No escribe nada, ni siquiera dentro de una transacción revertida.

## 3. Resultado de la validación (réplica desechable con la estructura real de PROD)
`node database/migrations/daubert_global/tools/validar-manufactura-012-016-en-replica-prod.cjs --dump <pg_dump -F c de daubert_global> --estructura-prod <estructura_PROD.txt>` → **78 PASS / 0 FAIL**:
- réplica = `pg_restore --schema-only` de un respaldo REAL de `daubert_global` + roles reales; las 4 dependencias de Manufactura **idénticas** al inventario real del 2026-11-05;
- por cada migración: precheck ✔, UP ✔, postcheck ✔, verificación transversal ✔ (19 comprobaciones) y **smoke con escrituras como `daubert_hub_app`** ✔ (55 + 12 + 11 + 19 + 15 pruebas: RLS, triggers, inmutabilidad, permisos, firmas, autorizaciones, abreviaturas, consulta compartida);
- **detección:** el control FALLA si `n8n_app` recibe SELECT en `manufactura`, si PUBLIC lo recibe, si `daubert_hub_app` recibe DELETE o si cambia un privilegio fuera de `manufactura`; pasa de nuevo al revertir;
- negativas: precheck/UP/DOWN en otra base abortan; UP repetido y UP con `daubert_hub_app` abortan;
- DOWN 016→012 deja el catálogo **idéntico a la línea base**; reaplicar 012–016 vuelve a pasar; el DOWN 012 con datos **aborta** sin las confirmaciones de producción.
- Limitación de la réplica: el respaldo disponible es del **2026-10-26**; PROD tiene desde entonces objetos nuevos de Caterpillar/Notificaciones de Pago (93 objetos) que Manufactura no usa. **Antes de aplicar, repetir la validación con un `pg_dump --schema-only` reciente** (ver §5.1).

## 4. Reversión (DOWN) y sus límites
| Migración | DOWN | Límite |
|---|---|---|
| 016 | restaura las 3 políticas de lectura a la redacción de la 012 | no toca datos; seguro siempre |
| 015 | elimina `cliente_abreviaturas` y funciones | con filas exige `-v confirmar_borrado=SI_BORRAR_ABREVIATURAS_DE_PRODUCCION` y respaldo previo |
| 014 | elimina la función de inventario | sin datos que perder |
| 013 | elimina firmas, autorizaciones y responsables | con filas exige `SI_BORRAR_FIRMAS_Y_RESPONSABLES_DE_PRODUCCION`; las revisiones FINALIZADAS que usaron firmas **pierden esa constancia** |
| 012 | elimina el esquema documental | con documentos exige `SI_BORRAR_DATOS_DE_PRODUCCION_CON_RESPALDO_VERIFICADO` y, con revisiones FINALIZADAS o PDF, además `SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS_DE_PRODUCCION` |
**Una vez que existan documentos reales, el DOWN deja de ser una reversión y pasa a ser una pérdida de datos**: se trata como corrección hacia adelante o restauración del respaldo en un entorno aislado. Antes de ese momento (esquema vacío) el DOWN es seguro y se comprobó que devuelve el catálogo a la línea base exacta.

## 5. Procedimiento de ejecución manual (PowerShell; `psql` en `C:\Program Files\PostgreSQL\18\bin`)
Ejecute **todo** con el mismo rol (`postgres`, `-W`) desde `…\database\migrations\daubert_global`. Anote cada salida en una carpeta de la ventana.

### 5.1 Antes de la ventana (sin cambios en PROD)
1. **Autorización** escrita de las decisiones D1–D6 de `docs/hub/manufactura-produccion-diagnostico.md` y de la ventana.
2. **Hashes:** compare `Get-FileHash -Algorithm SHA256 *.sql` con la tabla de §6 (los hashes son del contenido en git con saltos de línea LF; si su copia tiene CRLF use `git show <commit>:<ruta> | sha256sum`).
3. **Inventario fresco** (solo lectura): `inventario_manufactura.readonly.sql` y `estructura_items.readonly.sql` de `database/maintenance/daubert_global` en PROD; compárelos con los analizados (misma `H_DEPENDENCIAS`, mismos roles).
4. **Esquema reciente para la réplica:** `pg_dump -h localhost -p 5432 -U postgres -W -d daubert_global --schema-only -F c -f daubert_global_schema_AAAAMMDD.dump` (solo lectura) y **repetir** `validar-manufactura-012-016-en-replica-prod.cjs --dump <ese archivo>`: debe dar `0 FAIL`.
5. **Respaldo completo:** `pg_dump -h localhost -p 5432 -U postgres -W -d daubert_global -F c -f daubert_global_antes_manufactura_AAAAMMDD_HHMM.dump`; `pg_restore -l <archivo>`; `Get-FileHash` del archivo.
6. **Restauración probada en un entorno aislado** (contenedor `postgres:18-alpine` o servidor distinto; **nunca** sobre `daubert_global`): `pg_restore --no-owner -d <base_aislada>`; compare conteos de `security.users`, `core.empresas`, `ops.ejecuciones_automatizacion`, `operacion.remisiones` y `audit.cambios` con los de PROD. **Si la restauración falla o los conteos no coinciden, NO continúe.**
7. **Ventana tranquila:** confirme que no hay ejecuciones en curso de Caterpillar/Audi/Pagos (consulta de solo lectura sobre `ops.ejecuciones_automatizacion` en estado no terminal) y avise a los usuarios. No se detiene ni reinicia ningún servicio.

### 5.2 Línea base (solo lectura)
```
psql -h localhost -p 5432 -d daubert_global -U postgres -W -X -v ON_ERROR_STOP=1 -f 20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql > linea_base.txt
```
La salida incluye `comando_comparacion` (con las 14 huellas): úselo después de cada migración añadiendo `-v nivel=12` … `-v nivel=16`.

### 5.3 Para cada migración N = 012, 013, 014, 015, 016 (en orden)
```
psql … -f 20261108_NNN_….precheck.sql > NNN_precheck.txt          # esperado: todo en t; anote la huella/línea base que imprime
psql … -v ON_ERROR_STOP=1 -f 20261108_NNN_….up.sql > NNN_up.txt    # esperado: UP_OK … COMMIT
psql … -v <huella o baseline_*=…> -f 20261108_NNN_….postcheck.sql  # 012: -v baseline_users=… (11 valores del precheck); 013: -v huella_101=…; 014/015: -v huella_manufactura=…; 016: -v huella_resto=…
psql … <comando_comparacion> -v nivel=NN                           # all_checks_pass = t
```
Cada UP es **una transacción** con `lock_timeout = 10 s`: si falla, no queda nada aplicado.

### 5.4 Cierre
```
psql … -f 20261108_000_manufactura_prod_smoke_solo_lectura.readonly.sql     # smoke_all_pass = t
psql … <comando_comparacion> -v nivel=16                                     # all_checks_pass = t
```
Guarde todas las salidas junto con los hashes del respaldo. **La API y la web NO forman parte de este procedimiento** (ver §7 del diagnóstico): las migraciones son aditivas y pueden aplicarse antes del despliegue sin afectar al código actual.

### 5.5 Criterios para DETENER
Interrumpa y no continúe si: (a) algún precheck tiene un `f`; (b) un UP falla (queda sin cambios; investigue); (c) un postcheck o la verificación transversal tiene un `f`, en especial `*_igual` (cambió algo fuera de Manufactura) o la matriz de privilegios; (d) espera de bloqueo > 10 s (otra sesión sostiene un bloqueo); (e) aparecen errores nuevos en Caterpillar/Audi/Pagos o en el Hub; (f) cualquier resultado distinto del esperado en la réplica. **Reversión:** solo mientras el esquema esté vacío, DOWN en orden inverso 016→012 y verificar que la comparación vuelve a pasar; si hubo datos, consulte §4.

## 6. SHA-256 de los archivos (contenido en git)
```
3f97ad8e868c75cd5d4b0fc19073fc1b1f2c3e715fc1e860b6e9b7fb093ef6ff  20261108_000_manufactura_prod_smoke_solo_lectura.readonly.sql
64ab05907eeb3c4c9dea425e95c2fb3b5d08540923632de0f4516ad57fcec279  20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql
cdda9287d79a3e40c8d6bc5527524ea1bca6287900f3c3fb5d37088b03b0c328  20261108_012_manufactura_gestor_documental_prod.down.sql
75b187c750f6c9221854721cebf7dc28f7253acb4816d2bc85e6ae14c07543b9  20261108_012_manufactura_gestor_documental_prod.postcheck.sql
46e056a33312876f3daa3c36835b64fb65f869d669871f18a7bcdad469798064  20261108_012_manufactura_gestor_documental_prod.precheck.sql
ea9532b40693cfb01cee847386ebedaf0172dfae5325060514a939ded1314211  20261108_012_manufactura_gestor_documental_prod.up.sql
2d31c9e9219cf4c3002af70c94b4b9d8a469e4dd5215a1e436592c5b306f8135  20261108_013_manufactura_responsables_firmas_prod.down.sql
0f3be1356009c08dc7b59922ce3fb0942328980dbba70732e56f79aa0c3e4329  20261108_013_manufactura_responsables_firmas_prod.postcheck.sql
cf8fba85c480c02df10e855308e756e3e612b5b1164dd9cfa21e404a67de7c9b  20261108_013_manufactura_responsables_firmas_prod.precheck.sql
82e00abff6fa69bac1763026f60c29d8e8f7b690bc673df10d781d6c9f82a5c6  20261108_013_manufactura_responsables_firmas_prod.up.sql
a3f91b1873becdfcba3bf13c3dd843058ea79c90a925a1f41153e611019728af  20261108_014_manufactura_inventario_firmas_admin_prod.down.sql
855c05ca6e3d01cb68b8af6da3d6ddb9957ae77667c44b940af0cbf6cd466720  20261108_014_manufactura_inventario_firmas_admin_prod.postcheck.sql
2d2f24108a1deb81aca40f8cf44e6f43fc052aeff6e8d68fe9525c0e55abd06f  20261108_014_manufactura_inventario_firmas_admin_prod.precheck.sql
4a11592ae3ec7f9a60885893c2804446cb597ac8edff10c0e8ffe6eecf6eaed2  20261108_014_manufactura_inventario_firmas_admin_prod.up.sql
e35d442961a19a24856e78618ab63af6c65374251bb3fb6a4573aa136048fc67  20261108_015_manufactura_cliente_abreviaturas_prod.down.sql
69419d481a0ac70e2a7d629ec8dbdbc625928343ac65222a2ed3d85694f23c8a  20261108_015_manufactura_cliente_abreviaturas_prod.postcheck.sql
3f7090570c5624530a8ae61d878565c6695e1e5f1ffa19d8b3295e1e860c0019  20261108_015_manufactura_cliente_abreviaturas_prod.precheck.sql
6f3d5e9add991c2785548d55cd4ced1347d408bb3f4cb46351a824180b1416c3  20261108_015_manufactura_cliente_abreviaturas_prod.up.sql
e86bb4043687fc01cf67545e1c818d7020327ce45427e64c2cd144ec1a5af40d  20261108_016_manufactura_consulta_compartida_borradores_prod.down.sql
d136a93d5637b0d8868cd4d2ab0e2afcf50485f661b2ff5319e75d64becbe8b4  20261108_016_manufactura_consulta_compartida_borradores_prod.postcheck.sql
65f2418111bebd085f9b1d680b64c50ffd97df6ebb8072820635cef1a17cddec  20261108_016_manufactura_consulta_compartida_borradores_prod.precheck.sql
65ae310252da3ed222766b94b55dab4f6a398321aee0ce6540a62b8f872fcaeb  20261108_016_manufactura_consulta_compartida_borradores_prod.up.sql
a4c5dcf492720b8880a5cde7f942ad62d174233b72db5b2be3685ed73ce09351  replica_only/20261108_012_manufactura_gestor_documental_prod.smoke_replica.sql
873d1386549429b9484cfd52af95a90a8b93a09f08c7e3e4b0b7f1915c7249de  replica_only/20261108_013_manufactura_responsables_firmas_prod.smoke_replica.sql
9e918bd784dee790ab73780b623a65e9bd55ee30958644dfb8b74d65f5ae5925  replica_only/20261108_014_manufactura_inventario_firmas_admin_prod.smoke_replica.sql
87938c40e44003b38e831df7a2e7c75a41847438ebe04f639f71d1ef6d22481a  replica_only/20261108_015_manufactura_cliente_abreviaturas_prod.smoke_replica.sql
dc96a79762d78fbf5269fb8bc7f1e23eddfdebe1adf0f6635aa42bf116850ff5  replica_only/20261108_016_manufactura_consulta_compartida_borradores_prod.smoke_replica.sql
```
