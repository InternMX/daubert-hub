#Requires -Version 5.1
<#
    BackupN8nPreflight.psm1
    Diagnóstico NO destructivo del backup de n8n. NO ejecuta snapshot ni backup, NO restaura, NO abre ni
    modifica la SQLite de n8n, NO lee ni imprime el contenido de '.n8n\config' (solo comprueba que existe),
    NO registra tareas y no busca claves privadas age salvo para verificar que NO existen en rutas
    administradas (nunca en n8nRoot).

    Las dependencias del sistema se inyectan (-NodeProbe, -TaskQuery, -FreeSpaceProvider) para probar
    cada rama sin tocar Node, Task Scheduler ni discos reales.
    Único efecto en disco (transitorio): el archivo de sondeo que crea y borra Get-DirectoryWriteStatus.

    Resultado: PASS -> exit 0, WARN -> exit 1, FAIL -> exit 2.
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLocalConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupPreflight.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nSqlite.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nStaging.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nTasks.psm1') -DisableNameChecking

function Get-N8nDefaultFreeSpaceBytes {
    param([string]$Path)
    try {
        $full = [System.IO.Path]::GetFullPath($Path)
        $root = [System.IO.Path]::GetPathRoot($full)
        if (-not $root -or $root.StartsWith('\\')) { return $null }
        return [double](New-Object System.IO.DriveInfo($root)).AvailableFreeSpace
    }
    catch { return $null }
}

function Get-N8nDefaultTaskState {
    <# Consulta de SOLO LECTURA de la tarea administrada de n8n. #>
    param([string[]]$Names)
    foreach ($n in $Names) {
        try {
            $t = Get-ScheduledTask -TaskName $n -ErrorAction Stop
            $i = Get-ScheduledTaskInfo -TaskName $n -ErrorAction Stop
            [pscustomobject]@{ TaskName = $n; Exists = $true; State = [string]$t.State; LastTaskResult = [int64]$i.LastTaskResult; LastRunTime = $i.LastRunTime; NextRunTime = $i.NextRunTime; Xml = $(try { [string](Export-ScheduledTask -TaskName $n -ErrorAction Stop) } catch { $null }) }
        }
        catch { [pscustomobject]@{ TaskName = $n; Exists = $false; State = $null; LastTaskResult = $null; LastRunTime = $null; NextRunTime = $null; Xml = $null } }
    }
}

function Invoke-N8nPreflight {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [scriptblock]$NodeProbe,
        [scriptblock]$TaskQuery,
        [scriptblock]$FreeSpaceProvider,
        [datetime]$Now = (Get-Date),
        [double]$MinFreeSpaceGB = 5,
        # Weekly: 7 días + 1 de margen.
        [double]$MaxBackupAgeHours = 192,
        [switch]$SkipHashVerify
    )

    if (-not $NodeProbe) { $NodeProbe = { param($NodePath) Test-N8nNodeSqliteSupport -NodePath $NodePath } }
    if (-not $TaskQuery) { $TaskQuery = { param($Names) Get-N8nDefaultTaskState -Names $Names } }
    if (-not $FreeSpaceProvider) { $FreeSpaceProvider = { param($Path) Get-N8nDefaultFreeSpaceBytes -Path $Path } }

    $checks = New-Object System.Collections.Generic.List[object]
    function Add-Check {
        param([string]$Name, [ValidateSet('PASS', 'WARN', 'FAIL')][string]$Status, [string]$Detail = '')
        $d = if ([string]::IsNullOrEmpty($Detail)) { '' } else { (($Detail -replace '(?i)AGE-SECRET-KEY-1[A-Z0-9]+', '<oculto>') -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1) }
        $checks.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $d })
    }
    function Complete-Preflight {
        $overall = if (@($checks | Where-Object { $_.Status -eq 'FAIL' }).Count -gt 0) { 'FAIL' } elseif (@($checks | Where-Object { $_.Status -eq 'WARN' }).Count -gt 0) { 'WARN' } else { 'PASS' }
        $code = switch ($overall) { 'PASS' { 0 } 'WARN' { 1 } 'FAIL' { 2 } }
        [pscustomobject]@{ Checks = $checks.ToArray(); Overall = $overall; ExitCode = $code }
    }

    # --- Entorno ---
    $psv = $PSVersionTable.PSVersion
    if ($psv -ge [version]'5.1') { Add-Check 'PowerShell version' 'PASS' "$psv" } else { Add-Check 'PowerShell version' 'FAIL' "Se requiere 5.1 o superior (actual: $psv)" }

    # --- Configuración ---
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { Add-Check 'n8n config file' 'FAIL' 'n8n-config.json no existe. Ejecute Install-DaubertN8nBackup.ps1.'; return Complete-Preflight }
    Add-Check 'n8n config file' 'PASS' 'n8n-config.json encontrado'
    $cfg = Read-N8nBackupConfigFile -Path $ConfigPath
    if ($null -eq $cfg.Config) { Add-Check 'n8n config JSON' 'FAIL' ($cfg.Errors -join ' '); return Complete-Preflight }
    Add-Check 'n8n config JSON' 'PASS' 'JSON parseable'
    $secretErrors = @($cfg.Errors | Where-Object { $_ -like 'SECRETO RECHAZADO*' })
    if ($secretErrors.Count -gt 0) { Add-Check 'n8n config secrets' 'FAIL' ($secretErrors -join ' | ') } else { Add-Check 'n8n config secrets' 'PASS' 'sin secretos prohibidos' }
    if (-not $cfg.IsValid) { Add-Check 'n8n config schema' 'FAIL' (@($cfg.Errors | Where-Object { $_ -notlike 'SECRETO RECHAZADO*' }) -join ' | '); return Complete-Preflight }
    Add-Check 'n8n config schema' 'PASS' 'campos obligatorios presentes, rutas absolutas, retención y schedule válidos'
    if (@($cfg.Warnings).Count -gt 0) { Add-Check 'n8n config warnings' 'WARN' ($cfg.Warnings -join ' ') }
    $c = $cfg.Config

    # --- Instalación de n8n (solo existencia; jamás se lee config ni se abre la SQLite) ---
    $root = [string]$c.n8nRoot
    if (Test-Path -LiteralPath $root -PathType Container) { Add-Check 'n8n root' 'PASS' 'existe' } else { Add-Check 'n8n root' 'FAIL' 'n8nRoot no existe' }
    if (Test-Path -LiteralPath (Join-Path $root 'database.sqlite') -PathType Leaf) { Add-Check 'n8n database.sqlite' 'PASS' 'existe' } else { Add-Check 'n8n database.sqlite' 'FAIL' 'no existe database.sqlite en n8nRoot' }
    if (Test-Path -LiteralPath (Join-Path $root 'config') -PathType Leaf) { Add-Check 'n8n config (archivo)' 'PASS' 'existe (su contenido no se lee)' } else { Add-Check 'n8n config (archivo)' 'FAIL' "no existe el archivo 'config' de n8n (obligatorio en el backup)" }
    foreach ($pair in @(@('BackupRoot', [string]$c.backupRoot), @('StagingRoot', [string]$c.stagingRoot))) {
        if (Test-N8nPathUnder -Child $pair[1] -Parent $root) { Add-Check "$($pair[0]) fuera de n8nRoot" 'FAIL' "$($pair[0]) está dentro de n8nRoot" }
    }

    # --- n8n package (versión para el manifest) ---
    $pkgPath = if ($c.PSObject.Properties['n8nPackagePath']) { [string]$c.n8nPackagePath } else { $null }
    $n8nVer = Get-N8nVersion -PackagePath $pkgPath
    if ($n8nVer) { Add-Check 'n8n version' 'PASS' $n8nVer } else { Add-Check 'n8n version' 'WARN' 'no se pudo determinar la versión de n8n (el manifest registrará unknown); configure n8nPackagePath' }

    # --- Node y node:sqlite ---
    $node = [string]$c.nodePath
    if (Test-BackupToolPath -Path $node) {
        Add-Check 'Node' 'PASS' (Split-Path -Leaf $node)
        $probe = $null
        try { $probe = & $NodeProbe $node } catch { $probe = $null }
        if ($null -eq $probe) { Add-Check 'Node version' 'FAIL' 'no se pudo sondear Node' }
        else {
            if ($probe.Version) {
                if ($probe.VersionOk) { Add-Check 'Node version' 'PASS' "$($probe.Version)" } else { Add-Check 'Node version' 'FAIL' "$($probe.Version): $($probe.Reason)" }
            }
            else { Add-Check 'Node version' 'FAIL' $probe.Reason }
            if ($probe.HasSqlite) { Add-Check 'node:sqlite' 'PASS' 'disponible' } else { Add-Check 'node:sqlite' 'FAIL' $(if ($probe.Reason) { $probe.Reason } else { 'node:sqlite no disponible' }) }
            if ($probe.HasDatabaseSync) { Add-Check 'DatabaseSync' 'PASS' 'disponible' } else { Add-Check 'DatabaseSync' 'FAIL' 'DatabaseSync no disponible' }
            if ($probe.HasBackup) { Add-Check 'sqlite backup()' 'PASS' 'disponible' } else { Add-Check 'sqlite backup()' 'FAIL' 'backup() no disponible en node:sqlite (snapshot imposible)' }
        }
    }
    else { Add-Check 'Node' 'FAIL' 'node.exe no encontrado en la ruta configurada' }

    $helper = Join-Path (Split-Path -Parent $PSScriptRoot) 'helpers\n8n-sqlite-snapshot.js'
    if (Test-Path -LiteralPath $helper -PathType Leaf) { Add-Check 'Snapshot helper' 'PASS' 'n8n-sqlite-snapshot.js presente' } else { Add-Check 'Snapshot helper' 'FAIL' 'falta helpers\n8n-sqlite-snapshot.js' }

    # --- 7-Zip / age ---
    if (Test-BackupToolPath -Path ([string]$c.sevenZipPath)) { Add-Check '7-Zip' 'PASS' (Split-Path -Leaf ([string]$c.sevenZipPath)) } else { Add-Check '7-Zip' 'FAIL' '7z.exe no encontrado en la ruta configurada' }
    if (Test-BackupToolPath -Path ([string]$c.agePath)) { Add-Check 'age' 'PASS' (Split-Path -Leaf ([string]$c.agePath)) } else { Add-Check 'age' 'FAIL' 'age.exe no encontrado en la ruta configurada' }

    # --- Destinatarios y ausencia de clave privada ---
    $rec = [string]$c.recipientsFilePath
    $info = Get-AgeRecipientInfo -Path $rec
    if (-not $info.Exists) { Add-Check 'Recipients file' 'FAIL' 'no existe el archivo de destinatarios' } else { Add-Check 'Recipients file' 'PASS' (Split-Path -Leaf $rec) }
    if ($info.IsValid) { Add-Check 'Public recipient' 'PASS' "$($info.RecipientCount) destinatario(s) público(s) age" }
    elseif ($info.Exists) { Add-Check 'Public recipient' 'FAIL' $info.Reason }
    else { Add-Check 'Public recipient' 'FAIL' 'sin archivo de destinatarios' }

    $managed = @((Split-Path -Parent $ConfigPath), (Split-Path -Parent $rec), [string]$c.logRoot, [string]$c.lockRoot, [string]$c.stagingRoot, [string]$c.backupRoot)
    $keys = @(Find-AgePrivateKeyInPath -Paths $managed)
    if ($keys.Count -eq 0) { Add-Check 'No age private key' 'PASS' 'no hay claves privadas age en las rutas administradas' }
    else { Add-Check 'No age private key' 'FAIL' ('clave privada age detectada en: ' + (($keys | ForEach-Object { $_.Path }) -join '; ') + ' - retírela de esta máquina') }

    # --- Rutas ---
    $br = [string]$c.backupRoot
    $brs = Get-DirectoryWriteStatus -Path $br
    if (-not $brs.Exists) { Add-Check 'Backup root' 'FAIL' 'la carpeta de backups no existe o no es accesible' } else { Add-Check 'Backup root' 'PASS' 'existe y es accesible' }
    if ($brs.Writable) { Add-Check 'Backup root writable' 'PASS' 'escritura confirmada' } else { Add-Check 'Backup root writable' 'FAIL' ('no escribible: ' + [string]$brs.Error) }
    foreach ($pair in @(@('Staging', 'stagingRoot'), @('Log root', 'logRoot'), @('Lock root', 'lockRoot'))) {
        $s = Get-DirectoryWriteStatus -Path ([string]$c.($pair[1]))
        if ($s.Writable -and $s.Exists) { Add-Check $pair[0] 'PASS' 'existe y es escribible' }
        elseif ($s.Writable) { Add-Check $pair[0] 'WARN' 'no existe todavía (se crea en la primera ejecución); la ubicación es escribible' }
        else { Add-Check $pair[0] 'FAIL' ('no escribible: ' + [string]$s.Error) }
    }

    # --- Residuos de staging n8n (plaintext de una ejecución interrumpida) ---
    $n8nStaging = Join-Path ([string]$c.stagingRoot) 'n8n'
    if (Test-Path -LiteralPath $n8nStaging -PathType Container) {
        $orphans = @(Get-ChildItem -LiteralPath $n8nStaging -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[0-9a-f]{32}$' })
        if ($orphans.Count -gt 0) { Add-Check 'Staging residue' 'WARN' "$($orphans.Count) directorio(s) de una ejecución interrumpida; se eliminan solos al inicio de la próxima ejecución" }
    }

    # --- Espacio libre ---
    foreach ($pair in @(@('Free space (backup root)', $br), @('Free space (staging)', [string]$c.stagingRoot))) {
        $bytes = & $FreeSpaceProvider $pair[1]
        if ($null -eq $bytes) { Add-Check $pair[0] 'WARN' 'no se pudo determinar el espacio libre'; continue }
        $gb = [math]::Round(([double]$bytes) / 1GB, 2)
        if ($gb -ge $MinFreeSpaceGB) { Add-Check $pair[0] 'PASS' "$gb GB libres" }
        elseif ($gb -ge ($MinFreeSpaceGB / 5)) { Add-Check $pair[0] 'WARN' "$gb GB libres (mínimo recomendado: $MinFreeSpaceGB GB)" }
        else { Add-Check $pair[0] 'FAIL' "$gb GB libres (crítico; mínimo recomendado: $MinFreeSpaceGB GB)" }
    }

    # --- Tarea WEEKLY (su ausencia es WARN: aún no registrada) ---
    $taskName = Get-N8nTaskName
    try {
        $tasks = @(& $TaskQuery @($taskName))
        $tk = $tasks | Where-Object { $_.TaskName -eq $taskName } | Select-Object -First 1
        if ($null -eq $tk) { Add-Check 'Scheduled Task (Weekly)' 'WARN' 'Task Scheduler no devolvió información de la tarea' }
        elseif (-not $tk.Exists) { Add-Check 'Scheduled Task (Weekly)' 'WARN' 'la tarea aún no está registrada (Register-DaubertN8nBackupTask.ps1)' }
        elseif ($tk.State -eq 'Disabled') { Add-Check 'Scheduled Task (Weekly)' 'WARN' 'la tarea está deshabilitada' }
        elseif ($null -ne $tk.LastTaskResult -and $tk.LastTaskResult -ne 0 -and $tk.LastTaskResult -ne 267011) { Add-Check 'Scheduled Task (Weekly)' 'WARN' "última ejecución con error: $($tk.LastTaskResult)" }
        else {
            $tkXml = if ($tk.PSObject.Properties['Xml']) { $tk.Xml } else { $null }
            if (-not $tkXml) { Add-Check 'Scheduled Task (Weekly)' 'PASS' 'registrada y habilitada (definición no inspeccionable)' }
            else {
                $problems = @(Test-N8nTaskDefinition -Xml $tkXml -ConfigPath $ConfigPath -Schedule (Get-N8nSchedule -Config $c))
                if ($problems.Count -gt 0) { Add-Check 'Scheduled Task (Weekly)' 'WARN' ('definición inesperada -> ' + ($problems -join ' | ') + ' (reejecute Register-DaubertN8nBackupTask.ps1)') }
                else { Add-Check 'Scheduled Task (Weekly)' 'PASS' 'existe, habilitada y con la definición exacta (S4U, Limited, IgnoreNew, PT4H, config en uso)' }
            }
        }
    }
    catch { Add-Check 'Scheduled Task (Weekly)' 'WARN' 'no se pudo consultar Task Scheduler' }

    # --- Último backup de cada tier y su sidecar SHA-256 ---
    $anyBackup = $false
    foreach ($tier in 'Weekly', 'OnChange') {
        $def = Get-N8nTierDefinition -Tier $tier
        $dir = [System.IO.Path]::Combine($br, 'N8N', $def.SubDir)
        $rx = Get-N8nArchiveFileNamePattern -Tier $tier
        $latest = $null
        if (Test-Path -LiteralPath $dir -PathType Container) {
            foreach ($f in (Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue)) {
                $m = [regex]::Match($f.Name, $rx)
                if (-not $m.Success) { continue }
                $ts = [datetime]::MinValue
                if ([datetime]::TryParseExact($m.Groups['timestamp'].Value, 'yyyyMMdd_HHmmss', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$ts)) {
                    if ($null -eq $latest -or $ts -gt $latest.Timestamp) { $latest = [pscustomobject]@{ File = $f; Timestamp = $ts } }
                }
            }
        }
        if ($null -eq $latest) { continue }
        $anyBackup = $true
        $sidecar = "$($latest.File.FullName).sha256"
        if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) { Add-Check "Last $tier backup" 'WARN' "último backup ($($latest.File.Name)) sin sidecar .sha256"; continue }
        if ($SkipHashVerify) { Add-Check "Last $tier SHA-256" 'WARN' 'verificación omitida (-SkipHashVerify)' }
        else {
            $expected = ((Get-Content -LiteralPath $sidecar -Raw) -split '\s+')[0].Trim().ToLowerInvariant()
            $actual = (Get-FileHash -LiteralPath $latest.File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($expected -eq $actual) { Add-Check "Last $tier SHA-256" 'PASS' "sidecar coincide ($($latest.File.Name))" }
            else { Add-Check "Last $tier SHA-256" 'FAIL' "el SHA-256 NO coincide con el sidecar ($($latest.File.Name))" }
        }
        $ageHours = [math]::Round(($Now - $latest.Timestamp).TotalHours, 1)
        if ($tier -eq 'Weekly') {
            if ($ageHours -le $MaxBackupAgeHours) { Add-Check 'Last Weekly backup' 'PASS' "hace $ageHours h ($($latest.File.Name))" }
            else { Add-Check 'Last Weekly backup' 'WARN' "hace $ageHours h; se esperaba como máximo $MaxBackupAgeHours h ($($latest.File.Name))" }
        }
        else { Add-Check 'Last OnChange backup' 'PASS' "hace $ageHours h ($($latest.File.Name))" }
    }
    if (-not $anyBackup) { Add-Check 'Last valid backup' 'WARN' 'no se encontró ningún backup de n8n (esperable en una instalación nueva)' }

    return Complete-Preflight
}

Export-ModuleMember -Function Invoke-N8nPreflight
