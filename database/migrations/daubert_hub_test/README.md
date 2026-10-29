# Migración TEST · `manufactura` (gestor documental de Hojas de Instrucción) — revisión 2

**Estado: ENTREGADA, NO APLICADA.** Solo para `daubert_hub_test`. Requiere autorización expresa del responsable y un operador con el rol administrativo (`postgres`). La aplicación (`daubert_hub_test_user`) **no** recibe permisos DDL. Informe de aprobación: `docs/manufacturing-document-manager-migration-approval.md`.

| Archivo | Rol |
|---|---|
| `…101_manufactura_gestor_documental_test.precheck.sql` | Solo lectura (`READ ONLY` + `ROLLBACK`). Verifica base, rol administrativo, rol de la app sin privilegios (ni `BYPASSRLS`), dependencias y que el delta no exista; imprime la **línea base**. |
| `….up.sql` | Transaccional. Crea el esquema `manufactura`: 5 tablas, 12 funciones, 11 triggers de integridad, 4 de auditoría, RLS (11 políticas) y privilegios mínimos. Se revierte entero si algo falla. |
| `….postcheck.sql` | Solo lectura. Compara contra la línea base (nada más cambió) y verifica objetos, triggers, RLS, dueños y la matriz exacta de privilegios. |
| `….down.sql` | Elimina solo `manufactura`. **Idempotente.** Con datos exige `confirmar_borrado`; con revisiones FINALIZADAS o PDF exige además `confirmar_finalizadas`. Imprime lo que se perdería. |
| `….smoke.sql` | **Opcional.** Con el rol de la app, en una transacción que termina en `ROLLBACK`: 49 pruebas con tres identidades (1 ADMIN + 2 GENERAL): actor desde la sesión, RLS, revisor, huella, finalización, inmutabilidad, nombre de PDF, auditoría, sin DDL/DELETE. |
| `inventario_connect.readonly.sql` | **Solo lectura.** Inventario de permisos `CONNECT` (ACL de bases, quién entra por `PUBLIC`, conexiones, `pg_hba`). No cambia nada. |
| `tools/validar-en-instancia-desechable.cjs` | Reproduce la validación completa en un PostgreSQL 18 **desechable** (contenedor temporal en `127.0.0.1:55433`; nunca TEST/PROD): 36 comprobaciones, incluidas negativas, concurrencia, recuperación y crecimiento. |

(La numeración `101` es provisional: el operador puede renumerarla según su serie de migraciones TEST, que vive fuera del repositorio.)

## Alcance preciso de las escrituras
Solo se **crean** objetos nuevos en el esquema nuevo `manufactura` y se **conceden** a `daubert_hub_test_user` estos privilegios de datos:

| Tabla | Privilegios de la app |
|---|---|
| `manufactura.documentos` | `SELECT, INSERT` |
| `manufactura.revisiones` | `SELECT, INSERT, UPDATE` (el UPDATE solo es efectivo sobre borradores del creador/ADMIN: trigger + RLS) |
| `manufactura.pdfs`, `pdf_contenidos`, `confirmaciones_revision` | `SELECT, INSERT` |
| esquema `manufactura` | `USAGE` (sin `CREATE`); `EXECUTE` de 5 funciones auxiliares (`fn_actor`, `fn_actor_id`, `fn_actor_es_admin`, `fn_hash_revision`, `fn_nombre_pdf`) |

No se modifica ninguna tabla, función, rol ni permiso existente; no se lee ni escribe ningún dato de negocio; no se toca `daubert_global`, n8n ni otras bases. Después, cuando la aplicación use las tablas, los triggers de auditoría escribirán en `audit.cambios` (el mecanismo ya existente).

## Procedimiento (operador autorizado)
Con el rol administrativo y **siempre** contra `daubert_hub_test`. No incluya contraseñas en los comandos: use `~/.pgpass`/`%APPDATA%\postgresql\pgpass.conf` o `PGPASSWORD` en la sesión.
```text
# 0. Verificar la integridad de los scripts: sha256 de cada archivo debe coincidir con el informe de aprobación.
# 1. Respaldo previo confirmado (referencia: docs/operations/backup-restore.md)
pg_dump -h localhost -p 5432 -U postgres -d daubert_hub_test -F c -f daubert_hub_test_antes_manufactura.dump

# 2. Precheck: esperado all_prechecks_pass = t. Anote la línea base (5 valores).
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.precheck.sql

# 3. UP (ventana tranquila; lock_timeout 10 s). Esperado: UP_OK … y COMMIT.
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.up.sql

# 4. Postcheck con la línea base del paso 2. Esperado: todas las columnas en t, incluida all_checks_pass.
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 \
     -v baseline_users=<n> -v baseline_empresas=<n> -v baseline_audit_cambios=<n> \
     -v baseline_tablas_fp=<md5> -v baseline_funciones_fp=<md5> \
     -f 20261030_101_manufactura_gestor_documental_test.postcheck.sql

# 5. (Opcional) Smoke con el rol de la app; termina en ROLLBACK. Esperado: smoke_all_pass = t (49 pruebas).
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
| Restaurar todo | `pg_restore` del respaldo del paso 1 (flujo estándar de recuperación). |
| Una finalización quedó en `FINALIZANDO` | La reclama el creador o un ADMIN pasados 10 minutos (la API lo ofrece); mientras tanto el contenido está congelado. |

## Validación realizada (sin tocar TEST)
Solo en instancias PostgreSQL 18 desechables (contenedores temporales, ya eliminados), con una réplica mínima de `security.users`, `core.empresas` y de `audit.cambios` + la definición real de `audit.fn_registrar_cambio`. **No se ejecutó nada contra `daubert_hub_test` ni `daubert_global`.** Resultado de `tools/validar-en-instancia-desechable.cjs`: 36/36 (precheck, UP, postcheck con 33 comprobaciones, smoke con 49 pruebas, negativas en otra base y con rol no administrador, UP/DOWN repetidos, DOWN con datos y doble confirmación, ciclo UP→DOWN→UP, doble finalización, doble borrador, carrera por el mismo PDF, reclamo de FINALIZANDO abandonada, cancelación idempotente, revisor inactivo, variantes simultáneas, RLS, crecimiento y respaldo).
