# Migración TEST · `manufactura` (gestor documental de Hojas de Instrucción) — revisión 3

**Estado: ENTREGADA, NO APLICADA.** Solo para `daubert_hub_test`. Requiere autorización expresa del responsable y un operador con el rol administrativo (`postgres`). La aplicación (`daubert_hub_test_user`) **no** recibe permisos DDL. Informe de aprobación: `docs/manufacturing-document-manager-migration-approval.md`.

| Archivo | Rol |
|---|---|
| `…101_manufactura_gestor_documental_test.precheck.sql` | Solo lectura (`READ ONLY` + `ROLLBACK`). Verifica base, rol administrativo, rol de la app sin privilegios (ni `BYPASSRLS`), dependencias (incluido que la app lea `security.users`, `core.empresas` y `core.empresa_roles` sin RLS, y las 11 columnas que usa el gestor) y que el delta no exista; imprime la **línea base**. |
| `….up.sql` | Transaccional. Crea el esquema `manufactura`: 5 tablas, 15 funciones, 11 triggers de integridad, 4 de auditoría (función redactora), RLS (11 políticas) y privilegios mínimos. Se revierte entero si algo falla. |
| `….postcheck.sql` | Solo lectura. Compara contra la línea base AMPLIADA (tablas, funciones, columnas, triggers, privilegios y dueños, roles, ACL de bases y esquemas: nada fuera de `manufactura` cambió) y verifica objetos, triggers, RLS, dueños y la matriz exacta de privilegios. |
| `….down.sql` | Elimina solo `manufactura`. **Idempotente.** Con datos exige `confirmar_borrado`; con revisiones FINALIZADAS o PDF exige además `confirmar_finalizadas`. Imprime lo que se perdería. |
| `….smoke.sql` | **Opcional.** Con el rol de la app, en una transacción que termina en `ROLLBACK`: 55 pruebas con tres identidades (1 ADMIN + 2 GENERAL): actor desde la sesión, RLS, revisor, huella, finalización, inmutabilidad, nombre de PDF, validación estructural, auditoría redactora, sin DDL/DELETE. **Comprueba por sí mismo que no deja residuos** (auditoría y tablas) tras el `ROLLBACK`. |
| `inventario_connect.readonly.sql` | **Solo lectura.** Inventario de permisos `CONNECT` (ACL de bases, quién entra por `PUBLIC`, conexiones, `pg_hba`). No cambia nada. |
| `tools/validar-en-instancia-desechable.cjs` | Reproduce la validación completa en un PostgreSQL 18 **desechable** (contenedor temporal en `127.0.0.1:55433`; nunca TEST/PROD): 42 comprobaciones, incluidas negativas, concurrencia, recuperación, reversibilidad completa, ensayo de restauración del respaldo y crecimiento. |

(La numeración `101` es provisional: el operador puede renumerarla según su serie de migraciones TEST, que vive fuera del repositorio.)

## Alcance preciso de las escrituras
Solo se **crean** objetos nuevos en el esquema nuevo `manufactura` y se **conceden** a `daubert_hub_test_user` estos privilegios de datos:

| Tabla | Privilegios de la app |
|---|---|
| `manufactura.documentos` | `SELECT, INSERT` |
| `manufactura.revisiones` | `SELECT, INSERT, UPDATE` (el UPDATE solo es efectivo sobre borradores del creador/ADMIN: trigger + RLS) |
| `manufactura.pdfs`, `pdf_contenidos`, `confirmaciones_revision` | `SELECT, INSERT` |
| esquema `manufactura` | `USAGE` (sin `CREATE`); `EXECUTE` de 7 funciones auxiliares (`fn_actor`, `fn_actor_id`, `fn_actor_es_admin`, `fn_hash_revision`, `fn_nombre_pdf`, `fn_especificacion_valida`, `fn_claves_validas`; los CHECK se evalúan con los privilegios de quien escribe) |

No se modifica ninguna tabla, función, columna, trigger, rol, permiso ni ACL existente (el postcheck lo demuestra con 11 huellas); no se lee ni escribe ningún dato de negocio; no se toca `daubert_global`, n8n ni otras bases. Después, cuando la aplicación use las tablas, los triggers de auditoría escribirán en `audit.cambios` (el mecanismo ya existente).

### Efectos fuera del esquema `manufactura` (exhaustivo)
1. **Claves foráneas** hacia `security.users` y `core.empresas`: PostgreSQL añade triggers *internos* de integridad referencial en esas tablas (no aparecen entre los triggers de usuario) y toma un bloqueo breve (`SHARE ROW EXCLUSIVE`, con `lock_timeout` de 10 s) durante el UP.
2. **Efecto funcional (deliberado):** un usuario o una empresa **referenciados** por un documento/revisión **no pueden borrarse** (`ON DELETE RESTRICT`); los no referenciados no se ven afectados. Si esto no es deseable para empresas, debe decidirse antes de aplicar.
3. Los triggers de auditoría de manufactura **escriben en `audit.cambios`** (solo cuando se usan las tablas).
Nada más: ni datos, ni columnas, ni privilegios, ni roles, ni ACL de bases (incluido `CONNECT`).

## Procedimiento (operador autorizado)
Con el rol administrativo y **siempre** contra `daubert_hub_test`. No incluya contraseñas en los comandos: use `~/.pgpass`/`%APPDATA%\postgresql\pgpass.conf` o `PGPASSWORD` en la sesión.
```text
# 0. Verificar la integridad de los scripts: sha256 de cada archivo debe coincidir con el informe de aprobación.
# 1. Respaldo previo VERIFICABLE (referencia: docs/operations/backup-restore.md)
pg_dump -h localhost -p 5432 -U postgres -d daubert_hub_test -F c -f daubert_hub_test_antes_manufactura.dump
pg_restore --list daubert_hub_test_antes_manufactura.dump | head      # debe listar los objetos; si falla, NO continuar
sha256sum daubert_hub_test_antes_manufactura.dump                     # anote la huella junto con la fecha y el tamaño
# (recomendado) ensayo de restauración en una base NUEVA con otro nombre; nunca sobre daubert_hub_test:
#   createdb -h localhost -U postgres ensayo_restauracion && pg_restore -h localhost -U postgres -d ensayo_restauracion --no-owner daubert_hub_test_antes_manufactura.dump
#   y compare la línea base del precheck (sección 2) ejecutando su última consulta en ambas bases; después: dropdb ensayo_restauracion

# 2. Precheck: esperado all_prechecks_pass = t. Anote la línea base (5 valores).
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.precheck.sql

# 3. UP (ventana tranquila; lock_timeout 10 s). Esperado: UP_OK … y COMMIT.
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.up.sql

# 4. Postcheck con la línea base del paso 2. Esperado: todas las columnas en t, incluida all_checks_pass.
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 \
     -v baseline_users=<n> -v baseline_empresas=<n> -v baseline_audit_cambios=<n> \
     -v baseline_tablas_fp=<md5> -v baseline_funciones_fp=<md5> -v baseline_columnas_fp=<md5> -v baseline_triggers_fp=<md5> \
     -v baseline_privilegios_fp=<md5> -v baseline_roles_fp=<md5> -v baseline_acl_bases_fp=<md5> -v baseline_esquemas_acl_fp=<md5> \
     -f 20261030_101_manufactura_gestor_documental_test.postcheck.sql

# 5. (Opcional) Smoke con el rol de la app; termina en ROLLBACK. Esperado: smoke_all_pass = t (55 pruebas; el propio script verifica después del ROLLBACK que no quedaron filas de negocio ni de auditoría — solo huecos en los ids de las secuencias).
psql -h localhost -p 5432 -d daubert_hub_test -U daubert_hub_test_user -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.smoke.sql
```

## Comprobaciones de seguridad incorporadas
- Cada script aborta si `current_database() <> 'daubert_hub_test'` (UP, precheck, postcheck, down y smoke); `daubert_global` nunca puede ser destino. Los scripts imprimen `base_actual` en su primera salida: verifíquelo antes de continuar.
- El UP exige un rol **administrador** y comprueba que el rol de la app existe y **no** es superusuario, ni crea roles/bases, ni tiene `BYPASSRLS`; el postcheck verifica que la app no puede crear objetos, que `PUBLIC` no tiene privilegios sobre ningún objeto o función del esquema y que ningún otro rol (`daubert_hub_app`, n8n, backup, lectura) accede.
- No se reaplica: aborta si el esquema ya existe.

## Recuperación
| Situación | Acción |
|---|---|
| Precheck con algún `false` | No continuar; corregir la causa. No se escribió nada. |
| Falla durante el UP | La transacción se revierte: no queda ningún objeto. Corregir y repetir desde el precheck. |
| Postcheck con diferencias | No usar el módulo. Si las tablas están vacías, ejecutar el DOWN y reaplicar. |
| Retirar el módulo (sin datos) | `….down.sql` sin parámetros (idempotente: reintentable). |
| Retirar con borradores/documentos de prueba | `pg_dump -n manufactura -F c -f manufactura_antes_del_down.dump` y luego `-v confirmar_borrado=SI_BORRAR_DATOS_DE_PRUEBA`. |
| Retirar con revisiones FINALIZADAS o PDF | Lo anterior **más** `-v confirmar_finalizadas=SI_BORRAR_REVISIONES_Y_PDF_FINALIZADOS`. El historial de `audit.cambios` se conserva. |
| Revisiones FINALIZADAS con uso real | No hacer rollback: corrección hacia adelante con una nueva migración. |
| Restaurar todo | **No sobre `daubert_hub_test` directamente.** Restaure el respaldo en una base nueva (`ensayo_restauracion`), compare la línea base y solo entonces decida con el responsable cómo reemplazar (renombrar bases o `pg_restore --clean` con ventana y autorización). El arnés lo ensaya en la instancia desechable. |
| Una finalización quedó en `FINALIZANDO` | La reclama el creador o un ADMIN pasados 10 minutos (la API lo ofrece); mientras tanto el contenido está congelado. |

## Validación realizada (sin tocar TEST)
Solo en instancias PostgreSQL 18 desechables (contenedores temporales, ya eliminados), con una réplica mínima de `security.users`, `core.empresas` y de `audit.cambios` + la definición real de `audit.fn_registrar_cambio`. **No se ejecutó nada contra `daubert_hub_test` ni `daubert_global`.** Resultado de `tools/validar-en-instancia-desechable.cjs`: 42/42 (respaldo previo, precheck con línea base ampliada, UP, postcheck, smoke con 55 pruebas y sin residuos, negativas en otra base y con rol no administrador, UP/DOWN repetidos, DOWN con datos y doble confirmación, ciclo UP→DOWN→UP, doble finalización, doble borrador, carrera por el mismo PDF, reclamo de FINALIZANDO abandonada, cancelación idempotente, revisor inactivo, variantes simultáneas, RLS, crecimiento y respaldo).


---

# Migración 102 · Responsables y firmas (adicional a la 101)

**Estado: ENTREGADA, NO APLICADA a `daubert_hub_test`.** Solo TEST. Requiere autorización expresa y el rol administrativo. Archivos: `20261103_102_manufactura_responsables_firmas_test.{precheck,up,postcheck,smoke,down}.sql`.

Crea 3 tablas **nuevas** en el esquema `manufactura` (no modifica ninguna existente): `firmas` (catálogo de imágenes JPG/PNG ya procesadas por la API; propietaria, quién subió y quién incorporó; contenido inmutable; nunca se borra), `firma_autorizaciones` (permiso de **uso** de una imagen, no una aprobación documental) y `revision_responsables` (hasta 3 por revisión: posición, función, nombre impreso, referencia y huella de la imagen; congelados fuera de BORRADOR). 8 funciones, 11 triggers (3 de auditoría redactora que no copian el contenido de la imagen), 10 políticas RLS y privilegios mínimos (sin DDL ni TRUNCATE; `DELETE` solo en `revision_responsables`, donde el trigger exige BORRADOR).

Reglas en la base: el nombre de la propietaria sale de su cuenta; solo un ADMIN incorpora firmas de otra persona o de personas sin cuenta (queda como custodio); una imagen solo se asigna si el usuario es su propietario o tiene autorización vigente y está ACTIVA; con imagen, el nombre impreso es el de su propietaria; una firma retirada conserva sus referencias.

Procedimiento: igual que la 101 (respaldo, precheck con **huella_101**, UP, postcheck con `-v huella_101=…`, smoke con el rol de la app, DOWN idempotente con confirmación si hay datos). Validado completo en una instancia desechable con `tools/validar-102-en-instancia-desechable.cjs` (precheck → UP → postcheck → smoke 12/12 → DOWN → DOWN idempotente → UP → postcheck).
