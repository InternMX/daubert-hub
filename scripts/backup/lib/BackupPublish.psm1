#Requires -Version 5.1
<#
    BackupPublish.psm1
    Publica un artefacto validado (dump + sidecar .sha256) desde staging al
    destino final. Solo se llama DESPUÉS de que pg_dump, pg_restore -l y el
    hash hayan tenido éxito. Nunca sobreescribe un archivo existente (los
    nombres son inequívocos por timestamp; una colisión es un error, no un
    caso a resolver silenciosamente).
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupRetention.psm1') -DisableNameChecking

function Publish-BackupArtifact {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$StagingPath,

        [Parameter(Mandatory = $true)]
        [string]$DestinationDir,

        [Parameter(Mandatory = $true)]
        [string]$BackupRoot,

        [Parameter(Mandatory = $true)]
        [string]$FileName
    )

    if (-not (Test-PathIsWithinRoot -Path $DestinationDir -Root $BackupRoot)) {
        throw "Publicación abortada: el destino '$DestinationDir' no está dentro de BackupRoot ('$BackupRoot')."
    }

    if (-not (Test-Path -LiteralPath $StagingPath -PathType Leaf)) {
        throw "Publicación abortada: no existe el archivo de staging '$StagingPath'."
    }

    if (-not (Test-Path -LiteralPath $DestinationDir)) {
        New-Item -ItemType Directory -Path $DestinationDir -Force | Out-Null
    }

    $destinationPath = Join-Path $DestinationDir $FileName
    if (Test-Path -LiteralPath $destinationPath) {
        throw "Publicación abortada: ya existe un archivo en el destino con el mismo nombre ('$destinationPath'); esto no debería ocurrir con timestamps inequívocos."
    }
    if (Test-Path -LiteralPath "$destinationPath.sha256") {
        throw "Publicación abortada: ya existe un sidecar .sha256 huérfano en el destino ('$destinationPath.sha256')."
    }

    $stagingSidecar = "$StagingPath.sha256"
    if (-not (Test-Path -LiteralPath $stagingSidecar -PathType Leaf)) {
        throw "Publicación abortada: no existe el sidecar .sha256 en staging ('$stagingSidecar'); nunca se publica un artefacto sin su hash."
    }

    Move-Item -LiteralPath $StagingPath -Destination $destinationPath -ErrorAction Stop

    try {
        Move-Item -LiteralPath $stagingSidecar -Destination "$destinationPath.sha256" -ErrorAction Stop
    }
    catch {
        # Nunca dejar un artefacto publicado sin su sidecar .sha256 (par
        # inconsistente): revertir el movimiento del artefacto principal.
        Remove-Item -LiteralPath $destinationPath -Force -ErrorAction SilentlyContinue
        throw "Publicación abortada: falló mover el sidecar .sha256 tras publicar el artefacto; se revirtió la publicación del artefacto principal. Detalle: $($_.Exception.Message)"
    }

    return $destinationPath
}

Export-ModuleMember -Function Publish-BackupArtifact
