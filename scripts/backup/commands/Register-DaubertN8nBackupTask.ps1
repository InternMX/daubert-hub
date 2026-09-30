<#
    .SYNOPSIS
    Registra (idempotentemente) la tarea programada del backup WEEKLY de n8n:
    "Daubert - n8n Weekly", a partir de n8n-config.json.

    .DESCRIPTION
    Única tarea que este script puede crear o modificar: "Daubert - n8n Weekly".
    Ejecuta el entrypoint canónico (Start-DaubertN8nBackup.ps1) con -Tier Weekly y -ConfigPath,
    SIN secretos en los argumentos, con MultipleInstancesPolicy=IgnoreNew, S4U, LeastPrivilege,
    StartWhenAvailable y límite de ejecución PT4H. El horario sale de n8n-config.json
    (schedules.Weekly; por defecto domingo 04:30).

    El tier ON_CHANGE NO tiene tarea: se ejecuta a mano con
      Start-DaubertN8nBackup.ps1 -Tier OnChange -ConfigPath <n8n-config.json>

    No toca las tareas de PostgreSQL ni ninguna tarea ajena (un nombre igual sin la marca de
    Daubert n8n queda "Blocked"). Con -WhatIf no cambia nada.

    .PARAMETER ConfigPath
    n8n-config.json (por defecto %ProgramData%\DaubertHub\Backup\n8n-config.json; NUNCA config.json de PostgreSQL).

    .PARAMETER RequestElevation
    Consentimiento EXPLÍCITO para pedir el UAC de Windows si falta elevación (una sola vez).

    .NOTES
    Códigos de salida (mismos que Register-DaubertBackupTasks.ps1):
      0  correcto (o -WhatIf)
      3  n8n-config.json inválido/inexistente o falta el entrypoint canónico
      4  existe una tarea con ese nombre que NO es de Daubert (no se toca)
      5  falta elevación y no se pidió -RequestElevation (no se modificó nada)
      6  Task Scheduler rechazó el registro (nunca se informa Created/Updated si falló)
      7  el usuario canceló/denegó el UAC (sin cambios; se puede reintentar)
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ConfigPath,
    [ValidateSet('S4U', 'Interactive')]
    [string]$LogonType = 'S4U',
    # Cuenta propietaria de la tarea (por defecto la actual). Al relanzar elevado se conserva la cuenta original.
    [string]$TaskUser,
    [switch]$RequestElevation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('N8nTasks')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

if (-not $ConfigPath) { $ConfigPath = (Get-N8nDefaultPaths).ConfigPath }
if (-not $TaskUser) { $TaskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name }

$cfg = Read-N8nBackupConfigFile -Path $ConfigPath
if (-not $cfg.IsValid) {
    Write-Error "n8n-config.json inválido o inexistente ($ConfigPath). Ejecute Install-DaubertN8nBackup.ps1 primero:" -ErrorAction Continue
    foreach ($e in $cfg.Errors) { Write-Host " - $e" }
    exit 3
}

$scriptPath = Join-Path $PSScriptRoot 'Start-DaubertN8nBackup.ps1'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    Write-Error "No se encuentra el entrypoint canónico: $scriptPath" -ErrorAction Continue
    exit 3
}

$plan = Get-N8nTaskPlan -Config $cfg.Config -ScriptPath $scriptPath -ConfigPath $ConfigPath -LogonType $LogonType -UserId $TaskUser

Write-Host ''
Write-Host 'Plan de la tarea programada del backup de n8n (nada se aplica con -WhatIf):'
foreach ($line in (Format-N8nTaskPlan -Plan $plan)) { Write-Host $line }
Write-Host ''
$pending = @($plan | Where-Object { $_.Action -in 'Create', 'Update' })
$req = Get-ElevationRequirement -Operation 'RegisterTasks' -WhatIf:$WhatIfPreference
$gate = Invoke-ElevationGate -Required ($req.Required -and $pending.Count -gt 0) -OperationName 'Registrar la tarea programada de n8n' `
    -ScriptPath $PSCommandPath -RequestElevation:$RequestElevation `
    -Parameters ([ordered]@{ ConfigPath = $ConfigPath; LogonType = $LogonType; TaskUser = $TaskUser })
if ($gate.Action -ne 'Proceed') {
    Write-Host $gate.Message -ForegroundColor $(if ($gate.ExitCode -eq 0) { 'Green' } else { 'Red' })
    exit $gate.ExitCode
}
$results = @(Register-N8nTask -Plan $plan -WhatIf:$WhatIfPreference)
foreach ($r in $results) {
    Write-Host ("  {0,-32} {1}" -f $r.TaskName, $r.Result)
    if ($r.Result -eq 'Failed') { Write-Host "      Error de Task Scheduler: $($r.Error)" -ForegroundColor Red }
}
if (@($results | Where-Object { $_.Result -eq 'Failed' }).Count -gt 0) {
    Write-Host 'ERROR: el registro FALLÓ; la tarea no quedó registrada (repetir el comando es seguro).' -ForegroundColor Red
    exit 6
}
if (@($results | Where-Object { $_.Result -eq 'Blocked' }).Count -gt 0) {
    Write-Warning 'Una tarea existente con nombre igual NO pertenece a Daubert Hub (n8n) y no se modificó. Renómbrela o elimínela manualmente si es un resto antiguo.'
    exit 4
}
exit 0
