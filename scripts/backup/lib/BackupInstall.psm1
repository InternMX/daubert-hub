#Requires -Version 5.1
<#
    BackupInstall.psm1
    Lógica del instalador/bootstrap del sistema de backups (la usa
    scripts/backup/commands/Install-DaubertBackup.ps1). Interactivo, idempotente y
    reutilizable en otra máquina.

    Garantías de diseño:
      - NO instala dependencias (PostgreSQL, 7-Zip, age): las detecta, permite
        indicar su ruta, o informa claramente qué falta.
      - NO crea roles ni cambia grants en PostgreSQL, NO toca daubert_global,
        NO ejecuta backups, NO registra tareas sin confirmación explícita.
      - NUNCA sobrescribe secretos en silencio (pgpass) ni borra backups.
      - Nunca recrea una configuración válida innecesariamente
        (Changed=$false -> el archivo no se reescribe).
      - Toda interacción pasa por un objeto Prompter (scriptblocks Ask,
        AskSecret, Confirm, Choose, Write): así se prueba sin consola.
        AskSecret es Read-Host -AsSecureString en el script real.
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLocalConfig.psm1') -DisableNameChecking

function Write-InstallMessage {
    param($Prompter, [string]$Message)
    & $Prompter.Write $Message
}

function Get-DefaultInstallDetection {
    @{
        PgBin    = (Find-PostgresBinPath)
        SevenZip = (Find-SevenZipPath)
        Age      = (Find-AgePath)
        Dropbox  = @(Find-DropboxPath)
    }
}

function Get-InstallFieldProblem {
    <# Devuelve $null si el valor es aceptable, o el motivo (texto) si no. #>
    param([string]$Name, $Value)
    $s = if ($null -eq $Value) { '' } else { [string]$Value }
    if ([string]::IsNullOrWhiteSpace($s)) { return 'valor vacío' }
    switch ($Name) {
        { $_ -in 'database', 'backupUser' } { if ($s -notmatch '^[A-Za-z0-9_.\-]+$') { return 'solo letras, números, "_", "." y "-"' } }
        'host' { if ($s -notmatch '^[A-Za-z0-9_.\-:\[\]]+$') { return 'host no válido' } }
        'port' { $n = 0; if (-not [int]::TryParse($s, [ref]$n) -or $n -lt 1 -or $n -gt 65535) { return 'el puerto debe ser un entero entre 1 y 65535' } }
        'postgresBin' {
            if (-not (Test-BackupToolPath -Path (Join-Path $s 'pg_dump.exe')) -or -not (Test-BackupToolPath -Path (Join-Path $s 'pg_restore.exe'))) { return 'la carpeta no contiene pg_dump.exe y pg_restore.exe' }
        }
        { $_ -in 'sevenZipPath', 'agePath' } { if (-not (Test-BackupToolPath -Path $s)) { return 'el archivo no existe' } }
        default {
            if ($s -match '["<>|*?]' -or -not [System.IO.Path]::IsPathRooted($s) -or $s -notmatch '^([A-Za-z]:\\|\\\\)') { return 'debe ser una ruta absoluta válida' }
        }
    }
    return $null
}

function Invoke-BackupInstall {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)]$Prompter,
        [scriptblock]$Detector,
        [ValidateSet('Auto', 'Validate', 'Repair', 'Reconfigure', 'Cancel')][string]$Mode = 'Auto',
        [scriptblock]$RegisterTasks,
        [scriptblock]$InstallPrerequisites,
        [switch]$SkipPgPass
    )

    $P = $Prompter
    $say = { param($m) Write-InstallMessage -Prompter $P -Message $m }
    if (-not $Detector) { $Detector = { Get-DefaultInstallDetection } }

    $result = [ordered]@{ Action = ''; ConfigChanged = $false; PgPassCreated = $false; RecipientsWritten = $false; TasksRegistered = $false; Missing = @(); Errors = @(); PrerequisitesRun = $false }
    function Finish($r, $action) { $r.Action = $action; [pscustomobject]$r }

    & $say 'Instalador del sistema de backups PostgreSQL de Daubert Hub'
    & $say '(no instala software, no toca PostgreSQL ni ejecuta backups; los secretos nunca van a config.json)'

    if ($PSVersionTable.PSVersion -lt [version]'5.1') {
        $result.Errors = @("Se requiere Windows PowerShell 5.1 o superior (actual: $($PSVersionTable.PSVersion)).")
        & $say $result.Errors[0]
        return (Finish $result 'Failed')
    }

    # Prerequisitos (opt-in explícito: nunca se instala software sin consentimiento).
    if ($InstallPrerequisites) {
        if (& $P.Confirm '¿Ejecutar ahora el instalador de prerequisitos (puede instalar software con winget)?' $false) {
            & $InstallPrerequisites
            $result.PrerequisitesRun = $true
        }
        else { & $say 'Instalador de prerequisitos NO ejecutado.' }
    }
    # ------------------------------------------------------------------
    # Estado existente y modo
    # ------------------------------------------------------------------
    $existing = Read-LocalBackupConfig -Path $ConfigPath
    $effectiveMode = $Mode

    if ($existing.Exists) {
        & $say "Se encontró una configuración existente."
        if ($Mode -eq 'Auto') {
            $choice = & $P.Choose 'La configuración ya existe. ¿Qué desea hacer?' @('Validar', 'Reparar', 'Reconfigurar', 'Cancelar')
            $effectiveMode = switch ($choice) { 'Validar' { 'Validate' } 'Reparar' { 'Repair' } 'Reconfigurar' { 'Reconfigure' } default { 'Cancel' } }
        }
    }
    else {
        if ($Mode -eq 'Cancel') { return (Finish $result 'Cancelled') }
        $effectiveMode = 'Install'
    }

    if ($effectiveMode -eq 'Cancel') {
        & $say 'Operación cancelada. No se modificó nada.'
        return (Finish $result 'Cancelled')
    }

    # ------------------------------------------------------------------
    # Validar (solo lectura)
    # ------------------------------------------------------------------
    if ($effectiveMode -eq 'Validate') {
        if ($existing.IsValid) { & $say 'config.json: VÁLIDO' } else { & $say 'config.json: INVÁLIDO'; foreach ($e in $existing.Errors) { & $say "  - $e" } }
        if ($existing.ParseOk) {
            foreach ($f in 'postgresBin', 'sevenZipPath', 'agePath') {
                $pr = Get-InstallFieldProblem -Name $f -Value (Get-OptionalProperty -Object $existing.Config -Name $f)
                & $say ("  {0,-14} {1}" -f $f, $(if ($pr) { "PROBLEMA: $pr" } else { 'OK' }))
            }
        }
        & $say 'Para un diagnóstico completo ejecute Test-DaubertBackupEnvironment.ps1.'
        $result.Errors = @($existing.Errors)
        return (Finish $result 'Validated')
    }

    # ------------------------------------------------------------------
    # Valores base: existentes (si parseables) o defaults/detección
    # ------------------------------------------------------------------
    $det = & $Detector
    $base = $existing.ParseOk -and ($null -ne $existing.Config)
    function BaseValue($name) { if ($base) { Get-OptionalProperty -Object $existing.Config -Name $name } else { $null } }

    $dropboxRoot = $null
    if ($det.Dropbox -and @($det.Dropbox).Count -gt 0) { $dropboxRoot = Join-Path (@($det.Dropbox)[0]) 'DaubertHub\Backups\PostgreSQL' }

    $defaults = [ordered]@{
        database           = 'daubert_global'
        host               = 'localhost'
        port               = '5432'
        backupUser         = 'daubert_backup'
        postgresBin        = $det.PgBin
        sevenZipPath       = $det.SevenZip
        agePath            = $det.Age
        backupRoot         = $dropboxRoot
        stagingRoot        = $Paths.StagingRoot
        logRoot            = $Paths.LogRoot
        lockRoot           = $Paths.LockRoot
        recipientsFilePath = $Paths.RecipientsFilePath
        pgPassFile         = $Paths.PgPassFile
    }
    $vals = [ordered]@{}
    foreach ($k in $defaults.Keys) {
        $b = BaseValue $k
        $vals[$k] = if ($null -ne $b -and -not [string]::IsNullOrWhiteSpace([string]$b)) { [string]$b } else { [string]$defaults[$k] }
    }

    # Si un valor heredado de la config ya no es válido (p. ej. otra máquina) pero la
    # detección local sí encuentra la herramienta, se propone lo detectado.
    foreach ($pair in @(@('postgresBin', $det.PgBin), @('sevenZipPath', $det.SevenZip), @('agePath', $det.Age))) {
        if ((Get-InstallFieldProblem -Name $pair[0] -Value $vals[$pair[0]]) -and $pair[1] -and -not (Get-InstallFieldProblem -Name $pair[0] -Value $pair[1])) { $vals[$pair[0]] = [string]$pair[1] }
    }

    # Reparar: si todo está sano y no hay nada que hacer -> NoChange, sin preguntas.
    $askAll = ($effectiveMode -eq 'Install' -or $effectiveMode -eq 'Reconfigure')
    $needs = @{}
    foreach ($k in $vals.Keys) {
        $needs[$k] = $askAll -or [bool](Get-InstallFieldProblem -Name $k -Value $vals[$k]) -or (($k -eq 'backupRoot') -and -not (Test-Path -LiteralPath $vals[$k] -PathType Container))
    }

    $missing = New-Object System.Collections.Generic.List[string]
    $createBackupRoot = $false

    function Read-InstallValue($name, $prompt) {
        for ($i = 0; $i -lt 3; $i++) {
            $entered = & $P.Ask $prompt $vals[$name]
            $candidate = if ([string]::IsNullOrWhiteSpace($entered)) { $vals[$name] } else { $entered.Trim().Trim('"') }
            $problem = Get-InstallFieldProblem -Name $name -Value $candidate
            if (-not $problem) { return $candidate }
            & $say "  No válido: $problem"
        }
        return $null
    }

    # --- PostgreSQL destino ---
    $askConn = $false
    if ($askAll) {
        & $say ("Conexión propuesta: {0}@{1}:{2}/{3}" -f $vals['backupUser'], $vals['host'], $vals['port'], $vals['database'])
        $askConn = -not (& $P.Confirm '¿Usar estos datos de conexión?' $true)
    }
    foreach ($pair in @(@('database', 'Base de datos'), @('host', 'Host PostgreSQL'), @('port', 'Puerto PostgreSQL'), @('backupUser', 'Usuario de backup'))) {
        $connProblem = [bool](Get-InstallFieldProblem -Name $pair[0] -Value $vals[$pair[0]])
        if ($askConn -or $connProblem) {
            $v = Read-InstallValue $pair[0] $pair[1]
            if ($null -eq $v) { $missing.Add("$($pair[1]) (valor no válido)") } else { $vals[$pair[0]] = $v }
        }
    }

    # --- Herramientas (nunca se instalan) ---
    $toolPrompts = @(
        @('postgresBin', 'Carpeta bin de PostgreSQL (con pg_dump.exe / pg_restore.exe)', 'PostgreSQL client tools (https://www.postgresql.org/download/windows/)'),
        @('sevenZipPath', 'Ruta de 7z.exe', '7-Zip (https://www.7-zip.org/)'),
        @('agePath', 'Ruta de age.exe', 'age (https://github.com/FiloSottile/age/releases)')
    )
    foreach ($t in $toolPrompts) {
        $n = $t[0]
        if (-not $needs[$n]) { continue }
        if (-not (Get-InstallFieldProblem -Name $n -Value $vals[$n])) {
            & $say ("  {0}: detectado" -f $n)
            if ($effectiveMode -ne 'Reconfigure') { continue }
        }
        $v = Read-InstallValue $n $t[1]
        if ($null -eq $v) { $missing.Add("$($t[2]) - no detectado ni indicado") } else { $vals[$n] = $v }
    }

    # --- Destino de backups ---
    if ($needs['backupRoot']) {
        $promptText = 'Carpeta destino de backups (p. ej. dentro de Dropbox u otro almacenamiento externo)'
        $v = $null
        for ($i = 0; $i -lt 3 -and $null -eq $v; $i++) {
            $entered = & $P.Ask $promptText $vals['backupRoot']
            $cand = if ([string]::IsNullOrWhiteSpace($entered)) { $vals['backupRoot'] } else { $entered.Trim().Trim('"') }
            $problem = Get-InstallFieldProblem -Name 'backupRoot' -Value $cand
            if ($problem) { & $say "  No válido: $problem"; continue }
            if (-not (Test-Path -LiteralPath $cand -PathType Container)) {
                if (& $P.Confirm "La carpeta '$cand' no existe. ¿Crearla?" $true) { $createBackupRoot = $true } else { continue }
            }
            $v = $cand
        }
        if ($null -eq $v) { $missing.Add('Carpeta destino de backups') } else { $vals['backupRoot'] = $v }
    }

    # --- Rutas locales (por defecto en ProgramData/LocalAppData) ---
    $localKeys = @('stagingRoot', 'logRoot', 'lockRoot', 'recipientsFilePath', 'pgPassFile')
    $askLocal = $false
    if ($askAll) {
        & $say 'Rutas locales propuestas:'
        foreach ($k in $localKeys) { & $say ("  {0,-20} {1}" -f $k, $vals[$k]) }
        $askLocal = -not (& $P.Confirm '¿Usar estas rutas locales?' $true)
    }
    foreach ($k in $localKeys) {
        if ($askLocal -or (Get-InstallFieldProblem -Name $k -Value $vals[$k])) {
            $v = Read-InstallValue $k "Ruta para $k"
            if ($null -eq $v) { $missing.Add("Ruta $k no válida") } else { $vals[$k] = $v }
        }
    }

    # --- Destinatario público age ---
    $recipientsPath = $vals['recipientsFilePath']
    $recInfo = Get-AgeRecipientInfo -Path $recipientsPath
    $writeRecipients = $null
    if ($recInfo.HasPrivateKey) {
        $msg = 'El archivo de destinatarios contiene una CLAVE PRIVADA age. Retírela de esta máquina (debe custodiarse fuera del host productor) y vuelva a ejecutar.'
        & $say $msg
        $result.Errors = @($msg)
        return (Finish $result 'Failed')
    }
    $needRecipient = -not $recInfo.IsValid
    if ($recInfo.IsValid -and $effectiveMode -eq 'Reconfigure') {
        $needRecipient = & $P.Confirm "Ya hay $($recInfo.RecipientCount) destinatario(s) público(s). ¿Reemplazarlos?" $false
    }
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

    # --- Si falta algún prerequisito: informar y NO escribir nada ---
    if ($missing.Count -gt 0) {
        & $say ''
        & $say 'Faltan prerequisitos; no se modificó nada. Resuélvalos y vuelva a ejecutar el instalador:'
        foreach ($m in $missing) { & $say "  - $m" }
        & $say 'Para preparar los prerequisitos declarados ejecute: .\scripts\backup\commands\Install-DaubertBackupPrerequisites.ps1 (o Install-DaubertBackup.ps1 -InstallPrerequisites). No se instala nada sin su consentimiento.'
        $result.Missing = $missing.ToArray()
        return (Finish $result 'MissingPrerequisites')
    }

    # --- Reparar sin nada que hacer -> NoChange (idempotencia) ---
    $pgpassExists = Test-Path -LiteralPath $vals['pgPassFile'] -PathType Leaf
    # "Drift": algún valor resuelto (p. ej. herramienta re-detectada) difiere del que hay en config.json.
    $drift = $false
    foreach ($k in $vals.Keys) { if ([string](BaseValue $k) -ne [string]$vals[$k]) { $drift = $true } }
    $nothingToFix = ($effectiveMode -eq 'Repair') -and $existing.IsValid -and -not $drift -and -not $needRecipient -and $pgpassExists -and -not $createBackupRoot -and -not ($needs.Values -contains $true)
    if ($nothingToFix) {
        Initialize-BackupLayout -Config ([pscustomobject]$vals) | Out-Null
        & $say 'Todo está en orden: no hay nada que reparar. No se modificó nada.'
        return (Finish $result 'NoChange')
    }

    # ------------------------------------------------------------------
    # Aplicar: layout, escaneo de clave privada, config, destinatarios, pgpass
    # ------------------------------------------------------------------
    if ($createBackupRoot) { New-Item -ItemType Directory -Path $vals['backupRoot'] -Force | Out-Null }
    $cfgForLayout = [pscustomobject]$vals
    Initialize-BackupLayout -Config $cfgForLayout | Out-Null

    if ($null -ne $writeRecipients) {
        Write-AgeRecipientsFile -Path $recipientsPath -Recipients @($writeRecipients)
        $result.RecipientsWritten = $true
        & $say 'Destinatario público age guardado.'
    }

    $managedDirs = @((Split-Path -Parent $ConfigPath), (Split-Path -Parent $vals['pgPassFile']), (Split-Path -Parent $recipientsPath), $vals['logRoot'], $vals['lockRoot'], $vals['stagingRoot'], $vals['backupRoot'])
    $keyHits = @(Find-AgePrivateKeyInPath -Paths $managedDirs)
    if ($keyHits.Count -gt 0) {
        $msg = 'Se detectó una clave privada age en rutas administradas: ' + (($keyHits | ForEach-Object { $_.Path }) -join '; ') + '. Retírela de esta máquina; no se escribió la configuración.'
        & $say $msg
        $result.Errors = @($msg)
        return (Finish $result 'Failed')
    }

    $newConfig = New-LocalBackupConfigObject `
        -Database $vals['database'] -HostName $vals['host'] -Port ([int]$vals['port']) -BackupUser $vals['backupUser'] `
        -PostgresBin $vals['postgresBin'] -SevenZipPath $vals['sevenZipPath'] -AgePath $vals['agePath'] `
        -RecipientsFilePath $recipientsPath -PgPassFile $vals['pgPassFile'] -BackupRoot $vals['backupRoot'] `
        -StagingRoot $vals['stagingRoot'] -LogRoot $vals['logRoot'] -LockRoot $vals['lockRoot'] `
        -Retention $(if ($base) { Get-OptionalProperty -Object $existing.Config -Name 'retention' } else { $null }) `
        -Schedules $(if ($base) { Get-OptionalProperty -Object $existing.Config -Name 'schedules' } else { $null })

    try {
        $w = Write-LocalBackupConfig -Path $ConfigPath -Config $newConfig
        $result.ConfigChanged = $w.Changed
        & $say $(if ($w.Changed) { 'config.json guardado.' } else { 'config.json ya estaba actualizado (sin cambios).' })
    }
    catch {
        $result.Errors = @($_.Exception.Message)
        & $say "No se pudo guardar config.json: $($_.Exception.Message)"
        return (Finish $result 'Failed')
    }

    # --- pgpass (secreto): nunca se sobrescribe en silencio ---
    if (-not $SkipPgPass) {
        $pgpassFile = $vals['pgPassFile']
        $connChanged = $existing.ParseOk -and $base -and (
            [string](BaseValue 'host') -ne $vals['host'] -or [string](BaseValue 'port') -ne $vals['port'] -or
            [string](BaseValue 'database') -ne $vals['database'] -or [string](BaseValue 'backupUser') -ne $vals['backupUser'])
        $createPg = $false
        if (-not (Test-Path -LiteralPath $pgpassFile -PathType Leaf)) {
            $createPg = & $P.Confirm 'No existe el archivo pgpass del usuario de backup. ¿Crearlo ahora? (se pedirá la contraseña de forma oculta)' $true
        }
        elseif ($connChanged -or $effectiveMode -eq 'Reconfigure') {
            $why = if ($connChanged) { 'Los datos de conexión cambiaron; el pgpass existente puede no coincidir.' } else { 'Ya existe un pgpass.' }
            $createPg = & $P.Confirm "$why ¿Reemplazarlo (se pedirá la contraseña)?" $connChanged
        }
        else { & $say 'pgpass existente: se conserva sin cambios.' }

        if ($createPg) {
            $secure = $null
            try {
                $secure = & $P.AskSecret "Contraseña del usuario '$($vals['backupUser'])' (no se mostrará)"
                New-PgPassFile -Path $pgpassFile -HostName $vals['host'] -Port ([int]$vals['port']) -Database $vals['database'] -User $vals['backupUser'] -Password $secure | Out-Null
                $result.PgPassCreated = $true
                & $say 'pgpass creado con permisos restringidos (solo su usuario y SYSTEM).'
            }
            catch {
                $result.Errors = @('No se pudo crear el pgpass de forma segura. No se dejó ningún archivo parcial.')
                & $say $result.Errors[0]
                return (Finish $result 'Failed')
            }
            finally { if ($secure) { $secure.Dispose() } }
        }
    }

    # --- Task Scheduler: solo con confirmación explícita ---
    if ($RegisterTasks) {
        if (& $P.Confirm '¿Deseas registrar las tareas programadas ahora? (puede solicitar el UAC de Windows)' $false) {
            # El registro devuelve $false si falló o el UAC se canceló: nunca se informa éxito en ese caso.
            $registerOutput = @(& $RegisterTasks)
            $result.TasksRegistered = -not ($registerOutput -contains $false)
            if (-not $result.TasksRegistered) { & $say 'Las tareas programadas NO quedaron registradas (puede reintentarlo cuando quiera; nada más quedó a medias).' }
        }
        else { & $say 'Tareas programadas NO registradas. Puede hacerlo después con Register-DaubertBackupTasks.ps1 (use -WhatIf para previsualizar).' }
    }

    & $say ''
    & $say 'Siguiente paso: ejecute Test-DaubertBackupEnvironment.ps1 para validar el entorno.'
    $action = switch ($effectiveMode) { 'Install' { 'Installed' } 'Repair' { 'Repaired' } default { 'Reconfigured' } }
    if ($effectiveMode -ne 'Install' -and -not $result.ConfigChanged -and -not $result.PgPassCreated -and -not $result.RecipientsWritten -and -not $createBackupRoot) { $action = 'NoChange' }
    return (Finish $result $action)
}

Export-ModuleMember -Function Invoke-BackupInstall, Get-InstallFieldProblem, Get-DefaultInstallDetection
