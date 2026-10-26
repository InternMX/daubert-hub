# ISOLATED rehearsal of the joint api+web update, the rollback and the PERSISTENT closure of the Pagos mutations (Nginx gate that survives recreating web).
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rehearse-joint-deploy-isolated.ps1 -OldDir <deploy checkout at the PROD commit> -NewDir <joint candidate checkout> -StateFile <joint-migrations-state.json> [-Project daubert-hub-rbtestc] [-Port 18090]
# It uses its OWN Compose project, port and network, and the throw-away migrated database of rehearse-joint-migrations-isolated.cjs (--keep). The only thing taken from production is the
# IMAGE of api/web (a new tag is added; nothing is changed or removed). It never runs down/rm/rmi/prune/--remove-orphans and only STOPS its own containers at the end.
# Probes are unauthenticated requests against the rehearsal port: no session, no real mail, no n8n. ASCII only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param(
  [Parameter(Mandatory = $true)][string]$OldDir,
  [Parameter(Mandatory = $true)][string]$NewDir,
  [Parameter(Mandatory = $true)][string]$StateFile,
  [string]$Project = 'daubert-hub-rbtestc',
  [int]$Port = 18090
)
$ErrorActionPreference = 'Continue'
if ($Project -notmatch '^daubert-hub-rbtest[a-z0-9]*$' -or $Port -eq 8082) { throw 'Refusing production-like project name or port' }
$state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
$dbPort = [int]$state.port; $dbContainer = [string]$state.container
if ($dbPort -in 5432, 5433, 55432) { throw 'Refusing production-like database port' }
$img = $Project
$work = Join-Path $env:TEMP $Project
$null = New-Item -ItemType Directory -Force -Path $work
$gateDir = Join-Path $work 'gate\conf.d'
$null = New-Item -ItemType Directory -Force -Path $gateDir
$results = New-Object System.Collections.ArrayList
$runId = 'joint-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
function Check($name, $ok, $detail) { [void]$results.Add([pscustomobject]@{ check = $name; pass = [bool]$ok; detail = "$detail" }); if (-not $ok) { throw "CHECK FAILED: $name ($detail)" } }
function Health { try { Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 5 } catch { $null } }
function WaitHealthy([string]$prefix) {
  for ($i = 0; $i -lt 60; $i++) { $h = Health; if ($h -and $h.status -eq 'ok' -and $h.database -eq 'connected' -and ([string]$h.commit).StartsWith($prefix)) { return $h }; Start-Sleep -Seconds 3 }
  throw "health did not report commit $prefix"
}
function Code([string]$method, [string]$path) { $c = & curl.exe -s -o NUL -w '%{http_code}' --max-time 3 -X $method -H 'Content-Type: application/json' -d '{}' "http://localhost:$Port$path"; return [string]$c }

# Pagos mutations that must be CLOSED during the window (method, path). Variants prove case-insensitivity, trailing slash and double slash.
$closed = @(
  @('POST',  '/api/automations/payment-notifications/0/reprocess'),
  @('PATCH', '/api/automations/payment-notifications/0/files/0/assignment'),
  @('POST',  '/api/Automations/Payment-Notifications/0/reprocess'),
  @('POST',  '/api/automations/payment-notifications/0/reprocess/'),
  @('POST',  '/api//automations//payment-notifications/0/reprocess'),
  @('PATCH', '/api/aliases/1/payment-notifications'),
  @('POST',  '/api/companies/1/aliases/payment-notifications'),
  @('PATCH', '/api/companies/1/payment-notification-settings')
)
# Operations that are NOT Pagos and must never be answered 503 by the gate (Caterpillar, generic aliases, login, health, Pagos reads).
$control = @(
  @('POST',  '/api/automations/remissions/caterpillar/executions/1/reprocess'),
  @('POST',  '/api/automations/remissions/caterpillar/executions/1/regenerate'),
  @('POST',  '/api/automations/remissions/caterpillar/executions/1/remittances/1/cancel'),
  @('PATCH', '/api/companies/1/aliases'),
  @('POST',  '/api/auth/login'),
  @('GET',   '/api/automations/payment-notifications'),
  @('GET',   '/api/health')
)

# ------------------------------------------------------------------ images: old = the real production build, tagged under the rehearsal names
foreach ($svc in 'api', 'web') { docker image inspect "daubert-hub-${svc}:latest" *> $null; if ($LASTEXITCODE -ne 0) { throw "daubert-hub-${svc}:latest not found" }; docker tag "daubert-hub-${svc}:latest" "${img}-${svc}:latest" }
$prev = (docker image inspect "${img}-api:latest" --format '{{range .Config.Env}}{{println .}}{{end}}' | Where-Object { $_ -like 'GIT_COMMIT=*' }) -replace 'GIT_COMMIT=', ''
Check 'old (production) images carry a commit' ($prev -match '^[0-9a-f]{7,40}$') $prev

# ------------------------------------------------------------------ original and gated Nginx configuration (taken from the image, not from a production container)
$openConf = (docker run --rm --entrypoint cat "${img}-web:latest" /etc/nginx/conf.d/default.conf) -join "`n"
$openConf = $openConf.TrimEnd() + "`n"
$gateLines = @'
server {
    # Pagos maintenance gate: mutations only; reads and every other module keep working. Case-insensitive on purpose (Express routing is).
    set $pay_gate "$request_method:$uri";
    if ($pay_gate ~* "^(POST|PUT|PATCH|DELETE):/api/(automations/payment-notifications(/|$)|aliases/[^/]+/payment-notifications/?$|companies/[^/]+/aliases/payment-notifications/?$|companies/[^/]+/payment-notification-settings/?$)") {
        return 503;
    }
'@
if ([regex]::Matches($openConf, '(?m)^server \{').Count -ne 1) { throw 'Unexpected Nginx layout' }
$closedConf = $openConf.Replace('server {', ($gateLines.TrimEnd()))
$openHash = (Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($openConf))) -Algorithm SHA256).Hash.ToLower()
function Write-Gate([string]$text) { [IO.File]::WriteAllText((Join-Path $gateDir 'default.conf'), $text, (New-Object Text.UTF8Encoding($false))) }

# ------------------------------------------------------------------ compose files: production-like pair (old), and the same pair with the persistent gate mount (new)
$dbPass = [string]$state.hubPassword; $token = [guid]::NewGuid().ToString('N')
$envFile = Join-Path $work 'rb.env'
@("DB_HOST=host.docker.internal", "DB_PORT=$dbPort", "DB_NAME=daubert_global", "DB_USER=daubert_hub_app", "DB_PASSWORD=$dbPass", "API_PORT=3000", "HUB_PORT=$Port",
  "CATERPILLAR_REPROCESS_WEBHOOK_URL=http://host.docker.internal:59999/webhook/cat-reprocess", "CATERPILLAR_REPROCESS_WEBHOOK_TOKEN=$token", "AUTH_COOKIE_SECURE=false") | Set-Content -Encoding ASCII -LiteralPath $envFile
$plain = Join-Path $work 'compose.prod-temp.yaml'
Copy-Item -LiteralPath (Join-Path $OldDir 'compose.prod-temp.yaml') -Destination $plain
$mounted = Join-Path $work 'compose.prod-temp.gate.yaml'
$gatePathForCompose = $gateDir.Replace('\', '/')
(Get-Content -LiteralPath $plain -Raw).TrimEnd() + "`n  web:`n    volumes:`n      - `"${gatePathForCompose}:/etc/nginx/conf.d:ro`"`n" | Set-Content -Encoding ASCII -LiteralPath $mounted
$cfOld = @('--project-name', $Project, '--env-file', $envFile, '-f', (Join-Path $OldDir 'compose.pilot.yaml'), '-f', $plain)
$cfOldGate = @('--project-name', $Project, '--env-file', $envFile, '-f', (Join-Path $OldDir 'compose.pilot.yaml'), '-f', $mounted)
$cfNewGate = @('--project-name', $Project, '--env-file', $envFile, '-f', (Join-Path $NewDir 'compose.pilot.yaml'), '-f', $mounted)
foreach ($cf in @($cfOld, $cfOldGate, $cfNewGate)) { docker compose @cf config --quiet; if ($LASTEXITCODE -ne 0) { throw 'compose config failed' } }
Check 'compose config is valid for both Compose pairs (old and new compose.pilot.yaml, with and without the gate mount)' $true ''

function Start-Probe([string]$name) {
  $log = Join-Path $work "probe-$name.log"; Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
  # The set travels as ONE string (method space path, separated by |): Start-Job flattens array arguments.
  $packed = ($closed | ForEach-Object { $_[0] + ' ' + $_[1] }) -join '|'
  $job = Start-Job -ArgumentList $Port, $log, $packed -ScriptBlock { param($p, $l, $packedSet)
    while ($true) { foreach ($entry in $packedSet.Split([char]'|')) { $m, $u = $entry -split ' ', 2
        $c = & curl.exe -s -o NUL -w '%{http_code}' --max-time 2 -X $m -H 'Content-Type: application/json' -d '{}' ("http://localhost:$p" + $u)
        Add-Content -LiteralPath $l -Value ('{0} {1} {2}' -f (Get-Date -Format 'HH:mm:ss.fff'), $c, $u) }; Start-Sleep -Milliseconds 100 } }
  return @{ Job = $job; Log = $log }
}
function Stop-Probe($p) { Stop-Job $p.Job | Out-Null; Remove-Job $p.Job -Force | Out-Null; $rows = @(Get-Content -LiteralPath $p.Log -ErrorAction SilentlyContinue); return ($rows | ForEach-Object { ($_ -split ' ')[1] } | Group-Object | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' ' }

# ================================================================== 1. OLD release as production runs it (no gate mount)
Write-Gate $openConf
docker compose @cfOld up -d --no-build api web
if ($LASTEXITCODE -ne 0) { throw 'compose up (old) failed' }
$h0 = WaitHealthy $prev
Check 'OLD release healthy on the migrated copy' ($h0.status -eq 'ok') "version=$($h0.version) commit=$($h0.commit)"
$leak0 = $closed | ForEach-Object { Code $_[0] $_[1] }
Check 'before any gate: the Pagos mutations reach the API (not 503; answered by the auth guard or router)' (($leak0 | Where-Object { $_ -eq '503' }).Count -eq 0) ($leak0 -join ',')
[void]$results.Add([pscustomobject]@{ check = 'Router case-sensitivity probe: status of the upper-case Pagos path equals the lower-case one (=> Express is case-insensitive and the gate must be too)'; pass = [bool]($leak0[2] -eq $leak0[0]); detail = ($leak0 -join ',') })

# ================================================================== 2. NEGATIVE CONTROL: the gate installed with docker cp (Pagos proposal) vanishes when web is recreated
$cid = "${Project}-web-1"
$stage = Join-Path $work 'gate-cp.conf'; [IO.File]::WriteAllText($stage, $closedConf, (New-Object Text.UTF8Encoding($false)))
docker cp $stage "${cid}:/etc/nginx/conf.d/default.conf"; docker exec $cid nginx -t 2>$null; docker exec $cid nginx -s reload
Start-Sleep -Seconds 2
$cpClosed = $closed | ForEach-Object { Code $_[0] $_[1] }
Check 'docker-cp gate (current proposal) closes every Pagos mutation while the same web container lives' (($cpClosed | Where-Object { $_ -ne '503' }).Count -eq 0) ($cpClosed -join ',')
docker compose @cfOld up -d --no-build --force-recreate web
Start-Sleep -Seconds 4
$afterRecreate = $closed | ForEach-Object { Code $_[0] $_[1] }
Check 'NEGATIVE CONTROL: recreating web WITHOUT the persistent mechanism REOPENS Pagos (the gate disappears: no 503 left)' (($afterRecreate | Where-Object { $_ -eq '503' }).Count -eq 0) ($afterRecreate -join ',')

# The operator closes the gate again on the (recreated, now open) web exactly as in the real window, and only then continues.
docker cp $stage "${cid}:/etc/nginx/conf.d/default.conf"; docker exec $cid nginx -t 2>$null; docker exec $cid nginx -s reload
Start-Sleep -Seconds 2
$regated = $closed | ForEach-Object { Code $_[0] $_[1] }
Check 'the gate is closed again on the running web BEFORE the deployment starts (the real window never deploys with an open gate)' (($regated | Where-Object { $_ -ne '503' }).Count -eq 0) ($regated -join ',')

# ================================================================== 3. PERSISTENT gate: host directory mounted over /etc/nginx/conf.d, gate file already closed before web is recreated
Write-Gate $closedConf
$anchorDone = @()
foreach ($svc in 'api', 'web') {
  $anchor = "${img}-${svc}:rollback-$prev"
  docker image inspect $anchor 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { throw "${anchor} already exists" }
  docker tag "${img}-${svc}:latest" $anchor
  $chk = docker image inspect $anchor --platform linux/amd64 --format '{{.Id}}'; $run = docker image inspect "${img}-${svc}:latest" --platform linux/amd64 --format '{{.Id}}'
  Check "rollback anchor ${anchor} created for $svc and points to the running image" ($chk -eq $run -and $chk) $chk
}
$probeA = Start-Probe 'deploy'
Push-Location $NewDir
try {
  $newCommit = (git rev-parse --short=7 HEAD); $env:APP_VERSION = (node -p "require('./package.json').version"); $env:GIT_COMMIT = $newCommit
  docker compose @cfNewGate up -d --build api web
  if ($LASTEXITCODE -ne 0) { throw 'compose up --build (new, gate mount) failed' }
} finally { Pop-Location }
$h1 = WaitHealthy $newCommit
Start-Sleep -Seconds 3
$duringDeploy = Stop-Probe $probeA
Check 'NEW joint release healthy' ($h1.status -eq 'ok' -and $h1.commit -ne $prev) "version=$($h1.version) commit=$($h1.commit)"
Check 'DURING the recreation of api and web every Pagos probe was 503 or a refused connection (000); never answered by the API (and the probes did observe 503)' (($duringDeploy -notmatch '(^| )(?!503=|000=)\d{3}=') -and ($duringDeploy -match '503=')) $duringDeploy
$afterDeploy = $closed | ForEach-Object { Code $_[0] $_[1] }
Check 'AFTER the deploy the gate is still closed for all Pagos mutations (including case/slash variants)' (($afterDeploy | Where-Object { $_ -ne '503' }).Count -eq 0) ($afterDeploy -join ',')
$ctl = $control | ForEach-Object { Code $_[0] $_[1] }
Check 'AFTER the deploy nothing outside Pagos is answered 503 (Caterpillar, generic aliases, login, Pagos reads, health)' (($ctl | Where-Object { $_ -eq '503' }).Count -eq 0 -and $ctl[-1] -eq '200') ($ctl -join ',')
$contents = docker exec "${Project}-api-1" sh -c "grep -rl ADMISSION_REJECTED /app/apps/api/dist | wc -l; grep -rl fn_destino_asignacion_pago_disponible /app/apps/api/dist | wc -l; grep -rl fn_autorizar_regeneracion_caterpillar /app/apps/api/dist | wc -l"
$web = docker exec "${Project}-web-1" sh -c "grep -rl Regenerar /usr/share/nginx/html | wc -l"
Check 'the joint api contains Caterpillar (ADMISSION_REJECTED, regeneration) and Pagos 019 (fn_destino_asignacion_pago_disponible); web contains Regenerar' ((($contents -split "`n") | ForEach-Object { [int]$_ -gt 0 }) -notcontains $false -and [int]$web -gt 0) (($contents -join '/') + " web=$web")
docker exec $dbContainer psql -U postgres -d daubert_global -c "CREATE TABLE IF NOT EXISTS public.joint_rollback_marker(id serial PRIMARY KEY, note text, at timestamptz DEFAULT now()); INSERT INTO public.joint_rollback_marker(note) VALUES ('$runId');" | Out-Null
$m1 = (docker exec $dbContainer psql -U postgres -d daubert_global -t -A -c "SELECT count(*) FROM public.joint_rollback_marker WHERE note = '$runId'").Trim()
Check 'a row written to the database while the new release runs' ($m1 -eq '1') $m1

# ================================================================== 4. ROLLBACK of api and web while the gate stays closed (same commands as the checklist, rehearsal prefix)
$probeB = Start-Probe 'rollback'
foreach ($svc in 'api', 'web') {
  docker image inspect "${img}-${svc}:failed-$newCommit" 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { throw "failed-$newCommit already exists" }
  docker tag "${img}-${svc}:latest" "${img}-${svc}:failed-$newCommit"
  docker tag "${img}-${svc}:rollback-$prev" "${img}-${svc}:latest"
}
docker compose @cfOldGate up -d --no-build api web
if ($LASTEXITCODE -ne 0) { throw 'compose up (rollback) failed' }
$h2 = WaitHealthy $prev
Start-Sleep -Seconds 3
$duringRollback = Stop-Probe $probeB
Check 'ROLLBACK: health reports the previous commit again' ($h2.commit -eq $prev) "commit=$($h2.commit)"
Check 'DURING the rollback every Pagos probe was 503 or a refused connection; never answered by the API (and the probes did observe 503)' (($duringRollback -notmatch '(^| )(?!503=|000=)\d{3}=') -and ($duringRollback -match '503=')) $duringRollback
$afterRollback = $closed | ForEach-Object { Code $_[0] $_[1] }
Check 'AFTER the rollback the Pagos gate is still closed' (($afterRollback | Where-Object { $_ -ne '503' }).Count -eq 0) ($afterRollback -join ',')
$m2 = (docker exec $dbContainer psql -U postgres -d daubert_global -t -A -c "SELECT count(*) FROM public.joint_rollback_marker WHERE note = '$runId'").Trim()
Check 'ROLLBACK: data written while the joint release ran is still there' ($m2 -eq '1') $m2
$oldHas = docker exec "${Project}-api-1" sh -c "grep -rl fn_destino_asignacion_pago_disponible /app/apps/api/dist | wc -l; grep -rl fn_autorizar_regeneracion_caterpillar /app/apps/api/dist | wc -l"
Check 'ROLLBACK: the previous api code is back (no Pagos 019 call, no regeneration)' ((($oldHas -split "`n") | ForEach-Object { [int]$_ -eq 0 }) -notcontains $false) ($oldHas -join '/')

# ================================================================== 5. OPEN the gate: swap the host file and reload (no container recreation)
Write-Gate $openConf
docker exec $cid nginx -t 2>$null
docker exec $cid nginx -s reload
Start-Sleep -Seconds 3
$opened = $closed | ForEach-Object { Code $_[0] $_[1] }
Check 'OPENING: swapping the host file and reloading Nginx reopens the Pagos mutations without recreating web (no 503; the API answers)' (($opened | Where-Object { $_ -eq '503' }).Count -eq 0) ($opened -join ',')

docker compose @cfOldGate stop api web | Out-Null
$results | ConvertTo-Json -Depth 3
"JOINT_DEPLOY_REHEARSAL_PASS ($($results.Count) checks); old=$prev new=$newCommit; during deploy: $duringDeploy; during rollback: $duringRollback"
