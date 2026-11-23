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

    Never overwrites (fail closed, no override switch): before the first build it refuses if <prefix>-api:release-<commit> or <prefix>-web:release-<commit> already exists,
    if the manifest file already exists, or if a target tar in -SaveDir already exists. One commit = one validated build: a second build of the same commit (for example with
    -ManufacturingUi) would silently move the release tags away from the images that were validated. Use a new commit, or remove the old artefacts deliberately and record why.
    If the existence of a tag cannot be determined (Docker not reachable, unexpected error), it also refuses. Plan mode prints the conflicts as BLOQUEARIA.

.EXAMPLE
    powershell -File scripts\deploy\New-ReleaseImages.ps1 -Commit <sha> -Build -Manifest <fuera del repo>\imagenes.json
#>
[CmdletBinding()]
param(
    [string]$Commit = '',
    [switch]$Build,
    [string]$Manifest = '',
    [string]$ImagePrefix = 'daubert-hub',
    [string]$SaveDir = '',
    [switch]$ManufacturingUi,
    [string]$Repo = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Services = @('api', 'web')

# ------------------------------------------------------------------ Seams (mocked in the tests)
function Invoke-RepoGit {
    param([string]$RepoPath, [string[]]$A)
    $o = & git -C $RepoPath @A 2>$null
    if ($LASTEXITCODE -ne 0) { throw ('git ' + ($A -join ' ') + ' failed') }
    return $o
}
function Get-ReleaseTagState {
    # 'present' | 'absent' | 'unknown'. Read-only (docker image inspect). A missing image is the ONLY case reported as absent; any other failure is unknown (fail closed).
    param([string]$Tag)
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & docker image inspect $Tag --format '{{.Id}}' 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    if ($code -eq 0) { return 'present' }
    $text = (@($out) | ForEach-Object { [string]$_ }) -join ' '
    if ($text -match '(?i)no such image') { return 'absent' }
    return 'unknown'
}
function Test-ReleasePath { param([string]$Path) return (Test-Path -LiteralPath $Path) }
function Enter-ReleaseBuildLock {
    # Shared operation lock (DaubertOps.Common.psm1): two builds can never interleave between the conflict check and the publication of tags, tars and manifest.
    Import-Module (Join-Path $PSScriptRoot 'DaubertOps.Common.psm1') -Force
    return (Enter-DaubertOperationLock -Path (Get-DaubertOpsPaths).LockFile -Purpose 'New-ReleaseImages')
}
function Exit-ReleaseBuildLock { param($Handle) if ($null -ne $Handle -and (Get-Command Exit-DaubertOperationLock -ErrorAction SilentlyContinue)) { Exit-DaubertOperationLock $Handle } }

# ------------------------------------------------------------------ Pure helpers
function Get-ReleaseTag { param([string]$Prefix, [string]$Service, [string]$Short) return ($Prefix + '-' + $Service + ':release-' + $Short) }
function Get-ReleaseTarPath { param([string]$Dir, [string]$Prefix, [string]$Service, [string]$Short) return (Join-Path $Dir ($Prefix + '-' + $Service + '-release-' + $Short + '.tar')) }

function Get-ReleaseConflicts {
    # Every reason why building now would overwrite an existing artefact (or could not be proven not to). Empty list = safe to build.
    param([string]$Prefix, [string]$Short, [string]$ManifestPath, [string]$SaveDirPath)
    $conflicts = @()
    foreach ($svc in $script:Services) {
        $tag = Get-ReleaseTag $Prefix $svc $Short
        $state = Get-ReleaseTagState $tag
        if ($state -eq 'present') { $conflicts += ('la etiqueta ' + $tag + ' ya existe: no se sobrescribe una imagen de release') }
        elseif ($state -ne 'absent') { $conflicts += ('no se pudo comprobar si existe la etiqueta ' + $tag + ' (Docker no responde o error inesperado)') }
    }
    if ($ManifestPath -and (Test-ReleasePath $ManifestPath)) { $conflicts += ('el manifiesto ' + $ManifestPath + ' ya existe: no se sobrescribe') }
    if ($SaveDirPath) {
        foreach ($svc in $script:Services) {
            $tar = Get-ReleaseTarPath $SaveDirPath $Prefix $svc $Short
            if (Test-ReleasePath $tar) { $conflicts += ('el archivo ' + $tar + ' ya existe: no se sobrescribe') }
        }
    }
    return $conflicts
}

# ------------------------------------------------------------------ Build (same steps as before; only the manifest write became create-new)
function Invoke-ReleaseBuild {
    param([string]$RepoPath, [string]$Full, [string]$Short, [string]$Version, [bool]$Ui, [string]$Prefix, [string]$ManifestPath, [string]$SaveDirPath)
    $work = Join-Path ([System.IO.Path]::GetTempPath()) ('release-src-' + $Short + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
        $tar = Join-Path $work 'src.tar'
        & git -C $RepoPath archive --format=tar -o $tar $Full
        if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
        $src = Join-Path $work 'src'; New-Item -ItemType Directory -Path $src | Out-Null
        & tar -xf $tar -C $src
        if ($LASTEXITCODE -ne 0) { throw 'tar extract failed' }
        $entries = @()
        foreach ($svc in $script:Services) {
            $tag = Get-ReleaseTag $Prefix $svc $Short
            $args_ = @('build', '-f', (Join-Path $src ('docker/' + $svc + '.Dockerfile')), '-t', $tag, '--label', ('org.opencontainers.image.revision=' + $Full), '--label', ('org.opencontainers.image.version=' + $Version))
            if ($svc -eq 'api') { $args_ += @('--build-arg', ('APP_VERSION=' + $Version), '--build-arg', ('GIT_COMMIT=' + $Short)) }
            else { $args_ += @('--build-arg', ('VITE_MANUFACTURING_UI=' + $Ui.ToString().ToLower()), '--build-arg', ('VITE_MANUFACTURING_DOCUMENTS=' + $Ui.ToString().ToLower())) }
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
            if ($SaveDirPath) {
                New-Item -ItemType Directory -Force -Path $SaveDirPath | Out-Null
                $tarOut = Get-ReleaseTarPath $SaveDirPath $Prefix $svc $Short
                # Save to a temporary name, then move without overwriting: an existing tar is never replaced, even if it appeared after the pre-build check.
                $tarTmp = $tarOut + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
                & docker save -o $tarTmp $tag
                if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $tarTmp -Force -ErrorAction SilentlyContinue; throw ('docker save failed for ' + $svc) }
                try { [System.IO.File]::Move($tarTmp, $tarOut) } catch { Remove-Item -LiteralPath $tarTmp -Force -ErrorAction SilentlyContinue; throw ('el archivo ' + $tarOut + ' ya existe: no se sobrescribe') }
                $e.tarSha256 = (Get-FileHash -LiteralPath $tarOut -Algorithm SHA256).Hash.ToLower()
            }
            $entries += [pscustomobject]$e
        }
        $doc = [ordered]@{ formato = '1'; commit = $Full; version = $Version; interfazManufacturaCompilada = $Ui; imagenes = $entries }
        $json = ($doc | ConvertTo-Json -Depth 6) -replace "`r`n", "`n"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ManifestPath) | Out-Null
        # CreateNew: even if the manifest appeared after the pre-build check, it is never overwritten.
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($json + "`n")
        $fs = [System.IO.File]::Open($ManifestPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
        $sha = (Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLower()
        Write-Host ('Manifiesto  : ' + $ManifestPath)
        Write-Host ('SHA-256 del manifiesto (registrar fuera del repositorio): ' + $sha)
    } finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}

# ------------------------------------------------------------------ Main
function Invoke-ReleaseImagesMain {
    # Returns the process exit code: 0 plan shown or build done; 1 refused (conflicts, bad arguments).
    param([hashtable]$P)
    if (-not $P.Commit) { Write-Host 'Falta -Commit <sha>.'; return 1 }
    $repoPath = $P.Repo
    if (-not $repoPath) { $repoPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')) }
    $full = [string](Invoke-RepoGit $repoPath @('rev-parse', '--verify', ($P.Commit + '^{commit}')) | Select-Object -First 1)
    $short = $full.Substring(0, 7)
    $pkg = (Invoke-RepoGit $repoPath @('show', ($full + ':package.json')) | Out-String) | ConvertFrom-Json
    $version = [string]$pkg.version
    $ui = [bool]$P.ManufacturingUi
    Write-Host ('Commit      : ' + $full)
    Write-Host ('Version     : ' + $version)
    Write-Host ('Imagenes    : ' + (Get-ReleaseTag $P.ImagePrefix 'api' $short) + ' , ' + (Get-ReleaseTag $P.ImagePrefix 'web' $short))
    Write-Host ('UI Manufactura compilada en web: ' + $ui + ' (por omision false)')

    if ($P.Build) {
        if (-not $P.Manifest) { Write-Host '-Manifest (ruta fuera del repositorio) es obligatorio con -Build.'; return 1 }
        if ([System.IO.Path]::GetFullPath($P.Manifest).StartsWith(($repoPath.TrimEnd('\') + '\'), [System.StringComparison]::OrdinalIgnoreCase)) { Write-Host 'El manifiesto debe quedar FUERA del repositorio.'; return 1 }
    }
    if (-not $P.Build) {
        foreach ($c in @(Get-ReleaseConflicts $P.ImagePrefix $short $P.Manifest $P.SaveDir)) { Write-Host ('BLOQUEARIA: ' + $c) }
        Write-Host 'Plan solamente. Use -Build para construir.'
        return 0
    }
    $lock = $null
    try {
        try { $lock = Enter-ReleaseBuildLock } catch { Write-Host ('NO SE CONSTRUYE NADA: ' + $_.Exception.Message); return 1 }
        $conflicts = @(Get-ReleaseConflicts $P.ImagePrefix $short $P.Manifest $P.SaveDir)
        if ($conflicts.Count -gt 0) {
            Write-Host 'NO SE CONSTRUYE NADA (nada se sobrescribe):'
            foreach ($c in $conflicts) { Write-Host ('  - ' + $c) }
            return 1
        }
        Invoke-ReleaseBuild $repoPath $full $short $version $ui $P.ImagePrefix $P.Manifest $P.SaveDir
        return 0
    } finally { Exit-ReleaseBuildLock $lock }
}

# Dot-sourcing (tests) only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-ReleaseImagesMain @{ Commit = $Commit; Build = [bool]$Build; Manifest = $Manifest; ImagePrefix = $ImagePrefix; SaveDir = $SaveDir; ManufacturingUi = [bool]$ManufacturingUi; Repo = $Repo })
}
