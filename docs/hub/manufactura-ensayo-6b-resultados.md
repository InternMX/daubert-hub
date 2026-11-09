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
