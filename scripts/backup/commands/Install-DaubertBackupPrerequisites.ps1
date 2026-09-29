<#
    .SYNOPSIS
    Prepara las dependencias del subsistema de backup PostgreSQL desde el
    manifest declarativo scripts/backup/config/dependencies.json.

    .DESCRIPTION
    Idempotente: detecta cada dependencia (age, 7-Zip, PostgreSQL client tools
    con pg_dump/pg_restore/pg_dumpall, Windows PowerShell y, solo en desarrollo,
    Pester 3.4.0) y NO reinstala lo que ya existe y es compatible. Solo instala
    con winget cuando el manifest declara un packageId confiable; para lo demás
    (PostgreSQL client tools, Pester) o si winget no está disponible imprime la
    instrucción a seguir. No pide ni maneja secretos; no toca PostgreSQL, Task
    Scheduler, Dropbox, otros servicios ni PROD.

    Versiones: minimumVersion es el único requisito duro; validatedVersion es la
    versión probada por el equipo (informativa, no es un pin).

    Códigos de salida:
      0  todo satisfecho (o, con -WhatIf, nada que requiera acción manual)
      2  manifest inválido o inexistente
      3  requiere acción manual (instrucciones impresas)
      4  una instalación automática falló

    .PARAMETER Scope
    Production (por defecto), Development (solo Pester) o All.

    .PARAMETER CheckOnly
    Solo diagnostica; nunca instala.

    .EXAMPLE
    .\scripts\backup\commands\Install-DaubertBackupPrerequisites.ps1 -WhatIf

    .EXAMPLE
    .\scripts\backup\commands\Install-DaubertBackupPrerequisites.ps1 -Scope All
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ManifestPath,
    [ValidateSet('Production', 'Development', 'All')]
    [string]$Scope = 'Production',
    [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Recarga SIEMPRE el codigo actual del repo (clausura de dependencias, en orden); ver lib\Import-DaubertBackupModules.ps1.
$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('Prerequisites')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

if (-not $ManifestPath) { $ManifestPath = Get-DefaultManifestPath }
$manifest = Read-DependencyManifest -Path $ManifestPath
if (-not $manifest.IsValid) {
    Write-Host 'Manifest de dependencias inválido:'
    foreach ($e in $manifest.Errors) { Write-Host " - $e" }
    exit 2
}

Write-Host "Dependencias del backup (ámbito: $Scope)"
$results = @(Install-BackupPrerequisites -Manifest $manifest.Manifest -Scope $Scope -CheckOnly:$CheckOnly -WhatIf:$WhatIfPreference)

foreach ($r in $results) {
    Write-Host ('  {0,-20} {1,-15} {2}' -f $r.Id, $r.Result, $r.Detail)
    if ($r.Instructions) { Write-Host "      -> $($r.Instructions)" }
}

if (@($results | Where-Object { $_.Result -eq 'Failed' }).Count -gt 0) { exit 4 }
if (@($results | Where-Object { $_.Result -eq 'ManualRequired' }).Count -gt 0) { exit 3 }
exit 0
