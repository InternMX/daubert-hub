<#
    .SYNOPSIS
    Preflight NO destructivo del sistema de backups de PostgreSQL de Daubert Hub.

    .DESCRIPTION
    Comprueba configuración, herramientas (PostgreSQL, 7-Zip, age), conectividad
    y autenticación del usuario de backup (mediante PGPASSFILE, sin mostrar su
    ruta ni su contenido), destinatario público age, ausencia de clave privada
    age en rutas administradas, escritura en backup root/staging/logs/locks,
    espacio libre, estado de las tareas programadas y último backup válido con
    su sidecar SHA-256.

    NO genera backups, NO modifica PostgreSQL, NO registra tareas.
    (Solo crea y borra de inmediato un archivo de sondeo en las carpetas cuya
    escritura verifica.)

    Códigos de salida: 0 = PASS, 1 = WARN, 2 = FAIL.

    .PARAMETER ConfigPath
    config.json (por defecto %ProgramData%\DaubertHub\Backup\config.json).

    .PARAMETER MinFreeSpaceGB
    Espacio libre mínimo recomendado (WARN por debajo; FAIL por debajo del 20%).

    .PARAMETER MaxBackupAgeHours
    Antigüedad máxima aceptable del último backup válido (por defecto, 2x el
    intervalo del tier Frequent).

    .EXAMPLE
    .\commands\Test-DaubertBackupEnvironment.ps1
#>
[CmdletBinding()]
param(
    [string]$ConfigPath,
    [double]$MinFreeSpaceGB = 5,
    [Nullable[double]]$MaxBackupAgeHours = $null,
    [switch]$SkipHashVerify,
    [switch]$SkipDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Recarga SIEMPRE el codigo actual del repo (clausura de dependencias, en orden); ver lib\Import-DaubertBackupModules.ps1.
$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('Preflight', 'Prerequisites')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

if (-not $ConfigPath) { $ConfigPath = (Get-DefaultBackupPaths).ConfigPath }

$params = @{ ConfigPath = $ConfigPath; MinFreeSpaceGB = $MinFreeSpaceGB }
if ($null -ne $MaxBackupAgeHours) { $params.MaxBackupAgeHours = $MaxBackupAgeHours }
if ($SkipHashVerify) { $params.SkipHashVerify = $true }
if ($SkipDatabase) { $params.SkipDatabase = $true }

$params.DependencyChecker = {
    $m = Read-DependencyManifest
    if (-not $m.IsValid) { throw 'manifest invalido' }
    Get-PrerequisiteReport -Manifest $m.Manifest -Scope Production
}
$result = Invoke-BackupPreflight @params
Write-Host ''
foreach ($line in (Format-PreflightReport -Result $result)) {
    $color = if ($line -match ' FAIL( |$)') { 'Red' } elseif ($line -match ' WARN( |$)') { 'Yellow' } elseif ($line -match ' PASS( |$)') { 'Green' } else { 'White' }
    Write-Host $line -ForegroundColor $color
}
exit $result.ExitCode
