# ISOLATED verification of the integration of the APPROVED entry closure: scripts\deploy\Set-EntryClosure.ps1, deploy\closure\* (policy + read-only override) in forward AND rollback Compose invocations.
# The approved policy itself (1,373 HTTP checks on real Nginx) is NOT re-tested here; only the integration code is.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rehearsal\joint\Rehearse-EntryClosure.ps1 -OldDir <deploy checkout at the PROD commit> -NewDir <release checkout> -StateFile <joint-migrations-state.json> [-Project daubert-hub-rbtestg] [-Port 18093]
# Own Compose project and port, throw-away migrated database (the container named in StateFile is started if stopped). From production only the IMAGE is used (a new tag is added).
# Never runs down/rm/rmi/prune/--remove-orphans. ASCII only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [Parameter(Mandatory = $true)][string]$OldDir,
  [Parameter(Mandatory = $true)][string]$NewDir,
  [Parameter(Mandatory = $true)][string]$StateFile,
  [string]$Project = 'daubert-hub-rbtesth',
  [int]$Port = 18094
)
$ErrorActionPreference = 'Continue'
if ($Project -notmatch '^daubert-hub-rbtest[a-z0-9]*$' -or $Port -eq 8082) { throw 'Refusing production-like project name or port' }
$state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
$dbPort = [int]$state.port; $dbContainer = [string]$state.container
if ($dbPort -in 5432, 5433, 55432) { throw 'Refusing production-like database port' }
docker start $dbContainer | Out-Null
for ($i = 0; $i -lt 40; $i++) { $ready = docker exec $dbContainer pg_isready -U postgres 2>$null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 2 }
$img = $Project
$work = Join-Path $env:TEMP $Project
$null = New-Item -ItemType Directory -Force -Path $work
$gateDir = Join-Path $work 'maintenance-window\nginx-conf.d'
$gateScript = Join-Path $NewDir 'scripts\deploy\Set-EntryClosure.ps1'
$results = New-Object System.Collections.ArrayList
$runId = 'gate-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
function Check($name, $ok, $detail) { [void]$results.Add([pscustomobject]@{ check = $name; pass = [bool]$ok; detail = "$detail" }); if (-not $ok) { throw "CHECK FAILED: $name ($detail)" } }
function Health { try { Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 5 } catch { $null } }
function WaitHealthy([string]$prefix) { for ($i = 0; $i -lt 60; $i++) { $h = Health; if ($h -and $h.status -eq 'ok' -and $h.database -eq 'connected' -and ([string]$h.commit).StartsWith($prefix)) { return $h }; Start-Sleep -Seconds 3 }; throw "health did not report commit $prefix" }
function Code([string]$method, [string]$target) { return [string](& curl.exe -s -o NUL -w '%{http_code}' --max-time 3 --request-target $target -X $method -H 'Content-Type: application/json' -d '{}' "http://localhost:$Port/") }
function Gate([string]$action) { $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $gateScript -Action $action -Project $Project -Port $Port -ClosureDir $gateDir -WebImage "${img}-web:latest" 2>&1; return @{ Code = $LASTEXITCODE; Out = ($out -join "`n") } }

# Variants that try to reach a Pagos mutation while skirting the match. LEAK = the real handler answered (401/403/400/200...). Acceptable = 503 (gate), 404 (no route) or 000 (refused).
$bypass = @(
  @('POST', '/api/automations/payment-notifications/0/reprocess;x=1'), @('POST', '/api/automations/payment-notifications%2F0/reprocess'), @('POST', '/api/automations/payment%2Dnotifications/0/reprocess'),
  @('POST', '/api/./automations/payment-notifications/0/reprocess'), @('POST', '/api/x/../automations/payment-notifications/0/reprocess'), @('POST', '//api/automations/payment-notifications/0/reprocess'),
  @('POST', '/API/AUTOMATIONS/PAYMENT-NOTIFICATIONS/0/REPROCESS'), @('POST', 'http://localhost/api/automations/payment-notifications/0/reprocess'), @('PATCH', '/api/automations/payment-notifications/0/files/0/assignment/'),
  @('PATCH', '/api/Companies/1/Payment-Notification-Settings'), @('PUT', '/api/companies/1/payment-notification-settings/'), @('DELETE', '/api/aliases/1/payment-notifications/'),
  @('POST', '/api/companies/1//aliases//payment-notifications')
)

# ---------- old release = the real production build, under rehearsal names; plain compose pair (as production runs today)
foreach ($svc in 'api', 'web') { docker image inspect "daubert-hub-${svc}:latest" *> $null; if ($LASTEXITCODE -ne 0) { throw "daubert-hub-${svc}:latest not found" }; docker tag "daubert-hub-${svc}:latest" "${img}-${svc}:latest" }
$prev = (docker image inspect "${img}-api:latest" --format '{{range .Config.Env}}{{println .}}{{end}}' | Where-Object { $_ -like 'GIT_COMMIT=*' }) -replace 'GIT_COMMIT=', ''
$token = [guid]::NewGuid().ToString('N')
$envFile = Join-Path $work 'rb.env'
@("DB_HOST=host.docker.internal", "DB_PORT=$dbPort", "DB_NAME=daubert_global", "DB_USER=daubert_hub_app", "DB_PASSWORD=$($state.hubPassword)", "API_PORT=3000", "HUB_PORT=$Port",
  "CATERPILLAR_REPROCESS_WEBHOOK_URL=http://host.docker.internal:59999/webhook/cat-reprocess", "CATERPILLAR_REPROCESS_WEBHOOK_TOKEN=$token", "AUTH_COOKIE_SECURE=false") | Set-Content -Encoding ASCII -LiteralPath $envFile
$plain = Join-Path $work 'compose.prod-temp.yaml'; Copy-Item -LiteralPath (Join-Path $OldDir 'compose.prod-temp.yaml') -Destination $plain
# The mounted override = the repository override with the rehearsal directory in place of the production one.
$overrideText = Get-Content -LiteralPath (Join-Path $NewDir 'deploy\closure\entry-closure-override.yaml') -Raw
Check 'the repository override is read-only, create_host_path=false and mounts over /etc/nginx/conf.d' (($overrideText -match 'read_only: true') -and ($overrideText -match 'create_host_path: false') -and ($overrideText -match 'target: /etc/nginx/conf\.d')) ''
$prodSource = 'C:/Users/06/AppData/Local/DaubertHub/maintenance-window/nginx-conf.d'
Check 'the repository override uses the approved production source path' ($overrideText.Contains($prodSource)) $prodSource
$mountedFile = Join-Path $work 'entry-closure-override.rehearsal.yaml'
$overrideText.Replace($prodSource, ($gateDir.Replace('\', '/'))) | Set-Content -Encoding ASCII -LiteralPath $mountedFile
$cfOld = @('--project-name', $Project, '--env-file', $envFile, '-f', (Join-Path $OldDir 'compose.pilot.yaml'), '-f', $plain)
$cfOldGate = @('--project-name', $Project, '--env-file', $envFile, '-f', (Join-Path $OldDir 'compose.pilot.yaml'), '-f', $mountedFile)
$cfNewGate = @('--project-name', $Project, '--env-file', $envFile, '-f', (Join-Path $NewDir 'compose.pilot.yaml'), '-f', $mountedFile)
foreach ($cf in @($cfOld, $cfOldGate, $cfNewGate)) { docker compose @cf config --quiet; if ($LASTEXITCODE -ne 0) { throw 'compose config failed' } }
Check 'compose config is valid with the old and the new compose.pilot.yaml, with and without the override' $true ''

docker compose @cfOld up -d --no-build api web
if ($LASTEXITCODE -ne 0) { throw 'compose up (old) failed' }
$h0 = WaitHealthy $prev
Check 'old release healthy' ($h0.status -eq 'ok') "commit=$($h0.commit)"

# ---------- Prepare / Close with the real script (web does not mount the directory yet, as in production today)
$p = Gate 'Prepare'
Check 'Set-EntryClosure -Prepare reproduces the live Nginx file byte for byte (SHA-256 4d9dfea5...) from the web image' ($p.Code -eq 0 -and $p.Out -match '4d9dfea5f58cc2c0069f15b91e5406d62832806ff3e5a045fed48960499c0495') $p.Out
$c1 = Gate 'Close'
Check 'Set-EntryClosure -Close closes the running web (docker cp bridge) and PROVES it with probes (503 + X-Hub-Window)' ($c1.Code -eq 0 -and $c1.Out -match 'CLOSURE ACTIVE' -and $c1.Out -match 'docker cp') $c1.Out
$s1 = Gate 'Status'
Check 'Status reports CLOSED, web not yet mounting the directory' ($s1.Out -match 'state\s*:\s*CLOSED' -and $s1.Out -match 'webMountsDir\s*:\s*False') $s1.Out

# ---------- anchors and the single api+web update, with the override, probing the whole time
foreach ($svc in 'api', 'web') {
  $anchor = "${img}-${svc}:rollback-$prev"
  docker image inspect $anchor 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { throw "$anchor already exists" }
  docker tag "${img}-${svc}:latest" $anchor
  $a = docker image inspect $anchor --platform linux/amd64 --format '{{.Id}}'; $b = docker image inspect "${img}-${svc}:latest" --platform linux/amd64 --format '{{.Id}}'
  Check "anchor ${anchor} points to the running image" ($a -eq $b -and $a) $a
}
function Start-Probe([string]$name) {
  $log = Join-Path $work "probe-$name.log"; Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
  $packed = (($bypass + @(,@('POST', '/api/automations/payment-notifications/0/reprocess'))) | ForEach-Object { $_[0] + ' ' + $_[1] }) -join '|'
  $job = Start-Job -ArgumentList $Port, $log, $packed -ScriptBlock { param($p, $l, $set)
    while ($true) { foreach ($entry in $set.Split([char]'|')) { $m, $t = $entry -split ' ', 2
        $c = & curl.exe -s -o NUL -w '%{http_code}' --max-time 2 --request-target $t -X $m -H 'Content-Type: application/json' -d '{}' "http://localhost:$p/"
        Add-Content -LiteralPath $l -Value ('{0} {1} {2}' -f (Get-Date -Format 'HH:mm:ss.fff'), $c, $t) }; Start-Sleep -Milliseconds 100 } }
  return @{ Job = $job; Log = $log }
}
function Stop-Probe($pr) { Stop-Job $pr.Job | Out-Null; Remove-Job $pr.Job -Force | Out-Null; $rows = @(Get-Content -LiteralPath $pr.Log -ErrorAction SilentlyContinue); return ($rows | ForEach-Object { ($_ -split ' ')[1] } | Group-Object | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' ' }
$probeA = Start-Probe 'deploy'
Push-Location $NewDir
try {
  $newCommit = (git rev-parse --short=7 HEAD); $env:APP_VERSION = (node -p "require('./package.json').version"); $env:GIT_COMMIT = $newCommit
  docker compose @cfNewGate up -d --build api web
  if ($LASTEXITCODE -ne 0) { throw 'compose up --build (new, gate volume) failed' }
} finally { Pop-Location }
$h1 = WaitHealthy $newCommit
Start-Sleep -Seconds 3
$duringDeploy = Stop-Probe $probeA
Check 'the new release reports the 7-character commit of the release checkout in /api/health (same format as the anchors)' ($h1.commit -eq $newCommit -and $newCommit.Length -eq 7) "health=$($h1.commit) git=$newCommit"
Check 'DURING the single api+web update every target probe (including the bypass variants) was 503, 404 or refused; none reached a handler' (($duringDeploy -notmatch '(^| )(?!503=|404=|000=)\d{3}=') -and ($duringDeploy -match '503=')) $duringDeploy
$s2 = Gate 'Status'
Check 'AFTER the update: still CLOSED, web now mounts the closure directory' ($s2.Out -match 'state\s*:\s*CLOSED' -and $s2.Out -match 'webMountsDir\s*:\s*True') $s2.Out
$variants = $bypass | ForEach-Object { Code $_[0] $_[1] }
Check 'AFTER the update every bypass variant is 503 or 404 (no handler answered)' (@($variants | Where-Object { $_ -notin '503', '404', '000' }).Count -eq 0) ($variants -join ',')

# ---------- API replacement alone: Nginx keeps a stale upstream until reloaded; Reload must restore it WITHOUT opening the closure
docker compose @cfNewGate up -d --no-build --force-recreate api
if ($LASTEXITCODE -ne 0) { throw 'compose up (api only) failed' }
Start-Sleep -Seconds 8
$staleCode = [string](& curl.exe -s -o NUL -w '%{http_code}' --max-time 5 "http://localhost:$Port/api/health")
$rl = Gate 'Reload'
Check 'AFTER replacing only the API, Set-EntryClosure -Reload refreshes the upstream, keeps the closure ACTIVE and /api/health answers 200' ($rl.Code -eq 0 -and $rl.Out -match 'RELOADED' -and $rl.Out -match '503') ("before reload health=$staleCode; " + $rl.Out)
$null = WaitHealthy $newCommit

# ---------- no alternative access path
$apiPorts = docker port "${Project}-api-1" 2>$null
Check 'the api container publishes NO host port (it is reachable only through web)' (-not $apiPorts) "$apiPorts"
$members = (docker network inspect "${Project}_pilot" --format '{{range .Containers}}{{.Name}} {{end}}').Trim().Split(' ') | Sort-Object
Check 'the Compose network contains only api and web' (($members -join ',') -eq "${Project}-api-1,${Project}-web-1") ($members -join ',')
$published = docker port "${Project}-web-1" 2>$null
Check 'web is the only container with a published port and it maps to the rehearsal port only' (($published | Out-String) -match "$Port") ($published -join ' ')

# ---------- rollback with the override still mounted
docker exec $dbContainer psql -U postgres -d daubert_global -c "CREATE TABLE IF NOT EXISTS public.joint_rollback_marker(id serial PRIMARY KEY, note text, at timestamptz DEFAULT now()); INSERT INTO public.joint_rollback_marker(note) VALUES ('$runId');" | Out-Null
$probeB = Start-Probe 'rollback'
foreach ($svc in 'api', 'web') {
  docker tag "${img}-${svc}:latest" "${img}-${svc}:failed-$newCommit"
  docker tag "${img}-${svc}:rollback-$prev" "${img}-${svc}:latest"
}
docker compose @cfOldGate up -d --no-build api web
if ($LASTEXITCODE -ne 0) { throw 'compose up (rollback) failed' }
$h2 = WaitHealthy $prev
Start-Sleep -Seconds 3
$duringRollback = Stop-Probe $probeB
Check 'ROLLBACK: previous commit again in /api/health' ($h2.commit -eq $prev) $h2.commit
Check 'DURING the rollback every target probe was 503, 404 or refused' (($duringRollback -notmatch '(^| )(?!503=|404=|000=)\d{3}=') -and ($duringRollback -match '503=')) $duringRollback
$s3 = Gate 'Status'
Check 'AFTER the rollback: still CLOSED' ($s3.Out -match 'state\s*:\s*CLOSED') $s3.Out
$m = (docker exec $dbContainer psql -U postgres -d daubert_global -t -A -c "SELECT count(*) FROM public.joint_rollback_marker WHERE note = '$runId'").Trim()
Check 'data written before the rollback is still there' ($m -eq '1') $m

# ---------- open
$o = Gate 'Open'
Check 'Set-EntryClosure -Open switches the closure off without recreating web, proving it with probes' ($o.Code -eq 0 -and $o.Out -match 'CLOSURE OFF') $o.Out
docker compose @cfOldGate stop api web | Out-Null
$results | ConvertTo-Json -Depth 3
"PAYMENTS_ENTRY_CLOSURE_INTEGRATION_PASS ($($results.Count) checks); old=$prev new=$newCommit; during update: $duringDeploy; during rollback: $duringRollback"
