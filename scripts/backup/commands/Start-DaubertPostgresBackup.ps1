<#
    .SYNOPSIS
    Entrypoint canónico del backup automatizado de PostgreSQL (daubert_global)
    por tier: dump validado, empaquetado, cifrado ASIMÉTRICO con age (solo
    clave pública), SHA-256, publicación atómica y retención.

    .DESCRIPTION
    Envoltorio fino: reúne los parámetros del CLI y delega en
    lib\BackupPipeline.psm1 (Invoke-DaubertBackupRun), que contiene el
    pipeline completo. Ver docs/operations/postgresql-backup-automation.md.

    Precedencia de configuración: parámetro explícito del CLI > config.json
    (-ConfigPath) > detección portable. Sin -ConfigPath NO se lee
    %ProgramData%. Las tareas programadas siempre pasan -ConfigPath.

    Nunca imprime la contraseña de PostgreSQL ni contenido de dumps/pgpass.

    .PARAMETER Tier
    Frequent (solo dump), Daily (dump + schema-only) o Monthly (dump +
    schema-only + globals).

    .PARAMETER ConfigPath
    Ruta a config.json (normalmente %ProgramData%\DaubertHub\Backup\config.json).

    .PARAMETER DryRun
    Todo hasta el hash en staging; NO publica y NO borra en retención.

    .PARAMETER OnlyIfDue
    Solo Daily/Monthly (las tareas programadas lo pasan): si ya existe el backup publicado VÁLIDO
    (.age + .sha256) del periodo actual, sale con 0 sin hacer nada; si no, hace el backup. Permite
    reintentos periódicos del Task Scheduler sin duplicar. Frequent lo ignora.

    .PARAMETER LockTimeoutSeconds
    Segundos a esperar si otra ejecución tiene backup.lock antes de salir con exit 2 (por defecto 0:
    falla de inmediato). Las tareas Daily/Monthly lo toman de config.json (schedules.<Tier>.lockTimeoutSeconds).

    .EXAMPLE
    .\commands\Start-DaubertPostgresBackup.ps1 -Tier Frequent -ConfigPath "$env:ProgramData\DaubertHub\Backup\config.json"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Frequent', 'Daily', 'Monthly')]
    [string]$Tier,

    [switch]$DryRun,

    [switch]$OnlyIfDue,

    [string]$ConfigPath,

    [string]$BackupRoot,
    [string]$StagingRoot,
    [string]$PgBinPath,
    [string]$PgPassFile,
    [string]$PgHost,
    [int]$PgPort,
    [string]$PgUser,
    [string]$PgDatabase,
    [string]$SevenZipPath,
    [string]$AgePath,
    [string]$RecipientsFilePath,
    [string]$LogRoot,
    [string]$LockRoot,
    [string]$LockFilePath,
    [Nullable[bool]]$IncludeGlobals,
    [Nullable[bool]]$SchemaOnlySnapshot,
    [int]$LockTimeoutSeconds = 0,
    [int]$SevenZipTimeoutSeconds = 300,
    [int]$AgeTimeoutSeconds = 300,
    [datetime]$Now = (Get-Date)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Recarga SIEMPRE el codigo actual del repo (clausura de dependencias, en orden); ver lib\Import-DaubertBackupModules.ps1.
$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('Pipeline')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

# Solo los parámetros de configuración pasados EXPLÍCITAMENTE prevalecen sobre config.json.
$cli = @{}
foreach ($name in 'BackupRoot', 'StagingRoot', 'PgBinPath', 'PgPassFile', 'PgHost', 'PgPort', 'PgUser', 'PgDatabase', 'SevenZipPath', 'AgePath', 'RecipientsFilePath', 'LogRoot', 'LockRoot', 'LockFilePath', 'IncludeGlobals', 'SchemaOnlySnapshot') {
    if ($PSBoundParameters.ContainsKey($name)) { $cli[$name] = $PSBoundParameters[$name] }
}

$runParams = @{
    Tier                   = $Tier
    CliParameters          = $cli
    DryRun                 = $DryRun
    LockTimeoutSeconds     = $LockTimeoutSeconds
    SevenZipTimeoutSeconds = $SevenZipTimeoutSeconds
    AgeTimeoutSeconds      = $AgeTimeoutSeconds
    Now                    = $Now
    OnlyIfDue              = $OnlyIfDue
}
if ($PSBoundParameters.ContainsKey('ConfigPath')) { $runParams.ConfigPath = $ConfigPath }

$exitCode = Invoke-DaubertBackupRun @runParams
exit ([int]$exitCode)
