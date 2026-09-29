<#
    .SYNOPSIS
    Instalador/bootstrap interactivo e idempotente del sistema de backups
    PostgreSQL de Daubert Hub (nueva PC, migración, reparación o reconfiguración).

    .DESCRIPTION
    Detecta (o pide la ruta de) PostgreSQL client tools, 7-Zip y age; pide el
    destino de backups (propone Dropbox si lo detecta), el destinatario
    PÚBLICO age y, si hace falta, la contraseña del usuario de backup (oculta,
    Read-Host -AsSecureString) para crear el pgpass con ACL restrictiva.
    Escribe config.json de forma atómica en %ProgramData%\DaubertHub\Backup\.

    Layout (Código ≠ configuración ≠ secretos ≠ datos):
      código      repo: scripts\backup\
      config      %ProgramData%\DaubertHub\Backup\   (config.json, age-recipients.txt, logs\, locks\)
      secretos    %LOCALAPPDATA%\DaubertHub\secrets\ (pgpass-backup.conf)
      staging     %LOCALAPPDATA%\DaubertHub\staging\ (plaintext efímero)
      backups     ruta externa configurable (p. ej. Dropbox)

    Si ya existe configuración ofrece: Validar / Reparar / Reconfigurar / Cancelar.

    NO hace, nunca:
      - instalar dependencias;
      - crear roles ni cambiar grants en PostgreSQL (daubert_backup se crea a mano);
      - ejecutar backups, borrar backups o modificar PROD;
      - registrar tareas sin confirmación explícita;
      - sobrescribir secretos en silencio;
      - aceptar ni guardar una clave PRIVADA age.

    .PARAMETER Mode
    Auto (por defecto: pregunta si ya hay configuración), Validate, Repair,
    Reconfigure o Cancel.

    .PARAMETER InstallPrerequisites
    Ofrece ejecutar Install-DaubertBackupPrerequisites.ps1 (pide confirmación; nunca instala software en silencio).

    .PARAMETER ProgramDataRoot / LocalAppDataRoot
    Solo para relocalizar el layout (pruebas o instalaciones especiales).
    Por defecto usan %ProgramData% y %LOCALAPPDATA%.

    .EXAMPLE
    .\commands\Install-DaubertBackup.ps1
#>
[CmdletBinding()]
param(
    [string]$ConfigPath,
    [ValidateSet('Auto', 'Validate', 'Repair', 'Reconfigure', 'Cancel')]
    [string]$Mode = 'Auto',
    [string]$ProgramDataRoot = $env:ProgramData,
    [string]$LocalAppDataRoot = $env:LOCALAPPDATA,
    [switch]$SkipPgPass,
    [switch]$InstallPrerequisites,
    # Consentimiento EXPLICITO para pedir el UAC de Windows si una operación necesita elevación.
    [switch]$RequestElevation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Recarga SIEMPRE el codigo actual del repo (clausura de dependencias, en orden); ver lib\Import-DaubertBackupModules.ps1.
$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('Install', 'Tasks')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

$paths = Get-DefaultBackupPaths -ProgramDataRoot $ProgramDataRoot -LocalAppDataRoot $LocalAppDataRoot
if (-not $ConfigPath) { $ConfigPath = $paths.ConfigPath }

$prompter = [pscustomobject]@{
    Write     = { param($m) Write-Host $m }
    Ask       = {
        param($prompt, $default)
        $suffix = if ($default) { " [$default]" } else { '' }
        $v = Read-Host "$prompt$suffix"
        if ([string]::IsNullOrWhiteSpace($v)) { $default } else { $v }
    }
    # La contraseña NUNCA se muestra ni se convierte a texto aquí.
    AskSecret = { param($prompt) Read-Host $prompt -AsSecureString }
    Confirm   = {
        param($prompt, $defaultYes)
        $hint = if ($defaultYes) { 'S/n' } else { 's/N' }
        $v = Read-Host "$prompt ($hint)"
        if ([string]::IsNullOrWhiteSpace($v)) { [bool]$defaultYes } else { $v.Trim().ToLowerInvariant() -in @('s', 'si', 'sí', 'y', 'yes') }
    }
    Choose    = {
        param($prompt, $options)
        Write-Host $prompt
        for ($i = 0; $i -lt $options.Count; $i++) { Write-Host ("  {0}) {1}" -f ($i + 1), $options[$i]) }
        $v = Read-Host 'Opción'
        $n = 0
        if ([int]::TryParse($v, [ref]$n) -and $n -ge 1 -and $n -le $options.Count) { $options[$n - 1] } else { $options[-1] }
    }
}

# El usuario ya confirmó "registrar tareas" en el wizard: eso es el consentimiento para -RequestElevation
# (UAC estándar, una sola vez, solo para este paso). Si se cancela, NO se informa éxito y se puede reintentar.
$registerTasks = {
    & (Join-Path $PSScriptRoot 'Register-DaubertBackupTasks.ps1') -ConfigPath $ConfigPath -RequestElevation
    $code = $LASTEXITCODE
    if ($code -eq 0) { return $true }
    switch ($code) {
        7 { Write-Host 'Registro de tareas CANCELADO: no se concedió la elevación (UAC). No se registró nada; puede reintentarlo con Register-DaubertBackupTasks.ps1 -RequestElevation.' }
        5 { Write-Host 'Registro de tareas NO realizado: requiere una PowerShell elevada. Use Register-DaubertBackupTasks.ps1 -RequestElevation.' }
        default { Write-Host "El registro de tareas FALLÓ (código $code); revise el mensaje anterior. Puede reintentarlo con Register-DaubertBackupTasks.ps1 -RequestElevation (es idempotente)." }
    }
    return $false
}

# Elevación SOLO si la escritura en %ProgramData% realmente la necesita (se comprueba con un sondeo real, no se asume).
# Validate/Cancel no escriben nada. Una sola elevación para todo el wizard; el proceso elevado recarga su configuración
# de sus ubicaciones autorizadas (sin secretos en argumentos: la contraseña se pide dentro del proceso elevado).
if ($Mode -notin 'Validate', 'Cancel') {
    $req = Get-ElevationRequirement -Operation 'WriteProgramData' -Path $paths.ConfigRoot
    $gate = Invoke-ElevationGate -Required $req.Required -OperationName 'La instalación (escritura en ProgramData)' -ScriptPath $PSCommandPath `
        -RequestElevation:$RequestElevation `
        -Parameters ([ordered]@{ ConfigPath = $ConfigPath; Mode = $Mode; ProgramDataRoot = $ProgramDataRoot; LocalAppDataRoot = $LocalAppDataRoot; SkipPgPass = $SkipPgPass; InstallPrerequisites = $InstallPrerequisites })
    if ($gate.Action -ne 'Proceed') {
        Write-Host $gate.Message -ForegroundColor $(if ($gate.ExitCode -eq 0) { 'Green' } else { 'Red' })
        exit $gate.ExitCode
    }
}
$installPrereq = $null
if ($InstallPrerequisites) { $installPrereq = { & (Join-Path $PSScriptRoot 'Install-DaubertBackupPrerequisites.ps1') -Scope Production } }

$result = Invoke-BackupInstall -ConfigPath $ConfigPath -Paths $paths -Prompter $prompter -Mode $Mode -RegisterTasks $registerTasks -SkipPgPass:$SkipPgPass -InstallPrerequisites $installPrereq

Write-Host ''
Write-Host "Resultado: $($result.Action)"
switch ($result.Action) {
    'Failed' { exit 1 }
    'MissingPrerequisites' { exit 3 }
    default { exit 0 }
}
