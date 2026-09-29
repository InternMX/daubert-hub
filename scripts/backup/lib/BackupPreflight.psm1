#Requires -Version 5.1
<#
    BackupPreflight.psm1
    Diagnóstico NO destructivo del sistema de backups. No genera backups, no
    modifica PostgreSQL, no registra tareas, no lee ni imprime la contraseña
    ni la RUTA del pgpass, y no necesita (ni busca en contenido) claves
    privadas age — solo verifica que NO existan en rutas administradas.

    Las dependencias del sistema se inyectan (-ProcessRunner, -TaskQuery,
    -FreeSpaceProvider) para poder probar cada rama con simulaciones sin
    tocar PostgreSQL, Task Scheduler ni discos reales.

    Único efecto en disco (transitorio): un archivo de sondeo
    ".daubert-preflight-<guid>.tmp" creado y borrado de inmediato en las
    carpetas cuya escritura se comprueba (backup root, staging, logs, locks).
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLocalConfig.psm1') -DisableNameChecking

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Invoke-PreflightProcess {
    <# Runner por defecto: ejecuta un proceso con timeout y captura stdout/stderr. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [hashtable]$Environment = @{},
        [int]$TimeoutSeconds = 20
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = (($ArgumentList | ForEach-Object { if ($_ -match '[\s"]' -or $_.Length -eq 0) { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' ')
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    foreach ($k in $Environment.Keys) { $psi.EnvironmentVariables[$k] = [string]$Environment[$k] }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    try {
        [void]$proc.Start()
        $o = $proc.StandardOutput.ReadToEndAsync()
        $e = $proc.StandardError.ReadToEndAsync()
        if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
            try { $proc.Kill() } catch { }
            return [pscustomobject]@{ ExitCode = -1; StdOut = ''; StdErr = "Tiempo de espera agotado ($TimeoutSeconds s)." }
        }
        $proc.WaitForExit()
        [pscustomobject]@{ ExitCode = $proc.ExitCode; StdOut = $o.GetAwaiter().GetResult(); StdErr = $e.GetAwaiter().GetResult() }
    }
    finally { $proc.Dispose() }
}

function Protect-PreflightText {
    <# Elimina de cualquier texto mostrado: la ruta del pgpass y cualquier clave privada age. #>
    param([string]$Text, [string[]]$Hide = @())
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $t = $Text
    foreach ($h in ($Hide | Where-Object { $_ })) { $t = $t.Replace($h, '<oculto>') }
    $t = $t -replace '(?i)AGE-SECRET-KEY-1[A-Z0-9]+', '<oculto>'
    return ($t -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
}

function Get-DirectoryWriteStatus {
    <#
        Comprueba si una carpeta existe y es escribible con un archivo de
        sondeo transitorio. Si no existe, sondea el ancestro existente más
        cercano (sin crear nada).
    #>
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        $ancestor = $Path
        while ($ancestor -and -not (Test-Path -LiteralPath $ancestor -PathType Container)) { $ancestor = Split-Path -Parent $ancestor }
        if (-not $ancestor) { return [pscustomobject]@{ Exists = $false; Writable = $false; Error = 'ninguna carpeta ancestro existe' } }
        $w = Get-DirectoryWriteStatus -Path $ancestor
        return [pscustomobject]@{ Exists = $false; Writable = $w.Writable; Error = $w.Error }
    }
    $probe = Join-Path $Path (".daubert-preflight-{0}.tmp" -f [guid]::NewGuid().ToString('N'))
    try {
        [System.IO.File]::WriteAllText($probe, 'preflight')
        Remove-Item -LiteralPath $probe -Force
        return [pscustomobject]@{ Exists = $true; Writable = $true; Error = $null }
    }
    catch {
        Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ Exists = $true; Writable = $false; Error = $_.Exception.Message }
    }
}

function Get-DefaultFreeSpaceBytes {
    param([string]$Path)
    try {
        $full = [System.IO.Path]::GetFullPath($Path)
        $root = [System.IO.Path]::GetPathRoot($full)
        if (-not $root -or $root.StartsWith('\\')) { return $null }
        return [double](New-Object System.IO.DriveInfo($root)).AvailableFreeSpace
    }
    catch { return $null }
}

function Get-DefaultTaskState {
    <# Consulta de solo lectura de las tareas administradas. #>
    param([string[]]$Names)
    foreach ($n in $Names) {
        try {
            $t = Get-ScheduledTask -TaskName $n -ErrorAction Stop
            $i = Get-ScheduledTaskInfo -TaskName $n -ErrorAction Stop
            [pscustomobject]@{ TaskName = $n; Exists = $true; State = [string]$t.State; LastTaskResult = [int64]$i.LastTaskResult; LastRunTime = $i.LastRunTime; NextRunTime = $i.NextRunTime; Xml = $(try { [string](Export-ScheduledTask -TaskName $n -ErrorAction Stop) } catch { $null }) }
        }
        catch {
            [pscustomobject]@{ TaskName = $n; Exists = $false; State = $null; LastTaskResult = $null; LastRunTime = $null; NextRunTime = $null; Xml = $null }
        }
    }
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

function Test-BackupTaskDefinition {
    <#
        Comprueba que una tarea registrada es la que Daubert espera: creada por Daubert (marca),
        ejecuta el entrypoint canónico commands\Start-DaubertPostgresBackup.ps1 con -Tier del
        nombre y -ConfigPath del config en uso, y no permite instancias solapadas.
        Devuelve la lista de problemas (vacía = correcta). Solo lee el XML: sin secretos.
    #>
    [CmdletBinding()]
    param([string]$Xml, [string]$Tier, [string]$ConfigPath)

    $problems = New-Object System.Collections.Generic.List[string]
    try { $x = New-Object System.Xml.XmlDocument; $x.LoadXml($Xml) } catch { return @('XML ilegible') }
    $task = $x.Task
    if ([string]$task.RegistrationInfo.Description -notmatch 'DaubertHub-Managed-Backup') { $problems.Add('no fue creada por Daubert Hub') }
    $args1 = [string]$task.Actions.Exec.Arguments
    if ($args1 -notmatch 'commands\\Start-DaubertPostgresBackup\.ps1"') { $problems.Add('no ejecuta commands\Start-DaubertPostgresBackup.ps1') }
    if ($args1 -notmatch ('-Tier ' + [regex]::Escape($Tier) + '(\s|$)')) { $problems.Add("no usa -Tier $Tier") }
    if ($args1.IndexOf(('-ConfigPath "' + $ConfigPath + '"'), [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { $problems.Add('no usa el -ConfigPath en uso') }
    if ([string]$task.Settings.MultipleInstancesPolicy -ne 'IgnoreNew') { $problems.Add('permite instancias solapadas (falta IgnoreNew)') }
    return $problems.ToArray()
}
function Invoke-BackupPreflight {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [scriptblock]$ProcessRunner,
        [scriptblock]$TaskQuery,
        [scriptblock]$FreeSpaceProvider,
        [scriptblock]$DependencyChecker,
        [datetime]$Now = (Get-Date),
        [double]$MinFreeSpaceGB = 5,
        [Nullable[double]]$MaxBackupAgeHours = $null,
        [switch]$SkipHashVerify,
        [switch]$SkipDatabase
    )

    if (-not $ProcessRunner) { $ProcessRunner = { param($FilePath, $ArgumentList, $Environment) Invoke-PreflightProcess -FilePath $FilePath -ArgumentList $ArgumentList -Environment $Environment } }
    if (-not $TaskQuery) { $TaskQuery = { param($Names) Get-DefaultTaskState -Names $Names } }
    if (-not $FreeSpaceProvider) { $FreeSpaceProvider = { param($Path) Get-DefaultFreeSpaceBytes -Path $Path } }

    $checks = New-Object System.Collections.Generic.List[object]
    $hide = New-Object System.Collections.Generic.List[string]

    function Add-Check {
        param([string]$Name, [ValidateSet('PASS', 'WARN', 'FAIL')][string]$Status, [string]$Detail = '')
        $checks.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = (Protect-PreflightText -Text $Detail -Hide $hide.ToArray()) })
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
    $cfgResult = Read-LocalBackupConfig -Path $ConfigPath
    if (-not $cfgResult.Exists) { Add-Check 'Config file' 'FAIL' 'config.json no existe. Ejecute Install-DaubertBackup.ps1.'; return Complete-Preflight }
    Add-Check 'Config file' 'PASS' 'config.json encontrado'
    if (-not $cfgResult.ParseOk) { Add-Check 'Config JSON' 'FAIL' ($cfgResult.Errors -join ' '); return Complete-Preflight }
    Add-Check 'Config JSON' 'PASS' 'JSON parseable'
    if (-not $cfgResult.IsValid) { Add-Check 'Config fields' 'FAIL' ($cfgResult.Errors -join ' | '); return Complete-Preflight }
    Add-Check 'Config fields' 'PASS' 'campos obligatorios presentes, sin secretos'
    if ($cfgResult.Warnings.Count -gt 0) { Add-Check 'Config warnings' 'WARN' ($cfgResult.Warnings -join ' ') }

    $c = $cfgResult.Config
    $pgpass = [string]$c.pgPassFile
    $hide.Add($pgpass)

    # --- Herramientas PostgreSQL ---
    $pgBin = [string]$c.postgresBin
    if (Test-Path -LiteralPath $pgBin -PathType Container) { Add-Check 'PostgreSQL tools' 'PASS' 'carpeta bin encontrada' } else { Add-Check 'PostgreSQL tools' 'FAIL' 'la carpeta postgresBin no existe' }
    foreach ($exe in 'pg_dump', 'pg_restore', 'pg_dumpall') {
        $p = Join-Path $pgBin "$exe.exe"
        if (-not (Test-BackupToolPath -Path $p)) { Add-Check $exe 'FAIL' "$exe.exe no encontrado"; continue }
        $ver = ''
        try { $r = & $ProcessRunner $p @('--version') @{}; if ($r.ExitCode -eq 0) { $ver = ([string]$r.StdOut).Trim() } } catch { }
        Add-Check $exe 'PASS' $ver
    }

    # --- Conectividad y autenticación (solo lectura, sin backups) ---
    $dbReachable = $false
    $pgpassOk = $false
    if (-not (Test-Path -LiteralPath $pgpass -PathType Leaf)) {
        Add-Check 'PGPASS file' 'FAIL' 'el archivo pgpass configurado no existe. Ejecute Install-DaubertBackup.ps1 (reparar).'
    }
    else {
        $pgpassOk = $true
        try {
            $acl = Test-SecretFileAcl -Path $pgpass
            if ($acl.IsRestricted) { Add-Check 'PGPASS file' 'PASS' 'existe con ACL restrictiva' }
            else { Add-Check 'PGPASS file' 'WARN' ("la ACL permite acceso a: " + ($acl.UnexpectedPrincipals -join ', ')) }
        }
        catch { Add-Check 'PGPASS file' 'WARN' 'existe, pero no se pudo leer su ACL' }
    }

    if ($SkipDatabase) {
        Add-Check 'Database reachable' 'WARN' 'omitido (-SkipDatabase)'
        Add-Check 'Backup user auth' 'WARN' 'omitido (-SkipDatabase)'
    }
    else {
        $isReady = Join-Path $pgBin 'pg_isready.exe'
        $psql = Join-Path $pgBin 'psql.exe'
        if (Test-BackupToolPath -Path $isReady) {
            $r = & $ProcessRunner $isReady @('-h', [string]$c.host, '-p', [string]$c.port, '-d', [string]$c.database, '-U', [string]$c.backupUser) @{}
            if ($r.ExitCode -eq 0) { $dbReachable = $true; Add-Check 'Database reachable' 'PASS' "$($c.host):$($c.port)" }
            else { Add-Check 'Database reachable' 'FAIL' ("PostgreSQL no responde en $($c.host):$($c.port). " + [string]$r.StdOut) }
        }
        else {
            Add-Check 'Database reachable' 'WARN' 'pg_isready.exe no disponible; se comprobará con la autenticación'
            $dbReachable = $true
        }

        if (-not $pgpassOk) { Add-Check 'Backup user auth' 'FAIL' 'no comprobado: falta el pgpass' }
        elseif (-not $dbReachable) { Add-Check 'Backup user auth' 'FAIL' 'no comprobado: la base no es accesible' }
        elseif (-not (Test-BackupToolPath -Path $psql)) { Add-Check 'Backup user auth' 'WARN' 'psql.exe no disponible: no se pudo probar la autenticación' }
        else {
            $r = & $ProcessRunner $psql @('-w', '-X', '-A', '-t', '-h', [string]$c.host, '-p', [string]$c.port, '-U', [string]$c.backupUser, '-d', [string]$c.database, '-c', 'SELECT 1') @{ PGPASSFILE = $pgpass; PGCONNECT_TIMEOUT = '10' }
            if ($r.ExitCode -eq 0 -and ([string]$r.StdOut).Trim() -eq '1') { Add-Check 'Backup user auth' 'PASS' "usuario $($c.backupUser) autenticado mediante PGPASSFILE" }
            else { Add-Check 'Backup user auth' 'FAIL' ("autenticación fallida: " + [string]$r.StdErr) }
        }
    }

    # --- 7-Zip / age ---
    $sz = [string]$c.sevenZipPath
    if (Test-BackupToolPath -Path $sz) { Add-Check '7-Zip' 'PASS' (Split-Path -Leaf $sz) } else { Add-Check '7-Zip' 'FAIL' '7z.exe no encontrado en la ruta configurada' }

    $age = [string]$c.agePath
    if (Test-BackupToolPath -Path $age) {
        $ver = ''
        try { $r = & $ProcessRunner $age @('--version') @{}; if ($r.ExitCode -eq 0) { $ver = ([string]$r.StdOut).Trim() } } catch { }
        Add-Check 'age' 'PASS' $ver
    }
    else { Add-Check 'age' 'FAIL' 'age.exe no encontrado en la ruta configurada (instálelo; el instalador no lo hace)' }

    # --- Dependencias declaradas (manifest dependencies.json), si se inyecta el verificador ---
    if ($DependencyChecker) {
        try {
            $deps = @(& $DependencyChecker)
            $bad = @($deps | Where-Object { $_.Status -ne 'Present' })
            $note = @($deps | Where-Object { $_.Status -eq 'Present' -and $null -ne $_.MatchesValidated -and -not $_.MatchesValidated } | ForEach-Object { "$($_.Id) $($_.Version) (validada: $($_.ValidatedVersion))" })
            if ($deps.Count -eq 0) { Add-Check 'Dependencies (manifest)' 'WARN' 'el manifest no devolvió dependencias de producción' }
            elseif ($bad.Count -gt 0) { Add-Check 'Dependencies (manifest)' 'FAIL' ('faltan o son incompatibles: ' + (($bad | ForEach-Object { "$($_.Id) [$($_.Status)]" }) -join ', ') + ' - ejecute Install-DaubertBackupPrerequisites.ps1') }
            else { Add-Check 'Dependencies (manifest)' 'PASS' $(if ($note.Count -gt 0) { 'presentes; versión distinta de la validada: ' + ($note -join '; ') } else { 'todas las dependencias de producción presentes' }) }
        }
        catch { Add-Check 'Dependencies (manifest)' 'WARN' 'no se pudo evaluar el manifest de dependencias' }
    }
    # --- Destinatarios y clave privada ---
    $rec = [string]$c.recipientsFilePath
    $info = Get-AgeRecipientInfo -Path $rec
    if (-not $info.Exists) { Add-Check 'Recipients file' 'FAIL' 'no existe el archivo de destinatarios' }
    else { Add-Check 'Recipients file' 'PASS' (Split-Path -Leaf $rec) }
    if ($info.IsValid) { Add-Check 'Public recipient' 'PASS' "$($info.RecipientCount) destinatario(s) público(s) age" }
    elseif ($info.Exists) { Add-Check 'Public recipient' 'FAIL' $info.Reason }
    else { Add-Check 'Public recipient' 'FAIL' 'sin archivo de destinatarios' }

    $managed = @((Split-Path -Parent $ConfigPath), (Split-Path -Parent $pgpass), (Split-Path -Parent $rec), [string]$c.logRoot, [string]$c.lockRoot, [string]$c.stagingRoot, [string]$c.backupRoot)
    $keys = @(Find-AgePrivateKeyInPath -Paths $managed)
    if ($keys.Count -eq 0) { Add-Check 'No age private key' 'PASS' 'no hay claves privadas age en las rutas administradas' }
    else { Add-Check 'No age private key' 'FAIL' ("clave privada age detectada en: " + (($keys | ForEach-Object { $_.Path }) -join '; ') + ' - retírela de esta máquina') }

    # --- Rutas ---
    $br = [string]$c.backupRoot
    $brs = Get-DirectoryWriteStatus -Path $br
    if (-not $brs.Exists) { Add-Check 'Backup root' 'FAIL' 'la carpeta de backups no existe o no es accesible' } else { Add-Check 'Backup root' 'PASS' 'existe y es accesible' }
    if ($brs.Writable) { Add-Check 'Backup root writable' 'PASS' 'escritura confirmada' } else { Add-Check 'Backup root writable' 'FAIL' ("no escribible: " + [string]$brs.Error) }

    foreach ($pair in @(@('Staging', 'stagingRoot'), @('Log root', 'logRoot'), @('Lock root', 'lockRoot'))) {
        $s = Get-DirectoryWriteStatus -Path ([string]$c.($pair[1]))
        if ($s.Writable -and $s.Exists) { Add-Check $pair[0] 'PASS' 'existe y es escribible' }
        elseif ($s.Writable) { Add-Check $pair[0] 'WARN' 'no existe todavía (se crea en la primera ejecución); la ubicación es escribible' }
        else { Add-Check $pair[0] 'FAIL' ("no escribible: " + [string]$s.Error) }
    }

    # --- Residuos de staging (dumps en texto plano de una ejecución interrumpida) ---
    $stagingPath = [string]$c.stagingRoot
    if (Test-Path -LiteralPath $stagingPath -PathType Container) {
        $orphans = @(Get-ChildItem -LiteralPath $stagingPath -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^[0-9a-f]{32}$' })
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

    # --- Tareas programadas ---
    $names = @('Daubert - PostgreSQL Frequent', 'Daubert - PostgreSQL Daily', 'Daubert - PostgreSQL Monthly')
    try {
        $tasks = @(& $TaskQuery $names)
        $missing = @($tasks | Where-Object { -not $_.Exists })
        $disabled = @($tasks | Where-Object { $_.Exists -and $_.State -eq 'Disabled' })
        $failed = @($tasks | Where-Object { $_.Exists -and $null -ne $_.LastTaskResult -and $_.LastTaskResult -ne 0 -and $_.LastTaskResult -ne 267011 })
        if ($tasks.Count -eq 0) { Add-Check 'Scheduled Tasks' 'WARN' 'Task Scheduler no devolvió información de las tareas' }
        elseif ($missing.Count -eq $names.Count) { Add-Check 'Scheduled Tasks' 'WARN' 'ninguna tarea registrada (Register-DaubertBackupTasks.ps1)' }
        elseif ($missing.Count -gt 0) { Add-Check 'Scheduled Tasks' 'WARN' ('faltan: ' + (($missing | ForEach-Object { $_.TaskName }) -join ', ')) }
        elseif ($disabled.Count -gt 0) { Add-Check 'Scheduled Tasks' 'WARN' ('deshabilitadas: ' + (($disabled | ForEach-Object { $_.TaskName }) -join ', ')) }
        elseif ($failed.Count -gt 0) { Add-Check 'Scheduled Tasks' 'WARN' ('última ejecución con error: ' + (($failed | ForEach-Object { "$($_.TaskName)=$($_.LastTaskResult)" }) -join ', ')) }
        else {
            $defProblems = @()
            $verified = 0
            foreach ($tk in $tasks) {
                $tkXml = if ($tk.PSObject.Properties['Xml']) { $tk.Xml } else { $null }
                if (-not $tkXml) { continue }
                $verified++
                $tier = ($tk.TaskName -replace '^.*PostgreSQL\s+', '')
                foreach ($pr in @(Test-BackupTaskDefinition -Xml $tkXml -Tier $tier -ConfigPath $ConfigPath)) { $defProblems += "$($tk.TaskName): $pr" }
            }
            if ($defProblems.Count -gt 0) { Add-Check 'Scheduled Tasks' 'WARN' ('definición inesperada -> ' + ($defProblems -join ' | ') + ' (reejecute Register-DaubertBackupTasks.ps1)') }
            elseif ($verified -eq $names.Count) { Add-Check 'Scheduled Tasks' 'PASS' 'las 3 tareas existen, están habilitadas y ejecutan el entrypoint canónico con el config en uso (IgnoreNew)' }
            else { Add-Check 'Scheduled Tasks' 'PASS' 'las 3 tareas están registradas y habilitadas' }
        }
    }
    catch { Add-Check 'Scheduled Tasks' 'WARN' 'no se pudo consultar Task Scheduler' }

    # --- Último backup válido ---
    $maxAge = if ($null -ne $MaxBackupAgeHours) { [double]$MaxBackupAgeHours } else { 2.0 * [double](Get-LocalConfigSchedule -Config $c -Tier Frequent).intervalHours }
    $found = New-Object System.Collections.Generic.List[object]
    $rx = '^' + [regex]::Escape([string]$c.database) + '_(FREQUENT|DAILY|MONTHLY)_(\d{8}_\d{6})\.age$'
    foreach ($sub in 'FREQUENT', 'DAILY', 'MONTHLY') {
        $dir = Join-Path $br $sub
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue)) {
            $m = [regex]::Match($f.Name, $rx)
            if (-not $m.Success) { continue }
            $ts = [datetime]::MinValue
            if ([datetime]::TryParseExact($m.Groups[2].Value, 'yyyyMMdd_HHmmss', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$ts)) {
                $found.Add([pscustomobject]@{ File = $f; Timestamp = $ts })
            }
        }
    }
    if ($found.Count -eq 0) {
        Add-Check 'Last valid backup' 'WARN' 'no se encontró ningún backup (esperable en una instalación nueva)'
    }
    else {
        $latest = $found | Sort-Object -Property Timestamp -Descending | Select-Object -First 1
        $sidecar = "$($latest.File.FullName).sha256"
        $ageHours = [math]::Round(($Now - $latest.Timestamp).TotalHours, 1)
        if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) {
            Add-Check 'Last valid backup' 'WARN' "último backup ($($latest.File.Name)) sin sidecar .sha256"
        }
        elseif ($SkipHashVerify) {
            Add-Check 'Last backup SHA-256' 'WARN' 'verificación omitida (-SkipHashVerify)'
        }
        else {
            $expected = ((Get-Content -LiteralPath $sidecar -Raw) -split '\s+')[0].Trim().ToLowerInvariant()
            $actual = (Get-FileHash -LiteralPath $latest.File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($expected -eq $actual) { Add-Check 'Last backup SHA-256' 'PASS' "sidecar coincide ($($latest.File.Name))" }
            else { Add-Check 'Last backup SHA-256' 'FAIL' "el SHA-256 NO coincide con el sidecar ($($latest.File.Name))" }
        }
        if (Test-Path -LiteralPath $sidecar -PathType Leaf) {
            if ($ageHours -le $maxAge) { Add-Check 'Last valid backup' 'PASS' "hace $ageHours h ($($latest.File.Name))" }
            else { Add-Check 'Last valid backup' 'WARN' "hace $ageHours h; se esperaba como máximo $maxAge h ($($latest.File.Name))" }
        }
    }

    return Complete-Preflight
}

function Format-PreflightReport {
    <# Texto legible del resultado: una línea por comprobación + OVERALL. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Result)
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($c in $Result.Checks) {
        $line = '{0,-26} {1}' -f $c.Name, $c.Status
        if ($c.Detail) { $line += "   $($c.Detail)" }
        $lines.Add($line)
    }
    $lines.Add('')
    $lines.Add("OVERALL: $($Result.Overall)")
    $lines.ToArray()
}

Export-ModuleMember -Function Invoke-BackupPreflight, Format-PreflightReport, Get-DirectoryWriteStatus
