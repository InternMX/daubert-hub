<#
.SYNOPSIS
    Supervisor of the production n8n process, meant to be launched by the Task Scheduler task
    "Daubert - n8n Supervisor" (Windows PowerShell 5.1). No NSSM/WinSW.

.DESCRIPTION
    - A global mutex prevents duplicate supervisors.
    - It waits (bounded) for the Docker daemon and Dropbox, but never blocks forever.
    - If an n8n main process already exists it ADOPTS it (it never starts a second instance) and only watches it.
    - If port 5678 is held by something that is not n8n it logs and does not start n8n.
    - Otherwise it starts n8n (node + the global npm n8n), waits for port 5678 and, if it does not come up or the
      process dies, restarts it with growing back-off.
    - Everything is logged to <LogDir>\n8n-supervisor.log (rotated at 5 MB). No secrets are ever logged.
    It does not read or change workflows or credentials, and it does not store any Windows password.
#>
[CmdletBinding()]
param(
    [string]$LogDir = 'C:\ProgramData\DaubertHub\Server\logs',
    [int]$Port = 5678,
    [int]$DependencyWaitSeconds = 180,
    [int]$PortWaitSeconds = 120,
    [int]$PollSeconds = 10,
    [int]$NodeWaitSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:MutexName = 'Global\DaubertHub-N8nSupervisor'
$script:LogFile = Join-Path $LogDir 'n8n-supervisor.log'
$script:MaxLogBytes = 5MB
$script:ResolvedNode = $null

function Get-BackoffSeconds {
    # 15 s, 30 s, 60 s, 120 s, 240 s, then 300 s.
    param([int]$Attempt)
    $d = 15 * [math]::Pow(2, [math]::Max(0, $Attempt - 1))
    return [int][math]::Min(300, $d)
}

function Test-N8nMainCommandLine {
    # The n8n main process, not its task runner.
    param([string]$CommandLine)
    return ([string]$CommandLine -match '[\\/]n8n[\\/]bin[\\/]n8n(\s|"|$)')
}

function Write-SupervisorLog {
    param([string]$Message)
    try {
        if (-not (Test-Path -LiteralPath $LogDir)) { return }
        if ((Test-Path -LiteralPath $script:LogFile) -and (Get-Item -LiteralPath $script:LogFile).Length -gt $script:MaxLogBytes) {
            Move-Item -LiteralPath $script:LogFile -Destination ($script:LogFile + '.1') -Force
        }
        Add-Content -LiteralPath $script:LogFile -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' [SUPERVISOR] ' + $Message)
    } catch { }
}

function Get-N8nMainProcess {
    return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { Test-N8nMainCommandLine $_.CommandLine })
}

function Test-PortListening {
    param([int]$TcpPort)
    return [bool](@(Get-NetTCPConnection -LocalPort $TcpPort -State Listen -ErrorAction SilentlyContinue).Count -gt 0)
}

function Wait-Until {
    # A condition that throws counts as "not yet": start-up conditions are expected to fail for a while.
    param([scriptblock]$Condition, [int]$TimeoutSeconds, [int]$IntervalSeconds = 5)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try { if (& $Condition) { return $true } } catch { }
        Start-Sleep -Seconds $IntervalSeconds
    }
    try { return [bool](& $Condition) } catch { return $false }
}

function Get-DockerPath {
    # docker.exe from PATH, else the per-user Docker Desktop install. $null while it is not there yet.
    $cmd = Get-Command docker.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd -and $cmd.Source) { return [string]$cmd.Source }
    if ($env:LOCALAPPDATA) {
        $p = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
        if (Test-Path -LiteralPath $p) { return $p }
    }
    return $null
}

function Invoke-DockerInfo {
    # Exit code of "docker info", or -1 if it could not run. Never throws: with $ErrorActionPreference = 'Stop'
    # Windows PowerShell 5.1 turns any stderr line of a native command (daemon still starting) into a
    # terminating error, so the preference is relaxed locally.
    param([string]$DockerPath)
    $ErrorActionPreference = 'Continue'
    try {
        $global:LASTEXITCODE = $null
        $null = & $DockerPath info 2>&1
        if ($null -eq $LASTEXITCODE) { return -1 }
        return [int]$LASTEXITCODE
    } catch { return -1 }
}

function Wait-DockerReady {
    # Distinguishes: CLI missing -> CLI present but daemon down -> daemon up. Returns $true when the daemon answers.
    param([int]$TimeoutSeconds)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $state = ''
    while ($true) {
        $path = Get-DockerPath
        if (-not $path) {
            if ($state -ne 'nocli') { Write-SupervisorLog 'Esperando Docker CLI (docker.exe aun no disponible)'; $state = 'nocli' }
        } elseif ((Invoke-DockerInfo $path) -eq 0) {
            return $true
        } elseif ($state -ne 'nodaemon') {
            Write-SupervisorLog 'Docker CLI encontrado pero el daemon todavia no esta disponible'; $state = 'nodaemon'
        }
        if ((Get-Date) -ge $deadline) { return $false }
        Start-Sleep -Seconds 5
    }
}

function Wait-Dependencies {
    $docker = Wait-DockerReady $DependencyWaitSeconds
    Write-SupervisorLog ('Docker daemon disponible: ' + $docker)
    $dropbox = Wait-Until { [bool](Get-Process -Name Dropbox -ErrorAction SilentlyContinue) } 60
    Write-SupervisorLog ('Dropbox en ejecucion: ' + $dropbox)
}

function Get-N8nLaunch {
    # node.exe may not be resolvable yet during logon; retry for a while before giving up this attempt.
    $script:ResolvedNode = $null
    $null = Wait-Until {
        $c = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c) { $script:ResolvedNode = [string]$c.Source; $true } else { $false }
    } $NodeWaitSeconds 5
    $node = $script:ResolvedNode
    if (-not $node) { throw 'node.exe no esta disponible todavia' }
    $n8n = Join-Path $env:APPDATA 'npm\node_modules\n8n\bin\n8n'
    if (-not (Test-Path -LiteralPath $n8n)) { throw ('No se encontro n8n en ' + $n8n) }
    return @{ Node = $node; Script = $n8n }
}

function Watch-Process {
    param([int]$ProcessId)
    while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { Start-Sleep -Seconds $PollSeconds }
}

function Invoke-Supervisor {
    $created = $false
    $mutex = New-Object System.Threading.Mutex($false, $script:MutexName, [ref]$created)
    $held = $false
    try {
        try { $held = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $held = $true }
        if (-not $held) { Write-SupervisorLog 'Ya hay un supervisor en ejecucion: esta instancia termina.'; return }
        Write-SupervisorLog ('Supervisor iniciado (PID ' + $PID + ')')
        Wait-Dependencies
        $attempt = 0
        while ($true) {
            $existing = @(Get-N8nMainProcess)
            $started = Get-Date
            if ($existing.Count -gt 0) {
                if ($existing.Count -gt 1) { Write-SupervisorLog ('ADVERTENCIA: hay ' + $existing.Count + ' procesos principales de n8n; no se inicia ninguno mas.') }
                Write-SupervisorLog ('Instancia de n8n existente adoptada (PID ' + $existing[0].ProcessId + '); no se inicia otra.')
                Watch-Process $existing[0].ProcessId
                Write-SupervisorLog 'La instancia de n8n adoptada termino.'
            } elseif (Test-PortListening $Port) {
                Write-SupervisorLog ('El puerto ' + $Port + ' esta ocupado por otro programa: no se inicia n8n. Reintento en 30 s.')
                Start-Sleep -Seconds 30
                continue
            } else {
                try {
                    $launch = Get-N8nLaunch
                    $p = Start-Process -FilePath $launch.Node -ArgumentList ('"' + $launch.Script + '"') -WindowStyle Hidden -PassThru
                    Write-SupervisorLog ('n8n iniciado (PID ' + $p.Id + ', intento ' + ($attempt + 1) + ')')
                    $up = Wait-Until { (Test-PortListening $Port) -or $p.HasExited } $PortWaitSeconds 3
                    if ($up -and -not $p.HasExited -and (Test-PortListening $Port)) {
                        Write-SupervisorLog ('n8n escucha en el puerto ' + $Port)
                        Watch-Process $p.Id
                        Write-SupervisorLog 'El proceso de n8n termino.'
                    } else {
                        Write-SupervisorLog ('n8n no llego a escuchar en ' + $Port + ' dentro de ' + $PortWaitSeconds + ' s.')
                        if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
                    }
                } catch { Write-SupervisorLog ('Error al iniciar n8n: ' + $_.Exception.Message.Split("`n")[0]) }
            }
            if (((Get-Date) - $started).TotalSeconds -gt 600) { $attempt = 1 } else { $attempt++ }
            $wait = Get-BackoffSeconds $attempt
            Write-SupervisorLog ('Reinicio en ' + $wait + ' s (intento ' + $attempt + ')')
            Start-Sleep -Seconds $wait
        }
    } finally {
        if ($held) { try { $mutex.ReleaseMutex() } catch { } }
        $mutex.Dispose()
    }
}

# Dot-sourcing (tests) only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') {
    Invoke-Supervisor
}
