#Requires -Version 5.1
<#
    BackupLocalConfig.psm1
    Configuración LOCAL (no secreta) del sistema de backups de Daubert Hub:
    lectura/validación/escritura atómica de config.json, layout local,
    validación de destinatarios PÚBLICOS de age, detección de claves
    privadas age en rutas administradas, detección de Dropbox y creación
    segura de pgpass-backup.conf.

    Principio: Código ≠ configuración ≠ secretos ≠ datos.
      - config.json (%ProgramData%\DaubertHub\Backup\) NO contiene secretos:
        este módulo RECHAZA claves con aspecto de secreto (password, token,
        privateKey, ...) y valores con formato de clave privada age o de URL
        con credenciales. La única referencia a un secreto es la RUTA del
        pgpass (`pgPassFile`).
      - La contraseña de PostgreSQL solo entra por SecureString
        (Read-Host -AsSecureString, en el instalador) y solo se escribe al
        pgpass, con ACL restrictiva aplicada ANTES de escribir el secreto.
      - Nunca se lee, referencia ni necesita la clave PRIVADA de age.

    Nota de diseño: Este módulo importa (de forma anidada, sin -Force)
    BackupConfig.psm1 para reutilizar Get-Default* y Find-*. El resto de la
    lógica es autocontenida.
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking

$script:SchemaVersion = 1
$script:Tiers = @('Frequent', 'Daily', 'Monthly')
$script:RequiredStringFields = @('database', 'host', 'backupUser', 'postgresBin', 'sevenZipPath', 'agePath', 'recipientsFilePath', 'pgPassFile', 'backupRoot', 'stagingRoot', 'logRoot', 'lockRoot')
$script:PathFields = @('postgresBin', 'sevenZipPath', 'agePath', 'recipientsFilePath', 'pgPassFile', 'backupRoot', 'stagingRoot', 'logRoot', 'lockRoot')
$script:KnownTopLevelKeys = @('schemaVersion') + $script:RequiredStringFields + @('port', 'retention', 'schedules')
# Nombres de clave que delatan un secreto. `pgPassFile` (una RUTA) es la única excepción.
$script:SecretKeyPattern = '(?i)(pass(word|wd|phrase)?|pwd|secret|token|api[-_]?key|private[-_]?key|credential|identity)'
$script:AllowedSecretLikeKeys = @('pgPassFile')

# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

function Get-OptionalProperty {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $p = $Object.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

function Get-PropertyName {
    param($Object)
    if ($null -eq $Object) { return @() }
    if ($Object -is [System.Collections.IDictionary]) { return @($Object.Keys) }
    return @($Object.PSObject.Properties | ForEach-Object { $_.Name })
}

function Find-SecretLikeContent {
    <#
        Recorre recursivamente un objeto de configuración y devuelve una
        lista de descripciones de hallazgos con aspecto de secreto (nombre
        de clave sospechoso o valor con forma de secreto). NUNCA incluye el
        valor sospechoso en el mensaje.
    #>
    param($Node, [string]$Path = '$')

    $found = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Node) { return @() }

    if ($Node -is [string]) {
        if ($Node -match '(?i)AGE-SECRET-KEY-') { $found.Add("$Path contiene una clave privada age") }
        elseif ($Node -match '(?i)PGPASSWORD\s*=') { $found.Add("$Path contiene una asignación PGPASSWORD") }
        elseif ($Node -match '(?i)[a-z][a-z0-9+.\-]*://[^/\s:@]+:[^@\s]+@') { $found.Add("$Path contiene una URL con credenciales embebidas") }
        return $found.ToArray()
    }

    if ($Node -is [System.Collections.IEnumerable] -and $Node -isnot [System.Collections.IDictionary]) {
        $i = 0
        foreach ($item in $Node) { foreach ($f in (Find-SecretLikeContent -Node $item -Path "$Path[$i]")) { $found.Add($f) }; $i++ }
        return $found.ToArray()
    }

    if ($Node -is [System.Collections.IDictionary] -or $Node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($name in (Get-PropertyName -Object $Node)) {
            if ($name -match $script:SecretKeyPattern -and $script:AllowedSecretLikeKeys -notcontains $name) {
                $found.Add("$Path.$name es un nombre de clave que parece un secreto (config.json no admite secretos)")
            }
            foreach ($f in (Find-SecretLikeContent -Node (Get-OptionalProperty -Object $Node -Name $name) -Path "$Path.$name")) { $found.Add($f) }
        }
    }
    return $found.ToArray()
}

function Test-PathIsUnder {
    param([string]$Child, [string]$Parent)
    try {
        $c = [System.IO.Path]::GetFullPath($Child).TrimEnd('\') + '\'
        $p = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
        return $c.StartsWith($p, [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch { return $false }
}

# ---------------------------------------------------------------------------
# Schedules y retención (validación + resolución con defaults)
# ---------------------------------------------------------------------------

function Test-ScheduleDefinition {
    <#
        Valida el schedule de un tier. Devuelve un array de errores (vacío
        si es válido). Campos: startTime "HH:mm" (todos), intervalHours 1-24
        (Frequent), dayOfMonth 1-28 (Monthly).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Frequent', 'Daily', 'Monthly')][string]$Tier,
        [Parameter(Mandatory = $true)]$Schedule
    )

    $errs = New-Object System.Collections.Generic.List[string]
    $allowed = switch ($Tier) { 'Frequent' { @('startTime', 'intervalHours') } 'Daily' { @('startTime') } 'Monthly' { @('startTime', 'dayOfMonth') } }

    foreach ($n in (Get-PropertyName -Object $Schedule)) {
        if ($allowed -notcontains $n) { $errs.Add("schedules.$Tier.$n no es un campo válido para este tier") }
    }

    $start = Get-OptionalProperty -Object $Schedule -Name 'startTime'
    if ($null -ne $start -and (-not ($start -is [string]) -or $start -notmatch '^([01]\d|2[0-3]):[0-5]\d$')) {
        $errs.Add("schedules.$Tier.startTime debe tener formato HH:mm (00:00-23:59)")
    }
    $interval = Get-OptionalProperty -Object $Schedule -Name 'intervalHours'
    if ($Tier -eq 'Frequent' -and $null -ne $interval) {
        if (-not ($interval -is [int] -or $interval -is [long]) -or $interval -lt 1 -or $interval -gt 24) {
            $errs.Add('schedules.Frequent.intervalHours debe ser un entero entre 1 y 24')
        }
    }
    $dom = Get-OptionalProperty -Object $Schedule -Name 'dayOfMonth'
    if ($Tier -eq 'Monthly' -and $null -ne $dom) {
        if (-not ($dom -is [int] -or $dom -is [long]) -or $dom -lt 1 -or $dom -gt 28) {
            $errs.Add('schedules.Monthly.dayOfMonth debe ser un entero entre 1 y 28 (evita meses cortos)')
        }
    }
    return $errs.ToArray()
}

function Get-LocalConfigSchedule {
    <# Schedule efectivo de un tier: valores de config.json sobre los defaults de Get-DefaultSchedule. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][ValidateSet('Frequent', 'Daily', 'Monthly')][string]$Tier
    )
    $def = Get-DefaultSchedule -Tier $Tier
    $user = Get-OptionalProperty -Object (Get-OptionalProperty -Object $Config -Name 'schedules') -Name $Tier
    $out = [ordered]@{}
    foreach ($n in (Get-PropertyName -Object $def)) {
        $v = Get-OptionalProperty -Object $user -Name $n
        $out[$n] = if ($null -ne $v) { $v } else { Get-OptionalProperty -Object $def -Name $n }
    }
    [pscustomobject]$out
}

function Get-LocalConfigRetention {
    <# Retención efectiva de un tier: config.json sobre Get-DefaultRetention. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][ValidateSet('Frequent', 'Daily', 'Monthly')][string]$Tier
    )
    $def = Get-DefaultRetention -Tier $Tier
    $user = Get-OptionalProperty -Object (Get-OptionalProperty -Object $Config -Name 'retention') -Name $Tier
    $u = Get-OptionalProperty -Object $user -Name 'unit'
    $v = Get-OptionalProperty -Object $user -Name 'value'
    [pscustomobject]@{
        Unit  = $(if ($u) { $u } else { $def.Unit })
        Value = $(if ($null -ne $v) { [int]$v } else { $def.Value })
    }
}

# ---------------------------------------------------------------------------
# Validación / lectura / escritura de config.json
# ---------------------------------------------------------------------------

function Test-LocalConfigObject {
    <#
        Valida esquema y contenido de una configuración ya parseada.
        Devuelve { IsValid, Errors[], Warnings[] }. No toca el disco ni la red.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Config)

    $errs = New-Object System.Collections.Generic.List[string]
    $warns = New-Object System.Collections.Generic.List[string]

    if ($null -eq $Config -or $Config -is [string] -or $Config -is [System.Array]) {
        $errs.Add('La configuración debe ser un objeto JSON.')
        return [pscustomobject]@{ IsValid = $false; Errors = $errs.ToArray(); Warnings = @() }
    }

    foreach ($s in (Find-SecretLikeContent -Node $Config)) { $errs.Add("SECRETO RECHAZADO: $s") }

    foreach ($f in $script:RequiredStringFields) {
        $v = Get-OptionalProperty -Object $Config -Name $f
        if ($null -eq $v -or -not ($v -is [string]) -or [string]::IsNullOrWhiteSpace($v)) {
            $errs.Add("Falta el campo obligatorio '$f' (o no es texto).")
        }
    }

    $port = Get-OptionalProperty -Object $Config -Name 'port'
    if ($null -eq $port) { $errs.Add("Falta el campo obligatorio 'port'.") }
    elseif (-not ($port -is [int] -or $port -is [long]) -or $port -lt 1 -or $port -gt 65535) { $errs.Add("'port' debe ser un entero entre 1 y 65535.") }

    foreach ($f in @('database', 'backupUser')) {
        $v = Get-OptionalProperty -Object $Config -Name $f
        if ($v -is [string] -and $v.Trim() -and $v -notmatch '^[A-Za-z0-9_.\-]+$') { $errs.Add("'$f' contiene caracteres no permitidos (solo letras, números, '_', '.', '-').") }
    }
    $hostValue = Get-OptionalProperty -Object $Config -Name 'host'
    if ($hostValue -is [string] -and $hostValue.Trim() -and $hostValue -notmatch '^[A-Za-z0-9_.\-:\[\]]+$') { $errs.Add("'host' contiene caracteres no permitidos.") }

    foreach ($f in $script:PathFields) {
        $v = Get-OptionalProperty -Object $Config -Name $f
        if ($v -is [string] -and $v.Trim()) {
            if ($v -match '["<>|\x00-\x1f]|\*|\?') { $errs.Add("'$f' contiene caracteres no válidos en una ruta.") }
            elseif (-not [System.IO.Path]::IsPathRooted($v) -or $v -notmatch '^([A-Za-z]:\\|\\\\)') { $errs.Add("'$f' debe ser una ruta ABSOLUTA (unidad:\... o UNC).") }
        }
    }

    $pgpass = Get-OptionalProperty -Object $Config -Name 'pgPassFile'
    $backupRoot = Get-OptionalProperty -Object $Config -Name 'backupRoot'
    if ($pgpass -is [string] -and $backupRoot -is [string] -and $pgpass.Trim() -and $backupRoot.Trim() -and (Test-PathIsUnder -Child $pgpass -Parent $backupRoot)) {
        $errs.Add("'pgPassFile' no puede estar dentro de 'backupRoot' (el destino de backups suele sincronizarse a la nube).")
    }

    $sv = Get-OptionalProperty -Object $Config -Name 'schemaVersion'
    if ($null -ne $sv -and $sv -ne $script:SchemaVersion) { $errs.Add("schemaVersion no soportado: se esperaba $($script:SchemaVersion).") }

    $retention = Get-OptionalProperty -Object $Config -Name 'retention'
    if ($null -ne $retention) {
        foreach ($tn in (Get-PropertyName -Object $retention)) {
            if ($script:Tiers -notcontains $tn) { $errs.Add("retention.$tn no es un tier válido (Frequent, Daily, Monthly)."); continue }
            $r = Get-OptionalProperty -Object $retention -Name $tn
            $unit = Get-OptionalProperty -Object $r -Name 'unit'
            $val = Get-OptionalProperty -Object $r -Name 'value'
            if ($null -ne $unit -and @('Days', 'Months') -notcontains $unit) { $errs.Add("retention.$tn.unit debe ser 'Days' o 'Months'.") }
            if ($null -ne $val -and (-not ($val -is [int] -or $val -is [long]) -or $val -lt 1 -or $val -gt 3650)) { $errs.Add("retention.$tn.value debe ser un entero entre 1 y 3650.") }
        }
    }

    $schedules = Get-OptionalProperty -Object $Config -Name 'schedules'
    if ($null -ne $schedules) {
        foreach ($tn in (Get-PropertyName -Object $schedules)) {
            if ($script:Tiers -notcontains $tn) { $errs.Add("schedules.$tn no es un tier válido (Frequent, Daily, Monthly)."); continue }
            foreach ($e in (Test-ScheduleDefinition -Tier $tn -Schedule (Get-OptionalProperty -Object $schedules -Name $tn))) { $errs.Add($e) }
        }
    }

    foreach ($n in (Get-PropertyName -Object $Config)) {
        if ($script:KnownTopLevelKeys -notcontains $n -and $n -notmatch $script:SecretKeyPattern) { $warns.Add("Clave desconocida ignorada: '$n'.") }
    }

    [pscustomobject]@{ IsValid = ($errs.Count -eq 0); Errors = $errs.ToArray(); Warnings = $warns.ToArray() }
}

function Read-LocalBackupConfig {
    <#
        Lee y valida config.json. NUNCA lanza por contenido inválido: devuelve
        { Path, Exists, ParseOk, IsValid, Errors[], Warnings[], Config }.
        Config es $null si no existe o no es JSON parseable.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    $result = [ordered]@{ Path = $Path; Exists = $false; ParseOk = $false; IsValid = $false; Errors = @(); Warnings = @(); Config = $null }

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        $result.Errors = @("No existe el archivo de configuración: $Path")
        return [pscustomobject]$result
    }
    $result.Exists = $true

    try {
        $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($raw)) { throw 'archivo vacío' }
        $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        $result.Errors = @("config.json no es JSON válido: $($_.Exception.Message)")
        return [pscustomobject]$result
    }

    $result.ParseOk = $true
    $result.Config = $parsed
    $v = Test-LocalConfigObject -Config $parsed
    $result.IsValid = $v.IsValid
    $result.Errors = $v.Errors
    $result.Warnings = $v.Warnings
    [pscustomobject]$result
}

function New-LocalBackupConfigObject {
    <#
        Construye un objeto de configuración completo (con retention y
        schedules por defecto explícitos, para que config.json sea
        autodescriptivo). No valida ni escribe.
    #>
    [CmdletBinding()]
    param(
        [string]$Database = 'daubert_global',
        [string]$HostName = 'localhost',
        [int]$Port = 5432,
        [string]$BackupUser = 'daubert_backup',
        [Parameter(Mandatory = $true)][string]$PostgresBin,
        [Parameter(Mandatory = $true)][string]$SevenZipPath,
        [Parameter(Mandatory = $true)][string]$AgePath,
        [Parameter(Mandatory = $true)][string]$RecipientsFilePath,
        [Parameter(Mandatory = $true)][string]$PgPassFile,
        [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)][string]$StagingRoot,
        [Parameter(Mandatory = $true)][string]$LogRoot,
        [Parameter(Mandatory = $true)][string]$LockRoot,
        $Retention,
        $Schedules
    )

    $ret = [ordered]@{}
    $sch = [ordered]@{}
    foreach ($t in $script:Tiers) {
        $r = Get-OptionalProperty -Object $Retention -Name $t
        $d = Get-DefaultRetention -Tier $t
        $ret[$t] = [ordered]@{
            unit  = $(if (Get-OptionalProperty -Object $r -Name 'unit') { Get-OptionalProperty -Object $r -Name 'unit' } else { $d.Unit })
            value = $(if ($null -ne (Get-OptionalProperty -Object $r -Name 'value')) { Get-OptionalProperty -Object $r -Name 'value' } else { $d.Value })
        }
        $s = Get-OptionalProperty -Object $Schedules -Name $t
        $ds = Get-DefaultSchedule -Tier $t
        $entry = [ordered]@{}
        foreach ($n in (Get-PropertyName -Object $ds)) {
            $sv = Get-OptionalProperty -Object $s -Name $n
            $entry[$n] = if ($null -ne $sv) { $sv } else { Get-OptionalProperty -Object $ds -Name $n }
        }
        $sch[$t] = $entry
    }

    [ordered]@{
        schemaVersion      = $script:SchemaVersion
        database           = $Database
        host               = $HostName
        port               = $Port
        backupUser         = $BackupUser
        postgresBin        = $PostgresBin
        sevenZipPath       = $SevenZipPath
        agePath            = $AgePath
        recipientsFilePath = $RecipientsFilePath
        pgPassFile         = $PgPassFile
        backupRoot         = $BackupRoot
        stagingRoot        = $StagingRoot
        logRoot            = $LogRoot
        lockRoot           = $LockRoot
        retention          = $ret
        schedules          = $sch
    }
}

function ConvertTo-PlainConfigJson {
    param($Config)
    # Normaliza cualquier objeto (hashtable/PSCustomObject) a JSON estable.
    ($Config | ConvertTo-Json -Depth 8)
}

function Write-LocalBackupConfig {
    <#
        Escribe config.json de forma ATÓMICA y segura:
          1. valida (rechaza secretos / esquema inválido) ANTES de tocar disco;
          2. escribe a un archivo temporal en el mismo directorio;
          3. relee y revalida el temporal;
          4. reemplaza el destino (File.Replace) o lo mueve si no existía.
        Ante cualquier fallo el config.json previo queda intacto y el
        temporal se elimina. Devuelve { Path, Changed }: Changed=$false si el
        contenido ya era idéntico (no se reescribe: idempotente).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Config
    )

    $asObject = $Config | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $v = Test-LocalConfigObject -Config $asObject
    if (-not $v.IsValid) {
        throw ("Configuración rechazada; config.json existente sin cambios:`n - " + ($v.Errors -join "`n - "))
    }

    $json = ConvertTo-PlainConfigJson -Config $Config
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try {
            $current = [System.IO.File]::ReadAllText($Path, $utf8NoBom)
            if ($current -eq $json) { return [pscustomobject]@{ Path = $Path; Changed = $false } }
        }
        catch { }
    }

    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $tmp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [System.IO.File]::WriteAllText($tmp, $json, $utf8NoBom)

        $check = [System.IO.File]::ReadAllText($tmp, $utf8NoBom) | ConvertFrom-Json
        $cv = Test-LocalConfigObject -Config $check
        if (-not $cv.IsValid) { throw 'La verificación posterior a la escritura del temporal falló.' }

        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            [System.IO.File]::Replace($tmp, $Path, [NullString]::Value)
        }
        else {
            [System.IO.File]::Move($tmp, $Path)
        }
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }

    [pscustomobject]@{ Path = $Path; Changed = $true }
}

function ConvertTo-BackupConfigParameters {
    <#
        Traduce una config.json válida a los parámetros de Get-BackupConfig
        / Start-DaubertPostgresBackup.ps1 (para un tier). Los parámetros
        explícitos del CLI se aplican DESPUÉS y prevalecen (ver entrypoint).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$LocalConfig,
        [Parameter(Mandatory = $true)][ValidateSet('Frequent', 'Daily', 'Monthly')][string]$Tier
    )

    $ret = Get-LocalConfigRetention -Config $LocalConfig -Tier $Tier
    @{
        PgDatabase         = [string](Get-OptionalProperty -Object $LocalConfig -Name 'database')
        PgHost             = [string](Get-OptionalProperty -Object $LocalConfig -Name 'host')
        PgPort             = [int](Get-OptionalProperty -Object $LocalConfig -Name 'port')
        PgUser             = [string](Get-OptionalProperty -Object $LocalConfig -Name 'backupUser')
        PgBinPath          = [string](Get-OptionalProperty -Object $LocalConfig -Name 'postgresBin')
        SevenZipPath       = [string](Get-OptionalProperty -Object $LocalConfig -Name 'sevenZipPath')
        AgePath            = [string](Get-OptionalProperty -Object $LocalConfig -Name 'agePath')
        RecipientsFilePath = [string](Get-OptionalProperty -Object $LocalConfig -Name 'recipientsFilePath')
        PgPassFile         = [string](Get-OptionalProperty -Object $LocalConfig -Name 'pgPassFile')
        BackupRoot         = [string](Get-OptionalProperty -Object $LocalConfig -Name 'backupRoot')
        StagingRoot        = [string](Get-OptionalProperty -Object $LocalConfig -Name 'stagingRoot')
        LogRoot            = [string](Get-OptionalProperty -Object $LocalConfig -Name 'logRoot')
        LockRoot           = [string](Get-OptionalProperty -Object $LocalConfig -Name 'lockRoot')
        RetentionUnit      = $ret.Unit
        RetentionValue     = $ret.Value
    }
}

function Initialize-BackupLayout {
    <#
        Crea (idempotente) las estructuras LOCALES necesarias: logs, locks,
        staging y los directorios padre del pgpass y del archivo de
        destinatarios. El backupRoot (externo, p. ej. Dropbox) solo se crea
        si se pide explícitamente con -CreateBackupRoot. Devuelve la lista
        de directorios creados.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Config,
        [switch]$CreateBackupRoot
    )

    $dirs = New-Object System.Collections.Generic.List[string]
    foreach ($f in 'logRoot', 'lockRoot', 'stagingRoot') { $dirs.Add([string](Get-OptionalProperty -Object $Config -Name $f)) }
    foreach ($f in 'pgPassFile', 'recipientsFilePath') { $dirs.Add((Split-Path -Parent ([string](Get-OptionalProperty -Object $Config -Name $f)))) }
    if ($CreateBackupRoot) { $dirs.Add([string](Get-OptionalProperty -Object $Config -Name 'backupRoot')) }

    $created = New-Object System.Collections.Generic.List[string]
    foreach ($d in ($dirs | Where-Object { $_ } | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $d -PathType Container)) {
            New-Item -ItemType Directory -Path $d -Force | Out-Null
            $created.Add($d)
        }
    }
    , $created.ToArray()
}

# ---------------------------------------------------------------------------
# age: destinatarios públicos y detección de claves privadas
# ---------------------------------------------------------------------------

function Test-AgePublicRecipient {
    <# $true si el texto tiene forma de recipient PÚBLICO age (age1...). #>
    [CmdletBinding()]
    param([string]$Value)
    return ([bool]($Value -and $Value.Trim() -match '^age1[a-z0-9]{20,}$'))
}

function Test-AgePrivateKeyText {
    <# $true si el texto contiene una identidad/clave PRIVADA age (AGE-SECRET-KEY-1...). #>
    [CmdletBinding()]
    param([string]$Text)
    return ([bool]($Text -and $Text -match '(?i)AGE-SECRET-KEY-1[A-Z0-9]+'))
}

function Get-AgeRecipientInfo {
    <#
        Inspecciona el archivo de destinatarios SIN devolver nunca su
        contenido: { Exists, IsValid, RecipientCount, HasPrivateKey, Reason }.
        Si contiene una clave privada, IsValid=$false.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ Exists = $false; IsValid = $false; RecipientCount = 0; HasPrivateKey = $false; Reason = 'El archivo de destinatarios no existe.' }
    }
    $lines = @(Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue)
    $priv = @($lines | Where-Object { Test-AgePrivateKeyText -Text $_ }).Count -gt 0
    $valid = @($lines | Where-Object { $_ -and -not $_.TrimStart().StartsWith('#') -and (Test-AgePublicRecipient -Value $_) })

    if ($priv) {
        return [pscustomobject]@{ Exists = $true; IsValid = $false; RecipientCount = $valid.Count; HasPrivateKey = $true; Reason = 'El archivo de destinatarios contiene una CLAVE PRIVADA age; debe contener solo claves públicas.' }
    }
    if ($valid.Count -eq 0) {
        return [pscustomobject]@{ Exists = $true; IsValid = $false; RecipientCount = 0; HasPrivateKey = $false; Reason = 'No contiene ninguna clave pública age (age1...) reconocible.' }
    }
    [pscustomobject]@{ Exists = $true; IsValid = $true; RecipientCount = $valid.Count; HasPrivateKey = $false; Reason = $null }
}

function Write-AgeRecipientsFile {
    <#
        Escribe (atómicamente) el archivo de destinatarios con SOLO claves
        públicas. Rechaza cualquier valor que no sea un recipient público o
        que sea una clave privada (sin imprimirla).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Recipients
    )

    foreach ($r in $Recipients) {
        if (Test-AgePrivateKeyText -Text $r) { throw 'Se rechazó el valor: parece una clave PRIVADA age. Solo se admiten claves públicas (age1...).' }
        if (-not (Test-AgePublicRecipient -Value $r)) { throw 'Se rechazó un destinatario: no tiene forma de clave pública age (age1...).' }
    }
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $content = "# Daubert Hub - destinatarios PUBLICOS age (no secretos). Nunca pegue aqui una clave privada.`r`n" + (($Recipients | ForEach-Object { $_.Trim() }) -join "`r`n") + "`r`n"
    $tmp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [System.IO.File]::WriteAllText($tmp, $content, (New-Object System.Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $Path -PathType Leaf) { [System.IO.File]::Replace($tmp, $Path, [NullString]::Value) } else { [System.IO.File]::Move($tmp, $Path) }
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
}

function Find-AgePrivateKeyInPath {
    <#
        Busca claves privadas age en rutas administradas. Devuelve objetos
        { Path, Reason } (NUNCA el contenido). Heurísticas:
          - nombre de archivo tipo age-identity*/*.identity, o
          - contenido con AGE-SECRET-KEY-1... en archivos pequeños de texto.
        Omite binarios/artefactos grandes (.age .7z .dump ...) y limita el
        número de archivos revisados por ruta.
    #>
    [CmdletBinding()]
    param(
        [string[]]$Paths,
        [int]$MaxFileBytes = 262144,
        [int]$MaxFiles = 5000
    )

    $skipExt = @('.age', '.7z', '.zip', '.dump', '.exe', '.dll', '.sha256', '.bak', '.gz')
    $hits = New-Object System.Collections.Generic.List[object]

    foreach ($root in @($Paths | Where-Object { $_ } | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $files = @(Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction SilentlyContinue | Select-Object -First $MaxFiles)
        foreach ($f in $files) {
            if ($f.Name -match '(?i)^age[-_.]?(identity|key|secret)' -or $f.Name -match '(?i)\.identity$') {
                $hits.Add([pscustomobject]@{ Path = $f.FullName; Reason = 'Nombre de archivo típico de una identidad age' })
                continue
            }
            if ($skipExt -contains $f.Extension.ToLowerInvariant() -or $f.Length -gt $MaxFileBytes -or $f.Length -eq 0) { continue }
            try {
                $text = [System.IO.File]::ReadAllText($f.FullName)
                if (Test-AgePrivateKeyText -Text $text) {
                    $hits.Add([pscustomobject]@{ Path = $f.FullName; Reason = 'Contiene una clave privada age (AGE-SECRET-KEY-1...)' })
                }
            }
            catch { }
        }
    }
    return $hits.ToArray()
}

# ---------------------------------------------------------------------------
# Dropbox
# ---------------------------------------------------------------------------

function Find-DropboxPath {
    <#
        Detecta carpetas de Dropbox de forma portable: info.json oficial de
        Dropbox (%LOCALAPPDATA%\Dropbox, %APPDATA%\Dropbox) y, como respaldo,
        %USERPROFILE%\Dropbox. Devuelve rutas EXISTENTES (array, posiblemente
        vacío). Es solo una propuesta: el código no depende de Dropbox.
    #>
    [CmdletBinding()]
    param(
        [string[]]$InfoJsonPath,
        [string[]]$FallbackRoot
    )

    if (-not $PSBoundParameters.ContainsKey('InfoJsonPath')) {
        $InfoJsonPath = @(@($env:LOCALAPPDATA, $env:APPDATA) | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'Dropbox\info.json' })
    }
    if (-not $PSBoundParameters.ContainsKey('FallbackRoot')) {
        $FallbackRoot = @(@($env:USERPROFILE) | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'Dropbox' })
    }

    $found = New-Object System.Collections.Generic.List[string]
    foreach ($info in $InfoJsonPath) {
        if (-not (Test-Path -LiteralPath $info -PathType Leaf)) { continue }
        try {
            $json = [System.IO.File]::ReadAllText($info) | ConvertFrom-Json
            foreach ($acct in (Get-PropertyName -Object $json)) {
                $p = Get-OptionalProperty -Object (Get-OptionalProperty -Object $json -Name $acct) -Name 'path'
                if ($p -is [string] -and (Test-Path -LiteralPath $p -PathType Container) -and -not $found.Contains($p)) { $found.Add($p) }
            }
        }
        catch { }
    }
    foreach ($r in $FallbackRoot) {
        if ((Test-Path -LiteralPath $r -PathType Container) -and -not $found.Contains($r)) { $found.Add($r) }
    }
    return $found.ToArray()
}

# ---------------------------------------------------------------------------
# pgpass seguro
# ---------------------------------------------------------------------------

function ConvertTo-PgPassField {
    <# Escapa un campo del formato pgpass: '\' -> '\\' y ':' -> '\:' (en ese orden). #>
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Value)
    return (($Value -replace '\\', '\\') -replace ':', '\:')
}

function Set-RestrictiveFileAcl {
    <#
        Deja el archivo/directorio accesible SOLO para el usuario actual y
        SYSTEM (herencia deshabilitada, reglas previas eliminadas). Se
        identifica por SID: no depende de nombres de usuario.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    $userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier([System.Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
    $isDir = Test-Path -LiteralPath $Path -PathType Container

    # Solo la sección DACL (Access): Get-Acl/Set-Acl incluirían la SACL y
    # exigirían SeSecurityPrivilege. Los errores aquí son TERMINANTES (fallo seguro).
    $item = if ($isDir) { New-Object System.IO.DirectoryInfo($Path) } else { New-Object System.IO.FileInfo($Path) }
    $acl = $item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }

    $inherit = if ($isDir) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @($userSid, $systemSid)) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    $item.SetAccessControl($acl)
}

function Test-SecretFileAcl {
    <#
        Comprueba que solo tengan acceso el usuario actual, SYSTEM y
        Administradores. Devuelve { IsRestricted, UnexpectedPrincipals[] }.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    $allowed = @(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
        'S-1-5-18',
        'S-1-5-32-544'
    )
    $unexpected = New-Object System.Collections.Generic.List[string]
    $item = if (Test-Path -LiteralPath $Path -PathType Container) { New-Object System.IO.DirectoryInfo($Path) } else { New-Object System.IO.FileInfo($Path) }
    $acl = $item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne 'Allow') { continue }
        $sidValue = try { $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { [string]$rule.IdentityReference }
        if ($allowed -notcontains $sidValue) { $unexpected.Add([string]$rule.IdentityReference) }
    }
    [pscustomobject]@{ IsRestricted = ($unexpected.Count -eq 0); UnexpectedPrincipals = $unexpected.ToArray() }
}

function New-PgPassFile {
    <#
        Crea/reemplaza el pgpass del usuario de backup de forma segura:
          1. crea un temporal VACÍO y le aplica la ACL restrictiva ANTES de
             que exista ningún secreto en disco;
          2. convierte el SecureString a texto el mínimo tiempo (BSTR,
             liberado con ZeroFreeBSTR en finally), sin imprimirlo ni
             loggearlo, y escribe bytes UTF-8 SIN BOM;
          3. reemplaza el destino y reaplica la ACL;
          4. borra el temporal ante cualquier fallo (el pgpass previo, si
             existía, queda intacto).
        Formato: host:port:database:user:password con ':' y '\' escapados.
        La contraseña nunca se devuelve, imprime ni pasa por argumentos.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$HostName,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$Database,
        [Parameter(Mandatory = $true)][string]$User,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password
    )

    if ($Password.Length -eq 0) { throw 'La contraseña no puede estar vacía.' }

    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $tmp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    $bytes = $null
    $bstr = [IntPtr]::Zero
    try {
        [System.IO.File]::Create($tmp).Dispose()
        Set-RestrictiveFileAcl -Path $tmp

        try {
            $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
            $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
            if ($plain -match "[\r\n\x00]") { throw 'La contraseña contiene caracteres no admitidos por el formato pgpass (saltos de línea).' }
            $line = (ConvertTo-PgPassField $HostName) + ':' + $Port + ':' + (ConvertTo-PgPassField $Database) + ':' + (ConvertTo-PgPassField $User) + ':' + (ConvertTo-PgPassField $plain) + "`n"
            $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($line)
        }
        finally {
            if ($bstr -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
            $plain = $null
            $line = $null
        }

        $fs = [System.IO.File]::Open($tmp, [System.IO.FileMode]::Truncate, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try { $fs.Write($bytes, 0, $bytes.Length); $fs.Flush() } finally { $fs.Dispose() }

        if (Test-Path -LiteralPath $Path -PathType Leaf) { [System.IO.File]::Replace($tmp, $Path, [NullString]::Value) } else { [System.IO.File]::Move($tmp, $Path) }
        Set-RestrictiveFileAcl -Path $Path
    }
    finally {
        if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }

    [pscustomobject]@{ Created = $true; FileName = (Split-Path -Leaf $Path) }
}

Export-ModuleMember -Function `
    Test-ScheduleDefinition, Get-LocalConfigSchedule, Get-LocalConfigRetention, `
    Test-LocalConfigObject, Read-LocalBackupConfig, New-LocalBackupConfigObject, Write-LocalBackupConfig, `
    ConvertTo-BackupConfigParameters, Initialize-BackupLayout, `
    Test-AgePublicRecipient, Test-AgePrivateKeyText, Get-AgeRecipientInfo, Write-AgeRecipientsFile, Find-AgePrivateKeyInPath, `
    Find-DropboxPath, ConvertTo-PgPassField, Set-RestrictiveFileAcl, Test-SecretFileAcl, New-PgPassFile, Get-OptionalProperty, Get-PropertyName
