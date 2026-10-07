<#
.SYNOPSIS
    Read-only diagnostic of the PC that acts (or will act) as Daubert Hub Server (Windows PowerShell 5.1).

.DESCRIPTION
    Inspects the HOST (not a release): Windows, network, firewall, Docker, PostgreSQL, n8n, Dropbox,
    power settings, startup/recovery, the Daubert Hub repository, TEST/PROD separation, secret files,
    storage/backups and DNS. It prints a table (Area / Check / Status / Detail), a summary and one of
    three conclusions, then the target state of a Daubert Hub Server.

    Statuses: PASS | WARN | FAIL | INFO.
    Conclusion: SERVIDOR NO PREPARADO (any FAIL) | SERVIDOR PREPARADO CON ADVERTENCIAS (WARN, no FAIL)
    | SERVIDOR PREPARADO. A successful run of the diagnostic is NOT the same as a ready server.

    Exit codes: 0 prepared | 1 not prepared (FAIL) | 2 prepared with warnings | 3 usage error.

    It is strictly READ-ONLY. Every native command goes through Invoke-DiagRead, which only accepts an
    explicit allowlist of read verbs (docker ps/inspect/info/version/network, git rev-parse/status/...,
    powercfg /query, schtasks /query, manage-bde -status) and refuses everything else BEFORE running it.
    The script never writes files, never changes configuration, services, firewall, DNS, power,
    PostgreSQL, Docker, WSL, n8n, Dropbox, tasks or users, and never prints secrets: env files are only
    read for a fixed list of non-secret keys, secret files are only inspected for existence/ACL/Git status.

    There is no -Configure, -Repair or -Uninstall: configuring the server is a later, separate step.

.PARAMETER Json
    Emit one JSON document (no table) with the checks, summary, conclusion and the network facts
    needed to configure the router (MAC, IP, gateway, DHCP).

.PARAMETER RepoPath
    Daubert Hub repository. Default: the repository that contains this script.

.PARAMETER DaubertHubHostname
    Optional name (for example hub.dauberthub.app) to test whether it currently resolves.
#>
[CmdletBinding()]
param(
    [switch]$Json,
    [string]$RepoPath,
    [string]$DaubertHubHostname,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$UnknownArguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:DefaultRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:Checks = New-Object System.Collections.ArrayList
$script:HubPort = 8082
$script:ForbiddenPorts = @(3000, 5432, 5678)
$script:ProdProject = 'daubert-hub'
$script:SafeEnvKeys = @('HUB_PORT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER')
$script:BackupTaskNames = @('Daubert - PostgreSQL Daily', 'Daubert - PostgreSQL Frequent', 'Daubert - PostgreSQL Monthly', 'Daubert - n8n Weekly')
$script:BackupTierFreshHours = @{ FREQUENT = 12; DAILY = 36; MONTHLY = 840 }
$script:ExitReady = 0
$script:ExitNotReady = 1
$script:ExitWarnings = 2
$script:ExitUsage = 3

# ================================================================== Output helpers (never print secrets)
function Protect-Line {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    $t = $Text -replace '(?i)(authorization\s*[=:]\s*(?:bearer\s+|basic\s+)?)\S+', '$1***'
    $t = $t -replace '(?i)((?:password|passwd|token|secret|api[_-]?key)\w*\s*[=:]\s*)\S+', '$1***'
    return ($t -replace '(?i)(://[^/\s:@]+:)[^@\s/]+@', '$1***@')
}

function Get-Prop {
    # StrictMode-safe property/key read: $Default when the object or the member is missing.
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $Default
    }
    if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }
    return $Default
}

function Save-Check {
    param([string]$Area, [string]$Check, [string]$Status, [string]$Detail = '')
    if (@('PASS', 'WARN', 'FAIL', 'INFO') -notcontains $Status) { throw ('Estado invalido: ' + $Status) }
    [void]$script:Checks.Add([pscustomobject]@{
            Area   = $Area
            Check  = $Check
            Status = $Status
            Detail = (Protect-Line $Detail)
        })
}

function Get-CheckStatus {
    param([string]$Area, [string]$Check)
    $hit = @($script:Checks | Where-Object { $_.Area -eq $Area -and $_.Check -eq $Check }) | Select-Object -First 1
    if ($null -eq $hit) { return $null }
    return $hit.Status
}

# ================================================================== Seams
function Test-ReadOnlyCommand {
    # Returns $null when the command is an allowed READ, otherwise the reason it is refused.
    param([string]$Exe, [string[]]$CmdArgs)
    $CmdArgs = @($CmdArgs)
    switch ($Exe) {
        'docker' {
            $first = if ($CmdArgs.Count -gt 0) { $CmdArgs[0] } else { '' }
            if (@('version', 'info', 'ps', 'inspect') -contains $first) { return $null }
            if ($first -eq 'network' -and $CmdArgs.Count -gt 1 -and @('ls', 'inspect') -contains $CmdArgs[1]) { return $null }
            if ($first -eq 'compose' -and $CmdArgs.Count -gt 1 -and @('version', 'ls') -contains $CmdArgs[1]) { return $null }
            return ('docker ' + ($CmdArgs -join ' ') + ' no es una lectura permitida')
        }
        'git' {
            $verbs = 'rev-parse', 'status', 'ls-files', 'check-ignore', 'branch', 'remote'
            $verb = @($CmdArgs | Where-Object { $_ -ne '--no-optional-locks' })
            $at = [array]::IndexOf($CmdArgs, '-C')
            if ($at -ge 0) { $verb = @($CmdArgs | Select-Object -Skip ($at + 2) | Where-Object { $_ -ne '--no-optional-locks' }) }
            $v = if ($verb.Count -gt 0) { $verb[0] } else { '' }
            if ($verbs -notcontains $v) { return ('git ' + $v + ' no es una lectura permitida') }
            if ($v -eq 'branch' -and ($verb | Where-Object { $_ -match '^-(d|D|m|M|c|C)$|--delete|--move|--copy' })) { return 'git branch con cambios no permitido' }
            if ($v -eq 'remote' -and $verb.Count -gt 1 -and @('get-url', '-v') -notcontains $verb[1]) { return 'git remote solo permite get-url y -v' }
            return $null
        }
        'powercfg' {
            $first = if ($CmdArgs.Count -gt 0) { $CmdArgs[0].ToLowerInvariant() } else { '' }
            if (@('/getactivescheme', '/query', '/a', '/availablesleepstates') -contains $first) { return $null }
            return ('powercfg ' + $first + ' no es una lectura permitida')
        }
        'schtasks' {
            $first = if ($CmdArgs.Count -gt 0) { $CmdArgs[0].ToLowerInvariant() } else { '' }
            if ($first -eq '/query') { return $null }
            return ('schtasks ' + $first + ' no es una lectura permitida')
        }
        'manage-bde' {
            $first = if ($CmdArgs.Count -gt 0) { $CmdArgs[0].ToLowerInvariant() } else { '' }
            if ($first -eq '-status') { return $null }
            return ('manage-bde ' + $first + ' no es una lectura permitida')
        }
        default { return ('ejecutable no permitido para lectura: ' + $Exe) }
    }
}

function Invoke-DiagRead {
    # The ONLY way this script runs a native command. Output goes through Protect-Line.
    param([string]$Exe, [string[]]$CmdArgs)
    $refused = Test-ReadOnlyCommand $Exe $CmdArgs
    if ($refused) { throw ('Lectura rechazada: ' + $refused) }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Exe @CmdArgs 2>$null
        $code = $LASTEXITCODE
    } catch {
        return @{ Code = 127; Out = @() }
    } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Out = @($out | Where-Object { $null -ne $_ } | ForEach-Object { Protect-Line ([string]$_) }) }
}

function Test-ToolAvailable {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-DiagHttp {
    # GET only, localhost health endpoint. Returns $null when unreachable.
    param([string]$Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -Method Get
        return @{ Code = [int]$r.StatusCode; Body = [string]$r.Content }
    } catch { return $null }
}

function Test-DiagTcp {
    # Read-only TCP connect probe (no ICMP). Returns 'open', 'refused' (host answered with RST) or 'timeout'.
    param([string]$HostName, [int]$Port, [int]$TimeoutMs = 1500)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return 'timeout' }
        try { $client.EndConnect($iar); return 'open' } catch { return 'refused' }
    } catch { return 'timeout' } finally { $client.Close() }
}

function Get-DiagNeighbor {
    # Read-only ARP/neighbor cache entry for an IPv4 address: @{ State; Mac } or $null.
    param([string]$Ip)
    try {
        $n = @(Get-NetNeighbor -IPAddress $Ip -AddressFamily IPv4 -ErrorAction Stop) | Select-Object -First 1
        if ($n) { return @{ State = [string]$n.State; Mac = [string]$n.LinkLayerAddress } }
    } catch { }
    return $null
}

function Get-DiagAdapterPower {
    # Read-only: 'Enabled' when Windows may turn the adapter off to save power, 'Disabled', or '' when unknown.
    param([string]$Name)
    try {
        $pm = Get-NetAdapterPowerManagement -Name $Name -ErrorAction Stop
        return [string]$pm.AllowComputerToTurnOffDevice
    } catch { return '' }
}

function Resolve-DiagName {
    param([string]$Name)
    try {
        return @([System.Net.Dns]::GetHostAddresses($Name) | ForEach-Object { $_.IPAddressToString })
    } catch { return @() }
}

function Read-SafeEnvKeys {
    # Reads ONLY the keys in $script:SafeEnvKeys from an env file; every other line is discarded.
    param([string]$Path)
    $result = @{ Exists = $false }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $result }
    $result.Exists = $true
    try {
        foreach ($line in (Get-Content -LiteralPath $Path -ErrorAction Stop)) {
            if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$' -and $script:SafeEnvKeys -contains $Matches[1]) {
                $result[$Matches[1]] = $Matches[2].Trim('"', "'")
            }
        }
    } catch { $result.Unreadable = $true }
    return $result
}

function Get-DiagText {
    param([string]$Path)
    try { return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop) } catch { return $null }
}

# ================================================================== Pure parsers
function ConvertFrom-PowerCfgQuery {
    # Returns the AC and DC values (in minutes) from `powercfg /query` text, locale independent:
    # the last two 0x........ values are the current AC and DC indexes (seconds).
    param([string[]]$Lines)
    $hex = @([regex]::Matches(($Lines -join "`n"), '0x[0-9a-fA-F]{8}') | ForEach-Object { $_.Value })
    if ($hex.Count -lt 2) { return $null }
    $ac = [Convert]::ToInt64($hex[$hex.Count - 2].Substring(2), 16)
    $dc = [Convert]::ToInt64($hex[$hex.Count - 1].Substring(2), 16)
    return @{ AcMinutes = [int]($ac / 60); DcMinutes = [int]($dc / 60); AcRaw = $ac; DcRaw = $dc }
}

function ConvertFrom-HbaText {
    param([string[]]$Lines)
    $rules = @()
    foreach ($raw in $Lines) {
        $line = ($raw -replace '#.*$', '').Trim()
        if (-not $line) { continue }
        $p = @($line -split '\s+')
        if (@('host', 'hostssl', 'hostnossl', 'hostgssenc', 'hostnogssenc') -contains $p[0] -and $p.Count -ge 5) {
            $method = if ($p[3] -match '^\d+\.\d+\.\d+\.\d+$' -and $p.Count -ge 6) { $p[5] } else { $p[4] }
            $rules += @{ Type = $p[0]; Database = $p[1]; User = $p[2]; Address = $p[3]; Method = $method }
        } elseif ($p[0] -eq 'local' -and $p.Count -ge 4) {
            $rules += @{ Type = 'local'; Database = $p[1]; User = $p[2]; Address = ''; Method = $p[3] }
        } elseif ($p[0] -match '^include') {
            $rules += @{ Type = $p[0]; Database = ''; User = ''; Address = ($p[1]); Method = '' }
        }
    }
    return $rules
}

function Test-LoopbackAddress {
    param([string]$Address)
    return ($Address -match '^127\.' -or $Address -match '^::1(/128)?$' -or $Address -eq 'localhost')
}

function ConvertTo-PortList {
    param($Value)
    $out = @()
    foreach ($v in @($Value)) {
        if ($null -eq $v) { continue }
        foreach ($piece in ([string]$v -split ',')) { $t = $piece.Trim(); if ($t) { $out += $t } }
    }
    return $out
}

function Test-PortMatch {
    param($Ports, [int]$Port)
    foreach ($p in (ConvertTo-PortList $Ports)) {
        if ($p -eq 'Any') { return $true }
        if ($p -eq [string]$Port) { return $true }
        if ($p -match '^(\d+)-(\d+)$' -and [int]$Matches[1] -le $Port -and $Port -le [int]$Matches[2]) { return $true }
    }
    return $false
}

function Get-ProfileNames {
    param($Profile)
    $text = [string]$Profile
    $names = @()
    foreach ($n in 'Domain', 'Private', 'Public') { if ($text -match $n) { $names += $n } }
    if ($text -match 'Any' -or $text -match '^2147483647$') { $names = @('Domain', 'Private', 'Public') }
    return $names
}

# ================================================================== Collectors (each returns a plain facts hashtable)
function Get-HostFacts {
    $f = @{ Edition = ''; Version = ''; Build = ''; Arch = ''; RamGB = 0; Cpu = ''; CpuCores = 0; Disks = @(); Hostname = $env:COMPUTERNAME
        User = $env:USERNAME; IsAdmin = $false; Domain = ''; PartOfDomain = $false; Firmware = 'unknown'
        BitLocker = @{ Known = $false; Volumes = @() }; LastHotfix = $null; PendingReboot = $false; IsPortable = $false }
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $f.Edition = [string]$os.Caption; $f.Version = [string]$os.Version; $f.Build = [string]$os.BuildNumber; $f.Arch = [string]$os.OSArchitecture
        $cs = Get-CimInstance Win32_ComputerSystem
        $f.RamGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1); $f.Domain = [string]$cs.Domain; $f.PartOfDomain = [bool]$cs.PartOfDomain
        $f.IsPortable = (@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).Count -gt 0)
        $cpu = @(Get-CimInstance Win32_Processor) | Select-Object -First 1
        $f.Cpu = ([string]$cpu.Name).Trim(); $f.CpuCores = [int]$cpu.NumberOfCores
        $f.Disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
                @{ Name = [string]$_.DeviceID; SizeGB = [math]::Round($_.Size / 1GB, 1); FreeGB = [math]::Round($_.FreeSpace / 1GB, 1); IsSystem = ([string]$_.DeviceID -eq $env:SystemDrive) } })
    } catch { }
    try { $f.IsAdmin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { }
    if (Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State') { $f.Firmware = 'UEFI' }
    try {
        $vols = @(Get-CimInstance -Namespace 'root\CIMV2\Security\MicrosoftVolumeEncryption' -ClassName Win32_EncryptableVolume -ErrorAction Stop)
        $f.BitLocker.Known = $true
        $f.BitLocker.Volumes = @($vols | ForEach-Object { @{ Mount = [string]$_.DriveLetter; Protection = [int]$_.ProtectionStatus } })
    } catch { }
    try { $f.LastHotfix = (@(Get-HotFix -ErrorAction Stop | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending) | Select-Object -First 1).InstalledOn } catch { }
    $f.PendingReboot = ((Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or
        (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'))
    return $f
}

function Get-NetworkFacts {
    $f = @{ Adapters = @(); DefaultAdapter = ''; ActiveProfiles = @(); GatewayCheck = @{ Gateway = ''; Tcp = ''; TcpPort = 0; NeighborState = ''; NeighborMac = '' } }
    $list = @()
    try {
        $route = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object { $_.RouteMetric + $_.InterfaceMetric }) | Select-Object -First 1
        if ($route) { $f.DefaultAdapter = [string](Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue).Name }
    } catch { }
    try {
        foreach ($a in @(Get-NetAdapter -Physical -ErrorAction Stop)) {
            $media = [string]$a.PhysicalMediaType
            $kind = 'Other'
            if ($media -match '802\.3|Ethernet') { $kind = 'Ethernet' } elseif ($media -match '802\.11|Wireless|Wi-?Fi') { $kind = 'Wi-Fi' }
            $cfg = $null; $iface = $null; $prof = $null
            try { $cfg = Get-NetIPConfiguration -InterfaceIndex $a.ifIndex -ErrorAction Stop } catch { }
            try { $iface = Get-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction Stop } catch { }
            try { $prof = Get-NetConnectionProfile -InterfaceIndex $a.ifIndex -ErrorAction Stop } catch { }
            $v4 = @(); $v6 = @(); $gw = ''; $dns = @()
            if ($cfg) {
                $v4 = @($cfg.IPv4Address | ForEach-Object { [string]$_.IPAddress })
                $v6 = @($cfg.IPv6Address | ForEach-Object { [string]$_.IPAddress })
                $g = @($cfg.IPv4DefaultGateway) | Select-Object -First 1
                if ($g) { $gw = [string]$g.NextHop }
                $dns = @($cfg.DnsServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses } | ForEach-Object { [string]$_ })
            }
            $dhcp = $null
            if ($iface) { $dhcp = ([string]$iface.Dhcp -eq 'Enabled') }
            $list += @{ Name = [string]$a.Name; Kind = $kind; Status = [string]$a.Status; Mac = [string]$a.MacAddress; IPv4 = $v4; IPv6 = $v6
                Gateway = $gw; Dns = $dns; Dhcp = $dhcp; Profile = $(if ($prof) { [string]$prof.NetworkCategory } else { '' })
                IsDefault = ([string]$a.Name -eq $f.DefaultAdapter)
                PowerSaving = $(if ($kind -eq 'Wi-Fi' -and [string]$a.Status -eq 'Up') { Get-DiagAdapterPower ([string]$a.Name) } else { '' }) }
        }
    } catch { }
    $f.Adapters = $list
    $f.GatewayCheck = @{ Gateway = ''; Tcp = ''; TcpPort = 0; NeighborState = ''; NeighborMac = '' }
    $up = @($list | Where-Object { $_.Status -eq 'Up' -and $_.Gateway })
    $primary = @($up | Where-Object { $_.IsDefault }) | Select-Object -First 1
    if (-not $primary) { $primary = @($up) | Select-Object -First 1 }
    if ($primary) {
        $f.GatewayCheck.Gateway = [string]$primary.Gateway
        foreach ($port in 80, 443) {
            $r = Test-DiagTcp $primary.Gateway $port
            if ($r -ne 'timeout') { $f.GatewayCheck.Tcp = $r; $f.GatewayCheck.TcpPort = $port; break }
        }
        if (-not $f.GatewayCheck.Tcp) { $f.GatewayCheck.Tcp = 'timeout' }
        $nb = Get-DiagNeighbor $primary.Gateway
        if ($nb) { $f.GatewayCheck.NeighborState = $nb.State; $f.GatewayCheck.NeighborMac = $nb.Mac }
    }
    $f.ActiveProfiles = @($list | Where-Object { $_.Status -eq 'Up' -and $_.Profile } | ForEach-Object { $_.Profile -replace 'DomainAuthenticated', 'Domain' } | Select-Object -Unique)
    return $f
}

function Get-ListenerFacts {
    param([int[]]$Ports)
    $out = @()
    foreach ($port in $Ports) {
        $conns = @()
        try { $conns = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop) } catch { }
        $procName = ''
        if ($conns.Count -gt 0) { try { $procName = [string](Get-Process -Id $conns[0].OwningProcess -ErrorAction Stop).Name } catch { } }
        $out += @{ Port = $port; Addresses = @($conns | ForEach-Object { [string]$_.LocalAddress } | Select-Object -Unique); Pid = $(if ($conns.Count -gt 0) { [int]$conns[0].OwningProcess } else { 0 }); Process = $procName }
    }
    return $out
}

function Get-FirewallRuleFilter {
    # Seam: port/address/application filters of one firewall rule (read-only).
    param($Rule)
    return @{
        Port    = (Get-NetFirewallPortFilter -AssociatedNetFirewallRule $Rule -ErrorAction SilentlyContinue)
        Address = (Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $Rule -ErrorAction SilentlyContinue)
        App     = (Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $Rule -ErrorAction SilentlyContinue)
    }
}

function Get-FirewallFacts {
    $f = @{ Available = $false; Profiles = @{}; Rules = @(); Listeners = @() }
    try {
        foreach ($p in @(Get-NetFirewallProfile -ErrorAction Stop)) { $f.Profiles[[string]$p.Name] = [bool]($p.Enabled -eq $true -or [string]$p.Enabled -eq 'True') }
        $f.Available = $true
        $rules = @()
        foreach ($r in @(Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -ErrorAction Stop)) {
            $flt = Get-FirewallRuleFilter $r
            $pf = $flt.Port; $af = $flt.Address; $app = $flt.App
            $rules += @{ Name = [string]$r.DisplayName; Profile = [string]$r.Profile; Protocol = [string](Get-Prop $pf 'Protocol' 'Any')
                LocalPort = @(ConvertTo-PortList (Get-Prop $pf 'LocalPort' 'Any')); Remote = @(ConvertTo-PortList (Get-Prop $af 'RemoteAddress' 'Any'))
                Program = [string](Get-Prop $app 'Program' 'Any') }
        }
        $f.Rules = $rules
    } catch { }
    $f.Listeners = Get-ListenerFacts (@($script:HubPort) + $script:ForbiddenPorts)
    return $f
}

function ConvertFrom-DockerInspectLine {
    # One line per container: name|id|image|project|state|health|restart|ports|networks
    # ports = host:port->container/proto joined by ',', networks = name=ip joined by ','
    param([string]$Line)
    $p = @($Line -split '\|', 9)
    if ($p.Count -lt 9) { return $null }
    $ports = @()
    foreach ($item in @($p[7] -split ',' | Where-Object { $_ })) {
        if ($item -match '^(.*):(\d+)->(.+)$') { $ports += @{ HostIp = $Matches[1]; HostPort = $Matches[2]; ContainerPort = $Matches[3] } }
    }
    $nets = @()
    foreach ($item in @($p[8] -split ',' | Where-Object { $_ })) {
        $kv = $item -split '=', 2
        $ip = ''
        if ($kv.Count -gt 1) { $ip = $kv[1] }
        $nets += @{ Name = $kv[0]; Ip = $ip }
    }
    $id = $p[1]
    return @{ Name = $p[0].TrimStart('/'); Id = $id.Substring(0, [math]::Min(12, $id.Length)); Image = $p[2]; Project = $p[3]; State = $p[4]; Health = $p[5]; Restart = $p[6]; Ports = $ports; Networks = $nets }
}

$script:DockerInspectFormat = '{{.Name}}|{{.Id}}|{{.Config.Image}}|{{index .Config.Labels `com.docker.compose.project`}}|{{.State.Status}}|{{if index .State `Health`}}{{.State.Health.Status}}{{end}}|{{.HostConfig.RestartPolicy.Name}}|{{range $p,$b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}}:{{.HostPort}}->{{$p}},{{end}}{{end}}|{{range $k,$v := .NetworkSettings.Networks}}{{$k}}={{$v.IPAddress}},{{end}}'

function Get-DockerFacts {
    $f = @{ Installed = $false; Version = ''; DaemonUp = $false; Wsl2 = $false; AutoStart = $null; RunKey = $false; Containers = @(); Projects = @(); Networks = @() }
    $f.Installed = (Test-ToolAvailable 'docker')
    if (-not $f.Installed) { return $f }
    $v = Invoke-DiagRead 'docker' @('version', '--format', '{{.Server.Version}}')
    if ($v.Code -eq 0 -and $v.Out.Count -gt 0) { $f.DaemonUp = $true; $f.Version = $v.Out[0] } else {
        $c = Invoke-DiagRead 'docker' @('version', '--format', '{{.Client.Version}}')
        if ($c.Code -eq 0 -and $c.Out.Count -gt 0) { $f.Version = $c.Out[0] + ' (cliente)' }
    }
    $f.RunKey = [bool](Get-Prop (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue) 'Docker Desktop' $false)
    $settings = Get-DiagText (Join-Path $env:APPDATA 'Docker\settings-store.json')
    if ($settings) { try { $j = $settings | ConvertFrom-Json; if ($null -ne (Get-Prop $j 'AutoStart')) { $f.AutoStart = [bool](Get-Prop $j 'AutoStart') } } catch { } }
    if (-not $f.DaemonUp) { return $f }
    $info = Invoke-DiagRead 'docker' @('info', '--format', '{{.KernelVersion}}|{{.OperatingSystem}}')
    if ($info.Out.Count -gt 0 -and $info.Out[0] -match 'WSL2|microsoft') { $f.Wsl2 = $true }
    $ps = Invoke-DiagRead 'docker' @('ps', '-a', '--format', '{{.Names}}')
    $names = @($ps.Out | Where-Object { $_ })
    foreach ($n in $names) {
        $i = Invoke-DiagRead 'docker' @('inspect', '--format', $script:DockerInspectFormat, $n)
        if ($i.Code -ne 0 -or $i.Out.Count -eq 0) { continue }
        $c = ConvertFrom-DockerInspectLine $i.Out[0]
        if ($c) { $f.Containers += $c }
    }
    $f.Projects = @($f.Containers | ForEach-Object { $_.Project } | Where-Object { $_ } | Select-Object -Unique)
    $nl = Invoke-DiagRead 'docker' @('network', 'ls', '--format', '{{.Name}}')
    $f.Networks = @($nl.Out | Where-Object { $_ })
    return $f
}

function Get-PostgresFacts {
    $f = @{ ServiceFound = $false; ServiceName = ''; Status = ''; StartType = ''; Version = ''; DataDir = ''; Listener = $null; HbaReadable = $false; HbaRules = @(); Includes = @()
        ListenAddresses = ''; Port = ''; ConfReadable = $false }
    $svc = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue) | Select-Object -First 1
    if (-not $svc) { return $f }
    $f.ServiceFound = $true; $f.ServiceName = [string]$svc.Name; $f.Status = [string]$svc.Status; $f.StartType = [string]$svc.StartType
    if ($svc.Name -match '(\d+)$') { $f.Version = $Matches[1] }
    try {
        $cim = Get-CimInstance Win32_Service -Filter ("Name='" + $svc.Name + "'") -ErrorAction Stop
        if ([string]$cim.PathName -match '-D\s+"?([^"]+?)"?\s*(?:-w|$)') { $f.DataDir = $Matches[1].Trim() }
    } catch { }
    $f.Listener = (Get-ListenerFacts @(5432)) | Select-Object -First 1
    if ($f.DataDir) {
        $hba = Get-DiagText (Join-Path $f.DataDir 'pg_hba.conf')
        if ($null -ne $hba) { $f.HbaReadable = $true; $f.HbaRules = @(ConvertFrom-HbaText ($hba -split "`r?`n")) }
        $f.Includes = @($f.HbaRules | Where-Object { $_.Type -match '^include' })
        $conf = Get-DiagText (Join-Path $f.DataDir 'postgresql.conf')
        if ($null -ne $conf) {
            $f.ConfReadable = $true
            foreach ($line in ($conf -split "`r?`n")) {
                if ($line -match "^\s*listen_addresses\s*=\s*'?([^'#\s]*)") { $f.ListenAddresses = $Matches[1] }
                if ($line -match '^\s*port\s*=\s*(\d+)') { $f.Port = $Matches[1] }
                if ($line -match '^\s*include(_if_exists|_dir)?\s*=\s*') { $f.Includes += @{ Type = 'conf-include'; Address = $line.Trim() } }
            }
        }
    }
    return $f
}

function Get-StartupEntries {
    # Names (never commands/arguments) of per-user and per-machine startup entries.
    $names = @()
    foreach ($key in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run') {
        $p = Get-ItemProperty $key -ErrorAction SilentlyContinue
        if ($p) { $names += @($p.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { 'Run:' + $_.Name }) }
    }
    $folder = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    if (Test-Path -LiteralPath $folder) { $names += @(Get-ChildItem -LiteralPath $folder -ErrorAction SilentlyContinue | ForEach-Object { 'Startup:' + $_.Name }) }
    return $names
}

function Get-ScheduledTaskFacts {
    param([string]$NamePattern)
    $out = @()
    try {
        foreach ($t in @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -match $NamePattern })) {
            $info = $null
            try { $info = Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction Stop } catch { }
            $xml = ''
            $actions = ''
            try { $actions = (@($t.Actions) | ForEach-Object { [string]$_.Execute + ' ' + [string]$_.Arguments }) -join ' ' } catch { }
            $triggers = @()
            try { $triggers = @(@($t.Triggers) | ForEach-Object { @{ Type = [string]$_.CimClass.CimClassName; UserId = [string](Get-Prop $_ 'UserId' ''); Delay = [string](Get-Prop $_ 'Delay' ''); Enabled = [bool](Get-Prop $_ 'Enabled' $true) } }) } catch { }
            $out += @{ Name = [string]$t.TaskName; State = [string]$t.State; Triggers = $triggers; LogonType = [string](Get-Prop (Get-Prop $t 'Principal') 'LogonType' ''); UserId = [string](Get-Prop (Get-Prop $t 'Principal') 'UserId' ''); Actions = $actions
                LastRun = $(if ($info) { $info.LastRunTime } else { $null }); LastResult = $(if ($info) { [uint32]$info.LastTaskResult } else { $null }) }
        }
    } catch { }
    return $out
}

function Test-LogonTaskForUser {
    # True when the task is enabled and has an enabled AtLogOn trigger for the user it runs as
    # (or for any user when the trigger names none).
    param($Task)
    if ([string]$Task.State -eq 'Disabled') { return $false }
    $principal = ([string](Get-Prop $Task 'UserId' '')) -replace '^.*\\', ''
    foreach ($tr in @(Get-Prop $Task 'Triggers' @())) {
        if ([string]$tr.Type -notmatch 'LogonTrigger' -or -not [bool](Get-Prop $tr 'Enabled' $true)) { continue }
        $trUser = ([string](Get-Prop $tr 'UserId' '')) -replace '^.*\\', ''
        if (-not $trUser -or -not $principal -or $trUser -eq $principal) { return $true }
    }
    return $false
}

function Get-UserPathReferenceCount {
    # Counts (never prints) references to the current user's profile path in small text files.
    param([string[]]$Roots, [string]$ExtensionPattern = '\.(json|ps1|psm1|cmd|bat|xml|yaml|yml|js|cjs)$')
    $needle = ($env:USERPROFILE + '\').ToLowerInvariant()
    $alt = $needle.Replace('\', '/')
    $count = 0
    foreach ($root in $Roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match $ExtensionPattern -and $_.Length -lt 2MB -and $_.FullName -notmatch '\\(node_modules|\.git|dist)\\' })
        foreach ($file in $files) {
            $text = Get-DiagText $file.FullName
            if ($text) {
                $lower = $text.ToLowerInvariant()
                $count += ([regex]::Matches($lower, [regex]::Escape($needle))).Count + ([regex]::Matches($lower, [regex]::Escape($alt))).Count
            }
        }
    }
    return $count
}

function Get-N8nFacts {
    param([string]$RepoRoot)
    $f = @{ Running = $false; Pid = 0; SessionId = 0; Version = ''; UserDir = ''; UserDirExists = $false; ConfigExists = $false; SqliteExists = $false; Listener = $null
        Services = @(); Tasks = @(); StartupEntries = @(); SupervisorProcess = ''; LogonTask = ''; AutoStart = $false; UserPathRefs = @() }
    try {
        $proc = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop | Where-Object { [string]$_.CommandLine -match '[\\/]n8n[\\/]bin[\\/]n8n' }) | Select-Object -First 1
        if ($proc) { $f.Running = $true; $f.Pid = [int]$proc.ProcessId; $f.SessionId = [int]$proc.SessionId }
    } catch { }
    $pkg = Get-DiagText (Join-Path $env:APPDATA 'npm\node_modules\n8n\package.json')
    if ($pkg) { try { $f.Version = [string]((($pkg | ConvertFrom-Json)).version) } catch { } }
    $f.UserDir = Join-Path $env:USERPROFILE '.n8n'
    $f.UserDirExists = (Test-Path -LiteralPath $f.UserDir)
    $f.ConfigExists = (Test-Path -LiteralPath (Join-Path $f.UserDir 'config'))
    $f.SqliteExists = (Test-Path -LiteralPath (Join-Path $f.UserDir 'database.sqlite'))
    $f.Listener = (Get-ListenerFacts @(5678)) | Select-Object -First 1
    $f.Services = @(Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'n8n' -or $_.DisplayName -match 'n8n' } | ForEach-Object { @{ Name = [string]$_.Name; Status = [string]$_.Status; StartType = [string]$_.StartType } })
    $f.Tasks = @(Get-ScheduledTaskFacts '.*' | Where-Object { $_.Actions -match 'n8n' -and $_.Name -notmatch 'Daubert - n8n Weekly' })
    $f.StartupEntries = @(Get-StartupEntries | Where-Object { $_ -match 'n8n' })
    $sup = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(pm2|nssm|winsw)' }) | Select-Object -First 1
    if ($sup) { $f.SupervisorProcess = [string]$sup.Name }
    $f.LogonTask = ''
    foreach ($t in @($f.Tasks)) { if (Test-LogonTaskForUser $t) { $f.LogonTask = [string]$t.Name; break } }
    $f.AutoStart = ((@($f.Services | Where-Object { $_.StartType -eq 'Automatic' }).Count -gt 0) -or [bool]$f.LogonTask -or (@($f.StartupEntries).Count -gt 0))
    $refs = @()
    $backupCfg = 'C:\ProgramData\DaubertHub\Backup'
    $refs += @{ Location = 'ProgramData\DaubertHub\Backup'; Count = (Get-UserPathReferenceCount @($backupCfg)) }
    $refs += @{ Location = 'repo n8n/ y scripts/'; Count = (Get-UserPathReferenceCount @((Join-Path $RepoRoot 'n8n'), (Join-Path $RepoRoot 'scripts'))) }
    $taskRefs = 0
    foreach ($t in @(Get-ScheduledTaskFacts 'Daubert')) { if (([string]$t.Actions).ToLowerInvariant().Contains($env:USERPROFILE.ToLowerInvariant())) { $taskRefs++ } }
    $refs += @{ Location = 'tareas programadas Daubert'; Count = $taskRefs }
    $f.UserPathRefs = $refs
    return $f
}

function Get-DropboxFacts {
    param($BackupCfg)
    $f = @{ Installed = $false; Running = $false; Path = ''; PathExists = $false; AutoStart = $false; Folders = @() }
    $exe = @((Join-Path ${env:ProgramFiles(x86)} 'Dropbox\Client\Dropbox.exe'), (Join-Path $env:ProgramFiles 'Dropbox\Client\Dropbox.exe'), (Join-Path $env:LOCALAPPDATA 'Dropbox\Client\Dropbox.exe')) | Where-Object { Test-Path -LiteralPath $_ }
    $f.Installed = (@($exe).Count -gt 0)
    $f.Running = (@(Get-Process -Name Dropbox -ErrorAction SilentlyContinue).Count -gt 0)
    $info = Get-DiagText (Join-Path $env:LOCALAPPDATA 'Dropbox\info.json')
    if ($info) {
        try {
            $j = $info | ConvertFrom-Json
            $acct = $null
            foreach ($name in 'personal', 'business') { if ($null -eq $acct -and $null -ne (Get-Prop $j $name)) { $acct = Get-Prop $j $name } }
            if ($acct) { $f.Path = [string](Get-Prop $acct 'path' '') }
        } catch { }
    }
    $f.PathExists = ($f.Path -and (Test-Path -LiteralPath $f.Path))
    $f.AutoStart = (@(Get-StartupEntries | Where-Object { $_ -match 'Dropbox' }).Count -gt 0) -or (@(Get-ScheduledTaskFacts 'Dropbox' | Where-Object { $_.Actions -match 'Dropbox\.exe' }).Count -gt 0)
    foreach ($label in 'backupRoot') {
        $p = [string](Get-Prop $BackupCfg $label '')
        if ($p) { $f.Folders += @{ Name = 'Backups Daubert'; Path = $p; Exists = (Test-Path -LiteralPath $p) } }
    }
    return $f
}

function Get-EnergyFacts {
    $f = @{ Plan = ''; AcSleepMinutes = $null; AcHibernateMinutes = $null; AcDisplayMinutes = $null; HibernateEnabled = $null; IsPortable = $false; WifiPowerSavingAc = $null }
    if (-not (Test-ToolAvailable 'powercfg')) { return $f }
    $plan = Invoke-DiagRead 'powercfg' @('/getactivescheme')
    if ($plan.Out.Count -gt 0 -and $plan.Out[0] -match '\(([^)]+)\)\s*\*?\s*$') { $f.Plan = $Matches[1] }
    $map = @{ AcSleepMinutes = @('SUB_SLEEP', 'STANDBYIDLE'); AcHibernateMinutes = @('SUB_SLEEP', 'HIBERNATEIDLE'); AcDisplayMinutes = @('SUB_VIDEO', 'VIDEOIDLE') }
    foreach ($key in $map.Keys) {
        $q = Invoke-DiagRead 'powercfg' @('/query', 'SCHEME_CURRENT', $map[$key][0], $map[$key][1])
        $parsed = ConvertFrom-PowerCfgQuery $q.Out
        if ($parsed) { $f[$key] = $parsed.AcMinutes }
    }
    $q = Invoke-DiagRead 'powercfg' @('/query', 'SCHEME_CURRENT', '19cbb8fa-5279-450e-9fac-8a3d5fedd0c1', '12bbebe6-58d6-4636-95bb-3217ef867c1a')
    $raw = ConvertFrom-PowerCfgQuery $q.Out
    if ($raw) { $f.WifiPowerSavingAc = [int]$raw.AcRaw }
    $h = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' -ErrorAction SilentlyContinue
    if ($h -and $h.PSObject.Properties.Name -contains 'HibernateEnabled') { $f.HibernateEnabled = ([int]$h.HibernateEnabled -eq 1) }
    elseif ($h -and $h.PSObject.Properties.Name -contains 'HibernateEnabledDefault') { $f.HibernateEnabled = ([int]$h.HibernateEnabledDefault -eq 1) }
    $f.IsPortable = (@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).Count -gt 0)
    return $f
}

function Get-RepoFacts {
    param([string]$RepoRoot)
    $f = @{ Path = $RepoRoot; IsRepo = $false; Branch = ''; Head = ''; DirtyCount = 0; Origin = ''; ComposePilot = $false; ComposeProdTemp = $false; ComposeBase = $false
        PackageVersion = ''; DeployScripts = $false; HubPort = $script:HubPort; Health = $null; ComposeHasName = $false }
    $f.ComposePilot = (Test-Path -LiteralPath (Join-Path $RepoRoot 'compose.pilot.yaml'))
    $f.ComposeProdTemp = (Test-Path -LiteralPath (Join-Path $RepoRoot 'compose.prod-temp.yaml'))
    $f.ComposeBase = (Test-Path -LiteralPath (Join-Path $RepoRoot 'compose.yaml'))
    $f.DeployScripts = (Test-Path -LiteralPath (Join-Path $RepoRoot 'scripts\deploy\Deploy-DaubertHub.ps1'))
    $pkg = Get-DiagText (Join-Path $RepoRoot 'package.json')
    if ($pkg) { try { $f.PackageVersion = [string](($pkg | ConvertFrom-Json).version) } catch { } }
    foreach ($c in 'compose.pilot.yaml', 'compose.prod-temp.yaml', 'compose.yaml') {
        $t = Get-DiagText (Join-Path $RepoRoot $c)
        if ($t -and $t -match '(?m)^name:\s*\S') { $f.ComposeHasName = $true }
    }
    if (Test-ToolAvailable 'git') {
        $top = Invoke-DiagRead 'git' @('-C', $RepoRoot, 'rev-parse', '--show-toplevel')
        if ($top.Code -eq 0) {
            $f.IsRepo = $true
            $b = Invoke-DiagRead 'git' @('-C', $RepoRoot, 'branch', '--show-current'); if ($b.Out.Count -gt 0) { $f.Branch = $b.Out[0] }
            $h = Invoke-DiagRead 'git' @('-C', $RepoRoot, 'rev-parse', '--short', 'HEAD'); if ($h.Out.Count -gt 0) { $f.Head = $h.Out[0] }
            $s = Invoke-DiagRead 'git' @('-C', $RepoRoot, 'status', '--short'); $f.DirtyCount = @($s.Out | Where-Object { $_ }).Count
            $o = Invoke-DiagRead 'git' @('-C', $RepoRoot, 'remote', 'get-url', 'origin'); if ($o.Code -eq 0 -and $o.Out.Count -gt 0) { $f.Origin = $o.Out[0] }
        }
    }
    $prodEnv = Read-SafeEnvKeys (Join-Path $RepoRoot 'deploy\pilot.prod.env')
    if ($prodEnv.ContainsKey('HUB_PORT') -and $prodEnv.HUB_PORT -match '^\d+$') { $f.HubPort = [int]$prodEnv.HUB_PORT }
    $resp = Invoke-DiagHttp ('http://127.0.0.1:' + $f.HubPort + '/api/health')
    if ($resp) {
        $f.Health = @{ Code = $resp.Code; Status = ''; Database = ''; Environment = ''; Version = ''; Commit = '' }
        try {
            $j = $resp.Body | ConvertFrom-Json
            $f.Health.Status = [string](Get-Prop $j 'status' ''); $f.Health.Database = [string](Get-Prop $j 'database' '')
            $f.Health.Environment = [string](Get-Prop $j 'environment' ''); $f.Health.Version = [string](Get-Prop $j 'version' ''); $f.Health.Commit = [string](Get-Prop $j 'commit' '')
        } catch { }
    }
    return $f
}

function Get-SeparationFacts {
    param([string]$RepoRoot)
    return @{
        ProjectEnvVar = (@($env:COMPOSE_PROJECT_NAME, [Environment]::GetEnvironmentVariable('COMPOSE_PROJECT_NAME', 'User'), [Environment]::GetEnvironmentVariable('COMPOSE_PROJECT_NAME', 'Machine')) | Where-Object { $_ }) -join ','
        ProdEnv       = (Read-SafeEnvKeys (Join-Path $RepoRoot 'deploy\pilot.prod.env'))
        TestEnv       = (Read-SafeEnvKeys (Join-Path $RepoRoot 'deploy\pilot.test.env'))
    }
}

function Get-AclRisk {
    # Identities (other than the owner, SYSTEM, Administrators and the current user) that can read the file.
    param([string]$Path)
    try {
        $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
        $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $ownerSid = ''
        try { $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value } catch { }
        $ok = @('S-1-5-18', 'S-1-5-32-544', $me, $ownerSid)
        $risk = @()
        foreach ($rule in @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and ($_.FileSystemRights.ToString() -match 'Read|FullControl|Modify') })) {
            $sid = ''
            try { $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = [string]$rule.IdentityReference }
            if ($ok -notcontains $sid) { $risk += [string]$rule.IdentityReference }
        }
        return @($risk | Select-Object -Unique)
    } catch { return $null }
}

function Get-SecretFacts {
    param([string]$RepoRoot, $BackupCfg)
    $targets = @()
    $targets += @{ Label = 'PROD env'; Path = (Join-Path $RepoRoot 'deploy\pilot.prod.env'); Repo = $true }
    $targets += @{ Label = 'TEST env'; Path = (Join-Path $RepoRoot 'deploy\pilot.test.env'); Repo = $true }
    $pgpass = [string](Get-Prop $BackupCfg 'pgPassFile' '')
    if ($pgpass) { $targets += @{ Label = 'pgpass backup'; Path = $pgpass; Repo = $false } }
    $targets += @{ Label = 'n8n config'; Path = (Join-Path $env:USERPROFILE '.n8n\config'); Repo = $false }
    $files = @()
    foreach ($t in $targets) {
        $exists = (Test-Path -LiteralPath $t.Path -PathType Leaf)
        $tracked = $null; $ignored = $null
        if ($exists -and $t.Repo -and (Test-ToolAvailable 'git')) {
            $rel = $t.Path.Substring($RepoRoot.Length).TrimStart('\').Replace('\', '/')
            $tracked = ((Invoke-DiagRead 'git' @('-C', $RepoRoot, 'ls-files', '--error-unmatch', $rel)).Code -eq 0)
            $ignored = ((Invoke-DiagRead 'git' @('-C', $RepoRoot, 'check-ignore', '-q', $rel)).Code -eq 0)
        }
        $files += @{ Label = $t.Label; Location = $t.Path; Exists = $exists; AclRisk = $(if ($exists) { Get-AclRisk $t.Path } else { @() }); Tracked = $tracked; Ignored = $ignored }
    }
    $copies = @()
    foreach ($dir in @($RepoRoot, (Join-Path $RepoRoot 'deploy'), (Join-Path $RepoRoot 'apps\api'), (Join-Path $RepoRoot 'apps\web'))) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        $copies += @(Get-ChildItem -LiteralPath $dir -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\.env(\..+)?$|\.env$' -and $_.Name -notmatch '\.example$' } | ForEach-Object { $_.FullName.Substring($RepoRoot.Length).TrimStart('\') })
    }
    return @{ Files = $files; EnvCopies = $copies }
}

function Get-BackupConfig {
    $text = Get-DiagText 'C:\ProgramData\DaubertHub\Backup\config.json'
    if (-not $text) { return @{} }
    try { $j = $text | ConvertFrom-Json } catch { return @{} }
    $out = @{}
    foreach ($k in 'backupRoot', 'pgPassFile', 'database', 'host', 'port') { if ($null -ne (Get-Prop $j $k)) { $out[$k] = [string](Get-Prop $j $k) } }
    $n8nText = Get-DiagText 'C:\ProgramData\DaubertHub\Backup\n8n-config.json'
    if ($n8nText) { try { $nj = $n8nText | ConvertFrom-Json; if ($null -ne (Get-Prop $nj 'backupRoot')) { $out['n8nBackupRoot'] = [string](Get-Prop $nj 'backupRoot') } } catch { } }
    return $out
}

function Get-StorageFacts {
    param($BackupCfg)
    $f = @{ ConfigFound = ($BackupCfg.Count -gt 0); BackupRoot = [string](Get-Prop $BackupCfg 'backupRoot' ''); RootExists = $false; Tiers = @(); Tasks = @(); SchedulerRunning = $false }
    if ($f.BackupRoot) {
        $f.RootExists = (Test-Path -LiteralPath $f.BackupRoot)
        $pg = $f.BackupRoot
        foreach ($tier in 'FREQUENT', 'DAILY', 'MONTHLY') {
            $dir = Join-Path $pg $tier
            $exists = (Test-Path -LiteralPath $dir)
            $latest = $null; $count = 0
            if ($exists) {
                $files = @(Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
                $count = $files.Count
                if ($count -gt 0) { $latest = $files[0].LastWriteTime }
            }
            $f.Tiers += @{ Name = $tier; Exists = $exists; Latest = $latest; Count = $count }
        }
        $n8nBase = [string](Get-Prop $BackupCfg 'n8nBackupRoot' '')
        if (-not $n8nBase) { $n8nBase = Split-Path -Parent $f.BackupRoot }
        $n8nDir = Join-Path $n8nBase 'N8N'
        $f.Tiers += @{ Name = 'N8N'; Exists = (Test-Path -LiteralPath $n8nDir); Latest = $(if (Test-Path -LiteralPath $n8nDir) { (@(Get-ChildItem -LiteralPath $n8nDir -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending) | Select-Object -First 1).LastWriteTime } else { $null }); Count = 0 }
    }
    $f.Tasks = @(Get-ScheduledTaskFacts '^Daubert - ')
    $sch = Get-Service -Name Schedule -ErrorAction SilentlyContinue
    $f.SchedulerRunning = [bool]($sch -and [string]$sch.Status -eq 'Running')
    return $f
}

function Get-DnsFacts {
    param([string]$Hostname, $Network)
    $active = @($Network.Adapters | Where-Object { $_.Status -eq 'Up' -and @($_.IPv4).Count -gt 0 }) | Select-Object -First 1
    $f = @{ Hostname = $env:COMPUTERNAME; Servers = @(); Ip = @(); Requested = $Hostname; Resolved = @() }
    if ($active) { $f.Servers = @($active.Dns); $f.Ip = @($active.IPv4) }
    if ($Hostname) { $f.Resolved = @(Resolve-DiagName $Hostname) }
    return $f
}

function Get-SessionFacts {
    # Reads only the AutoAdminLogon flag (never DefaultPassword or any credential value).
    $f = @{ AutoLogon = $false }
    $w = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name AutoAdminLogon -ErrorAction SilentlyContinue
    if ($w -and [string]$w.AutoAdminLogon -eq '1') { $f.AutoLogon = $true }
    return $f
}

function Get-DiagFacts {
    param([string]$RepoRoot, [string]$Hostname)
    $net = Get-NetworkFacts
    $cfg = Get-BackupConfig
    $facts = @{}
    $facts.Host = Get-HostFacts
    $facts.Network = $net
    $facts.Firewall = Get-FirewallFacts
    $facts.Docker = Get-DockerFacts
    $facts.Postgres = Get-PostgresFacts
    $facts.N8n = Get-N8nFacts $RepoRoot
    $facts.Dropbox = Get-DropboxFacts $cfg
    $facts.Energy = Get-EnergyFacts
    $facts.Repo = Get-RepoFacts $RepoRoot
    $facts.Separation = Get-SeparationFacts $RepoRoot
    $facts.Secrets = Get-SecretFacts $RepoRoot $cfg
    $facts.Storage = Get-StorageFacts $cfg
    $facts.Dns = Get-DnsFacts $Hostname $net
    $facts.Session = Get-SessionFacts
    return $facts
}

# ================================================================== Evaluators (pure: facts -> checks)
function Test-HostChecks {
    param($H)
    $isServer = ([string]$H.Edition -match 'Pro|Enterprise|Server|Education')
    Save-Check 'Host' 'Windows' $(if ($isServer) { 'PASS' } else { 'WARN' }) ($H.Edition + ' ' + $H.Version + ' (build ' + $H.Build + ')' + $(if (-not $isServer) { ' - se recomienda Pro/Enterprise (BitLocker, escritorio remoto)' } else { '' }))
    Save-Check 'Host' 'Arquitectura' $(if ([string]$H.Arch -match '64') { 'PASS' } else { 'FAIL' }) ([string]$H.Arch)
    Save-Check 'Host' 'RAM' $(if ([double]$H.RamGB -ge 8) { 'PASS' } elseif ([double]$H.RamGB -ge 4) { 'WARN' } else { 'FAIL' }) ([string]$H.RamGB + ' GB (minimo recomendado 8 GB)')
    Save-Check 'Host' 'CPU' 'INFO' ([string]$H.Cpu + ' (' + [string]$H.CpuCores + ' nucleos)')
    foreach ($d in @($H.Disks)) {
        $free = [double]$d.FreeGB
        $st = if ($free -ge 20) { 'PASS' } elseif ($free -ge 10) { 'WARN' } else { 'FAIL' }
        Save-Check 'Host' ('Disco ' + $d.Name) $st ([string]$d.FreeGB + ' GB libres de ' + [string]$d.SizeGB + ' GB')
    }
    Save-Check 'Host' 'Hostname' 'INFO' ([string]$H.Hostname)
    Save-Check 'Host' 'Usuario' 'INFO' ([string]$H.User)
    Save-Check 'Host' 'Privilegios admin' 'INFO' $(if ($H.IsAdmin) { 'sesion elevada' } else { 'sesion sin elevar (algunas lecturas, como BitLocker, pueden no estar disponibles)' })
    Save-Check 'Host' 'Dominio/Workgroup' 'INFO' $(if ($H.PartOfDomain) { 'dominio ' + $H.Domain } else { 'workgroup ' + $H.Domain })
    Save-Check 'Host' 'Firmware' 'INFO' ([string]$H.Firmware)
    $bl = $H.BitLocker
    if (-not $bl.Known) {
        Save-Check 'Host' 'BitLocker' 'INFO' 'no comprobable sin sesion elevada (recomendado en el servidor)'
    } else {
        $sys = @($bl.Volumes | Where-Object { ([string]$_.Mount).TrimEnd(':') -eq ([string]$env:SystemDrive).TrimEnd(':') }) | Select-Object -First 1
        if ($sys -and [int]$sys.Protection -eq 1) { Save-Check 'Host' 'BitLocker' 'PASS' 'unidad del sistema protegida' }
        else { Save-Check 'Host' 'BitLocker' 'WARN' 'unidad del sistema sin proteccion BitLocker (RECOMMENDED/REQUIRED en el servidor)' }
    }
    if ($H.LastHotfix) {
        $days = [int]((Get-Date) - [datetime]$H.LastHotfix).TotalDays
        Save-Check 'Host' 'Windows Update' $(if ($days -le 120) { 'PASS' } else { 'WARN' }) ('ultima actualizacion instalada hace ' + $days + ' dias')
    } else { Save-Check 'Host' 'Windows Update' 'INFO' 'sin historial de actualizaciones legible' }
    Save-Check 'Host' 'Reinicio pendiente' $(if ($H.PendingReboot) { 'WARN' } else { 'PASS' }) $(if ($H.PendingReboot) { 'Windows indica un reinicio pendiente' } else { 'ninguno' })
}

function Test-NetworkChecks {
    # V1 runs on Wi-Fi: Wi-Fi is a valid target network; Ethernet is only an availability recommendation.
    param($N)
    $adapters = @($N.Adapters)
    $eth = @($adapters | Where-Object { $_.Kind -eq 'Ethernet' })
    $wifi = @($adapters | Where-Object { $_.Kind -eq 'Wi-Fi' })
    $ethUp = @($eth | Where-Object { $_.Status -eq 'Up' })
    $wifiUp = @($wifi | Where-Object { $_.Status -eq 'Up' })
    if ($wifiUp.Count -gt 0) { Save-Check 'Network' 'Wi-Fi' 'PASS' ('adaptador activo y conectado: ' + $wifiUp[0].Name + ' (red objetivo de V1)') }
    elseif ($wifi.Count -gt 0) {
        $why = if ($wifi[0].Status -eq 'Disabled') { 'deshabilitado' } else { 'desconectado' }
        Save-Check 'Network' 'Wi-Fi' $(if ($ethUp.Count -gt 0) { 'INFO' } else { 'FAIL' }) ('adaptador ' + $wifi[0].Name + ' ' + $why + $(if ($ethUp.Count -eq 0) { ': V1 necesita el Wi-Fi activo y conectado' } else { ' (se usa Ethernet)' }))
    } else { Save-Check 'Network' 'Wi-Fi' $(if ($ethUp.Count -gt 0) { 'INFO' } else { 'FAIL' }) 'sin adaptador Wi-Fi' }
    if ($ethUp.Count -gt 0) { Save-Check 'Network' 'Ethernet' 'INFO' ('conectado: ' + $ethUp[0].Name + ' (recomendado para disponibilidad; no requerido en V1)') }
    elseif ($eth.Count -gt 0) { Save-Check 'Network' 'Ethernet' 'INFO' ('disponible pero desconectado: ' + $eth[0].Name + ' (recomendacion de disponibilidad, no requisito en V1)') }
    else { Save-Check 'Network' 'Ethernet' 'INFO' 'sin adaptador Ethernet (no requerido en V1; recomendado para disponibilidad)' }
    $active = @($ethUp) + @($wifiUp)
    $primary = $null
    $defaults = @($adapters | Where-Object { $_.IsDefault -and $_.Status -eq 'Up' })
    if ($defaults.Count -gt 0) { $primary = $defaults[0] } elseif ($active.Count -gt 0) { $primary = $active[0] }
    if ($null -eq $primary) { Save-Check 'Network' 'Conexion principal' 'FAIL' 'ningun adaptador conectado'; return }
    Save-Check 'Network' 'Conexion principal' 'PASS' ('ruta por defecto: ' + $primary.Name + ' (' + $primary.Kind + ')' + $(if ($primary.Kind -eq 'Wi-Fi') { ' - red objetivo de V1' } else { '' }))
    $ip4 = @($primary.IPv4 | Where-Object { $_ -and $_ -notmatch '^169\.254\.' })
    Save-Check 'Network' 'IP actual' $(if ($ip4.Count -gt 0) { 'INFO' } else { 'FAIL' }) $(if ($ip4.Count -gt 0) { $ip4 -join ', ' } else { 'sin IPv4 valida (solo APIPA o ninguna)' })
    $ip6 = @($primary.IPv6 | Where-Object { $_ -and $_ -notmatch '^fe80:' })
    Save-Check 'Network' 'IPv6' 'INFO' $(if ($ip6.Count -gt 0) { $ip6 -join ', ' } else { 'solo link-local o ninguna' })
    Save-Check 'Network' 'Gateway' $(if ($primary.Gateway) { 'PASS' } else { 'FAIL' }) $(if ($primary.Gateway) { [string]$primary.Gateway } else { 'sin gateway: no hay salida de la LAN' })
    Save-Check 'Network' 'DNS' $(if (@($primary.Dns).Count -gt 0) { 'INFO' } else { 'WARN' }) $(if (@($primary.Dns).Count -gt 0) { @($primary.Dns) -join ', ' } else { 'sin servidores DNS' })
    Save-Check 'Network' 'MAC' 'INFO' ([string]$primary.Mac)
    if ($null -eq $primary.Dhcp) { Save-Check 'Network' 'DHCP' 'INFO' 'no determinado' }
    elseif ($primary.Dhcp) { Save-Check 'Network' 'DHCP' 'PASS' 'habilitado' }
    else { Save-Check 'Network' 'DHCP' 'WARN' 'IP fija configurada en Windows: se prefiere DHCP (con reserva en el router)' }
    $gc = Get-Prop $N 'GatewayCheck'
    if ($primary.Gateway -and $gc -and [string](Get-Prop $gc 'Gateway' '')) {
        $tcp = [string](Get-Prop $gc 'Tcp' ''); $nbState = [string](Get-Prop $gc 'NeighborState' ''); $nbMac = [string](Get-Prop $gc 'NeighborMac' '')
        $nbOk = (@('Reachable', 'Stale', 'Delay', 'Probe', 'Permanent') -contains $nbState) -and $nbMac -and $nbMac -notmatch '^(00-?)+$'
        $tcpOk = (@('open', 'refused') -contains $tcp)
        $evidence = 'TCP ' + $(if ($tcp) { $tcp } else { 'n/d' }) + $(if ((Get-Prop $gc 'TcpPort' 0)) { ' (puerto ' + (Get-Prop $gc 'TcpPort' 0) + ')' } else { '' }) + ', vecino ARP ' + $(if ($nbState) { $nbState } else { 'sin entrada' })
        if ($tcpOk -or $nbOk) { Save-Check 'Network' 'Conectividad local' 'PASS' ('el gateway ' + $gc.Gateway + ' responde en la LAN (' + $evidence + '; sin depender de ICMP)') }
        else { Save-Check 'Network' 'Conectividad local' 'WARN' ('no se pudo confirmar el gateway ' + $gc.Gateway + ' (' + $evidence + '); ICMP no se usa, el router puede filtrar TCP 80/443') }
    }
    $wifiPrimary = @($wifiUp | Where-Object { $_.Name -eq $primary.Name }) | Select-Object -First 1
    if ($wifiPrimary -or $wifiUp.Count -gt 0) {
        $ps = [string](Get-Prop (@($wifiUp)[0]) 'PowerSaving' '')
        if ($ps -eq 'Enabled') { Save-Check 'Network' 'Wi-Fi ahorro de energia' 'WARN' 'Windows puede apagar el adaptador Wi-Fi para ahorrar energia ("Permitir que el equipo apague este dispositivo"); desactivarlo en una fase posterior' }
        elseif ($ps -eq 'Disabled') { Save-Check 'Network' 'Wi-Fi ahorro de energia' 'PASS' 'Windows no puede apagar el adaptador Wi-Fi para ahorrar energia' }
        else { Save-Check 'Network' 'Wi-Fi ahorro de energia' 'INFO' 'no determinado (puede requerir sesion elevada)' }
    }
    $mac = [string]$primary.Mac; $ip = $(if ($ip4.Count -gt 0) { $ip4[0] } else { '?' })
    Save-Check 'Network' 'DHCP reservation' 'INFO' ('PENDIENTE (requiere administrar el router ZTE F689; sin autorizacion todavia): reservar ' + $mac + ' -> ' + $ip + '. Hasta entonces la IP puede cambiar')
    Save-Check 'Network' 'Perfil de red' 'INFO' ($(if ($primary.Profile) { [string]$primary.Profile } else { 'desconocido' }) + $(if ($primary.Profile -eq 'Public') { ' - decision de V1: se mantiene Public (no cambiar a Private); la regla del Hub debe cubrir Public (Profile Any)' } else { '' }))
}

function Test-FirewallChecks {
    param($F, $N, [int]$HubPort)
    if (-not $F.Available) { Save-Check 'Firewall' 'Estado' 'WARN' 'no se pudo leer el firewall de Windows (otro firewall o permisos)'; return }
    foreach ($name in 'Domain', 'Private', 'Public') {
        $on = [bool](Get-Prop $F.Profiles $name $true)
        Save-Check 'Firewall' ('Perfil ' + $name) $(if ($on) { 'PASS' } else { 'FAIL' }) $(if ($on) { 'habilitado' } else { 'DESHABILITADO: todos los puertos con listener quedan expuestos' })
    }
    $active = @($N.ActiveProfiles)
    $hubRules = @($F.Rules | Where-Object { ($_.Protocol -eq 'TCP' -or $_.Protocol -eq '6' -or $_.Protocol -eq 'Any') -and (Test-PortMatch $_.LocalPort $HubPort) -and (@($_.LocalPort) -notcontains 'Any') -and $_.Program -eq 'Any' })
    if ($hubRules.Count -eq 0) {
        Save-Check 'Firewall' ('Hub ' + $HubPort) 'FAIL' ('sin regla de entrada TCP ' + $HubPort + ' (RemoteAddress=LocalSubnet) - requerida para que la LAN llegue al Hub')
    } else {
        $scoped = @($hubRules | Where-Object { @($_.Remote).Count -gt 0 -and (@($_.Remote | Where-Object { $_ -ne 'LocalSubnet' }).Count -eq 0) })
        if ($scoped.Count -eq 0) {
            Save-Check 'Firewall' ('Hub ' + $HubPort) 'WARN' ('regla "' + $hubRules[0].Name + '" demasiado amplia: RemoteAddress=' + (@($hubRules[0].Remote) -join ',') + ' (se espera LocalSubnet)')
        } else {
            $covered = @($scoped | Where-Object { $p = Get-ProfileNames $_.Profile; $active.Count -eq 0 -or (@($active | Where-Object { $p -contains $_ }).Count -gt 0) })
            if ($covered.Count -eq 0) { Save-Check 'Firewall' ('Hub ' + $HubPort) 'WARN' ('regla LocalSubnet existe pero no cubre el perfil activo (' + ($active -join ',') + ')') }
            else { Save-Check 'Firewall' ('Hub ' + $HubPort) 'PASS' ('regla "' + $covered[0].Name + '" TCP ' + $HubPort + ' RemoteAddress=LocalSubnet') }
        }
    }
    foreach ($port in $script:ForbiddenPorts) {
        $rules = @($F.Rules | Where-Object { ($_.Protocol -eq 'TCP' -or $_.Protocol -eq '6' -or $_.Protocol -eq 'Any') -and $_.Program -eq 'Any' -and (@($_.LocalPort) -notcontains 'Any') -and (Test-PortMatch $_.LocalPort $port) })
        $listener = @($F.Listeners | Where-Object { $_.Port -eq $port }) | Select-Object -First 1
        $lt = if ($listener -and @($listener.Addresses).Count -gt 0) { ('escucha en ' + (@($listener.Addresses) -join ', ') + ' (' + $listener.Process + ')') } else { 'sin listener en el host' }
        $wide = (@($listener.Addresses | Where-Object { $_ -eq '0.0.0.0' -or $_ -eq '::' }).Count -gt 0)
        Save-Check 'Firewall' ('Listener ' + $port) 'INFO' $lt
        if ($rules.Count -gt 0) {
            Save-Check 'Firewall' ('Regla ' + $port) 'FAIL' ('regla de entrada "' + $rules[0].Name + '" permite TCP ' + $port + ' a ' + (@($rules[0].Remote) -join ',') + ' (puerto PROHIBIDO en la LAN)')
        } elseif ($wide -and $listener.Process -and @($F.Rules | Where-Object { $_.Program -match ('(?i)\\' + [regex]::Escape($listener.Process) + '\.exe$') -and (@($_.LocalPort) -contains 'Any') -and ($_.Protocol -eq 'TCP' -or $_.Protocol -eq 'Any') }).Count -gt 0) {
            $pr = @($F.Rules | Where-Object { $_.Program -match ('(?i)\\' + [regex]::Escape($listener.Process) + '\.exe$') -and (@($_.LocalPort) -contains 'Any') })[0]
            Save-Check 'Firewall' ('Regla ' + $port) 'WARN' ('sin regla por puerto, pero la regla por programa "' + $pr.Name + '" (perfil ' + $pr.Profile + ', remoto ' + (@($pr.Remote) -join ',') + ') permitiria acceso LAN al listener de ' + $listener.Process + ' cuando la red use ese perfil (el API Docker llega por loopback 127.0.0.1 via el proxy de Docker Desktop y no depende de esta regla); confirmar con una prueba desde otra maquina')
        } elseif ($wide) {
            Save-Check 'Firewall' ('Regla ' + $port) 'PASS' 'sin regla de entrada: el firewall por defecto bloquea la LAN (el listener en todas las interfaces no es accesible; se apoya solo en el firewall)'
        } else { Save-Check 'Firewall' ('Regla ' + $port) 'PASS' 'sin regla de entrada permisiva' }
    }
    $progRules = @($F.Rules | Where-Object { $_.Program -match '(?i)postgres|node\.exe|n8n' -and (@($_.LocalPort) -contains 'Any') })
    if ($progRules.Count -gt 0) { Save-Check 'Firewall' 'Reglas por programa' 'WARN' ('regla por programa "' + $progRules[0].Name + '" (perfil ' + $progRules[0].Profile + ', remoto ' + (@($progRules[0].Remote) -join ',') + ', cualquier puerto) puede exponer PostgreSQL/Node/n8n en la LAN cuando la red use ese perfil') }
    else { Save-Check 'Firewall' 'Reglas por programa' 'PASS' 'ninguna regla por programa para postgres/node/n8n' }
    $hubL = @($F.Listeners | Where-Object { $_.Port -eq $HubPort }) | Select-Object -First 1
    Save-Check 'Firewall' ('Listener ' + $HubPort) $(if ($hubL -and @($hubL.Addresses).Count -gt 0) { 'PASS' } else { 'WARN' }) $(if ($hubL -and @($hubL.Addresses).Count -gt 0) { 'escucha en ' + (@($hubL.Addresses) -join ', ') } else { 'nada escucha en el puerto del Hub' })
}

function Test-DockerChecks {
    param($D, [int]$HubPort)
    if (-not $D.Installed) { Save-Check 'Docker' 'Instalado' 'FAIL' 'docker no se encontro en el PATH'; return }
    Save-Check 'Docker' 'Instalado' 'PASS' ('cliente disponible' + $(if ($D.Version) { ', version ' + $D.Version } else { '' }))
    if (-not $D.DaemonUp) { Save-Check 'Docker' 'Daemon' 'FAIL' 'el daemon no responde (Docker Desktop detenido)'; return }
    Save-Check 'Docker' 'Daemon' 'PASS' ('servidor ' + $D.Version)
    Save-Check 'Docker' 'Backend WSL2' $(if ($D.Wsl2) { 'PASS' } else { 'WARN' }) $(if ($D.Wsl2) { 'WSL2' } else { 'no se detecto el backend WSL2' })
    $containers = @($D.Containers)
    Save-Check 'Docker' 'Proyectos Compose' 'INFO' $(if (@($D.Projects).Count -gt 0) { @($D.Projects) -join ', ' } else { 'ninguno' })
    $api = @($containers | Where-Object { $_.Project -eq $script:ProdProject -and $_.Name -match 'api' }) | Select-Object -First 1
    $web = @($containers | Where-Object { $_.Project -eq $script:ProdProject -and $_.Name -match 'web' }) | Select-Object -First 1
    if (-not $api) { Save-Check 'Docker' 'PROD api' 'FAIL' 'no existe el contenedor api del proyecto daubert-hub' }
    elseif ($api.State -eq 'running' -and $api.Health -eq 'healthy') { Save-Check 'Docker' 'PROD api' 'PASS' ($api.Name + ' running (healthy)') }
    else { Save-Check 'Docker' 'PROD api' 'FAIL' ($api.Name + ': ' + $api.State + $(if ($api.Health) { ' / ' + $api.Health } else { '' })) }
    if (-not $web) { Save-Check 'Docker' 'PROD web' 'FAIL' 'no existe el contenedor web del proyecto daubert-hub' }
    elseif ($web.State -eq 'running') { Save-Check 'Docker' 'PROD web' 'PASS' ($web.Name + ' running') }
    else { Save-Check 'Docker' 'PROD web' 'FAIL' ($web.Name + ': ' + $web.State) }
    foreach ($c in $containers) {
        $pub = @($c.Ports | ForEach-Object { $_.HostIp + ':' + $_.HostPort + '->' + $_.ContainerPort }) -join ', '
        Save-Check 'Docker' ('Puertos ' + $c.Name) 'INFO' $(if ($pub) { $pub } else { 'ninguno publicado' })
    }
    if ($api -and @($api.Ports).Count -gt 0) { Save-Check 'Docker' 'API no publicada' 'FAIL' 'el contenedor api publica puertos al host (debe quedar solo detras de web)' }
    elseif ($api) { Save-Check 'Docker' 'API no publicada' 'PASS' 'el api solo se expone dentro de la red Docker' }
    if ($web) {
        $webPub = @($web.Ports | Where-Object { $_.HostPort -eq [string]$HubPort })
        Save-Check 'Docker' ('Web publica ' + $HubPort) $(if ($webPub.Count -gt 0) { 'PASS' } else { 'WARN' }) $(if ($webPub.Count -gt 0) { 'web publica ' + $HubPort } else { 'web no publica el puerto ' + $HubPort + ' del Hub' })
    }
    $stopped = @($containers | Where-Object { $_.State -ne 'running' })
    if ($stopped.Count -gt 0) { Save-Check 'Docker' 'Contenedores detenidos' 'INFO' ((@($stopped | ForEach-Object { $_.Name + ' (' + $_.State + ')' }) -join ', ')) }
    $nets = @($containers | ForEach-Object { $_.Networks } | ForEach-Object { $_.Name + ' (' + $_.Ip + ')' } | Select-Object -Unique)
    Save-Check 'Docker' 'Redes' 'INFO' $(if ($nets.Count -gt 0) { $nets -join ', ' } else { 'ninguna' })
}

function Test-PostgresChecks {
    param($P)
    if (-not $P.ServiceFound) { Save-Check 'PostgreSQL' 'Servicio' 'FAIL' 'no existe un servicio postgresql* en Windows'; return }
    Save-Check 'PostgreSQL' 'Servicio' $(if ($P.Status -eq 'Running') { 'PASS' } else { 'FAIL' }) ($P.ServiceName + ': ' + $P.Status)
    if ($P.Version) { Save-Check 'PostgreSQL' 'Version' 'INFO' ('PostgreSQL ' + $P.Version) }
    $l = $P.Listener
    $addr = @(); if ($l) { $addr = @($l.Addresses) }
    if ($addr.Count -eq 0) { Save-Check 'PostgreSQL' 'Listener 5432' 'FAIL' 'nada escucha en 5432' }
    else { Save-Check 'PostgreSQL' 'Listener 5432' 'INFO' ('escucha en ' + ($addr -join ', ') + ' (' + $l.Process + ')') }
    if ($P.ConfReadable) {
        Save-Check 'PostgreSQL' 'Configuracion' 'INFO' ('listen_addresses=' + $(if ($P.ListenAddresses) { $P.ListenAddresses } else { '(por defecto)' }) + ', port=' + $(if ($P.Port) { $P.Port } else { '5432' }) + ' (leido de postgresql.conf, sin SQL)')
    } else { Save-Check 'PostgreSQL' 'Configuracion' 'INFO' 'postgresql.conf no legible con esta sesion' }
    if (-not $P.HbaReadable) { Save-Check 'PostgreSQL' 'pg_hba.conf' 'INFO' 'no legible con esta sesion (ejecutar elevado para revisarlo)'; return }
    $hostRules = @($P.HbaRules | Where-Object { $_.Type -match '^host' })
    $trust = @($P.HbaRules | Where-Object { $_.Method -eq 'trust' -and $_.Type -ne 'local' })
    $remote = @($hostRules | Where-Object { -not (Test-LoopbackAddress $_.Address) })
    if ($trust.Count -gt 0) { Save-Check 'PostgreSQL' 'pg_hba.conf' 'FAIL' 'existe una regla TCP con metodo trust (sin contrasena)' }
    elseif ($remote.Count -gt 0) { Save-Check 'PostgreSQL' 'pg_hba.conf' 'WARN' ('reglas TCP no loopback: ' + (@($remote | ForEach-Object { $_.Address }) -join ', ') + ' (revisar si se desea acceso remoto)') }
    else { Save-Check 'PostgreSQL' 'pg_hba.conf' 'PASS' ($hostRules.Count.ToString() + ' reglas TCP, todas loopback con autenticacion; el API en Docker llega por el proxy de Docker Desktop como 127.0.0.1, no se necesitan reglas Docker') }
    Save-Check 'PostgreSQL' 'Includes' $(if (@($P.Includes).Count -gt 0) { 'WARN' } else { 'PASS' }) $(if (@($P.Includes).Count -gt 0) { 'hay include/include_dir: la configuracion efectiva puede incluir reglas adicionales' } else { 'sin include/include_if_exists/include_dir' })
    Save-Check 'PostgreSQL' 'Arquitectura' 'INFO' 'API Docker -> host.docker.internal -> proxy Docker Desktop -> 127.0.0.1 -> PostgreSQL (arquitectura actual esperada)'
}

function Test-N8nChecks {
    param($M)
    if ($M.Running) { Save-Check 'n8n' 'Proceso' 'PASS' ('node n8n en ejecucion (PID ' + $M.Pid + ')') } else { Save-Check 'n8n' 'Proceso' 'FAIL' 'no se encontro el proceso de n8n' }
    Save-Check 'n8n' 'Version' 'INFO' $(if ($M.Version) { $M.Version } else { 'no determinada' })
    $l = $M.Listener
    $addr = @(); if ($l) { $addr = @($l.Addresses) }
    Save-Check 'n8n' 'Listener 5678' $(if ($addr.Count -gt 0) { 'INFO' } else { 'WARN' }) $(if ($addr.Count -gt 0) { 'escucha en ' + ($addr -join ', ') } else { 'nada escucha en 5678' })
    Save-Check 'n8n' 'Configuracion' $(if ($M.UserDirExists) { 'INFO' } else { 'WARN' }) ($M.UserDir + ': ' + $(if ($M.UserDirExists) { 'existe' } else { 'no existe' }) + ', config ' + $(if ($M.ConfigExists) { 'presente' } else { 'ausente' }) + ', database.sqlite ' + $(if ($M.SqliteExists) { 'presente' } else { 'ausente' }))
    $sup = @()
    if (@($M.Services).Count -gt 0) { $sup += 'servicio ' + $M.Services[0].Name }
    if ($M.SupervisorProcess) { $sup += 'supervisor ' + $M.SupervisorProcess }
    if ((Get-Prop $M 'LogonTask' '')) { $sup += 'tarea al iniciar sesion "' + (Get-Prop $M 'LogonTask' '') + '"' }
    Save-Check 'n8n' 'Supervisor' $(if ($sup.Count -gt 0) { 'PASS' } else { 'WARN' }) $(if ($sup.Count -gt 0) { $sup -join ', ' } else { 'sin servicio ni supervisor: si el proceso cae no se reinicia' })
    $interactive = ($M.Running -and [int]$M.SessionId -gt 0 -and @($M.Services).Count -eq 0)
    Save-Check 'n8n' 'Sesion interactiva' $(if ($interactive) { 'WARN' } else { 'PASS' }) $(if ($interactive) { 'corre en la sesion de usuario ' + $M.SessionId + ': depende de que el usuario inicie sesion' } else { 'no depende de una sesion interactiva' })
    foreach ($r in @($M.UserPathRefs)) {
        Save-Check 'n8n' ('Rutas de usuario: ' + $r.Location) $(if ([int]$r.Count -gt 0) { 'WARN' } else { 'PASS' }) ([string]$r.Count + ' referencias a la ruta del perfil de usuario actual (no portables a otro usuario/PC)')
    }
}

function Test-DropboxChecks {
    param($B)
    Save-Check 'Dropbox' 'Instalado' $(if ($B.Installed) { 'PASS' } else { 'FAIL' }) $(if ($B.Installed) { 'cliente presente' } else { 'cliente no encontrado' })
    Save-Check 'Dropbox' 'Proceso' $(if ($B.Running) { 'PASS' } else { 'WARN' }) $(if ($B.Running) { 'Dropbox en ejecucion' } else { 'Dropbox no esta en ejecucion' })
    Save-Check 'Dropbox' 'Ruta' $(if ($B.PathExists) { 'PASS' } elseif ($B.Path) { 'FAIL' } else { 'WARN' }) $(if ($B.Path) { [string]$B.Path + $(if ($B.PathExists) { '' } else { ' (no existe)' }) } else { 'ruta de Dropbox no determinada' })
    foreach ($fo in @($B.Folders)) { Save-Check 'Dropbox' ('Carpeta ' + $fo.Name) $(if ($fo.Exists) { 'PASS' } else { 'FAIL' }) ([string]$fo.Path + $(if ($fo.Exists) { '' } else { ' (no existe)' })) }
}

function Test-EnergyChecks {
    param($E)
    Save-Check 'Energy' 'Plan' 'INFO' $(if ($E.Plan) { $E.Plan } else { 'no determinado' })
    if ($null -eq $E.AcSleepMinutes) { Save-Check 'Energy' 'Suspension (CA)' 'WARN' 'no se pudo leer' }
    elseif ([int]$E.AcSleepMinutes -eq 0) { Save-Check 'Energy' 'Suspension (CA)' 'PASS' 'nunca (conectado a corriente)' }
    else { Save-Check 'Energy' 'Suspension (CA)' 'FAIL' ('suspende tras ' + $E.AcSleepMinutes + ' min con corriente: el servidor dejaria de responder') }
    if ($null -eq $E.AcHibernateMinutes) { Save-Check 'Energy' 'Hibernacion (CA)' 'WARN' 'no se pudo leer' }
    elseif ([int]$E.AcHibernateMinutes -eq 0) { Save-Check 'Energy' 'Hibernacion (CA)' 'PASS' 'no hiberna automaticamente' }
    else { Save-Check 'Energy' 'Hibernacion (CA)' 'FAIL' ('hiberna tras ' + $E.AcHibernateMinutes + ' min con corriente') }
    Save-Check 'Energy' 'Hibernacion disponible' 'INFO' $(if ($null -eq $E.HibernateEnabled) { 'no determinado' } elseif ($E.HibernateEnabled) { 'habilitada en el sistema (no se usa si el temporizador es 0)' } else { 'deshabilitada' })
    Save-Check 'Energy' 'Pantalla (CA)' 'INFO' $(if ($null -eq $E.AcDisplayMinutes) { 'no determinado' } elseif ([int]$E.AcDisplayMinutes -eq 0) { 'nunca se apaga' } else { 'se apaga tras ' + $E.AcDisplayMinutes + ' min (no afecta al servidor)' })
    $psm = Get-Prop $E 'WifiPowerSavingAc'
    if ($null -eq $psm) { Save-Check 'Energy' 'Wi-Fi modo ahorro (plan)' 'INFO' 'no determinado en el plan activo' }
    elseif ([int]$psm -eq 0) { Save-Check 'Energy' 'Wi-Fi modo ahorro (plan)' 'PASS' 'maximo rendimiento con corriente' }
    else { Save-Check 'Energy' 'Wi-Fi modo ahorro (plan)' 'WARN' ('el plan activo usa ahorro de energia del adaptador inalambrico con corriente (modo ' + $psm + '); puede degradar o cortar el Wi-Fi del servidor') }
    if ($E.IsPortable) { Save-Check 'Energy' 'Equipo portatil' 'WARN' 'hay bateria: revisar tambien la accion al cerrar la tapa' }
}

function Test-StartupChecks {
    param($D, $P, $M, $B, $S, $RepoRoot)
    if (-not $D.Installed) { Save-Check 'Startup' 'Docker Desktop' 'FAIL' 'Docker no instalado' }
    elseif ($null -ne $D.AutoStart) {
        Save-Check 'Startup' 'Docker Desktop' $(if ($D.AutoStart) { 'PASS' } else { 'FAIL' }) ('AutoStart=' + $D.AutoStart + ' en los ajustes de Docker Desktop; entrada Run presente=' + $D.RunKey + $(if (-not $D.AutoStart -and $D.RunKey) { ' (inconsistente: la entrada Run existe pero el ajuste esta desactivado)' } else { '' }))
    } else { Save-Check 'Startup' 'Docker Desktop' $(if ($D.RunKey) { 'PASS' } else { 'FAIL' }) ('entrada Run presente=' + $D.RunKey + ' (ajuste no legible)') }
    $prod = @($D.Containers | Where-Object { $_.Project -eq $script:ProdProject -and $_.Name -match '-(api|web)-\d+$' })
    if ($prod.Count -eq 0) { Save-Check 'Startup' 'Contenedores restart' 'INFO' 'sin contenedores PROD que evaluar' }
    else {
        $bad = @($prod | Where-Object { $_.Restart -ne 'unless-stopped' -and $_.Restart -ne 'always' })
        Save-Check 'Startup' 'Contenedores restart' $(if ($bad.Count -eq 0) { 'PASS' } else { 'FAIL' }) $(if ($bad.Count -eq 0) { 'PROD con restart unless-stopped' } else { 'sin restart unless-stopped: ' + (@($bad | ForEach-Object { $_.Name }) -join ', ') })
    }
    if (-not $P.ServiceFound) { Save-Check 'Startup' 'PostgreSQL' 'FAIL' 'sin servicio' }
    else { Save-Check 'Startup' 'PostgreSQL' $(if ($P.StartType -eq 'Automatic') { 'PASS' } else { 'FAIL' }) ('StartType=' + $P.StartType) }
    Save-Check 'Startup' 'n8n' $(if ($M.AutoStart) { 'PASS' } else { 'FAIL' }) $(if ((Get-Prop $M 'LogonTask' '')) { 'tarea habilitada "' + (Get-Prop $M 'LogonTask' '') + '" al iniciar sesion (modelo V1: una persona inicia sesion en horario de oficina)' } elseif ($M.AutoStart) { 'tiene servicio automatico o entrada de inicio' } else { 'no arranca automaticamente (ni servicio, ni tarea, ni inicio)' })
    Save-Check 'Startup' 'Dropbox' $(if ($B.AutoStart) { 'PASS' } else { 'WARN' }) $(if ($B.AutoStart) { 'arranca automaticamente' } else { 'sin entrada de inicio detectada' })
    Save-Check 'Startup' 'Programador de tareas' $(if ($S.SchedulerRunning) { 'PASS' } else { 'FAIL' }) $(if ($S.SchedulerRunning) { 'servicio Schedule en ejecucion' } else { 'servicio Schedule detenido' })
    foreach ($name in $script:BackupTaskNames) {
        $t = @($S.Tasks | Where-Object { $_.Name -eq $name }) | Select-Object -First 1
        if (-not $t) { Save-Check 'Startup' ('Tarea ' + $name) 'FAIL' 'no registrada'; continue }
        $okResult = ($null -eq $t.LastResult -or [int]$t.LastResult -eq 0 -or [int]$t.LastResult -eq 267011)
        $st = if ($t.State -eq 'Disabled') { 'FAIL' } elseif (-not $okResult) { 'WARN' } else { 'PASS' }
        Save-Check 'Startup' ('Tarea ' + $name) $st ('estado ' + $t.State + ', ultimo resultado ' + $(if ($null -eq $t.LastResult) { 'n/d' } else { [string]$t.LastResult }))
    }
}

function Test-SessionChecks {
    param($S)
    if ($S.AutoLogon) {
        Save-Check 'Startup' 'Arranque desatendido' 'INFO' 'AutoAdminLogon esta configurado en Windows (no se audita ni se muestra ninguna credencial)'
    } else {
        Save-Check 'Startup' 'Arranque desatendido' 'WARN' 'sin inicio de sesion automatico: tras un reinicio solo arranca lo que es servicio (PostgreSQL); Docker Desktop, n8n y Dropbox dependen del logon de un usuario. Decision de inicio de sesion de Windows pendiente (no se habilita AutoAdminLogon)'
    }
}

function Test-RepoChecks {
    param($R)
    Save-Check 'Hub' 'Repositorio' $(if ($R.IsRepo) { 'PASS' } else { 'FAIL' }) ([string]$R.Path + $(if (-not $R.IsRepo) { ' no es un repositorio Git' } else { '' }))
    if ($R.IsRepo) {
        Save-Check 'Hub' 'Rama' $(if ($R.Branch -eq 'main') { 'PASS' } else { 'WARN' }) ($(if ($R.Branch) { $R.Branch } else { '(detached)' }) + $(if ($R.Branch -ne 'main') { ' - PROD se despliega desde main' } else { '' }))
        Save-Check 'Hub' 'HEAD' 'INFO' ([string]$R.Head)
        Save-Check 'Hub' 'Working tree' $(if ([int]$R.DirtyCount -eq 0) { 'PASS' } else { 'WARN' }) $(if ([int]$R.DirtyCount -eq 0) { 'limpio' } else { [string]$R.DirtyCount + ' archivos modificados o sin seguimiento' })
        Save-Check 'Hub' 'Origin' $(if ($R.Origin) { 'INFO' } else { 'WARN' }) $(if ($R.Origin) { $R.Origin } else { 'sin remoto origin' })
    }
    Save-Check 'Hub' 'Compose PROD' $(if ($R.ComposePilot -and $R.ComposeProdTemp) { 'PASS' } else { 'FAIL' }) ('compose.pilot.yaml=' + $R.ComposePilot + ', compose.prod-temp.yaml=' + $R.ComposeProdTemp)
    Save-Check 'Hub' 'Compose TEST' $(if ($R.ComposePilot) { 'PASS' } else { 'WARN' }) ('TEST reutiliza compose.pilot.yaml con otro env-file y project-name; compose.pilot.yaml=' + $R.ComposePilot)
    Save-Check 'Hub' 'Version' 'INFO' $(if ($R.PackageVersion) { $R.PackageVersion } else { 'no determinada' })
    Save-Check 'Hub' 'Scripts de deploy' $(if ($R.DeployScripts) { 'PASS' } else { 'WARN' }) $(if ($R.DeployScripts) { 'scripts/deploy presentes' } else { 'scripts/deploy ausentes' })
    $h = $R.Health
    if (-not $h) { Save-Check 'Hub' '/api/health' 'FAIL' ('sin respuesta en http://127.0.0.1:' + $R.HubPort + '/api/health (PROD no activo)') }
    elseif ($h.Status -eq 'ok' -and $h.Database -eq 'connected') { Save-Check 'Hub' '/api/health' 'PASS' ('status ok, database connected, ' + $h.Environment + ', version ' + $h.Version + ', commit ' + $h.Commit) }
    else { Save-Check 'Hub' '/api/health' 'FAIL' ('HTTP ' + $h.Code + ', status=' + $h.Status + ', database=' + $h.Database) }
}

function Test-SeparationChecks {
    param($S, $D, $R)
    if ($S.ProjectEnvVar) { Save-Check 'TEST/PROD' 'COMPOSE_PROJECT_NAME' 'WARN' ('variable definida (' + $S.ProjectEnvVar + '): puede alterar el nombre del proyecto si se omite --project-name') }
    else { Save-Check 'TEST/PROD' 'COMPOSE_PROJECT_NAME' 'PASS' 'no definida en el entorno' }
    Save-Check 'TEST/PROD' 'Nombre del proyecto' $(if ($R.ComposeHasName) { 'PASS' } else { 'WARN' }) $(if ($R.ComposeHasName) { 'los compose declaran name:' } else { 'los compose no declaran name: el proyecto depende de --project-name o de la carpeta (docs/deploy usan daubert-hub-prod/daubert-hub-test; PROD real corre como daubert-hub)' })
    $projects = @($D.Projects)
    if ($projects.Count -gt 0) {
        $unexpected = @($projects | Where-Object { $_ -ne $script:ProdProject -and $_ -notmatch 'test' })
        Save-Check 'TEST/PROD' 'Proyectos en ejecucion' $(if ($unexpected.Count -eq 0) { 'PASS' } else { 'WARN' }) ('proyectos: ' + ($projects -join ', ') + $(if ($unexpected.Count -gt 0) { ' (nombres fuera de la convencion)' } else { '' }))
    }
    $p = $S.ProdEnv; $t = $S.TestEnv
    if (-not $p.Exists) { Save-Check 'TEST/PROD' 'Env PROD' 'FAIL' 'deploy/pilot.prod.env no existe' }
    else { Save-Check 'TEST/PROD' 'Env PROD' 'PASS' ('HUB_PORT=' + (Get-Prop $p 'HUB_PORT' '?') + ', DB=' + (Get-Prop $p 'DB_NAME' '?') + ', usuario=' + (Get-Prop $p 'DB_USER' '?')) }
    if (-not $t.Exists) { Save-Check 'TEST/PROD' 'Env TEST' 'INFO' 'deploy/pilot.test.env no existe en este equipo' }
    else { Save-Check 'TEST/PROD' 'Env TEST' 'INFO' ('HUB_PORT=' + (Get-Prop $t 'HUB_PORT' '?') + ', DB=' + (Get-Prop $t 'DB_NAME' '?') + ', usuario=' + (Get-Prop $t 'DB_USER' '?')) }
    if ($p.Exists -and $t.Exists) {
        $samePort = ((Get-Prop $p 'HUB_PORT' 'p') -eq (Get-Prop $t 'HUB_PORT' 't'))
        $sameDb = ((Get-Prop $p 'DB_NAME' 'p') -eq (Get-Prop $t 'DB_NAME' 't'))
        $sameUser = ((Get-Prop $p 'DB_USER' 'p') -eq (Get-Prop $t 'DB_USER' 't'))
        Save-Check 'TEST/PROD' 'Puertos distintos' $(if ($samePort) { 'FAIL' } else { 'PASS' }) $(if ($samePort) { 'TEST y PROD usan el mismo HUB_PORT' } else { 'HUB_PORT distinto' })
        Save-Check 'TEST/PROD' 'Base de datos distinta' $(if ($sameDb) { 'FAIL' } else { 'PASS' }) $(if ($sameDb) { 'TEST y PROD apuntan a la misma base de datos' } else { 'DB_NAME distinto' })
        Save-Check 'TEST/PROD' 'Usuario distinto' $(if ($sameUser) { 'FAIL' } else { 'PASS' }) $(if ($sameUser) { 'TEST y PROD usan el mismo usuario de base de datos' } else { 'DB_USER distinto' })
    }
    $nets = @($D.Containers | ForEach-Object { $_.Networks } | ForEach-Object { $_.Name } | Where-Object { $_ -ne 'bridge' } | Select-Object -Unique)
    Save-Check 'TEST/PROD' 'Redes Docker' 'INFO' $(if ($nets.Count -gt 0) { 'derivadas del proyecto: ' + ($nets -join ', ') } else { 'sin redes de proyecto' })
}

function Test-SecretChecks {
    param($S)
    foreach ($f in @($S.Files)) {
        if (-not $f.Exists) { Save-Check 'Secrets' $f.Label 'INFO' ('no existe: ' + $f.Location); continue }
        $parts = @('existe', $f.Location)
        $st = 'PASS'
        if ($null -eq $f.AclRisk) { $parts += 'ACL no legible'; $st = 'INFO' }
        elseif (@($f.AclRisk).Count -gt 0) { $parts += ('ACL legible por: ' + (@($f.AclRisk) -join ', ')); $st = 'WARN' }
        else { $parts += 'ACL restringida' }
        if ($null -ne $f.Tracked) {
            if ($f.Tracked) { $parts += 'TRACKED en Git'; $st = 'FAIL' } elseif ($f.Ignored) { $parts += 'no tracked, ignorado por Git' } else { $parts += 'no tracked, NO ignorado (riesgo de commit)'; if ($st -eq 'PASS') { $st = 'WARN' } }
        }
        Save-Check 'Secrets' $f.Label $st ($parts -join ' | ')
    }
    $copies = @($S.EnvCopies)
    Save-Check 'Secrets' 'Copias de env en el repo' $(if ($copies.Count -le 2) { 'INFO' } else { 'WARN' }) ([string]$copies.Count + ' archivos env no-example: ' + ($copies -join ', '))
}

function Test-StorageChecks {
    param($S)
    if (-not $S.ConfigFound) { Save-Check 'Backups' 'Configuracion' 'WARN' 'no se encontro C:\ProgramData\DaubertHub\Backup\config.json'; return }
    Save-Check 'Backups' 'Directorio raiz' $(if ($S.RootExists) { 'PASS' } else { 'FAIL' }) ([string]$S.BackupRoot + $(if ($S.RootExists) { '' } else { ' (no existe)' }))
    foreach ($t in @($S.Tiers)) {
        if (-not $t.Exists) { Save-Check 'Backups' ('Tier ' + $t.Name) $(if ($t.Name -eq 'N8N') { 'WARN' } else { 'FAIL' }) 'directorio ausente'; continue }
        if (-not $t.Latest) { Save-Check 'Backups' ('Tier ' + $t.Name) 'WARN' 'sin archivos de backup'; continue }
        $hours = [int]((Get-Date) - [datetime]$t.Latest).TotalHours
        $limit = if ($script:BackupTierFreshHours.ContainsKey($t.Name)) { $script:BackupTierFreshHours[$t.Name] } else { 24 * 9 }
        Save-Check 'Backups' ('Tier ' + $t.Name) $(if ($hours -le $limit) { 'PASS' } else { 'WARN' }) ('ultimo backup hace ' + $hours + ' h (limite ' + $limit + ' h)')
    }
}

function Test-DnsChecks {
    param($Dn)
    Save-Check 'DNS' 'Hostname actual' 'INFO' ([string]$Dn.Hostname)
    Save-Check 'DNS' 'Servidores DNS' 'INFO' $(if (@($Dn.Servers).Count -gt 0) { @($Dn.Servers) -join ', ' } else { 'ninguno' })
    Save-Check 'DNS' 'IP actual' 'INFO' $(if (@($Dn.Ip).Count -gt 0) { @($Dn.Ip) -join ', ' } else { 'ninguna' })
    if (-not $Dn.Requested) { Save-Check 'DNS' 'Nombre del Hub' 'INFO' 'no solicitado (use -DaubertHubHostname)'; return }
    $res = @($Dn.Resolved)
    if ($res.Count -eq 0) { Save-Check 'DNS' ('Resolver ' + $Dn.Requested) 'WARN' 'no resuelve actualmente' }
    elseif (@($res | Where-Object { @($Dn.Ip) -contains $_ }).Count -gt 0) { Save-Check 'DNS' ('Resolver ' + $Dn.Requested) 'PASS' ('resuelve a ' + ($res -join ', ') + ' (la IP de este equipo)') }
    else { Save-Check 'DNS' ('Resolver ' + $Dn.Requested) 'INFO' ('resuelve a ' + ($res -join ', ') + ' (no es la IP LAN de este equipo)') }
}

function Invoke-DiagEvaluation {
    param($Facts, [string]$RepoRoot)
    $script:Checks.Clear()
    $hubPort = [int](Get-Prop $Facts.Repo 'HubPort' $script:HubPort)
    Test-HostChecks $Facts.Host
    Test-NetworkChecks $Facts.Network
    Test-FirewallChecks $Facts.Firewall $Facts.Network $hubPort
    Test-DockerChecks $Facts.Docker $hubPort
    Test-PostgresChecks $Facts.Postgres
    Test-N8nChecks $Facts.N8n
    Test-DropboxChecks $Facts.Dropbox
    Test-EnergyChecks $Facts.Energy
    Test-StartupChecks $Facts.Docker $Facts.Postgres $Facts.N8n $Facts.Dropbox $Facts.Storage $RepoRoot
    Test-SessionChecks (Get-Prop $Facts 'Session' @{ AutoLogon = $false })
    Test-RepoChecks $Facts.Repo
    Test-SeparationChecks $Facts.Separation $Facts.Docker $Facts.Repo
    Test-SecretChecks $Facts.Secrets
    Test-StorageChecks $Facts.Storage
    Test-DnsChecks $Facts.Dns
    return @($script:Checks)
}

# ================================================================== Summary, target state and output
function Get-DiagSummary {
    param($Checks)
    $c = @($Checks)
    $pass = @($c | Where-Object { $_.Status -eq 'PASS' }).Count
    $warn = @($c | Where-Object { $_.Status -eq 'WARN' }).Count
    $fail = @($c | Where-Object { $_.Status -eq 'FAIL' }).Count
    $info = @($c | Where-Object { $_.Status -eq 'INFO' }).Count
    $conclusion = 'SERVIDOR PREPARADO'
    $exit = $script:ExitReady
    if ($fail -gt 0) { $conclusion = 'SERVIDOR NO PREPARADO'; $exit = $script:ExitNotReady }
    elseif ($warn -gt 0) { $conclusion = 'SERVIDOR PREPARADO CON ADVERTENCIAS'; $exit = $script:ExitWarnings }
    return @{ Pass = $pass; Warn = $warn; Fail = $fail; Info = $info; Conclusion = $conclusion; ExitCode = $exit }
}

function Get-TargetState {
    param([int]$HubPort)
    $targets = @(
        @{ Item = 'Wi-Fi (red de V1)'; Requirement = 'REQUIRED (V1)'; Area = 'Network'; Check = 'Wi-Fi' }
        @{ Item = 'Conectividad local'; Requirement = 'REQUIRED'; Area = 'Network'; Check = 'Conectividad local' }
        @{ Item = 'DHCP'; Requirement = 'REQUIRED'; Area = 'Network'; Check = 'DHCP' }
        @{ Item = 'DHCP reservation'; Requirement = 'PENDING (router)'; Area = 'Network'; Check = 'DHCP reservation' }
        @{ Item = 'Ethernet'; Requirement = 'RECOMMENDED (availability)'; Area = 'Network'; Check = 'Ethernet' }
        @{ Item = 'Wi-Fi sin ahorro de energia'; Requirement = 'RECOMMENDED'; Area = 'Network'; Check = 'Wi-Fi ahorro de energia' }
        @{ Item = 'DNS interno'; Requirement = 'OUT OF V1'; Area = ''; Check = ''; State = 'FUERA DE V1 (por ahora)' }
        @{ Item = ('TCP ' + $HubPort + ' LAN'); Requirement = 'REQUIRED'; Area = 'Firewall'; Check = ('Hub ' + $HubPort) }
        @{ Item = 'TCP 3000 LAN'; Requirement = 'FORBIDDEN'; Area = 'Firewall'; Check = 'Regla 3000' }
        @{ Item = 'TCP 5432 LAN'; Requirement = 'FORBIDDEN'; Area = 'Firewall'; Check = 'Regla 5432' }
        @{ Item = 'TCP 5678 LAN'; Requirement = 'FORBIDDEN'; Area = 'Firewall'; Check = 'Regla 5678' }
        @{ Item = 'Docker'; Requirement = 'REQUIRED'; Area = 'Docker'; Check = 'Daemon' }
        @{ Item = 'PostgreSQL host'; Requirement = 'CURRENT ARCHITECTURE'; Area = 'PostgreSQL'; Check = 'Servicio' }
        @{ Item = 'n8n host'; Requirement = 'CURRENT ARCHITECTURE'; Area = 'n8n'; Check = 'Proceso' }
        @{ Item = 'No sleep'; Requirement = 'REQUIRED'; Area = 'Energy'; Check = 'Suspension (CA)' }
        @{ Item = 'Docker arranque automatico'; Requirement = 'REQUIRED'; Area = 'Startup'; Check = 'Docker Desktop' }
        @{ Item = 'n8n arranque automatico'; Requirement = 'REQUIRED'; Area = 'Startup'; Check = 'n8n' }
        @{ Item = 'Arranque desatendido'; Requirement = 'DECISION PENDING'; Area = 'Startup'; Check = 'Arranque desatendido' }
        @{ Item = 'BitLocker'; Requirement = 'RECOMMENDED/REQUIRED'; Area = 'Host'; Check = 'BitLocker' }
        @{ Item = 'Cloudflare'; Requirement = 'FUTURE/OPTIONAL'; Area = ''; Check = '' }
        @{ Item = 'Tailscale'; Requirement = 'FUTURE/OPTIONAL'; Area = ''; Check = '' }
    )
    $rows = @()
    foreach ($t in $targets) {
        $state = 'NO EVALUADO'
        if ($t.ContainsKey('State')) { $state = $t.State }
        elseif ($t.Area) {
            $s = Get-CheckStatus $t.Area $t.Check
            if ($null -eq $s) { $state = 'DESCONOCIDO' }
            elseif ($s -eq 'PASS') { $state = 'CUMPLE' }
            elseif ($s -eq 'INFO') { $state = 'INFO' }
            else { $state = $(if ($s -eq 'WARN') { 'CUMPLE PARCIALMENTE' } else { 'NO CUMPLE' }) }
            if ($t.Item -eq 'DHCP reservation') { $state = 'PENDIENTE (requiere autorizacion en el ZTE F689; no comprobable desde el host)' }
            if ($t.Item -eq 'Ethernet') { $state = $(if ($s -eq 'INFO') { 'OPCIONAL (no bloquea V1)' } else { $state }) }
            if ($t.Item -eq 'DNS interno' -and $s -eq 'INFO') { $state = 'NO EVALUADO' }
        }
        $rows += [pscustomobject]@{ Item = $t.Item; Requirement = $t.Requirement; State = $state }
    }
    return $rows
}

function Get-NetworkSummaryFacts {
    param($N)
    $active = @($N.Adapters | Where-Object { $_.Status -eq 'Up' -and @($_.IPv4 | Where-Object { $_ -notmatch '^169\.254\.' }).Count -gt 0 })
    $primary = @($active | Where-Object { $_.IsDefault }) | Select-Object -First 1
    if (-not $primary) { $primary = @($active) | Select-Object -First 1 }
    if (-not $primary) { return $null }
    return [ordered]@{ Adapter = $primary.Name; Kind = $primary.Kind; Mac = $primary.Mac; IPv4 = @($primary.IPv4); Gateway = $primary.Gateway; Dhcp = $primary.Dhcp; Dns = @($primary.Dns); Profile = $primary.Profile }
}

function Format-DiagTable {
    param($Checks)
    $c = @($Checks)
    $wa = [math]::Max(4, (@($c | ForEach-Object { $_.Area.Length }) | Measure-Object -Maximum).Maximum)
    $wc = [math]::Max(5, (@($c | ForEach-Object { $_.Check.Length }) | Measure-Object -Maximum).Maximum)
    $lines = @()
    $lines += ('Area'.PadRight($wa) + '  ' + 'Check'.PadRight($wc) + '  ' + 'Status'.PadRight(6) + '  Detail')
    $lines += ('----'.PadRight($wa) + '  ' + '-----'.PadRight($wc) + '  ' + '------'.PadRight(6) + '  ------')
    foreach ($r in $c) { $lines += ($r.Area.PadRight($wa) + '  ' + $r.Check.PadRight($wc) + '  ' + $r.Status.PadRight(6) + '  ' + $r.Detail) }
    return $lines
}

function Show-DiagReport {
    param($Checks, $Summary, $Target)
    foreach ($l in (Format-DiagTable $Checks)) { Write-Host (Protect-Line $l) }
    Write-Host ''
    Write-Host ('Resumen: ' + $Summary.Pass + ' PASS, ' + $Summary.Warn + ' WARN, ' + $Summary.Fail + ' FAIL (' + $Summary.Info + ' INFO)')
    Write-Host $Summary.Conclusion
    Write-Host ''
    Write-Host 'ESTADO OBJETIVO DAUBERT HUB SERVER (solo informativo: este diagnostico no aplica nada)'
    $wi = [math]::Max(4, (@($Target | ForEach-Object { $_.Item.Length }) | Measure-Object -Maximum).Maximum)
    $wr = [math]::Max(11, (@($Target | ForEach-Object { $_.Requirement.Length }) | Measure-Object -Maximum).Maximum)
    foreach ($t in $Target) { Write-Host ($t.Item.PadRight($wi) + '  ' + $t.Requirement.PadRight($wr) + '  ' + $t.State) }
    Write-Host ''
    Write-Host 'Diagnostico de solo lectura: no se modifico nada en el equipo.'
}

function ConvertTo-DiagJson {
    param($Checks, $Summary, $Target, $Network, [string]$Hostname)
    $doc = [ordered]@{
        schemaVersion = 1
        generatedAt   = (Get-Date).ToString('o')
        hostname      = $Hostname
        readOnly      = $true
        summary       = [ordered]@{ pass = $Summary.Pass; warn = $Summary.Warn; fail = $Summary.Fail; info = $Summary.Info }
        conclusion    = $Summary.Conclusion
        exitCode      = $Summary.ExitCode
        network       = $Network
        checks        = @($Checks | ForEach-Object { [ordered]@{ area = $_.Area; check = $_.Check; status = $_.Status; detail = $_.Detail } })
        target        = @($Target | ForEach-Object { [ordered]@{ item = $_.Item; requirement = $_.Requirement; state = $_.State } })
    }
    return (Protect-Line ($doc | ConvertTo-Json -Depth 6))
}

function Show-DiagUsageError {
    param([string]$Message)
    Write-Host ('Error: ' + $Message)
    Write-Host 'Uso: Diagnose-DaubertServer.ps1 [-Json] [-RepoPath <ruta>] [-DaubertHubHostname <nombre>]'
    Write-Host 'Este script solo diagnostica; no existen -Configure, -Repair ni -Uninstall.'
}

function Invoke-DiagMain {
    param([bool]$AsJson, [string]$RepoPathArg, [string]$Hostname, [string[]]$Unknown)
    $extra = @()
    if ($Unknown) { $extra = @($Unknown | Where-Object { $_ }) }
    if ($extra.Count -gt 0) { Show-DiagUsageError ('argumentos no soportados: ' + ($extra -join ' ')); return $script:ExitUsage }
    $root = $script:DefaultRepoRoot
    if ($RepoPathArg) {
        if (-not (Test-Path -LiteralPath $RepoPathArg -PathType Container)) { Show-DiagUsageError ('-RepoPath no existe: ' + $RepoPathArg); return $script:ExitUsage }
        $root = [System.IO.Path]::GetFullPath($RepoPathArg)
    }
    if ($Hostname -and $Hostname -notmatch '^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$') {
        Show-DiagUsageError ('-DaubertHubHostname no es un nombre valido: ' + $Hostname); return $script:ExitUsage
    }
    $facts = Get-DiagFacts $root $Hostname
    $checks = Invoke-DiagEvaluation $facts $root
    $summary = Get-DiagSummary $checks
    $target = Get-TargetState ([int](Get-Prop $facts.Repo 'HubPort' $script:HubPort))
    if ($AsJson) {
        Write-Host (ConvertTo-DiagJson $checks $summary $target (Get-NetworkSummaryFacts $facts.Network) ([string]$facts.Host.Hostname))
    } else {
        Show-DiagReport $checks $summary $target
    }
    return $summary.ExitCode
}

# Dot-sourcing (tests) only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-DiagMain ([bool]$Json) $RepoPath $DaubertHubHostname $UnknownArguments)
}
