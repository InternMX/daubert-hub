<#
    .SYNOPSIS
    Registra (idempotentemente) las 3 tareas programadas del backup de
    PostgreSQL de Daubert Hub, a partir de config.json.

    .DESCRIPTION
    Tareas administradas (las únicas que este script puede crear o modificar):
      - Daubert - PostgreSQL Frequent
      - Daubert - PostgreSQL Daily
      - Daubert - PostgreSQL Monthly

    Cada tarea ejecuta el entrypoint canónico (Start-DaubertPostgresBackup.ps1)
    con -Tier y -ConfigPath, SIN secretos en los argumentos, con
    MultipleInstancesPolicy=IgnoreNew. Los schedules salen de config.json
    (sección "schedules"; defaults centralizados en BackupConfig.psm1).

    Siempre muestra primero el PLAN (qué se creará/actualizará/omitirá).
    Con -WhatIf no cambia nada. Una tarea existente con el mismo nombre pero
    NO creada por Daubert Hub queda "Blocked" y no se toca.

    Nada de esto se ejecuta automáticamente: Install-DaubertBackup.ps1 solo
    lo ofrece tras confirmación explícita.

    .PARAMETER ConfigPath
    config.json (por defecto %ProgramData%\DaubertHub\Backup\config.json).

    .PARAMETER LogonType
    S4U (por defecto): la tarea corre aunque no haya sesión iniciada y sin
    guardar contraseña. Interactive: solo corre con la sesión del usuario abierta.

    .EXAMPLE
    .\commands\Register-DaubertBackupTasks.ps1 -WhatIf

    .EXAMPLE
    .\commands\Register-DaubertBackupTasks.ps1

    .NOTES
    Requiere una PowerShell ELEVADA (Administrador) solo para registrar de verdad; -WhatIf y las
    ejecuciones sin cambios pendientes no la requieren. Ejecutar los backups NO requiere
    administrador. No se autoeleva. La comprobación se hace ANTES de tocar ninguna tarea.

    Códigos de salida:
      0  correcto (o -WhatIf)
      3  config.json inválido/inexistente o falta el entrypoint canónico
      4  existe una tarea con ese nombre que NO es de Daubert (no se toca)
      2  -Tier inválido
      5  falta elevación y no se pidió -RequestElevation (no se modificó nada)
      7  el usuario canceló/denegó el UAC solicitado con -RequestElevation (sin cambios; se puede reintentar)
      6  Task Scheduler rechazó el registro de alguna tarea (Failed/NotAttempted; nunca se informa Created/Updated si falló)
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ConfigPath,
    [ValidateSet('S4U', 'Interactive')]
    [string]$LogonType = 'S4U',
    [string[]]$Tier = @('Frequent', 'Daily', 'Monthly'),
    # Cuenta propietaria de las tareas (por defecto la actual). Al relanzar elevado se conserva la cuenta original.
    [string]$TaskUser,
    # Consentimiento EXPLICITO para pedir el UAC de Windows si falta elevación (lo usa el wizard). Sin él: fail fast (exit 5).
    [switch]$RequestElevation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Recarga SIEMPRE el codigo actual del repo (clausura de dependencias, en orden); ver lib\Import-DaubertBackupModules.ps1.
$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('Tasks')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

$Tier = @($Tier | ForEach-Object { $_ -split ',' } | Where-Object { $_ } | ForEach-Object { $_.Trim() })
foreach ($tierName in $Tier) { if (@('Frequent', 'Daily', 'Monthly') -notcontains $tierName) { Write-Host "ERROR: -Tier '$tierName' no es válido (Frequent, Daily, Monthly)." -ForegroundColor Red; exit 2 } }
if (-not $ConfigPath) { $ConfigPath = (Get-DefaultBackupPaths).ConfigPath }
if (-not $TaskUser) { $TaskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name }

$cfg = Read-LocalBackupConfig -Path $ConfigPath
if (-not $cfg.IsValid) {
    Write-Error "config.json inválido o inexistente ($ConfigPath). Ejecute Install-DaubertBackup.ps1 primero:" -ErrorAction Continue
    foreach ($e in $cfg.Errors) { Write-Host " - $e" }
    exit 3
}

$scriptPath = Join-Path $PSScriptRoot 'Start-DaubertPostgresBackup.ps1'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    Write-Error "No se encuentra el entrypoint canónico: $scriptPath" -ErrorAction Continue
    exit 3
}

$plan = Get-BackupTaskPlan -LocalConfig $cfg.Config -ScriptPath $scriptPath -ConfigPath $ConfigPath -Tier $Tier -LogonType $LogonType -UserId $TaskUser

Write-Host ''
Write-Host 'Plan de tareas programadas de Daubert Hub (nada se aplica con -WhatIf):'
foreach ($line in (Format-BackupTaskPlan -Plan $plan)) { Write-Host $line }
Write-Host ''
$pending = @($plan | Where-Object { $_.Action -in 'Create', 'Update' })
$req = Get-ElevationRequirement -Operation 'RegisterTasks' -WhatIf:$WhatIfPreference
$gate = Invoke-ElevationGate -Required ($req.Required -and $pending.Count -gt 0) -OperationName 'Registrar las tareas programadas' `
    -ScriptPath $PSCommandPath -RequestElevation:$RequestElevation `
    -Parameters ([ordered]@{ ConfigPath = $ConfigPath; LogonType = $LogonType; Tier = $Tier; TaskUser = $TaskUser })
if ($gate.Action -ne 'Proceed') {
    # FailFast (5): nada se modificó. Cancelled (7): UAC cancelado, sin cambios. Relaunched: se propaga el código del proceso elevado.
    Write-Host $gate.Message -ForegroundColor $(if ($gate.ExitCode -eq 0) { 'Green' } else { 'Red' })
    exit $gate.ExitCode
}
$results = @(Register-BackupTasks -Plan $plan -WhatIf:$WhatIfPreference)
foreach ($r in $results) {
    Write-Host ("  {0,-32} {1}" -f $r.TaskName, $r.Result)
    if ($r.Result -eq 'Failed') { Write-Host "      Error de Task Scheduler: $($r.Error)" -ForegroundColor Red }
}

if (@($results | Where-Object { $_.Result -eq 'Failed' }).Count -gt 0) {
    Write-Host 'ERROR: el registro FALLÓ; las tareas marcadas Failed/NotAttempted no quedaron registradas. Las tareas ya registradas antes del fallo se conservan (repetir el comando es seguro).' -ForegroundColor Red
    exit 6
}
if (@($results | Where-Object { $_.Result -eq 'Blocked' }).Count -gt 0) {
    Write-Warning 'Alguna tarea existente con nombre igual NO pertenece a Daubert Hub y no se modificó. Renómbrela o elimínela manualmente si es un resto antiguo.'
    exit 4
}
exit 0
