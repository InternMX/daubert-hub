#Requires -Version 5.1
<#
    BackupPrerequisites.psm1
    Gestión declarativa e idempotente de las dependencias del subsistema de
    backup, a partir de scripts/backup/config/dependencies.json.

    Estrategia:
      - Cada dependencia se DETECTA (nunca se asumen rutas): age, 7-Zip y
        PostgreSQL client tools con las funciones Find-* de BackupConfig,
        Pester con Get-Module -ListAvailable, PowerShell con $PSVersionTable.
      - Una dependencia presente y compatible no se reinstala.
      - Solo se instala automáticamente con winget cuando el manifest declara
        un packageId confiable; nunca se inventa un ID. Si no hay forma fiable
        (PostgreSQL client, Pester) o falta winget, se devuelve una instrucción.
      - Versiones: minimumVersion (o requiredVersion exacta) es el único
        requisito duro; validatedVersion es informativa (versión probada).
      - No maneja secretos y no toca PostgreSQL, Task Scheduler, Dropbox ni servicios ajenos.

    Seams mockeables (las pruebas los sustituyen; no hay ejecutables falsos):
      Invoke-PrerequisiteProcess, Get-WingetCommandPath, Invoke-WingetInstall,
      Get-InstalledModuleVersion, y Test-BackupToolPath (BackupConfig).
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking

$script:SecretKeyPattern = '(?i)(pass(word|wd|phrase)?|pwd|secret|token|api[-_]?key|private[-_]?key|credential)'

# ---------------------------------------------------------------------------
# Seams
# ---------------------------------------------------------------------------

function Invoke-PrerequisiteProcess {
    <# Único punto que lanza procesos (consulta de versión, winget). Nunca recibe secretos. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [int]$TimeoutSeconds = 30
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = (($ArgumentList | ForEach-Object { if ($_ -match '[\s"]' -or $_.Length -eq 0) { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' ')
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
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

function Get-WingetCommandPath {
    <# Ruta de winget.exe si está disponible, o $null. #>
    [CmdletBinding()]
    param()
    $cmd = Get-Command -Name 'winget.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    return $null
}

function Invoke-WingetInstall {
    <# Instala un paquete con winget (sin prompts). Devuelve { ExitCode, StdOut, StdErr }. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$WingetPath,
        [Parameter(Mandatory = $true)][string]$PackageId
    )
    Invoke-PrerequisiteProcess -FilePath $WingetPath -TimeoutSeconds 1800 -ArgumentList @('install', '--id', $PackageId, '--exact', '--source', 'winget', '--silent', '--accept-package-agreements', '--accept-source-agreements')
}

function Get-InstalledModuleVersion {
    <# Versiones instaladas de un módulo de PowerShell (strings). #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Name)
    @(Get-Module -ListAvailable -Name $Name -ErrorAction SilentlyContinue | ForEach-Object { $_.Version.ToString() })
}

# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

function Get-DefaultManifestPath {
    [CmdletBinding()]
    param()
    Join-Path (Split-Path -Parent $PSScriptRoot) 'config\dependencies.json'
}

function Test-DependencyManifestObject {
    <# Valida el esquema del manifest. Devuelve array de errores (vacío = válido). #>
    [CmdletBinding()]
    param($Manifest)

    $errs = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Manifest -or $Manifest -is [string] -or $Manifest -is [System.Array]) { return @('El manifest debe ser un objeto JSON.') }
    if (-not $Manifest.PSObject.Properties['schemaVersion'] -or $Manifest.schemaVersion -ne 1) { $errs.Add('schemaVersion debe ser 1.') }
    if (-not $Manifest.PSObject.Properties['dependencies'] -or @($Manifest.dependencies).Count -eq 0) { $errs.Add("Falta 'dependencies' (lista no vacía)."); return $errs.ToArray() }

    $ids = @{}
    foreach ($d in @($Manifest.dependencies)) {
        $id = if ($d.PSObject.Properties['id']) { [string]$d.id } else { '' }
        if ($id -notmatch '^[a-z0-9][a-z0-9\-]*$') { $errs.Add("Dependencia con id inválido o ausente: '$id'."); continue }
        if ($ids.ContainsKey($id)) { $errs.Add("id duplicado: '$id'.") }
        $ids[$id] = $true

        if ($d.PSObject.Properties['scope'] -eq $null -or @('production', 'development') -notcontains $d.scope) { $errs.Add("${id}: scope debe ser 'production' o 'development'.") }
        if ($d.PSObject.Properties['kind'] -eq $null -or @('tool', 'runtime', 'module') -notcontains $d.kind) { $errs.Add("${id}: kind debe ser 'tool', 'runtime' o 'module'.") }

        foreach ($v in 'minimumVersion', 'validatedVersion', 'requiredVersion') {
            if ($d.PSObject.Properties[$v]) {
                $tmp = [version]'0.0'
                if (-not [version]::TryParse((([string]$d.$v) -replace '^(\d+)$', '$1.0'), [ref]$tmp)) { $errs.Add("${id}: $v no es una versión válida ('$($d.$v)').") }
            }
        }
        if ($d.kind -eq 'tool' -and -not $d.PSObject.Properties['detect']) { $errs.Add("${id}: las herramientas requieren 'detect'.") }
        if ($d.kind -eq 'tool' -and $d.PSObject.Properties['detect'] -and @('age', 'sevenzip', 'postgres') -notcontains $d.detect.type) { $errs.Add("${id}: detect.type no soportado.") }
        if ($d.kind -eq 'module' -and (-not $d.PSObject.Properties['detect'] -or -not $d.detect.PSObject.Properties['moduleName'])) { $errs.Add("${id}: los módulos requieren detect.moduleName.") }

        if (-not $d.PSObject.Properties['install']) { $errs.Add("${id}: falta 'install'."); continue }
        $m = if ($d.install.PSObject.Properties['method']) { [string]$d.install.method } else { '' }
        switch ($m) {
            'winget' {
                $pk = if ($d.install.PSObject.Properties['packageId']) { [string]$d.install.packageId } else { '' }
                if ($pk -notmatch '^[A-Za-z0-9][A-Za-z0-9_\-]*(\.[A-Za-z0-9_\-]+)+$') { $errs.Add("${id}: packageId de winget inválido o ausente ('$pk').") }
            }
            { $_ -in 'manual', 'builtin' } {
                if (-not $d.install.PSObject.Properties['instructions'] -or [string]::IsNullOrWhiteSpace([string]$d.install.instructions)) { $errs.Add("${id}: install.instructions es obligatorio para method '$m'.") }
            }
            default { $errs.Add("${id}: install.method debe ser 'winget', 'manual' o 'builtin'.") }
        }
    }

    # Sin secretos ni rutas de máquina/usuario en el manifest.
    $json = $Manifest | ConvertTo-Json -Depth 10
    if ($json -match '"[^"]*(pass(word|wd|phrase)?|pwd|secret|token|api[-_]?key|private[-_]?key|credential)[^"]*"\s*:') { $errs.Add('El manifest no admite claves con aspecto de secreto.') }
    if ($json -match '[A-Za-z]:\\\\' -or $json -match '(?i)\\\\Users\\\\') { $errs.Add('El manifest no debe contener rutas absolutas ni de usuario: la ubicación se detecta.') }
    return $errs.ToArray()
}

function Read-DependencyManifest {
    <# Lee y valida el manifest. Nunca lanza: devuelve { Path, IsValid, Errors, Manifest }. #>
    [CmdletBinding()]
    param([string]$Path = (Get-DefaultManifestPath))

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ Path = $Path; IsValid = $false; Errors = @("No existe el manifest de dependencias: $Path"); Manifest = $null }
    }
    try { $m = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json -ErrorAction Stop }
    catch { return [pscustomobject]@{ Path = $Path; IsValid = $false; Errors = @("El manifest no es JSON válido: $($_.Exception.Message)"); Manifest = $null } }
    $errs = @(Test-DependencyManifestObject -Manifest $m)
    [pscustomobject]@{ Path = $Path; IsValid = ($errs.Count -eq 0); Errors = $errs; Manifest = $m }
}

# ---------------------------------------------------------------------------
# Detección
# ---------------------------------------------------------------------------

function ConvertTo-ComparableVersion {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    $t = $Text.Trim()
    if ($t -match '^\d+$') { $t = "$t.0" }
    $v = [version]'0.0'
    if ([version]::TryParse($t, [ref]$v)) { return $v }
    return $null
}

function Get-ToolVersion {
    <# Ejecuta la herramienta con los argumentos del manifest y extrae la versión con su regex; $null si no se puede. #>
    param([string]$ExePath, $Detect)
    try {
        $verArgs = if ($Detect.PSObject.Properties['versionArguments']) { @($Detect.versionArguments) } else { @() }
        $r = Invoke-PrerequisiteProcess -FilePath $ExePath -ArgumentList $verArgs
        $text = ([string]$r.StdOut + "`n" + [string]$r.StdErr).Trim()
        $rx = if ($Detect.PSObject.Properties['versionRegex']) { [string]$Detect.versionRegex } else { '(\d+(\.\d+)+)' }
        $line = ($text -split "`r?`n" | Where-Object { $_ -match $rx } | Select-Object -First 1)
        if ($line) { return ([regex]::Match($line, $rx).Groups[1].Value) }
    }
    catch { }
    return $null
}

function Get-DependencyStatus {
    <#
        Estado de UNA dependencia: { Id, Scope, Status (Present|Missing|Incompatible),
        Version, ValidatedVersion, MatchesValidated, Path, Detail, Install }.
        No instala nada.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Dependency,
        [version]$PowerShellVersion = $PSVersionTable.PSVersion
    )

    $d = $Dependency
    $validated = if ($d.PSObject.Properties['validatedVersion']) { [string]$d.validatedVersion } else { $null }
    $min = if ($d.PSObject.Properties['minimumVersion']) { [string]$d.minimumVersion } else { $null }
    $result = [ordered]@{ Id = $d.id; Scope = $d.scope; Status = 'Missing'; Version = $null; ValidatedVersion = $validated; MatchesValidated = $null; Path = $null; Detail = ''; Install = $d.install }

    function Set-VersionVerdict($res, $ver, $minText, $validatedText) {
        $res.Version = $ver
        $cv = ConvertTo-ComparableVersion $ver
        if ($null -eq $cv) { $res.Status = 'Present'; $res.Detail = 'versión no determinada'; return }
        if ($minText -and $cv -lt (ConvertTo-ComparableVersion $minText)) { $res.Status = 'Incompatible'; $res.Detail = "versión $ver < mínima $minText"; return }
        $res.Status = 'Present'
        if ($validatedText) {
            $vv = ConvertTo-ComparableVersion $validatedText
            $same = ($cv.Major -eq $vv.Major -and ($vv.Minor -le 0 -or $cv.Minor -eq $vv.Minor))
            $res.MatchesValidated = $same
            $res.Detail = if ($same) { "versión $ver (validada)" } else { "versión $ver compatible (versión validada: $validatedText)" }
        }
        else { $res.Detail = "versión $ver" }
    }

    switch ($d.kind) {
        'runtime' {
            $result.Version = $PowerShellVersion.ToString()
            if ($PowerShellVersion -ge (ConvertTo-ComparableVersion $min)) { $result.Status = 'Present'; $result.Detail = "versión $PowerShellVersion" }
            else { $result.Status = 'Incompatible'; $result.Detail = "versión $PowerShellVersion < mínima $min" }
        }
        'module' {
            $versions = @(Get-InstalledModuleVersion -Name $d.detect.moduleName)
            $req = if ($d.PSObject.Properties['requiredVersion']) { [string]$d.requiredVersion } else { $null }
            if ($versions.Count -eq 0) { $result.Detail = 'módulo no instalado' }
            elseif ($req -and -not ($versions | Where-Object { (ConvertTo-ComparableVersion $_) -eq (ConvertTo-ComparableVersion $req) })) { $result.Status = 'Incompatible'; $result.Version = ($versions -join ', '); $result.Detail = "se requiere exactamente $req (instaladas: $($versions -join ', '))" }
            else { $result.Status = 'Present'; $result.Version = if ($req) { $req } else { $versions[0] }; $result.Detail = "versión $($result.Version)" }
        }
        'tool' {
            switch ($d.detect.type) {
                'age' { $p = Find-AgePath; if ($p) { $result.Path = $p } }
                'sevenzip' { $p = Find-SevenZipPath; if ($p) { $result.Path = $p } }
                'postgres' {
                    # Se evalúan TODAS las instalaciones: se usa la de versión más alta que sea a la vez
                    # completa (los ejecutables requeridos) y compatible (>= minimumVersion).
                    $minV = ConvertTo-ComparableVersion $min
                    $installs = @(Get-PostgresInstallations -RequiredExecutables @($d.detect.requiredExecutables))
                    $sel = Select-PostgresInstallation -Installations $installs -MinimumVersion $minV
                    if ($sel) { $result.Path = Join-Path $sel.Bin $d.detect.versionExecutable }
                    elseif ($installs.Count -gt 0) { $result.Status = 'Incompatible'; $result.Detail = Get-PostgresInstallationDiagnostic -Installations $installs -MinimumVersion $minV }
                }
            }
            if (-not $result.Path) { if ($result.Status -ne 'Incompatible') { $result.Detail = 'no detectado' } }
            elseif ($result.Status -ne 'Incompatible') {
                $ver = Get-ToolVersion -ExePath $result.Path -Detect $d.detect
                Set-VersionVerdict $result $ver $min $validated
            }
        }
    }
    [pscustomobject]$result
}

function Get-PrerequisiteReport {
    <# Estado de todas las dependencias del ámbito pedido (Production | Development | All). #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [ValidateSet('Production', 'Development', 'All')][string]$Scope = 'Production',
        [version]$PowerShellVersion = $PSVersionTable.PSVersion
    )
    foreach ($d in @($Manifest.dependencies)) {
        if ($Scope -ne 'All' -and $d.scope -ne $Scope.ToLowerInvariant()) { continue }
        Get-DependencyStatus -Dependency $d -PowerShellVersion $PowerShellVersion
    }
}

# ---------------------------------------------------------------------------
# Instalación
# ---------------------------------------------------------------------------

function Install-BackupPrerequisites {
    <#
        Idempotente: por dependencia devuelve { Id, Scope, Before, Result, Detail, Instructions }.
        Result: Satisfied | Planned (WhatIf) | Installed | Failed | ManualRequired.
        Solo usa winget con el packageId del manifest; sin winget o sin método
        automático devuelve ManualRequired con instrucciones. -CheckOnly no instala.
    #>
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [ValidateSet('Production', 'Development', 'All')][string]$Scope = 'Production',
        [switch]$CheckOnly,
        [version]$PowerShellVersion = $PSVersionTable.PSVersion
    )

    $wingetPath = $null
    $wingetResolved = $false

    foreach ($status in @(Get-PrerequisiteReport -Manifest $Manifest -Scope $Scope -PowerShellVersion $PowerShellVersion)) {
        $out = [ordered]@{ Id = $status.Id; Scope = $status.Scope; Before = $status.Status; Version = $status.Version; Result = ''; Detail = $status.Detail; Instructions = $null }

        if ($status.Status -eq 'Present') { $out.Result = 'Satisfied'; [pscustomobject]$out; continue }

        $inst = $status.Install
        $manualText = if ($inst.PSObject.Properties['instructions']) { [string]$inst.instructions } else { $null }

        if ($CheckOnly -or $inst.method -ne 'winget') {
            $out.Result = 'ManualRequired'
            $out.Instructions = if ($inst.method -eq 'winget') { "Instale el paquete winget '$($inst.packageId)' (winget install --id $($inst.packageId) --exact) o ejecute Install-DaubertBackupPrerequisites.ps1 sin -CheckOnly." } else { $manualText }
            [pscustomobject]$out; continue
        }

        if (-not $wingetResolved) { $wingetPath = Get-WingetCommandPath; $wingetResolved = $true }
        if (-not $wingetPath) {
            $out.Result = 'ManualRequired'
            $out.Detail = 'winget no está disponible en esta máquina'
            $out.Instructions = "Instale 'App Installer' (winget) desde Microsoft Store y reejecute, o instale manualmente el paquete '$($inst.packageId)'."
            [pscustomobject]$out; continue
        }

        if (-not $PSCmdlet.ShouldProcess("$($status.Id) (winget: $($inst.packageId))", 'Instalar dependencia')) {
            $out.Result = 'Planned'; [pscustomobject]$out; continue
        }

        $r = Invoke-WingetInstall -WingetPath $wingetPath -PackageId $inst.packageId
        if ($r.ExitCode -ne 0) {
            $out.Result = 'Failed'
            $out.Detail = "winget terminó con código $($r.ExitCode)"
            $out.Instructions = "Reintente manualmente: winget install --id $($inst.packageId) --exact"
            [pscustomobject]$out; continue
        }

        # Verificar re-detectando (sin asumir que el PATH de esta sesión se actualizó).
        $after = Get-DependencyStatus -Dependency (@($Manifest.dependencies) | Where-Object { $_.id -eq $status.Id } | Select-Object -First 1) -PowerShellVersion $PowerShellVersion
        if ($after.Status -eq 'Present') { $out.Result = 'Installed'; $out.Version = $after.Version; $out.Detail = $after.Detail }
        else {
            $out.Result = 'Failed'
            $out.Detail = 'winget terminó bien pero la herramienta no se detecta todavía'
            $out.Instructions = 'Abra una nueva sesión de PowerShell y ejecute de nuevo el instalador de prerequisitos para verificar.'
        }
        [pscustomobject]$out
    }
}

Export-ModuleMember -Function Invoke-PrerequisiteProcess, Get-WingetCommandPath, Invoke-WingetInstall, Get-InstalledModuleVersion, `
    Get-DefaultManifestPath, Test-DependencyManifestObject, Read-DependencyManifest, Get-DependencyStatus, Get-PrerequisiteReport, Install-BackupPrerequisites
