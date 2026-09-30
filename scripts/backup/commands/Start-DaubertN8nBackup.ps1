<#
    .SYNOPSIS
    Entrypoint canónico del backup de n8n (V1): snapshot SQLite consistente con
    node:sqlite, config + storage + nodes + manifest, bundle 7z SIN contraseña,
    cifrado ASIMÉTRICO con age (solo clave pública), SHA-256, publicación y retención.

    .DESCRIPTION
    Envoltorio fino: delega en lib\BackupN8nPipeline.psm1 (Invoke-DaubertN8nBackupRun).
    No detiene ni reinicia n8n, no modifica nada dentro de n8nRoot y nunca imprime
    el contenido del archivo 'config' (contiene material sensible).
    Precedencia: parámetro explícito del CLI > config.json (-ConfigPath) > detección
    portable (solo node/7z/age). Esta fase no registra tareas programadas.

    .PARAMETER Tier
    Weekly (retención 56 días) u OnChange (retención 90 días, ejecución manual).

    .PARAMETER ConfigPath
    Ruta a un config.json sin secretos (n8nRoot, nodePath, sevenZipPath, agePath,
    recipientsFilePath, backupRoot, stagingRoot, logRoot, lockRoot, retention).

    .PARAMETER DryRun
    Todo hasta el hash en staging; NO publica y NO borra en retención.

    .EXAMPLE
    .\commands\Start-DaubertN8nBackup.ps1 -Tier Weekly -ConfigPath <ruta\n8n-backup.json> -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Weekly', 'OnChange')]
    [string]$Tier,

    [switch]$DryRun,

    [string]$ConfigPath,

    [string]$N8nRoot,
    [string]$NodePath,
    [string]$SevenZipPath,
    [string]$AgePath,
    [string]$RecipientsFilePath,
    [string]$BackupRoot,
    [string]$StagingRoot,
    [string]$LogRoot,
    [string]$LockRoot,
    [string]$LockFilePath,
    [string]$N8nPackagePath,
    [int]$LockTimeoutSeconds = 0,
    [int]$NodeTimeoutSeconds = 600,
    [int]$SevenZipTimeoutSeconds = 600,
    [int]$AgeTimeoutSeconds = 600,
    [int]$StorageCopyAttempts = 3,
    [datetime]$Now = (Get-Date)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Recarga SIEMPRE el codigo actual del repo (clausura de dependencias, en orden); ver lib\Import-DaubertBackupModules.ps1.
$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('N8nPipeline')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

# Solo los parámetros de configuración pasados EXPLÍCITAMENTE prevalecen sobre config.json.
$cli = @{}
foreach ($name in 'N8nRoot', 'NodePath', 'SevenZipPath', 'AgePath', 'RecipientsFilePath', 'BackupRoot', 'StagingRoot', 'LogRoot', 'LockRoot', 'LockFilePath', 'N8nPackagePath') {
    if ($PSBoundParameters.ContainsKey($name)) { $cli[$name] = $PSBoundParameters[$name] }
}

$runParams = @{
    Tier                   = $Tier
    CliParameters          = $cli
    DryRun                 = $DryRun
    LockTimeoutSeconds     = $LockTimeoutSeconds
    NodeTimeoutSeconds     = $NodeTimeoutSeconds
    SevenZipTimeoutSeconds = $SevenZipTimeoutSeconds
    AgeTimeoutSeconds      = $AgeTimeoutSeconds
    StorageCopyAttempts    = $StorageCopyAttempts
    Now                    = $Now
}
if ($PSBoundParameters.ContainsKey('ConfigPath')) { $runParams.ConfigPath = $ConfigPath }

$exitCode = Invoke-DaubertN8nBackupRun @runParams
exit ([int]$exitCode)
