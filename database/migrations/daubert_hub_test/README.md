# Migración TEST · `manufactura` (gestor documental de Hojas de Instrucción)

**Estado: ENTREGADA, NO APLICADA.** Solo para `daubert_hub_test`. Requiere autorización expresa del responsable y un operador con el rol administrativo (`postgres`). La aplicación (`daubert_hub_test_user`) **no** recibe permisos DDL.

| Archivo | Rol |
|---|---|
| `20261030_101_manufactura_gestor_documental_test.precheck.sql` | Solo lectura (`READ ONLY` + `ROLLBACK`). Verifica base, rol administrativo, rol de la app sin privilegios, dependencias y que el delta no exista; imprime la **línea base**. |
| `….up.sql` | Transaccional. Crea el esquema `manufactura`, 5 tablas, 9 funciones, 11 triggers de integridad, 4 de auditoría y los privilegios mínimos. Se revierte entero si algo falla. |
| `….postcheck.sql` | Solo lectura. Compara contra la línea base (nada más cambió), verifica objetos, triggers y la matriz exacta de privilegios. |
| `….down.sql` | Elimina solo `manufactura`. Se niega si hay datos salvo confirmación explícita. |
| `….smoke.sql` | **Opcional.** Con el rol de la app, dentro de una transacción que termina en `ROLLBACK`: 29 pruebas de integridad (actor desde la sesión, inmutabilidad, PDF íntegro, numeración, auditoría, sin DDL/DELETE). |

(La numeración `101` es provisional: el operador puede renumerarla según su serie de migraciones TEST, que vive fuera del repositorio.)

## Alcance preciso de las escrituras
Solo se **crean** objetos nuevos en el esquema nuevo `manufactura` y se **conceden** a `daubert_hub_test_user` estos privilegios de datos:

| Tabla | Privilegios de la app |
|---|---|
| `manufactura.documentos` | `SELECT, INSERT` |
| `manufactura.revisiones` | `SELECT, INSERT, UPDATE` (el UPDATE solo es efectivo sobre borradores: lo limita un trigger) |
| `manufactura.pdfs`, `pdf_contenidos`, `confirmaciones_revision` | `SELECT, INSERT` |
| esquema `manufactura` | `USAGE` (sin `CREATE`); `EXECUTE` de `fn_actor` y `fn_hash_json` |

No se modifica ninguna tabla, función, rol ni permiso existente; no se lee ni escribe ningún dato de negocio; no se toca `daubert_global`, n8n ni otras bases. Después, cuando la aplicación use las tablas, los triggers de auditoría escribirán en `audit.cambios` (el mecanismo ya existente).

## Procedimiento (operador autorizado)
Todos los comandos con el rol administrativo y **siempre** contra `daubert_hub_test`:
```text
# 0. Respaldo previo confirmado (referencia: docs/operations/backup-restore.md)
pg_dump -h localhost -p 5432 -U postgres -d daubert_hub_test -F c -f daubert_hub_test_antes_manufactura.dump

# 1. Precheck: esperado all_prechecks_pass = t. Anote la línea base (5 valores).
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.precheck.sql

# 2. UP (ventana tranquila; lock_timeout 10 s). Esperado: UP_OK … y COMMIT.
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.up.sql

# 3. Postcheck con la línea base del paso 1. Esperado: todas las columnas en t y all_checks_pass = t.
psql -h localhost -p 5432 -d daubert_hub_test -U postgres -X -w -v ON_ERROR_STOP=1 \
     -v baseline_users=<n> -v baseline_empresas=<n> -v baseline_audit_cambios=<n> \
     -v baseline_tablas_fp=<md5> -v baseline_funciones_fp=<md5> \
     -f 20261030_101_manufactura_gestor_documental_test.postcheck.sql

# 4. (Opcional) Smoke con el rol de la app; termina en ROLLBACK. Esperado: smoke_all_pass = t, 29 pruebas.
psql -h localhost -p 5432 -d daubert_hub_test -U daubert_hub_test_user -X -w -v ON_ERROR_STOP=1 -f 20261030_101_manufactura_gestor_documental_test.smoke.sql
```

## Comprobaciones de seguridad incorporadas
- Cada script aborta si `current_database() <> 'daubert_hub_test'` (UP, precheck, postcheck, down y smoke); `daubert_global` nunca puede ser destino.
- El UP exige un rol **administrador** (no corre con el rol de la app) y comprueba que el rol de la app existe y **no** tiene privilegios de superusuario/creación; el postcheck verifica que la app no puede crear objetos y que ningún otro rol (PUBLIC, `daubert_hub_app`, n8n, backup, lectura) accede al esquema.
- No se reaplica: aborta si el esquema ya existe.

## Recuperación
| Situación | Acción |
|---|---|
| Precheck con algún `false` | No continuar; corregir la causa (el script indica cuál). No se escribió nada. |
| Falla durante el UP | La transacción se revierte: no queda ningún objeto. Corregir y repetir desde el precheck. |
| Postcheck con diferencias | No usar el módulo. Si las tablas están vacías, ejecutar el DOWN y reaplicar. |
| Retirar el módulo (sin datos) | `….down.sql` sin parámetros. |
| Retirar el módulo (con datos de prueba) | `pg_dump -n manufactura -F c -f manufactura_antes_del_down.dump` y luego `-v confirmar_borrado=SI_BORRAR_DATOS_DE_PRUEBA`. El historial en `audit.cambios` se conserva. |
| Revisiones FINALIZADAS con uso real | No hacer rollback: corrección hacia adelante con una nueva migración. |
| Restaurar todo | `pg_restore` del respaldo del paso 0 (flujo estándar de recuperación del proyecto). |

## Validación realizada (sin tocar TEST)
Los scripts se ejecutaron **solo en una instancia PostgreSQL 18 desechable** (contenedor temporal, ya eliminado) con una réplica mínima de `security.users`, `core.empresas` y de `audit.cambios` + `audit.fn_registrar_cambio` (definición real leída de TEST en solo lectura): precheck, UP, postcheck, smoke (29/29), aborto de UP repetido, UP/precheck/DOWN en otra base, UP con rol no administrador, DOWN con datos sin/con confirmación, y UP→DOWN→UP. **No se ejecutó nada contra `daubert_hub_test` ni `daubert_global`.**
