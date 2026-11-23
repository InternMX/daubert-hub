<#
.SYNOPSIS
    Supervised enable / disable of Manufactura in PROD by publishing or withdrawing the activation overlay and recreating ONLY the api container
    (same commit, same images). Windows PowerShell 5.1. Without -Apply it only validates and prints the plan.

.DESCRIPTION
    This is a supervised transition with compensation, not an atomic operation. Only the overlay rename is atomic (same NTFS volume).
    -Enable gate (any reason blocks before touching anything): operation lock; clean session (no MANUFACTURING_*, VITE_*, COMPOSE_*, DOCKER_HOST/CONTEXT);
      HEAD == running commit (health) and clean tree; running api/web images == release-<HEAD> tags (same digest relation Deploy-DaubertHub.ps1 uses);
      default.conf == the authorised Manufactura closure policy (window closed); base env file never enables (false/empty allowed) and DB_NAME=daubert_global;
      prepared overlay canonical with the authorised SHA-256; no active overlay; api container effectively OFF; readiness evidence
      MANUFACTURA_READINESS_PASS phase=PreEnable perfil=completo-v1, all groups, fallos=0, commit = running commit, at most -EvidenceMaxAgeHours old;
      confirmation phrase HABILITAR MANUFACTURA. Facts are re-read right before mutating.
    Mutations (only with -Apply): publish overlay -> `docker compose ... --env-file <overlay> up -d --no-build --no-deps api` -> postcheck
      (api healthy, same commit, api effectively ON, same api image, web container not recreated).
    Failure after publishing: automatic compensation to OFF (withdraw overlay, recreate api without it, verify OFF) -> exit 5. Compensation failure -> exit 6.
    -Disable: lock + clean session, withdraw overlay, recreate api without it, verify OFF (no evidence required; it is the rollback).
    After either: run Set-EntryClosure.ps1 -Action Reload -ExpectState Closed (nginx resolves the new api container).
    LIMITS: the lock only excludes cooperating scripts on this host; manual docker/compose commands, Docker Desktop restarts and other users are not prevented,
    only detected by the re-reads. The script never prints secrets and never edits deploy/pilot.prod.env.
    Exit codes: 0 ok | 1 blocked (nothing changed) | 3 usage | 5 failed and compensated (OFF verified) | 6 indeterminate (go to image rollback R2).
#>
[CmdletBinding()]
param(
    [switch]$Enable,
    [switch]$Disable,
    [switch]$Apply,
    [string]$OverlaySha256 = '',
    [string]$ReadinessEvidence = '',
    [string]$ImagesManifest = '',
    [string]$ImagesManifestSha256 = '',
    [string]$ClosurePolicySha256 = '',
    [double]$EvidenceMaxAgeHours = 2,
    [int]$HealthTimeoutSeconds = 180,
    [string]$Root = 'C:\Users\06\AppData\Local\DaubertHub'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:Project = 'daubert-hub'
$script:EnvFile = 'deploy/pilot.prod.env'
$script:ComposeFiles = @('compose.pilot.yaml', 'compose.prod-temp.yaml', 'deploy/closure/entry-closure-override.yaml')
$script:ClosureConf = 'C:\Users\06\AppData\Local\DaubertHub\maintenance-window\nginx-conf.d\default.conf'
$script:Phrase = 'HABILITAR MANUFACTURA'
$script:Groups = 'bd,respaldo,configuracion,migraciones,salud,imagenes,nginx,cierre'
Import-Module (Join-Path $PSScriptRoot 'DaubertOps.Common.psm1') -Force

# ------------------------------------------------------------------ Seams (mocked in the tests)
function Invoke-SwitchRead {
    param([string]$Exe, [string[]]$CmdArgs)
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $Exe @CmdArgs 2>$null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Out = @(@($out) | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ }) }
}
function Invoke-SwitchCompose {
    # The ONLY mutations besides the overlay files: recreate api (`up -d --no-build --no-deps api`) or, as a last resort, stop it (`stop api`).
    # Runs in a sanitized environment. -ForceOff exports MANUFACTURING_ENABLED=false and an empty MANUFACTURING_EMISSION_ENV to the child process: the shell
    # environment has precedence over --env-file in Compose, so OFF holds even if the base file drifted (ENABLED=false + EMISSION_ENV=PRODUCCION: valid OFF for daubert_global).
    # Raw Compose output is NOT printed (a malformed dotenv line could echo a credential); only the command and its exit code are.
    param([bool]$WithOverlay, [string]$OverlayPath, [bool]$ForceOff = $false, [ValidateSet('up', 'stop')][string]$Verb = 'up')
    $args_ = @('compose', '--project-name', $script:Project, '--env-file', $script:EnvFile)
    if ($WithOverlay) { $args_ += @('--env-file', $OverlayPath) }
    foreach ($f in $script:ComposeFiles) { $args_ += @('-f', $f) }
    if ($Verb -eq 'up') { $args_ += @('up', '-d', '--no-build', '--no-deps', 'api') } else { $args_ += @('stop', 'api') }
    Write-Host ('> docker ' + ($args_ -join ' ') + $(if ($ForceOff) { '   [MANUFACTURING_ENABLED=false forzado]' } else { '' }))
    $code = Invoke-DaubertWithSanitizedEnvironment {
        $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        if ($ForceOff) { [Environment]::SetEnvironmentVariable('MANUFACTURING_ENABLED', 'false', 'Process'); [Environment]::SetEnvironmentVariable('MANUFACTURING_EMISSION_ENV', 'PRODUCCION', 'Process') }
        try { Push-Location $script:RepoRoot; $null = & docker @args_ 2>&1; $LASTEXITCODE }
        finally {
            Pop-Location; $ErrorActionPreference = $previous
            if ($ForceOff) { [Environment]::SetEnvironmentVariable('MANUFACTURING_ENABLED', $null, 'Process'); [Environment]::SetEnvironmentVariable('MANUFACTURING_EMISSION_ENV', $null, 'Process') }
        }
    }
    $exit = [int](@($code)[-1])
    Write-Host ('  exit=' + $exit)
    return $exit
}
function Invoke-SwitchClosureProbe {
    # Live check that nginx IS blocking Manufactura writes (not only that the file on disk is the closed policy): an unauthenticated POST must get 503 with
    # X-Hub-Window: closed-v1. With the window open the same request reaches the API and is refused there (401/403), so nothing is ever written.
    param([string]$Port)
    try {
        $r = Invoke-WebRequest -Uri ('http://localhost:' + $Port + '/api/manufacturing-sheets/documents/drafts') -Method Post -Body '{}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5
        return [pscustomobject]@{ Code = [int]$r.StatusCode; Closed = $false }
    } catch {
        $resp = $null; if ($_.Exception.PSObject.Properties.Name -contains 'Response') { $resp = $_.Exception.Response }
        if ($null -eq $resp) { return [pscustomobject]@{ Code = 0; Closed = $false } }
        $code = [int]$resp.StatusCode
        $hdr = [string]$resp.Headers['X-Hub-Window']
        return [pscustomobject]@{ Code = $code; Closed = ($code -eq 503 -and $hdr -eq 'closed-v1') }
    }
}
function Get-SwitchProp { param($Object, [string]$Name) if ($null -eq $Object) { return '' }; if (@($Object.PSObject.Properties.Name) -contains $Name) { return [string]$Object.$Name }; return '' }
function Read-SwitchText { param([string]$Path) if (-not (Test-Path -LiteralPath $Path)) { return $null }; return [System.IO.File]::ReadAllText($Path) }
function Get-SwitchFileAgeHours { param([string]$Path) return ((Get-Date) - (Get-Item -LiteralPath $Path).LastWriteTime).TotalHours }
function Get-SwitchFileSha { param([string]$Path) if (-not (Test-Path -LiteralPath $Path)) { return '' }; return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower() }
function Invoke-SwitchHealth {
    param([string]$Url)
    try { return ((Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json) } catch { return $null }
}
function Read-SwitchManifest {
    # Same reading as Deploy-DaubertHub.ps1 Read-DeployManifest: SHA-256 of the text with LF line endings, plus the parsed JSON. Mocked in the tests.
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return [pscustomobject]@{ Exists = $false; Sha256 = ''; Json = $null } }
    $text = (Get-Content -LiteralPath $Path -Raw -Encoding UTF8) -replace "`r`n", "`n"
    $sha = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))).Replace('-', '').ToLower()
    $json = $null; try { $json = $text | ConvertFrom-Json } catch { $json = $null }
    return [pscustomobject]@{ Exists = $true; Sha256 = $sha; Json = $json }
}
function Read-SwitchConfirmation { return (Read-Host ('Para continuar escriba exactamente: ' + $script:Phrase)) }
function Start-SwitchSleep { param([int]$Seconds) Start-Sleep -Seconds $Seconds }

# ------------------------------------------------------------------ Facts
function Get-SwitchHubPort {
    $text = Read-SwitchText (Join-Path $script:RepoRoot $script:EnvFile)
    if ($text -and $text -match '(?m)^\s*HUB_PORT\s*=\s*(\d+)\s*$') { return $Matches[1] }
    return '8082'
}
function Get-SwitchContainerFacts {
    param([string]$Service)
    $c = $script:Project + '-' + $Service + '-1'
    $d = Invoke-SwitchRead 'docker' @('inspect', $c, '--format', '{{if .ImageManifestDescriptor}}{{.ImageManifestDescriptor.digest}}{{end}}|{{.Id}}|{{.State.StartedAt}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')
    $parts = $(if ($d.Code -eq 0 -and $d.Out.Count -gt 0) { ($d.Out -join '').Split('|') } else { @('', '', '', '') })
    return [pscustomobject]@{ Digest = $parts[0]; ContainerId = $parts[1]; StartedAt = $parts[2]; Health = $parts[3] }
}
function Get-SwitchContext {
    param($Paths)
    $git = @('--no-optional-locks')
    $head = Invoke-SwitchRead 'git' ($git + @('-C', $script:RepoRoot, 'rev-parse', '--short=7', 'HEAD'))
    $dirty = Invoke-SwitchRead 'git' ($git + @('-C', $script:RepoRoot, 'status', '--porcelain'))
    $short = $(if ($head.Code -eq 0 -and $head.Out.Count -gt 0) { $head.Out[0] } else { '' })
    $health = Invoke-SwitchHealth ('http://localhost:' + (Get-SwitchHubPort) + '/api/health')
    $tags = @{}; $latest = @{}; $releaseIds = @{}
    foreach ($svc in 'api', 'web') {
        $q = Invoke-SwitchRead 'docker' @('image', 'inspect', ($script:Project + '-' + $svc + ':release-' + $short), '--platform', 'linux/amd64', '--format', '{{.Id}}')
        $tags[$svc] = $(if ($q.Code -eq 0 -and $q.Out.Count -gt 0) { $q.Out[0] } else { '' })
        $ri = Invoke-SwitchRead 'docker' @('image', 'inspect', ($script:Project + '-' + $svc + ':release-' + $short), '--format', '{{.Id}}')
        $releaseIds[$svc] = $(if ($ri.Code -eq 0 -and $ri.Out.Count -gt 0) { $ri.Out[0] } else { '' })
        # Compose resolves the service image as <project>-<svc>:latest: it must be the same validated image, or `up` would start a different one.
        $l = Invoke-SwitchRead 'docker' @('image', 'inspect', ($script:Project + '-' + $svc + ':latest'), '--platform', 'linux/amd64', '--format', '{{.Id}}')
        $latest[$svc] = $(if ($l.Code -eq 0 -and $l.Out.Count -gt 0) { $l.Out[0] } else { '' })
    }
    $baseText = Read-SwitchText (Join-Path $script:RepoRoot $script:EnvFile)
    $base = $(if ($null -eq $baseText) { $null } else { Get-DaubertEffectiveManufacturing $baseText })
    return [pscustomobject]@{
        HeadShort = $short; Dirty = @($dirty.Out); Health = $health
        Api = (Get-SwitchContainerFacts 'api'); Web = (Get-SwitchContainerFacts 'web'); ReleaseTags = $tags; LatestTags = $latest; ReleaseIds = $releaseIds
        ClosureProbe = (Invoke-SwitchClosureProbe (Get-SwitchHubPort))
        ApiEstado = (ConvertFrom-DaubertContainerEnv (Get-DaubertContainerEnvJson ($script:Project + '-api-1'))).Estado
        Base = $base; Overlay = (Get-DaubertOverlayState -Paths $Paths)
        ClosureSha = (Get-SwitchFileSha $script:ClosureConf)
        ManufacturaPolicySha = (Get-SwitchFileSha (Join-Path $script:RepoRoot 'deploy\closure\entry-closure-policy.manufactura.conf'))
        Hazards = @(Get-DaubertSessionHazards)
    }
}

# ------------------------------------------------------------------ Gates (pure)
function Test-SwitchEvidence {
    # Same contract Deploy-DaubertHub.ps1 accepts (completo-v1): exactly one PASS line, phase PreEnable, every group, fallos=0, running commit, recent.
    param($Text, [double]$AgeHours, [double]$MaxAgeHours, [string]$RunningCommit, [datetime]$NowUtc)
    if ($null -eq $Text) { return @('Falta la evidencia de readiness PreEnable (-ReadinessEvidence).') }
    if ($AgeHours -gt $MaxAgeHours) { return @('La evidencia de readiness tiene ' + [math]::Round($AgeHours, 2) + ' h (maximo ' + $MaxAgeHours + ' h).') }
    $lines = @((([string]$Text).TrimStart([char]0xFEFF)) -split "`r?`n" | Where-Object { $_.Trim() })
    if ($lines.Count -ne 1) { return @('La evidencia debe contener exactamente una linea de veredicto.') }
    $m = [regex]::Match([string]$lines[0], '\AMANUFACTURA_READINESS_(?<v>[A-Z]+) phase=(?<ph>\S+) perfil=(?<pf>\S+) controles=(?<n>\d{1,4}) fallos=(?<f>\d{1,4}) grupos=(?<g>\S+) commit=(?<c>\S+) faltan=(?<x>\S+) (?<ts>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)\z')
    if (-not $m.Success) { return @('Evidencia con formato no reconocido.') }
    $r = @()
    if ($m.Groups['v'].Value -cne 'PASS' -or $m.Groups['ph'].Value -cne 'PreEnable' -or $m.Groups['pf'].Value -cne 'completo-v1') { $r += 'La evidencia no es MANUFACTURA_READINESS_PASS phase=PreEnable perfil=completo-v1.' }
    if ($m.Groups['f'].Value -cne '0' -or [int]$m.Groups['n'].Value -lt 1 -or $m.Groups['g'].Value -cne $script:Groups -or $m.Groups['x'].Value -cne '-') { $r += 'La evidencia no es un perfil completo sin fallos.' }
    if (-not $RunningCommit -or $m.Groups['c'].Value -cne $RunningCommit.ToLower()) { $r += ('La evidencia es del commit ' + $m.Groups['c'].Value + ', no del que corre en PROD (' + $RunningCommit + ').') }
    $ts = [datetime]::MinValue
    $ok = [datetime]::TryParseExact($m.Groups['ts'].Value, "yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture, ([System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal), [ref]$ts)
    if (-not $ok -or $ts -gt $NowUtc.AddMinutes(5) -or ($NowUtc - $ts).TotalHours -gt $MaxAgeHours) { $r += 'La fecha interna de la evidencia es invalida, futura o antigua.' }
    return $r
}

function Test-SwitchManifest {
    # The images validated by readiness ARE the ones running: authorised manifest (SHA), same commit, UI compiled, and each release tag still has the manifest imageId
    # (with Test-SwitchCommonGate: running digest = release tag = :latest). Moving release and :latest tags together to other images is therefore refused.
    param($Manifest, [string]$WantSha, $Ctx)
    if (-not $WantSha) { return @('-ImagesManifestSha256 (SHA-256 autorizado del manifiesto de imagenes) es obligatorio.') }
    if ($null -eq $Manifest -or -not $Manifest.Exists) { return @('Falta el manifiesto de imagenes (-ImagesManifest).') }
    if ($Manifest.Sha256 -ne $WantSha.ToLower()) { return @('El SHA-256 del manifiesto de imagenes no es el autorizado.') }
    $j = $Manifest.Json
    if ($null -eq $j -or [string](Get-SwitchProp $j 'formato') -ne '1') { return @('El manifiesto de imagenes no es valido.') }
    $r = @()
    if (-not $Ctx.HeadShort -or -not ([string](Get-SwitchProp $j 'commit')).StartsWith($Ctx.HeadShort)) { $r += 'El manifiesto de imagenes no es del commit en ejecucion.' }
    if (-not (@($j.PSObject.Properties.Name) -contains 'interfazManufacturaCompilada') -or $j.interfazManufacturaCompilada -isnot [bool] -or -not $j.interfazManufacturaCompilada) { $r += 'El manifiesto no declara la interfaz de Manufactura compilada (true).' }
    foreach ($svc in 'api', 'web') {
        $e = @(@($j.imagenes) | Where-Object { $null -ne $_ -and [string](Get-SwitchProp $_ 'servicio') -eq $svc })
        if ($e.Count -ne 1 -or -not [string](Get-SwitchProp $e[0] 'imageId')) { $r += ('El manifiesto no tiene exactamente una imagen ' + $svc + '.'); continue }
        if ([string]$Ctx.ReleaseIds[$svc] -ne [string]$e[0].imageId) { $r += ($svc + ': la etiqueta release-' + $Ctx.HeadShort + ' ya no es la imagen validada del manifiesto.') }
    }
    return $r
}

function Test-SwitchCommonGate {
    param($Ctx)
    $r = @()
    if (@($Ctx.Hazards).Count -gt 0) { $r += ('La sesion define variables que alteran Compose/Docker: ' + (@($Ctx.Hazards) -join ', ') + '. Abra una sesion limpia.') }
    if ($Ctx.HeadShort -cnotmatch '^[0-9a-f]{7}$') { $r += 'No se pudo leer el commit de HEAD.' }
    if (@($Ctx.Dirty).Count -gt 0) { $r += 'El arbol de trabajo no esta limpio.' }
    $h = $Ctx.Health
    if ($null -eq $h) { $r += 'No responde /api/health.' }
    else {
        if ((Get-SwitchProp $h 'status') -ne 'ok' -or (Get-SwitchProp $h 'database') -ne 'connected' -or (Get-SwitchProp $h 'environment') -ne 'PRODUCTION') { $r += 'PROD no esta sano (status/database/environment).' }
        if ((Get-SwitchProp $h 'commit') -cne $Ctx.HeadShort) { $r += ('El commit en ejecucion (' + [string]$h.commit + ') no es HEAD (' + $Ctx.HeadShort + ').') }
    }
    foreach ($svc in 'api', 'web') {
        $run = $(if ($svc -eq 'api') { $Ctx.Api.Digest } else { $Ctx.Web.Digest })
        if (-not $run -or -not $Ctx.ReleaseTags[$svc] -or $run -ne $Ctx.ReleaseTags[$svc] -or $Ctx.LatestTags[$svc] -ne $run) { $r += ($svc + ': la imagen en ejecucion no es daubert-hub-' + $svc + ':release-' + $Ctx.HeadShort + ' o :latest apunta a otra imagen.') }
    }
    if ($null -eq $Ctx.Base) { $r += 'No se pudo leer deploy/pilot.prod.env.' }
    else {
        $baseErr = @($Ctx.Base.Errores | Where-Object { $_ -like 'BASE_*' })
        if ($baseErr.Count -gt 0) { $r += ('El archivo base no es valido o habilita Manufactura: ' + ($baseErr -join ', ') + ' (solo false o vacio).') }
    }
    return $r
}

function Test-SwitchEnableGate {
    param($Ctx, [string]$WantOverlaySha, [string]$WantClosureSha, $EvidenceReasons)
    $r = @(Test-SwitchCommonGate $Ctx)
    if (-not $WantOverlaySha) { $r += '-OverlaySha256 (SHA-256 autorizado del overlay) es obligatorio.' }
    elseif (-not $Ctx.Overlay.Preparada.Existe -or -not $Ctx.Overlay.Preparada.Valida -or $Ctx.Overlay.Preparada.Sha256 -ne $WantOverlaySha.ToLower()) { $r += 'El overlay preparado falta, no es canonico o no tiene el SHA-256 autorizado.' }
    if ($Ctx.Overlay.Activa.Existe) { $r += 'Ya existe un overlay activo: use -Disable antes de volver a habilitar.' }
    if (@($Ctx.Overlay.Temporales).Count -gt 0) { $r += 'Hay temporales de una transicion interrumpida en el overlay activo: revise y limpie.' }
    if ($Ctx.ApiEstado -ne 'Apagado') { $r += ('La API no esta apagada de forma verificable (estado ' + $Ctx.ApiEstado + ').') }
    if (-not $WantClosureSha) { $r += '-ClosurePolicySha256 (SHA-256 autorizado de la politica de Manufactura) es obligatorio.' }
    elseif ($Ctx.ManufacturaPolicySha -ne $WantClosureSha.ToLower() -or $Ctx.ClosureSha -ne $Ctx.ManufacturaPolicySha) { $r += 'La ventana no esta cerrada con la politica de Manufactura autorizada (default.conf).' }
    if ($null -eq $Ctx.ClosureProbe -or -not $Ctx.ClosureProbe.Closed) { $r += ('Nginx no bloquea en vivo las escrituras de Manufactura (sonda POST drafts: ' + $(if ($Ctx.ClosureProbe) { $Ctx.ClosureProbe.Code } else { 'sin respuesta' }) + ', se esperaba 503 closed-v1).') }
    # A function returning an empty list arrives here as $null: only non-empty reasons count (an empty array must not become one blank reason).
    $r += @(@($EvidenceReasons) | Where-Object { $_ })
    return $r
}

# ------------------------------------------------------------------ Execution
function Wait-SwitchApi {
    param([string]$WantEstado, [int]$TimeoutSeconds)
    for ($t = 0; $t -le $TimeoutSeconds; $t += 5) {
        $f = Get-SwitchContainerFacts 'api'
        $estado = (ConvertFrom-DaubertContainerEnv (Get-DaubertContainerEnvJson ($script:Project + '-api-1'))).Estado
        if ($f.Health -eq 'healthy' -and $estado -eq $WantEstado) { return $true }
        Start-SwitchSleep 5
    }
    return $false
}
function Test-SwitchPost {
    param($Before, [string]$WantEstado, [int]$TimeoutSeconds)
    $p = @()
    if (-not (Wait-SwitchApi $WantEstado $TimeoutSeconds)) { $p += ('api no quedo healthy con Manufactura ' + $WantEstado + '.') }
    # No proxy health here: right after recreating api, nginx may still resolve the OLD api address until the documented Reload. The container's own healthcheck
    # (Wait-SwitchApi: healthy + effective state) and the unchanged image digest (GIT_COMMIT is baked into the image) prove api, commit and state.
    $after = Get-SwitchContext $script:Paths
    if ($after.Api.Digest -ne $Before.Api.Digest) { $p += 'la imagen de api cambio.' }
    if ($after.Web.ContainerId -ne $Before.Web.ContainerId -or $after.Web.StartedAt -ne $Before.Web.StartedAt) { $p += 'el contenedor web fue recreado o reiniciado (no debia).' }
    return $p
}
function Test-SwitchApiStopped {
    # Stopped ONLY when docker answers and explicitly reports Running=false. An unreachable daemon or a failed inspect is NOT proof of anything.
    $s = Invoke-SwitchRead 'docker' @('inspect', ($script:Project + '-api-1'), '--format', '{{.State.Running}}')
    return ($s.Code -eq 0 -and (($s.Out -join '').Trim() -eq 'false'))
}
function Invoke-SwitchStopApi {
    # Last resort: stop the identified container directly (does not depend on parsing the Compose/env files that may have broken the OFF recreation).
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $null = & docker stop ($script:Project + '-api-1') 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    Write-Host ('> docker stop ' + $script:Project + '-api-1  exit=' + $code)
    return $code
}
function Invoke-SwitchToOff {
    # Shared by -Disable and by the compensation. Returns '' when OFF is verified, otherwise the problem.
    # OFF is forced through the child environment (independent of the base file). If OFF cannot be verified, the LAST RESORT is stopping the api
    # container (the whole Hub API goes down, but an enabled Manufactura never keeps serving); the caller then reports indeterminate (exit 6 -> R2).
    param($Before, [string]$Motivo, [int]$TimeoutSeconds)
    $problem = ''
    try { $null = Unpublish-DaubertOverlay -Paths $script:Paths -Motivo $Motivo } catch { $problem = ('no se pudo retirar el overlay: ' + $_.Exception.Message + '. ') }
    try {
        if ((Invoke-SwitchCompose $false '' $true 'up') -ne 0) { $problem += 'docker compose up (sin overlay, OFF forzado) fallo. ' }
        else { $p = @(Test-SwitchPost $Before 'Apagado' $TimeoutSeconds); if ($p.Count -gt 0) { $problem += (($p -join ' ') + ' ') } }
    } catch { $problem += ('error al recrear api apagada: ' + $_.Exception.Message + ' ') }
    if (-not $problem) { return '' }
    $stopped = $false
    try { $null = Invoke-SwitchStopApi; $stopped = Test-SwitchApiStopped } catch { $stopped = $false }
    return ($problem.Trim() + $(if ($stopped) { ' Ultimo recurso aplicado: contenedor api DETENIDO (verificado).' } else { ' NO se pudo detener el contenedor api.' }))
}

function Get-SwitchEvidenceReasons {
    param([hashtable]$P, [string]$HeadShort)
    $evText = $(if ($P.ReadinessEvidence) { Read-SwitchText $P.ReadinessEvidence } else { $null })
    $evAge = $(if ($null -ne $evText) { Get-SwitchFileAgeHours $P.ReadinessEvidence } else { 0 })
    return @(Test-SwitchEvidence $evText $evAge $P.EvidenceMaxAgeHours $HeadShort ((Get-Date).ToUniversalTime()))
}

function Invoke-SwitchMain {
    param([hashtable]$P)
    $sel = @(@($P.Enable, $P.Disable) | Where-Object { $_ })
    if ($sel.Count -ne 1) { Write-Host 'Uso: Switch-Manufactura.ps1 -Enable|-Disable [-Apply] (sin -Apply solo valida).'; return 3 }
    $script:Paths = Get-DaubertOpsPaths -Root $P.Root
    $lock = $null
    try {
        try { $lock = Enter-DaubertOperationLock -Path $script:Paths.LockFile -Purpose ('Switch-Manufactura ' + $(if ($P.Enable) { 'Enable' } else { 'Disable' })) } catch { Write-Host $_.Exception.Message; return 1 }
        $ctx = Get-SwitchContext $script:Paths
        if ($P.Disable) {
            $reasons = @(Test-SwitchCommonGate $ctx | Where-Object { $_ -like 'La sesion*' -or $_ -like 'No se pudo leer el commit*' })
            if ($reasons.Count -gt 0) { Write-Host 'BLOQUEADO:'; $reasons | ForEach-Object { Write-Host ('  - ' + $_) }; return 1 }
            Write-Host ('PLAN: retirar overlay (activo=' + $ctx.Overlay.Activa.Existe + '), recrear solo api con OFF forzado, verificar Manufactura APAGADA.')
            if (-not $P.Apply) { return 0 }
            $problem = Invoke-SwitchToOff $ctx 'disabled' $P.HealthTimeoutSeconds
            if ($problem) { Write-Host ('MANUFACTURA_SWITCH_INDETERMINADO accion=Disable: ' + $problem); return 6 }
            Write-Host 'MANUFACTURA_SWITCH_OK accion=Disable (APAGADA verificada). Siguiente: Set-EntryClosure.ps1 -Action Reload -ExpectState Closed'
            return 0
        }
        $reasons = @(Test-SwitchEnableGate $ctx $P.OverlaySha256 $P.ClosurePolicySha256 (Get-SwitchEvidenceReasons $P ([string]$ctx.HeadShort))) + @(Test-SwitchManifest (Read-SwitchManifest $P.ImagesManifest) $P.ImagesManifestSha256 $ctx)
        if ($reasons.Count -gt 0) { Write-Host 'BLOQUEADO (nada cambio):'; $reasons | ForEach-Object { Write-Host ('  - ' + $_) }; return 1 }
        Write-Host ('PLAN: publicar overlay ' + $P.OverlaySha256 + ', recrear solo api (commit ' + $ctx.HeadShort + ', misma imagen), verificar Manufactura ENCENDIDA; si falla, compensar a APAGADA.')
        if (-not $P.Apply) { return 0 }
        if ((Read-SwitchConfirmation) -cne $script:Phrase) { Write-Host 'Confirmacion incorrecta: nada cambio.'; return 1 }
        # TOCTOU: re-read EVERYTHING right before mutating, including the readiness evidence (it may have expired or been replaced while the prompt was open).
        $ctx2 = Get-SwitchContext $script:Paths
        $reasons = @(Test-SwitchEnableGate $ctx2 $P.OverlaySha256 $P.ClosurePolicySha256 (Get-SwitchEvidenceReasons $P ([string]$ctx2.HeadShort))) + @(Test-SwitchManifest (Read-SwitchManifest $P.ImagesManifest) $P.ImagesManifestSha256 $ctx2)
        if ($reasons.Count -gt 0 -or $ctx2.Api.ContainerId -ne $ctx.Api.ContainerId -or $ctx2.Web.ContainerId -ne $ctx.Web.ContainerId -or $ctx2.HeadShort -ne $ctx.HeadShort) {
            Write-Host 'BLOQUEADO: el estado o la evidencia cambiaron despues de confirmar; nada cambio.'; $reasons | ForEach-Object { Write-Host ('  - ' + $_) }; return 1
        }
        $pub = $null
        try { $pub = Publish-DaubertOverlay -Paths $script:Paths -ExpectedSha256 $P.OverlaySha256 } catch { Write-Host ('No se publico el overlay (nada activo): ' + $_.Exception.Message); return 1 }
        # From here on the overlay may be active: EVERY failure, including unexpected exceptions, goes through the compensation.
        $problems = @()
        try {
            if ($pub.Resultado -ne 'Publicada') { $problems += 'overlay activo no verificado.' }
            elseif ((Invoke-SwitchCompose $true $script:Paths.OverlayActiva) -ne 0) { $problems += 'docker compose up (con overlay) fallo.' }
            else { $problems += @(Test-SwitchPost $ctx2 'Encendido' $P.HealthTimeoutSeconds) }
        } catch { $problems += ('error inesperado tras publicar el overlay: ' + $_.Exception.Message) }
        if ($problems.Count -eq 0) { Write-Host ('MANUFACTURA_SWITCH_OK accion=Enable commit=' + $ctx2.HeadShort + ' overlay=' + $pub.Sha256 + '. Siguiente: Set-EntryClosure.ps1 -Action Reload -ExpectState Closed'); return 0 }
        Write-Host 'ACTIVACION FALLIDA:'; $problems | ForEach-Object { Write-Host ('  - ' + $_) }
        Write-Host 'Compensando a APAGADA...'
        $problem = Invoke-SwitchToOff $ctx2 'failed' $P.HealthTimeoutSeconds
        if ($problem) { Write-Host ('MANUFACTURA_SWITCH_INDETERMINADO: ' + $problem + ' -> ejecutar la reversion de imagenes (R2).'); return 6 }
        Write-Host 'MANUFACTURA_SWITCH_COMPENSADO: Manufactura APAGADA verificada. Siguiente: Reload; decidir quedarse apagada o R2.'
        return 5
    } finally { Exit-DaubertOperationLock $lock }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-SwitchMain @{ Enable = [bool]$Enable; Disable = [bool]$Disable; Apply = [bool]$Apply; OverlaySha256 = $OverlaySha256; ReadinessEvidence = $ReadinessEvidence; ImagesManifest = $ImagesManifest; ImagesManifestSha256 = $ImagesManifestSha256
            ClosurePolicySha256 = $ClosurePolicySha256; EvidenceMaxAgeHours = $EvidenceMaxAgeHours; HealthTimeoutSeconds = $HealthTimeoutSeconds; Root = $Root })
}
