<#
.SYNOPSIS
    Prepares, closes, opens, reloads or inspects the approved entry closure of the Hub Web container (Windows PowerShell 5.1). ASCII only.

.DESCRIPTION
    The closure is the versioned Nginx policy deploy\closure\entry-closure-policy.conf. It lives as the ONLY file (default.conf) of a host directory that
    deploy\closure\entry-closure-override.yaml mounts read-only over /etc/nginx/conf.d of Web. That override is part of EVERY Compose invocation of
    Deploy-DaubertHub.ps1 (forward and rollback), so a recreated Web always comes back with the file that is in the directory (closed or open).
    Closing/opening = rewrite default.conf in place + nginx -t + nginx -s reload (no container is recreated, no compose command is run).

    Actions
      Prepare  Create the directory (and its parent holding the OPEN copy and the policy copy) and write default.conf = the ORIGINAL Nginx file taken from the Web IMAGE
               (docker run --rm --entrypoint cat), which must match -ExpectedOpenSha256 unless -AcceptNewBaseline. Touches only the host directory.
      Close    Install the closed policy, validate, reload, then PROVE it with probes (see below).
      Open     Install the original file, reload, prove nothing is answered 503 by the window.
      Reload   nginx -t + reload keeping the current file. REQUIRED after replacing the API container (Nginx resolves api:3000 once at start); re-verifies the current state.
      Status   Read-only: hashes, whether Web mounts the directory, and the probes.

    Probes are safe: target routes are asked with GET plus the header X-Hub-Window-Probe: <METHOD> (the policy evaluates it as that method, it can only increase denial and the
    upstream request stays a GET); a few real unauthenticated writes are also sent to target routes (rejected before the API when closed, 401/404 when open) and never to non-target routes.

    Policies. WITHOUT -Policy nothing changes: the operative policy deploy\closure\entry-closure-policy.conf is used, exactly as before.
      -Policy Manufactura   EXPLICIT selection of deploy\closure\entry-closure-policy.manufactura.conf (same policy + every write under /api/manufacturing-sheets answers 503). It REQUIRES
                            -ExpectedPolicySha256 (the SHA-256 authorised for the release): if the file does not match, the script stops before touching anything. The verification
                            probes then also cover Manufactura routes. Only for the authorised Manufactura release window.
      -ExpectedPolicySha256 Optional with the operative policy (same check). Mandatory with -Policy Manufactura.
      -ExpectState          Only for Reload (optional): Closed or Open. Reload then REFUSES, before reloading anything, unless the file installed in default.conf is in that state
                            (Closed = it is exactly a closure policy: the operative one or the Manufactura one), and the probes must confirm that same state afterwards.
                            Without it Reload behaves exactly as before: it re-verifies whatever state it finds. Mandatory in the Manufactura release procedure (-ExpectState Closed).
      -KeepClosure          Only for Prepare: if default.conf currently IS a closure policy, refresh only the OPEN copy and leave default.conf closed (refreshing the Nginx baseline
                            inside a closed window). Without it Prepare behaves exactly as before (it writes the open file to default.conf).
    Reload and Status recognise by SHA-256 which policy is installed, so a window closed with -Policy Manufactura is re-verified with its own probes even if -Policy is omitted.

    Safety: it touches the host directory and, with docker exec, only <Project>-web-1 (nginx -t / nginx -s reload; docker cp ONLY while Web does not yet mount the directory).
    It never recreates, stops or removes anything and never runs compose. Not a control over host administrators, docker, n8n manual runs/CLI/retries (see the plan).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Prepare', 'Close', 'Open', 'Reload', 'Status')][string]$Action,
    [string]$Project = 'daubert-hub',
    [int]$Port = 8082,
    [string]$ClosureDir = 'C:\Users\06\AppData\Local\DaubertHub\maintenance-window\nginx-conf.d',
    [string]$WebImage = '',
    [string]$ExpectedOpenSha256 = '4d9dfea5f58cc2c0069f15b91e5406d62832806ff3e5a045fed48960499c0495',
    [switch]$AcceptNewBaseline,
    [ValidateSet('Operativa', 'Manufactura')][string]$Policy = 'Operativa',
    [string]$ExpectedPolicySha256 = '',
    [switch]$KeepClosure,
    [ValidateSet('', 'Closed', 'Open')][string]$ExpectState = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Project -notmatch '^daubert-hub(-rbtest[a-z0-9]*)?$') { throw "Project not allowed: $Project" }
if (-not $WebImage) { $WebImage = "$Project-web:latest" }
$container = "$Project-web-1"
$policyPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\deploy\closure\entry-closure-policy.conf'))
$manufacturaPolicyPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\deploy\closure\entry-closure-policy.manufactura.conf'))
if ($Policy -eq 'Manufactura') {
    if (-not $ExpectedPolicySha256) { throw '-Policy Manufactura requires -ExpectedPolicySha256 (the SHA-256 authorised for deploy\closure\entry-closure-policy.manufactura.conf). Nothing was changed.' }
    $policyPath = $manufacturaPolicyPath
}
$active = Join-Path $ClosureDir 'default.conf'
$parent = Split-Path -Parent $ClosureDir
$openCopy = Join-Path $parent 'default.conf.open'
$policyCopy = Join-Path $parent 'entry-closure-policy.conf'

$blocked = @('/api/automations/payment-notifications/0/reprocess', '/api/automations/payment-notifications/0/files/0/assignment',
    '/api/automations/remissions/caterpillar/executions/0/reprocess', '/api/automations/remissions/caterpillar/executions/0/regenerate',
    '/api/automations/remissions/caterpillar/executions/0/remittances/0/cancel', '/api/automations/REMISIONES_CATERPILLAR/document-series/REMISION_CAT_P2',
    '/api/automations/PAYMENT_NOTIFICATIONS/review-acknowledgements', '/api/companies/0/payment-notification-settings', '/api/companies/0/aliases',
    '/api/companies/0/aliases/payment-notifications', '/api/aliases/0/payment-notifications', '/API/Automations/Payment-Notifications/0/Reprocess')
$realWrites = @(@('POST', '/api/automations/payment-notifications/0/reprocess'), @('PATCH', '/api/automations/payment-notifications/0/files/0/assignment'),
    @('POST', '/api/automations/remissions/caterpillar/executions/0/reprocess'), @('PATCH', '/api/companies/0/aliases'), @('DELETE', '/api/aliases/0/payment-notifications'))
$allowedReads = @('/api/automations/remissions/audi/executions', '/api/automations/REMISIONES_AUDI/document-series/REMISION_AUDI', '/api/auth/login', '/api/providers', '/api/health')

function Get-Code([string]$method, [string]$path, [string]$probe) {
    $args2 = @('-s', '-o', 'NUL', '-D', '-', '-w', '%{http_code}', '--max-time', '3', '-X', $method)
    if ($probe) { $args2 += @('-H', "X-Hub-Window-Probe: $probe") }
    if ($method -ne 'GET') { $args2 += @('-H', 'Content-Type: application/json', '-d', '{}') }
    $out = (& curl.exe @args2 ("http://localhost:$Port$path")) -join "`n"
    $code = $out.Substring([Math]::Max(0, $out.Length - 3))
    return [pscustomobject]@{ Code = $code; Header = ($out -match '(?im)^X-Hub-Window:\s*closed-v1') }
}
function Get-Sha([string]$path) { if (Test-Path -LiteralPath $path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower() } return '' }
function Write-InPlace([string]$path, [byte[]]$bytes) {
    $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
    try { $stream.SetLength(0); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush() } finally { $stream.Dispose() }
}
function Test-Running { $state = & docker inspect $container --format '{{.State.Running}}' 2>$null; return ($LASTEXITCODE -eq 0 -and "$state" -eq 'true') }
function Test-Mounted { $dest = & docker inspect $container --format '{{range .Mounts}}{{.Destination}} {{end}}' 2>$null; return ($LASTEXITCODE -eq 0 -and "$dest" -match '/etc/nginx/conf\.d') }
function Get-ProbeSummary {
    $t = @($blocked | ForEach-Object { Get-Code 'GET' $_ 'POST' })
    $w = @($realWrites | ForEach-Object { Get-Code $_[0] $_[1] '' })
    $r = @($allowedReads | ForEach-Object { Get-Code 'GET' $_ 'POST' })
    return [pscustomobject]@{ targetProbes = $t; realWrites = $w; controlProbes = $r }
}
function Assert-Probes([string]$expected) {
    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 700; $s = Get-ProbeSummary
        if ($expected -eq 'closed') { $ok = @($s.targetProbes + $s.realWrites | Where-Object { $_.Code -ne '503' -or -not $_.Header }).Count -eq 0 }
        else { $ok = @($s.targetProbes + $s.realWrites | Where-Object { $_.Code -eq '503' -or $_.Header }).Count -eq 0 }
        $ctl = @($s.controlProbes | Where-Object { $_.Code -eq "503" }).Count -eq 0 -and $s.controlProbes[-1].Code -eq '200'
    } while (-not ($ok -and $ctl) -and (Get-Date) -lt $deadline)
    Write-Host ('target probes (GET + method header): ' + (($s.targetProbes | ForEach-Object { $_.Code }) -join ','))
    Write-Host ('real writes to target routes       : ' + (($s.realWrites | ForEach-Object { $_.Code }) -join ','))
    Write-Host ('control probes (Audi, auth, health) : ' + (($s.controlProbes | ForEach-Object { $_.Code }) -join ','))
    if (-not ($ok -and $ctl)) { throw "CLOSURE NOT $($expected.ToUpper()): probes do not match. Do not continue the window." }
}
function Install-File([string]$sourceFile) {
    if (-not (Test-Path -LiteralPath $sourceFile)) { throw "Missing $sourceFile (run -Action Prepare first)" }
    Write-InPlace $active ([System.IO.File]::ReadAllBytes($sourceFile))
    Update-Nginx $true
}
function Update-Nginx([bool]$copyIfNotMounted) {
    if (-not (Test-Running)) { Write-Host 'web container is not running: the file is in place and applies when it starts'; return }
    if (-not (Test-Mounted)) {
        if (-not $copyIfNotMounted) { throw 'web does not mount the closure directory' }
        & docker cp $active "${container}:/etc/nginx/conf.d/default.conf"; if ($LASTEXITCODE -ne 0) { throw 'docker cp failed' }
        Write-Host 'web does NOT mount the closure directory yet: installed with docker cp (bridge until web is recreated WITH the override)'
    }
    cmd /c "docker exec $container nginx -t >NUL 2>&1"; if ($LASTEXITCODE -ne 0) { throw 'nginx -t failed: the previous configuration keeps running' }
    cmd /c "docker exec $container nginx -s reload >NUL 2>&1"; if ($LASTEXITCODE -ne 0) { throw 'nginx reload failed' }
    $inside = ((& docker exec $container sh -c 'sha256sum /etc/nginx/conf.d/default.conf') -split ' ')[0]
    if ($inside -ne (Get-Sha $active)) { throw 'the container does not see the file just written' }
}
function Get-State { $s = Get-ProbeSummary; if (@($s.targetProbes | Where-Object { $_.Code -ne '503' }).Count -eq 0) { return 'CLOSED' } elseif (@($s.targetProbes | Where-Object { $_.Code -eq '503' }).Count -eq 0) { return 'OPEN' } else { return 'MIXED' } }

# Policy selection guard (reached only with the new parameters, or when the Manufactura policy is the file already installed).
if ($ExpectedPolicySha256) {
    $policyHave = Get-Sha $policyPath
    if ($policyHave -ne $ExpectedPolicySha256.ToLower()) { throw "Policy '$Policy' ($policyPath) has SHA-256 '$policyHave', not the expected $($ExpectedPolicySha256.ToLower()). Nothing was changed." }
}
$manufacturaSha = Get-Sha $manufacturaPolicyPath
$activeIsManufactura = ($manufacturaSha -ne '' -and (Get-Sha $active) -eq $manufacturaSha)
if ($activeIsManufactura -and $Action -in @('Reload', 'Status')) { $policyPath = $manufacturaPolicyPath }
if ($Policy -eq 'Manufactura' -or ($activeIsManufactura -and $Action -in @('Reload', 'Status'))) {
    $blocked += @('/api/manufacturing-sheets/documents/drafts', '/api/manufacturing-sheets/documents/signatures', '/api/manufacturing-sheets/documents/revisions/0/finalize',
        '/api/manufacturing-sheets/documents/signatures/0/authorize', '/api/manufacturing-sheets/client-abbreviations', '/api/manufacturing-sheets/previews/pdf')
    $realWrites += @(, @('POST', '/api/manufacturing-sheets/documents/drafts')); $realWrites += @(, @('POST', '/api/manufacturing-sheets/documents/signatures')); $realWrites += @(, @('PATCH', '/api/manufacturing-sheets/documents/revisions/0'))
    Write-Host ("policy: MANUFACTURA sha256=" + $manufacturaSha)
}

if ($ExpectState -and $Action -ne 'Reload') { throw '-ExpectState only applies to -Action Reload. Nothing was changed.' }

switch ($Action) {
    'Prepare' {
        $null = New-Item -ItemType Directory -Force -Path $ClosureDir
        $tmp = Join-Path $env:TEMP ('closure-original-' + [guid]::NewGuid().ToString('N') + '.conf')
        cmd /c "docker run --rm --entrypoint cat $WebImage /etc/nginx/conf.d/default.conf > `"$tmp`""
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tmp) -or (Get-Item -LiteralPath $tmp).Length -eq 0) { throw "Cannot read the Nginx file from image $WebImage" }
        $sha = Get-Sha $tmp
        if ($sha -ne $ExpectedOpenSha256 -and -not $AcceptNewBaseline) { throw "The Nginx file of $WebImage has SHA-256 $sha, not the expected baseline $ExpectedOpenSha256 (review; -AcceptNewBaseline to continue)" }
        $bytes = [System.IO.File]::ReadAllBytes($tmp)
        if ($KeepClosure) {
            $activeSha = Get-Sha $active
            if ($activeSha -ne '' -and ($activeSha -eq (Get-Sha $policyPath) -or $activeSha -eq $manufacturaSha -or $activeSha -eq (Get-Sha $policyCopy))) {
                Write-InPlace $openCopy $bytes
                if ((Get-Sha $openCopy) -ne $sha) { throw 'default.conf.open does not reproduce the original byte for byte' }
                Write-Host "Prepared $parent (-KeepClosure): the closure is ACTIVE, default.conf was KEPT CLOSED; default.conf.open = ORIGINAL sha256=$sha. Run -Action Close now, -Action Open at the end of the window."
                break
            }
            throw '-KeepClosure: default.conf is not a closure policy (the window is not closed). Run -Action Close first, or omit -KeepClosure. Nothing was changed.'
        }
        Write-InPlace $openCopy $bytes; Write-InPlace $active $bytes
        Write-InPlace $policyCopy ([System.IO.File]::ReadAllBytes($policyPath))
        if ((Get-Sha $active) -ne $sha) { throw 'default.conf does not reproduce the original byte for byte' }
        Write-Host "Prepared $ClosureDir : default.conf = ORIGINAL (open) sha256=$sha ; copies in $parent. Nothing was recreated."
    }
    'Close' { Install-File $policyPath; Assert-Probes 'closed'; Write-Host 'CLOSURE ACTIVE (verified)' }
    'Open' { Install-File $openCopy; Assert-Probes 'open'; Write-Host 'CLOSURE OFF (verified)' }
    'Reload' {
        $before = Get-Sha $active
        $foundState = $(if ($before -eq (Get-Sha $policyPath)) { 'closed' } else { 'open' })
        if ($ExpectState -and $ExpectState.ToLower() -ne $foundState) {
            throw "Reload -ExpectState ${ExpectState}: default.conf is $($foundState.ToUpper()) (sha256=$before). NOTHING was reloaded. $(if ($ExpectState -eq 'Closed') { 'The window is NOT closed on disk: run -Action Close (with the policy of the window) and verify before continuing.' } else { 'Run -Action Open first.' })"
        }
        Update-Nginx $false; Assert-Probes $foundState
        Write-Host $(if ($ExpectState) { "RELOADED (state $($foundState.ToUpper()) as expected and verified)" } else { 'RELOADED (state unchanged and verified)' })
    }
    'Status' {
        [pscustomobject]@{ state = (Get-State); activeSha256 = (Get-Sha $active); policySha256 = (Get-Sha $policyPath); openCopySha256 = (Get-Sha $openCopy); webRunning = (Test-Running); webMountsDir = (Test-Mounted) } | Format-List
    }
}
