<#
.SYNOPSIS
    Read-only preflight for a Daubert Hub deployment (Windows PowerShell 5.1).

.DESCRIPTION
    Checks repository, candidate commit, runtime configuration, Docker/Compose, containers,
    ports, disk space, a recent valid PostgreSQL backup, the public health endpoint and the
    backup scheduled tasks. It also classifies what the candidate commit changes with respect
    to the commit currently deployed (read from /api/health).

    It NEVER changes anything: no git fetch/pull/checkout/reset, no docker build/up/down/
    restart/rm/rmi/tag/commit, no migrations, no SQL, no n8n calls. Git runs with
    --no-optional-locks. It never prints secrets: the env file is only checked for the
    presence of non-empty variables (names, not values) and `docker compose config` runs with
    --quiet. Network use is limited to GET /api/health on the Hub's own port and
    `git ls-remote` (read-only). PostgreSQL and n8n are checked only by asking the local
    TCP table whether something is LISTENING on their ports; no connection is opened to them.

    Exit codes:
      0  apto: the candidate has Hub/Docker changes and no FAIL was found.
      1  NO apto: at least one FAIL.
      2  SIN CAMBIOS DE HUB/DOCKER: nothing to deploy. This is NOT a successful deployment and
         PROD must not be restarted just to refresh the commit shown by /api/health.

.PARAMETER Candidate
    Commit to deploy. It must be exactly HEAD, because the build takes GIT_COMMIT from HEAD.

.PARAMETER EnvFile
    Real (untracked) env file. Default: deploy\pilot.prod.env.

.PARAMETER ProjectName
    Docker Compose project of PROD. Default: daubert-hub (the real PROD project, see
    docs/deployments/2026-10-01-hub-v1-prod.md).

.PARAMETER ComposeFile
    Compose files of PROD. Default: compose.pilot.yaml and compose.prod-temp.yaml.

.PARAMETER MaxBackupAgeHours
    A deploy needs at least one valid (SHA-256 matching) published backup no older than this.
    A FREQUENT backup older than this is only a WARN. Default: 6.

.PARAMETER MinFreeGB
    Minimum free space on the repository drive. Default: 10.
#>
[CmdletBinding()]
param(
    [string]$Candidate = 'HEAD',
    [string]$EnvFile = 'deploy\pilot.prod.env',
    [string]$ProjectName = 'daubert-hub',
    [string[]]$ComposeFile = @('compose.pilot.yaml', 'compose.prod-temp.yaml'),
    [int]$MaxBackupAgeHours = 6,
    [int]$MinFreeGB = 10,
    [string]$BackupConfigPath = 'C:\ProgramData\DaubertHub\Backup\config.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $RepoRoot

$script:Results = New-Object System.Collections.Generic.List[object]
$script:deployedCommit = $null
# $true  = the candidate changes Hub/Docker files (a rebuild would be needed)
# $false = it does not (nothing to deploy); $null = could not be determined
$script:needsRebuild = $null

function Add-Result {
    param([string]$Area, [string]$Check, [ValidateSet('PASS', 'WARN', 'FAIL', 'INFO')][string]$Status, [string]$Detail = '')
    $script:Results.Add([pscustomobject]@{ Area = $Area; Check = $Check; Status = $Status; Detail = $Detail }) | Out-Null
}

function Invoke-Safe {
    # Runs a check; an unexpected exception becomes a FAIL instead of aborting the whole preflight.
    param([string]$Area, [string]$Check, [scriptblock]$Body)
    try { & $Body } catch { Add-Result $Area $Check 'FAIL' ('error inesperado: ' + $_.Exception.Message.Split("`n")[0]) }
}

function Invoke-Read {
    # Runs a read-only native command. stderr is discarded (and never turned into an exception).
    # Returns @{ Code = <exit code>; Out = <stdout lines> }.
    param([string]$Exe, [string[]]$CmdArgs)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Exe @CmdArgs 2>$null
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Out = @($out | Where-Object { $null -ne $_ }) }
}

function Get-Git {
    param([string[]]$GitArgs)
    $r = Invoke-Read 'git' (@('--no-optional-locks') + $GitArgs)
    if ($r.Code -ne 0) { throw ('git ' + ($GitArgs -join ' ') + ' fallo') }
    return $r.Out
}

function Read-EnvNames {
    # Returns @{ NAME = $true/$false (has a non-empty value) }. Values are never returned.
    param([string]$Path)
    $map = @{}
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            $value = $Matches[2].Trim().Trim('"').Trim("'")
            $map[$Matches[1]] = ($value.Length -gt 0 -and $value -ne 'CHANGE_ME')
        }
    }
    return $map
}

function Get-EnvValue {
    # Only for NON-secret keys (HUB_PORT, DB_NAME, DB_USER, API_PORT).
    param([string]$Path, [string]$Name)
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=(.*)$')) { return $Matches[1].Trim().Trim('"').Trim("'") }
    }
    return $null
}

function Test-LocalListener {
    # Local TCP table lookup only: nothing connects to the port.
    param([int]$Port)
    return (@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -gt 0)
}

$envPath = Join-Path $RepoRoot $EnvFile

# ---------------------------------------------------------------- 1. Repository
Invoke-Safe 'Repo' 'rama y arbol' {
    $branch = @(Get-Git @('branch', '--show-current'))[0]
    Add-Result 'Repo' 'rama actual' $(if ($branch -eq 'main') { 'PASS' } else { 'FAIL' }) $branch
    $dirty = @(Get-Git @('status', '--short'))
    Add-Result 'Repo' 'arbol limpio (incluye archivos sin seguimiento)' $(if ($dirty.Count -eq 0) { 'PASS' } else { 'FAIL' }) $(if ($dirty.Count -eq 0) { '' } else { ($dirty.Count.ToString() + ' cambios sin commit') })
}
Invoke-Safe 'Repo' 'commit candidato' {
    $full = @(Get-Git @('rev-parse', $Candidate))[0]
    $short = @(Get-Git @('rev-parse', '--short', $Candidate))[0]
    $head = @(Get-Git @('rev-parse', 'HEAD'))[0]
    $originMain = @(Get-Git @('rev-parse', 'origin/main'))[0]
    Add-Result 'Repo' 'candidato' 'INFO' ($short + ' (' + $full + ')')
    Add-Result 'Repo' 'candidato == HEAD (el build toma GIT_COMMIT de HEAD)' $(if ($full -eq $head) { 'PASS' } else { 'FAIL' }) $(if ($full -eq $head) { '' } else { 'el candidato no es HEAD: se desplegaria un commit distinto del validado' })
    Add-Result 'Repo' 'candidato == origin/main (ref local)' $(if ($full -eq $originMain) { 'PASS' } else { 'FAIL' }) 'se compara con la ref local; el siguiente chequeo consulta el remoto'
    $remote = Invoke-Read 'git' @('ls-remote', 'origin', 'refs/heads/main')
    if ($remote.Code -ne 0 -or $remote.Out.Count -eq 0) {
        Add-Result 'Repo' 'candidato == origin/main (remoto, ls-remote)' 'WARN' 'no se pudo consultar el remoto'
    } else {
        $remoteSha = ($remote.Out[0] -split '\s+')[0]
        Add-Result 'Repo' 'candidato == origin/main (remoto, ls-remote)' $(if ($remoteSha -eq $full) { 'PASS' } else { 'FAIL' }) ''
    }
    $tags = @(Get-Git @('tag', '--points-at', $Candidate))
    Add-Result 'Repo' 'tag de release en el candidato' $(if ($tags.Count -gt 0) { 'PASS' } else { 'WARN' }) $(if ($tags.Count -gt 0) { $tags -join ', ' } else { 'ninguno (release sin tag)' })
    $pkg = (Get-Content -LiteralPath (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json).version
    Add-Result 'Repo' 'APP_VERSION (package.json raiz)' 'INFO' $pkg
}

# ---------------------------------------------------------------- 2. Health / deployed state
Invoke-Safe 'Health' 'GET /api/health' {
    $port = $null
    if (Test-Path -LiteralPath $envPath) { $port = Get-EnvValue $envPath 'HUB_PORT' }
    if (-not $port) { $port = '8082' }
    $resp = Invoke-WebRequest -Uri ('http://localhost:' + $port + '/api/health') -UseBasicParsing -TimeoutSec 10
    $h = $resp.Content | ConvertFrom-Json
    Add-Result 'Health' 'status' $(if ($h.status -eq 'ok') { 'PASS' } else { 'FAIL' }) ([string]$h.status)
    Add-Result 'Health' 'database' $(if ($h.database -eq 'connected') { 'PASS' } else { 'FAIL' }) ([string]$h.database)
    Add-Result 'Health' 'environment' $(if ($h.environment -eq 'PRODUCTION') { 'PASS' } else { 'FAIL' }) ([string]$h.environment)
    Add-Result 'Health' 'desplegado (version / commit)' 'INFO' ([string]$h.version + ' / ' + [string]$h.commit)
    $script:deployedCommit = [string]$h.commit
}

# ---------------------------------------------------------------- 3. Candidate vs deployed
Invoke-Safe 'Delta' 'candidato vs desplegado' {
    if (-not $script:deployedCommit -or $script:deployedCommit -notmatch '^[0-9a-f]{7,40}$') {
        Add-Result 'Delta' 'commit desplegado' 'FAIL' 'no se pudo determinar desde /api/health (vacio o "unknown"); no se puede calcular el delta ni crear el ancla de rollback'
        return
    }
    $exists = Invoke-Read 'git' @('--no-optional-locks', 'cat-file', '-e', ($script:deployedCommit + '^{commit}'))
    if ($exists.Code -ne 0) { Add-Result 'Delta' 'commit desplegado en el repo' 'FAIL' ($script:deployedCommit + ' no existe localmente'); return }
    $ahead = @(Get-Git @('rev-list', '--count', ($script:deployedCommit + '..' + $Candidate)))[0]
    Add-Result 'Delta' 'commits nuevos sobre PROD' 'INFO' $ahead
    $files = @(Get-Git @('diff', '--name-only', $script:deployedCommit, $Candidate))
    $hub = @($files | Where-Object { $_ -match '^(apps/|package(-lock)?\.json$)' })
    $dock = @($files | Where-Object { $_ -match '^(docker/|compose)' })
    $mig = @($files | Where-Object { $_ -match '^database/' })
    $n8n = @($files | Where-Object { $_ -match '^n8n/' })
    $host_ = @($files | Where-Object { $_ -match '^scripts/' })
    $docs = @($files | Where-Object { $_ -match '^docs/' -or $_ -match '\.md$' })
    Add-Result 'Delta' 'Hub API/Web (apps/, package*.json)' 'INFO' ($hub.Count.ToString() + ' archivos')
    Add-Result 'Delta' 'Docker/Compose (docker/, compose*)' 'INFO' ($dock.Count.ToString() + ' archivos')
    Add-Result 'Delta' 'Migraciones PostgreSQL (database/)' 'INFO' ($mig.Count.ToString() + ' archivos')
    Add-Result 'Delta' 'n8n (n8n/)' 'INFO' ($n8n.Count.ToString() + ' archivos')
    Add-Result 'Delta' 'Scripts de host (scripts/)' 'INFO' ($host_.Count.ToString() + ' archivos (los toma el host del repo; no son parte de los contenedores)')
    Add-Result 'Delta' 'Documentacion (docs/, *.md)' 'INFO' ($docs.Count.ToString() + ' archivos')
    $script:needsRebuild = (($hub.Count + $dock.Count) -gt 0)
    Add-Result 'Delta' 'cambios de Hub/Docker (requieren reconstruir api/web)' 'INFO' $(if ($script:needsRebuild) { 'si' } else { 'no: PROD ya corre el codigo del Hub del candidato; no hay nada que desplegar' })
    Add-Result 'Delta' 'migraciones nuevas' $(if ($mig.Count -gt 0) { 'WARN' } else { 'PASS' }) $(if ($mig.Count -gt 0) { 'si: aplicar a mano con precheck/postcheck y exigir backup inmediato previo' } else { 'no' })
    Add-Result 'Delta' 'cambios de n8n' $(if ($n8n.Count -gt 0) { 'WARN' } else { 'PASS' }) $(if ($n8n.Count -gt 0) { 'si: activar workflow/credencial antes del Hub' } else { 'no' })
}

# ---------------------------------------------------------------- 4. Configuration (no secrets printed)
Invoke-Safe 'Config' 'archivo de entorno' {
    if (-not (Test-Path -LiteralPath $envPath)) { Add-Result 'Config' $EnvFile 'FAIL' 'no existe'; return }
    $ignored = Invoke-Read 'git' @('--no-optional-locks', 'check-ignore', '-q', '--', $EnvFile)
    Add-Result 'Config' ($EnvFile + ' ignorado por git') $(if ($ignored.Code -eq 0) { 'PASS' } else { 'FAIL' }) ''
    $names = Read-EnvNames $envPath
    $required = 'HUB_PORT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'API_PORT', 'CATERPILLAR_REPROCESS_WEBHOOK_URL', 'CATERPILLAR_REPROCESS_WEBHOOK_TOKEN'
    $recommended = 'AUTH_COOKIE_SECURE', 'PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL', 'PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN'
    $missing = @($required | Where-Object { -not ($names.ContainsKey($_) -and $names[$_]) })
    Add-Result 'Config' 'variables obligatorias con valor' $(if ($missing.Count -eq 0) { 'PASS' } else { 'FAIL' }) $(if ($missing.Count -eq 0) { ($required.Count.ToString() + ' presentes') } else { 'faltan: ' + ($missing -join ', ') })
    $missingRec = @($recommended | Where-Object { -not ($names.ContainsKey($_) -and $names[$_]) })
    Add-Result 'Config' 'variables de compose.prod-temp.yaml' $(if ($missingRec.Count -eq 0) { 'PASS' } else { 'WARN' }) $(if ($missingRec.Count -eq 0) { 'presentes' } else { 'vacias/faltan: ' + ($missingRec -join ', ') })
    Add-Result 'Config' 'DB_NAME == daubert_global' $(if ((Get-EnvValue $envPath 'DB_NAME') -eq 'daubert_global') { 'PASS' } else { 'FAIL' }) ''
    Add-Result 'Config' 'DB_USER == daubert_hub_app' $(if ((Get-EnvValue $envPath 'DB_USER') -eq 'daubert_hub_app') { 'PASS' } else { 'FAIL' }) ''
    Add-Result 'Config' 'API_PORT == 3000' $(if ((Get-EnvValue $envPath 'API_PORT') -eq '3000') { 'PASS' } else { 'FAIL' }) ''
}
Invoke-Safe 'Config' 'archivos compose' {
    foreach ($f in $ComposeFile) {
        Add-Result 'Config' $f $(if (Test-Path -LiteralPath (Join-Path $RepoRoot $f)) { 'PASS' } else { 'FAIL' }) ''
    }
    $tracked = Invoke-Read 'git' @('--no-optional-locks', 'ls-files', '--', 'compose.prod-temp.yaml')
    Add-Result 'Config' 'compose.prod-temp.yaml no versionado (especifico de la maquina)' $(if ($tracked.Out.Count -eq 0) { 'PASS' } else { 'WARN' }) ''
}

# ---------------------------------------------------------------- 5. Docker / Compose
Invoke-Safe 'Docker' 'daemon y compose' {
    $v = Invoke-Read 'docker' @('version', '--format', '{{.Server.Version}}')
    if ($v.Code -ne 0) { Add-Result 'Docker' 'daemon' 'FAIL' 'docker no responde'; return }
    Add-Result 'Docker' 'daemon' 'PASS' ('servidor ' + ($v.Out -join ''))
    $cv = Invoke-Read 'docker' @('compose', 'version', '--short')
    Add-Result 'Docker' 'compose' $(if ($cv.Code -eq 0) { 'PASS' } else { 'FAIL' }) ($cv.Out -join '')
    if ((Test-Path -LiteralPath $envPath) -and $cv.Code -eq 0) {
        $cargs = @('compose', '--project-name', $ProjectName, '--env-file', $EnvFile)
        foreach ($f in $ComposeFile) { $cargs += @('-f', $f) }
        $cargs += @('config', '--quiet')
        $cfg = Invoke-Read 'docker' $cargs
        Add-Result 'Docker' 'compose config valida (--quiet, no imprime secretos)' $(if ($cfg.Code -eq 0) { 'PASS' } else { 'FAIL' }) ''
    }
}
Invoke-Safe 'Docker' 'contenedores PROD' {
    $r = Invoke-Read 'docker' @('ps', '-a', '--filter', ('label=com.docker.compose.project=' + $ProjectName), '--format', '{{.Names}}|{{.Status}}')
    $api = @($r.Out | Where-Object { $_ -match '-api-1\|' })
    $web = @($r.Out | Where-Object { $_ -match '-web-1\|' })
    Add-Result 'Docker' 'api healthy' $(if ($api.Count -eq 1 -and $api[0] -match '\(healthy\)') { 'PASS' } else { 'FAIL' }) $(if ($api.Count -eq 1) { ($api[0] -split '\|')[1] } else { 'no encontrado' })
    Add-Result 'Docker' 'web running' $(if ($web.Count -eq 1 -and $web[0] -match '\|Up ') { 'PASS' } else { 'FAIL' }) $(if ($web.Count -eq 1) { ($web[0] -split '\|')[1] } else { 'no encontrado' })
}
Invoke-Safe 'Rollback' 'imagenes en ejecucion preservables' {
    # With the containerd image store, `docker inspect <container> .Image` is NOT an addressable image
    # ID for every container (it is not for `web`). The reliable comparison is the manifest digest the
    # container was created from versus the manifest of the local <project>-<service>:latest tag.
    # If they match, tagging by NAME preserves exactly the running image. If they do not match (or
    # cannot be read), the running image cannot be guaranteed for rollback: FAIL when a rebuild is
    # needed (or unknown), WARN when there is nothing to deploy.
    $sev = if ($script:needsRebuild -eq $false) { 'WARN' } else { 'FAIL' }
    foreach ($svc in 'api', 'web') {
        $cname = $ProjectName + '-' + $svc + '-1'
        $image = $ProjectName + '-' + $svc + ':latest'
        $c = Invoke-Read 'docker' @('inspect', $cname, '--format', '{{if .ImageManifestDescriptor}}{{.ImageManifestDescriptor.digest}}{{end}}')
        $t = Invoke-Read 'docker' @('image', 'inspect', $image, '--platform', 'linux/amd64', '--format', '{{.Id}}')
        $cd = ($c.Out -join '')
        $td = ($t.Out -join '')
        if ($c.Code -ne 0 -or -not $cd -or $t.Code -ne 0 -or -not $td) {
            Add-Result 'Rollback' ($svc + ': imagen en ejecucion == ' + $image) $sev 'no se pudo leer el digest del contenedor o de la imagen; el ancla de rollback no esta garantizada'
        } elseif ($cd -eq $td) {
            Add-Result 'Rollback' ($svc + ': imagen en ejecucion == ' + $image) 'PASS' ('manifiesto ' + $cd.Substring(7, 12) + ': se puede preservar etiquetando ' + $image)
        } else {
            Add-Result 'Rollback' ($svc + ': imagen en ejecucion == ' + $image) $sev ('el contenedor (' + $cd.Substring(7, 12) + ') no corre la imagen etiquetada (' + $td.Substring(7, 12) + '); no se puede preservar por nombre')
        }
    }
    if ($script:deployedCommit -match '^[0-9a-f]{7,40}$') {
        foreach ($svc in 'api', 'web') {
            $anchor = $ProjectName + '-' + $svc + ':rollback-' + $script:deployedCommit
            $a = Invoke-Read 'docker' @('image', 'inspect', $anchor, '--format', '{{.Id}}')
            Add-Result 'Rollback' ('ancla ' + $anchor) 'INFO' $(if ($a.Code -eq 0) { 'ya existe (no se debe sobrescribir)' } else { 'no existe todavia: se crea en PRE-DEPLOY' })
        }
    }
}

# ---------------------------------------------------------------- 6. Ports (local listener table only)
Invoke-Safe 'Red' 'puertos (solo tabla local de escucha)' {
    $port = 8082
    if (Test-Path -LiteralPath $envPath) { $p = Get-EnvValue $envPath 'HUB_PORT'; if ($p) { $port = [int]$p } }
    Add-Result 'Red' ('puerto del Hub ' + $port + ' escuchando') $(if (Test-LocalListener $port) { 'PASS' } else { 'FAIL' }) 'esperado mientras PROD esta arriba'
    Add-Result 'Red' 'PostgreSQL: algo escucha en 5432' $(if (Test-LocalListener 5432) { 'PASS' } else { 'FAIL' }) 'solo tabla local; no se abre conexion. La conexion api->BD ya la prueba /api/health (database: connected)'
    Add-Result 'Red' 'n8n: algo escucha en 5678' $(if (Test-LocalListener 5678) { 'PASS' } else { 'WARN' }) 'solo tabla local; no se abre conexion ni se llama a n8n'
}

# ---------------------------------------------------------------- 7. Disk
Invoke-Safe 'Disco' 'espacio libre' {
    $drive = Get-PSDrive -Name ($RepoRoot.Substring(0, 1)) -PSProvider FileSystem
    $free = [math]::Round($drive.Free / 1GB, 1)
    Add-Result 'Disco' ('libre en ' + $drive.Name + ': (min ' + $MinFreeGB + ' GB)') $(if ($free -ge $MinFreeGB) { 'PASS' } else { 'FAIL' }) ($free.ToString() + ' GB')
}

# ---------------------------------------------------------------- 8. Backups
Invoke-Safe 'Backup' 'backup reciente valido' {
    if (-not (Test-Path -LiteralPath $BackupConfigPath)) { Add-Result 'Backup' 'config.json' 'FAIL' 'no existe'; return }
    $cfg = Get-Content -LiteralPath $BackupConfigPath -Raw | ConvertFrom-Json
    $recentValid = @()
    foreach ($tier in 'FREQUENT', 'DAILY', 'MONTHLY') {
        $dir = Join-Path $cfg.backupRoot $tier
        $newest = $null
        if (Test-Path -LiteralPath $dir) { $newest = Get-ChildItem -LiteralPath $dir -Filter '*.age' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }
        if (-not $newest) { Add-Result 'Backup' $tier 'FAIL' 'sin backups publicados'; continue }
        $sidecar = Get-Item -LiteralPath ($newest.FullName + '.sha256') -ErrorAction SilentlyContinue
        $hashOk = $false
        if ($sidecar -and $sidecar.Length -gt 0) {
            $expected = ((Get-Content -LiteralPath $sidecar.FullName -Raw).Trim().Split(' ')[0]).ToLower()
            $actual = (Get-FileHash -LiteralPath $newest.FullName -Algorithm SHA256).Hash.ToLower()
            $hashOk = ($expected -eq $actual)
        }
        $ageH = [math]::Round(((Get-Date) - $newest.LastWriteTime).TotalHours, 1)
        $detail = ($newest.Name + ' | ' + $ageH + ' h | sha256 ' + $(if ($hashOk) { 'coincide' } else { 'NO coincide o sin sidecar' }))
        $status = if (-not $hashOk) { 'FAIL' } elseif ($tier -eq 'FREQUENT' -and $ageH -gt $MaxBackupAgeHours) { 'WARN' } else { 'PASS' }
        Add-Result 'Backup' ($tier + ' mas reciente') $status $detail
        if ($hashOk -and $ageH -le $MaxBackupAgeHours) { $recentValid += $tier }
    }
    Add-Result 'Backup' ('algun backup valido de hace <= ' + $MaxBackupAgeHours + ' h') $(if ($recentValid.Count -gt 0) { 'PASS' } else { 'FAIL' }) $(if ($recentValid.Count -gt 0) { 'tiers: ' + ($recentValid -join ', ') } else { 'ningun tier tiene un backup valido reciente' })
}
Invoke-Safe 'Backup' 'tareas programadas' {
    $tasks = @(Get-ScheduledTask -TaskName 'Daubert - PostgreSQL*' -ErrorAction SilentlyContinue)
    if ($tasks.Count -eq 0) { Add-Result 'Backup' 'tareas programadas' 'WARN' 'no registradas'; return }
    foreach ($t in $tasks) {
        $i = $t | Get-ScheduledTaskInfo
        $ok = ($t.State -ne 'Disabled') -and ($i.LastTaskResult -in 0, 267009, 267011)
        Add-Result 'Backup' $t.TaskName $(if ($ok) { 'PASS' } else { 'WARN' }) ('estado ' + $t.State + ', ultimo resultado ' + $i.LastTaskResult)
    }
}

# ---------------------------------------------------------------- Report
$script:Results | Format-Table Area, Check, Status, Detail -AutoSize -Wrap | Out-String -Width 220 | Write-Host
$fail = @($script:Results | Where-Object Status -eq 'FAIL').Count
$warn = @($script:Results | Where-Object Status -eq 'WARN').Count
Write-Host ('Resumen: ' + @($script:Results | Where-Object Status -eq 'PASS').Count + ' PASS, ' + $warn + ' WARN, ' + $fail + ' FAIL')
if ($fail -gt 0) { Write-Host 'PREFLIGHT: NO APTO para desplegar'; exit 1 }
if ($script:needsRebuild -eq $false) {
    Write-Host 'PREFLIGHT: SIN CAMBIOS DE HUB/DOCKER - NO HAY NADA QUE DESPLEGAR'
    Write-Host 'Esto NO es un deployment exitoso ni una recomendacion de reiniciar PROD: reconstruir solo cambiaria el commit que muestra /api/health.'
    exit 2
}
Write-Host 'PREFLIGHT: apto para desplegar (revise los WARN)'
exit 0
