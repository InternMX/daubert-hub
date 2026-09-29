# Backup automatizado y cifrado (asimétrico) de PostgreSQL

**Estado: IMPLEMENTED / PENDING PROD VALIDATION.** Motor de backup, instalador, preflight, Task Scheduler reproducible y pruebas (619 Pester) están completos. **age NO está instalado** en esta máquina (no se instala automáticamente) y **el sistema no se ha ejecutado nunca contra `daubert_global` ni contra el destino real**; el rol `daubert_backup`, el `pgpass`, el par de claves age real y el registro de tareas siguen **PENDING PROD VALIDATION** (ver [Validación real](#validación-real-pendiente)).

Complementa a [database-backup-restore](database-backup-restore.md) (restauración de PostgreSQL). El **restore drill de n8n/PostgreSQL del 2026-09-28** SÍ se ejecutó realmente: [Restore drill 2026-09-28](#restore-drill-2026-09-28-postgresql--n8n-manual-pass).

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
  tests/                       Pester (619 pruebas)
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
| `Daily` | 1 vez al día, 02:00 | 30 días | dump + schema-only | `DAILY\` |
| `Monthly` | día 1 de cada mes, 03:00 | 12 meses | dump + schema-only + **globals sanitizados** | `MONTHLY\` |

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

- Definidas por XML generado (`New-BackupTaskXml`) y registradas con `Register-ScheduledTask -Xml` (cubre el trigger mensual, que PS 5.1 no soporta con sus cmdlets).
- Ejecutan `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<repo>\scripts\backup\commands\Start-DaubertPostgresBackup.ps1" -Tier <Tier> -ConfigPath "<config.json>"`. **Sin secretos en los argumentos.**
- `MultipleInstancesPolicy = IgnoreNew`; coexisten con el lock interno (si dos tiers coinciden, el segundo sale con exit `2`, sin daño). `StartWhenAvailable` recupera ejecuciones perdidas; límite de ejecución 4 h.
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

### Configuración exacta de las tres tareas

| Tarea | Horario | Retención (config) |
| --- | --- | --- |
| `Daubert - PostgreSQL Frequent` | cada 4 h, todos los días, empezando a las 00:30 | 7 días |
| `Daubert - PostgreSQL Daily` | todos los días a las 02:00 | 30 días |
| `Daubert - PostgreSQL Monthly` | día 1 de cada mes a las 03:00 | 12 meses |

Todas ejecutan `powershell.exe` (Windows PowerShell 5.1, ruta completa) con `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<repo>\scripts\backup\commands\Start-DaubertPostgresBackup.ps1" -Tier <Tier> -ConfigPath "C:\ProgramData\DaubertHub\Backup\config.json"`. Rutas absolutas resueltas al registrar (no dependen del directorio actual; `WorkingDirectory` = carpeta del script). `-ExecutionPolicy Bypass` es necesario porque los scripts no están firmados y la política por defecto de Windows PowerShell en clientes es `Restricted`; solo afecta a ese proceso.

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

Parámetros sobre-escribibles (prevalecen sobre `config.json`): `-BackupRoot`, `-StagingRoot`, `-LogRoot`, `-LockRoot`, `-PgBinPath`, `-PgPassFile`, `-PgHost`, `-PgPort`, `-PgUser`, `-PgDatabase`, `-SevenZipPath`, `-AgePath`, `-RecipientsFilePath`, `-LockFilePath`, `-LockTimeoutSeconds`, `-SevenZipTimeoutSeconds`, `-AgeTimeoutSeconds`.

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

**619 pruebas**: motor de backup, configuración/pgpass/detección, instalador, preflight, Task Scheduler, config externa end-to-end, seams de procesos y portabilidad.

## Validación real (pendiente)

Nada de esto se ha ejecutado contra sistemas reales. Orden sugerido (cada paso requiere aprobación humana): instalar age → crear el rol `daubert_backup` → `Install-DaubertBackup.ps1` → `Test-DaubertBackupEnvironment.ps1` → `-DryRun` contra una carpeta de prueba → backup real a carpeta de prueba + restore drill con la clave privada en otra estación → apuntar al destino real → `Register-DaubertBackupTasks.ps1`.

## Estado y pendientes

| Elemento | Estado |
| --- | --- |
| Motor de backup (age asimétrico, pipeline, retención, lock) | **IMPLEMENTED** |
| Config externa, instalador, preflight, Task Scheduler reproducible | **IMPLEMENTED** |
| Pruebas Pester (619) | **IMPLEMENTED**, pasando |
| Documentación (este archivo) | **IMPLEMENTED** |
| Instalación de age | **PENDIENTE** (manual; el instalador no instala dependencias) |
| Rol `daubert_backup`, pgpass real, par de claves age real | **PENDING PROD VALIDATION** |
| Primera ejecución real y restore drill con clave privada en estación separada | **PENDING PROD VALIDATION** |
| Registro real de tareas en Task Scheduler | **PENDING PROD VALIDATION** |

## Restore drill 2026-09-28 (PostgreSQL + n8n, manual) — PASS

Ejecutado manualmente el 2026-09-28, fuera de esta automatización (que aún no genera backups reales). Resultado: **PASS**, con las siguientes salvedades y hallazgos documentados tal como se reportaron:

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
