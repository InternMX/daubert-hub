#Requires -Version 5.1
<#
    BackupN8nStaging.psm1
    Piezas de staging del backup de n8n:
      - inventario y copia ESTABLE de storage\ (n8n sigue escribiendo mientras se copia);
      - copia de nodes\ y lectura segura de los community packages;
      - versión de n8n;
      - manifest.json (sin rutas personales ni secretos);
      - limpieza de staging huérfano (solo bajo <StagingRoot>\n8n).

    Seams mockeables por las pruebas (para no generar cientos de archivos):
      Get-N8nDirectoryInventory, Copy-N8nDirectoryTree, Get-N8nCommunityPackage,
      Find-N8nPackageJson.
    Nunca se escribe ni se borra nada dentro de la instalación de n8n (solo se lee).
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupRetention.psm1') -DisableNameChecking

function New-N8nStagingError {
    param([string]$Message, [string]$Kind)
    $ex = New-Object System.Exception($Message)
    $ex.Data['Kind'] = $Kind
    return $ex
}

function Get-N8nDirectoryInventory {
    <#
        Inventario de archivos de un árbol: ruta RELATIVA, tamaño y LastWriteTime
        (ticks UTC), ordenado por ruta. Es el seam que las pruebas sustituyen.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return @() }
    $base = [System.IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    $items = foreach ($f in (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction Stop)) {
        [pscustomobject]@{
            Path           = $f.FullName.Substring($base.Length)
            Length         = [long]$f.Length
            LastWriteTicks = [long]$f.LastWriteTimeUtc.Ticks
        }
    }
    return @($items | Sort-Object -Property Path)
}

function Compare-N8nInventory {
    <# $true si ambos inventarios son idénticos en rutas relativas, tamaños y LastWriteTime. #>
    [CmdletBinding()]
    param($Before, $After)
    $a = @($Before)
    $b = @($After)
    if ($a.Count -ne $b.Count) { return $false }
    for ($i = 0; $i -lt $a.Count; $i++) {
        if ($a[$i].Path -ne $b[$i].Path -or $a[$i].Length -ne $b[$i].Length -or $a[$i].LastWriteTicks -ne $b[$i].LastWriteTicks) { return $false }
    }
    return $true
}

function Copy-N8nDirectoryTree {
    <#
        Copia el CONTENIDO de $Source dentro de $Destination preservando la estructura
        (incluye archivos ocultos). Solo lee de $Source. Verifica que la cantidad de
        archivos copiados coincide. Seam mockeable.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($child in (Get-ChildItem -LiteralPath $Source -Force -ErrorAction Stop)) {
        Copy-Item -LiteralPath $child.FullName -Destination $Destination -Recurse -Force -ErrorAction Stop
    }
    $expected = @(Get-ChildItem -LiteralPath $Source -Recurse -File -Force -ErrorAction Stop).Count
    $copied = @(Get-ChildItem -LiteralPath $Destination -Recurse -File -Force -ErrorAction Stop).Count
    if ($copied -ne $expected) { throw 'La copia no contiene la misma cantidad de archivos que el origen.' }
}

function Copy-N8nStorageStable {
    <#
        Copia estable de storage\ con n8n en ejecución:
          1. inventario antes de copiar; 2. copia a staging; 3. inventario después;
          4. compara rutas relativas, tamaños y LastWriteTime;
          5. si cambió durante la copia (o la copia falló por un archivo que cambió),
             elimina la copia y reintenta; 6. máximo $MaxAttempts intentos;
          7. si nunca queda estable, lanza (Data['Kind'] = 'StorageUnstable') y NO deja
             ninguna copia en $Destination.
        No detiene ni reinicia n8n. Devuelve { FileCount; SizeBytes; Attempts; StableCopy }.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [int]$MaxAttempts = 3
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue }

        $copyFailed = $false
        $before = @(Get-N8nDirectoryInventory -Path $Source)
        try { Copy-N8nDirectoryTree -Source $Source -Destination $Destination }
        catch { $copyFailed = $true }
        $after = @(Get-N8nDirectoryInventory -Path $Source)

        if (-not $copyFailed -and (Compare-N8nInventory -Before $before -After $after)) {
            $size = [long]0
            foreach ($f in $after) { $size += [long]$f.Length }
            return [pscustomobject]@{ FileCount = $after.Count; SizeBytes = $size; Attempts = $attempt; StableCopy = $true }
        }
    }

    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue }
    throw (New-N8nStagingError -Message "storage cambió durante la copia en los $MaxAttempts intentos; no se publica una copia inestable." -Kind 'StorageUnstable')
}

function Measure-N8nTree {
    <# { FileCount; SizeBytes } de un árbol ya copiado (staging). #>
    param([string]$Path)
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue)
    $size = [long]0
    foreach ($f in $files) { $size += [long]$f.Length }
    [pscustomobject]@{ FileCount = $files.Count; SizeBytes = $size }
}

function Get-N8nCommunityPackage {
    <#
        Community packages instalados, SOLO nombre y versión, leídos de
        nodes\package.json (dependencies) y nodes\node_modules\<pkg>\package.json.
        Nada de rutas ni de otros campos. Seam mockeable.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$NodesPath)

    $manifestPath = Join-Path $NodesPath 'package.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return @() }
    try { $pkg = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop } catch { return @() }
    if (-not $pkg.PSObject.Properties['dependencies'] -or $null -eq $pkg.dependencies) { return @() }

    $nameRx = '^(@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$'
    $verRx = '^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$'
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($dep in $pkg.dependencies.PSObject.Properties) {
        $name = [string]$dep.Name
        if ($name -notmatch $nameRx) { continue }
        $version = $null
        $installed = Join-Path (Join-Path (Join-Path $NodesPath 'node_modules') ($name -replace '/', '\')) 'package.json'
        if (Test-Path -LiteralPath $installed -PathType Leaf) {
            try {
                $ip = [System.IO.File]::ReadAllText($installed, [System.Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
                if ($ip.PSObject.Properties['version'] -and ([string]$ip.version) -match $verRx) { $version = [string]$ip.version }
            }
            catch { $version = $null }
        }
        if (-not $version) {
            $spec = ([string]$dep.Value).TrimStart('^', '~', '=')
            if ($spec -match $verRx) { $version = $spec }
        }
        if (-not $version) { $version = 'unknown' }
        $list.Add([pscustomobject]@{ name = $name; version = $version })
    }
    return @($list | Sort-Object -Property name)
}

function Find-N8nPackageJson {
    <#
        Localiza (solo lectura) el package.json del paquete npm de n8n: primero
        -PackagePath (config n8nPackagePath); si no, el layout global de npm junto
        al comando n8n del PATH. $null si no se encuentra. Seam mockeable.
    #>
    [CmdletBinding()]
    param([string]$PackagePath)

    if ($PackagePath) {
        $p = Join-Path $PackagePath 'package.json'
        if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    }
    $cmd = Get-Command -Name 'n8n.cmd', 'n8n' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd -and $cmd.Source) {
        $p = Join-Path (Join-Path (Join-Path (Split-Path -Parent $cmd.Source) 'node_modules') 'n8n') 'package.json'
        if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    }
    return $null
}

function Get-N8nVersion {
    <# Versión de n8n ("2.x.y") o $null si no se puede determinar. No ejecuta n8n. #>
    [CmdletBinding()]
    param([string]$PackagePath)
    $pj = Find-N8nPackageJson -PackagePath $PackagePath
    if (-not $pj) { return $null }
    try { $j = [System.IO.File]::ReadAllText($pj, [System.Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
    if ($j.PSObject.Properties['version'] -and ([string]$j.version) -match '^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$') { return [string]$j.version }
    return $null
}

function New-N8nManifest {
    <#
        manifest.json: SOLO metadata. Sin rutas absolutas, usuario de Windows,
        encryption key, contenido de config, credenciales ni tokens.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Tier,
        [Parameter(Mandatory = $true)][datetime]$CreatedAt,
        [string]$N8nVersion,
        [string]$NodeVersion,
        [Parameter(Mandatory = $true)]$Database,
        [Parameter(Mandatory = $true)]$Storage,
        [Parameter(Mandatory = $true)]$Nodes,
        [object[]]$CommunityNodes = @()
    )

    [ordered]@{
        schemaVersion  = 1
        backupType     = 'n8n'
        tier           = $Tier
        createdAtUtc   = $CreatedAt.ToUniversalTime().ToString('o')
        n8nVersion     = $(if ($N8nVersion) { $N8nVersion } else { 'unknown' })
        nodeVersion    = $(if ($NodeVersion) { $NodeVersion } else { 'unknown' })
        database       = [ordered]@{ sizeBytes = [long]$Database.SizeBytes; quickCheck = [string]$Database.QuickCheck; tableCount = [int]$Database.TableCount }
        config         = [ordered]@{ included = $true }
        storage        = [ordered]@{ included = [bool]$Storage.Included; fileCount = [int]$Storage.FileCount; sizeBytes = [long]$Storage.SizeBytes; stableCopy = [bool]$Storage.StableCopy }
        nodes          = [ordered]@{ included = [bool]$Nodes.Included; fileCount = [int]$Nodes.FileCount }
        communityNodes = @($CommunityNodes | ForEach-Object { [ordered]@{ name = [string]$_.name; version = [string]$_.version } })
    }
}

function Write-N8nManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Manifest, [Parameter(Mandatory = $true)][string]$Path)
    $json = $Manifest | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Remove-OrphanedN8nStaging {
    <#
        Elimina <N8nStagingRoot>\<RunId> (32 hex) que dejó una ejecución muerta. Solo se
        invoca con el lock de n8n adquirido. Nunca toca $KeepPath ni nada fuera de
        N8nStagingRoot (el staging de PostgreSQL vive en otra carpeta). Devuelve los nombres borrados.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$N8nStagingRoot, [string]$KeepPath)

    if (-not (Test-Path -LiteralPath $N8nStagingRoot -PathType Container)) { return @() }
    $removed = New-Object System.Collections.Generic.List[string]
    foreach ($dir in (Get-ChildItem -LiteralPath $N8nStagingRoot -Directory -ErrorAction SilentlyContinue)) {
        if ($dir.Name -notmatch '^[0-9a-f]{32}$') { continue }
        if ($KeepPath -and ($dir.FullName.TrimEnd('\') -eq $KeepPath.TrimEnd('\'))) { continue }
        if (-not (Test-PathIsWithinRoot -Path $dir.FullName -Root $N8nStagingRoot)) { continue }
        Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $dir.FullName)) { $removed.Add($dir.Name) }
    }
    return $removed.ToArray()
}

Export-ModuleMember -Function Get-N8nDirectoryInventory, Compare-N8nInventory, Copy-N8nDirectoryTree, Copy-N8nStorageStable, Measure-N8nTree, Get-N8nCommunityPackage, Find-N8nPackageJson, Get-N8nVersion, New-N8nManifest, Write-N8nManifest, Remove-OrphanedN8nStaging
