#Requires -Version 5.1
<#
    BackupLock.psm1
    Lock exclusivo basado en archivo, con creación atómica (FileMode.CreateNew)
    para evitar ejecuciones simultáneas del backup (cualquier tier). El lock
    se libera siempre en un try/finally del llamador.
#>

Set-StrictMode -Version Latest

function Enter-BackupLock {
    <#
        .PARAMETER TimeoutSeconds
        Segundos a esperar si el lock está tomado antes de fallar. 0 = fallar
        inmediatamente (por defecto, apropiado para ejecuciones por Task
        Scheduler donde una ejecución superpuesta debe abortar, no esperar
        indefinidamente).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LockFilePath,

        [int]$TimeoutSeconds = 0,

        [int]$PollIntervalSeconds = 1
    )

    $lockDir = Split-Path -Parent $LockFilePath
    if (-not (Test-Path -LiteralPath $lockDir)) {
        New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ($true) {
        try {
            # La exclusión mutua la da FileShare.None (violación de uso compartido si otro proceso lo
            # tiene abierto), NO la existencia del archivo: OpenOrCreate + DeleteOnClose hace que el
            # sistema operativo borre el lock cuando el proceso termina por CUALQUIER motivo (kill por
            # timeout de Task Scheduler, apagado, crash). Un archivo huérfano sin dueño no bloquea nada.
            $stream = New-Object System.IO.FileStream(
                $LockFilePath,
                [System.IO.FileMode]::OpenOrCreate,
                [System.IO.FileAccess]::ReadWrite,
                [System.IO.FileShare]::None,
                4096,
                [System.IO.FileOptions]::DeleteOnClose
            )
            $stream.SetLength(0)
            $writer = New-Object System.IO.StreamWriter($stream)
            $writer.WriteLine("pid=$PID")
            $writer.WriteLine("started_utc=$((Get-Date).ToUniversalTime().ToString('o'))")
            $writer.Flush()

            return [pscustomobject]@{
                Path   = $LockFilePath
                Stream = $stream
                Writer = $writer
            }
        }
        catch [System.IO.IOException], [System.UnauthorizedAccessException] {
            # UnauthorizedAccess: el otro proceso está liberando el lock (archivo pendiente de borrado).
            if ((Get-Date) -ge $deadline) {
                throw "No se pudo adquirir el lock de backup en '$LockFilePath': hay una ejecución en curso."
            }
            Start-Sleep -Seconds $PollIntervalSeconds
        }
    }
}

function Exit-BackupLock {
    [CmdletBinding()]
    param(
        [psobject]$LockHandle
    )

    if ($null -eq $LockHandle) { return }

    try { $LockHandle.Writer.Dispose() } catch { }
    try { $LockHandle.Stream.Dispose() } catch { }
    Remove-Item -LiteralPath $LockHandle.Path -Force -ErrorAction SilentlyContinue
}

Export-ModuleMember -Function Enter-BackupLock, Exit-BackupLock
