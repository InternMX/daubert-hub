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

.PARAMETER ExpectedN8nPaths
    Optional. With -AcknowledgeN8nAlreadyApplied, every changed n8n/ file must start with one of these path prefixes; anything else still blocks.

.PARAMETER RequireClosedWindow
    The approved entry-closure override (deploy/closure/entry-closure-override.yaml) is ALWAYS part of every Compose invocation of this script, so Web never starts without the
    externally mounted conf.d. With this switch -Deploy also requires that the mounted default.conf is the CLOSED policy (byte for byte deploy/closure/entry-closure-policy.conf);
    use it for the joint Pagos + Caterpillar window.

.PARAMETER HealthTimeoutSeconds
    How long -Deploy waits for api to become healthy and web to answer. Default: 180.

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
    [string]$MigrationsEvidence = '',
    [string[]]$EvidenceMarkers = @(),
    [int]$EvidenceMaxAgeHours = 6,
    [string[]]$ExpectedN8nPaths = @(),
    [switch]$RequireClosedWindow
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
    if ($CmdArgs.Count -eq 3 -and $CmdArgs[0] -eq 'tag') {
        $src = [regex]::Match($CmdArgs[1], '^daubert-hub-(api|web):latest$')
        $dst = [regex]::Match($CmdArgs[2], '^daubert-hub-(api|web):rollback-[0-9a-f]{7,40}$')
        if ($src.Success -and $dst.Success -and $src.Groups[1].Value -eq $dst.Groups[1].Value) { return $null }
        return 'solo se permite etiquetar daubert-hub-<svc>:latest como daubert-hub-<svc>:rollback-<sha>'
    }
    $expected = @('compose') + (Get-ComposeBaseArgs) + @('up', '-d', '--build') + $script:Services
    if (($CmdArgs -join ' ') -ceq ($expected -join ' ')) { return $null }
    return 'solo se permite el docker compose up -d --build api web definido para PROD'
}

function Invoke-DeployMutation {
    # The ONLY way this script modifies anything. Refuses outside -Deploy and outside the allowlist.
    param([string]$Exe, [string[]]$CmdArgs)
    if ($script:Mode -ne 'Deploy') { throw ('Operacion mutante bloqueada fuera de -Deploy (modo ' + $script:Mode + ')') }
    $refused = Test-AllowedMutation $Exe $CmdArgs
    if ($refused) { throw ('Operacion mutante rechazada: ' + $refused) }
    Write-Safe ('> ' + $Exe + ' ' + ($CmdArgs -join ' '))
    $out = & $Exe @CmdArgs
    $code = $LASTEXITCODE
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
    $confSha = ''; $policySha = ''
    if (Test-Path -LiteralPath $conf) { $confSha = (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash.ToLower() }
    if (Test-Path -LiteralPath $policy) { $policySha = (Get-FileHash -LiteralPath $policy -Algorithm SHA256).Hash.ToLower() }
    return @{ ConfExists = [bool]$confSha; ConfSha = $confSha; PolicySha = $policySha }
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

    return [pscustomobject]@{
        CandidateInput = $Candidate
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
        N8nFiles       = $n8n
        Evidence       = $evidence
        Closure        = (Get-ClosureState)
        ComposeImages  = @($images.Out)
        Services       = $services
    }
}

# ================================================================== Validation
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
    if ($Options.Contains('RequireClosedWindow') -and $Options['RequireClosedWindow'] -and (-not $Context.Closure.PolicySha -or $Context.Closure.ConfSha -ne $Context.Closure.PolicySha)) { $reasons += 'La ventana exige el cierre ACTIVO: default.conf externo no es la politica cerrada versionada (ejecute Set-EntryClosure.ps1 -Action Close).' }
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
    if (@($Context.MigrationFiles).Count -gt 0) {
        $ackMigrations = ($Options.Contains('AckMigrations') -and [bool]$Options['AckMigrations'])
        if (-not $ackMigrations) {
            $reasons += 'El release incluye migraciones: este script no las aplica; seguir el checklist manual, o confirmar que ya estan aplicadas con -AcknowledgeMigrationsAlreadyApplied (con -ExpectedMigrations, -MigrationsEvidence y -EvidenceMarkers).'
        } else {
            $expected = @($Options['ExpectedMigrations'] | Where-Object { $_ })
            $markers = @($Options['EvidenceMarkers'] | Where-Object { $_ })
            if ($expected.Count -eq 0) { $reasons += '-AcknowledgeMigrationsAlreadyApplied exige -ExpectedMigrations (prefijos de nombre permitidos).' }
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
    $composeArgs = @('compose') + (Get-ComposeBaseArgs) + @('up', '-d', '--build') + $script:Services
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
        EvidenceMaxAgeHours = $EvidenceMaxAgeHours; ExpectedN8nPaths = @($ExpectedN8nPaths); RequireClosedWindow = [bool]$RequireClosedWindow }
    exit (Invoke-DeployMain ([bool]$Preflight) ([bool]$WhatIf) ([bool]$Deploy) $Candidate $HealthTimeoutSeconds ([bool]$AcknowledgeN8nAlreadyApplied) $options)
}
