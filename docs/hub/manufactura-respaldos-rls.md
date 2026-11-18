# Manufactura · compatibilidad de los respaldos automáticos con RLS (Fase 6B, parte 2A)

Estado: **solución preparada y validada en réplicas desechables; NO aplicada en `daubert_global` ni en la automatización que opera hoy.**

## 1. Causa
- Los respaldos automáticos (`scripts/backup/`, tareas «Daubert - PostgreSQL Frequent/Daily/Monthly») ejecutan `pg_dump -Fc -h … -p … -U daubert_backup -d daubert_global -f <staging> --no-password` (`BackupPgTools.psm1`, `Invoke-PgDump`), con la contraseña en un `PGPASSFILE` (nunca en argumentos), más `pg_dumpall --globals-only --no-role-passwords -l <base>` y `pg_restore -l` para validar. **Las tareas leen los scripts de este árbol de trabajo** (`C:\Users\06\Documents\Daubert\daubert-hub\scripts\backup\commands\…`): cualquier commit sobre `scripts/backup/` de la rama que esté en ese directorio cambia la automatización viva.
- `daubert_backup` pertenece a `pg_read_all_data` (lee todo por pertenencia) pero **no salta RLS** ni tiene `BYPASSRLS` (política del proyecto: el postcheck 013 de Caterpillar lo trata como desviación). Las 9 tablas de `manufactura` tienen RLS y sus 24 políticas son `TO daubert_hub_app`. Ninguna otra tabla de la base tiene RLS.
- Resultado medido: sin la bandera, `pg_dump` **falla** («query would be affected by row-level security policy»; el trabajo terminaría con exit 4); con `--enable-row-security` y sin política, **termina con código 0 y deja `pdf_contenidos` y `firmas` vacías** (reproducido: el respaldo incompleto restauró `pdfs`=5 filas y `pdf_contenidos`=0).

## 2. Solución (migración 026 + una bandera)
1. **Migración productiva 026** (`20261109_026_manufactura_respaldo_rls_prod.*`, generada por `tools/generar-manufactura-026.cjs`): una política `pol_respaldo_sel` (PERMISSIVE, `FOR SELECT`, `TO daubert_backup`, `USING (true)`, sin `WITH CHECK`) en cada una de las 9 tablas. No concede privilegios, no cambia roles ni membresías (sin `BYPASSRLS`, `SUPERUSER` ni `pg_write_all_data`), no toca las políticas de la aplicación, los datos ni nada fuera de `manufactura`. Se numera **026** porque la **025** la usa otra rama (`feat/cat-safe-folio-recovery`, `20261106_025_caterpillar_folio_recovery_test`, en el mismo directorio `daubert_global`); no hay colisión.
2. **`pg_dump --enable-row-security`** en `Invoke-PgDump` (también en la instantánea `--schema-only`): parche `tools/ensayo-liberacion/respaldo-rls/enable-row-security.patch` (+ una prueba Pester). Sin RLS aplicable es un no-op, así que puede aplicarse antes de la 020. **No se aplicó al árbol vivo**: se desarrolló y probó en una copia temporal (21 → 22 pruebas de `BackupPgTools` y 92 de `Backup-PostgreSQL`, 0 fallos) y `git apply --check` confirma que aplica limpio.
3. **Controles contra un respaldo incompleto** (si falta la política, el respaldo «sale bien» pero vacío): el postcheck 026 y la verificación transversal desde `nivel=26` (`respaldo_con_rls_completo`) fallan si **cualquier** tabla con RLS —de cualquier esquema, también las futuras— no tiene una política PERMISSIVE de lectura con `USING (true)` para `daubert_backup` o PUBLIC; y el postcheck falla si la política de respaldo permite escribir (`FOR ALL`).

Privilegios de `daubert_backup` (verificados): SELECT efectivo en las 9 tablas (membresía + política) y **nada más**. 17 intentos de INSERT/UPDATE/DELETE/TRUNCATE/DDL/`SET ROLE`/`ALTER ROLE … BYPASSRLS` fueron denegados y el contenido no cambió; `GRANT ALL … TO daubert_backup` emitido por el propio rol solo da el aviso «no privileges were granted».

## 3. Alternativas evaluadas
| Alternativa | Veredicto |
|---|---|
| **Política de lectura para `daubert_backup` + `--enable-row-security`** | **Elegida.** Sin cambios de roles; visibilidad solo de lectura y solo para ese rol; detectable y reversible (DOWN) |
| `ALTER ROLE daubert_backup BYPASSRLS` | Más simple (un atributo, sin migración, cubre tablas futuras) pero cambia un rol de PROD, contradice el postcheck 013 y la decisión A, y daría al rol salto de RLS sobre todo lo que se cree después. No elegida |
| Respaldar con superusuario | Contradice el mínimo privilegio de `postgresql-backup-automation.md`. No elegida |
| Política `FOR ALL` | Permitiría escritura al rol; el postcheck la detecta. Descartada |

No hay una alternativa más segura y a la vez más sencilla que cumpla las restricciones. La elegida añade un riesgo operativo (la bandera y la política deben ir juntas), cubierto por los controles del punto 2.3.

## 4. Orden de liberación (no ejecutado)
1. Aplicar el parche de la bandera y comprobar la siguiente ejecución automática (no-op: mismo volcado que hoy).
2. Respaldo completo previo (ya existe uno validado) y aplicar 020 → 024 → **026** (precheck / UP / postcheck de cada una; verificación transversal con `nivel=26`).
3. Tras la primera ejecución automática posterior: exit 0, `pg_restore -l` con 9 entradas `TABLE DATA manufactura.*` (45 tablas en total) y, la primera vez, restaurar en una instancia desechable y comparar conteos y hashes (`tools/ensayo-liberacion/probar-respaldo-rls.cjs` hace exactamente eso).
4. Reversión: `DOWN 026` elimina solo las políticas; mientras `manufactura` exista, los respaldos volverían a fallar o a salir incompletos, así que **no** se deja `manufactura` instalada sin la 026.

## 5. Evidencia
`docs/hub/manufactura-ensayo-6b-resultados.md` (sección «Parte 2A») y la carpeta `C:\Users\06\Documents\Daubert\Evidencia_6B_20261109\parte2A\` (fuera del repositorio).
