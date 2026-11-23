<#
.SYNOPSIS
    Shared operational safety primitives for the Manufactura activation (Windows PowerShell 5.1). Library only: importing it creates nothing.

.DESCRIPTION
    - Cooperative operation lock (Enter/Exit-DaubertOperationLock).
      GUARANTEES: mutual exclusion ONLY between processes on THIS host that use these functions with the SAME path; the OS releases it when
      the holder exits or is killed (no stale lock). LIMITS: it does NOT stop Docker Desktop restarts, `restart: unless-stopped` restarts,
      manual docker / docker compose commands, other tools, other users using another path, or other machines. Callers must re-read state
      before and after every mutation (detection, not prevention).
    - Session hygiene: variables that would silently override Compose or Docker (names only, never values).
    - Strict reading of the Manufactura declarations of the base env file, the activation overlay and the container environment. Every
      other variable is ignored and never stored, returned or printed.
    - Supervised publish / withdraw of the activation overlay with recoverable intermediate states (not an atomic transaction: only the
      final rename on one NTFS volume is atomic).
#>
Set-StrictMode -Version Latest

$script:DefaultRoot = 'C:\Users\06\AppData\Local\DaubertHub'
$script:OverlayCanonical = "MANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRODUCCION`n"
$script:OverlaySha256 = '3b540e4e9f3a335f6eed213a0af33c935f31fa01c687f5e6c9cad3d8aa23396a'
$script:VetoedSessionVariables = @('COMPOSE_ENV_FILES', 'COMPOSE_FILE', 'COMPOSE_PROFILES', 'COMPOSE_PROJECT_NAME', 'DOCKER_CONTEXT', 'DOCKER_HOST',
    'MANUFACTURING_EMISSION_ENV', 'MANUFACTURING_ENABLED', 'VITE_MANUFACTURING_DOCUMENTS', 'VITE_MANUFACTURING_UI')
$script:FlagKeys = @('MANUFACTURING_ENABLED', 'MANUFACTURING_EMISSION_ENV')

# ------------------------------------------------------------------ Hashing / paths
function Get-DaubertBytesSha256 {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash([byte[]]$Bytes)) -replace '-', '').ToLower() } finally { $sha.Dispose() }
}

function Get-DaubertOpsPaths {
    param([string]$Root = $script:DefaultRoot)
    $mf = Join-Path $Root 'manufactura'
    $activaDir = Join-Path $mf 'activa'
    return [pscustomobject]@{
        Root = $Root
        LockFile = (Join-Path (Join-Path $Root 'locks') 'operacion.lock')
        OverlayPreparada = (Join-Path (Join-Path $mf 'preparada') 'manufactura.env')
        OverlayActivaDir = $activaDir
        OverlayActiva = (Join-Path $activaDir 'manufactura.env')
        OverlayHistorialDir = (Join-Path $mf 'historial')
    }
}

# ------------------------------------------------------------------ Cooperative lock
function Get-DaubertOperationLockInfo {
    # Informative only (never used to decide exclusivity). $null when absent or unreadable.
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try { $sr = New-Object System.IO.StreamReader($fs); $text = $sr.ReadToEnd() } finally { $fs.Dispose() }
        if (-not $text.Trim()) { return $null }
        return ($text | ConvertFrom-Json)
    } catch { return $null }
}

function Enter-DaubertOperationLock {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Purpose, [int]$TimeoutSeconds = 0)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $deadline = (Get-Date).AddSeconds([Math]::Max(0, $TimeoutSeconds))
    while ($true) {
        try {
            $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read)
            break
        } catch [System.IO.IOException] {
            if ((Get-Date) -ge $deadline) {
                $holder = Get-DaubertOperationLockInfo $Path
                $who = $(if ($holder) { ' (pid=' + $holder.pid + ' proposito=' + $holder.proposito + ' inicio=' + $holder.inicioUtc + ')' } else { '' })
                throw ('DAUBERT_LOCK_OCUPADO: otra operacion tiene el bloqueo ' + $Path + $who)
            }
            Start-Sleep -Milliseconds 250
        }
    }
    $info = [ordered]@{ pid = $PID; usuario = [Environment]::UserName; maquina = [Environment]::MachineName; proposito = $Purpose; inicioUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes((($info | ConvertTo-Json -Compress) + "`n"))
    $fs.SetLength(0); $fs.Write($bytes, 0, $bytes.Length); $fs.Flush($true)
    return [pscustomobject]@{ Path = $Path; Stream = $fs }
}

function Exit-DaubertOperationLock {
    param($Handle)
    if ($null -eq $Handle -or $null -eq $Handle.Stream) { return }
    try { $Handle.Stream.Dispose() } catch { }
}

# ------------------------------------------------------------------ Session hygiene
function Get-DaubertSessionHazards {
    # Names (never values) of vetoed variables defined in the process environment, even when empty.
    $present = @()
    $all = [Environment]::GetEnvironmentVariables('Process')
    foreach ($name in $script:VetoedSessionVariables) { if ($all.Contains($name)) { $present += $name } }
    return @($present | Sort-Object)
}

function Invoke-DaubertWithSanitizedEnvironment {
    param([Parameter(Mandatory = $true)][scriptblock]$ScriptBlock)
    $saved = @{}
    $all = [Environment]::GetEnvironmentVariables('Process')
    foreach ($name in $script:VetoedSessionVariables) { if ($all.Contains($name)) { $saved[$name] = [string]$all[$name] } }
    try {
        foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
        & $ScriptBlock
    } finally {
        foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    }
}

# ------------------------------------------------------------------ Strict declarations
function Read-DaubertManufacturingDeclarations {
    # Only the relevant keys are kept: MANUFACTURING_ENABLED, MANUFACTURING_EMISSION_ENV and (Base) DB_NAME. Fail-closed on any ambiguous syntax.
    param([AllowEmptyString()][string]$Text, [ValidateSet('Base', 'Overlay')][string]$Origen)
    $keys = @($script:FlagKeys); if ($Origen -eq 'Base') { $keys += 'DB_NAME' }
    $values = @{}; $errors = New-Object System.Collections.Generic.List[string]
    if ($Text.Length -gt 0 -and [int][char]$Text[0] -eq 0xFEFF) { $errors.Add('BOM') }
    if ($Text.IndexOf([char]0) -ge 0) { $errors.Add('NUL') }
    foreach ($raw in ($Text -split "`r?`n")) {
        $line = $raw.TrimStart([char]0xFEFF)
        if ($line -match '^\s*#') { continue }   # comment lines are ignored, as Compose does
        foreach ($k in $keys) {
            # Any line mentioning the key name (any case) must be EXACTLY KEY=VALUE with VALUE in [A-Za-z0-9_]*.
            if ($line -match ('(?i)(^|[^A-Za-z0-9_])' + [regex]::Escape($k) + '([^A-Za-z0-9_]|$)')) {
                if ($line -cmatch ('^' + [regex]::Escape($k) + '=([A-Za-z0-9_]*)$')) {
                    if ($values.ContainsKey($k)) { $errors.Add('DUPLICADA_' + $k) } else { $values[$k] = $Matches[1] }
                } else { $errors.Add('SINTAXIS_' + $k) }
            }
        }
    }
    $get = { param($k) if ($values.ContainsKey($k)) { [string]$values[$k] } else { $null } }
    return [pscustomobject]@{ Enabled = (& $get 'MANUFACTURING_ENABLED'); Emission = (& $get 'MANUFACTURING_EMISSION_ENV'); DbName = (& $get 'DB_NAME'); Errores = @($errors) }
}

function Test-DaubertOverlayBytes {
    param([byte[]]$Bytes)
    $errors = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Bytes) { $Bytes = [byte[]]@() }
    $sha = Get-DaubertBytesSha256 $Bytes
    if ($sha -ne $script:OverlaySha256) {
        if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) { $errors.Add('BOM') }
        if (@($Bytes | Where-Object { $_ -eq 13 }).Count -gt 0) { $errors.Add('CRLF') }
        if ($Bytes.Length -eq 0) { $errors.Add('VACIO') } elseif ($Bytes[$Bytes.Length - 1] -ne 10) { $errors.Add('SIN_LF_FINAL') }
        if ($Bytes.Length -ne 65) { $errors.Add('TAMANO') }
        $errors.Add('NO_CANONICO')
    }
    return [pscustomobject]@{ Valido = ($errors.Count -eq 0); Sha256 = $sha; Errores = @($errors) }
}

function Get-DaubertEffectiveManufacturing {
    # Compose precedence: an overlay key overrides the base key; an undeclared overlay key keeps the base value.
    param([AllowEmptyString()][string]$BaseText, $OverlayBytes = $null)
    $errors = New-Object System.Collections.Generic.List[string]
    $base = Read-DaubertManufacturingDeclarations $BaseText 'Base'
    foreach ($e in $base.Errores) { $errors.Add('BASE_' + $e) }
    if ($base.DbName -cne 'daubert_global') { $errors.Add('BASE_DB_NAME_NO_PRODUCCION') }
    if ($null -ne $base.Enabled -and $base.Enabled -cne '' -and $base.Enabled -cne 'false') { $errors.Add($(if ($base.Enabled -ceq 'true') { 'BASE_HABILITA' } else { 'BASE_VALOR_INVALIDO' })) }
    if ($null -ne $base.Emission -and $base.Emission -cne '' -and $base.Emission -cne 'PRODUCCION') { $errors.Add('BASE_EMISION_INVALIDA') }
    $enabled = $base.Enabled; $emission = $base.Emission; $origen = @{ MANUFACTURING_ENABLED = 'Base'; MANUFACTURING_EMISSION_ENV = 'Base' }
    if ($null -ne $OverlayBytes) {
        $ov = Test-DaubertOverlayBytes ([byte[]]$OverlayBytes)
        if (-not $ov.Valido) { foreach ($e in $ov.Errores) { $errors.Add('OVERLAY_' + $e) } }
        else {
            $decl = Read-DaubertManufacturingDeclarations ([System.Text.Encoding]::ASCII.GetString([byte[]]$OverlayBytes)) 'Overlay'
            if ($null -ne $decl.Enabled) { $enabled = $decl.Enabled; $origen.MANUFACTURING_ENABLED = 'Overlay' }
            if ($null -ne $decl.Emission) { $emission = $decl.Emission; $origen.MANUFACTURING_EMISSION_ENV = 'Overlay' }
        }
    }
    if ($enabled -ceq 'true' -and $emission -cne 'PRODUCCION') { $errors.Add('EFECTIVA_CONTRADICTORIA') }
    $habilita = ($errors.Count -eq 0 -and $enabled -ceq 'true' -and $emission -ceq 'PRODUCCION')
    return [pscustomobject]@{ Enabled = $enabled; Emission = $emission; Habilita = $habilita; Origen = $origen; Errores = @($errors) }
}

# ------------------------------------------------------------------ Container environment (filtered)
function Get-DaubertContainerEnvJson {
    # Seam: the ONLY place that reads a container environment. The raw text is never logged. Mocked in the tests.
    param([string]$Container)
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & docker inspect $Container --format '{{json .Config.Env}}' 2>$null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { return $null }
    return ((@($out) | ForEach-Object { [string]$_ }) -join '')
}

function ConvertFrom-DaubertContainerEnv {
    # Keeps only DB_NAME, MANUFACTURING_ENABLED, MANUFACTURING_EMISSION_ENV. Estado mirrors resolveManufacturing for daubert_global.
    param([AllowNull()][AllowEmptyString()][string]$Json)
    $keep = @('DB_NAME', 'MANUFACTURING_ENABLED', 'MANUFACTURING_EMISSION_ENV')
    $found = @{}; $errors = New-Object System.Collections.Generic.List[string]
    $entries = $null
    if ($Json) { try { $parsed = $Json | ConvertFrom-Json; $entries = @(foreach ($x in $parsed) { $x }); $parsed = $null } catch { $entries = $null } }   # PS 5.1 emits a JSON array as one object: enumerate explicitly
    if ($null -eq $entries) { return [pscustomobject]@{ DbName = $null; Enabled = $null; Emission = $null; Estado = 'Indeterminado'; Errores = @('JSON_INVALIDO') } }
    foreach ($entry in $entries) {
        $s = [string]$entry; $i = $s.IndexOf('=')
        if ($i -le 0) { continue }
        $k = $s.Substring(0, $i)
        if ($keep -notcontains $k) { continue }
        if ($found.ContainsKey($k)) { $errors.Add('DUPLICADA_' + $k) } else { $found[$k] = $s.Substring($i + 1) }
    }
    $entries = $null
    $get = { param($k) if ($found.ContainsKey($k)) { [string]$found[$k] } else { $null } }
    $db = & $get 'DB_NAME'; $en = & $get 'MANUFACTURING_ENABLED'; $em = & $get 'MANUFACTURING_EMISSION_ENV'
    return [pscustomobject]@{ DbName = $db; Enabled = $en; Emission = $em; Estado = $(if ($errors.Count -gt 0) { 'Indeterminado' } else { Resolve-DaubertManufacturingEstado $db $en $em }); Errores = @($errors) }
}

function Resolve-DaubertManufacturingEstado {
    # Mirror of resolveManufacturing (apps/api/src/config/environment.ts). Without DB_NAME nothing can be inferred -> Indeterminado.
    param($DbName, $Enabled, $Emission)
    if ($null -eq $DbName) { return 'Indeterminado' }
    $name = ([string]$DbName).Trim().ToLower()
    $flag = $null
    if ($null -ne $Enabled -and ([string]$Enabled).Trim()) { if ([string]$Enabled -ceq 'true') { $flag = $true } elseif ([string]$Enabled -ceq 'false') { $flag = $false } else { return 'NoArrancaria' } }
    $declared = $(if ($null -ne $Emission) { ([string]$Emission).Trim() } else { '' })
    if ($declared -cne '' -and $declared -cne 'PRUEBA' -and $declared -cne 'PRODUCCION') { return 'NoArrancaria' }
    if ($name -eq 'daubert_hub_test') {
        if ($declared -ceq 'PRODUCCION') { return 'NoArrancaria' }
        if ($flag -eq $false) { return 'Apagado' } else { return 'Encendido' }   # TEST: enabled by default
    }
    if ($name -eq 'daubert_global') {
        if ($declared -ceq 'PRUEBA') { return 'NoArrancaria' }
        if ($flag -eq $true -and $declared -cne 'PRODUCCION') { return 'NoArrancaria' }
        if ($flag -eq $true) { return 'Encendido' } else { return 'Apagado' }
    }
    if ($flag -eq $true) { return 'NoArrancaria' }
    return 'Apagado'
}

# ------------------------------------------------------------------ Closure policy decision (used by Set-EntryClosure.ps1 -Action Close)
function Get-DaubertManufacturingRuntimeState {
    # 'Apagada' | 'Habilitada' | 'Indeterminada'. Habilitada if the activation overlay is active OR the API container runs with the module on.
    param([bool]$OverlayActivaExiste, [string]$ContainerEstado)
    if ($OverlayActivaExiste -or $ContainerEstado -eq 'Encendido') { return 'Habilitada' }
    if ($ContainerEstado -eq 'Apagado') { return 'Apagada' }
    return 'Indeterminada'
}

function Test-DaubertClosurePolicyAllowed {
    # Pure. $null = allowed; otherwise the refusal reason. With Manufactura OFF the historical behaviour is unchanged (any policy).
    # With Manufactura enabled (or undeterminable: fail closed) only the Manufactura policy, which also blocks its writes, may be installed.
    param([ValidateSet('Operativa', 'Manufactura')][string]$Policy, [ValidateSet('Apagada', 'Habilitada', 'Indeterminada')][string]$Estado)
    if ($Policy -eq 'Manufactura' -or $Estado -eq 'Apagada') { return $null }
    if ($Estado -eq 'Habilitada') { return 'Manufactura esta HABILITADA: un cierre con la politica Operativa dejaria pasar sus escrituras. Use -Policy Manufactura -ExpectedPolicySha256 <sha del acta>. Nothing was changed.' }
    return 'No se pudo determinar si Manufactura esta habilitada (contenedor API ausente o entorno ilegible): por seguridad solo se admite -Policy Manufactura -ExpectedPolicySha256 <sha del acta>. Nothing was changed.'
}

# ------------------------------------------------------------------ Supervised overlay transition (primitives; the activation itself is Switch-Manufactura)
function Read-OverlayBytes { param([string]$Path) return [System.IO.File]::ReadAllBytes($Path) }
function Write-OverlayTemp {
    param([string]$Path, [byte[]]$Bytes)
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $fs.Write($Bytes, 0, $Bytes.Length); $fs.Flush($true) } finally { $fs.Dispose() }
}
function Move-OverlayFile { param([string]$From, [string]$To) [System.IO.File]::Move($From, $To) }

function Get-DaubertOverlayState {
    param([Parameter(Mandatory = $true)]$Paths)
    $describe = {
        param($p)
        if (-not (Test-Path -LiteralPath $p)) { return [pscustomobject]@{ Existe = $false; Valida = $false; Sha256 = '' } }
        $t = Test-DaubertOverlayBytes (Read-OverlayBytes $p)
        return [pscustomobject]@{ Existe = $true; Valida = $t.Valido; Sha256 = $t.Sha256 }
    }
    $prep = & $describe $Paths.OverlayPreparada
    $act = & $describe $Paths.OverlayActiva
    $tmp = @(); if (Test-Path -LiteralPath $Paths.OverlayActivaDir) { $tmp = @(Get-ChildItem -LiteralPath $Paths.OverlayActivaDir -Filter '*.tmp' -File | ForEach-Object { $_.Name }) }
    $errors = @()
    if ($act.Existe -and -not $act.Valida) { $errors += 'ACTIVA_NO_CANONICA' }
    if ($tmp.Count -gt 0) { $errors += 'TEMPORALES_PRESENTES' }
    return [pscustomobject]@{ Preparada = $prep; Activa = $act; Temporales = $tmp; Coherente = ($errors.Count -eq 0); Errores = $errors }
}

function Publish-DaubertOverlay {
    # P1 validate prepared; P2 refuse if active exists; P3 write own tmp (CreateNew + flush); P4 verify tmp; P5 rename tmp -> active (no overwrite); P6 verify active.
    param([Parameter(Mandatory = $true)]$Paths, [Parameter(Mandatory = $true)][string]$ExpectedSha256)
    $want = $ExpectedSha256.ToLower()
    if (-not (Test-Path -LiteralPath $Paths.OverlayPreparada)) { throw 'P1 PREPARADA_AUSENTE' }
    $bytes = Read-OverlayBytes $Paths.OverlayPreparada
    $chk = Test-DaubertOverlayBytes $bytes
    if (-not $chk.Valido) { throw ('P1 PREPARADA_NO_CANONICA ' + ($chk.Errores -join ',')) }
    if ($chk.Sha256 -ne $want) { throw 'P1 PREPARADA_SHA_DISTINTO' }
    if (Test-Path -LiteralPath $Paths.OverlayActiva) { throw 'P2 ACTIVA_YA_EXISTE' }
    if (-not (Test-Path -LiteralPath $Paths.OverlayActivaDir)) { New-Item -ItemType Directory -Force -Path $Paths.OverlayActivaDir | Out-Null }
    $tmp = Join-Path $Paths.OverlayActivaDir ('manufactura.env.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        Write-OverlayTemp $tmp $bytes
        if ((Get-DaubertBytesSha256 (Read-OverlayBytes $tmp)) -ne $want) { throw 'P4 TEMPORAL_SHA_DISTINTO' }
        Move-OverlayFile $tmp $Paths.OverlayActiva
    } catch {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        throw
    }
    # After a successful rename the overlay IS active: any problem reading it back must be reported as ActivaNoVerificada (the caller compensates), never thrown.
    $final = ''
    try { $final = Get-DaubertBytesSha256 (Read-OverlayBytes $Paths.OverlayActiva) } catch { $final = '' }
    if ($final -ne $want) { return [pscustomobject]@{ UltimoPaso = 'P6'; Resultado = 'ActivaNoVerificada'; Sha256 = $final } }
    return [pscustomobject]@{ UltimoPaso = 'P6'; Resultado = 'Publicada'; Sha256 = $final }
}

function Unpublish-DaubertOverlay {
    # Moves the active overlay to historial\<UTC>-<motivo>.env (never overwrites). No-op when there is no active overlay.
    param([Parameter(Mandatory = $true)]$Paths, [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9-]{1,40}$')][string]$Motivo)
    if (-not (Test-Path -LiteralPath $Paths.OverlayActiva)) { return [pscustomobject]@{ Resultado = 'SinActiva'; Destino = '' } }
    if (-not (Test-Path -LiteralPath $Paths.OverlayHistorialDir)) { New-Item -ItemType Directory -Force -Path $Paths.OverlayHistorialDir | Out-Null }
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $dest = Join-Path $Paths.OverlayHistorialDir ($stamp + '-' + $Motivo + '.env'); $n = 1
    while (Test-Path -LiteralPath $dest) { $dest = Join-Path $Paths.OverlayHistorialDir ($stamp + '-' + $Motivo + '-' + $n + '.env'); $n++ }
    Move-OverlayFile $Paths.OverlayActiva $dest
    if (Test-Path -LiteralPath $Paths.OverlayActiva) { throw 'RETIRO_NO_VERIFICADO: el overlay activo sigue presente' }
    return [pscustomobject]@{ Resultado = 'Retirada'; Destino = $dest }
}

function Clear-DaubertOverlayTemporales {
    param([Parameter(Mandatory = $true)]$Paths)
    if (-not (Test-Path -LiteralPath $Paths.OverlayActivaDir)) { return 0 }
    $files = @(Get-ChildItem -LiteralPath $Paths.OverlayActivaDir -Filter '*.tmp' -File)
    foreach ($f in $files) { Remove-Item -LiteralPath $f.FullName -Force }
    return $files.Count
}

Export-ModuleMember -Function Get-DaubertBytesSha256, Get-DaubertOpsPaths, Get-DaubertOperationLockInfo, Enter-DaubertOperationLock, Exit-DaubertOperationLock,
    Get-DaubertSessionHazards, Invoke-DaubertWithSanitizedEnvironment, Read-DaubertManufacturingDeclarations, Test-DaubertOverlayBytes, Get-DaubertEffectiveManufacturing,
    Get-DaubertContainerEnvJson, ConvertFrom-DaubertContainerEnv, Get-DaubertManufacturingRuntimeState, Test-DaubertClosurePolicyAllowed, Get-DaubertOverlayState, Publish-DaubertOverlay, Unpublish-DaubertOverlay, Clear-DaubertOverlayTemporales
