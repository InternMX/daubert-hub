#Requires -Version 5.1
<#
    BackupN8nConfig.psm1
    Configuración, tiers, nombres y prerrequisitos del backup de n8n (V1).
    Pieza ESPECÍFICA de n8n: no modifica ni depende del comportamiento del
    backup de PostgreSQL (solo reutiliza Test-BackupToolPath, Find-SevenZipPath,
    Find-AgePath y Test-BackupRecipientsFile).

    config.json (-ConfigPath) NO admite secretos. Campos:
      schemaVersion (opcional, 1), n8nRoot, nodePath, sevenZipPath, agePath,
      recipientsFilePath, backupRoot, stagingRoot, logRoot, lockRoot,
      n8nPackagePath (opcional: carpeta del paquete npm de n8n, solo para leer su versión),
      retention { Weekly|OnChange : { unit: Days|Months, value: 1..3650 } },
      schedules { Weekly : { dayOfWeek: Monday..Sunday, time: "HH:mm" } }  (OnChange NO tiene schedule: es manual)

    Precedencia: parámetro explícito del CLI > config.json > detección portable
    (solo para nodePath/sevenZipPath/agePath; n8nRoot NUNCA se adivina).
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupEncryption.psm1') -DisableNameChecking

$script:N8nSchemaVersion = 1
$script:N8nDaysOfWeek = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
$script:N8nTiers = @('Weekly', 'OnChange')
$script:N8nRequiredPathFields = @('n8nRoot', 'nodePath', 'sevenZipPath', 'agePath', 'recipientsFilePath', 'backupRoot', 'stagingRoot', 'logRoot', 'lockRoot')
$script:N8nOptionalPathFields = @('n8nPackagePath')
$script:N8nKnownKeys = @('schemaVersion', 'retention', 'schedules') + $script:N8nRequiredPathFields + $script:N8nOptionalPathFields
$script:N8nSecretKeyPattern = '(?i)(pass(word|wd|phrase)?|pwd|secret|token|api[-_]?key|private[-_]?key|credential|identity|encryption)'
$script:N8nHelperScriptPath = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'helpers') 'n8n-sqlite-snapshot.js'

function Get-N8nTierDefinition {
    <# Tiers del backup de n8n: SOLO Weekly (56 días) y OnChange (90 días, ejecución manual). #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Weekly', 'OnChange')][string]$Tier,
        [ValidateSet('Days', 'Months')][string]$RetentionUnit,
        [Nullable[int]]$RetentionValue = $null
    )
    switch ($Tier) {
        'Weekly' { $def = @{ SubDir = 'WEEKLY'; FileToken = 'WEEKLY'; Unit = 'Days'; Value = 56 } }
        'OnChange' { $def = @{ SubDir = 'ON_CHANGE'; FileToken = 'ON_CHANGE'; Unit = 'Days'; Value = 90 } }
    }
    $unit = if ($RetentionUnit) { $RetentionUnit } else { $def.Unit }
    $value = if ($null -ne $RetentionValue) { [int]$RetentionValue } else { $def.Value }
    [pscustomobject]@{ Tier = $Tier; SubDir = $def.SubDir; FileToken = $def.FileToken; RetentionUnit = $unit; RetentionValue = $value }
}

function New-N8nArchiveFileName {
    <# n8n_WEEKLY_yyyyMMdd_HHmmss.age / n8n_ON_CHANGE_yyyyMMdd_HHmmss.age #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Weekly', 'OnChange')][string]$Tier,
        [Parameter(Mandatory = $true)][string]$Timestamp
    )
    $token = (Get-N8nTierDefinition -Tier $Tier).FileToken
    return "n8n_${token}_${Timestamp}.age"
}

function Get-N8nArchiveFileNamePattern {
    <# Regex exacto (con grupo 'timestamp') que usa la retención: nunca toca archivos que no coincidan. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][ValidateSet('Weekly', 'OnChange')][string]$Tier)
    $token = [regex]::Escape((Get-N8nTierDefinition -Tier $Tier).FileToken)
    return "^n8n_${token}_(?<timestamp>\d{8}_\d{6})\.age$"
}

function Get-N8nConfigProperty {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) { if ($Object.Contains($Name)) { return $Object[$Name] }; return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

function Get-N8nConfigPropertyName {
    param($Object)
    if ($null -eq $Object) { return @() }
    if ($Object -is [System.Collections.IDictionary]) { return @($Object.Keys) }
    return @($Object.PSObject.Properties | ForEach-Object { $_.Name })
}

function Find-N8nSecretLikeContent {
    <# Nombres de clave o valores con forma de secreto. NUNCA incluye el valor sospechoso en el mensaje. #>
    param($Node, [string]$Path = '$')
    $found = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Node) { return @() }
    if ($Node -is [string]) {
        if ($Node -match '(?i)AGE-SECRET-KEY-') { $found.Add("$Path contiene una clave privada age") }
        elseif ($Node -match '(?i)[a-z][a-z0-9+.\-]*://[^/\s:@]+:[^@\s]+@') { $found.Add("$Path contiene una URL con credenciales embebidas") }
        return $found.ToArray()
    }
    if ($Node -is [System.Collections.IEnumerable] -and $Node -isnot [System.Collections.IDictionary]) {
        $i = 0
        foreach ($item in $Node) { foreach ($f in (Find-N8nSecretLikeContent -Node $item -Path "$Path[$i]")) { $found.Add($f) }; $i++ }
        return $found.ToArray()
    }
    foreach ($name in (Get-N8nConfigPropertyName -Object $Node)) {
        if ($name -match $script:N8nSecretKeyPattern) { $found.Add("$Path.$name es un nombre de clave que parece un secreto (la configuración no admite secretos)") }
        foreach ($f in (Find-N8nSecretLikeContent -Node (Get-N8nConfigProperty -Object $Node -Name $name) -Path "$Path.$name")) { $found.Add($f) }
    }
    return $found.ToArray()
}

function Test-N8nPathUnder {
    param([string]$Child, [string]$Parent)
    try {
        $c = [System.IO.Path]::GetFullPath($Child).TrimEnd('\') + '\'
        $p = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
        return $c.StartsWith($p, [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch { return $false }
}

function Test-N8nConfigObject {
    <# Valida esquema y contenido de config.json ya parseado. No toca el disco. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Config)

    $errs = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Config -or $Config -is [string] -or $Config -is [System.Array]) {
        return [pscustomobject]@{ IsValid = $false; Errors = @('La configuración debe ser un objeto JSON.'); Warnings = @() }
    }
    $warns = New-Object System.Collections.Generic.List[string]

    foreach ($s in (Find-N8nSecretLikeContent -Node $Config)) { $errs.Add("SECRETO RECHAZADO: $s") }

    foreach ($f in $script:N8nRequiredPathFields) {
        $v = Get-N8nConfigProperty -Object $Config -Name $f
        if ($null -eq $v -or -not ($v -is [string]) -or [string]::IsNullOrWhiteSpace($v)) { $errs.Add("Falta el campo obligatorio '$f' (o no es texto).") }
    }
    foreach ($f in ($script:N8nRequiredPathFields + $script:N8nOptionalPathFields)) {
        $v = Get-N8nConfigProperty -Object $Config -Name $f
        if ($v -is [string] -and $v.Trim()) {
            if ($v -match '["<>|\x00-\x1f]|\*|\?') { $errs.Add("'$f' contiene caracteres no válidos en una ruta.") }
            elseif (-not [System.IO.Path]::IsPathRooted($v) -or $v -notmatch '^([A-Za-z]:\\|\\\\)') { $errs.Add("'$f' debe ser una ruta ABSOLUTA (unidad:\... o UNC).") }
        }
    }

    $sv = Get-N8nConfigProperty -Object $Config -Name 'schemaVersion'
    if ($null -ne $sv -and $sv -ne $script:N8nSchemaVersion) { $errs.Add("schemaVersion no soportado: se esperaba $($script:N8nSchemaVersion).") }

    $retention = Get-N8nConfigProperty -Object $Config -Name 'retention'
    if ($null -ne $retention) {
        foreach ($tn in (Get-N8nConfigPropertyName -Object $retention)) {
            if ($script:N8nTiers -notcontains $tn) { $errs.Add("retention.$tn no es un tier válido (Weekly, OnChange)."); continue }
            $r = Get-N8nConfigProperty -Object $retention -Name $tn
            $unit = Get-N8nConfigProperty -Object $r -Name 'unit'
            $val = Get-N8nConfigProperty -Object $r -Name 'value'
            if ($null -ne $unit -and @('Days', 'Months') -notcontains $unit) { $errs.Add("retention.$tn.unit debe ser 'Days' o 'Months'.") }
            if ($null -ne $val -and (-not ($val -is [int] -or $val -is [long]) -or $val -lt 1 -or $val -gt 3650)) { $errs.Add("retention.$tn.value debe ser un entero entre 1 y 3650.") }
        }
    }

    $schedules = Get-N8nConfigProperty -Object $Config -Name 'schedules'
    if ($null -ne $schedules) {
        foreach ($tn in (Get-N8nConfigPropertyName -Object $schedules)) {
            if ($tn -eq 'OnChange') { $errs.Add('schedules.OnChange no existe: el tier OnChange es manual (no tiene schedule).'); continue }
            if ($tn -ne 'Weekly') { $errs.Add("schedules.$tn no es un tier válido (solo Weekly).") ; continue }
            $w = Get-N8nConfigProperty -Object $schedules -Name 'Weekly'
            foreach ($n in (Get-N8nConfigPropertyName -Object $w)) { if (@('dayOfWeek', 'time') -notcontains $n) { $errs.Add("schedules.Weekly.$n no es un campo válido (dayOfWeek, time).") } }
            $dow = Get-N8nConfigProperty -Object $w -Name 'dayOfWeek'
            $tm = Get-N8nConfigProperty -Object $w -Name 'time'
            if ($null -ne $dow -and (-not ($dow -is [string]) -or $script:N8nDaysOfWeek -cnotcontains $dow)) { $errs.Add('schedules.Weekly.dayOfWeek debe ser un día en inglés: ' + ($script:N8nDaysOfWeek -join ', ') + '.') }
            if ($null -ne $tm -and (-not ($tm -is [string]) -or $tm -notmatch '^([01]\d|2[0-3]):[0-5]\d$')) { $errs.Add('schedules.Weekly.time debe tener formato HH:mm (00:00-23:59).') }
        }
    }
    foreach ($n in (Get-N8nConfigPropertyName -Object $Config)) {
        if ($script:N8nKnownKeys -notcontains $n -and $n -notmatch $script:N8nSecretKeyPattern) { $warns.Add("Clave desconocida ignorada: '$n'.") }
    }
    [pscustomobject]@{ IsValid = ($errs.Count -eq 0); Errors = $errs.ToArray(); Warnings = $warns.ToArray() }
}

function Read-N8nBackupConfigFile {
    <# Lee y valida el JSON. NUNCA lanza por contenido inválido. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ IsValid = $false; Errors = @("No existe el archivo de configuración: $Path"); Warnings = @(); Config = $null }
    }
    try {
        $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($raw)) { throw 'archivo vacío' }
        $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return [pscustomobject]@{ IsValid = $false; Errors = @("La configuración no es JSON válido: $($_.Exception.Message)"); Warnings = @(); Config = $null }
    }
    $v = Test-N8nConfigObject -Config $parsed
    [pscustomobject]@{ IsValid = $v.IsValid; Errors = $v.Errors; Warnings = $v.Warnings; Config = $parsed }
}

function Get-N8nBackupConfig {
    <# Construye el objeto de configuración de una ejecución a partir de valores ya resueltos. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Weekly', 'OnChange')][string]$Tier,
        [string]$N8nRoot,
        [string]$NodePath,
        [string]$SevenZipPath,
        [string]$AgePath,
        [string]$RecipientsFilePath,
        [string]$BackupRoot,
        [string]$StagingRoot = (Join-Path ([System.IO.Path]::GetTempPath()) 'daubert-hub-n8n-backup-staging'),
        [string]$LogRoot,
        [string]$LockRoot,
        [string]$LockFilePath,
        [string]$N8nPackagePath,
        [ValidateSet('Days', 'Months')][string]$RetentionUnit,
        [Nullable[int]]$RetentionValue = $null
    )

    $tierArgs = @{ Tier = $Tier }
    if ($RetentionUnit) { $tierArgs.RetentionUnit = $RetentionUnit }
    if ($null -ne $RetentionValue) { $tierArgs.RetentionValue = $RetentionValue }
    $def = Get-N8nTierDefinition @tierArgs

    $tierDir = if ($BackupRoot) { Join-Path (Join-Path $BackupRoot 'N8N') $def.SubDir } else { $null }
    $logDir = if ($LogRoot) { Join-Path (Join-Path $LogRoot 'N8N') $def.SubDir }
    elseif ($BackupRoot) { Join-Path (Join-Path $BackupRoot 'LOGS') (Join-Path 'N8N' $def.SubDir) }
    else { Join-Path ([System.IO.Path]::GetTempPath()) (Join-Path 'daubert-hub-n8n-backup-logs' $def.SubDir) }
    # Lock PROPIO de n8n: no compite con el lock de PostgreSQL (recursos distintos).
    $lockFile = if ($LockFilePath) { $LockFilePath }
    elseif ($LockRoot) { Join-Path $LockRoot 'n8n-backup.lock' }
    else { Join-Path ([System.IO.Path]::GetTempPath()) 'daubert-hub-n8n-backup.lock' }

    [pscustomobject]@{
        Tier               = $Tier
        N8nRoot            = $N8nRoot
        NodePath           = $NodePath
        SevenZipPath       = $SevenZipPath
        AgePath            = $AgePath
        RecipientsFilePath = $RecipientsFilePath
        BackupRoot         = $BackupRoot
        TierDir            = $tierDir
        StagingRoot        = $StagingRoot
        # Staging aislado bajo <StagingRoot>\n8n: la limpieza de huérfanos jamás toca el staging de PostgreSQL.
        N8nStagingRoot     = (Join-Path $StagingRoot 'n8n')
        LogRoot            = $LogRoot
        LogDir             = $logDir
        LockRoot           = $LockRoot
        LockFilePath       = $lockFile
        N8nPackagePath     = $N8nPackagePath
        RetentionUnit      = $def.RetentionUnit
        RetentionValue     = $def.RetentionValue
        HelperScriptPath   = $script:N8nHelperScriptPath
    }
}

function Resolve-N8nBackupRunConfig {
    <# config.json (si -ConfigPath) < parámetros explícitos del CLI. Devuelve { Config, Errors }. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Weekly', 'OnChange')][string]$Tier,
        [string]$ConfigPath,
        [hashtable]$CliParameters = @{}
    )

    $p = @{ Tier = $Tier }
    if ($ConfigPath) {
        $local = Read-N8nBackupConfigFile -Path $ConfigPath
        if (-not $local.IsValid) {
            $errors = @("Configuración inválida en '$ConfigPath':") + @($local.Errors | ForEach-Object { " - $_" })
            return [pscustomobject]@{ Config = $null; Errors = $errors }
        }
        $c = $local.Config
        $map = @{ n8nRoot = 'N8nRoot'; nodePath = 'NodePath'; sevenZipPath = 'SevenZipPath'; agePath = 'AgePath'; recipientsFilePath = 'RecipientsFilePath'
            backupRoot = 'BackupRoot'; stagingRoot = 'StagingRoot'; logRoot = 'LogRoot'; lockRoot = 'LockRoot'; n8nPackagePath = 'N8nPackagePath' }
        foreach ($k in $map.Keys) {
            $v = Get-N8nConfigProperty -Object $c -Name $k
            if ($v -is [string] -and $v.Trim()) { $p[$map[$k]] = $v }
        }
        $ret = Get-N8nConfigProperty -Object (Get-N8nConfigProperty -Object $c -Name 'retention') -Name $Tier
        if ($null -ne $ret) {
            $u = Get-N8nConfigProperty -Object $ret -Name 'unit'
            $v = Get-N8nConfigProperty -Object $ret -Name 'value'
            if ($u) { $p.RetentionUnit = $u }
            if ($null -ne $v) { $p.RetentionValue = [int]$v }
        }
    }
    foreach ($key in $CliParameters.Keys) { $p[$key] = $CliParameters[$key] }

    # Detección portable como último recurso (nunca rutas de usuario fijas).
    if ([string]::IsNullOrWhiteSpace([string]$p['SevenZipPath'])) { $f = Find-SevenZipPath; if ($f) { $p.SevenZipPath = $f } }
    if ([string]::IsNullOrWhiteSpace([string]$p['AgePath'])) { $f = Find-AgePath; if ($f) { $p.AgePath = $f } }
    if ([string]::IsNullOrWhiteSpace([string]$p['NodePath'])) {
        $cmd = Get-Command -Name 'node.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { $p.NodePath = $cmd.Source }
    }

    [pscustomobject]@{ Config = (Get-N8nBackupConfig @p); Errors = @() }
}

function Test-N8nBackupPrerequisite {
    <#
        Valida prerrequisitos SIN leer ni imprimir contenido sensible. El archivo
        'config' de n8n es OBLIGATORIO en esta V1: solo se comprueba su existencia
        (jamás se abre). Devuelve { IsValid, Errors }.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][psobject]$Config)

    $errors = New-Object System.Collections.Generic.List[string]

    if ([string]::IsNullOrWhiteSpace($Config.N8nRoot)) { $errors.Add('N8nRoot no está configurado.') }
    else {
        if (-not (Test-Path -LiteralPath $Config.N8nRoot -PathType Container)) { $errors.Add('N8nRoot no existe o no es un directorio.') }
        else {
            if (-not (Test-Path -LiteralPath (Join-Path $Config.N8nRoot 'database.sqlite') -PathType Leaf)) { $errors.Add("No existe 'database.sqlite' en N8nRoot.") }
            if (-not (Test-Path -LiteralPath (Join-Path $Config.N8nRoot 'config') -PathType Leaf)) { $errors.Add("No existe el archivo 'config' de n8n en N8nRoot (obligatorio en esta versión del backup).") }
        }
        foreach ($pair in @(@('BackupRoot', $Config.BackupRoot), @('StagingRoot', $Config.StagingRoot))) {
            if ($pair[1] -and $Config.N8nRoot -and (Test-N8nPathUnder -Child $pair[1] -Parent $Config.N8nRoot)) {
                $errors.Add("$($pair[0]) no puede estar dentro de N8nRoot (el backup nunca escribe en la instalación de n8n).")
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($Config.NodePath) -or -not (Test-BackupToolPath -Path $Config.NodePath)) { $errors.Add('No se encontró node.exe (snapshot SQLite con node:sqlite).') }
    if ([string]::IsNullOrWhiteSpace($Config.SevenZipPath) -or -not (Test-BackupToolPath -Path $Config.SevenZipPath)) { $errors.Add('No se encontró 7z.exe (empaquetado).') }
    if ([string]::IsNullOrWhiteSpace($Config.AgePath) -or -not (Test-BackupToolPath -Path $Config.AgePath)) { $errors.Add('No se encontró age.exe (cifrado asimétrico).') }

    if ([string]::IsNullOrWhiteSpace($Config.RecipientsFilePath)) { $errors.Add('RecipientsFilePath no está configurado.') }
    else {
        $rc = Test-BackupRecipientsFile -RecipientsFilePath $Config.RecipientsFilePath
        if (-not $rc.IsValid) { $errors.Add($rc.Reason) }
    }

    if ([string]::IsNullOrWhiteSpace($Config.BackupRoot)) { $errors.Add('BackupRoot no puede estar vacío.') }
    if (-not (Test-Path -LiteralPath $Config.HelperScriptPath -PathType Leaf)) { $errors.Add('No se encontró el helper versionado del snapshot SQLite (helpers\n8n-sqlite-snapshot.js).') }

    [pscustomobject]@{ IsValid = ($errors.Count -eq 0); Errors = $errors.ToArray() }
}


function Get-N8nSchedule {
    <# Schedule efectivo de Weekly: config sobre el default (domingo 04:30). OnChange no tiene schedule. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Config)
    $user = Get-N8nConfigProperty -Object (Get-N8nConfigProperty -Object $Config -Name 'schedules') -Name 'Weekly'
    $d = Get-N8nConfigProperty -Object $user -Name 'dayOfWeek'
    $tm = Get-N8nConfigProperty -Object $user -Name 'time'
    [pscustomobject]@{ dayOfWeek = $(if ($d) { [string]$d } else { 'Sunday' }); time = $(if ($tm) { [string]$tm } else { '04:30' }) }
}

function Get-N8nDefaultPaths {
    <#
        Layout por defecto del backup de n8n. El config es INDEPENDIENTE del de PostgreSQL
        (n8n-config.json, nunca config.json). Se comparten solo carpetas genéricas
        (destinatarios públicos, logs, locks, staging), siempre con subcarpetas propias de n8n.
    #>
    [CmdletBinding()]
    param([string]$ProgramDataRoot = $env:ProgramData, [string]$LocalAppDataRoot = $env:LOCALAPPDATA)
    $pg = Get-DefaultBackupPaths -ProgramDataRoot $ProgramDataRoot -LocalAppDataRoot $LocalAppDataRoot
    [pscustomobject]@{
        ConfigRoot         = $pg.ConfigRoot
        ConfigPath         = Join-Path $pg.ConfigRoot 'n8n-config.json'
        RecipientsFilePath = $pg.RecipientsFilePath
        LogRoot            = $pg.LogRoot
        LockRoot           = $pg.LockRoot
        StagingRoot        = $pg.StagingRoot
    }
}

function New-N8nConfigObject {
    <# Objeto n8n-config.json (sin secretos). n8nPackagePath solo se incluye si se indica. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$N8nRoot, [Parameter(Mandatory = $true)][string]$NodePath, [string]$N8nPackagePath,
        [Parameter(Mandatory = $true)][string]$SevenZipPath, [Parameter(Mandatory = $true)][string]$AgePath,
        [Parameter(Mandatory = $true)][string]$RecipientsFilePath, [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)][string]$StagingRoot, [Parameter(Mandatory = $true)][string]$LogRoot, [Parameter(Mandatory = $true)][string]$LockRoot,
        $Retention, $Schedules
    )
    $o = [ordered]@{ schemaVersion = $script:N8nSchemaVersion; n8nRoot = $N8nRoot; nodePath = $NodePath }
    if ($N8nPackagePath) { $o.n8nPackagePath = $N8nPackagePath }
    $o.sevenZipPath = $SevenZipPath; $o.agePath = $AgePath; $o.recipientsFilePath = $RecipientsFilePath
    $o.backupRoot = $BackupRoot; $o.stagingRoot = $StagingRoot; $o.logRoot = $LogRoot; $o.lockRoot = $LockRoot
    $o.retention = if ($Retention) { $Retention } else { [ordered]@{ Weekly = [ordered]@{ unit = 'Days'; value = 56 }; OnChange = [ordered]@{ unit = 'Days'; value = 90 } } }
    $o.schedules = if ($Schedules) { $Schedules } else { [ordered]@{ Weekly = [ordered]@{ dayOfWeek = 'Sunday'; time = '04:30' } } }
    return $o
}

function Write-N8nBackupConfig {
    <#
        Escribe n8n-config.json de forma ATÓMICA: valida (rechaza secretos) ANTES de tocar disco,
        escribe a un temporal, relee y revalida, y reemplaza. Ante fallo el archivo previo queda intacto.
        Devuelve { Path, Changed } (Changed=$false si el contenido ya era idéntico: idempotente).
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Config)

    $json = $Config | ConvertTo-Json -Depth 8
    $v = Test-N8nConfigObject -Config ($json | ConvertFrom-Json)
    if (-not $v.IsValid) { throw ("Configuración n8n rechazada; el archivo existente queda sin cambios:`n - " + ($v.Errors -join "`n - ")) }

    $utf8 = New-Object System.Text.UTF8Encoding($false)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try { if ([System.IO.File]::ReadAllText($Path, $utf8) -eq $json) { return [pscustomobject]@{ Path = $Path; Changed = $false } } } catch { }
    }
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [System.IO.File]::WriteAllText($tmp, $json, $utf8)
        $cv = Test-N8nConfigObject -Config ([System.IO.File]::ReadAllText($tmp, $utf8) | ConvertFrom-Json)
        if (-not $cv.IsValid) { throw 'La verificación posterior a la escritura del temporal falló.' }
        if (Test-Path -LiteralPath $Path -PathType Leaf) { [System.IO.File]::Replace($tmp, $Path, [NullString]::Value) } else { [System.IO.File]::Move($tmp, $Path) }
    }
    finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } }
    [pscustomobject]@{ Path = $Path; Changed = $true }
}
Export-ModuleMember -Function Get-N8nConfigProperty, Get-N8nConfigPropertyName, Test-N8nPathUnder, Get-N8nSchedule, Get-N8nDefaultPaths, New-N8nConfigObject, Write-N8nBackupConfig, Get-N8nTierDefinition, New-N8nArchiveFileName, Get-N8nArchiveFileNamePattern, Test-N8nConfigObject, Read-N8nBackupConfigFile, Get-N8nBackupConfig, Resolve-N8nBackupRunConfig, Test-N8nBackupPrerequisite
