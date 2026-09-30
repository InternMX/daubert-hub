# Backup automatizado de n8n (V1)

Backup cifrado, verificable y portable de la instalación de n8n de Daubert Hub. Es independiente del backup de
PostgreSQL (`postgresql-backup-automation.md`): comparte herramientas genéricas (7-Zip, age, destinatarios públicos,
locks, logs, retención) pero **no comparte configuración, tareas programadas ni entrypoint**.

## Qué se respalda

El bundle plaintext temporal contiene exactamente:

| Elemento | Notas |
|---|---|
| `database.sqlite` | **Snapshot** creado con `node:sqlite` (`DatabaseSync` + `backup()`) mientras n8n sigue en marcha. Nunca se copia el `.sqlite` original ni su WAL/SHM. |
| `config` | Obligatorio. Contiene material sensible (la clave de cifrado de credenciales de n8n). Solo se copia: jamás se lee ni se imprime. |
| `storage\` | Copia estable (inventario antes/después, hasta 3 intentos). Se omite si no existe. |
| `nodes\` | Se omite si no existe. |
| `manifest.json` | Solo metadata: versiones, tamaños, conteos y `quick_check`. Sin rutas absolutas, usuario, secretos ni contenido de `config`. |

No se incluyen: `database.sqlite` original, `-wal`, `-shm`, `logs\`, `n8nEventLog*.log`.

Flujo: staging plaintext → `.7z` **sin contraseña** → `age` con recipient **público** → validación estructural →
eliminación de todo el plaintext → SHA-256 → publicación `.age` + `.age.sha256` → retención.
El productor nunca necesita ni admite la identidad (clave privada) de age.

## Tiers

| Tier | Ejecución | Retención | Destino | Artefacto |
|---|---|---|---|---|
| **Weekly** | Tarea programada `Daubert - n8n Weekly` (domingo 04:30 por defecto) | 56 días | `<backupRoot>\N8N\WEEKLY` | `n8n_WEEKLY_yyyyMMdd_HHmmss.age` |
| **OnChange** | **Manual** (no tiene tarea ni schedule) | 90 días | `<backupRoot>\N8N\ON_CHANGE` | `n8n_ON_CHANGE_yyyyMMdd_HHmmss.age` |

Ejecutar OnChange (por ejemplo, tras cambiar workflows o credenciales importantes):

```powershell
.\scripts\backup\commands\Start-DaubertN8nBackup.ps1 -Tier OnChange -ConfigPath "$env:ProgramData\DaubertHub\Backup\n8n-config.json"
```

No hay detección automática de cambios todavía.

## Layout (código ≠ configuración ≠ secretos ≠ datos)

| Qué | Dónde |
|---|---|
| Código | repo `scripts\backup\` (`commands\`, `lib\BackupN8n*.psm1`, `helpers\n8n-sqlite-snapshot.js`) |
| Configuración n8n | `%ProgramData%\DaubertHub\Backup\n8n-config.json` |
| Configuración PostgreSQL (**no se toca**) | `%ProgramData%\DaubertHub\Backup\config.json` |
| Destinatarios públicos age | `%ProgramData%\DaubertHub\Backup\age-recipients.txt` (puede compartirse con PostgreSQL: son claves públicas) |
| Logs / locks | `<logRoot>\N8N\<TIER>\`, `<lockRoot>\n8n-backup.lock` (lock propio, distinto del de PostgreSQL) |
| Staging plaintext efímero | `<stagingRoot>\n8n\<RunId>\` (se borra siempre; los huérfanos se limpian al inicio) |
| Backups | `<backupRoot>\N8N\...` (ruta externa configurable; puede ser la misma `backupRoot` que PostgreSQL) |

### `n8n-config.json`

Sin secretos (se rechazan claves como password/token/encryption/identity y valores con forma de clave privada age).
Las rutas locales sí se guardan: es su propósito.

```json
{
  "schemaVersion": 1,
  "n8nRoot": "<carpeta .n8n>",
  "nodePath": "<ruta a node.exe>",
  "n8nPackagePath": "<opcional: carpeta del paquete npm de n8n>",
  "sevenZipPath": "<ruta a 7z.exe>",
  "agePath": "<ruta a age.exe>",
  "recipientsFilePath": "<ruta a age-recipients.txt>",
  "backupRoot": "<carpeta destino>",
  "stagingRoot": "<carpeta staging>",
  "logRoot": "<carpeta logs>",
  "lockRoot": "<carpeta locks>",
  "retention": {
    "Weekly":   { "unit": "Days", "value": 56 },
    "OnChange": { "unit": "Days", "value": 90 }
  },
  "schedules": {
    "Weekly": { "dayOfWeek": "Sunday", "time": "04:30" }
  }
}
```

`schedules.OnChange` no existe y se rechaza. `stagingRoot` y `backupRoot` no pueden estar dentro de `n8nRoot`.
`n8nPackagePath` solo sirve para registrar la versión de n8n en el manifest.

## Instalación

```powershell
.\scripts\backup\commands\Install-DaubertN8nBackup.ps1
```

Detecta `%USERPROFILE%\.n8n`, valida que existan `database.sqlite` y `config` (**solo existencia**), detecta Node y
comprueba que soporta `node:sqlite` con `backup()` (Node ≥ 22.16), reutiliza 7-Zip/age/destinatarios/destino ya
configurados para PostgreSQL (solo los lee como sugerencia) y escribe `n8n-config.json` de forma atómica e idempotente.
No ejecuta backups y pregunta si se desea registrar la tarea WEEKLY (**default NO**). Modos: `-Mode Auto|Validate|Repair|Reconfigure|Cancel`.

La elevación (UAC) se pide solo si escribir en `%ProgramData%` realmente la necesita y con `-RequestElevation`;
nada se ejecuta siempre como administrador.

## Preflight

```powershell
.\scripts\backup\commands\Test-DaubertN8nBackupEnvironment.ps1
```

Solo lectura: no ejecuta snapshot ni backup, no restaura, no abre la SQLite de n8n y no lee `.n8n\config`.
Comprueba PowerShell ≥ 5.1; `n8n-config.json` (existe, parsea, esquema, sin secretos); `n8nRoot`, `database.sqlite`
y `config`; Node, su versión, `node:sqlite`, `DatabaseSync` y `backup()`; 7-Zip; age; destinatarios públicos;
ausencia de clave privada age en rutas administradas; `backupRoot` (existe y es escribible), staging, logs, locks;
espacio libre; la tarea WEEKLY (definición exacta); y el último backup con su sidecar SHA-256.

Salida: **PASS → exit 0**, **WARN → exit 1**, **FAIL → exit 2**. Antes de registrar la tarea, su ausencia es WARN.

## Task Scheduler

Única tarea administrada: **`Daubert - n8n Weekly`** (las tres tareas de PostgreSQL no se tocan).

```powershell
.\scripts\backup\commands\Register-DaubertN8nBackupTask.ps1 -WhatIf               # previsualizar (sin admin)
.\scripts\backup\commands\Register-DaubertN8nBackupTask.ps1 -RequestElevation     # registrar (UAC una vez)
.\scripts\backup\commands\Unregister-DaubertN8nBackupTask.ps1 -RequestElevation   # eliminar
```

Acción: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<repo>\scripts\backup\commands\Start-DaubertN8nBackup.ps1" -Tier Weekly -ConfigPath "<ruta real a n8n-config.json>"`,
directorio de trabajo `scripts\backup\commands`. Política: logon `S4U`, `RunLevel LeastPrivilege`,
`MultipleInstances IgnoreNew`, `StartWhenAvailable`, límite `PT4H`, ejecución con batería permitida. La cuenta es la del
usuario que instala. El horario sale de `n8n-config.json`. Idempotente: una tarea con el mismo nombre pero sin la marca
`DaubertHub-Managed-N8nBackup` queda *Blocked* y no se modifica.

Códigos de salida: `0` correcto/`-WhatIf`; `3` config inválido o falta el entrypoint; `4` tarea ajena con ese nombre;
`5` falta elevación y no se pidió `-RequestElevation` (no se modificó nada); `6` Task Scheduler rechazó la operación;
`7` UAC cancelado/denegado (sin cambios; se puede reintentar).

## Requisitos para restaurar

El restore es manual (no está automatizado). Hacen falta, **fuera de esta máquina**: la identidad (clave privada) de age,
age, 7-Zip y una instalación de n8n compatible con la versión del `manifest.json`. Pasos de alto nivel: descifrar el
`.age`, extraer el `.7z`, comprobar `PRAGMA quick_check`, restaurar `database.sqlite`, **`config`** (sin él las
credenciales no se pueden descifrar), `storage\` y `nodes\`, y arrancar n8n primero en un puerto aislado.
El restore drill real de la V1 se validó así (quick_check ok, credenciales descifradas con el `config` recuperado, `/healthz` 200).

> **No deje archivos de recuperación en texto plano.** Tras un restore o un drill, elimine de forma segura el `.7z`
> intermedio, el `database.sqlite` restaurado y especialmente `config`: contienen la clave de cifrado de credenciales y
> todos los datos. Nunca los guarde en Dropbox ni en carpetas sincronizadas.

## Limitaciones conocidas (no corregidas en esta fase)

- `manifest.communityNodes` puede quedar vacío o incompleto aunque `nodes\` se respalde correctamente. La metadata de
  community packages es solo informativa; el directorio físico `nodes\` **sigue incluido** en los backups y es la fuente de verdad.
- No hay detección automática de cambios para `OnChange`.
- La versión de n8n se registra como `unknown` si no se puede determinar (configure `n8nPackagePath`).
