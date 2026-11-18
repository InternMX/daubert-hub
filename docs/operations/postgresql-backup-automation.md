# Backup automatizado y cifrado (asimétrico) de PostgreSQL

**Estado: IMPLEMENTED y en operación real contra `daubert_global`.** Motor de backup, instalador, preflight, Task Scheduler reproducible y pruebas (carpeta `scripts/backup/tests`: 884 Pester, todas pasan) están completos. **Validación real:** desde el 2026-09-29 los tres tiers (Frequent, Daily, Monthly) han generado backups reales de `daubert_global` cifrados con age, con el SHA-256 de cada artefacto publicado verificado contra su `.sha256`; las tres tareas están registradas en Task Scheduler (Daily y Monthly se actualizaron el 2026-10-01 al esquema de reintento horario con `-OnlyIfDue`). Detalle en [Validación real](#validación-real). **Restore drill real completado el 2026-10-01** con un backup Daily de esta automatización ([Restore drill 2026-10-01](#restore-drill-2026-10-01-backup-daily-generado-por-esta-automatización--pass)). **Siguen pendientes** repetirlo con la clave privada age en una estación separada y la restauración de los `globals` en un clúster independiente (ver [Estado y pendientes](#estado-y-pendientes)).

Complementa a [database-backup-restore](database-backup-restore.md) (restauración de PostgreSQL). El **restore drill de n8n/PostgreSQL del 2026-09-28** SÍ se ejecutó realmente: [Restore drill 2026-09-28](#restore-drill-2026-09-28-postgresql--n8n-manual-pass). El **restore drill del 2026-10-01** restauró un backup Daily generado por esta automatización: [Restore drill 2026-10-01](#restore-drill-2026-10-01-backup-daily-generado-por-esta-automatización--pass).

## Arquitectura final: código ≠ configuración ≠ secretos ≠ datos

Requisito permanente: una PC Windows nueva debe poder preparar el sistema **sin editar código**, sin depender de rutas de otra máquina, sin reconstruir Task Scheduler a mano y sin poner secretos en el repo.

| Capa | Dónde | Contenido | ¿Se copia a otra PC? |
| --- | --- | --- | --- |
| **Código** (versionado) | repo: `scripts/backup/` | scripts, módulos `lib/`, tests | Sí (clonar el repo) |
| **Configuración** (no secreta) | `%ProgramData%\DaubertHub\Backup\` | `config.json`, `age-recipients.txt` (solo claves **públicas**), `logs\`, `locks\` | **No**: se regenera con el instalador (hay que tener el recipient público) |
| **Secretos** (locales) | `%LOCALAPPDATA%\DaubertHub\secrets\` | `pgpass-backup.conf` (ACL: solo usuario + SYSTEM) | **Nunca**: se crea de nuevo con la contraseña autorizada |
| **Staging** (plaintext efímero) | `%LOCALAPPDATA%\DaubertHub\staging\` | dumps antes de cifrar (se borran siempre) | No |
| **Datos** (backups) | ruta externa configurable (`backupRoot`; p. ej. una carpeta de Dropbox) | `FREQUENT\`, `DAILY\`, `MONTHLY\` con `.age` + `.age.sha256` | No: es el destino, no se mueve con el sistema |
| **Clave privada age** | **fuera del host productor** (custodia independiente para DR) | `AGE-SECRET-KEY-1...` | **Nunca** en este host |

Ningún script depende de un usuario, de Dropbox, de una versión de PostgreSQL ni de una ruta concreta: todo sale de `config.json`, de detección (`%ProgramFiles%`, PATH...) o de variables estándar del sistema. Una prueba de portabilidad (`Portability.Tests.ps1`) falla si aparece una dependencia operativa de `C:\Users\<usuario>`.

```
scripts/backup/
  commands/                             comandos operativos (ubicación canónica)
    Start-DaubertPostgresBackup.ps1     ENTRYPOINT canónico (backup de un tier)
    Install-DaubertBackup.ps1           instalador/bootstrap interactivo e idempotente
    Test-DaubertBackupEnvironment.ps1   preflight no destructivo (PASS/WARN/FAIL)
    Register-DaubertBackupTasks.ps1     registra las 3 tareas (idempotente, -WhatIf)
    Unregister-DaubertBackupTasks.ps1   elimina las 3 tareas (solo las propias, -WhatIf)
  lib/
    BackupConfig.psm1          defaults centralizados (retención, schedules), detección (PostgreSQL/7-Zip/age), config por tier
    BackupLocalConfig.psm1     config.json (leer/validar/escribir atómico, rechazo de secretos), pgpass seguro, age recipients, Dropbox
    BackupInstall.psm1         lógica del instalador (Prompter inyectable)
    BackupPreflight.psm1       lógica del preflight (dependencias inyectables)
    BackupTasks.psm1           XML de Task Scheduler + registro/desregistro idempotente
    BackupPipeline.psm1        pipeline de backup (pasos 1-14) + resolución de config; el entrypoint es un envoltorio fino
    BackupNaming / Logging / Lock / Hash / PgTools / Packaging / Encryption / Retention / Publish  (motor de backup)
  tests/                       Pester (884 pruebas)
```

## Cifrado: age asimétrico (resumen del diseño)

La primera versión cifraba con 7-Zip y contraseña por stdin; se demostró (con hashes SHA-256) que **no es fiable sin consola** (Task Scheduler) y se rediseñó con cifrado **asimétrico**:

- El host productor solo tiene la(s) clave(s) **pública(s)** (`age1...`, no secretas) en `age-recipients.txt`: `age -R <recipients> -o <salida> <entrada>`. Nunca hay prompt, agente ni keyring.
- La **clave privada** se genera **una sola vez, fuera del host productor** (`age-keygen`) y se custodia de forma independiente (gestor de contraseñas corporativo / almacenamiento offline, idealmente con una copia de respaldo). Si se pierde, los `.age` son irrecuperables.
- Como el job no tiene la clave privada, **no puede descifrar** para validar: la validación del artefacto es **estructural** (cabecera `age-encryption.org/v1`, línea de destinatario, tamaño mínimo). La única prueba definitiva de recuperabilidad es un restore drill con la clave privada, en otra máquina.
- 7-Zip se usa **solo como empaquetador sin contraseña** (Daily/Monthly agrupan varios artefactos antes de cifrar).
- El instalador y el preflight **rechazan** una clave privada age: en el recipient file, en cualquier valor de `config.json` o dentro de las rutas administradas (config, secretos, logs, locks, staging, backup root).

### Custodia de la clave privada (DR)

1. Generar el par en una estación **distinta** del host productor: `age-keygen -o age-identity.txt`.
2. Copiar la clave **pública** (la línea `age1...`) al host productor (la pide el instalador).
3. Guardar `age-identity.txt` en la custodia independiente y **borrarlo de la estación de generación**.
4. Rotación: añadir la nueva clave pública como segunda línea de `age-recipients.txt` (los backups nuevos serán descifrables con cualquiera de las dos); conservar la privada antigua mientras existan backups antiguos.

## Contenido por tier (todo dentro de un único artefacto cifrado)

| Tier | Frecuencia por defecto | Retención por defecto | Contenido | Carpeta |
| --- | --- | --- | --- | --- |
| `Frequent` | cada 4 h desde 00:30 | 7 días | solo el dump (`pg_dump -Fc`) | `FREQUENT\` |
| `Daily` | 1 vez al día, desde las 02:00 (`-OnlyIfDue`, ver [Backups pendientes](#backups-pendientes-recuperación-tras-apagado-o-lock-ocupado)) | 30 días | dump + schema-only | `DAILY\` |
| `Monthly` | 1 vez al mes, desde el día 1 a las 03:00 (`-OnlyIfDue`) | 12 meses | dump + schema-only + **globals sanitizados** | `MONTHLY\` |

**Resumen de contenido:** `FREQUENT` = full dump · `DAILY` = full dump + schema-only · `MONTHLY` = full dump + schema-only + **globals sanitizados**.

### Globals sanitizados (MONTHLY)

Los globals se generan con la cuenta de mínimo privilegio `daubert_backup` (sin superusuario, sin acceso a hashes de contraseña, sin segunda credencial privilegiada):

```
pg_dumpall -h <host> -p <puerto> -U <backupUser> -l <database> --globals-only --no-role-passwords -f <staging>\globals_MONTHLY_<ts>.sql --no-password
```

- `-l <database>` (la base resuelta de la configuración, p. ej. `daubert_global`): sin él `pg_dumpall` se conecta inicialmente a la base `postgres`, para la que el `PGPASSFILE` no tiene entrada y falla. Con `-l` la conexión inicial usa la misma base para la que sí existe entrada.
- `--no-role-passwords`: el SQL **no contiene hashes de contraseña** (0 sentencias `PASSWORD`); por eso no hace falta superusuario.
- `--no-password`: nunca pide contraseña; se usa `PGPASSFILE` (variable de entorno del proceso hijo, nunca argumento).
- Validado contra PostgreSQL 18.4 con `daubert_backup`: exit 0, 7 `CREATE ROLE`, 0 `PASSWORD`, 0 tablespaces en ese entorno.

Qué conserva y qué no: **conserva** roles, atributos, membresías y demás objetos globales accesibles; **no conserva las contraseñas de los roles**. En una **recuperación bare-metal** las credenciales de cada rol deben **restablecerse desde los secretos autorizados** (p. ej. `ALTER ROLE ... PASSWORD` ejecutado a mano, nunca guardado en el SQL restaurado).

El plaintext de los globals solo existe en staging efímero: se elimina en cuanto el bundle está cifrado y validado, y en el `finally` aunque falle cualquier etapa; el único artefacto publicado es el `.age` cifrado. Un `pg_dumpall` fallido aborta MONTHLY (exit `4`); un globals inexistente, vacío o sin sentencias reconocibles también (exit `5`). FREQUENT y DAILY nunca invocan `pg_dumpall`.
Retención y schedules están **centralizados** (`Get-DefaultRetention` / `Get-DefaultSchedule` en `BackupConfig.psm1`) y se sobre-escriben en `config.json` (secciones `retention` y `schedules`). Cada tier publica dos archivos: `<db>_<TIER>_<yyyyMMdd_HHmmss>.age` y `.age.sha256`. Los `globals` nunca se publican fuera del artefacto cifrado.

## Pipeline de un backup (`Start-DaubertPostgresBackup.ps1 -Tier X`)

1. **Lock** exclusivo (ejecución simultánea → exit `2`). 2. **Staging** fuera del destino. 3. `pg_dump -Fc`. 4. **Validación obligatoria** `pg_restore -l`. 5. Artefactos adicionales (schema-only / globals), validados igual. 6. **Empaquetado** 7z sin contraseña (si hay más de un artefacto). 7. **Cifrado age** (solo clave pública). 8. **Validación estructural** del `.age`. 9. **Borrado del plaintext**. 10. **SHA-256** del `.age`. 11. **Publicación atómica** `.age` + `.sha256` (con rollback). 12. **Verificación del hash ya publicado**. 13. **Retención** (o simulación con `-DryRun`). 14. **Limpieza de staging** en `finally`.

Si falla cualquier paso 3–12 no se publica nada, no se toca ningún backup existente y no corre la retención.

## Prerequisitos

Install-DaubertBackup.ps1 **no instala software**: detecta, permite indicar la ruta, o muestra el prerequisito que falta y remite a Install-DaubertBackupPrerequisites.ps1 (ver [Dependencias declarativas](#dependencias-declarativas-scriptsbackupconfigdependenciesjson)).

| Prerequisito | Detección | Nota |
| --- | --- | --- |
| Windows PowerShell 5.1+ | automática | incluido en Windows 10/11 |
| PostgreSQL client tools (`pg_dump`, `pg_restore`, `pg_dumpall`; idealmente `psql`, `pg_isready`) | `%ProgramFiles%\PostgreSQL\<versión más alta>\bin`, luego PATH | versión de cliente ≥ versión del servidor |
| 7-Zip (`7z.exe`) | `%ProgramFiles%\7-Zip`, PATH | solo empaquetado |
| age (`age.exe`) | `%ProgramFiles%\age`, `%LOCALAPPDATA%\Programs\age`, enlaces de winget, PATH | https://github.com/FiloSottile/age/releases |
| Rol PostgreSQL `daubert_backup` | — | **creación manual y supervisada** (abajo) |
| Recipient público age | — | lo entrega quien custodia la clave privada |
| Destino de backups | propuesta si se detecta Dropbox | cualquier carpeta/unidad accesible |

### Rol `daubert_backup` (manual, supervisado — el instalador NO lo crea)

Lectura completa de `daubert_global`, sin escritura ni superusuario. **La contraseña se define con `\password`, nunca con `CREATE ROLE ... PASSWORD '...'`** (quedaría en historial y logs):

```sql
CREATE ROLE daubert_backup LOGIN;
GRANT pg_read_all_data TO daubert_backup;  -- PostgreSQL 14+
```
> **Manufactura (esquema `manufactura`, migraciones 020–024):** este rol lee las tablas de Manufactura por pertenencia a `pg_read_all_data` (incluye documentos, PDF e imágenes de firmas: proteger sus credenciales y los archivos de respaldo). Sin `BYPASSRLS`, `pg_dump` como `daubert_backup` falla en cuanto exista `manufactura` (RLS); ver `docs/hub/manufactura-ensayo-6b-resultados.md` antes de aplicar la 020 en producción.

```
\password daubert_backup
```

Ver [roles.md](../database/roles.md).

## Dependencias declarativas (`scripts/backup/config/dependencies.json`)

Las dependencias son herramientas de sistema (no paquetes Python), por eso se declaran en un manifest y se preparan con un script idempotente:

```powershell
.\scripts\backup\commands\Install-DaubertBackupPrerequisites.ps1 -WhatIf     # ver qué haría
.\scripts\backup\commands\Install-DaubertBackupPrerequisites.ps1             # producción
.\scripts\backup\commands\Install-DaubertBackupPrerequisites.ps1 -Scope All  # + desarrollo (Pester)
.\scripts\backup\commands\Install-DaubertBackupPrerequisites.ps1 -CheckOnly  # solo diagnóstico
```

| Dependencia | Ámbito | Instalación | Versión |
| --- | --- | --- | --- |
| age | producción | winget `FiloSottile.age` | mínima 1.1.0; **validada 1.3.1** (informativa) |
| 7-Zip | producción | winget `7zip.7zip` | mínima 9.20 |
| PostgreSQL client tools (`pg_dump`, `pg_restore`, `pg_dumpall`) | producción | **manual** (no hay paquete winget solo-cliente confiable); se reutiliza la instalación de versión más alta que sea a la vez completa —los tres ejecutables— y compatible —>= la mínima—; una superior incompleta se descarta y se usa la siguiente válida | mínima 14; validada 18 (informativa) |
| Windows PowerShell | producción | incluido en Windows | mínima 5.1 |
| Pester | solo desarrollo | manual (`Install-Module Pester -RequiredVersion 3.4.0 ...`) | **exacta 3.4.0** (las pruebas usan sintaxis de Pester 3) |

**Estrategia de versiones**: `minimumVersion` es el único requisito duro; `validatedVersion` solo documenta la versión probada (una versión distinta pero compatible se acepta y se anota; no es un pin). Solo Pester se fija exactamente por razón técnica. Ninguna ruta se escribe en el manifest: todo se **detecta** (`%ProgramFiles%`, enlaces de winget, PATH).

Comportamiento: no reinstala lo presente y compatible; usa winget solo con el `packageId` del manifest (nunca inventa IDs); si falta winget o no hay método automático imprime la instrucción; no maneja secretos ni toca PostgreSQL, Task Scheduler ni el destino de backups. Códigos de salida: `0` satisfecho, `2` manifest inválido, `3` acción manual requerida, `4` una instalación falló. `Install-DaubertBackup.ps1` indica este script cuando faltan prerequisitos y, con `-InstallPrerequisites`, ofrece ejecutarlo tras confirmación explícita (nunca instala en silencio); `Test-DaubertBackupEnvironment.ps1` evalúa el manifest (fila `Dependencies (manifest)`).
## Instalación desde cero (runbook, ~15–30 min sin contar la instalación de PostgreSQL)

Requisitos previos: repo clonado, prerequisitos instalados, rol `daubert_backup` creado, contraseña autorizada, recipient público age y ruta del destino de backups.

```powershell
cd <repo>

# 1) Instalar/configurar (interactivo). Pide: conexión (Enter = defaults), destino de backups,
#    recipient público age y la contraseña de daubert_backup (oculta).
.\scripts\backup\commands\Install-DaubertBackup.ps1

# 2) Diagnóstico no destructivo (esperado: PASS; WARN aceptable si aún no hay tareas/backups)
.\scripts\backup\commands\Test-DaubertBackupEnvironment.ps1

# 3) Prueba de humo SIN publicar nada
.\scripts\backup\commands\Start-DaubertPostgresBackup.ps1 -Tier Frequent -DryRun -ConfigPath "$env:ProgramData\DaubertHub\Backup\config.json"

# 4) Ver qué haría el registro de tareas y registrarlas
.\scripts\backup\commands\Register-DaubertBackupTasks.ps1 -WhatIf
.\scripts\backup\commands\Register-DaubertBackupTasks.ps1
```

El instalador: pregunta una sola vez por la conexión y por las rutas locales (acepte los valores propuestos con Enter), escribe `config.json` de forma atómica, guarda solo la clave pública en `age-recipients.txt`, crea `pgpass-backup.conf` (ACL aplicada **antes** de escribir el secreto) y **solo ofrece** registrar tareas (`¿Deseas registrar las tareas programadas ahora?`, por defecto **No**).

## Configuración: `config.json`

`%ProgramData%\DaubertHub\Backup\config.json` — **nunca** contiene contraseñas, tokens ni claves (el instalador y todos los lectores rechazan claves con aspecto de secreto y valores con forma de clave privada age o URL con credenciales). Solo referencia la **ruta** del pgpass.

```json
{
  "schemaVersion": 1,
  "database": "daubert_global",
  "host": "localhost",
  "port": 5432,
  "backupUser": "daubert_backup",
  "postgresBin": "<ruta detectada>\\bin",
  "sevenZipPath": "<ruta detectada>\\7z.exe",
  "agePath": "<ruta detectada>\\age.exe",
  "recipientsFilePath": "<ProgramData>\\DaubertHub\\Backup\\age-recipients.txt",
  "pgPassFile": "<LocalAppData>\\DaubertHub\\secrets\\pgpass-backup.conf",
  "backupRoot": "<destino externo>",
  "stagingRoot": "<LocalAppData>\\DaubertHub\\staging",
  "logRoot": "<ProgramData>\\DaubertHub\\Backup\\logs",
  "lockRoot": "<ProgramData>\\DaubertHub\\Backup\\locks",
  "retention": { "Frequent": { "unit": "Days", "value": 7 }, "Daily": { "unit": "Days", "value": 30 }, "Monthly": { "unit": "Months", "value": 12 } },
  "schedules": { "Frequent": { "startTime": "00:30", "intervalHours": 4 }, "Daily": { "startTime": "02:00" }, "Monthly": { "startTime": "03:00", "dayOfMonth": 1 } }
}
```

Opcional (no se escribe por defecto): `schedules.<Tier>.lockTimeoutSeconds` (entero 0-3600), la espera por `backup.lock` que la tarea programada de ese tier pasa como `-LockTimeoutSeconds`. Defaults: Frequent 0, Daily y Monthly 900. Se aplica al re-registrar las tareas; ver [Backups pendientes](#backups-pendientes-recuperación-tras-apagado-o-lock-ocupado).

Reglas: todas las rutas absolutas (se admiten espacios); `pgPassFile` no puede estar dentro de `backupRoot`; `dayOfMonth` 1–28; `intervalHours` 1–24. Tras editar `schedules`, ejecute `Register-DaubertBackupTasks.ps1` (actualiza solo lo que cambió).

**Precedencia**: parámetro explícito del CLI **>** `config.json` (`-ConfigPath`) **>** detección/defaults no personales. Sin `-ConfigPath` el entrypoint **no** lee `%ProgramData%` (aislamiento para pruebas y ejecuciones ad-hoc); las tareas programadas siempre pasan `-ConfigPath`.

## Reparación, reconfiguración y reinstalación

Si ya existe configuración, `Install-DaubertBackup.ps1` ofrece **Validar / Reparar / Reconfigurar / Cancelar** (o `-Mode Validate|Repair|Reconfigure|Cancel`):

| Opción | Efecto |
| --- | --- |
| Validar | Solo lectura: informa el estado de `config.json` y de las rutas de herramientas. |
| Reparar | Conserva lo válido; solo re-pregunta/re-detecta lo inválido o ausente (herramienta movida, pgpass o recipient borrados, JSON corrupto). Si todo está sano no hace nada (`NoChange`). |
| Reconfigurar | Repasa todos los valores usando los actuales como propuesta. Un pgpass existente **nunca** se reemplaza sin confirmación explícita. |
| Cancelar | No modifica nada. |

**Reinstalación** (se perdió `config.json`, cambió una ruta, se reinstaló una herramienta): `.\scripts\backup\commands\Install-DaubertBackup.ps1` → *Reparar* (o instalación nueva si `config.json` no existe). Los **backups existentes no se tocan jamás**. El instalador no modifica PostgreSQL ni ejecuta backups.

## Migración a otra PC

`máquina vieja → nueva PC/servidor`. La nueva máquina necesita **solo**: el repo, la clave pública age, la contraseña autorizada de `daubert_backup`, conectividad a PostgreSQL, acceso al destino de backups y los prerequisitos instalados.

| Copiar / tener | NO copiar |
| --- | --- |
| Repo (`git clone`) | `%LOCALAPPDATA%\DaubertHub\secrets\` de la PC vieja (se recrea) |
| Clave **pública** age (`age1...`) | **Cualquier clave privada age** (nunca al host productor) |
| Contraseña autorizada de `daubert_backup` (del gestor de secretos) | `config.json` de la PC vieja (se regenera; las rutas cambian) |
| Ruta/acceso al destino de backups | Tareas exportadas de Task Scheduler (se registran desde el repo) |

Pasos: (1) en la PC vieja, `.\scripts\backup\commands\Unregister-DaubertBackupTasks.ps1` para evitar backups duplicados (o dejarla apagada); (2) en la nueva, seguir [Instalación desde cero](#instalación-desde-cero-runbook-1530-min-sin-contar-la-instalación-de-postgresql); (3) `Test-DaubertBackupEnvironment.ps1` hasta obtener PASS; (4) `-DryRun` y luego dejar que corran las tareas; (5) comprobar que el siguiente backup aparece y que el preflight muestra `Last valid backup PASS`. Si el destino es el mismo (misma carpeta de Dropbox), la retención y los backups previos continúan sin cambios.

## Preflight: `Test-DaubertBackupEnvironment.ps1`

No destructivo (no genera backups, no modifica PostgreSQL ni tareas; solo crea y borra de inmediato un archivo de sondeo en las carpetas cuya escritura verifica). **Nunca imprime la ruta ni el contenido del pgpass.**

```
PostgreSQL tools           PASS
pg_dump / pg_restore       PASS
Database reachable         PASS
Backup user auth           PASS     (psql SELECT 1 con PGPASSFILE en el entorno del proceso)
7-Zip                      PASS
age                        PASS
Public recipient           PASS
No age private key         PASS
Backup root / writable     PASS
Staging / Log / Lock root  PASS
Free space                 PASS
Scheduled Tasks            WARN
Last valid backup          PASS     (+ SHA-256 del sidecar)

OVERALL: WARN
```

Exit code: **0 = PASS, 1 = WARN, 2 = FAIL**. Parámetros: `-ConfigPath`, `-MinFreeSpaceGB` (5), `-MaxBackupAgeHours` (por defecto 2× el intervalo Frequent), `-SkipHashVerify`, `-SkipDatabase`. *WARN típicos*: tareas sin registrar, backup más antiguo de lo esperado, instalación nueva sin backups. *FAIL típicos*: herramienta ausente, base inaccesible, autenticación fallida, recipient inválido, clave privada age detectada, backup root no escribible, SHA-256 no coincide.

## Task Scheduler

Las **únicas** tareas administradas: `Daubert - PostgreSQL Frequent`, `Daubert - PostgreSQL Daily`, `Daubert - PostgreSQL Monthly`.

- Definidas por XML generado (`New-BackupTaskXml`) y registradas con `Register-ScheduledTask -Xml` (un único mecanismo para las tres tareas: fija `MultipleInstancesPolicy=IgnoreNew`, `StartWhenAvailable` y la repetición de cada trigger; Monthly **no** usa un trigger mensual, ver [Backups pendientes](#backups-pendientes-recuperación-tras-apagado-o-lock-ocupado)).
- Ejecutan `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<repo>\scripts\backup\commands\Start-DaubertPostgresBackup.ps1" -Tier <Tier> -ConfigPath "<config.json>"`. **Sin secretos en los argumentos.**
- `MultipleInstancesPolicy = IgnoreNew`; coexisten con el lock interno. Con `-LockTimeoutSeconds` (Daily/Monthly: 900 s por defecto) una tier espera a que termine la otra; si no hay lock, exit `2` sin daño y el siguiente disparo horario lo reintenta (ver [Backups pendientes](#backups-pendientes-recuperación-tras-apagado-o-lock-ocupado)). `StartWhenAvailable` recupera ejecuciones perdidas; límite de ejecución 4 h.
- Cuenta: el usuario que registra las tareas, `LeastPrivilege`. Por defecto `-LogonType S4U` (corre sin sesión iniciada y sin guardar contraseña); `-LogonType Interactive` si el entorno no permite S4U. Esa cuenta debe poder leer el pgpass y escribir en `backupRoot`, y **no** debe tener acceso a la clave privada age.
- **Idempotente**: la descripción de cada tarea lleva una marca y un hash de la definición; si coincide → `Unchanged`; si difiere → `Update`; si no existe → `Create`.
- **Seguro**: nunca toca tareas ajenas; si existe una tarea con ese nombre **sin** la marca de Daubert → `Blocked` (y se informa).
- `-WhatIf` muestra el plan sin cambiar nada; el plan se imprime siempre antes de aplicar.

```powershell
.\scripts\backup\commands\Register-DaubertBackupTasks.ps1 -WhatIf     # previsualizar
.\scripts\backup\commands\Register-DaubertBackupTasks.ps1             # crear/actualizar (idempotente)
.\scripts\backup\commands\Unregister-DaubertBackupTasks.ps1 -WhatIf   # previsualizar la baja
.\scripts\backup\commands\Unregister-DaubertBackupTasks.ps1           # eliminar solo las 3 tareas propias
.\scripts\backup\commands\Unregister-DaubertBackupTasks.ps1 -Tier Frequent
```

**Eliminar / re-registrar**: `Unregister-…` y luego `Register-…`; o simplemente editar `schedules` en `config.json` y volver a ejecutar `Register-…` (solo se actualiza la tarea que cambió).

### Backups pendientes: recuperación tras apagado o lock ocupado

Daily y Monthly ya no dependen de un único disparo. Cada tarea se dispara **cada hora** (repetición `PT1H` durante 24 h desde su hora de inicio) con `-OnlyIfDue`:

- **¿Toca?** Se decide solo con los backups **publicados válidos** (`<db>_<TIER>_<ts>.age` **con** su `.sha256` no vacío; un `.age` sin sidecar no cuenta). No hay archivo de estado ni base de datos. Daily toca si el último es anterior al último instante programado (hoy a `startTime`, o ayer si todavía no llega); Monthly, si el último es anterior al `dayOfMonth` a `startTime` de este mes (o del anterior, si todavía no llega). Frequent ignora `-OnlyIfDue`.
- **Si ya existe el backup del periodo**: exit `0` sin hacer nada (sin log, sin tomar el lock). La comprobación se repite **dentro del lock** para que dos ejecuciones simultáneas no dupliquen (log `due_check` / `skipped`).
- **Equipo apagado o suspendido** en el horario: `StartWhenAvailable` hace un primer intento al volver y la repetición horaria insiste hasta que exista el backup (Monthly puede hacerse el día 2, el 15 o el 30 si falló el del día 1; no hay límite dentro del mes). No cubre el tiempo en que el equipo duerme.
- **Lock ocupado**: Daily/Monthly esperan hasta `-LockTimeoutSeconds` (Frequent no espera, como siempre); si el tiempo se agota salen con exit `2` y el siguiente disparo horario lo reintenta.
- **Configuración**: `schedules.<Tier>.lockTimeoutSeconds` (opcional, entero 0-3600) en `config.json`; se aplica al **re-registrar** las tareas. `startTime` y `dayOfMonth` también los lee el script en cada ejecución.
- **Consecuencias**: una falla persistente (p. ej. PostgreSQL caído) deja un log por intento (hasta 24 al día por tier). Re-registrar con `Register-DaubertBackupTasks.ps1` actualiza Daily y Monthly (hash `v2`) y deja Frequent sin cambios.
- **Ejecución manual**: sin `-OnlyIfDue` el script siempre hace el backup (comportamiento anterior).

### Configuración exacta de las tres tareas

| Tarea | Horario | Retención (config) |
| --- | --- | --- |
| `Daubert - PostgreSQL Frequent` | cada 4 h, todos los días, empezando a las 00:30 | 7 días |
| `Daubert - PostgreSQL Daily` | cada 1 h, todos los días, desde las 02:00 (con `-OnlyIfDue`: solo hace backup si falta el del día) | 30 días |
| `Daubert - PostgreSQL Monthly` | cada 1 h, todos los días, desde las 03:00 (con `-OnlyIfDue`: solo hace backup si falta el del mes; "toca" desde `dayOfMonth` a `startTime`) | 12 meses |

Todas ejecutan `powershell.exe` (Windows PowerShell 5.1, ruta completa) con `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<repo>\scripts\backup\commands\Start-DaubertPostgresBackup.ps1" -Tier <Tier> -ConfigPath "C:\ProgramData\DaubertHub\Backup\config.json"`. Rutas absolutas resueltas al registrar (no dependen del directorio actual; `WorkingDirectory` = carpeta del script). `-ExecutionPolicy Bypass` es necesario porque los scripts no están firmados y la política por defecto de Windows PowerShell en clientes es `Restricted`; solo afecta a ese proceso.

Argumentos adicionales de Daily y Monthly (Frequent no cambia): `-OnlyIfDue -LockTimeoutSeconds <schedules.<Tier>.lockTimeoutSeconds, por defecto 900>`.

Ajustes: `MultipleInstancesPolicy=IgnoreNew` (no arranca una segunda instancia de la misma tarea; el lock interno cubre tiers distintos), `StartWhenAvailable=true` (recupera ejecuciones perdidas por apagado/reinicio), límite de ejecución 4 h, sin restricciones de batería/AC, `RunOnlyIfNetworkAvailable=false`, `LeastPrivilege`.

Salida conceptual de `Register-DaubertBackupTasks.ps1 -WhatIf` (no modifica nada; el plan sale de la misma definición que se registraría):

```
Plan de tareas programadas de Daubert Hub (nada se aplica con -WhatIf):
Daubert - PostgreSQL Frequent  [CREATE]  La tarea no existe.
    Horario      : cada 4 h, todos los días, empezando a las 00:30
    Ejecutable   : C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
    Script       : <repo>\scripts\backup\commands\Start-DaubertPostgresBackup.ps1
    Tier         : Frequent
    ConfigPath   : C:\ProgramData\DaubertHub\Backup\config.json
    Directorio   : <repo>\scripts\backup\commands
    Cuenta/logon : <DOMINIO\usuario> / S4U (LeastPrivilege)
    Concurrencia : MultipleInstances=IgnoreNew; StartWhenAvailable=true; límite de ejecución PT4H; con batería: permitido
(... Daily y Monthly con su horario ...)
```

**Idempotencia**: registrar dos veces es seguro — crea si no existe, actualiza solo si cambió la definición (hash en la descripción), no duplica, nunca toca tareas ajenas (`Blocked`). `Unregister-DaubertBackupTasks.ps1 [-WhatIf]` elimina solo los tres nombres exactos y solo si conservan la marca de Daubert (sin comodines; repetirlo es seguro).

**Preflight**: antes de registrar, `Scheduled Tasks` es **WARN** (no FAIL). Después de registrar, el mismo preflight confirma que las tres existen, están habilitadas y ejecutan el entrypoint canónico con el `-ConfigPath` en uso y `IgnoreNew`; cualquier desviación es WARN con el motivo.

### Elevación administrativa (UAC): cuándo hace falta y cómo se pide

**Ejecutar los backups NO requiere administrador.** Solo **registrar o eliminar** las tareas de Task Scheduler lo requiere (y, si `%ProgramData%\DaubertHub` no es escribible para el usuario, escribir la configuración). Diagnóstico, preflight, `-WhatIf`, lectura de configuración, prerequisitos y los propios backups funcionan sin elevar. El preflight general **no** falla por no estar elevado.

La lógica está **centralizada** en `lib\BackupElevation.psm1` (`Test-IsAdministrator`, `Get-ElevationRequirement`, `Invoke-ElevationGate`, `Request-AdministrativeElevation`); ningún comando implementa la suya, y el futuro wizard consume la misma capa.

| Situación | Comportamiento |
| --- | --- |
| `-WhatIf` (con o sin elevación) | Muestra el plan; nunca requiere ni pide elevación. |
| Shell **no elevada**, acción real, **sin** `-RequestElevation` (uso directo por CLI) | Falla limpiamente **antes de modificar nada**: *"requiere una PowerShell ELEVADA"*, exit **5**. |
| Shell no elevada + `-RequestElevation` (lo usa el wizard tras la confirmación del usuario) | Pide el **UAC estándar de Windows una sola vez** y relanza el mismo script elevado, con parámetros **no sensibles** (`-ConfigPath`, `-LogonType`, `-Tier`, `-TaskUser`); propaga el código de salida del proceso elevado. |
| Ya elevado | Continúa sin segundo UAC. |
| UAC cancelado o denegado | **No es éxito**: exit **7**, mensaje *"CANCELADO"*, sin cambios ni estado parcial, se puede reintentar. |
| Sin cambios pendientes (todo `Unchanged`) o sin tareas que eliminar | No necesita elevación. |

Nunca: autoelevar en silencio, saltarse o deshabilitar UAC, guardar credenciales administrativas, ni pasar secretos por argumentos o archivos temporales (se rechazan parámetros con nombre de secreto, valores con forma de secreto y `SecureString`/`PSCredential`). La contraseña de PostgreSQL se pide dentro del proceso donde corre el wizard. Si el UAC se aprueba con **otra cuenta de administrador**, las tareas se registran para la cuenta original (`-TaskUser`), pero conviene aprobar el UAC con la misma cuenta.

Códigos de salida de `Register-DaubertBackupTasks.ps1`: `0` correcto/`-WhatIf`; `2` `-Tier` inválido; `3` config inválido o falta el entrypoint; `4` tarea ajena con ese nombre (no se toca); `5` falta elevación y no se pidió; `6` Task Scheduler rechazó el registro (nunca se informa `Created`/`Updated` si el cmdlet falló; se detiene en la primera tarea fallida y las siguientes quedan `NotAttempted`); `7` UAC cancelado. `Unregister-DaubertBackupTasks.ps1` usa `0`, `2`, `5`, `6`, `7` con el mismo significado.

Causa del bug corregido: `Register-ScheduledTask` devolvía *Acceso denegado (0x80070005)* como error **no terminante**; los módulos no heredan el `$ErrorActionPreference = 'Stop'` del script, así que el wrapper seguía y reportaba `Created` con exit 0. Ahora los wrappers usan `-ErrorAction Stop` y los fallos se registran por tarea.
### Cuenta/logon de las tareas y Dropbox

**Recomendación para la primera instalación: `S4U` (valor por defecto actual)**, con `Interactive` como alternativa si el registro falla.

| Opción | Corre sin sesión iniciada | Guarda contraseña | Notas |
| --- | --- | --- | --- |
| **S4U** (recomendada) | Sí | No | Requiere el derecho "Iniciar sesión como trabajo por lotes" (los administradores lo tienen). Sin ventana. |
| Interactive (`-LogonType Interactive`) | No: solo con la sesión del usuario abierta | No | Sin privilegios especiales, pero muestra una ventana de consola breve en cada ejecución y omite las ejecuciones con la sesión cerrada (las recupera `StartWhenAvailable` al iniciar sesión). |
| Contraseña de Windows | Sí | **Sí** | No recomendado: guarda una credencial innecesaria. |

Dropbox Desktop corre **en la sesión del usuario**. Hay que separar dos garantías:

- **Backup creado localmente**: lo garantiza el propio sistema (`.age` + `.sha256` publicados y verificados en `backupRoot`). Con S4U ocurre aunque la sesión esté bloqueada o cerrada.
- **Backup sincronizado a la nube de Dropbox**: **no lo puede garantizar ni verificar este sistema**. Dropbox detecta los archivos nuevos de su carpeta por el sistema de archivos, con independencia del proceso que los creó, pero solo sincroniza mientras Dropbox Desktop está en ejecución (sesión del usuario iniciada). Con la sesión cerrada, el archivo queda local y se sube al iniciar sesión.

Tras la primera ejecución programada real, confirme la sincronización manualmente (estado del icono de Dropbox, dropbox.com u otro dispositivo). No se cambia el logon real sin decisión humana.
## Residuos y limpieza

| Tipo | Quién lo limpia |
| --- | --- |
| Staging de la ejecución (dumps, schema-only, globals y bundle en texto plano; `.age` en construcción) | **Automático**: `finally` de cada ejecución (éxito, fallo o `-DryRun`); el plaintext se borra además en cuanto el bundle está cifrado y validado. |
| Staging **huérfano** (`<StagingRoot>\<RunId>` que dejó una ejecución que murió: kill por timeout, apagado, crash) | **Automático**: al inicio de la siguiente ejecución, con el lock ya adquirido, `Remove-OrphanedStagingDirectory` borra solo directorios con forma de RunId (32 hex) dentro de `stagingRoot`, nunca el destino de backups; idempotente. El preflight avisa (`Staging residue`, WARN) mientras existan. |
| Lock (`lockRoot\backup.lock`) | **Automático**: el archivo se abre con `DeleteOnClose`; el sistema operativo lo elimina cuando el proceso termina por cualquier motivo, y un archivo huérfano sin dueño no bloquea. La exclusión la da el uso compartido del archivo, no su existencia. |
| Backups publicados (`.age` + `.age.sha256`) | **Solo la política de retención** (Frequent 7 d, Daily 30 d, Monthly 12 m), sobre pares reconocidos por nombre y dentro de `backupRoot`. Nada más los borra jamás. |
| Logs JSONL (`logRoot`) | **Manual/opcional**: pesan ~1-2 KB por ejecución y no se rotan. Se pueden archivar o borrar los antiguos a mano; no contienen secretos. |
| `.age` sin sidecar (ejecución interrumpida entre mover el artefacto y su hash) o sidecar huérfano | Un `.age` viejo lo elimina la retención por antigüedad; un sidecar sin `.age` no se borra solo (caso muy raro; revisar a mano). El preflight marca WARN si el último backup no tiene sidecar. |
| Temporales de pruebas manuales/Pester (`%TEMP%\daubert-*`) | **Manual**: no pertenecen al producto; las pruebas los limpian al terminar, solo quedan si se interrumpieron. |

No existe (ni debe existir) un limpiador genérico: solo hay esa limpieza acotada de staging.
## Retención

Por tier, sobre pares `.age`/`.age.sha256` reconocidos por nombre exacto; solo corre tras un backup válido de ese run y con protecciones de ruta (nunca fuera de `backupRoot`). `-DryRun` solo reporta qué se eliminaría. Ajustable en `config.json → retention`.

## Ejecución manual

```powershell
$cfg = "$env:ProgramData\DaubertHub\Backup\config.json"
.\scripts\backup\commands\Start-DaubertPostgresBackup.ps1 -Tier Frequent -ConfigPath $cfg
.\scripts\backup\commands\Start-DaubertPostgresBackup.ps1 -Tier Daily -ConfigPath $cfg -DryRun
```

Parámetros sobre-escribibles (prevalecen sobre `config.json`): `-BackupRoot`, `-StagingRoot`, `-LogRoot`, `-LockRoot`, `-PgBinPath`, `-PgPassFile`, `-PgHost`, `-PgPort`, `-PgUser`, `-PgDatabase`, `-SevenZipPath`, `-AgePath`, `-RecipientsFilePath`, `-LockFilePath`, `-LockTimeoutSeconds` (por defecto 0: falla de inmediato; las tareas Daily/Monthly pasan 900), `-SevenZipTimeoutSeconds`, `-AgeTimeoutSeconds`.

Switch `-OnlyIfDue` (solo Daily/Monthly; lo pasan las tareas programadas): si ya existe el backup publicado válido (`.age` + `.sha256` no vacío) del periodo actual, sale con exit `0` sin hacer nada; si no, hace el backup. Frequent lo ignora y sin él el script siempre hace el backup. Ver [Backups pendientes](#backups-pendientes-recuperación-tras-apagado-o-lock-ocupado).

### Los comandos siempre usan el código actual del repo (sin cerrar PowerShell)

Cada comando de `scripts/backup/commands/` carga sus módulos con el cargador central `lib\Import-DaubertBackupModules.ps1`, que **recarga con `-Force` la clausura de dependencias en orden** (hojas primero). Antes, `Import-Module BackupPipeline -Force` solo recargaba el pipeline y los módulos que este importa de forma anidada (p. ej. `BackupPgTools`) se reutilizaban desde la sesión: tras editar `BackupPgTools.psm1` una PowerShell ya abierta seguía ejecutando la versión anterior.

- Se recargan solo módulos Daubert (`Backup*.psm1` de `lib/`, por ruta explícita); nunca Pester ni módulos ajenos. Se importan en el ámbito del comando, no en el global.
- El grafo de dependencias está en el propio cargador y una prueba verifica que coincide con los `Import-Module` reales de cada módulo.
- Task Scheduler ejecuta cada backup en un proceso nuevo, así que esto beneficia sobre todo a desarrollo, mantenimiento y validaciones manuales.
- Solo para pruebas: `DAUBERT_BACKUP_NO_RELOAD=1` reutiliza los módulos ya cargados (para conservar mocks de Pester). Por defecto siempre se recarga.
### Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | Éxito completo. |
| `1` | Error inesperado / no clasificado. |
| `2` | No se pudo adquirir el lock (ejecución simultánea). |
| `3` | Prerrequisitos o `config.json` inválidos (falta un binario, pgpass, recipient, BackupRoot; o configuración con errores/secretos). |
| `4` | Falló `pg_dump` / `pg_dumpall`. |
| `5` | Falló la validación (`pg_restore -l`, o globals inexistente/vacío/sin sentencias reconocibles). |
| `6` | Falló el SHA-256. |
| `7` | Falló la publicación. |
| `8` | Publicado, pero falló la retención. |
| `9` | Falló el empaquetado 7z. |
| `10` | Falló el cifrado con age. |
| `11` | Falló la validación estructural del `.age` (no se publica). |
| `12` | El hash del archivo **ya publicado** no coincidió; se revirtió la publicación. |

## Logs

- **Backup**: JSON Lines en `<logRoot>\<TIER>\backup_<TIER>_<timestamp>_<runid>.log.jsonl` (`%ProgramData%\DaubertHub\Backup\logs\` por defecto; sin `logRoot`, `<backupRoot>\LOGS\<TIER>\`). Etapas: `lock`, `pg_dump`, `pg_restore_list`, `pg_dump_schema_only`, `pg_restore_list_schema_only`, `pg_dumpall_globals`, `package_bundle`, `encrypt_age`, `validate_age_structure`, `cleanup_plaintext`, `hash`, `publish_archive`, `verify_published_hash`, `retention_archive`, `run`. Nunca contienen contenido de dumps, la ruta/contenido del pgpass ni claves (verificado por test).
- **Task Scheduler**: historial de la tarea (Visor de eventos / `Get-ScheduledTaskInfo`); el exit code de la tarea es el del script.
- **Instalador / preflight**: salida por consola; nunca muestran contraseñas.

## Recuperación y restore

**Recuperar desde cero (host nuevo, sin el sistema de backup):** solo se necesita un backup `.age`, la **clave privada** (de la custodia), `age.exe`, 7-Zip y PostgreSQL client tools.

1. Traer `age-identity.txt` (clave privada) a una **estación de recuperación** (no al host productor).
2. Verificar el sidecar **antes** de descifrar:
   ```powershell
   $expected = (Get-Content "<archivo>.age.sha256" -Raw).Split(' ')[0]
   $actual = (Get-FileHash "<archivo>.age" -Algorithm SHA256).Hash.ToLower()
   $expected -eq $actual
   ```
3. Descifrar: `& "<ruta>\age.exe" -d -i age-identity.txt -o "<salida>" "<archivo>.age"`
4. Si el tier tenía varios artefactos (Daily/Monthly), la salida es un `.7z` sin cifrar: `7z x`.
5. Restaurar el `.dump` con `pg_restore` (siempre a una base **nueva** primero; ver [database-backup-restore.md](database-backup-restore.md)). `globals_*.sql` (solo Monthly, **sanitizado: sin contraseñas de roles**) con `psql -f` contra un clúster de prueba **distinto**, nunca PROD; después restablezca la contraseña de cada rol desde los secretos autorizados (los roles restaurados no tienen contraseña utilizable).

## Troubleshooting

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| Preflight `Backup user auth FAIL` | contraseña errónea, rol inexistente, `pg_hba.conf` | recrear el pgpass (`Install… → Reparar` o `Reconfigurar`); comprobar el rol y `\password` |
| `Database reachable FAIL` | servicio parado, host/puerto incorrectos | revisar `host`/`port` en `config.json` (`Reconfigurar`) |
| `age FAIL` / exit `3` | age no instalado o movido | instalarlo (https://github.com/FiloSottile/age/releases) y `Reparar` |
| `No age private key FAIL` | hay una identidad age en una ruta administrada | retirarla de esta máquina y custodiarla aparte |
| `PGPASS file WARN` (ACL) | el archivo es accesible a otros usuarios | `Install… → Reconfigurar` y reemplazar el pgpass |
| Exit `2` en una tarea | otra ejecución en curso (lock) | normal si coinciden tiers; si persiste, revisar un lock huérfano en `lockRoot` |
| Exit `3` desde la tarea | `config.json` movido/inválido | `Test-DaubertBackupEnvironment.ps1`, luego `Reparar` |
| `Scheduled Tasks WARN` | no registradas / deshabilitadas / última ejecución con error | `Register-DaubertBackupTasks.ps1`; revisar el historial de la tarea |
| Register: `Blocked` | ya existe una tarea con ese nombre no creada por Daubert | renombrarla/eliminarla a mano si es un resto antiguo |
| Register falla con S4U | la cuenta no tiene "Iniciar sesión como trabajo por lotes" | usar `-LogonType Interactive` o ajustar la política local |
| `Last valid backup WARN` | las tareas no corren / PC apagada | revisar tareas y logs; `StartWhenAvailable` recupera al encender |
| Un script de `scripts\backup` desaparece o no se puede escribir | antivirus/EDR en cuarentena o bloqueo por nombre | añadir una exclusión para `scripts\backup` y restaurar desde git |

## Seguridad

- Cifrado asimétrico: el host productor solo maneja clave pública; **jamás** la privada (validado por tests: ningún script/parámetro la admite y `age` solo se invoca para cifrar).
- La contraseña de PostgreSQL solo entra por `Read-Host -AsSecureString`; se convierte a texto el mínimo tiempo (BSTR liberado con `ZeroFreeBSTR`), nunca se imprime, loggea, guarda en config ni pasa por argumentos; solo vive en el pgpass (`host:port:db:user:password`, con `:` y `\` escapados, UTF-8 sin BOM) con ACL restrictiva aplicada **antes** de escribirla, y en `PGPASSFILE` del proceso hijo.
- `config.json` no admite secretos; su escritura es atómica y preserva la última configuración válida ante cualquier fallo.
- Los `.dump`/`.sql`/bundle en texto plano solo existen de forma efímera en staging (bajo el perfil del usuario, no en `ProgramData`); los `globals` nunca salen del artefacto cifrado.
- Task Scheduler: sin secretos en argumentos; nunca se tocan tareas ajenas.

## Pruebas

Pester 3.4.0 (incluido en Windows PowerShell 5.1). Ninguna prueba toca PostgreSQL, Task Scheduler, Dropbox, age real, secretos reales, n8n ni `.env.prod-temp`.

**Las pruebas no crean, compilan ni copian ejecutables** (antes se compilaba un binario sintético copiado como `pg_dump.exe`, `7z.exe`, `age.exe`, que los antivirus ponían en cuarentena). Ahora:

- Los procesos externos pasan por tres *seams* de producción que sí lanzan los binarios reales: `Invoke-ExternalProcess` (`BackupPgTools`: pg_dump/pg_restore/pg_dumpall), `Invoke-SevenZipProcess` (`BackupPackaging`) e `Invoke-AgeProcess` (`BackupEncryption`). Las pruebas los sustituyen con mocks de Pester (`tests\helpers\TestDoubles.ps1`) que simulan exit codes, stdout/stderr, archivos de salida y fallos de cada herramienta.
- La existencia de herramientas pasa por `Test-BackupToolPath` (mockeable): no hace falta ningún archivo con nombre de herramienta.
- El código real de los seams se prueba con binarios del propio Windows (`cmd.exe`, `PING.EXE`): exit code, stdout/stderr, variables de entorno, carpeta de trabajo y timeout.
- El pipeline completo se ejecuta en el mismo proceso (`Invoke-DaubertBackupRun`, `BackupPipeline.psm1`); el resto (staging, hash, publicación, retención, lock, logs) es código real sobre directorios temporales.
- `Portability.Tests.ps1` falla si reaparece `Add-Type`, un stub compilado o un archivo con nombre de herramienta real en las pruebas.

```powershell
Import-Module Pester -RequiredVersion 3.4.0
Invoke-Pester scripts\backup\tests
```

**884 pruebas** (toda la carpeta `scripts/backup/tests`, incluidas las del backup de n8n): motor de backup, configuración/pgpass/detección, instalador, preflight, Task Scheduler, config externa end-to-end, seams de procesos, portabilidad y recuperación de backups pendientes (`-OnlyIfDue`, espera del lock).

## Validación real

Ejecutada en el host productor contra `daubert_global` (rol `daubert_backup`, `pgpass` y recipients age reales; cifrado con la clave pública, sin clave privada en el job):

- **2026-09-29**: primeras ejecuciones reales de los tres tiers; `pg_dump`, `pg_restore -l`, cifrado con age, SHA-256 y publicación correctos.
- **Task Scheduler**: las tres tareas están registradas (`S4U`, cuenta del operador, `LeastPrivilege`).
- **2026-10-01 ~09:44**: tras reanudarse el equipo, Daily, Monthly y Frequent arrancaron a la vez (`StartWhenAvailable`); Frequent tomó el lock y Daily y Monthly salieron con exit `2` (lock ocupado, sin espera). Fue el origen del esquema actual (reintento horario con `-OnlyIfDue` y espera del lock).
- **2026-10-01 (tarde)**: se re-registraron Daily y Monthly con el esquema nuevo (Frequent quedó `Unchanged`). Cada una generó su backup real del día, su SHA-256 coincide con el `.sha256` publicado y una segunda ejecución terminó con exit `0` **sin** crear un segundo backup.

## Estado y pendientes

| Elemento | Estado |
| --- | --- |
| Motor de backup (age asimétrico, pipeline, retención, lock) | **IMPLEMENTED**, validado en `daubert_global` |
| Config externa, instalador, preflight, Task Scheduler reproducible | **IMPLEMENTED**, validado (tareas registradas y ejecutándose) |
| Recuperación de backups pendientes (`-OnlyIfDue`, espera del lock) | **IMPLEMENTED**, validada en el equipo real (Daily y Monthly, 2026-10-01) |
| Pruebas Pester (884, toda la carpeta `scripts/backup/tests`) | **IMPLEMENTED**, pasando |
| Documentación (este archivo) | **IMPLEMENTED** |
| age instalado, rol `daubert_backup`, `pgpass` real, par de claves age real | **VALIDADO** en las ejecuciones reales |
| Primera ejecución real de los tres tiers | **VALIDADO** (SHA-256 de los artefactos publicados verificado) |
| Registro real de tareas en Task Scheduler | **VALIDADO** (Daily y Monthly actualizadas el 2026-10-01) |
| Restore drill de un backup generado por esta automatización (Daily 2026-10-01, base temporal `daubert_restore_20261001`) | **VALIDADO** (PASS, 2026-10-01; ver [Restore drill 2026-10-01](#restore-drill-2026-10-01-backup-daily-generado-por-esta-automatización--pass)) |
| Ese restore drill con la clave privada age en una estación separada | **PENDIENTE** (el drill del 2026-10-01 se ejecutó en la estación del operador, dentro del mismo clúster PostgreSQL) |
| Restauración de los `globals` (roles) en un clúster PostgreSQL independiente | **PENDIENTE** |
| Recuperación tras una suspensión/reanudación real con el esquema `-OnlyIfDue` | **PENDIENTE** de observación (el 2026-10-01 se validó el re-registro y la no duplicación, no un catch-up real con el esquema nuevo) |

## Restore drill 2026-10-01 (backup Daily generado por esta automatización) — PASS

Primer restore drill de un artefacto generado por esta automatización (el del 2026-09-28, más abajo, fue manual y previo a ella). Backup restaurado: `daubert_global_DAILY_20261001_164644.age`, SHA-256 del `.age` `9eb2109afb724a0204056bdc14f09136b3b5a50c4b5432c80ee0777151661670` (coincidió con su `.sha256`).

Se ejecutó paso a paso con un script de drill local fuera del repositorio (`C:\RestoreDrill\drill.ps1`), con modo de simulación (`-ShowOnly`) revisado antes de cada paso real. Pasos, todos terminados correctamente: Prepare, Identity, Decrypt, Extract, Validate, CreateDb, Restore, Verify, DropDb, Cleanup.

- La restauración se hizo **exclusivamente** en la base temporal `daubert_restore_20261001`, dentro del mismo clúster; nunca sobre `daubert_global` ni `daubert_hub_test`.
- Prepare copió el `.age` y su `.sha256` a una carpeta de trabajo fuera de Dropbox y del repositorio y verificó el SHA-256 de la copia. Identity descifró la identidad age privada (custodiada cifrada en `RECOVERY\KEYS`) y comprobó que correspondía a un recipient de `age-recipients.txt`. Decrypt y Extract produjeron el dump completo y el dump de esquema; Validate los listó con `pg_restore --list`.

Resultados de Verify (`verify.sql`, que termina en `ROLLBACK;`, por lo que la verificación fue de solo lectura):

- Base restaurada: `daubert_restore_20261001`.
- Esquemas restaurados: `audit`, `core`, `operacion`, `ops`, `security`, `staging`.
- 13 funciones.
- `ops.fn_crear_ejecucion_automatizacion(...)`: MD5 `929939dcc7cd3ef0e09b7b2a868b9616`; el MD5 restaurado coincidió con el esperado.
- Permisos de `daubert_hub_app` verificados sobre `core.direcciones`, `core.alias_empresa` y `core.empresas_notificacion_pago`.
- 0 ejecuciones en estado `PROCESANDO`.
- Series documentales y folios verificados.

Cierre:

- `daubert_restore_20261001` fue eliminada (DropDb) y ya no existe.
- La carpeta de trabajo `C:\RestoreDrill\20261001` fue eliminada (Cleanup), incluida la identidad privada descifrada.
- El `.age` y el `.sha256` originales en Dropbox permanecieron intactos (tamaño y SHA-256 comprobados al final: 67 966 y 106 bytes).
- `daubert_global`, `daubert_hub_test` y `daubert_global_restore_test` permanecieron existentes.

Alcance: es una restauración **temporal en una base aislada**, no sobre producción, y no incluyó una prueba funcional del Hub contra la base restaurada. Se ejecutó en la estación del operador y en el mismo clúster, por lo que **no** cubre la clave privada en una estación separada ni la restauración de los `globals`; ambos siguen en [Estado y pendientes](#estado-y-pendientes).

## Restore drill 2026-09-28 (PostgreSQL + n8n, manual) — PASS

Ejecutado manualmente el 2026-09-28, fuera de esta automatización y antes de sus primeros backups reales (2026-09-29), por lo que no restauró un artefacto generado por ella. Resultado: **PASS**, con las siguientes salvedades y hallazgos documentados tal como se reportaron:

- **PostgreSQL**: restaurado en una **base de datos aislada dentro del mismo clúster PostgreSQL 18** (no una instancia bare-metal separada) — por lo tanto, **esta prueba NO valida la restauración de los `globals`** (roles y sus atributos a nivel de clúster), que requeriría un clúster distinto.
- Los **conteos críticos y los permisos** de la base restaurada coincidieron con lo esperado.
- **n8n** se recuperó desde el recovery package: la base SQLite pasó `PRAGMA integrity_check`.
- Se recuperaron **18 workflows** y **8 credenciales**; las 8 credenciales fueron descifrables con la `encryptionKey` restaurada.
- Se recuperaron los nodos comunitarios **n8n-nodes-htmlcsstopdf 3.2.5** y **n8n-nodes-pdfbolt 0.1.5**.
- La instancia n8n restaurada arrancó **aislada** en `127.0.0.1:15678`.
- Login y UI funcionaron correctamente.
- **Antes del arranque**, workflows, webhooks y ejecuciones en espera ("waiting executions") fueron **neutralizados** — la instancia de recuperación no pudo disparar nada contra sistemas reales.
- El **Python Task Runner NO arrancó** (faltaba su entorno virtual); el **JS Task Runner sí arrancó** correctamente.
- Las instancias y bases de datos temporales usadas para el drill se **eliminaron al finalizar**.
- El **backup cifrado validado permanece en Dropbox**.

Este drill demuestra que el *proceso de recuperación* de n8n funciona de punta a punta y que un backup de PostgreSQL restaura con integridad estructural — pero, al no ser bare-metal para PostgreSQL, no cubre la restauración de roles/`globals` a nivel de clúster; esa validación queda pendiente para una prueba futura con un clúster PostgreSQL independiente.
