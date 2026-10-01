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

function Get-LatestPublishedBackup {
    <#
        Timestamp del último backup PUBLICADO VÁLIDO de un tier, o $null si no hay ninguno.
        "Válido" = archivo final <db>_<TIER>_<ts>.age (patrón Archive) CON su sidecar .sha256 no vacío.
        Un .age sin sidecar (publicación interrumpida) NO cuenta como éxito. No se abre ni se descifra
        nada: solo nombres y tamaños. El timestamp sale del nombre, no de la fecha del filesystem.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetDir,

        [Parameter(Mandatory = $true)]
        [string]$Pattern
    )

    if (-not (Test-Path -LiteralPath $TargetDir -PathType Container)) { return $null }

    $latest = $null
    foreach ($file in (Get-ChildItem -LiteralPath $TargetDir -File | Where-Object { $_.Name -match $Pattern })) {
        $sidecar = Get-Item -LiteralPath "$($file.FullName).sha256" -ErrorAction SilentlyContinue
        if ($null -eq $sidecar -or $sidecar.Length -le 0) { continue }
        $ts = ConvertFrom-BackupTimestamp -Timestamp ([regex]::Match($file.Name, $Pattern).Groups['timestamp'].Value)
        if ($null -eq $ts) { continue }
        if ($null -eq $latest -or $ts -gt $latest) { $latest = $ts }
    }
    return $latest
}

function Get-ScheduleValue {
    # Lee un campo del schedule (objeto de config.json o hashtable) sin fallar si no existe.
    param($Schedule, [string]$Name)
    if ($Schedule -is [System.Collections.IDictionary]) { return $Schedule[$Name] }
    $p = $Schedule.PSObject.Properties[$Name]
    if ($null -ne $p) { return $p.Value }
    return $null
}

function Get-BackupLastScheduledInstant {
    <#
        Función PURA. Último instante programado (<= Now) de un tier con periodo:
          - Daily:   hoy a startTime (o ayer, si todavía no llega esa hora).
          - Monthly: este mes, día dayOfMonth a startTime (o el del mes anterior, si todavía no llega).
        El schedule es el mismo de config.json (startTime "HH:mm", dayOfMonth 1-28).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Daily', 'Monthly')]
        [string]$Tier,

        [Parameter(Mandatory = $true)]
        $Schedule,

        [Parameter(Mandatory = $true)]
        [datetime]$Now
    )

    $start = [string](Get-ScheduleValue -Schedule $Schedule -Name 'startTime')
    if ($start -notmatch '^([01]\d|2[0-3]):([0-5]\d)$') { throw "schedule.startTime inválido ('$start'): se esperaba HH:mm." }
    $time = New-TimeSpan -Hours ([int]$Matches[1]) -Minutes ([int]$Matches[2])

    if ($Tier -eq 'Daily') {
        $instant = $Now.Date.Add($time)
        if ($instant -gt $Now) { $instant = $instant.AddDays(-1) }
        return $instant
    }

    $domValue = Get-ScheduleValue -Schedule $Schedule -Name 'dayOfMonth'
    $dom = if ($null -ne $domValue) { [int]$domValue } else { 1 }
    if ($dom -lt 1 -or $dom -gt 28) { throw "schedule.dayOfMonth inválido ($dom): se esperaba 1-28." }
    $instant = (New-Object System.DateTime($Now.Year, $Now.Month, $dom)).Add($time)
    if ($instant -gt $Now) { $instant = $instant.AddMonths(-1) }
    return $instant
}

function Test-BackupDue {
    <#
        Función PURA: ¿toca hacer el backup de este tier?
        Toca si NO hay ningún backup publicado válido, o si el último es anterior al último instante
        programado (Get-BackupLastScheduledInstant). Frequent no tiene periodo: siempre toca.
        Devuelve { Due, Reason, ScheduledInstant, LatestPublished }.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Frequent', 'Daily', 'Monthly')]
        [string]$Tier,

        [Parameter(Mandatory = $true)]
        $Schedule,

        [Parameter(Mandatory = $true)]
        [datetime]$Now,

        [Nullable[datetime]]$LatestPublished = $null
    )

    if ($Tier -eq 'Frequent') {
        return [pscustomobject]@{ Due = $true; Reason = 'not_applicable'; ScheduledInstant = $null; LatestPublished = $LatestPublished }
    }

    $instant = Get-BackupLastScheduledInstant -Tier $Tier -Schedule $Schedule -Now $Now
    if ($null -eq $LatestPublished) {
        return [pscustomobject]@{ Due = $true; Reason = 'no_published_backup'; ScheduledInstant = $instant; LatestPublished = $null }
    }
    if ([datetime]$LatestPublished -lt $instant) {
        return [pscustomobject]@{ Due = $true; Reason = 'latest_before_scheduled_instant'; ScheduledInstant = $instant; LatestPublished = $LatestPublished }
    }
    return [pscustomobject]@{ Due = $false; Reason = 'up_to_date'; ScheduledInstant = $instant; LatestPublished = $LatestPublished }
}

Export-ModuleMember -Function Get-RetentionCutoffDate, Test-PathIsWithinRoot, Invoke-BackupRetention, Get-LatestPublishedBackup, Get-BackupLastScheduledInstant, Test-BackupDue
