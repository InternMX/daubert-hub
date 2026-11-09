# Manufactura · resultados del ensayo en réplica desechable (Fase 6B, parte 1)

Fecha: 2026-11-09. Respaldo: `daubert_global_completo_20261109_140238.dump` (366 427 bytes, 446 entradas de catálogo, `pg_dump` 18.4), SHA-256 `F2F85D8D…C902F939`; roles: `daubert_global_roles_20261109_140238.sql`, SHA-256 `4CC85CE6…63304030` (`--no-role-passwords`). Ambos en `C:\Users\06\Documents\Daubert\Respaldos_PostgreSQL\` (fuera del repositorio). Hashes recalculados y coincidentes antes de usarlos.

## Réplica
`postgres:18-alpine` desechable, **sin red (`--network none`), sin puertos publicados, sin volúmenes del host**, contraseñas desechables. Roles reales del clúster (8) restaurados desde el archivo de roles (sin el `postgres` del contenedor); `pg_restore --exit-on-error` del dump completo **sin errores**.

| Verificación | Resultado |
|---|---|
| Tablas / funciones / triggers / extensiones / roles de aplicación | 36 / 35 / 28 / 1 (`plpgsql`) / 8 = lo que dice el catálogo del respaldo |
| `security.users` / `security.sessions` | 4 / 75 (= archivo de conteos) |
| Conteos por tabla frente a `…filas_origen_…txt` | **Idénticos en las 36 tablas** (respaldo y conteos tomados en momentos distintos, sin diferencias) |
| Políticas RLS fuera de `manufactura` | 0 (no existen en PROD) |

## Migraciones 020–024 (sobre la réplica)
Precheck → UP → postcheck de cada una, con verificación transversal tras cada paso, DOWN 024→020, vuelta exacta a la línea base (19/19), reaplicación, y controles de detección:

| Migración | Precheck | UP | Postcheck | Verificación transversal |
|---|---|---|---|---|
| 020 | PASS | PASS | **FAIL** (38 t / 2 f) | **FAIL** |
| 021 | PASS | PASS | **FAIL** (10 t / 2 f) | **FAIL** |
| 022 | PASS | PASS | PASS (12/12) | **FAIL** |
| 023 | PASS | PASS | PASS (17/17) | **FAIL** |
| 024 | PASS | PASS | PASS (9/9) | **FAIL** |

Validador `--con-datos --roles <reales>`: **61 PASS / 11 FAIL**. Pasan: las 5 migraciones aplican; los 23 casos del smoke de solo lectura; abortos en base equivocada, UP repetido y UP con el rol de la app; DOWN de las 5; **vuelta exacta a la línea base**; detección de violaciones provocadas; **datos preexistentes idénticos antes/después (37 tablas, MD5 de todas las filas)**; **estructura y permisos fuera de `manufactura` idénticos antes/después (`pg_dump -s`, incluye ACL, RLS, funciones, triggers)**.

## Causa de los 11 FAIL: un hallazgo legítimo, no un defecto de las migraciones
Los 11 FAIL tienen **una sola causa**: el rol real `daubert_backup` es miembro de `pg_read_all_data` (`GRANT pg_read_all_data TO daubert_backup`), así que **lee todas las tablas y esquemas, incluido `manufactura`**, por pertenencia de rol, sin ninguna entrada en las ACL. Los postchecks 020 (`otros_roles_sin_acceso`) y 021 (`ningun_otro_rol_con_acceso`) y la verificación transversal (`roles_nombrados_sin_acceso`) incluyen a `daubert_backup` en la lista de roles que «no deben tener acceso» y miden privilegios **efectivos**.
- ACL explícita de `manufactura.documentos`: solo `postgres` y `daubert_hub_app` (`ar`). Ningún otro rol (n8n, `daubert_docs_ro`, `daubert_hub_test_user`) tiene acceso.
- Prueba de causa (diagnóstico aparte, instancia distinta): quitando únicamente esa membresía del archivo de roles de la réplica, el validador da **72 PASS / 0 FAIL**. No se tocaron migraciones ni datos.
- Por qué no se vio antes: la réplica de la Fase 5 usaba una lista de roles incrustada sin esa membresía.
- Efecto práctico: el rol de respaldos podrá leer documentos, PDF y **firmas** de Manufactura. Es lo esperado para que los respaldos las incluyan, pero contradice la afirmación «nadie más accede» de los postchecks.

**Decisión pendiente (no se modificó nada):** (a) aceptar que `daubert_backup` lee Manufactura y ajustar esos tres controles para comprobar la ACL explícita (y que `daubert_backup` no tenga INSERT/UPDATE/DELETE) en lugar del privilegio efectivo; o (b) restringir la membresía (p. ej. un rol de respaldo por esquema), lo que afectaría al respaldo actual. Hasta decidirlo, el postcheck 020/021 fallará en PROD aunque la migración esté bien.

## Riesgos pendientes
- Decisión sobre `daubert_backup` (arriba); modificar los postchecks cambia los hashes del README 020–024.
- Los smoke con escrituras (usuarios sintéticos) no se ejecutan en `--con-datos`: la parte funcional con datos reales va en la parte 2.
- PROD es pequeña (36 tablas, 4 usuarios): no valida rendimiento ni volumen.

Evidencia (fuera del repositorio): `C:\Users\06\Documents\Daubert\Evidencia_6B_20261109\` (log del validador, huellas de datos y estructura antes/después, estructura de `manufactura`, conteos de la réplica) y `…\diagnostico_sin_membresia_backup\`.

---

## Cierre de la parte 1 (2026-11-09) · decisión A aplicada
**Decisión:** se conserva la membresía de `daubert_backup` en `pg_read_all_data`; se acepta solo su lectura; ningún permiso de escritura nuevo; no se modifican roles, membresías ni RLS en `daubert_global`; los privilegios efectivos se siguen verificando. Detalle y lista de archivos en `database/migrations/daubert_global/README-manufactura-020-024.md` §7.

**Causa exacta de los 11 FAIL:** un solo origen. El rol real `daubert_backup` lee `manufactura` por pertenencia a `pg_read_all_data`, y tres consultas lo exigían «sin acceso»: `otros_roles_sin_acceso` (postcheck 020), `ningun_otro_rol_con_acceso` (postcheck 021) y `roles_nombrados_sin_acceso` (verificación transversal). Cuentan así: postcheck 020 (1) + verificación tras 020, 021, 022, 023 y 024 (5) + verificación tras revertir las violaciones provocadas (1) + verificación tras reaplicar (1) + postcheck 021 (1) + los repetidos al reaplicar 020 y 021 (2) = 11.

**Cambios:** solo verificadores (2 postchecks generados + la verificación transversal + el generador y el validador); los UP/DOWN/precheck/smoke 020–024 son byte a byte iguales (sus 22 hashes de §6 coinciden). Nueva comprobación `backup_solo_lectura` (efectiva, no solo ACL): sin SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS; única membresía `pg_read_all_data`; SELECT sí; INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (tabla y columna) no; secuencias sin USAGE/UPDATE; sin CREATE ni EXECUTE invocable; sin ACL explícita. Se descubrió además que las funciones de trigger de 021/023 conservan el EXECUTE por omisión de PUBLIC (no invocables): se excluyen de esa comprobación.

**Resultado con los 8 roles reales (y membresías reales), restauración completa:** `validar-…-prod.cjs --con-datos --roles <reales>` → **83 PASS / 0 FAIL** (modo por omisión con roles sintéticos: 77 PASS / 0 FAIL). Incluye: 5 prechecks/UP/postchecks; verificación transversal tras cada paso (20 comprobaciones); smoke de solo lectura (23); 10 detecciones nuevas de `daubert_backup` (INSERT, UPDATE de columna, TRUNCATE, `pg_write_all_data`, membresía extra, BYPASSRLS, CREATEROLE, CREATE en el esquema, EXECUTE, ACL explícita) y las 4 anteriores, todas detectadas y revertidas; `daubert_backup` real = miembro de `pg_read_all_data`, lee `manufactura` (firmas incluidas) y no escribe; aborto en base equivocada (PRECHECK, UP y DOWN), UP repetido y UP con el rol de la aplicación; DOWN 024→020 con **vuelta exacta a la línea base**; reaplicación; **datos preexistentes idénticos (37 tablas, MD5 de todas las filas)** y **estructura/permisos fuera de manufactura idénticos (`pg_dump -s`)**. Evidencia: `C:\Users\06\Documents\Daubert\Evidencia_6B_20261109\cierre_opcion_A\`.

### Bloqueante descubierto: los respaldos automáticos con `daubert_backup` fallarían al existir `manufactura`
`pg_read_all_data` **no salta RLS**, y `daubert_backup` no tiene `BYPASSRLS` (el postcheck 013 de Caterpillar lo trata como desviación). Las 24 políticas de `manufactura` son `TO daubert_hub_app`. Medido en la réplica con los roles reales:
- `pg_dump -Fc` como `daubert_backup` (así lo hace `scripts/backup/`, sin `--enable-row-security`): **falla** con *query would be affected by row-level security policy for table "cliente_abreviaturas"*; el trabajo de respaldo terminaría con error (exit 4) desde la primera ejecución posterior a la 020.
- Con `--enable-row-security` y sin política para el rol: el volcado terminaría pero las tablas de `manufactura` saldrían **vacías** (sin error visible).
- Prueba de remedio (base copiada de la réplica, nada de esto está aplicado ni versionado): políticas `FOR SELECT TO daubert_backup USING (true)` en las 9 tablas + `--enable-row-security` → volcado completo (508 KB) y el rol sigue sin poder escribir (`permission denied for table documentos`). Sin la bandera sigue fallando.

Opciones (requieren decisión; todas salvo la 1 exigen tocar algo que la decisión A reservó): 1) **política de lectura para `daubert_backup` en una migración (025) + `--enable-row-security` en el pg_dump del respaldo**: no cambia roles, no debilita RLS (solo lectura, solo ese rol); 2) `ALTER ROLE daubert_backup BYPASSRLS` (cambio de rol en PROD; contradice la política 013, cuyo postcheck habría que cambiar); 3) respaldar con un superusuario (contradice el diseño de mínimo privilegio). **Recomendación: opción 1**, antes de habilitar Manufactura y de aplicar la 020 en PROD, y probando un ciclo completo de respaldo+restauración con documentos sintéticos en la réplica.

El validador lo reporta como `ADVERTENCIA` (no cuenta como FAIL, porque no es un defecto de las migraciones sino una interacción RLS/respaldos que requiere decisión).
