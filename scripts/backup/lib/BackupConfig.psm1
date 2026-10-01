#Requires -Version 5.1
<#
    BackupConfig.psm1
    Resuelve la configuración de un backup (rutas, tier, retención) sin leer
    ni imprimir ningún secreto. La contraseña de PostgreSQL nunca pasa por
    este módulo (solo la RUTA de PGPASSFILE). El cifrado es ASIMÉTRICO
    (age): este módulo solo maneja la ruta de un archivo de destinatarios
    (claves PÚBLICAS, no secretas) — nunca una clave privada.
#>

Set-StrictMode -Version Latest

# Valores por defecto NO dependientes de la máquina ni del usuario. Las rutas
# (BackupRoot, PgBinPath, 7-Zip, age...) NO tienen default hardcodeado: las
# resuelve config.json (BackupLocalConfig.psm1) o la detección de este módulo
# (Find-*). Todo es sobre-escribible por parámetro para permitir pruebas
# aisladas que nunca tocan rutas reales.
$script:DefaultPgHost = 'localhost'
$script:DefaultPgPort = 5432
$script:DefaultPgUser = 'daubert_backup'
$script:DefaultPgDatabase = 'daubert_global'

function Get-DefaultRetention {
    <#
        Retención por defecto por tier (fuente única; config.json puede
        sobre-escribirla en la sección "retention").
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Frequent', 'Daily', 'Monthly')]
        [string]$Tier
    )
    switch ($Tier) {
        'Frequent' { [pscustomobject]@{ Unit = 'Days'; Value = 7 } }
        'Daily' { [pscustomobject]@{ Unit = 'Days'; Value = 30 } }
        'Monthly' { [pscustomobject]@{ Unit = 'Months'; Value = 12 } }
    }
}

function Get-DefaultSchedule {
    <#
        Schedule por defecto por tier (fuente única; config.json puede
        sobre-escribirlo en la sección "schedules").
          - Frequent: cada intervalHours horas a partir de startTime.
          - Daily: una vez al día a startTime.
          - Monthly: una vez al mes, día dayOfMonth (1-28), a startTime.
        Las horas están escalonadas a propósito (00:30/02:00/03:00) para que
        las ejecuciones raramente compitan por el lock interno.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Frequent', 'Daily', 'Monthly')]
        [string]$Tier
    )
    switch ($Tier) {
        'Frequent' { [pscustomobject]@{ startTime = '00:30'; intervalHours = 4 } }
        'Daily' { [pscustomobject]@{ startTime = '02:00' } }
        'Monthly' { [pscustomobject]@{ startTime = '03:00'; dayOfMonth = 1 } }
    }
}

function Get-DefaultLockTimeoutSeconds {
    <#
        Espera por defecto (segundos) por backup.lock de las TAREAS PROGRAMADAS (config.json puede
        sobre-escribirla en schedules.<Tier>.lockTimeoutSeconds). Frequent conserva 0 (falla de inmediato,
        como siempre): su siguiente oportunidad es la ejecucion de 4 h despues. Daily y Monthly esperan a que
        termine otra ejecucion (los backups duran segundos) y, si aun asi no hay lock, el siguiente disparo
        horario del Task Scheduler (-OnlyIfDue) vuelve a intentarlo. Debe quedar MUY por debajo del limite
        de ejecucion de la tarea (4 h).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Frequent', 'Daily', 'Monthly')]
        [string]$Tier
    )
    switch ($Tier) {
        'Frequent' { 0 }
        'Daily' { 900 }
        'Monthly' { 900 }
    }
}

function Get-DefaultBackupPaths {
    <#
        Layout estándar Código ≠ configuración ≠ secretos ≠ datos, calculado
        SOLO a partir de variables estándar del sistema (nunca de un usuario
        concreto). Son PROPUESTAS: el entrypoint NO las carga solo; las usan
        el instalador y los scripts auxiliares. Los parámetros permiten a las
        pruebas redirigir todo a directorios temporales.
    #>
    [CmdletBinding()]
    param(
        [string]$ProgramDataRoot = $env:ProgramData,
        [string]$LocalAppDataRoot = $env:LOCALAPPDATA
    )

    $configRoot = Join-Path $ProgramDataRoot 'DaubertHub\Backup'
    $secretsRoot = Join-Path $LocalAppDataRoot 'DaubertHub\secrets'

    [pscustomobject]@{
        ConfigRoot         = $configRoot
        ConfigPath         = Join-Path $configRoot 'config.json'
        RecipientsFilePath = Join-Path $configRoot 'age-recipients.txt'
        LogRoot            = Join-Path $configRoot 'logs'
        LockRoot           = Join-Path $configRoot 'locks'
        SecretsRoot        = $secretsRoot
        PgPassFile         = Join-Path $secretsRoot 'pgpass-backup.conf'
        # El staging contiene texto plano efímero (dumps antes de cifrar):
        # por eso va bajo el perfil del usuario (ACL privada por defecto),
        # no bajo ProgramData (legible por todos los usuarios).
        StagingRoot        = Join-Path $LocalAppDataRoot 'DaubertHub\staging'
    }
}

function Get-EnvironmentPathList {
    # Devuelve variables de entorno estándar no vacías (para roots de búsqueda).
    param([string[]]$Names)
    foreach ($n in $Names) {
        $v = [Environment]::GetEnvironmentVariable($n)
        if (-not [string]::IsNullOrWhiteSpace($v)) { $v }
    }
}

function Test-BackupToolPath {
    <#
        Único punto que comprueba la existencia de un ejecutable externo
        (pg_dump, pg_restore, 7z, age...). Existe para que las pruebas lo
        sustituyan con un mock y NO necesiten crear archivos con nombres de
        herramientas reales. En producción es un Test-Path normal.
    #>
    [CmdletBinding()]
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return (Test-Path -LiteralPath $Path -PathType Leaf)
}

function ConvertTo-PostgresDirVersion {
    # "18" -> 18.0 ; "9.6" -> 9.6 ; nombre sin dígitos -> $null
    param([string]$Name)
    $clean = ($Name -replace '[^0-9.]', '').Trim('.')
    if (-not $clean) { return $null }
    $ver = [version]'0.0'
    if ([version]::TryParse($clean, [ref]$ver)) { return $ver }
    $num = 0
    if ([int]::TryParse(($clean -replace '[^0-9]', ''), [ref]$num)) { return (New-Object version($num, 0)) }
    return $null
}

function Get-PostgresInstallations {
    <#
        Lista TODAS las instalaciones candidatas de PostgreSQL (sin elegir):
        una por carpeta <ProgramFiles>\PostgreSQL\<versión>\bin y, si existe,
        la de pg_dump.exe en PATH. Para cada una indica qué herramientas
        requeridas tiene y cuáles faltan:
          { Label, Version ([version] o $null), Bin, Present[], Missing[], IsComplete }
        Ordenadas por versión descendente. No ejecuta nada. -SearchRoots
        reemplaza los roots por defecto y -SkipPath omite PATH (pruebas).
    #>
    [CmdletBinding()]
    param(
        [string[]]$SearchRoots,
        [switch]$SkipPath,
        [string[]]$RequiredExecutables = @('pg_dump.exe', 'pg_restore.exe', 'pg_dumpall.exe')
    )

    if (-not $PSBoundParameters.ContainsKey('SearchRoots')) {
        $SearchRoots = @(Get-EnvironmentPathList -Names 'ProgramFiles', 'ProgramFiles(x86)' | ForEach-Object { Join-Path $_ 'PostgreSQL' })
    }

    $list = New-Object System.Collections.Generic.List[object]
    $seen = @{}
    $add = {
        param($label, $ver, $bin)
        $key = $bin.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { return }
        $seen[$key] = $true
        $present = @($RequiredExecutables | Where-Object { Test-BackupToolPath -Path (Join-Path $bin $_) })
        $missing = @($RequiredExecutables | Where-Object { $present -notcontains $_ })
        $list.Add([pscustomobject]@{ Label = $label; Version = $ver; Bin = $bin; Present = $present; Missing = $missing; IsComplete = ($missing.Count -eq 0) })
    }

    foreach ($root in $SearchRoots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($dir in (Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
            $bin = Join-Path $dir.FullName 'bin'
            if (-not (Test-Path -LiteralPath $bin -PathType Container)) { continue }
            & $add $dir.Name (ConvertTo-PostgresDirVersion -Name $dir.Name) $bin
        }
    }

    if (-not $SkipPath) {
        $cmd = Get-Command -Name 'pg_dump.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { & $add 'PATH' $null (Split-Path -Parent $cmd.Source) }
    }

    # Versión desc; las de versión desconocida (PATH) al final.
    @($list | Sort-Object -Property @{ Expression = { if ($null -eq $_.Version) { [version]'0.0' } else { $_.Version } }; Descending = $true })
}

function Select-PostgresInstallation {
    <#
        Elige la instalación de versión MÁS ALTA que sea a la vez COMPLETA
        (tiene todos los ejecutables requeridos) y COMPATIBLE (>= MinimumVersion;
        una versión desconocida no se descarta aquí: se verifica al consultarla).
        Devuelve la instalación o $null.
    #>
    [CmdletBinding()]
    param(
        [object[]]$Installations,
        [version]$MinimumVersion = [version]'0.0'
    )
    @($Installations | Where-Object { $_.IsComplete -and ($null -eq $_.Version -or $_.Version -ge $MinimumVersion) } |
        Sort-Object -Property @{ Expression = { if ($null -eq $_.Version) { [version]'0.0' } else { $_.Version } }; Descending = $true }) | Select-Object -First 1
}

function Get-PostgresInstallationDiagnostic {
    <#
        Texto de diagnóstico cuando no hay ninguna instalación completa y
        compatible: qué instalaciones se encontraron y qué les falta a cada
        una (por versión/etiqueta, sin rutas ni datos sensibles).
    #>
    [CmdletBinding()]
    param(
        [object[]]$Installations,
        [version]$MinimumVersion = [version]'0.0'
    )
    $items = @($Installations)
    if ($items.Count -eq 0) { return 'no se detectó ninguna instalación de PostgreSQL' }
    $parts = foreach ($i in $items) {
        $name = if ($i.Label -eq 'PATH') { 'PostgreSQL (PATH)' } else { "PostgreSQL $($i.Label)" }
        $issues = @()
        if (-not $i.IsComplete) { $issues += 'falta ' + ($i.Missing -join ', ') }
        if ($null -ne $i.Version -and $i.Version -lt $MinimumVersion) { $issues += "versión inferior a la mínima $MinimumVersion" }
        if ($issues.Count -eq 0) { $issues = @('sin problemas') }
        "$name ($($issues -join '; '))"
    }
    'ninguna instalación completa y compatible. Encontradas: ' + ($parts -join ' | ')
}

function Find-PostgresBinPath {
    <#
        Devuelve el directorio bin de la instalación PostgreSQL de versión
        MÁS ALTA que sea simultáneamente COMPLETA (pg_dump, pg_restore y
        pg_dumpall) y COMPATIBLE (>= -MinimumVersion), no simplemente la más
        alta detectada: una instalación superior incompleta se descarta y se
        usa la siguiente válida. $null si ninguna cumple (usar
        Get-PostgresInstallations / Get-PostgresInstallationDiagnostic para
        explicar por qué). Detección portable: %ProgramFiles%, %ProgramFiles(x86)%
        y PATH; -SearchRoots / -SkipPath permiten aislar pruebas.
    #>
    [CmdletBinding()]
    param(
        [string[]]$SearchRoots,
        [switch]$SkipPath,
        [version]$MinimumVersion = [version]'0.0',
        [string[]]$RequiredExecutables = @('pg_dump.exe', 'pg_restore.exe', 'pg_dumpall.exe')
    )
    $p = @{ RequiredExecutables = $RequiredExecutables; SkipPath = $SkipPath }
    if ($PSBoundParameters.ContainsKey('SearchRoots')) { $p.SearchRoots = $SearchRoots }
    $installs = @(Get-PostgresInstallations @p)
    $sel = Select-PostgresInstallation -Installations $installs -MinimumVersion $MinimumVersion
    if ($sel) { return $sel.Bin }
    return $null
}

function Find-SevenZipPath {
    <#
        Detecta 7z.exe de forma portable (%ProgramFiles%, %ProgramFiles(x86)%,
        luego PATH). $null si no se encuentra.
    #>
    [CmdletBinding()]
    param(
        [string[]]$SearchRoots,
        [switch]$SkipPath
    )
    if (-not $PSBoundParameters.ContainsKey('SearchRoots')) {
        $SearchRoots = @(Get-EnvironmentPathList -Names 'ProgramFiles', 'ProgramFiles(x86)' | ForEach-Object { Join-Path $_ '7-Zip' })
    }
    foreach ($root in $SearchRoots) {
        $p = Join-Path $root '7z.exe'
        if (Test-BackupToolPath -Path $p) { return $p }
    }
    if (-not $SkipPath) {
        $cmd = Get-Command -Name '7z.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

function Find-AgePath {
    <#
        Detecta age.exe de forma portable: <ProgramFiles>\age,
        %LOCALAPPDATA%\Programs\age, enlaces de winget
        (%LOCALAPPDATA%\Microsoft\WinGet\Links), luego PATH. $null si no.
        NO instala nada.
    #>
    [CmdletBinding()]
    param(
        [string[]]$SearchRoots,
        [switch]$SkipPath
    )
    if (-not $PSBoundParameters.ContainsKey('SearchRoots')) {
        $roots = New-Object System.Collections.Generic.List[string]
        foreach ($pf in (Get-EnvironmentPathList -Names 'ProgramFiles', 'ProgramFiles(x86)')) { $roots.Add((Join-Path $pf 'age')) }
        foreach ($la in (Get-EnvironmentPathList -Names 'LOCALAPPDATA')) {
            $roots.Add((Join-Path $la 'Programs\age'))
            $roots.Add((Join-Path $la 'Microsoft\WinGet\Links'))
        }
        $SearchRoots = $roots.ToArray()
    }
    foreach ($root in $SearchRoots) {
        $p = Join-Path $root 'age.exe'
        if (Test-BackupToolPath -Path $p) { return $p }
    }
    if (-not $SkipPath) {
        $cmd = Get-Command -Name 'age.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

function Get-TierDefinition {
    <#
        Define, por tier, las propiedades que no son configurables por el
        operador: subcarpeta y qué artefactos de texto plano se empaquetan
        dentro del artefacto cifrado (globals/schema-only). La retención
        tiene un default centralizado (Get-DefaultRetention) que puede
        sobre-escribirse con -RetentionUnit/-RetentionValue (config.json).

        Contenido por tier (ver docs/operations/postgresql-backup-automation.md):
          - Frequent: solo el dump principal.
          - Daily: dump + schema-only.
          - Monthly: dump + schema-only + globals.
        Los globals NUNCA se generan para Frequent ni Daily: solo Monthly
        los incluye, siempre dentro del artefacto cifrado.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Frequent', 'Daily', 'Monthly')]
        [string]$Tier,

        [ValidateSet('Days', 'Months')]
        [string]$RetentionUnit,

        [Nullable[int]]$RetentionValue = $null
    )

    $ret = Get-DefaultRetention -Tier $Tier
    $unit = if ($PSBoundParameters.ContainsKey('RetentionUnit') -and $RetentionUnit) { $RetentionUnit } else { $ret.Unit }
    $value = if ($null -ne $RetentionValue) { [int]$RetentionValue } else { $ret.Value }

    switch ($Tier) {
        'Frequent' {
            [pscustomobject]@{
                Tier              = 'Frequent'
                SubDir            = 'FREQUENT'
                RetentionUnit     = $unit
                RetentionValue    = $value
                IncludeGlobals    = $false
                SchemaOnlyDefault = $false
            }
        }
        'Daily' {
            [pscustomobject]@{
                Tier              = 'Daily'
                SubDir            = 'DAILY'
                RetentionUnit     = $unit
                RetentionValue    = $value
                IncludeGlobals    = $false
                SchemaOnlyDefault = $true
            }
        }
        'Monthly' {
            [pscustomobject]@{
                Tier              = 'Monthly'
                SubDir            = 'MONTHLY'
                RetentionUnit     = $unit
                RetentionValue    = $value
                IncludeGlobals    = $true
                SchemaOnlyDefault = $true
            }
        }
    }
}

function Get-BackupConfig {
    <#
        .SYNOPSIS
        Construye la configuración completa de una ejecución de backup.

        .NOTES
        No lee el contenido de $PgPassFile ni del archivo de destinatarios.
        Solo valida que las rutas existan/tengan forma válida cuando se le
        pide explícitamente (Test-BackupPrerequisite), nunca aquí.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Frequent', 'Daily', 'Monthly')]
        [string]$Tier,

        [string]$BackupRoot,
        [string]$StagingRoot = (Join-Path ([System.IO.Path]::GetTempPath()) 'daubert-hub-pg-backup-staging'),
        [string]$PgBinPath,
        [string]$PgPassFile = $(if ($env:DAUBERT_BACKUP_PGPASSFILE) { $env:DAUBERT_BACKUP_PGPASSFILE } else { $null }),
        [string]$PgHost = $script:DefaultPgHost,
        [int]$PgPort = $script:DefaultPgPort,
        [string]$PgUser = $script:DefaultPgUser,
        [string]$PgDatabase = $script:DefaultPgDatabase,
        [string]$SevenZipPath,
        [string]$AgePath,
        [string]$RecipientsFilePath = $(if ($env:DAUBERT_BACKUP_RECIPIENTS_FILE) { $env:DAUBERT_BACKUP_RECIPIENTS_FILE } else { $null }),
        [string]$LogRoot,
        [string]$LockRoot,
        [ValidateSet('Days', 'Months')]
        [string]$RetentionUnit,
        [Nullable[int]]$RetentionValue = $null,
        [string]$LockFilePath,
        [Nullable[bool]]$SchemaOnlySnapshot = $null,
        [Nullable[bool]]$IncludeGlobals = $null
    )

    $tierArgs = @{ Tier = $Tier }
    if ($RetentionUnit) { $tierArgs.RetentionUnit = $RetentionUnit }
    if ($null -ne $RetentionValue) { $tierArgs.RetentionValue = $RetentionValue }
    $def = Get-TierDefinition @tierArgs

    # BackupRoot puede estar vacío (aún sin resolver): Test-BackupPrerequisite
    # lo reporta; aquí nunca se lanza una excepción por eso.
    $tierDir = if ($BackupRoot) { Join-Path $BackupRoot $def.SubDir } else { $null }
    # Logs: <LogRoot>\<TIER> si hay LogRoot (config); si no, <BackupRoot>\LOGS\<TIER>.
    $logDir = if ($LogRoot) { Join-Path $LogRoot $def.SubDir }
    elseif ($BackupRoot) { Join-Path $BackupRoot (Join-Path 'LOGS' $def.SubDir) }
    else { Join-Path ([System.IO.Path]::GetTempPath()) (Join-Path 'daubert-hub-pg-backup-logs' $def.SubDir) }
    $effectiveLockFile = if ($LockFilePath) { $LockFilePath }
    elseif ($LockRoot) { Join-Path $LockRoot 'backup.lock' }
    else { Join-Path ([System.IO.Path]::GetTempPath()) 'daubert-hub-pg-backup.lock' }

    $effectiveSchemaOnly = if ($null -ne $SchemaOnlySnapshot) { $SchemaOnlySnapshot } else { $def.SchemaOnlyDefault }
    $effectiveGlobals = if ($null -ne $IncludeGlobals) { $IncludeGlobals } else { $def.IncludeGlobals }

    [pscustomobject]@{
        Tier               = $Tier
        BackupRoot         = $BackupRoot
        TierDir            = $tierDir
        LogDir             = $logDir
        StagingRoot        = $StagingRoot
        RetentionUnit      = $def.RetentionUnit
        RetentionValue     = $def.RetentionValue
        IncludeGlobals     = $effectiveGlobals
        SchemaOnlySnapshot = $effectiveSchemaOnly
        PgBinPath          = $PgBinPath
        PgPassFile         = $PgPassFile
        PgHost             = $PgHost
        PgPort             = $PgPort
        PgUser             = $PgUser
        PgDatabase         = $PgDatabase
        SevenZipPath       = $SevenZipPath
        AgePath            = $AgePath
        RecipientsFilePath = $RecipientsFilePath
        LockFilePath       = $effectiveLockFile
        LogRoot            = $LogRoot
        LockRoot           = $LockRoot
    }
}

function Test-BackupPrerequisite {
    <#
        Valida prerequisitos SIN leer/imprimir contenido sensible: que los
        binarios (PostgreSQL, 7-Zip para empaquetar, age para cifrar)
        existan, que PGPASSFILE esté definido y apunte a un archivo
        existente, y que el archivo de destinatarios de age exista y
        contenga al menos una clave PÚBLICA reconocible. Nunca se
        referencia ni se valida ninguna clave PRIVADA aquí — el job no la
        necesita ni la tiene. No se hace ninguna conexión a PostgreSQL.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config
    )

    $errors = New-Object System.Collections.Generic.List[string]

    if ([string]::IsNullOrWhiteSpace($Config.PgBinPath)) {
        $errors.Add('PgBinPath no está configurado ni pudo detectarse (PostgreSQL bin). Ejecute Install-DaubertBackup.ps1 o defina -PgBinPath / "postgresBin" en config.json.')
    }
    else {
        foreach ($exe in @('pg_dump.exe', 'pg_restore.exe', 'pg_dumpall.exe')) {
            $path = Join-Path $Config.PgBinPath $exe
            if (-not (Test-BackupToolPath -Path $path)) {
                $errors.Add("No se encontró el binario requerido: $path")
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($Config.PgPassFile)) {
        $errors.Add('PgPassFile no está configurado (defina -PgPassFile o la variable de entorno DAUBERT_BACKUP_PGPASSFILE). La contraseña nunca debe pasarse por línea de comandos.')
    }
    elseif (-not (Test-Path -LiteralPath $Config.PgPassFile -PathType Leaf)) {
        $errors.Add('El archivo PGPASSFILE configurado no existe en la ruta indicada.')
    }

    if ([string]::IsNullOrWhiteSpace($Config.SevenZipPath) -or -not (Test-BackupToolPath -Path $Config.SevenZipPath)) {
        $errors.Add("No se encontró 7z.exe (empaquetado) en: $($Config.SevenZipPath)")
    }

    if ([string]::IsNullOrWhiteSpace($Config.AgePath) -or -not (Test-BackupToolPath -Path $Config.AgePath)) {
        $errors.Add("No se encontró age.exe (cifrado asimétrico) en: $($Config.AgePath)")
    }

    if ([string]::IsNullOrWhiteSpace($Config.RecipientsFilePath)) {
        $errors.Add('RecipientsFilePath no está configurado.')
    }
    elseif (-not (Test-Path -LiteralPath $Config.RecipientsFilePath -PathType Leaf)) {
        $errors.Add("No existe el archivo de destinatarios de cifrado en: $($Config.RecipientsFilePath).")
    }
    else {
        # Comprobación mínima y duplicada a propósito (en vez de importar
        # BackupEncryption.psm1 aquí): ver la nota en BackupPgTools.psm1 /
        # BackupRetention.psm1 sobre por qué este repo evita Import-Module
        # anidado entre sus propios módulos de lib/. Claves PÚBLICAS, nunca
        # secretas: no hay ningún riesgo en esta duplicación.
        $lines = Get-Content -LiteralPath $Config.RecipientsFilePath -ErrorAction SilentlyContinue
        $validRecipients = @($lines | Where-Object { $_ -and -not $_.TrimStart().StartsWith('#') -and $_.Trim() -match '^age1[a-z0-9]{20,}$' })
        if ($validRecipients.Count -eq 0) {
            $errors.Add('El archivo de destinatarios de cifrado no contiene ninguna clave pública age (age1...) reconocible.')
        }
    }

    if ([string]::IsNullOrWhiteSpace($Config.BackupRoot)) {
        $errors.Add('BackupRoot no puede estar vacío.')
    }

    return [pscustomobject]@{
        IsValid = ($errors.Count -eq 0)
        Errors  = $errors
    }
}

Export-ModuleMember -Function Get-BackupConfig, Get-TierDefinition, Test-BackupPrerequisite, Get-DefaultRetention, Get-DefaultSchedule, Get-DefaultLockTimeoutSeconds, Get-DefaultBackupPaths, Find-PostgresBinPath, Get-PostgresInstallations, Select-PostgresInstallation, Get-PostgresInstallationDiagnostic, Find-SevenZipPath, Find-AgePath, Test-BackupToolPath
