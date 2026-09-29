#Requires -Version 5.1
<#
    BackupRetention.psm1
    Aplica retención por tier basada en el timestamp EMBEBIDO en el nombre de
    archivo (no en la fecha de modificación del filesystem, que puede
    alterarse al copiar/sincronizar con Dropbox). Nunca borra:
      - archivos fuera de BackupRoot (comprobación defensiva de ruta);
      - archivos cuyo nombre no coincide exactamente con el patrón del tier;
      - archivos cuyo timestamp no se puede parsear con certeza.
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupNaming.psm1') -DisableNameChecking

function Get-RetentionCutoffDate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Days', 'Months')]
        [string]$RetentionUnit,

        [Parameter(Mandatory = $true)]
        [int]$RetentionValue,

        [datetime]$Now = (Get-Date)
    )

    if ($RetentionUnit -eq 'Days') {
        return $Now.AddDays(-1 * $RetentionValue)
    }
    return $Now.AddMonths(-1 * $RetentionValue)
}

function Test-PathIsWithinRoot {
    <#
        Comprobación defensiva de ruta: $Path debe resolver a una ubicación
        dentro de $Root (comparación de rutas absolutas normalizadas,
        insensible a mayúsculas en Windows). No sigue symlinks de forma
        especial: si el path resuelto queda fuera de $Root, se rechaza.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $pathFull = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')

    return ($pathFull -eq $rootFull) -or $pathFull.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Invoke-BackupRetention {
    <#
        .PARAMETER DryRun
        Si está presente, calcula y devuelve qué se borraría (WouldDelete)
        sin eliminar ningún archivo.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$BackupRoot,

        [Parameter(Mandatory = $true)]
        [string]$TargetDir,

        [Parameter(Mandatory = $true)]
        [string]$Pattern,

        [Parameter(Mandatory = $true)]
        [datetime]$CutoffDate,

        [switch]$DryRun
    )

    if (-not (Test-PathIsWithinRoot -Path $TargetDir -Root $BackupRoot)) {
        throw "Retención abortada: '$TargetDir' no está dentro de BackupRoot ('$BackupRoot')."
    }

    $kept = New-Object System.Collections.Generic.List[string]
    $deleted = New-Object System.Collections.Generic.List[string]
    $wouldDelete = New-Object System.Collections.Generic.List[string]

    if (-not (Test-Path -LiteralPath $TargetDir -PathType Container)) {
        return [pscustomobject]@{
            Deleted     = $deleted.ToArray()
            WouldDelete = $wouldDelete.ToArray()
            Kept        = $kept.ToArray()
            DryRun      = [bool]$DryRun
        }
    }

    $candidates = Get-ChildItem -LiteralPath $TargetDir -File | Where-Object { $_.Name -match $Pattern }

    foreach ($file in $candidates) {
        $match = [regex]::Match($file.Name, $Pattern)
        $timestampText = $match.Groups['timestamp'].Value
        $fileDate = ConvertFrom-BackupTimestamp -Timestamp $timestampText

        if ($null -eq $fileDate) {
            # No se pudo determinar la fecha con certeza: nunca se borra.
            $kept.Add($file.FullName)
            continue
        }

        if ($fileDate -ge $CutoffDate) {
            $kept.Add($file.FullName)
            continue
        }

        # Segunda comprobación defensiva, ahora sobre el archivo concreto.
        if (-not (Test-PathIsWithinRoot -Path $file.FullName -Root $BackupRoot)) {
            $kept.Add($file.FullName)
            continue
        }

        if ($DryRun) {
            $wouldDelete.Add($file.FullName)
        }
        else {
            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
            $sidecar = "$($file.FullName).sha256"
            if (Test-Path -LiteralPath $sidecar -PathType Leaf) {
                Remove-Item -LiteralPath $sidecar -Force -ErrorAction SilentlyContinue
            }
            $deleted.Add($file.FullName)
        }
    }

    [pscustomobject]@{
        Deleted     = $deleted.ToArray()
        WouldDelete = $wouldDelete.ToArray()
        Kept        = $kept.ToArray()
        DryRun      = [bool]$DryRun
    }
}

Export-ModuleMember -Function Get-RetentionCutoffDate, Test-PathIsWithinRoot, Invoke-BackupRetention
