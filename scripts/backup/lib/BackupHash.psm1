#Requires -Version 5.1
<#
    BackupHash.psm1
    Genera y verifica hashes SHA-256 de los artefactos de backup. Nunca
    imprime el contenido del archivo, solo su hash.
#>

Set-StrictMode -Version Latest

function New-BackupFileHash {
    <#
        Calcula SHA-256 de $Path y escribe un sidecar "<archivo>.sha256" con
        el formato "<hash>  <nombre-de-archivo>" (compatible con
        `CertUtil -hashfile` / `sha256sum -c`). Devuelve el hash y la ruta
        del sidecar.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "No se puede calcular el hash: el archivo no existe: $Path"
    }

    $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    $fileName = Split-Path -Leaf $Path
    $sidecarPath = "$Path.sha256"

    "$hash  $fileName" | Set-Content -LiteralPath $sidecarPath -Encoding ASCII -NoNewline

    return [pscustomobject]@{
        Hash        = $hash
        SidecarPath = $sidecarPath
    }
}

function Test-BackupFileHash {
    <#
        Recalcula el hash de $Path y lo compara contra el sidecar ".sha256"
        (o contra -ExpectedHash si se provee). Devuelve $true/$false.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [string]$ExpectedHash
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    $expected = $ExpectedHash
    if ([string]::IsNullOrWhiteSpace($expected)) {
        $sidecarPath = "$Path.sha256"
        if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) {
            return $false
        }
        $line = Get-Content -LiteralPath $sidecarPath -Raw
        $expected = ($line -split '\s+')[0]
    }

    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    return ($actual -eq $expected.ToLowerInvariant())
}

Export-ModuleMember -Function New-BackupFileHash, Test-BackupFileHash
