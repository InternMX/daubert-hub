<#
    .SYNOPSIS
    Preflight NO destructivo del backup de n8n de Daubert Hub.

    .DESCRIPTION
    Comprueba n8n-config.json (existe, parsea, esquema válido, sin secretos), la instalación de n8n
    (n8nRoot, database.sqlite y el archivo 'config' -solo su existencia, NUNCA su contenido-), Node y
    node:sqlite (DatabaseSync y backup()), 7-Zip, age, destinatario público, ausencia de clave privada
    age en rutas administradas, backupRoot/staging/logs/locks, espacio libre, la tarea WEEKLY (definición
    exacta) y el último backup con su sidecar SHA-256.

    NO ejecuta snapshot ni backup, NO restaura, NO toca la SQLite de n8n, NO registra tareas.
    Códigos de salida: 0 = PASS, 1 = WARN, 2 = FAIL.

    .PARAMETER ConfigPath
    n8n-config.json (por defecto %ProgramData%\DaubertHub\Backup\n8n-config.json).

    .EXAMPLE
    .\commands\Test-DaubertN8nBackupEnvironment.ps1
#>
[CmdletBinding()]
param(
    [string]$ConfigPath,
    [double]$MinFreeSpaceGB = 5,
    [double]$MaxBackupAgeHours = 192,
    [switch]$SkipHashVerify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('N8nPreflight')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

if (-not $ConfigPath) { $ConfigPath = (Get-N8nDefaultPaths).ConfigPath }

$params = @{ ConfigPath = $ConfigPath; MinFreeSpaceGB = $MinFreeSpaceGB; MaxBackupAgeHours = $MaxBackupAgeHours }
if ($SkipHashVerify) { $params.SkipHashVerify = $true }

$result = Invoke-N8nPreflight @params
Write-Host ''
foreach ($line in (Format-PreflightReport -Result $result)) {
    $color = if ($line -match ' FAIL( |$)') { 'Red' } elseif ($line -match ' WARN( |$)') { 'Yellow' } elseif ($line -match ' PASS( |$)') { 'Green' } else { 'White' }
    Write-Host $line -ForegroundColor $color
}
exit $result.ExitCode
