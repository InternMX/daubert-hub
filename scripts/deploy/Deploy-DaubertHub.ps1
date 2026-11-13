<#
.SYNOPSIS
    Controlled deployment of the Daubert Hub containers (api + web) to PROD (Windows PowerShell 5.1).

.DESCRIPTION
    Three mutually exclusive modes. With none of them the script prints this usage and exits
    without touching anything.

      -Preflight  Runs scripts\deploy\Test-DaubertDeployPreflight.ps1 and propagates its exit
                  code (0 = apt, 1 = blocked, 2 = no Hub/Docker changes). Read-only.
      -WhatIf     Runs the same validations as -Deploy and prints the plan (what would be
                  deployed, services, rollback anchors, the Compose command, post-deploy
                  checks and the rollback procedure). Read-only: it never reaches the mutating
                  seam.
      -Deploy     The ONLY mode that can modify PROD. Aborts on any failed validation, asks
                  for the exact phrase DEPLOY DAUBERT HUB, preserves the running images as
                  rollback anchors and recreates only api and web.

    Exit codes: 0 ok | 1 blocked or aborted | 2 nothing to deploy (no Hub/Docker changes) |
                3 usage error | 5 DEPLOYMENT FAILED (no automatic rollback).

    Design: every external process goes through exactly two seams, Invoke-DeployRead (read-only
    allowlist) and Invoke-DeployMutation (Deploy mode only, exact allowlist: tagging the
    running images as rollback anchors and the single Compose up for api and web). Facts are
    gathered first (Get-DeployContext), validated (Test-DeployGate), turned into a pure plan
    (New-DeployPlan), and only then executed (Invoke-DeployPlan) and verified (Test-PostDeploy).

    The script never prints secrets (all native output goes through Protect-Line), never reads
    the env file except for the non-secret HUB_PORT, runs no SQL or migrations, does not touch
    n8n, and never runs git commands that change the repository.

.PARAMETER Candidate
    Commit to deploy. It must be exactly HEAD (the build takes GIT_COMMIT from HEAD).

.PARAMETER AcknowledgeN8nAlreadyApplied
    Explicit acknowledgement that the n8n/ files in the release are versioned exports of workflows
    that are ALREADY applied and verified in PROD. Without it, any change under n8n/ blocks the
    deployment. With it, only that one gate reason is lifted: the script still never imports,
    activates, deactivates or modifies anything in n8n. It does NOT affect the migrations gate
    (migrations always block) or any other validation.

.PARAMETER AcknowledgeMigrationsAlreadyApplied
    Explicit acknowledgement that the database/ files in the release are migrations that were ALREADY applied by hand (precheck, UP, postcheck) before this deployment. It is only
    honoured together with ALL of: -ExpectedMigrations (every database/ file of the release must start with one of these name prefixes under database/migrations/daubert_global/;
    any other database/ file still blocks), -MigrationsEvidence (a file written within -EvidenceMaxAgeHours that contains every -EvidenceMarkers text, e.g. the saved output of the
    postchecks) and -EvidenceMarkers. The script still runs no SQL and applies nothing.

.PARAMETER DatabaseManifest
    Optional. Path (relative to the repository) of a RELEASE MANIFEST of database/ files (scripts/deploy/generar-manifiesto-database.cjs). Only honoured together with
    -AcknowledgeMigrationsAlreadyApplied, -ExpectedMigrations, -MigrationsEvidence, -EvidenceMarkers and -DatabaseManifestSha256. With it, EVERY database/ file of the release
    (the delta against the commit running in PROD) must be listed in the manifest with exactly the same git blob id, and nothing else is allowed: a new, deleted or modified file
    still blocks. Files categorised produccion_* must ALSO satisfy -ExpectedMigrations (under database/migrations/daubert_global/); inerte_nunca_en_prod files (TEST migrations,
    maintenance, tools, documentation) are accepted only because they are listed, and are never applied. Files matching the manifest's "prohibidos" (e.g. the Caterpillar 025
    migration of another branch) block even if listed. Without this parameter the previous behaviour is unchanged.

.PARAMETER DatabaseManifestSha256
    SHA-256 of the manifest text (LF line endings), delivered OUTSIDE the repository (the authorization record). The gate recomputes it and blocks on any difference, so changing a
    migration AND the manifest in the same commit is detected.

.PARAMETER UseValidatedImages
    Optional. Deploy EXACTLY the images that were built and validated beforehand (scripts/deploy/New-ReleaseImages.ps1) instead of building at deployment time: nothing is rebuilt, no floating
    tag is trusted. Requires -ImagesManifest and -ImagesManifestSha256. The gate blocks unless the local tags daubert-hub-<svc>:release-<commit> exist and their image IDs equal the manifest's.
    The plan then tags release-<commit> as :latest (after the rollback anchors) and runs 'docker compose up -d --no-build api web'. Without this switch the behaviour is unchanged ('up -d --build').

.PARAMETER ImagesManifest
    Path (relative to the repository or absolute) of the images manifest written by New-ReleaseImages.ps1 (commit, version and image ID per service).

.PARAMETER ImagesManifestSha256
    SHA-256 of the images manifest text (LF line endings), delivered outside the repository with the authorisation record.

.PARAMETER ClosurePolicy
    Operativa (default: deploy/closure/entry-closure-policy.conf, behaviour unchanged) or Manufactura. Selecting Manufactura IMPLIES -RequireClosedWindow (the closed window is
    verified even if that switch is omitted). The Manufactura policy is deploy/closure/entry-closure-policy.manufactura.conf, which also blocks every
    write under /api/manufacturing-sheets). Manufactura REQUIRES -ClosurePolicySha256: the gate blocks unless the versioned file has exactly that SHA-256, and with -RequireClosedWindow
    the external default.conf must be that policy. A configuration that ENABLES Manufactura inside a required closed window must use -ClosurePolicy Manufactura.

.PARAMETER ClosurePolicySha256
    SHA-256 of the selected closure policy file, authorised outside the repository. Optional with the operative policy, mandatory with Manufactura.

.PARAMETER ManufacturingReadinessEvidence
    Evidence file written by scripts/deploy/Test-ManufacturaReleaseReadiness.ps1 -Phase PreEnable -EvidenceFile <file outside the repository>. REQUIRED whenever the production
    configuration enables Manufactura (MANUFACTURING_ENABLED=true in deploy/pilot.prod.env or in the shell): the gate blocks unless the file is recent (-EvidenceMaxAgeHours)
    and says MANUFACTURA_READINESS_PASS phase=PreEnable. A contradictory configuration (ENABLED=true without EMISSION_ENV=PRODUCCION, EMISSION_ENV=PRUEBA, any value other than
    true/false) blocks always. With Manufactura not enabled nothing changes.

.PARAMETER ExpectedN8nPaths
    Optional. With -AcknowledgeN8nAlreadyApplied, every changed n8n/ file must start with one of these path prefixes; anything else still blocks.

.PARAMETER RequireClosedWindow
    The approved entry-closure override (deploy/closure/entry-closure-override.yaml) is ALWAYS part of every Compose invocation of this script, so Web never starts without the
    externally mounted conf.d. With this switch -Deploy also requires that the mounted default.conf is the CLOSED policy (byte for byte deploy/closure/entry-closure-policy.conf);
    use it for the joint Pagos + Caterpillar window.

.PARAMETER HealthTimeoutSeconds
    How long -Deploy waits for api to become healthy and web to answer. Default: 180.

.PARAMETER RequireSynchronizedMain
    Supervised release gate: full SHA == HEAD == origin/main == live refs/heads/main,
    clean main checkout. Rechecks facts and gates AFTER interactive confirmation.

.NOTES
    Rollback anchors and /api/health use the 7-character commit (git rev-parse --short=7 HEAD) everywhere; GIT_COMMIT is built with the same value. An anchor that already exists is
    reused ONLY when it points at exactly the running image (same digest); otherwise the deployment is blocked and nothing is overwritten.
#>
[CmdletBinding()]
param(
    [switch]$Preflight,
    [switch]$WhatIf,
    [switch]$Deploy,
    [string]$Candidate = 'HEAD',
    [int]$HealthTimeoutSeconds = 180,
    [switch]$AcknowledgeN8nAlreadyApplied,
    [switch]$AcknowledgeMigrationsAlreadyApplied,
    [string[]]$ExpectedMigrations = @(),
    [string]$DatabaseManifest = '',
    [string]$DatabaseManifestSha256 = '',
    [switch]$UseValidatedImages,
    [string]$ImagesManifest = '',
    [string]$ImagesManifestSha256 = '',
    [string]$ManufacturingReadinessEvidence = '',
    [ValidateSet('Operativa', 'Manufactura')][string]$ClosurePolicy = 'Operativa',
    [string]$ClosurePolicySha256 = '',
    [string]$MigrationsEvidence = '',
    [string[]]$EvidenceMarkers = @(),
    [int]$EvidenceMaxAgeHours = 6,
    [string[]]$ExpectedN8nPaths = @(),
    [switch]$RequireClosedWindow,
    [switch]$RequireSynchronizedMain
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:PreflightPath = Join-Path $PSScriptRoot 'Test-DaubertDeployPreflight.ps1'
$script:Mode = 'None'
$script:ConfirmationPhrase = 'DEPLOY DAUBERT HUB'
$script:Project = 'daubert-hub'
$script:EnvFile = 'deploy/pilot.prod.env'
$script:ComposeFiles = @('compose.pilot.yaml', 'compose.prod-temp.yaml', 'deploy/closure/entry-closure-override.yaml')
$script:ClosureDir = 'C:\Users\06\AppData\Local\DaubertHub\maintenance-window\nginx-conf.d'
$script:Services = @('api', 'web')
$script:ShaPattern = '^[0-9a-f]{7,40}$'
$script:Options = @{}

# ================================================================== Output (never prints secrets)
function Protect-Line {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    return ($Text -replace '(?i)((?:password|passwd|token|secret|api[_-]?key|authorization)\w*\s*[=:]\s*)\S+', '$1***')
}

function Write-Safe {
    param([string]$Text = '')
    Write-Host (Protect-Line $Text)
}

function Get-Prop {
    # StrictMode-safe property read: '' when the object or the property is missing.
    param($Object, [string]$Name)
    if ($null -eq $Object) { return '' }
    if ($Object.PSObject.Properties.Name -contains $Name) { return [string]$Object.$Name }
    return ''
}

# ================================================================== Seams
function Get-ComposeBaseArgs {
    $result = @('--project-name', $script:Project, '--env-file', $script:EnvFile)
    foreach ($f in $script:ComposeFiles) { $result += @('-f', $f) }
    return $result
}

function Get-ComposeVerb {
    param([string[]]$CmdArgs)
    $valueFlags = '--project-name', '-p', '--env-file', '-f', '--file', '--profile', '--project-directory'
    $i = 1
    while ($i -lt $CmdArgs.Count) {
        $token = $CmdArgs[$i]
        if ($valueFlags -contains $token) { $i += 2; continue }
        if ($token.StartsWith('-')) { $i++; continue }
        return $token
    }
    return $null
}

function Test-ReadOnlyCommand {
    # Returns $null when the command is an allowed READ, otherwise the reason it is refused.
    param([string]$Exe, [string[]]$CmdArgs)
    switch ($Exe) {
        'git' {
            $verbs = 'rev-parse', 'status', 'diff', 'ls-remote', 'cat-file', 'check-ignore', 'ls-files', 'rev-list'
            $verb = @($CmdArgs | Where-Object { $_ -ne '--no-optional-locks' })[0]
            if ($verbs -contains $verb) { return $null }
            return ('git ' + $verb + ' no es una lectura permitida')
        }
        'docker' {
            $first = $CmdArgs[0]
            if (@('version', 'inspect', 'ps', 'info') -contains $first) { return $null }
            if ($first -eq 'image' -and $CmdArgs.Count -gt 1 -and $CmdArgs[1] -eq 'inspect') { return $null }
            if ($first -eq 'compose' -and (@('version', 'config', 'ps') -contains (Get-ComposeVerb $CmdArgs))) { return $null }
            return ('docker ' + ($CmdArgs -join ' ') + ' no es una lectura permitida')
        }
        'powershell' {
            $at = [array]::IndexOf($CmdArgs, '-File')
            if ($at -ge 0 -and ($at + 1) -lt $CmdArgs.Count -and $CmdArgs[$at + 1] -eq $script:PreflightPath) { return $null }
            return 'solo se permite ejecutar el preflight existente'
        }
        default { return ('ejecutable no permitido para lectura: ' + $Exe) }
    }
}

function Invoke-DeployRead {
    # The ONLY way this script runs a native command for reading.
    param([string]$Exe, [string[]]$CmdArgs)
    $refused = Test-ReadOnlyCommand $Exe $CmdArgs
    if ($refused) { throw ('Lectura rechazada: ' + $refused) }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Exe @CmdArgs 2>$null
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Out = @($out | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ }) }
}

function Test-AllowedMutation {
    # The complete list of mutations this script can ever perform. Returns $null when allowed.
    param([string]$Exe, [string[]]$CmdArgs)
    if ($Exe -ne 'docker') { return ('ejecutable no permitido: ' + $Exe) }
    $validated = ($script:Options.Contains('UseValidatedImages') -and [bool]$script:Options['UseValidatedImages'])
    if ($validated -and $CmdArgs.Count -eq 3 -and $CmdArgs[0] -eq 'tag') {
        $p1 = [regex]::Match($CmdArgs[1], '^daubert-hub-(api|web):release-[0-9a-f]{7,40}$')
        $p2 = [regex]::Match($CmdArgs[2], '^daubert-hub-(api|web):latest$')
        if ($p1.Success -and $p2.Success -and $p1.Groups[1].Value -eq $p2.Groups[1].Value) { return $null }
    }
    if ($CmdArgs.Count -eq 3 -and $CmdArgs[0] -eq 'tag') {
        $src = [regex]::Match($CmdArgs[1], '^daubert-hub-(api|web):latest$')
        $dst = [regex]::Match($CmdArgs[2], '^daubert-hub-(api|web):rollback-[0-9a-f]{7,40}$')
        if ($src.Success -and $dst.Success -and $src.Groups[1].Value -eq $dst.Groups[1].Value) { return $null }
        return 'solo se permite etiquetar daubert-hub-<svc>:latest como daubert-hub-<svc>:rollback-<sha>'
    }
    $expected = @('compose') + (Get-ComposeBaseArgs) + @('up', '-d', '--build') + $script:Services
    if (($CmdArgs -join ' ') -ceq ($expected -join ' ')) { return $null }
    if ($validated) {
        $expectedNoBuild = @('compose') + (Get-ComposeBaseArgs) + @('up', '-d', '--no-build') + $script:Services
        if (($CmdArgs -join ' ') -ceq ($expectedNoBuild -join ' ')) { return $null }
    }
    return 'solo se permite el docker compose up -d --build api web definido para PROD'
}

function Invoke-DeployMutation {
    # The ONLY way this script modifies anything. Refuses outside -Deploy and outside the allowlist.
    param([string]$Exe, [string[]]$CmdArgs)
    if ($script:Mode -ne 'Deploy') { throw ('Operacion mutante bloqueada fuera de -Deploy (modo ' + $script:Mode + ')') }
    $refused = Test-AllowedMutation $Exe $CmdArgs
    if ($refused) { throw ('Operacion mutante rechazada: ' + $refused) }
    Write-Safe ('> ' + $Exe + ' ' + ($CmdArgs -join ' '))
    # BuildKit escribe progreso en stderr: en PS 5.1 no debe convertirse en una excepcion.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $global:LASTEXITCODE = $null
        $out = & $Exe @CmdArgs 2>&1
        $code = if ($null -eq $global:LASTEXITCODE) { 1 } else { $global:LASTEXITCODE }
    } finally { $ErrorActionPreference = $previous }
    foreach ($line in @($out)) { Write-Safe ([string]$line) }
    return @{ Code = $code; Out = @() }
}

function Invoke-DeployHttp {
    param([string]$Url)
    if ($Url -notmatch '^http://localhost:\d+/') { throw ('URL no permitida: ' + $Url) }
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
        return @{ Status = [int]$r.StatusCode; Content = [string]$r.Content }
    } catch { return $null }
}

function Read-DeployConfirmation {
    return (Read-Host ('Para continuar escriba exactamente: ' + $script:ConfirmationPhrase))
}

function Read-DeployEvidence {
    # Reads (never writes) the migrations evidence file: existence, age and text. Mocked in the tests.
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return [pscustomobject]@{ Exists = $false; AgeHours = 0; Text = '' } }
    $item = Get-Item -LiteralPath $Path
    return [pscustomobject]@{ Exists = $true; AgeHours = ((Get-Date) - $item.LastWriteTime).TotalHours; Text = (Get-Content -LiteralPath $Path -Raw) }
}

function Read-DeployManifest {
    # Reads (never writes) the release manifest: existence, SHA-256 of its text with LF line endings, and the parsed JSON. Mocked in the tests.
    param([string]$Path)
    $full = $Path
    if (-not [System.IO.Path]::IsPathRooted($full)) { $full = Join-Path $script:RepoRoot $Path }
    if (-not (Test-Path -LiteralPath $full)) { return [pscustomobject]@{ Exists = $false; Sha256 = ''; Json = $null } }
    $text = (Get-Content -LiteralPath $full -Raw -Encoding UTF8) -replace "`r`n", "`n"
    $sha = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))).Replace('-', '').ToLower()
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch { $json = $null }
    return [pscustomobject]@{ Exists = $true; Sha256 = $sha; Json = $json }
}

function Start-DeploySleep {
    param([int]$Seconds)
    Start-Sleep -Seconds $Seconds
}

function Read-HubPort {
    # HUB_PORT is not a secret; nothing else is ever read from the env file.
    $path = Join-Path $script:RepoRoot $script:EnvFile
    if (Test-Path -LiteralPath $path) {
        foreach ($line in (Get-Content -LiteralPath $path)) {
            if ($line -match '^\s*HUB_PORT\s*=\s*(\d+)\s*$') { return $Matches[1] }
        }
    }
    return '8082'
}

function Read-ManufacturingFlags {
    # Only MANUFACTURING_ENABLED and MANUFACTURING_EMISSION_ENV are read (not secrets). Compose gives the shell environment precedence over --env-file, so does this. Mocked in the tests.
    $flags = @{ Enabled = ''; Emission = '' }
    $path = Join-Path $script:RepoRoot $script:EnvFile
    if (Test-Path -LiteralPath $path) {
        foreach ($line in (Get-Content -LiteralPath $path)) {
            if ($line -match '^\s*MANUFACTURING_ENABLED\s*=\s*(.*?)\s*$') { $flags.Enabled = $Matches[1].Trim('"').Trim("'") }
            if ($line -match '^\s*MANUFACTURING_EMISSION_ENV\s*=\s*(.*?)\s*$') { $flags.Emission = $Matches[1].Trim('"').Trim("'") }
        }
    }
    if ($env:MANUFACTURING_ENABLED) { $flags.Enabled = [string]$env:MANUFACTURING_ENABLED }
    if ($env:MANUFACTURING_EMISSION_ENV) { $flags.Emission = [string]$env:MANUFACTURING_EMISSION_ENV }
    return [pscustomobject]$flags
}

# ================================================================== Facts
function Get-RunningDigest {
    param([string]$Service)
    $r = Invoke-DeployRead 'docker' @('inspect', ($script:Project + '-' + $Service + '-1'), '--format', '{{if .ImageManifestDescriptor}}{{.ImageManifestDescriptor.digest}}{{end}}')
    if ($r.Code -ne 0) { return '' }
    return ($r.Out -join '')
}

function Get-TagDigest {
    param([string]$ImageRef)
    $r = Invoke-DeployRead 'docker' @('image', 'inspect', $ImageRef, '--platform', 'linux/amd64', '--format', '{{.Id}}')
    if ($r.Code -ne 0) { return '' }
    return ($r.Out -join '')
}

function Test-ImageExists {
    param([string]$ImageRef)
    $r = Invoke-DeployRead 'docker' @('image', 'inspect', $ImageRef, '--format', '{{.Id}}')
    return ($r.Code -eq 0)
}

function Get-ClosureState {
    # Read-only facts about the external conf.d that the override mounts (create_host_path=false: it must exist) and about the versioned closed policy.
    $conf = Join-Path $script:ClosureDir 'default.conf'
    $policy = Join-Path $script:RepoRoot 'deploy\closure\entry-closure-policy.conf'
    $manufactura = Join-Path $script:RepoRoot 'deploy\closure\entry-closure-policy.manufactura.conf'
    $confSha = ''; $policySha = ''; $manufacturaSha = ''
    if (Test-Path -LiteralPath $manufactura) { $manufacturaSha = (Get-FileHash -LiteralPath $manufactura -Algorithm SHA256).Hash.ToLower() }
    if (Test-Path -LiteralPath $conf) { $confSha = (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash.ToLower() }
    if (Test-Path -LiteralPath $policy) { $policySha = (Get-FileHash -LiteralPath $policy -Algorithm SHA256).Hash.ToLower() }
    return @{ ConfExists = [bool]$confSha; ConfSha = $confSha; PolicySha = $policySha; ManufacturaPolicySha = $manufacturaSha }
}

function Get-DeployContext {
    param([string]$Candidate)
    $git = @('--no-optional-locks')
    $head = Invoke-DeployRead 'git' ($git + @('rev-parse', 'HEAD'))
    $headShort = Invoke-DeployRead 'git' ($git + @('rev-parse', '--short=7', 'HEAD'))   # fixed 7-character commit: GIT_COMMIT, /api/health and the rollback-<commit> anchors all use it
    $cand = Invoke-DeployRead 'git' ($git + @('rev-parse', $Candidate))
    $dirty = Invoke-DeployRead 'git' ($git + @('status', '--short'))
    $pkgPath = Join-Path $script:RepoRoot 'package.json'
    $appVersion = ''
    if (Test-Path -LiteralPath $pkgPath) { $appVersion = [string](Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json).version }

    $port = Read-HubPort
    $healthUrl = 'http://localhost:' + $port + '/api/health'
    $health = $null
    $http = Invoke-DeployHttp $healthUrl
    if ($http -and $http.Status -eq 200) { try { $health = $http.Content | ConvertFrom-Json } catch { $health = $null } }
    $prev = ''
    $prev = Get-Prop $health 'commit'

    $hubDocker = @(); $migrations = @(); $n8n = @(); $deltaKnown = $false
    if ($prev -cmatch $script:ShaPattern) {
        $exists = Invoke-DeployRead 'git' ($git + @('cat-file', '-e', ($prev + '^{commit}')))
        if ($exists.Code -eq 0) {
            $diff = Invoke-DeployRead 'git' ($git + @('diff', '--name-only', $prev, 'HEAD'))
            if ($diff.Code -eq 0) {
                $deltaKnown = $true
                $hubDocker = @($diff.Out | Where-Object { $_ -match '^(apps/|package(-lock)?\.json$|docker/|compose)' })
                $migrations = @($diff.Out | Where-Object { $_ -match '^database/' })
                $n8n = @($diff.Out | Where-Object { $_ -match '^n8n/' })
            }
        }
    }

    $images = Invoke-DeployRead 'docker' (@('compose') + (Get-ComposeBaseArgs) + @('config', '--images'))
    $services = @{}
    foreach ($svc in $script:Services) {
        $imageRef = $script:Project + '-' + $svc + ':latest'
        $anchor = $null
        if ($prev -cmatch $script:ShaPattern) { $anchor = $script:Project + '-' + $svc + ':rollback-' + $prev }
        $services[$svc] = [pscustomobject]@{
            Name          = $svc
            Container     = $script:Project + '-' + $svc + '-1'
            Image         = $imageRef
            RunningDigest = (Get-RunningDigest $svc)
            TagDigest     = (Get-TagDigest $imageRef)
            Anchor        = $anchor
            AnchorExists  = $(if ($anchor) { Test-ImageExists $anchor } else { $false })
            AnchorDigest  = ''
        }
        if ($services[$svc].AnchorExists) { $services[$svc].AnchorDigest = (Get-TagDigest $anchor) }
    }

    $evidence = [pscustomobject]@{ Required = $false; Exists = $false; AgeHours = 0; Text = '' }
    if ($script:Options.Contains('MigrationsEvidence') -and $script:Options['MigrationsEvidence']) { $evidence = Read-DeployEvidence ([string]$script:Options['MigrationsEvidence']) }

    # Release manifest of database/ files (optional): blob id of every changed database/ file at HEAD, read-only (git rev-parse).
    $manifest = $null
    $blobs = @{}
    if ($script:Options.Contains('DatabaseManifest') -and $script:Options['DatabaseManifest']) {
        $manifest = Read-DeployManifest ([string]$script:Options['DatabaseManifest'])
        # The changed database/ files AND every production file the manifest authorises (a required migration that disappeared from HEAD must block even though it is not in the delta).
        $wantBlobs = @($migrations)
        if ($manifest -and $manifest.Json -and $manifest.Json.archivos) { foreach ($ma in @($manifest.Json.archivos)) { if ([string]$ma.categoria -like 'produccion_*') { $wantBlobs += [string]$ma.ruta } } }
        foreach ($mf in @($wantBlobs | Select-Object -Unique)) {
            $b = Invoke-DeployRead 'git' ($git + @('rev-parse', ('HEAD:' + $mf)))
            $blobs[$mf] = $(if ($b.Code -eq 0 -and $b.Out.Count -gt 0) { [string]$b.Out[0] } else { '' })
        }
    }

    # Validated images (optional): the images manifest and the IDs of the local release-<commit> tags (read-only).
    $imgManifest = $null
    $releaseIds = @{}
    if ($script:Options.Contains('UseValidatedImages') -and [bool]$script:Options['UseValidatedImages']) {
        if ($script:Options.Contains('ImagesManifest') -and $script:Options['ImagesManifest']) { $imgManifest = Read-DeployManifest ([string]$script:Options['ImagesManifest']) }
        $shortHead = $(if ($headShort.Code -eq 0 -and $headShort.Out.Count -gt 0) { [string]$headShort.Out[0] } else { '' })
        foreach ($svc in $script:Services) {
            $ref = $script:Project + '-' + $svc + ':release-' + $shortHead
            $q = Invoke-DeployRead 'docker' @('image', 'inspect', $ref, '--format', '{{.Id}}')
            $releaseIds[$svc] = $(if ($q.Code -eq 0 -and $q.Out.Count -gt 0) { [string]$q.Out[0] } else { '' })
        }
    }

    $readiness = $null
    if ($script:Options.Contains('ManufacturingReadinessEvidence') -and $script:Options['ManufacturingReadinessEvidence']) { $readiness = Read-DeployEvidence ([string]$script:Options['ManufacturingReadinessEvidence']) }

    return [pscustomobject]@{
        CandidateInput = $Candidate
        Manufacturing  = (Read-ManufacturingFlags)
        ReadinessEvidence = $readiness
        CandidateFull  = $(if ($cand.Code -eq 0 -and $cand.Out.Count -gt 0) { $cand.Out[0] } else { '' })
        HeadFull       = $(if ($head.Code -eq 0 -and $head.Out.Count -gt 0) { $head.Out[0] } else { '' })
        HeadShort      = $(if ($headShort.Code -eq 0 -and $headShort.Out.Count -gt 0) { $headShort.Out[0] } else { '' })
        Dirty          = @($dirty.Out)
        AppVersion     = $appVersion
        HealthUrl      = $healthUrl
        Health         = $health
        PreviousCommit = $prev
        DeltaKnown     = $deltaKnown
        HubDockerFiles = $hubDocker
        MigrationFiles = $migrations
        ImagesManifest = $imgManifest
        ReleaseImageIds = $releaseIds
        MigrationBlobs = $blobs
        Manifest       = $manifest
        N8nFiles       = $n8n
        Evidence       = $evidence
        Closure        = (Get-ClosureState)
        ComposeImages  = @($images.Out)
        Services       = $services
    }
}

# ================================================================== Validation
function Test-DatabaseManifest {
    # Pure: turns the context + the release manifest into blocking reasons for the database/ files of the release. Empty list = every file is authorised with identical content.
    param($Context, $Options, [string[]]$Expected, [string]$MigrationPrefix)
    $m = $Context.Manifest
    if (-not $m -or -not $m.Exists) { return @('Falta el manifiesto de database/ (-DatabaseManifest).') }
    $want = [string]$Options['DatabaseManifestSha256']
    if (-not $want) { return @('-DatabaseManifest exige -DatabaseManifestSha256 (SHA-256 del manifiesto, entregado fuera del repositorio).') }
    if ($m.Sha256 -ne $want.ToLower()) { return @('El SHA-256 del manifiesto (' + $m.Sha256 + ') no coincide con -DatabaseManifestSha256.') }
    if (-not $m.Json -or [string]$m.Json.formato -ne '1' -or -not $m.Json.archivos) { return @('El manifiesto de database/ no es valido.') }
    $reasons = @()
    $byPath = @{}
    foreach ($a in @($m.Json.archivos)) { $byPath[[string]$a.ruta] = $a }
    # Forbidden patterns are ALSO hard-coded here (independent of the manifest): the Caterpillar 025 recovery migration of another branch can never ride along, even in a tampered manifest.
    $forbidden = @(@('_025_', 'caterpillar_folio_recovery') + @($m.Json.prohibidos | Where-Object { $_ }) | Select-Object -Unique)
    foreach ($file in @($Context.MigrationFiles)) {
        $hit = @($forbidden | Where-Object { $file.Contains($_) })
        if ($hit.Count -gt 0) { $reasons += ('Archivo prohibido en el release (' + $file + ' contiene "' + $hit[0] + '").'); continue }
        if (-not $byPath.ContainsKey($file)) { $reasons += ('Archivo de database/ no autorizado por el manifiesto: ' + $file); continue }
        $entry = $byPath[$file]
        $blob = [string]$Context.MigrationBlobs[$file]
        if (-not $blob) { $reasons += ('Archivo de database/ eliminado o ilegible en HEAD (no autorizado): ' + $file); continue }
        if ($blob -ne [string]$entry.blob) { $reasons += ('Archivo de database/ MODIFICADO respecto del manifiesto: ' + $file); continue }
        if ([string]$entry.categoria -like 'produccion_*') {
            if (-not ($file.StartsWith($MigrationPrefix) -and @($Expected | Where-Object { $file.Substring($MigrationPrefix.Length).StartsWith($_) }).Count -gt 0)) { $reasons += ('Archivo de produccion fuera de -ExpectedMigrations: ' + $file) }
        }
    }
    foreach ($entry in @($m.Json.archivos | Where-Object { [string]$_.categoria -like 'produccion_*' })) {
        $ruta = [string]$entry.ruta
        if (@($Context.MigrationFiles) -contains $ruta) { continue }
        $blob = ''
        if ($Context.MigrationBlobs.ContainsKey($ruta)) { $blob = [string]$Context.MigrationBlobs[$ruta] }
        if ($blob -ne [string]$entry.blob) { $reasons += ('Archivo autorizado de produccion ausente o distinto en HEAD: ' + $ruta) }
    }
    return $reasons
}

function Test-DeploySynchronizedMain {
    param([string]$Candidate)
    if ($Candidate -notmatch '\A[0-9a-fA-F]{40}\z') { return $false }
    foreach ($ref in @('HEAD', 'refs/remotes/origin/main')) {
        $r = Invoke-DeployRead 'git' @('--no-optional-locks', 'rev-parse', '--verify', ($ref + '^{commit}'))
        if ($r.Code -ne 0 -or $r.Out.Count -ne 1 -or [string]$r.Out[0] -ne $Candidate) { return $false }
    }
    $branch = Invoke-DeployRead 'git' @('--no-optional-locks', 'rev-parse', '--abbrev-ref', 'HEAD')
    if ($branch.Code -ne 0 -or $branch.Out.Count -ne 1 -or [string]$branch.Out[0] -cne 'main') { return $false }
    $dirty = Invoke-DeployRead 'git' @('--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all')
    if ($dirty.Code -ne 0 -or $dirty.Out.Count -ne 0) { return $false }
    $remote = Invoke-DeployRead 'git' @('--no-optional-locks', 'ls-remote', '--exit-code', 'origin', 'refs/heads/main')
    if ($remote.Code -ne 0 -or $remote.Out.Count -ne 1) { return $false }
    return ([string]$remote.Out[0] -cmatch ('\A' + $Candidate.ToLowerInvariant() + '\s+refs/heads/main\z'))
}

function Test-DeployGate {
    # Pure: turns facts into a list of blocking reasons. Empty list = may proceed.
    # $AcknowledgeN8n lifts ONLY the n8n/ reason; migrations and every other check are unaffected.
    param($Context, [bool]$AcknowledgeN8n = $false, $Options = @{})
    $reasons = @()
    $migrationPrefix = 'database/migrations/daubert_global/'
    if (-not $Context.CandidateFull -or $Context.CandidateFull -ne $Context.HeadFull) { $reasons += 'El candidato no es exactamente HEAD (GIT_COMMIT se toma de HEAD al construir).' }
    if (@($Context.Dirty).Count -gt 0) { $reasons += 'El arbol de trabajo no esta limpio.' }
    if ($Context.HeadShort -cnotmatch $script:ShaPattern) { $reasons += 'No se pudo determinar el commit corto de HEAD.' }
    if (-not $Context.AppVersion) { $reasons += 'No se pudo leer APP_VERSION de package.json.' }
    if (-not $Context.Closure.ConfExists) { $reasons += 'Falta default.conf en el directorio externo del cierre (override obligatorio en toda recreacion de Web); ejecute Set-EntryClosure.ps1 -Action Prepare.' }
    # Closure policy selection: the operative policy by default; the Manufactura policy only when explicitly selected AND its SHA-256 matches the authorised one.
    $closureSelected = $(if ($Options.Contains('ClosurePolicy') -and [string]$Options['ClosurePolicy'] -eq 'Manufactura') { 'Manufactura' } else { 'Operativa' })
    $closureWant = $(if ($Options.Contains('ClosurePolicySha256')) { ([string]$Options['ClosurePolicySha256']).ToLower() } else { '' })
    $closureSha = [string]$Context.Closure.PolicySha
    if ($closureSelected -eq 'Manufactura') {
        $closureSha = $(if ($Context.Closure.ContainsKey('ManufacturaPolicySha')) { [string]$Context.Closure.ManufacturaPolicySha } else { '' })
        if (-not $closureWant) { $reasons += '-ClosurePolicy Manufactura exige -ClosurePolicySha256 (SHA-256 autorizado de la politica de cierre de Manufactura).' }
        elseif (-not $closureSha) { $reasons += 'Falta deploy/closure/entry-closure-policy.manufactura.conf.' }
    }
    if ($closureWant -and $closureSha -and $closureSha -ne $closureWant) { $reasons += ('La politica de cierre seleccionada (' + $closureSelected + ', ' + $closureSha + ') no coincide con -ClosurePolicySha256.') }
    # Selecting the Manufactura policy IMPLIES the closed-window requirement: a Manufactura release never proceeds unless the external default.conf IS that policy (same check as -RequireClosedWindow).
    $closureRequired = (($Options.Contains('RequireClosedWindow') -and [bool]$Options['RequireClosedWindow']) -or $closureSelected -eq 'Manufactura')
    $closureMf = $(if ($Context.PSObject.Properties.Name -contains 'Manufacturing') { $Context.Manufacturing } else { $null })
    if ($closureRequired -and $closureMf -and [string]$closureMf.Enabled -ceq 'true' -and $closureSelected -ne 'Manufactura') { $reasons += 'La configuracion habilita Manufactura: la ventana cerrada debe usar la politica de Manufactura (-ClosurePolicy Manufactura -ClosurePolicySha256 ...).' }
    if ($closureRequired -and (-not $closureSha -or $Context.Closure.ConfSha -ne $closureSha)) { $reasons += 'La ventana exige el cierre ACTIVO: default.conf externo no es la politica cerrada versionada (ejecute Set-EntryClosure.ps1 -Action Close).' }
    if (-not $Context.Health) {
        $reasons += 'No se pudo leer /api/health de PROD.'
    } else {
        if ((Get-Prop $Context.Health 'status') -ne 'ok') { $reasons += 'PROD: status distinto de ok.' }
        if ((Get-Prop $Context.Health 'database') -ne 'connected') { $reasons += 'PROD: database distinta de connected.' }
        if ((Get-Prop $Context.Health 'environment') -ne 'PRODUCTION') { $reasons += 'PROD: environment distinto de PRODUCTION.' }
    }
    if ($Context.PreviousCommit -cnotmatch $script:ShaPattern) { $reasons += ('Commit anterior invalido (no es un SHA hexadecimal de 7 a 40 caracteres): "' + $Context.PreviousCommit + '".') }
    if ($Context.PreviousCommit -cmatch $script:ShaPattern -and -not $Context.DeltaKnown) { $reasons += 'No se pudo calcular el delta contra el commit desplegado (no existe localmente).' }
    foreach ($img in $script:Services) {
        $expected = $script:Project + '-' + $img
        if (@($Context.ComposeImages | Where-Object { $_ -eq $expected -or $_ -eq ($expected + ':latest') }).Count -eq 0) {
            $reasons += ('Compose no usaria la imagen ' + $expected + ' para el servicio ' + $img + '.')
        }
    }
    foreach ($svc in $script:Services) {
        $s = $Context.Services[$svc]
        if (-not $s.RunningDigest -or -not $s.TagDigest) {
            $reasons += ($svc + ': no se pudo leer el digest de la imagen en ejecucion o de ' + $s.Image + '.')
        } elseif ($s.RunningDigest -ne $s.TagDigest) {
            $reasons += ($svc + ': la imagen en ejecucion no es ' + $s.Image + '; no hay ancla de rollback fiable.')
        }
        if ($s.AnchorExists) {
            # An existing anchor is reused ONLY when it is exactly the running image (same digest); anything else is never overwritten.
            if (-not ($s.AnchorDigest -and $s.RunningDigest -and $s.AnchorDigest -eq $s.RunningDigest)) { $reasons += ('La etiqueta ' + $s.Anchor + ' ya existe y NO apunta a la imagen en ejecucion: nunca se sobrescribe.') }
        }
    }
    if ($Options.Contains('UseValidatedImages') -and [bool]$Options['UseValidatedImages']) {
        $im = $Context.ImagesManifest
        $want = [string]$Options['ImagesManifestSha256']
        if (-not $im -or -not $im.Exists) { $reasons += 'Falta el manifiesto de imagenes (-ImagesManifest).' }
        elseif (-not $want) { $reasons += '-UseValidatedImages exige -ImagesManifestSha256 (SHA-256 del manifiesto de imagenes, entregado fuera del repositorio).' }
        elseif ($im.Sha256 -ne $want.ToLower()) { $reasons += ('El SHA-256 del manifiesto de imagenes (' + $im.Sha256 + ') no coincide con -ImagesManifestSha256.') }
        elseif (-not $im.Json -or [string]$im.Json.formato -ne '1' -or -not $im.Json.imagenes) { $reasons += 'El manifiesto de imagenes no es valido.' }
        else {
            if (([string]$im.Json.commit).Length -lt 7 -or -not ([string]$Context.HeadFull).StartsWith(([string]$im.Json.commit))) { $reasons += ('El manifiesto de imagenes es del commit ' + [string]$im.Json.commit + ', no del candidato ' + $Context.HeadShort + '.') }
            foreach ($svc in $script:Services) {
                $entry = @($im.Json.imagenes | Where-Object { [string]$_.servicio -eq $svc }) | Select-Object -First 1
                $local = [string]$Context.ReleaseImageIds[$svc]
                if (-not $entry) { $reasons += ('El manifiesto de imagenes no incluye ' + $svc + '.') }
                elseif (-not $local) { $reasons += ('No existe la imagen local ' + $script:Project + '-' + $svc + ':release-' + $Context.HeadShort + ' (construirla y validarla con New-ReleaseImages.ps1).') }
                elseif ($local -ne [string]$entry.imageId) { $reasons += ('La imagen local de ' + $svc + ' (' + $local + ') no es la validada (' + [string]$entry.imageId + ').') }
            }
        }
    }
    # Manufactura: enabling it is gated by the read-only readiness check; a contradictory configuration never deploys.
    $mf = $(if ($Context.PSObject.Properties.Name -contains 'Manufacturing') { $Context.Manufacturing } else { $null })
    if ($mf) {
        $mEnabled = [string]$mf.Enabled; $mEmission = [string]$mf.Emission
        if (-not ($mEnabled -ceq '' -or $mEnabled -ceq 'true' -or $mEnabled -ceq 'false')) { $reasons += 'Configuracion de Manufactura invalida: MANUFACTURING_ENABLED debe ser vacia, true o false (la API no arrancaria).' }
        if (-not ($mEmission -ceq '' -or $mEmission -ceq 'PRODUCCION')) { $reasons += 'Configuracion de Manufactura contradictoria: MANUFACTURING_EMISSION_ENV solo puede ser vacia o PRODUCCION con la base de produccion.' }
        if ($mEnabled -ceq 'true') {
            if ($mEmission -cne 'PRODUCCION') { $reasons += 'Configuracion de Manufactura contradictoria: MANUFACTURING_ENABLED=true exige MANUFACTURING_EMISSION_ENV=PRODUCCION.' }
            $re = $(if ($Context.PSObject.Properties.Name -contains 'ReadinessEvidence') { $Context.ReadinessEvidence } else { $null })
            $reMaxAge = if ($Options.Contains('EvidenceMaxAgeHours')) { [double]$Options['EvidenceMaxAgeHours'] } else { 6 }
            if (-not $re -or -not $re.Exists) { $reasons += 'La configuracion HABILITA Manufactura: falta la evidencia de Test-ManufacturaReleaseReadiness.ps1 -Phase PreEnable (-ManufacturingReadinessEvidence).' }
            elseif ($re.AgeHours -gt $reMaxAge) { $reasons += ('La evidencia de readiness de Manufactura tiene ' + [math]::Round($re.AgeHours, 1) + ' h (maximo ' + $reMaxAge + ' h).') }
            elseif (-not ([string]$re.Text).Contains('MANUFACTURA_READINESS_PASS phase=PreEnable') -or ([string]$re.Text).Contains('MANUFACTURA_READINESS_FAIL')) { $reasons += 'La evidencia de readiness de Manufactura no dice MANUFACTURA_READINESS_PASS phase=PreEnable: NO habilitar.' }
        }
    }
    if (@($Context.MigrationFiles).Count -gt 0) {
        $ackMigrations = ($Options.Contains('AckMigrations') -and [bool]$Options['AckMigrations'])
        if (-not $ackMigrations) {
            $reasons += 'El release incluye migraciones: este script no las aplica; seguir el checklist manual, o confirmar que ya estan aplicadas con -AcknowledgeMigrationsAlreadyApplied (con -ExpectedMigrations, -MigrationsEvidence y -EvidenceMarkers).'
        } else {
            $expected = @($Options['ExpectedMigrations'] | Where-Object { $_ })
            $markers = @($Options['EvidenceMarkers'] | Where-Object { $_ })
            if ($expected.Count -eq 0) { $reasons += '-AcknowledgeMigrationsAlreadyApplied exige -ExpectedMigrations (prefijos de nombre permitidos).' }
            elseif ($Options.Contains('DatabaseManifest') -and $Options['DatabaseManifest']) { $reasons += @(Test-DatabaseManifest $Context $Options $expected $migrationPrefix) }
            else {
                $unexpected = @($Context.MigrationFiles | Where-Object { $file = $_; -not ($file.StartsWith($migrationPrefix) -and @($expected | Where-Object { $file.Substring($migrationPrefix.Length).StartsWith($_) }).Count -gt 0) })
                if ($unexpected.Count -gt 0) { $reasons += ('Archivos de database/ no esperados en el release (' + $unexpected.Count + '): ' + (($unexpected | Select-Object -First 3) -join ', ')) }
            }
            if ($markers.Count -eq 0) { $reasons += '-AcknowledgeMigrationsAlreadyApplied exige -EvidenceMarkers (textos que deben figurar en la evidencia).' }
            $evidence = $Context.Evidence
            $maxAge = if ($Options.Contains('EvidenceMaxAgeHours')) { [double]$Options['EvidenceMaxAgeHours'] } else { 6 }
            if (-not $evidence -or -not $evidence.Exists) { $reasons += 'Falta el archivo de evidencia de migraciones (-MigrationsEvidence).' }
            else {
                if ($evidence.AgeHours -gt $maxAge) { $reasons += ('La evidencia de migraciones tiene ' + [math]::Round($evidence.AgeHours, 1) + ' h (maximo ' + $maxAge + ' h).') }
                foreach ($m in $markers) { if (-not ([string]$evidence.Text).Contains($m)) { $reasons += ('La evidencia de migraciones no contiene "' + $m + '".') } }
            }
        }
    }
    if (@($Context.N8nFiles).Count -gt 0) {
        if (-not $AcknowledgeN8n) { $reasons += 'El release incluye cambios de n8n: este script no los aplica; seguir el checklist manual, o confirmar que ya estan aplicados y verificados en PROD con -AcknowledgeN8nAlreadyApplied.' }
        else {
            $allowedN8n = @($Options['ExpectedN8nPaths'] | Where-Object { $_ })
            if ($allowedN8n.Count -gt 0) {
                $outside = @($Context.N8nFiles | Where-Object { $file = $_; @($allowedN8n | Where-Object { $file.StartsWith($_) }).Count -eq 0 })
                if ($outside.Count -gt 0) { $reasons += ('Archivos de n8n/ fuera de -ExpectedN8nPaths (' + $outside.Count + '): ' + (($outside | Select-Object -First 3) -join ', ')) }
            }
        }
    }
    return $reasons
}

# ================================================================== Plan (pure)
function Get-RollbackProcedure {
    param([string]$PreviousCommit)
    return @(
        ('1. Comprobar que existen daubert-hub-api:rollback-' + $PreviousCommit + ' y daubert-hub-web:rollback-' + $PreviousCommit + '.'),
        '2. Conservar la imagen nueva: etiquetar daubert-hub-<svc>:latest como daubert-hub-<svc>:failed-<commit nuevo> (sin sobrescribir).',
        '3. Devolver las etiquetas: daubert-hub-<svc>:rollback-<commit anterior> pasa a daubert-hub-<svc>:latest.',
        ('4. docker compose ' + ((Get-ComposeBaseArgs) -join ' ') + ' up -d --no-build api web'),
        '5. Verificar /api/health: commit anterior, status ok, database connected.',
        'Detalle y comandos: docs/operations/deployment-checklist.md (seccion ROLLBACK). Solo se recrean api y web.'
    )
}

function New-DeployPlan {
    param($Context)
    $validated = ($script:Options.Contains('UseValidatedImages') -and [bool]$script:Options['UseValidatedImages'])
    $composeArgs = @('compose') + (Get-ComposeBaseArgs) + @('up', '-d', $(if ($validated) { '--no-build' } else { '--build' })) + $script:Services
    $promote = @()
    if ($validated) { foreach ($svc in $script:Services) { $promote += [pscustomobject]@{ Service = $svc; Source = ($script:Project + '-' + $svc + ':release-' + $Context.HeadShort); Target = ($script:Project + '-' + $svc + ':latest') } } }
    $anchors = @()
    foreach ($svc in $script:Services) {
        $s = $Context.Services[$svc]
        # Reuse = the anchor already exists AND (validated by Test-DeployGate) points at exactly the running image; it is then verified, never re-tagged.
        $anchors += [pscustomobject]@{ Service = $svc; Source = $s.Image; Anchor = $s.Anchor; Digest = $s.RunningDigest; Reuse = [bool]$s.AnchorExists }
    }
    return [pscustomobject]@{
        Services      = @($script:Services)
        PreviousCommit = $Context.PreviousCommit
        NewCommit     = $Context.HeadShort
        AppVersion    = $Context.AppVersion
        Anchors       = $anchors
        EnvVariables  = [ordered]@{ APP_VERSION = $Context.AppVersion; GIT_COMMIT = $Context.HeadShort }
        ComposeArgs   = $composeArgs
        Promote       = $promote
        Changes       = @($Context.HubDockerFiles)
        PostChecks    = @(
            'api healthy (docker inspect, espera hasta el limite)',
            'web responde en el puerto del Hub',
            ('GET ' + $Context.HealthUrl + ': status=ok, database=connected, environment=PRODUCTION, commit=' + $Context.HeadShort + ', version=' + $Context.AppVersion),
            'docker compose ps (solo lectura): api y web en ejecucion'
        )
        Rollback      = (Get-RollbackProcedure $Context.PreviousCommit)
    }
}

function Show-DeployPlan {
    param($Plan, [string]$Title)
    Write-Safe ''
    Write-Safe ('=== ' + $Title + ' ===')
    Write-Safe ('Commit actual en PROD : ' + $Plan.PreviousCommit)
    Write-Safe ('Commit a desplegar    : ' + $Plan.NewCommit + ' (== HEAD)')
    Write-Safe ('APP_VERSION           : ' + $Plan.AppVersion)
    Write-Safe ('Servicios afectados   : ' + ($Plan.Services -join ', ') + ' (ningun otro; PostgreSQL y n8n no se tocan)')
    Write-Safe 'Cambios de Hub/Docker que se desplegarian:'
    foreach ($f in ($Plan.Changes | Select-Object -First 40)) { Write-Safe ('  ' + $f) }
    if ($Plan.Changes.Count -gt 40) { Write-Safe ('  ... y ' + ($Plan.Changes.Count - 40) + ' mas') }
    Write-Safe 'Preservacion de las imagenes actuales (antes del build; nunca se sobrescribe una etiqueta):'
    foreach ($a in $Plan.Anchors) {
        if ($a.Reuse) { Write-Safe ('  ' + $a.Anchor + ' ya existe y apunta a la imagen en ejecucion (digest ' + $a.Digest + '): se reutiliza, no se vuelve a etiquetar') }
        else { Write-Safe ('  docker tag ' + $a.Source + ' ' + $a.Anchor + '   (digest ' + $a.Digest + ')') }
    }
    if (@($Plan.Promote).Count -gt 0) {
        Write-Safe 'Imagenes VALIDADAS (sin reconstruir; el ID debe coincidir con el manifiesto de imagenes):'
        foreach ($p in $Plan.Promote) { Write-Safe ('  docker tag ' + $p.Source + ' ' + $p.Target) }
    }
    Write-Safe 'Variables de build:'
    foreach ($k in $Plan.EnvVariables.Keys) { Write-Safe ('  ' + $k + '=' + $Plan.EnvVariables[$k]) }
    Write-Safe 'Comando de despliegue:'
    Write-Safe ('  docker ' + ($Plan.ComposeArgs -join ' '))
    Write-Safe 'Checks post-deploy:'
    foreach ($c in $Plan.PostChecks) { Write-Safe ('  - ' + $c) }
    Write-Safe 'Rollback disponible (no automatico):'
    foreach ($r in $Plan.Rollback) { Write-Safe ('  ' + $r) }
}

# ================================================================== Execution and verification
function New-RollbackAnchors {
    # Tags the images that are running NOW. Returns $true only if every anchor exists and
    # points at the expected digest.
    param($Plan)
    foreach ($a in $Plan.Anchors) {
        if ($a.Anchor -cnotmatch '^daubert-hub-(api|web):rollback-[0-9a-f]{7,40}$') { Write-Safe ('Ancla invalida: ' + $a.Anchor); return $false }
        if (Test-ImageExists $a.Anchor) {
            # Only an anchor that is exactly the running image may pre-exist (e.g. created by a previous controlled phase); anything else aborts without overwriting.
            $existing = Get-TagDigest $a.Anchor
            if ($a.Reuse -and $existing -and $existing -eq $a.Digest) { continue }
            Write-Safe ('La etiqueta ' + $a.Anchor + ' ya existe y no es la imagen en ejecucion: se aborta sin sobrescribir.'); return $false
        }
        if ($a.Reuse) { Write-Safe 'Un ancla prevista para reutilizacion desaparecio: se aborta antes del build.'; return $false }
    }
    foreach ($a in $Plan.Anchors) {
        if ($a.Reuse) { Write-Safe ('OK ' + $a.Anchor + ' (existente, mismo digest ' + $a.Digest + ')'); continue }
        $t = Invoke-DeployMutation 'docker' @('tag', $a.Source, $a.Anchor)
        if ($t.Code -ne 0) { Write-Safe ('docker tag fallo para ' + $a.Anchor); return $false }
        if (-not (Test-ImageExists $a.Anchor)) { Write-Safe ('La etiqueta ' + $a.Anchor + ' no existe tras crearla.'); return $false }
        $digest = Get-TagDigest $a.Anchor
        if (-not $digest -or $digest -ne $a.Digest) { Write-Safe ('La etiqueta ' + $a.Anchor + ' no apunta al digest esperado.'); return $false }
        Write-Safe ('OK ' + $a.Anchor + ' -> ' + $digest)
    }
    return $true
}

function Wait-ForDeploy {
    # Polls until api is healthy and web answers, or the timeout elapses.
    param($Context, [int]$TimeoutSeconds)
    $apiOk = $false; $webOk = $false
    $root = $Context.HealthUrl -replace '/api/health$', '/'
    for ($elapsed = 0; $elapsed -le $TimeoutSeconds; $elapsed += 5) {
        if (-not $apiOk) {
            $h = Invoke-DeployRead 'docker' @('inspect', ($script:Project + '-api-1'), '--format', '{{.State.Health.Status}}')
            $apiOk = ($h.Code -eq 0 -and (($h.Out -join '') -eq 'healthy'))
        }
        if (-not $webOk) {
            $w = Invoke-DeployHttp $root
            $webOk = ($w -and $w.Status -eq 200)
        }
        if ($apiOk -and $webOk) { break }
        Start-DeploySleep 5
    }
    return @{ Api = $apiOk; Web = $webOk }
}

function Test-PostDeploy {
    param($Context, $Plan, [int]$TimeoutSeconds)
    $problems = @()
    $wait = Wait-ForDeploy $Context $TimeoutSeconds
    if (-not $wait.Api) { $problems += 'api no llego a healthy dentro del limite.' }
    if (-not $wait.Web) { $problems += 'web no respondio dentro del limite.' }
    $http = Invoke-DeployHttp $Context.HealthUrl
    $health = $null
    if ($http -and $http.Status -eq 200) { try { $health = $http.Content | ConvertFrom-Json } catch { $health = $null } }
    if (-not $health) {
        $problems += '/api/health no respondio con JSON valido.'
    } else {
        $hs = Get-Prop $health 'status'; $hd = Get-Prop $health 'database'; $he = Get-Prop $health 'environment'
        $hc = Get-Prop $health 'commit'; $hv = Get-Prop $health 'version'
        Write-Safe ('health: status=' + $hs + ' database=' + $hd + ' environment=' + $he + ' version=' + $hv + ' commit=' + $hc)
        if ($hs -ne 'ok') { $problems += 'status distinto de ok.' }
        if ($hd -ne 'connected') { $problems += 'database distinta de connected.' }
        if ($he -ne 'PRODUCTION') { $problems += 'environment distinto de PRODUCTION.' }
        if ($hc -ne $Plan.NewCommit) { $problems += ('commit ' + $hc + ' distinto del candidato ' + $Plan.NewCommit + '.') }
        if ($hv -ne $Plan.AppVersion) { $problems += ('version ' + $hv + ' distinta de APP_VERSION ' + $Plan.AppVersion + '.') }
    }
    $ps = Invoke-DeployRead 'docker' (@('compose') + (Get-ComposeBaseArgs) + @('ps'))
    if ($ps.Code -ne 0) { $problems += 'No se pudo completar docker compose ps.' }
    foreach ($line in $ps.Out) { Write-Safe $line }
    foreach ($svc in $script:Services) {
        $st = Invoke-DeployRead 'docker' @('inspect', ($script:Project + '-' + $svc + '-1'), '--format', '{{.State.Status}}')
        if ($st.Code -ne 0 -or (($st.Out -join '') -ne 'running')) { $problems += ($svc + ' no esta en ejecucion.') }
    }
    return $problems
}

function Show-DeployFailure {
    param($Plan, [string[]]$Problems)
    Write-Safe ''
    Write-Safe 'DEPLOYMENT FALLIDO'
    foreach ($p in $Problems) { Write-Safe ('  - ' + $p) }
    Write-Safe 'No se hizo rollback automatico. El estado actual se conserva para su analisis.'
    Write-Safe ''
    Write-Safe 'ROLLBACK DISPONIBLE'
    foreach ($r in $Plan.Rollback) { Write-Safe ('  ' + $r) }
}

function Invoke-DeployPlan {
    # Returns 0 on success, 1 if aborted BEFORE the Compose up, 5 if the deployment failed.
    param($Context, $Plan, [int]$TimeoutSeconds)
    Write-Safe ''
    Write-Safe '--- Preservando las imagenes en ejecucion (anclas de rollback) ---'
    if (-not (New-RollbackAnchors $Plan)) {
        Write-Safe 'Abortado antes del build: no hay anclas de rollback fiables. PROD no cambio.'
        return 1
    }
    $oldVersion = $env:APP_VERSION
    $oldCommit = $env:GIT_COMMIT
    try {
        $env:APP_VERSION = $Plan.EnvVariables['APP_VERSION']
        $env:GIT_COMMIT = $Plan.EnvVariables['GIT_COMMIT']
        if (@($Plan.Promote).Count -gt 0) {
            Write-Safe ''
            Write-Safe '--- Promoviendo las imagenes validadas (sin construir) ---'
            foreach ($p in $Plan.Promote) {
                $tg = Invoke-DeployMutation 'docker' @('tag', $p.Source, $p.Target)
                if ($tg.Code -ne 0) { Write-Safe ('docker tag fallo para ' + $p.Target + '; se aborta antes del arranque. Los contenedores en ejecucion no cambiaron.'); return 1 }
            }
        }
        Write-Safe ''
        Write-Safe '--- Desplegando api y web ---'
        $up = Invoke-DeployMutation 'docker' $Plan.ComposeArgs
    } finally {
        $env:APP_VERSION = $oldVersion
        $env:GIT_COMMIT = $oldCommit
    }
    if ($up.Code -ne 0) {
        Show-DeployFailure $Plan @('docker compose up termino con error (codigo ' + $up.Code + ').')
        return 5
    }
    Write-Safe ''
    Write-Safe '--- Verificacion post-deploy ---'
    $problems = Test-PostDeploy $Context $Plan $TimeoutSeconds
    if (@($problems).Count -gt 0) {
        Show-DeployFailure $Plan $problems
        return 5
    }
    Write-Safe ''
    Write-Safe ('DEPLOYMENT CORRECTO: commit ' + $Plan.NewCommit + ', version ' + $Plan.AppVersion + '. Registre la nota en docs/deployments/.')
    return 0
}

# ================================================================== Modes
function Show-Usage {
    Write-Host 'Uso: Deploy-DaubertHub.ps1 -Preflight | -WhatIf | -Deploy   (modos mutuamente excluyentes)'
    Write-Host '  -Preflight  Ejecuta el preflight de solo lectura y propaga su exit code (0 apto, 1 bloqueado, 2 sin cambios de Hub/Docker).'
    Write-Host '  -WhatIf     Valida y muestra el plan completo sin ejecutar ninguna operacion mutante.'
    Write-Host '  -Deploy     Unico modo que modifica PROD; pide escribir exactamente: DEPLOY DAUBERT HUB.'
    Write-Host 'Opciones: -Candidate <commit> (debe ser HEAD), -HealthTimeoutSeconds <n>.'
    Write-Host '  -RequireSynchronizedMain  Exige SHA completo, main limpia y remoto accesible; revalida despues de confirmar (orquestador supervisado).'
    Write-Host '  -AcknowledgeN8nAlreadyApplied  Reconoce que los archivos n8n/ del release ya estan aplicados y verificados en PROD (no aplica ni toca n8n; no afecta a las migraciones).'
    Write-Host '  -AcknowledgeMigrationsAlreadyApplied  Reconoce que las migraciones de database/ ya se aplicaron a mano; exige -ExpectedMigrations <prefijos>, -MigrationsEvidence <archivo reciente> y -EvidenceMarkers <textos> (no ejecuta SQL).'
    Write-Host '  -ExpectedN8nPaths <prefijos>          Con -AcknowledgeN8nAlreadyApplied, todo archivo n8n/ del release debe empezar por uno de estos prefijos.'
    Write-Host 'Sin modo no se hace nada. Detalle: docs/operations/deployment-checklist.md'
}

function Invoke-Preflight {
    # Runs the existing preflight as a child process and returns its exit code.
    param([string]$Candidate)
    $r = Invoke-DeployRead 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script:PreflightPath, '-Candidate', $Candidate)
    foreach ($line in $r.Out) { Write-Safe $line }
    return $r.Code
}

function Invoke-DeployMain {
    param([bool]$DoPreflight, [bool]$DoWhatIf, [bool]$DoDeploy, [string]$Candidate, [int]$TimeoutSeconds, [bool]$AcknowledgeN8n = $false, $Options = @{})

    $script:Options = $Options
    $selected = @(@($DoPreflight, $DoWhatIf, $DoDeploy) | Where-Object { $_ })
    if ($selected.Count -eq 0) { Show-Usage; return 0 }
    if ($selected.Count -gt 1) {
        Write-Host 'Error: -Preflight, -WhatIf y -Deploy son mutuamente excluyentes. No se hizo nada.'
        return 3
    }
    $script:Mode = $(if ($DoPreflight) { 'Preflight' } elseif ($DoWhatIf) { 'WhatIf' } else { 'Deploy' })

    $strict = ($Options.Contains('RequireSynchronizedMain') -and [bool]$Options['RequireSynchronizedMain'])
    if ($strict -and -not (Test-DeploySynchronizedMain $Candidate)) {
        Write-Safe 'BLOQUEADO: se exige main limpia y candidato == HEAD == origin/main == main remoto accesible.'
        return 1
    }

    $pf = Invoke-Preflight $Candidate
    if ($script:Mode -eq 'Preflight') { return $pf }

    if ($pf -eq 2) {
        Write-Safe ''
        Write-Safe 'SIN CAMBIOS DE HUB/DOCKER - NO HAY NADA QUE DESPLEGAR'
        Write-Safe 'No se desplego nada ni se reinicio PROD.'
        return 2
    }
    if ($pf -ne 0) {
        Write-Safe ''
        Write-Safe ('PREFLIGHT BLOQUEADO (exit ' + $pf + '): no se continua. PROD no cambio.')
        return 1
    }

    $ctx = Get-DeployContext $Candidate
    if (@($ctx.HubDockerFiles).Count -eq 0 -and $ctx.DeltaKnown) {
        Write-Safe ''
        Write-Safe 'SIN CAMBIOS DE HUB/DOCKER - NO HAY NADA QUE DESPLEGAR'
        return 2
    }
    $reasons = @(Test-DeployGate $ctx $AcknowledgeN8n $Options)
    if ($reasons.Count -gt 0) {
        Write-Safe ''
        Write-Safe 'DEPLOYMENT BLOQUEADO. PROD no cambio:'
        foreach ($r in $reasons) { Write-Safe ('  - ' + $r) }
        return 1
    }
    if ($AcknowledgeN8n -and @($ctx.N8nFiles).Count -gt 0) {
        Write-Safe ''
        Write-Safe ('ADVERTENCIA: el release incluye ' + @($ctx.N8nFiles).Count + ' archivo(s) bajo n8n/. Se reconocen (-AcknowledgeN8nAlreadyApplied) como YA APLICADOS y VERIFICADOS en PROD.')
        Write-Safe 'Este script NO importa, activa, desactiva ni modifica workflows de n8n; solo despliega api y web.'
    }
    if (@($ctx.MigrationFiles).Count -gt 0) {
        Write-Safe ''
        Write-Safe ('ADVERTENCIA: el release incluye ' + @($ctx.MigrationFiles).Count + ' archivo(s) bajo database/. Se reconocen (-AcknowledgeMigrationsAlreadyApplied) como YA APLICADOS a mano, con evidencia reciente que contiene: ' + (@($Options['EvidenceMarkers']) -join ', ') + '.')
        Write-Safe 'Este script NO ejecuta SQL ni migraciones; solo despliega api y web.'
    }

    $plan = New-DeployPlan $ctx
    if ($script:Mode -eq 'WhatIf') {
        Show-DeployPlan $plan 'PLAN (WhatIf: no se ejecuto ninguna operacion mutante)'
        return 0
    }

    Show-DeployPlan $plan 'PLAN DE DEPLOYMENT'
    Write-Safe ''
    $answer = Read-DeployConfirmation
    if ($answer -cne $script:ConfirmationPhrase) {
        Write-Safe 'Confirmacion incorrecta: deployment cancelado. PROD no cambio.'
        return 1
    }
    try {
        if ($strict) {
            $fresh = Get-DeployContext $Candidate
            $reasons = @(Test-DeployGate $fresh $AcknowledgeN8n $Options)
            if ($reasons.Count -gt 0 -or -not $fresh.DeltaKnown -or @($fresh.HubDockerFiles).Count -eq 0 -or $fresh.PreviousCommit -ne $ctx.PreviousCommit -or
                -not (Test-DeploySynchronizedMain $Candidate)) {
                Write-Safe 'BLOQUEADO: la revalidacion posterior a la confirmacion fallo; no se inicia el deployment.'
                return 1
            }
            $ctx = $fresh
            $plan = New-DeployPlan $ctx
        }
        return (Invoke-DeployPlan $ctx $plan $TimeoutSeconds)
    } catch {
        Show-DeployFailure $plan @('Error inesperado: ' + $_.Exception.Message.Split("`n")[0])
        return 5
    }
}

# Dot-sourcing (tests) only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') {
    Set-Location -LiteralPath $script:RepoRoot
    $options = @{ AckMigrations = [bool]$AcknowledgeMigrationsAlreadyApplied; ExpectedMigrations = @($ExpectedMigrations); MigrationsEvidence = $MigrationsEvidence; EvidenceMarkers = @($EvidenceMarkers)
        EvidenceMaxAgeHours = $EvidenceMaxAgeHours; DatabaseManifest = $DatabaseManifest; DatabaseManifestSha256 = $DatabaseManifestSha256; UseValidatedImages = [bool]$UseValidatedImages; ImagesManifest = $ImagesManifest; ImagesManifestSha256 = $ImagesManifestSha256; ManufacturingReadinessEvidence = $ManufacturingReadinessEvidence; ClosurePolicy = $ClosurePolicy; ClosurePolicySha256 = $ClosurePolicySha256; ExpectedN8nPaths = @($ExpectedN8nPaths); RequireClosedWindow = [bool]$RequireClosedWindow; RequireSynchronizedMain = [bool]$RequireSynchronizedMain }
    exit (Invoke-DeployMain ([bool]$Preflight) ([bool]$WhatIf) ([bool]$Deploy) $Candidate $HealthTimeoutSeconds ([bool]$AcknowledgeN8nAlreadyApplied) $options)
}
