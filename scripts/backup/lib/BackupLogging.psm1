#Requires -Version 5.1
<#
    BackupLogging.psm1
    Logs estructurados (JSON Lines) con timestamp, tier, etapa, resultado y
    duración. Nunca escribe contenido de dumps, rutas de secretos ni el
    contenido de PGPASSFILE; solo metadatos operativos.
#>

Set-StrictMode -Version Latest

function New-BackupRunId {
    [CmdletBinding()]
    param()
    return [guid]::NewGuid().ToString('N')
}

function Write-BackupLogEntry {
    <#
        Escribe una línea JSON al log. $Message debe ser texto operativo
        (p.ej. "pg_dump exit code 0"), nunca contenido de archivos.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LogPath,

        [Parameter(Mandatory = $true)]
        [string]$RunId,

        [Parameter(Mandatory = $true)]
        [string]$Tier,

        [Parameter(Mandatory = $true)]
        [string]$Stage,

        [Parameter(Mandatory = $true)]
        [ValidateSet('start', 'success', 'failure', 'skipped', 'warning', 'info')]
        [string]$Result,

        [string]$Message = '',

        [Nullable[double]]$DurationMs = $null
    )

    $logDir = Split-Path -Parent $LogPath
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    $entry = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        run_id        = $RunId
        tier          = $Tier
        stage         = $Stage
        result        = $Result
        duration_ms   = $DurationMs
        message       = $Message
    }

    ($entry | ConvertTo-Json -Compress) | Add-Content -LiteralPath $LogPath -Encoding UTF8
}

function Measure-BackupStage {
    <#
        Ejecuta $ScriptBlock, registra start/success/failure con duración, y
        re-lanza cualquier excepción para que el llamador decida el flujo.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LogPath,

        [Parameter(Mandatory = $true)]
        [string]$RunId,

        [Parameter(Mandatory = $true)]
        [string]$Tier,

        [Parameter(Mandatory = $true)]
        [string]$Stage,

        [Parameter(Mandatory = $true)]
        [scriptblock]$ScriptBlock
    )

    Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Tier -Stage $Stage -Result 'start'
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $result = & $ScriptBlock
        $sw.Stop()
        Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Tier -Stage $Stage -Result 'success' -DurationMs $sw.Elapsed.TotalMilliseconds
        return $result
    }
    catch {
        $sw.Stop()
        Write-BackupLogEntry -LogPath $LogPath -RunId $RunId -Tier $Tier -Stage $Stage -Result 'failure' -DurationMs $sw.Elapsed.TotalMilliseconds -Message $_.Exception.Message
        throw
    }
}

Export-ModuleMember -Function New-BackupRunId, Write-BackupLogEntry, Measure-BackupStage
