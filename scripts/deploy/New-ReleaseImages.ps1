<#
.SYNOPSIS
    Builds the api and web images of a release FROM AN IDENTIFIED COMMIT, tags them release-<commit> (never a floating tag), and writes the images manifest used by
    Deploy-DaubertHub.ps1 -UseValidatedImages. It does NOT touch the running stack, :latest tags, databases, or any operational service.

.DESCRIPTION
    Source: `git archive <Commit>` into a temporary directory (so the build input is exactly the commit, not the working tree). Project name / image prefix default to the
    production prefix 'daubert-hub' (the names Deploy-DaubertHub.ps1 expects); a rehearsal passes -ImagePrefix to keep its images apart.
    Manifest (JSON, LF): formato, commit (full), version, imagenes[{servicio, tag, imageId, chromium, fuentes}], build args. Its SHA-256 (LF text) is printed: record it outside the repository.
    Optional -SaveDir: `docker save` each image and record the tar SHA-256 (offline promotion / reuse without rebuilding).
    Default is a plan only; -Build is required to build.

.EXAMPLE
    powershell -File scripts\deploy\New-ReleaseImages.ps1 -Commit <sha> -Build -Manifest <fuera del repo>\imagenes.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Commit,
    [switch]$Build,
    [string]$Manifest = '',
    [string]$ImagePrefix = 'daubert-hub',
    [string]$SaveDir = '',
    [switch]$ManufacturingUi,
    [string]$Repo = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
function Invoke-RepoGit { param([string[]]$A) $o = & git -C $Repo @A 2>$null; if ($LASTEXITCODE -ne 0) { throw ('git ' + ($A -join ' ') + ' failed') }; return $o }
$full = [string](Invoke-RepoGit @('rev-parse', '--verify', ($Commit + '^{commit}')) | Select-Object -First 1)
$short = $full.Substring(0, 7)
$pkg = (Invoke-RepoGit @('show', ($full + ':package.json')) | Out-String) | ConvertFrom-Json
$version = [string]$pkg.version
$ui = [bool]$ManufacturingUi
Write-Host ('Commit      : ' + $full)
Write-Host ('Version     : ' + $version)
Write-Host ('Imagenes    : ' + $ImagePrefix + '-api:release-' + $short + ' , ' + $ImagePrefix + '-web:release-' + $short)
Write-Host ('UI Manufactura compilada en web: ' + $ui + ' (por omision false)')
if (-not $Build) { Write-Host 'Plan solamente. Use -Build para construir.'; exit 0 }
if (-not $Manifest) { throw '-Manifest (ruta fuera del repositorio) es obligatorio con -Build.' }
if ($Manifest -like ($Repo + '*')) { throw 'El manifiesto debe quedar FUERA del repositorio.' }

$work = Join-Path ([System.IO.Path]::GetTempPath()) ('release-src-' + $short + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $tar = Join-Path $work 'src.tar'
    & git -C $Repo archive --format=tar -o $tar $full
    if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
    $src = Join-Path $work 'src'; New-Item -ItemType Directory -Path $src | Out-Null
    & tar -xf $tar -C $src
    if ($LASTEXITCODE -ne 0) { throw 'tar extract failed' }
    $entries = @()
    foreach ($svc in 'api', 'web') {
        $tag = $ImagePrefix + '-' + $svc + ':release-' + $short
        $args_ = @('build', '-f', (Join-Path $src ('docker/' + $svc + '.Dockerfile')), '-t', $tag, '--label', ('org.opencontainers.image.revision=' + $full), '--label', ('org.opencontainers.image.version=' + $version))
        if ($svc -eq 'api') { $args_ += @('--build-arg', ('APP_VERSION=' + $version), '--build-arg', ('GIT_COMMIT=' + $short)) }
        else { $args_ += @('--build-arg', ('VITE_MANUFACTURING_UI=' + $ui.ToString().ToLower()), '--build-arg', ('VITE_MANUFACTURING_DOCUMENTS=' + $ui.ToString().ToLower())) }
        $args_ += $src
        Write-Host ('--- docker build ' + $tag)
        & docker @args_
        if ($LASTEXITCODE -ne 0) { throw ('docker build failed for ' + $svc) }
        $id = [string]((& docker image inspect $tag --format '{{.Id}}') | Select-Object -First 1)
        $e = [ordered]@{ servicio = $svc; tag = $tag; imageId = $id }
        if ($svc -eq 'api') {
            $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            $e.chromium = [string]((& docker run --rm --entrypoint sh $tag -c 'chromium --version 2>/dev/null || echo SIN_CHROMIUM') | Select-Object -First 1)
            $e.fuentes = [string]((& docker run --rm --entrypoint sh $tag -c 'fc-list | grep -ci carlito') | Select-Object -First 1)
            $ErrorActionPreference = $prev
        }
        else {
            # SHA-256 of the nginx file INSIDE the image: the value to pass as -ExpectedOpenSha256 to Set-EntryClosure.ps1 -Action Prepare when the external default.conf is refreshed.
            # (It is NOT the hash of docker/nginx.conf in git: the build context may carry CRLF line endings.)
            $e.nginxConfSha256 = [string](((& docker run --rm --entrypoint sha256sum $tag /etc/nginx/conf.d/default.conf) | Select-Object -First 1) -split '\s+')[0]
        }
        if ($SaveDir) {
            New-Item -ItemType Directory -Force -Path $SaveDir | Out-Null
            $tarOut = Join-Path $SaveDir ($ImagePrefix + '-' + $svc + '-release-' + $short + '.tar')
            & docker save -o $tarOut $tag
            $e.tarSha256 = (Get-FileHash -LiteralPath $tarOut -Algorithm SHA256).Hash.ToLower()
        }
        $entries += [pscustomobject]$e
    }
    $doc = [ordered]@{ formato = '1'; commit = $full; version = $version; interfazManufacturaCompilada = $ui; imagenes = $entries }
    $json = ($doc | ConvertTo-Json -Depth 6) -replace "`r`n", "`n"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Manifest) | Out-Null
    [System.IO.File]::WriteAllText($Manifest, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
    $sha = (Get-FileHash -LiteralPath $Manifest -Algorithm SHA256).Hash.ToLower()
    Write-Host ('Manifiesto  : ' + $Manifest)
    Write-Host ('SHA-256 del manifiesto (registrar fuera del repositorio): ' + $sha)
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
