<#
    .SYNOPSIS
    Instalador/configurador interactivo e idempotente del backup de n8n de Daubert Hub.

    .DESCRIPTION
    Detecta/propone la carpeta de datos de n8n (%USERPROFILE%\.n8n), valida que existan database.sqlite
    y el archivo 'config' (solo existencia: NUNCA lee ni imprime su contenido), detecta Node y comprueba
    que soporta node:sqlite con backup(), detecta opcionalmente el paquete npm de n8n, reutiliza
    7-Zip/age/destinatarios públicos/destino de backups ya configurados para PostgreSQL (solo los LEE como
    sugerencia) y permite indicar rutas manuales. Escribe n8n-config.json de forma atómica en
    %ProgramData%\DaubertHub\Backup\ (archivo independiente de config.json de PostgreSQL).

    NO hace, nunca: ejecutar backups ni snapshots, instalar software, tocar n8n o PostgreSQL, copiar
    secretos, aceptar una clave PRIVADA age. La tarea WEEKLY solo se registra si se confirma
    explícitamente (default NO).

    Elevación: solo si escribir en %ProgramData% realmente la necesita (sondeo real) y con consentimiento
    (-RequestElevation). Nada se ejecuta siempre como administrador.

    .PARAMETER Mode
    Auto (por defecto: pregunta si ya hay configuración), Validate, Repair, Reconfigure o Cancel.

    .PARAMETER ProgramDataRoot / LocalAppDataRoot
    Solo para relocalizar el layout (pruebas o instalaciones especiales).

    .EXAMPLE
    .\commands\Install-DaubertN8nBackup.ps1
#>
[CmdletBinding()]
param(
    [string]$ConfigPath,
    [ValidateSet('Auto', 'Validate', 'Repair', 'Reconfigure', 'Cancel')]
    [string]$Mode = 'Auto',
    [string]$ProgramDataRoot = $env:ProgramData,
    [string]$LocalAppDataRoot = $env:LOCALAPPDATA,
    [switch]$RequestElevation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$libDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib'
$DaubertBackupModules = @('N8nInstall', 'N8nTasks')
. (Join-Path $libDir 'Import-DaubertBackupModules.ps1')

$paths = Get-N8nDefaultPaths -ProgramDataRoot $ProgramDataRoot -LocalAppDataRoot $LocalAppDataRoot
if (-not $ConfigPath) { $ConfigPath = $paths.ConfigPath }

$prompter = [pscustomobject]@{
    Write   = { param($m) Write-Host $m }
    Ask     = {
        param($prompt, $default)
        $suffix = if ($default) { " [$default]" } else { '' }
        $v = Read-Host "$prompt$suffix"
        if ([string]::IsNullOrWhiteSpace($v)) { $default } else { $v }
    }
    Confirm = {
        param($prompt, $defaultYes)
        $hint = if ($defaultYes) { 'S/n' } else { 's/N' }
        $v = Read-Host "$prompt ($hint)"
        if ([string]::IsNullOrWhiteSpace($v)) { [bool]$defaultYes } else { $v.Trim().ToLowerInvariant() -in @('s', 'si', 'sí', 'y', 'yes') }
    }
    Choose  = {
        param($prompt, $options)
        Write-Host $prompt
        for ($i = 0; $i -lt $options.Count; $i++) { Write-Host ("  {0}) {1}" -f ($i + 1), $options[$i]) }
        $v = Read-Host 'Opción'
        $n = 0
        if ([int]::TryParse($v, [ref]$n) -and $n -ge 1 -and $n -le $options.Count) { $options[$n - 1] } else { $options[-1] }
    }
}

# Confirmar "registrar la tarea" en el wizard es el consentimiento para -RequestElevation (UAC estándar, una vez, solo para ese paso).
$registerTasks = {
    & (Join-Path $PSScriptRoot 'Register-DaubertN8nBackupTask.ps1') -ConfigPath $ConfigPath -RequestElevation
    $code = $LASTEXITCODE
    if ($code -eq 0) { return $true }
    switch ($code) {
        7 { Write-Host 'Registro de la tarea CANCELADO: no se concedió la elevación (UAC). No se registró nada; puede reintentarlo con Register-DaubertN8nBackupTask.ps1 -RequestElevation.' }
        5 { Write-Host 'Registro de la tarea NO realizado: requiere una PowerShell elevada. Use Register-DaubertN8nBackupTask.ps1 -RequestElevation.' }
        default { Write-Host "El registro de la tarea FALLÓ (código $code). Puede reintentarlo con Register-DaubertN8nBackupTask.ps1 -RequestElevation (es idempotente)." }
    }
    return $false
}

# Elevación SOLO si la escritura en %ProgramData% realmente la necesita (Validate/Cancel no escriben).
if ($Mode -notin 'Validate', 'Cancel') {
    $req = Get-ElevationRequirement -Operation 'WriteProgramData' -Path (Split-Path -Parent $ConfigPath)
    $gate = Invoke-ElevationGate -Required $req.Required -OperationName 'La instalación de n8n (escritura en ProgramData)' -ScriptPath $PSCommandPath `
        -RequestElevation:$RequestElevation `
        -Parameters ([ordered]@{ ConfigPath = $ConfigPath; Mode = $Mode; ProgramDataRoot = $ProgramDataRoot; LocalAppDataRoot = $LocalAppDataRoot })
    if ($gate.Action -ne 'Proceed') {
        Write-Host $gate.Message -ForegroundColor $(if ($gate.ExitCode -eq 0) { 'Green' } else { 'Red' })
        exit $gate.ExitCode
    }
}

$result = Invoke-N8nInstall -ConfigPath $ConfigPath -Paths $paths -Prompter $prompter -Mode $Mode -RegisterTasks $registerTasks

Write-Host ''
Write-Host "Resultado: $($result.Action)"
switch ($result.Action) {
    'Failed' { exit 1 }
    'MissingPrerequisites' { exit 3 }
    default { exit 0 }
}
