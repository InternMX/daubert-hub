# ISOLATED rehearsal of the Hub api/web update and rollback procedure of docs/operations/deployment-checklist.md.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rehearse-hub-rollback-isolated.ps1 -OldDir <deploy checkout at the PROD commit> -NewDir <candidate checkout> [-Port 18082] [-DbPort 55433]
# It uses its OWN Compose project (daubert-hub-rbtest), its own containers, network, ports and a throw-away PostgreSQL container with random passwords. It never uses the project
# "daubert-hub", port 8082, deploy\pilot.prod.env, the production database or n8n. The only thing taken from production is the IMAGE of api/web (adds a new tag, nothing is changed
# or removed), so the "old" side is the real production build. It never runs "down", "rm", "rmi", "prune" or --remove-orphans; at the end it only STOPS its own containers.
# ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI.
param(
  [Parameter(Mandatory = $true)][string]$OldDir,
  [Parameter(Mandatory = $true)][string]$NewDir,
  [int]$Port = 18082,
  [int]$DbPort = 55433
)
$ErrorActionPreference = 'Continue'   # native stderr must not become terminating errors in Windows PowerShell 5.1; every step is checked explicitly
$project = 'daubert-hub-rbtest'
$img = 'daubert-hub-rbtest'           # image prefix produced by the rehearsal project (the PROD one is daubert-hub-<svc>)
$pgName = 'daubert-hub-rbtest-pg'
$work = Join-Path $env:TEMP 'daubert-hub-rbtest'
$results = New-Object System.Collections.ArrayList
function Check($name, $ok, $detail) { [void]$results.Add([pscustomobject]@{ check = $name; pass = [bool]$ok; detail = "$detail" }); if (-not $ok) { throw "CHECK FAILED: $name ($detail)" } }
function Health { try { Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 5 } catch { $null } }
function WaitHealthy([string]$expectCommitPrefix) {
  for ($i = 0; $i -lt 60; $i++) { $h = Health; if ($h -and $h.status -eq 'ok' -and $h.database -eq 'connected' -and ([string]$h.commit).StartsWith($expectCommitPrefix)) { return $h }; Start-Sleep -Seconds 3 }
  throw "health did not report commit $expectCommitPrefix"
}
function Pg([string]$sql) { $env:PGPASSWORD = $script:dbPass; try { & 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -q -t -A -h 127.0.0.1 -p $DbPort -U postgres -d daubert_global -v ON_ERROR_STOP=1 -c $sql } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } }

# Guards: nothing production-like may be used.
if ($project -eq 'daubert-hub' -or $Port -eq 8082 -or $DbPort -in 5432, 5433, 55432) { throw 'Refusing production-like names or ports' }
foreach ($d in @($OldDir, $NewDir)) { if (-not (Test-Path -LiteralPath (Join-Path $d 'compose.pilot.yaml'))) { throw "compose.pilot.yaml not found in $d" } }
if (-not (Test-Path -LiteralPath (Join-Path $OldDir 'compose.prod-temp.yaml'))) { throw 'compose.prod-temp.yaml not found in OldDir (read only)' }
foreach ($p in @($Port, $DbPort)) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { throw "port $p is already in use" } }
$null = New-Item -ItemType Directory -Force -Path $work
$dbPass = [guid]::NewGuid().ToString('N'); $appPass = [guid]::NewGuid().ToString('N'); $token = [guid]::NewGuid().ToString('N')

# 0. Old side = the real production images, tagged under the rehearsal names.
foreach ($svc in 'api', 'web') { docker image inspect "daubert-hub-${svc}:latest" *> $null; if ($LASTEXITCODE -ne 0) { throw "daubert-hub-${svc}:latest not found" }; docker tag "daubert-hub-${svc}:latest" "${img}-${svc}:latest" }
$oldCommitEnv = (docker image inspect "${img}-api:latest" --format '{{range .Config.Env}}{{println .}}{{end}}' | Where-Object { $_ -like 'GIT_COMMIT=*' }) -replace 'GIT_COMMIT=', ''
Check 'old (production) image carries a commit' ($oldCommitEnv -match '^[0-9a-f]{7,40}$') $oldCommitEnv

# 1. Throw-away database container (random passwords, bound to this machine only through the published port).
docker run -d --name $pgName -e "POSTGRES_PASSWORD=$dbPass" -e POSTGRES_DB=daubert_global -p "${DbPort}:5432" postgres:18-alpine | Out-Null
if ($LASTEXITCODE -ne 0) { throw "database container failed to start" }
for ($i = 0; $i -lt 40; $i++) { try { if ((Pg 'SELECT 1') -eq '1') { break } } catch { }; Start-Sleep -Seconds 2 }
Pg "CREATE ROLE daubert_hub_app LOGIN PASSWORD '$appPass'; GRANT ALL ON SCHEMA public TO daubert_hub_app;" | Out-Null
Pg "CREATE TABLE public.rollback_marker(id serial PRIMARY KEY, note text, at timestamptz DEFAULT now()); GRANT ALL ON public.rollback_marker TO daubert_hub_app; GRANT USAGE ON SEQUENCE public.rollback_marker_id_seq TO daubert_hub_app;" | Out-Null
Check 'isolated database ready' ((Pg 'SELECT current_database()') -eq 'daubert_global') ''

# 2. Rehearsal environment file (nothing from deploy\pilot.prod.env).
$envFile = Join-Path $work 'rb.env'
@("DB_HOST=host.docker.internal", "DB_PORT=$DbPort", "DB_NAME=daubert_global", "DB_USER=daubert_hub_app", "DB_PASSWORD=$appPass", "API_PORT=3000", "HUB_PORT=$Port",
  "CATERPILLAR_REPROCESS_WEBHOOK_URL=http://host.docker.internal:59999/webhook/cat-reprocess", "CATERPILLAR_REPROCESS_WEBHOOK_TOKEN=$token", "AUTH_COOKIE_SECURE=false") | Set-Content -Encoding ASCII -LiteralPath $envFile
$prodTemp = Join-Path $work 'compose.prod-temp.yaml'; Copy-Item -LiteralPath (Join-Path $OldDir 'compose.prod-temp.yaml') -Destination $prodTemp

# 3. Start the OLD release exactly like production does (no build, images by tag).
$cfOld = @('--project-name', $project, '--env-file', $envFile, '-f', (Join-Path $OldDir 'compose.pilot.yaml'), '-f', $prodTemp)
docker compose @cfOld up -d --no-build api web
if ($LASTEXITCODE -ne 0) { throw "compose up (old) failed" }
$h0 = WaitHealthy $oldCommitEnv
Check 'OLD release healthy in the isolated project' ($h0.status -eq 'ok') "version=$($h0.version) commit=$($h0.commit)"

# 4. Rollback anchors, exactly as in the checklist (prefix changed to the rehearsal one).
$prev = [string]$h0.commit
if ($prev -notmatch '^[0-9a-f]{7,40}$') { throw "Commit desplegado invalido: '$prev'" }
foreach ($svc in 'api', 'web') {
  $anchor = "${img}-${svc}:rollback-$prev"
  docker image inspect $anchor 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { throw "${anchor} ya existe: no se sobrescribe" }
  $run = docker inspect "${project}-${svc}-1" --format '{{.ImageManifestDescriptor.digest}}'
  $tag = docker image inspect "${img}-${svc}:latest" --platform linux/amd64 --format '{{.Id}}'
  if (-not $run -or $run -ne $tag) { throw "${svc}: la imagen en ejecucion no es ${img}-${svc}:latest; no hay ancla fiable" }
  docker tag "${img}-${svc}:latest" $anchor
  $chk = docker image inspect $anchor --platform linux/amd64 --format '{{.Id}}'
  if ($chk -ne $run) { throw "${anchor} no apunta al manifiesto en ejecucion" }
  Check "anchor ${anchor} points to the running image" ($chk -eq $run) $run
}

# 5. Deploy the NEW release (build from the candidate checkout, same flags as production).
Push-Location $NewDir
try {
  $newCommit = (git rev-parse --short HEAD); $env:APP_VERSION = (node -p "require('./package.json').version"); $env:GIT_COMMIT = $newCommit
  $cfNew = @('--project-name', $project, '--env-file', $envFile, '-f', (Join-Path $NewDir 'compose.pilot.yaml'), '-f', $prodTemp)
  docker compose @cfNew up -d --build api web
  if ($LASTEXITCODE -ne 0) { throw "compose up --build (new) failed" }
} finally { Pop-Location }
$h1 = WaitHealthy $newCommit
Check 'NEW release healthy' ($h1.status -eq 'ok' -and $h1.commit -ne $prev) "version=$($h1.version) commit=$($h1.commit)"
$newHas = docker exec "${project}-api-1" sh -c "grep -rl 'ADMISSION_REJECTED' /app/apps/api/dist | wc -l; grep -rl 'fn_autorizar_regeneracion_caterpillar' /app/apps/api/dist | wc -l; grep -rl 'fn_cancelar_remision_caterpillar' /app/apps/api/dist | wc -l"
$newWeb = docker exec "${project}-web-1" sh -c "grep -rl 'Regenerar' /usr/share/nginx/html | wc -l"
Check 'NEW api/web contain ADMISSION_REJECTED, regeneration, cancellation and the Regenerar UI' ((($newHas -split "`n") | ForEach-Object { [int]$_ -gt 0 }) -notcontains $false -and [int]$newWeb -gt 0) ("api=" + ($newHas -join '/') + " web=$newWeb")

# 6. Data written while the NEW release is running (stands for emitted remissions: it must survive the image rollback).
Pg "INSERT INTO public.rollback_marker(note) VALUES ('written while NEW release ran');" | Out-Null
$markers = [int](Pg 'SELECT count(*) FROM public.rollback_marker')
Check 'marker row written under the NEW release' ($markers -eq 1) $markers

# 7. ROLLBACK, exactly as in the checklist (prefix changed). No "down".
$new = $env:GIT_COMMIT
foreach ($v in $prev, $new) { if ($v -notmatch '^[0-9a-f]{7,40}$') { throw "Commit invalido: '$v'" } }
foreach ($svc in 'api', 'web') {
  docker image inspect "${img}-${svc}:rollback-$prev" 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Falta el ancla ${img}-${svc}:rollback-${prev}" }
  docker image inspect "${img}-${svc}:failed-$new" 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { throw "${img}-${svc}:failed-$new ya existe: no se sobrescribe" }
}
foreach ($svc in 'api', 'web') {
  docker tag "${img}-${svc}:latest" "${img}-${svc}:failed-$new"
  docker tag "${img}-${svc}:rollback-$prev" "${img}-${svc}:latest"
}
docker compose @cfOld up -d --no-build api web
if ($LASTEXITCODE -ne 0) { throw "compose up (old) failed" }
$h2 = WaitHealthy $prev
Check 'ROLLBACK: health reports the previous commit again' ($h2.commit -eq $prev) "version=$($h2.version) commit=$($h2.commit)"
$oldHas = docker exec "${project}-api-1" sh -c "grep -rl 'fn_autorizar_regeneracion_caterpillar' /app/apps/api/dist | wc -l"
$oldWeb = docker exec "${project}-web-1" sh -c "grep -rl 'Regenerar' /usr/share/nginx/html | wc -l"
Check 'ROLLBACK: the previous api/web code is back (no regeneration in api, no Regenerar in web)' ([int]$oldHas -eq 0 -and [int]$oldWeb -eq 0) "api=$oldHas web=$oldWeb"
Check 'ROLLBACK: the failed image is preserved under failed-<commit>' ($true) ((docker image ls "${img}-api" --format '{{.Tag}}') -join ',')
$markers2 = [int](Pg 'SELECT count(*) FROM public.rollback_marker')
Check 'ROLLBACK: data written while the NEW release ran is still there (images roll back, data does not)' ($markers2 -eq 1) $markers2
$ps = docker compose @cfOld ps --format '{{.Service}} {{.State}} {{.Health}}'
Check 'only api and web exist in the rehearsal project (no orphans touched)' (($ps | Measure-Object).Count -eq 2) ($ps -join ' | ')

# 8. Stop (not remove) the rehearsal containers.
docker compose @cfOld stop api web | Out-Null
docker stop $pgName | Out-Null
$results | ConvertTo-Json -Depth 3
"HUB_ROLLBACK_REHEARSAL_PASS ($($results.Count) checks); old=$prev new=$newCommit"
