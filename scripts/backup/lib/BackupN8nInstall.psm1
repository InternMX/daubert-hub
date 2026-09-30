#Requires -Version 5.1
<#
    BackupN8nInstall.psm1
    Instalador/configurador interactivo e idempotente del backup de n8n (lo usa
    scripts/backup/commands/Install-DaubertN8nBackup.ps1).

    Garantías de diseño:
      - Escribe SOLO n8n-config.json (atómico, sin secretos) y, si falta, el archivo de destinatarios
        PÚBLICOS age. NUNCA toca config.json de PostgreSQL (solo lo LEE como fuente de sugerencias:
        7-Zip, age, destinatarios y backupRoot), ni su pgpass ni sus tareas.
      - NUNCA lee ni imprime el contenido de '<n8nRoot>\config' (solo comprueba que el archivo existe);
        no copia secretos; no abre la SQLite de n8n.
      - NO instala software, NO ejecuta backups, NO ejecuta snapshot. El registro de la tarea WEEKLY
        solo se ofrece (default NO) y delega en Register-DaubertN8nBackupTask.ps1.
      - Toda interacción pasa por un objeto Prompter (Ask, Confirm, Choose, Write): se prueba sin consola.
      - Nunca acepta ni guarda una clave PRIVADA age.
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLocalConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nSqlite.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nStaging.psm1') -DisableNameChecking

function Get-N8nDefaultInstallDetection {
    <# Detección portable (solo propuestas). %USERPROFILE%\.n8n se propone únicamente si existe. #>
    $root = $null
    if ($env:USERPROFILE) { $cand = Join-Path $env:USERPROFILE '.n8n'; if (Test-Path -LiteralPath $cand -PathType Container) { $root = $cand } }
    $node = $null
    $cmd = Get-Command -Name 'node.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { $node = $cmd.Source }
    $pkg = $null
    $pj = Find-N8nPackageJson
    if ($pj) { $pkg = Split-Path -Parent $pj }
    @{ N8nRoot = $root; Node = $node; N8nPackage = $pkg; SevenZip = (Find-SevenZipPath); Age = (Find-AgePath); Dropbox = @(Find-DropboxPath) }
}

function Get-N8nInstallFieldProblem {
    <# $null si el valor es aceptable (o vacío en un campo opcional); si no, el motivo. Nunca lee 'config'. #>
    param([string]$Name, $Value, [scriptblock]$NodeProbe)
    $s = if ($null -eq $Value) { '' } else { [string]$Value }
    if ([string]::IsNullOrWhiteSpace($s)) { if ($Name -eq 'n8nPackagePath') { return $null }; return 'valor vacío' }
    if ($s -match '["<>|*?]' -or -not [System.IO.Path]::IsPathRooted($s) -or $s -notmatch '^([A-Za-z]:\\|\\\\)') { return 'debe ser una ruta absoluta válida' }
    switch ($Name) {
        'n8nRoot' {
            if (-not (Test-Path -LiteralPath $s -PathType Container)) { return 'la carpeta no existe' }
            if (-not (Test-Path -LiteralPath (Join-Path $s 'database.sqlite') -PathType Leaf)) { return "no contiene 'database.sqlite'" }
            if (-not (Test-Path -LiteralPath (Join-Path $s 'config') -PathType Leaf)) { return "no contiene el archivo 'config' de n8n" }
        }
        'nodePath' {
            if (-not (Test-BackupToolPath -Path $s)) { return 'el archivo no existe' }
            if ($NodeProbe) {
                $pr = $null
                try { $pr = & $NodeProbe $s } catch { $pr = $null }
                if ($null -eq $pr) { return 'no se pudo sondear Node' }
                if (-not $pr.Supported) { return $pr.Reason }
            }
        }
        'n8nPackagePath' { if (-not (Test-Path -LiteralPath (Join-Path $s 'package.json') -PathType Leaf)) { return "no contiene 'package.json' del paquete n8n" } }
        { $_ -in 'sevenZipPath', 'agePath' } { if (-not (Test-BackupToolPath -Path $s)) { return 'el archivo no existe' } }
    }
    return $null
}

function Invoke-N8nInstall {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)]$Prompter,
        [scriptblock]$Detector,
        [scriptblock]$NodeProbe,
        [ValidateSet('Auto', 'Validate', 'Repair', 'Reconfigure', 'Cancel')][string]$Mode = 'Auto',
        [scriptblock]$RegisterTasks
    )

    $P = $Prompter
    $say = { param($m) & $P.Write $m }
    if (-not $Detector) { $Detector = { Get-N8nDefaultInstallDetection } }
    if (-not $NodeProbe) { $NodeProbe = { param($NodePath) Test-N8nNodeSqliteSupport -NodePath $NodePath } }

    $result = [ordered]@{ Action = ''; ConfigChanged = $false; RecipientsWritten = $false; TasksRegistered = $false; Missing = @(); Errors = @() }
    function Finish($r, $action) { $r.Action = $action; [pscustomobject]$r }

    & $say 'Instalador del backup de n8n de Daubert Hub'
    & $say "(no ejecuta backups, no toca n8n ni PostgreSQL, no lee el contenido de '.n8n\config'; los secretos nunca van a n8n-config.json)"

    if ($PSVersionTable.PSVersion -lt [version]'5.1') {
        $result.Errors = @("Se requiere Windows PowerShell 5.1 o superior (actual: $($PSVersionTable.PSVersion)).")
        & $say $result.Errors[0]
        return (Finish $result 'Failed')
    }

    $existing = Read-N8nBackupConfigFile -Path $ConfigPath
    $exists = Test-Path -LiteralPath $ConfigPath -PathType Leaf
    $effectiveMode = $Mode
    if ($exists) {
        & $say 'Se encontró una configuración n8n existente.'
        if ($Mode -eq 'Auto') {
            $choice = & $P.Choose 'La configuración ya existe. ¿Qué desea hacer?' @('Validar', 'Reparar', 'Reconfigurar', 'Cancelar')
            $effectiveMode = switch ($choice) { 'Validar' { 'Validate' } 'Reparar' { 'Repair' } 'Reconfigurar' { 'Reconfigure' } default { 'Cancel' } }
        }
    }
    else {
        if ($Mode -eq 'Cancel') { return (Finish $result 'Cancelled') }
        $effectiveMode = 'Install'
    }
    if ($effectiveMode -eq 'Cancel') { & $say 'Operación cancelada. No se modificó nada.'; return (Finish $result 'Cancelled') }

    $base = $null
    if ($existing.Config) { $base = $existing.Config }
    function BaseValue($name) { if ($null -ne $base) { Get-N8nConfigProperty -Object $base -Name $name } else { $null } }

    # ------------------------------------------------------------------ Validar (solo lectura)
    if ($effectiveMode -eq 'Validate') {
        if ($existing.IsValid) { & $say 'n8n-config.json: VÁLIDO' } else { & $say 'n8n-config.json: INVÁLIDO'; foreach ($e in $existing.Errors) { & $say "  - $e" } }
        if ($null -ne $base) {
            foreach ($f in 'n8nRoot', 'nodePath', 'n8nPackagePath', 'sevenZipPath', 'agePath') {
                $pr = Get-N8nInstallFieldProblem -Name $f -Value (BaseValue $f) -NodeProbe $NodeProbe
                & $say ("  {0,-16} {1}" -f $f, $(if ($pr) { "PROBLEMA: $pr" } else { 'OK' }))
            }
        }
        & $say 'Para un diagnóstico completo ejecute Test-DaubertN8nBackupEnvironment.ps1.'
        $result.Errors = @($existing.Errors)
        return (Finish $result 'Validated')
    }

    # ------------------------------------------------------------------ Valores base
    $det = & $Detector
    # Sugerencias de SOLO LECTURA del config de PostgreSQL (herramientas, destinatarios, destino): nunca se modifica.
    $pgHint = $null
    $pgConfigPath = Join-Path $Paths.ConfigRoot 'config.json'
    if ($pgConfigPath -ne $ConfigPath) { $pg = Read-LocalBackupConfig -Path $pgConfigPath; if ($pg.IsValid) { $pgHint = $pg.Config } }
    function HintValue($name) { if ($null -ne $pgHint) { Get-OptionalProperty -Object $pgHint -Name $name } else { $null } }

    $dropboxRoot = $null
    if ($det.Dropbox -and @($det.Dropbox).Count -gt 0) { $dropboxRoot = Join-Path (@($det.Dropbox)[0]) 'DaubertHub\Backups' }

    $defaults = [ordered]@{
        n8nRoot            = $det.N8nRoot
        nodePath           = $det.Node
        n8nPackagePath     = $det.N8nPackage
        sevenZipPath       = $(if (HintValue 'sevenZipPath') { HintValue 'sevenZipPath' } else { $det.SevenZip })
        agePath            = $(if (HintValue 'agePath') { HintValue 'agePath' } else { $det.Age })
        backupRoot         = $(if (HintValue 'backupRoot') { HintValue 'backupRoot' } else { $dropboxRoot })
        stagingRoot        = $Paths.StagingRoot
        logRoot            = $Paths.LogRoot
        lockRoot           = $Paths.LockRoot
        recipientsFilePath = $(if (HintValue 'recipientsFilePath') { HintValue 'recipientsFilePath' } else { $Paths.RecipientsFilePath })
    }
    $vals = [ordered]@{}
    foreach ($k in $defaults.Keys) {
        $b = BaseValue $k
        $vals[$k] = if ($null -ne $b -and -not [string]::IsNullOrWhiteSpace([string]$b)) { [string]$b } elseif ($defaults[$k]) { [string]$defaults[$k] } else { '' }
    }
    # Un valor heredado que ya no es válido (otra máquina) pero cuya detección local sí lo es -> se propone lo detectado.
    foreach ($pair in @(@('n8nRoot', $det.N8nRoot), @('nodePath', $det.Node), @('n8nPackagePath', $det.N8nPackage), @('sevenZipPath', $det.SevenZip), @('agePath', $det.Age))) {
        if ($pair[1] -and (Get-N8nInstallFieldProblem -Name $pair[0] -Value $vals[$pair[0]] -NodeProbe $NodeProbe) -and -not (Get-N8nInstallFieldProblem -Name $pair[0] -Value $pair[1] -NodeProbe $NodeProbe)) { $vals[$pair[0]] = [string]$pair[1] }
    }

    $askAll = ($effectiveMode -eq 'Install' -or $effectiveMode -eq 'Reconfigure')
    $missing = New-Object System.Collections.Generic.List[string]
    $createBackupRoot = $false

    function Read-N8nValue($name, $prompt) {
        for ($i = 0; $i -lt 3; $i++) {
            $entered = & $P.Ask $prompt $vals[$name]
            $cand = if ([string]::IsNullOrWhiteSpace($entered)) { $vals[$name] } else { $entered.Trim().Trim('"') }
            $problem = Get-N8nInstallFieldProblem -Name $name -Value $cand -NodeProbe $NodeProbe
            if (-not $problem) { return $cand }
            & $say "  No válido: $problem"
        }
        return $null
    }

    $prompts = @(
        @('n8nRoot', 'Carpeta de datos de n8n (con database.sqlite y config; normalmente %USERPROFILE%\.n8n)', 'Carpeta de datos de n8n con database.sqlite y config'),
        @('nodePath', 'Ruta de node.exe (debe soportar node:sqlite con backup())', 'Node con node:sqlite y backup() (Node >= 22.16)'),
        @('sevenZipPath', 'Ruta de 7z.exe', '7-Zip (https://www.7-zip.org/)'),
        @('agePath', 'Ruta de age.exe', 'age (https://github.com/FiloSottile/age/releases)')
    )
    foreach ($t in $prompts) {
        $n = $t[0]
        $bad = [bool](Get-N8nInstallFieldProblem -Name $n -Value $vals[$n] -NodeProbe $NodeProbe)
        if (-not $askAll -and -not $bad) { continue }
        if (-not $bad) { & $say ("  {0}: detectado" -f $n); if ($effectiveMode -ne 'Reconfigure') { continue } }
        $v = Read-N8nValue $n $t[1]
        if ($null -eq $v) { $missing.Add("$($t[2]) - no detectado ni indicado") } else { $vals[$n] = $v }
    }

    # n8nPackagePath: opcional (solo para registrar la versión de n8n en el manifest).
    if ((Get-N8nInstallFieldProblem -Name 'n8nPackagePath' -Value $vals['n8nPackagePath'])) { $vals['n8nPackagePath'] = '' }
    if ($askAll -and -not $vals['n8nPackagePath']) {
        $entered = & $P.Ask 'Carpeta del paquete npm de n8n (opcional, para registrar su versión; Enter para omitir)' ''
        if (-not [string]::IsNullOrWhiteSpace($entered)) {
            $cand = $entered.Trim().Trim('"')
            $pr = Get-N8nInstallFieldProblem -Name 'n8nPackagePath' -Value $cand
            if ($pr) { & $say "  Omitido: $pr" } else { $vals['n8nPackagePath'] = $cand }
        }
    }

    # --- Destino de backups ---
    $brBad = [bool](Get-N8nInstallFieldProblem -Name 'backupRoot' -Value $vals['backupRoot']) -or -not (Test-Path -LiteralPath $vals['backupRoot'] -PathType Container)
    if ($askAll -or $brBad) {
        $v = $null
        for ($i = 0; $i -lt 3 -and $null -eq $v; $i++) {
            $entered = & $P.Ask 'Carpeta destino de backups (p. ej. dentro de Dropbox u otro almacenamiento externo)' $vals['backupRoot']
            $cand = if ([string]::IsNullOrWhiteSpace($entered)) { $vals['backupRoot'] } else { $entered.Trim().Trim('"') }
            $problem = Get-N8nInstallFieldProblem -Name 'backupRoot' -Value $cand
            if ($problem) { & $say "  No válido: $problem"; continue }
            if (-not (Test-Path -LiteralPath $cand -PathType Container)) {
                if (& $P.Confirm "La carpeta '$cand' no existe. ¿Crearla?" $true) { $createBackupRoot = $true } else { continue }
            }
            $v = $cand
        }
        if ($null -eq $v) { $missing.Add('Carpeta destino de backups') } else { $vals['backupRoot'] = $v }
    }

    # --- Rutas locales ---
    $localKeys = @('stagingRoot', 'logRoot', 'lockRoot', 'recipientsFilePath')
    $askLocal = $false
    if ($askAll) {
        & $say 'Rutas locales propuestas:'
        foreach ($k in $localKeys) { & $say ("  {0,-20} {1}" -f $k, $vals[$k]) }
        $askLocal = -not (& $P.Confirm '¿Usar estas rutas locales?' $true)
    }
    foreach ($k in $localKeys) {
        if ($askLocal -or (Get-N8nInstallFieldProblem -Name $k -Value $vals[$k])) {
            $v = Read-N8nValue $k "Ruta para $k"
            if ($null -eq $v) { $missing.Add("Ruta $k no válida") } else { $vals[$k] = $v }
        }
    }
    # staging/backup nunca dentro de n8nRoot
    foreach ($k in 'stagingRoot', 'backupRoot') {
        if ($vals['n8nRoot'] -and $vals[$k] -and (Test-N8nPathUnder -Child $vals[$k] -Parent $vals['n8nRoot'])) { $missing.Add("$k no puede estar dentro de la carpeta de n8n") }
    }

    # --- Destinatario público age ---
    $recipientsPath = $vals['recipientsFilePath']
    $writeRecipients = $null
    $needRecipient = $false
    if ($recipientsPath) {
        $recInfo = Get-AgeRecipientInfo -Path $recipientsPath
        if ($recInfo.HasPrivateKey) {
            $msg = 'El archivo de destinatarios contiene una CLAVE PRIVADA age. Retírela de esta máquina (debe custodiarse fuera del host productor) y vuelva a ejecutar.'
            & $say $msg
            $result.Errors = @($msg)
            return (Finish $result 'Failed')
        }
        $needRecipient = -not $recInfo.IsValid
        if ($recInfo.IsValid -and $effectiveMode -eq 'Reconfigure') { $needRecipient = & $P.Confirm "Ya hay $($recInfo.RecipientCount) destinatario(s) público(s). ¿Reemplazarlos?" $false }
        if ($needRecipient) {
            for ($i = 0; $i -lt 3 -and $null -eq $writeRecipients; $i++) {
                $entered = & $P.Ask 'Clave PÚBLICA age (age1...; NUNCA la privada)' ''
                if ([string]::IsNullOrWhiteSpace($entered)) { continue }
                if (Test-AgePrivateKeyText -Text $entered) { & $say '  Rechazado: eso parece una clave PRIVADA. Pegue solo la clave pública (age1...).'; continue }
                if (-not (Test-AgePublicRecipient -Value $entered)) { & $say '  No es una clave pública age válida.'; continue }
                $writeRecipients = $entered.Trim()
            }
            if ($null -eq $writeRecipients) { $missing.Add('Destinatario público age (genere el par con age-keygen fuera de este host y proporcione solo la clave pública)') }
        }
    }

    if ($missing.Count -gt 0) {
        & $say ''
        & $say 'Faltan prerequisitos; no se modificó nada. Resuélvalos y vuelva a ejecutar el instalador:'
        foreach ($m in $missing) { & $say "  - $m" }
        $result.Missing = $missing.ToArray()
        return (Finish $result 'MissingPrerequisites')
    }

    # --- Reparar sin nada que hacer ---
    $drift = $false
    foreach ($k in $vals.Keys) { if ([string](BaseValue $k) -ne [string]$vals[$k]) { $drift = $true } }
    if ($effectiveMode -eq 'Repair' -and $existing.IsValid -and -not $drift -and -not $needRecipient -and -not $createBackupRoot) {
        & $say 'Todo está en orden: no hay nada que reparar. No se modificó nada.'
        return (Finish $result 'NoChange')
    }

    # ------------------------------------------------------------------ Aplicar
    if ($createBackupRoot) { New-Item -ItemType Directory -Path $vals['backupRoot'] -Force | Out-Null }
    foreach ($d in @($vals['logRoot'], $vals['lockRoot'], $vals['stagingRoot'], (Split-Path -Parent $recipientsPath))) {
        if ($d -and -not (Test-Path -LiteralPath $d -PathType Container)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    }
    if ($null -ne $writeRecipients) {
        Write-AgeRecipientsFile -Path $recipientsPath -Recipients @($writeRecipients)
        $result.RecipientsWritten = $true
        & $say 'Destinatario público age guardado.'
    }

    # Claves privadas age: solo en rutas administradas (NUNCA se escanea la carpeta de n8n).
    $managedDirs = @((Split-Path -Parent $ConfigPath), (Split-Path -Parent $recipientsPath), $vals['logRoot'], $vals['lockRoot'], $vals['stagingRoot'], $vals['backupRoot'])
    $keyHits = @(Find-AgePrivateKeyInPath -Paths $managedDirs)
    if ($keyHits.Count -gt 0) {
        $msg = 'Se detectó una clave privada age en rutas administradas: ' + (($keyHits | ForEach-Object { $_.Path }) -join '; ') + '. Retírela de esta máquina; no se escribió la configuración.'
        & $say $msg
        $result.Errors = @($msg)
        return (Finish $result 'Failed')
    }

    $newConfig = New-N8nConfigObject -N8nRoot $vals['n8nRoot'] -NodePath $vals['nodePath'] -N8nPackagePath $vals['n8nPackagePath'] `
        -SevenZipPath $vals['sevenZipPath'] -AgePath $vals['agePath'] -RecipientsFilePath $recipientsPath -BackupRoot $vals['backupRoot'] `
        -StagingRoot $vals['stagingRoot'] -LogRoot $vals['logRoot'] -LockRoot $vals['lockRoot'] `
        -Retention $(if ($null -ne $base) { Get-N8nConfigProperty -Object $base -Name 'retention' } else { $null }) `
        -Schedules $(if ($null -ne $base) { Get-N8nConfigProperty -Object $base -Name 'schedules' } else { $null })
    try {
        $w = Write-N8nBackupConfig -Path $ConfigPath -Config $newConfig
        $result.ConfigChanged = $w.Changed
        & $say $(if ($w.Changed) { 'n8n-config.json guardado.' } else { 'n8n-config.json ya estaba actualizado (sin cambios).' })
    }
    catch {
        $result.Errors = @($_.Exception.Message)
        & $say "No se pudo guardar n8n-config.json: $($_.Exception.Message)"
        return (Finish $result 'Failed')
    }

    # --- Task Scheduler WEEKLY: solo con confirmación explícita (default NO) ---
    if ($RegisterTasks) {
        if (& $P.Confirm '¿Deseas registrar ahora la tarea programada WEEKLY de n8n? (puede solicitar el UAC de Windows)' $false) {
            $out = @(& $RegisterTasks)
            $result.TasksRegistered = -not ($out -contains $false)
            if (-not $result.TasksRegistered) { & $say 'La tarea programada NO quedó registrada (puede reintentarlo cuando quiera).' }
        }
        else { & $say 'Tarea WEEKLY NO registrada. Puede hacerlo después con Register-DaubertN8nBackupTask.ps1 (use -WhatIf para previsualizar).' }
    }

    & $say ''
    & $say 'No se ejecutó ningún backup. Siguiente paso: ejecute Test-DaubertN8nBackupEnvironment.ps1 para validar el entorno.'
    & $say 'El tier ON_CHANGE es manual: Start-DaubertN8nBackup.ps1 -Tier OnChange -ConfigPath <n8n-config.json>'
    $action = switch ($effectiveMode) { 'Install' { 'Installed' } 'Repair' { 'Repaired' } default { 'Reconfigured' } }
    if ($effectiveMode -ne 'Install' -and -not $result.ConfigChanged -and -not $result.RecipientsWritten -and -not $createBackupRoot) { $action = 'NoChange' }
    return (Finish $result $action)
}

Export-ModuleMember -Function Invoke-N8nInstall, Get-N8nInstallFieldProblem, Get-N8nDefaultInstallDetection
