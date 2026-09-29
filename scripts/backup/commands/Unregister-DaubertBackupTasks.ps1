<#
    .SYNOPSIS
    Elimina de forma segura las tareas programadas del backup de Daubert Hub.

    .DESCRIPTION
    Solo elimina las 3 tareas administradas (nombres exactos) y únicamente si
    conservan la marca de Daubert Hub en su descripción. Una tarea con el
    mismo nombre pero sin la marca se omite. No toca ninguna otra tarea, ni
    backups, ni configuración, ni secretos.

    .EXAMPLE
    .\commands\Unregister-DaubertBackupTasks.ps1 -WhatIf

    .EXAMPLE
    .\commands\Unregister-DaubertBackupTasks.ps1 -Tier Frequent

    .NOTES
    Requiere una PowerShell ELEVADA (Administrador) solo para eliminar de verdad; -WhatIf no la requiere.
    No se autoeleva; la comprobación se hace ANTES de eliminar nada.

    Códigos de salida:
      0  correcto (o -WhatIf; repetirlo es seguro)
      2  -Tier inválido
      5  falta elevación y no se pidió -RequestElevation (no se eliminó nada)
      7  el usuario canceló/denegó el UAC solicitado con -RequestElevation (sin cambios; se puede reintentar)
      6  Task Scheduler rechazó la eliminación de alguna tarea (nunca se informa Removed si falló)
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string[]]$Tier = @('Frequent', 'Daily', 'Monthly'),
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

$toRemove = @(Get-BackupTaskRemovalPlan -Tier $Tier | Where-Object { $_.State -eq 'Managed' })
$req = Get-ElevationRequirement -Operation 'UnregisterTasks' -WhatIf:$WhatIfPreference
$gate = Invoke-ElevationGate -Required ($req.Required -and $toRemove.Count -gt 0) -OperationName 'Eliminar las tareas programadas' `
    -ScriptPath $PSCommandPath -RequestElevation:$RequestElevation -Parameters ([ordered]@{ Tier = $Tier })
if ($gate.Action -ne 'Proceed') {
    Write-Host $gate.Message -ForegroundColor $(if ($gate.ExitCode -eq 0) { 'Green' } else { 'Red' })
    exit $gate.ExitCode
}
$results = @(Unregister-BackupTasks -Tier $Tier -WhatIf:$WhatIfPreference)
foreach ($r in $results) {
    Write-Host ("  {0,-32} {1}" -f $r.TaskName, $r.Result)
    if ($r.Result -eq 'Failed') { Write-Host "      Error de Task Scheduler: $($r.Error)" -ForegroundColor Red }
}
if (@($results | Where-Object { $_.Result -eq 'Failed' }).Count -gt 0) {
    Write-Host 'ERROR: la eliminación FALLÓ; las tareas Failed/NotAttempted siguen registradas (repetir el comando es seguro).' -ForegroundColor Red
    exit 6
}
if (@($results | Where-Object { $_.Result -eq 'Skipped-Foreign' }).Count -gt 0) {
    Write-Warning 'Alguna tarea con nombre igual no pertenece a Daubert Hub y se omitió.'
}
exit 0
