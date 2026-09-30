<#
    .SYNOPSIS
    Elimina de forma segura la tarea programada "Daubert - n8n Weekly".

    .DESCRIPTION
    Solo elimina esa tarea (nombre exacto) y únicamente si conserva la marca de Daubert n8n en su
    descripción. No toca las tareas de PostgreSQL, ninguna tarea ajena, backups, configuración ni secretos.

    .NOTES
    Requiere PowerShell ELEVADA solo para eliminar de verdad; -WhatIf no la requiere.
    Códigos de salida: 0 correcto (o -WhatIf; repetirlo es seguro), 5 falta elevación (no se eliminó nada),
    6 Task Scheduler rechazó la eliminación, 7 UAC cancelado/denegado (sin cambios).
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$RequestElevation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('N8nTasks')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

$toRemove = @(Get-N8nTaskRemovalPlan | Where-Object { $_.State -eq 'Managed' })
$req = Get-ElevationRequirement -Operation 'UnregisterTasks' -WhatIf:$WhatIfPreference
$gate = Invoke-ElevationGate -Required ($req.Required -and $toRemove.Count -gt 0) -OperationName 'Eliminar la tarea programada de n8n' `
    -ScriptPath $PSCommandPath -RequestElevation:$RequestElevation -Parameters ([ordered]@{})
if ($gate.Action -ne 'Proceed') {
    Write-Host $gate.Message -ForegroundColor $(if ($gate.ExitCode -eq 0) { 'Green' } else { 'Red' })
    exit $gate.ExitCode
}
$r = Unregister-N8nTask -WhatIf:$WhatIfPreference
Write-Host ("  {0,-32} {1}" -f $r.TaskName, $r.Result)
if ($r.Result -eq 'Failed') {
    Write-Host "      Error de Task Scheduler: $($r.Error)" -ForegroundColor Red
    Write-Host 'ERROR: la eliminación FALLÓ; la tarea sigue registrada (repetir el comando es seguro).' -ForegroundColor Red
    exit 6
}
if ($r.Result -eq 'Skipped-Foreign') { Write-Warning 'La tarea con ese nombre no pertenece a Daubert Hub (n8n) y se omitió.' }
exit 0
