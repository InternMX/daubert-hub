# Pester 3.4 tests for scripts\server\Diagnose-DaubertServer.ps1
#
# Run with:  Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\server\tests
#
# These tests never touch the real host: the evaluators are pure functions over a facts table, and
# the collectors are exercised with their seams mocked (Invoke-DiagRead, Test-ToolAvailable,
# Get-DiagText, Get-Net* / Get-Service / Get-CimInstance cmdlets). No Docker, PostgreSQL, n8n,
# router or Internet access is required.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = [System.IO.Path]::GetFullPath((Join-Path $here '..\Diagnose-DaubertServer.ps1'))
. $scriptPath

$script:Printed = @()
$script:Facts = $null

function New-HealthyFacts {
    return @{
        Host       = @{ Edition = 'Microsoft Windows 11 Pro'; Version = '10.0.26200'; Build = '26200'; Arch = '64 bits'; RamGB = 16; Cpu = 'Test CPU'; CpuCores = 6
            Disks = @(@{ Name = 'C:'; SizeGB = 465; FreeGB = 280; IsSystem = $true }); Hostname = 'HUB-PC'; User = 'svc'; IsAdmin = $true; Domain = 'WORKGROUP'; PartOfDomain = $false
            Firmware = 'UEFI'; BitLocker = @{ Known = $true; Volumes = @(@{ Mount = $env:SystemDrive; Protection = 1 }) }; LastHotfix = (Get-Date).AddDays(-10); PendingReboot = $false; IsPortable = $false }
        Network    = @{ DefaultAdapter = 'Wi-Fi'; ActiveProfiles = @('Private'); GatewayCheck = @{ Gateway = '192.0.2.1'; Tcp = 'open'; TcpPort = 80; NeighborState = 'Reachable'; NeighborMac = 'AA-BB-CC-00-00-01' }
            Adapters = @(
                @{ Name = 'Ethernet'; Kind = 'Ethernet'; Status = 'Disconnected'; Mac = 'AA-BB-CC-DD-EE-FF'; IPv4 = @('169.254.1.2'); IPv6 = @(); Gateway = ''; Dns = @(); Dhcp = $true; Profile = ''; IsDefault = $false; PowerSaving = '' }
                @{ Name = 'Wi-Fi'; Kind = 'Wi-Fi'; Status = 'Up'; Mac = '02-00-5E-00-00-01'; IPv4 = @('192.0.2.11'); IPv6 = @('fe80::1'); Gateway = '192.0.2.1'; Dns = @('192.0.2.1'); Dhcp = $true; Profile = 'Private'; IsDefault = $true; PowerSaving = 'Disabled' }) }
        Firewall   = @{ Available = $true; Profiles = @{ Domain = $true; Private = $true; Public = $true }
            Rules = @(@{ Name = 'Daubert Hub 8082'; Profile = 'Private'; Protocol = 'TCP'; LocalPort = @('8082'); Remote = @('LocalSubnet'); Program = 'Any' })
            Listeners = @(@{ Port = 8082; Addresses = @('0.0.0.0'); Pid = 1; Process = 'com.docker.backend' }, @{ Port = 3000; Addresses = @(); Pid = 0; Process = '' },
                @{ Port = 5432; Addresses = @('127.0.0.1'); Pid = 2; Process = 'postgres' }, @{ Port = 5678; Addresses = @('127.0.0.1'); Pid = 3; Process = 'node' }) }
        Docker     = @{ Installed = $true; Version = '29.0.0'; DaemonUp = $true; Wsl2 = $true; AutoStart = $true; RunKey = $true; Projects = @('daubert-hub'); Networks = @('daubert-hub_pilot')
            Containers = @(
                @{ Name = 'daubert-hub-api-1'; Image = 'daubert-hub-api'; Id = 'aaaaaaaaaaaa'; Project = 'daubert-hub'; State = 'running'; Health = 'healthy'; Restart = 'unless-stopped'; Ports = @(); Networks = @(@{ Name = 'daubert-hub_pilot'; Ip = '172.20.0.2' }) }
                @{ Name = 'daubert-hub-web-1'; Image = 'daubert-hub-web'; Id = 'bbbbbbbbbbbb'; Project = 'daubert-hub'; State = 'running'; Health = ''; Restart = 'unless-stopped'; Ports = @(@{ HostIp = '0.0.0.0'; HostPort = '8082'; ContainerPort = '80/tcp' }); Networks = @(@{ Name = 'daubert-hub_pilot'; Ip = '172.20.0.3' }) }) }
        Postgres   = @{ ServiceFound = $true; ServiceName = 'postgresql-x64-18'; Status = 'Running'; StartType = 'Automatic'; Version = '18'; DataDir = 'C:\pgdata'
            Listener = @{ Port = 5432; Addresses = @('127.0.0.1'); Pid = 2; Process = 'postgres' }; HbaReadable = $true; ConfReadable = $true; ListenAddresses = 'localhost'; Port = '5432'; Includes = @()
            HbaRules = @(@{ Type = 'host'; Database = 'all'; User = 'all'; Address = '127.0.0.1/32'; Method = 'scram-sha-256' }, @{ Type = 'host'; Database = 'all'; User = 'all'; Address = '::1/128'; Method = 'scram-sha-256' }) }
        N8n        = @{ Running = $true; Pid = 10; SessionId = 0; Version = '2.0.0'; UserDir = 'C:\n8n'; UserDirExists = $true; ConfigExists = $true; SqliteExists = $true
            Listener = @{ Port = 5678; Addresses = @('127.0.0.1'); Pid = 3; Process = 'node' }; Services = @(@{ Name = 'n8n'; Status = 'Running'; StartType = 'Automatic' }); Tasks = @(); StartupEntries = @(); SupervisorProcess = ''
            AutoStart = $true; UserPathRefs = @(@{ Location = 'repo'; Count = 0 }) }
        Dropbox    = @{ Installed = $true; Running = $true; Path = 'C:\Dropbox'; PathExists = $true; AutoStart = $true; Folders = @(@{ Name = 'Backups Daubert'; Path = 'C:\Dropbox\B'; Exists = $true }) }
        Energy     = @{ Plan = 'Alto rendimiento'; AcSleepMinutes = 0; AcHibernateMinutes = 0; AcDisplayMinutes = 30; HibernateEnabled = $false; IsPortable = $false; WifiPowerSavingAc = 0 }
        Repo       = @{ Path = 'C:\repo'; IsRepo = $true; Branch = 'main'; Head = 'abc1234'; DirtyCount = 0; Origin = 'https://example.test/daubert-hub.git'; ComposePilot = $true; ComposeProdTemp = $true; ComposeBase = $true
            PackageVersion = '1.0.0'; DeployScripts = $true; HubPort = 8082; ComposeHasName = $true
            Health = @{ Code = 200; Status = 'ok'; Database = 'connected'; Environment = 'PRODUCTION'; Version = '1.0.0'; Commit = 'abc1234' } }
        Separation = @{ ProjectEnvVar = ''; ProdEnv = @{ Exists = $true; HUB_PORT = '8082'; DB_NAME = 'daubert_global'; DB_USER = 'daubert_hub_app' }
            TestEnv = @{ Exists = $true; HUB_PORT = '8081'; DB_NAME = 'daubert_hub_test'; DB_USER = 'daubert_hub_test_user' } }
        Secrets    = @{ Files = @(@{ Label = 'PROD env'; Location = 'C:\repo\deploy\pilot.prod.env'; Exists = $true; AclRisk = @(); Tracked = $false; Ignored = $true }); EnvCopies = @('deploy\pilot.prod.env', 'deploy\pilot.test.env') }
        Storage    = @{ ConfigFound = $true; BackupRoot = 'C:\Dropbox\B\POSTGRESQL'; RootExists = $true; SchedulerRunning = $true
            Tiers = @(@{ Name = 'FREQUENT'; Exists = $true; Latest = (Get-Date).AddHours(-2); Count = 3 }, @{ Name = 'DAILY'; Exists = $true; Latest = (Get-Date).AddHours(-5); Count = 3 },
                @{ Name = 'MONTHLY'; Exists = $true; Latest = (Get-Date).AddDays(-3); Count = 3 }, @{ Name = 'N8N'; Exists = $true; Latest = (Get-Date).AddDays(-2); Count = 1 })
            Tasks = @($script:BackupTaskNames | ForEach-Object { @{ Name = $_; State = 'Ready'; LogonType = 'S4U'; Actions = ''; LastRun = (Get-Date).AddHours(-2); LastResult = 0 } }) }
        Session    = @{ AutoLogon = $true }
        Dns        = @{ Hostname = 'HUB-PC'; Servers = @('192.0.2.1'); Ip = @('192.0.2.11'); Requested = ''; Resolved = @() }
    }
}

function Get-Row {
    param($Checks, [string]$Area, [string]$Check)
    return (@($Checks | Where-Object { $_.Area -eq $Area -and $_.Check -eq $Check }) | Select-Object -First 1)
}

function Invoke-Eval {
    param($Facts)
    return @(Invoke-DiagEvaluation $Facts 'C:\repo')
}

Describe 'Healthy server' {
    It 'produces no WARN or FAIL and the conclusion SERVIDOR PREPARADO with exit code 0' {
        $checks = Invoke-Eval (New-HealthyFacts)
        $bad = @($checks | Where-Object { $_.Status -eq 'WARN' -or $_.Status -eq 'FAIL' } | ForEach-Object { $_.Area + '/' + $_.Check + '=' + $_.Status + ': ' + $_.Detail })
        ($bad -join "`n") | Should Be ''
        $s = Get-DiagSummary $checks
        $s.Conclusion | Should Be 'SERVIDOR PREPARADO'
        $s.ExitCode | Should Be 0
    }
    It 'only uses the allowed statuses' {
        $checks = Invoke-Eval (New-HealthyFacts)
        @($checks | Where-Object { @('PASS', 'WARN', 'FAIL', 'INFO') -notcontains $_.Status }).Count | Should Be 0
    }
}

function New-EthernetUpAdapter {
    return @{ Name = 'Ethernet'; Kind = 'Ethernet'; Status = 'Up'; Mac = 'AA-BB-CC-DD-EE-FF'; IPv4 = @('192.0.2.50'); IPv6 = @(); Gateway = '192.0.2.1'; Dns = @('192.0.2.1'); Dhcp = $true; Profile = 'Private'; IsDefault = $true; PowerSaving = '' }
}

Describe 'Network (V1: Wi-Fi is the target network)' {
    It 'Wi-Fi connected and primary -> PASS, with IP/MAC/gateway/DHCP reported for the router' {
        $c = Invoke-Eval (New-HealthyFacts)
        (Get-Row $c 'Network' 'Wi-Fi').Status | Should Be 'PASS'
        (Get-Row $c 'Network' 'Wi-Fi').Detail | Should Match 'V1'
        (Get-Row $c 'Network' 'Conexion principal').Status | Should Be 'PASS'
        (Get-Row $c 'Network' 'DHCP').Status | Should Be 'PASS'
        (Get-Row $c 'Network' 'MAC').Detail | Should Be '02-00-5E-00-00-01'
        (Get-Row $c 'Network' 'IP actual').Detail | Should Be '192.0.2.11'
        (Get-Row $c 'Network' 'Gateway').Detail | Should Be '192.0.2.1'
    }
    It 'Wi-Fi only (Ethernet disconnected) produces no WARN or FAIL in the network rows that matter for V1' {
        $c = Invoke-Eval (New-HealthyFacts)
        (Get-Row $c 'Network' 'Ethernet').Status | Should Be 'INFO'
        (Get-Row $c 'Network' 'Ethernet').Detail | Should Match 'no requisito|no requerido'
        @($c | Where-Object { $_.Area -eq 'Network' -and ($_.Status -eq 'FAIL' -or $_.Status -eq 'WARN') }).Count | Should Be 0
    }
    It 'Ethernet is never WARN/FAIL: absent, disconnected or connected' {
        $f = New-HealthyFacts
        $f.Network.Adapters = @($f.Network.Adapters | Where-Object { $_.Kind -ne 'Ethernet' })
        (Get-Row (Invoke-Eval $f) 'Network' 'Ethernet').Status | Should Be 'INFO'
        $f = New-HealthyFacts
        $f.Network.Adapters[0] = New-EthernetUpAdapter
        (Get-Row (Invoke-Eval $f) 'Network' 'Ethernet').Status | Should Be 'INFO'
    }
    It 'Ethernet connected and used -> Conexion principal PASS, Wi-Fi disconnected is only INFO' {
        $f = New-HealthyFacts
        $f.Network.Adapters = @((New-EthernetUpAdapter), @{ Name = 'Wi-Fi'; Kind = 'Wi-Fi'; Status = 'Disconnected'; Mac = 'B'; IPv4 = @(); IPv6 = @(); Gateway = ''; Dns = @(); Dhcp = $true; Profile = ''; IsDefault = $false; PowerSaving = '' })
        $c = Invoke-Eval $f
        (Get-Row $c 'Network' 'Conexion principal').Status | Should Be 'PASS'
        (Get-Row $c 'Network' 'Wi-Fi').Status | Should Be 'INFO'
    }
    It 'Wi-Fi disconnected or disabled with no other connection -> FAIL' {
        $f = New-HealthyFacts
        $f.Network.Adapters[1].Status = 'Disconnected'
        $c = Invoke-Eval $f
        (Get-Row $c 'Network' 'Wi-Fi').Status | Should Be 'FAIL'
        (Get-Row $c 'Network' 'Conexion principal').Status | Should Be 'FAIL'
        $f = New-HealthyFacts
        $f.Network.Adapters[1].Status = 'Disabled'
        (Get-Row (Invoke-Eval $f) 'Network' 'Wi-Fi').Detail | Should Match 'deshabilitado'
    }
    It 'static IP configured in Windows -> DHCP WARN' {
        $f = New-HealthyFacts
        $f.Network.Adapters[1].Dhcp = $false
        (Get-Row (Invoke-Eval $f) 'Network' 'DHCP').Status | Should Be 'WARN'
    }
    It 'no gateway or only an APIPA address -> FAIL' {
        $f = New-HealthyFacts
        $f.Network.Adapters[1].Gateway = ''
        (Get-Row (Invoke-Eval $f) 'Network' 'Gateway').Status | Should Be 'FAIL'
        $f = New-HealthyFacts
        $f.Network.Adapters[1].IPv4 = @('169.254.9.9')
        (Get-Row (Invoke-Eval $f) 'Network' 'IP actual').Status | Should Be 'FAIL'
    }
    It 'Public network profile is a V1 decision: INFO (kept as Public), never WARN' {
        $f = New-HealthyFacts
        $f.Network.Adapters[1].Profile = 'Public'
        $row = Get-Row (Invoke-Eval $f) 'Network' 'Perfil de red'
        $row.Status | Should Be 'INFO'
        $row.Detail | Should Match 'se mantiene Public'
    }
    It 'without auto-logon the unattended boot is a WARN that states the dependency on a Windows logon decision' {
        $f = New-HealthyFacts
        $f.Session.AutoLogon = $false
        $row = Get-Row (Invoke-Eval $f) 'Startup' 'Arranque desatendido'
        $row.Status | Should Be 'WARN'
        $row.Detail | Should Match 'Docker Desktop, n8n y Dropbox dependen del logon'
        $row.Detail | Should Match 'no se habilita AutoAdminLogon'
        $f.Session.AutoLogon = $true
        (Get-Row (Invoke-Eval $f) 'Startup' 'Arranque desatendido').Status | Should Be 'INFO'
    }
    It 'collector reads only the AutoAdminLogon flag' {
        Mock Get-ItemProperty { [pscustomobject]@{ AutoAdminLogon = '0' } }
        (Get-SessionFacts).AutoLogon | Should Be $false
    }
    It 'local connectivity: gateway TCP open, TCP refused or a resolved ARP neighbor -> PASS (never depends on ICMP)' {
        $f = New-HealthyFacts
        (Get-Row (Invoke-Eval $f) 'Network' 'Conectividad local').Status | Should Be 'PASS'
        $f.Network.GatewayCheck = @{ Gateway = '192.0.2.1'; Tcp = 'refused'; TcpPort = 80; NeighborState = ''; NeighborMac = '' }
        (Get-Row (Invoke-Eval $f) 'Network' 'Conectividad local').Status | Should Be 'PASS'
        $f.Network.GatewayCheck = @{ Gateway = '192.0.2.1'; Tcp = 'timeout'; TcpPort = 0; NeighborState = 'Stale'; NeighborMac = 'AA-BB-CC-00-00-01' }
        $row = Get-Row (Invoke-Eval $f) 'Network' 'Conectividad local'
        $row.Status | Should Be 'PASS'
        $row.Detail | Should Match 'sin depender de ICMP'
    }
    It 'local connectivity not confirmed (TCP timeout and no neighbor entry) -> WARN, not FAIL' {
        $f = New-HealthyFacts
        $f.Network.GatewayCheck = @{ Gateway = '192.0.2.1'; Tcp = 'timeout'; TcpPort = 0; NeighborState = 'Incomplete'; NeighborMac = '00-00-00-00-00-00' }
        $row = Get-Row (Invoke-Eval $f) 'Network' 'Conectividad local'
        $row.Status | Should Be 'WARN'
        $row.Detail | Should Match 'ICMP no se usa'
    }
    It 'Wi-Fi power saving: adapter may be turned off -> WARN; disabled -> PASS; unknown -> INFO' {
        $f = New-HealthyFacts
        $f.Network.Adapters[1].PowerSaving = 'Enabled'
        (Get-Row (Invoke-Eval $f) 'Network' 'Wi-Fi ahorro de energia').Status | Should Be 'WARN'
        $f.Network.Adapters[1].PowerSaving = 'Disabled'
        (Get-Row (Invoke-Eval $f) 'Network' 'Wi-Fi ahorro de energia').Status | Should Be 'PASS'
        $f.Network.Adapters[1].PowerSaving = ''
        (Get-Row (Invoke-Eval $f) 'Network' 'Wi-Fi ahorro de energia').Status | Should Be 'INFO'
    }
    It 'active power plan with wireless power saving -> WARN; maximum performance -> PASS; unknown -> INFO' {
        $f = New-HealthyFacts
        $f.Energy.WifiPowerSavingAc = 2
        (Get-Row (Invoke-Eval $f) 'Energy' 'Wi-Fi modo ahorro (plan)').Status | Should Be 'WARN'
        $f.Energy.WifiPowerSavingAc = 0
        (Get-Row (Invoke-Eval $f) 'Energy' 'Wi-Fi modo ahorro (plan)').Status | Should Be 'PASS'
        $f.Energy.WifiPowerSavingAc = $null
        (Get-Row (Invoke-Eval $f) 'Energy' 'Wi-Fi modo ahorro (plan)').Status | Should Be 'INFO'
    }
    It 'DHCP reservation is reported as INFO/PENDING (needs router access), with MAC and IP, and never as PASS/FAIL' {
        $row = Get-Row (Invoke-Eval (New-HealthyFacts)) 'Network' 'DHCP reservation'
        $row.Status | Should Be 'INFO'
        $row.Detail | Should Match 'PENDIENTE'
        $row.Detail | Should Match 'el router'
        $row.Detail | Should Match '02-00-5E-00-00-01 -> 192\.0\.2\.11'
    }
    It 'collector: Wi-Fi Up as default route, gateway evidence and power saving (mocked cmdlets and seams)' {
        Mock Get-NetRoute { [pscustomobject]@{ InterfaceIndex = 7; RouteMetric = 0; InterfaceMetric = 40 } }
        Mock Get-NetAdapter {
            if ($Physical) { [pscustomobject]@{ Name = 'Wi-Fi'; ifIndex = 7; Status = 'Up'; MacAddress = '02-00-5E-00-00-01'; PhysicalMediaType = 'Native 802.11' } }
            else { [pscustomobject]@{ Name = 'Wi-Fi'; ifIndex = 7 } }
        }
        Mock Get-NetIPConfiguration {
            [pscustomobject]@{ IPv4Address = @([pscustomobject]@{ IPAddress = '192.0.2.11' }); IPv6Address = @(); IPv4DefaultGateway = @([pscustomobject]@{ NextHop = '192.0.2.1' })
                DnsServer = @([pscustomobject]@{ AddressFamily = 2; ServerAddresses = @('192.0.2.1') }) }
        }
        Mock Get-NetIPInterface { [pscustomobject]@{ Dhcp = 'Enabled' } }
        Mock Get-NetConnectionProfile { [pscustomobject]@{ NetworkCategory = 'Public' } }
        Mock Test-DiagTcp { 'open' }
        Mock Get-DiagNeighbor { @{ State = 'Reachable'; Mac = 'AA-BB-CC-00-00-01' } }
        Mock Get-DiagAdapterPower { 'Enabled' }
        $n = Get-NetworkFacts
        $n.Adapters[0].Kind | Should Be 'Wi-Fi'
        $n.Adapters[0].Status | Should Be 'Up'
        $n.Adapters[0].Dhcp | Should Be $true
        $n.Adapters[0].IsDefault | Should Be $true
        $n.Adapters[0].Gateway | Should Be '192.0.2.1'
        $n.Adapters[0].PowerSaving | Should Be 'Enabled'
        $n.GatewayCheck.Tcp | Should Be 'open'
        $n.GatewayCheck.NeighborState | Should Be 'Reachable'
        $f = New-HealthyFacts
        $f.Network = $n
        $c = Invoke-Eval $f
        (Get-Row $c 'Network' 'Wi-Fi').Status | Should Be 'PASS'
        (Get-Row $c 'Network' 'Conectividad local').Status | Should Be 'PASS'
        (Get-Row $c 'Network' 'Wi-Fi ahorro de energia').Status | Should Be 'WARN'
    }
    It 'collector: probes the gateway with TCP only (no ICMP) and keeps working when 80 times out but 443 answers' {
        Mock Get-NetRoute { [pscustomobject]@{ InterfaceIndex = 7; RouteMetric = 0; InterfaceMetric = 40 } }
        Mock Get-NetAdapter {
            if ($Physical) { [pscustomobject]@{ Name = 'Wi-Fi'; ifIndex = 7; Status = 'Up'; MacAddress = 'B0'; PhysicalMediaType = 'Native 802.11' } }
            else { [pscustomobject]@{ Name = 'Wi-Fi'; ifIndex = 7 } }
        }
        Mock Get-NetIPConfiguration { [pscustomobject]@{ IPv4Address = @([pscustomobject]@{ IPAddress = '192.0.2.11' }); IPv6Address = @(); IPv4DefaultGateway = @([pscustomobject]@{ NextHop = '192.0.2.1' }); DnsServer = @() } }
        Mock Get-NetIPInterface { [pscustomobject]@{ Dhcp = 'Enabled' } }
        Mock Get-NetConnectionProfile { [pscustomobject]@{ NetworkCategory = 'Private' } }
        Mock Test-DiagTcp { if ($Port -eq 80) { 'timeout' } else { 'refused' } }
        Mock Get-DiagNeighbor { $null }
        Mock Get-DiagAdapterPower { '' }
        $n = Get-NetworkFacts
        $n.GatewayCheck.Tcp | Should Be 'refused'
        $n.GatewayCheck.TcpPort | Should Be 443
    }
}

Describe 'Firewall' {
    It '3. Hub 8082 rule with RemoteAddress=LocalSubnet covering the active profile -> PASS' {
        (Get-Row (Invoke-Eval (New-HealthyFacts)) 'Firewall' 'Hub 8082').Status | Should Be 'PASS'
    }
    It '4. Hub 8082 rule missing -> FAIL' {
        $f = New-HealthyFacts
        $f.Firewall.Rules = @()
        (Get-Row (Invoke-Eval $f) 'Firewall' 'Hub 8082').Status | Should Be 'FAIL'
    }
    It 'Hub 8082 rule open to any remote address -> WARN' {
        $f = New-HealthyFacts
        $f.Firewall.Rules[0].Remote = @('Any')
        (Get-Row (Invoke-Eval $f) 'Firewall' 'Hub 8082').Status | Should Be 'WARN'
    }
    It 'Hub 8082 rule that does not cover the active profile -> WARN' {
        $f = New-HealthyFacts
        $f.Network.ActiveProfiles = @('Public')
        (Get-Row (Invoke-Eval $f) 'Firewall' 'Hub 8082').Status | Should Be 'WARN'
    }
    It 'a rule that opens 5432 to the LAN -> FAIL for that port, listener reported separately' {
        $f = New-HealthyFacts
        $f.Firewall.Rules += @{ Name = 'Postgres LAN'; Profile = 'Private'; Protocol = 'TCP'; LocalPort = @('5432'); Remote = @('LocalSubnet'); Program = 'Any' }
        $c = Invoke-Eval $f
        (Get-Row $c 'Firewall' 'Regla 5432').Status | Should Be 'FAIL'
        (Get-Row $c 'Firewall' 'Listener 5432').Status | Should Be 'INFO'
    }
    It 'a listener on all interfaces without any rule is not reported as exposed (listener and rule are separate)' {
        $f = New-HealthyFacts
        $f.Firewall.Listeners = @(@{ Port = 8082; Addresses = @('0.0.0.0'); Pid = 1; Process = 'x' }, @{ Port = 3000; Addresses = @(); Pid = 0; Process = '' },
            @{ Port = 5432; Addresses = @('0.0.0.0', '::'); Pid = 2; Process = 'postgres' }, @{ Port = 5678; Addresses = @('::'); Pid = 3; Process = 'node' })
        $c = Invoke-Eval $f
        (Get-Row $c 'Firewall' 'Regla 5432').Status | Should Be 'PASS'
        (Get-Row $c 'Firewall' 'Listener 5432').Detail | Should Match '0\.0\.0\.0'
    }
    It 'a program rule for node.exe (any port) plus an n8n listener on all interfaces -> WARN for 5678' {
        $f = New-HealthyFacts
        $f.Firewall.Listeners[3] = @{ Port = 5678; Addresses = @('::'); Pid = 3; Process = 'node' }
        $f.Firewall.Rules += @{ Name = 'Node.js JavaScript Runtime'; Profile = 'Private'; Protocol = 'TCP'; LocalPort = @('Any'); Remote = @('Any'); Program = 'C:\program files\nodejs\node.exe' }
        $c = Invoke-Eval $f
        (Get-Row $c 'Firewall' 'Regla 5678').Status | Should Be 'WARN'
        (Get-Row $c 'Firewall' 'Reglas por programa').Status | Should Be 'WARN'
    }
    It 'a disabled firewall profile -> FAIL' {
        $f = New-HealthyFacts
        $f.Firewall.Profiles.Public = $false
        (Get-Row (Invoke-Eval $f) 'Firewall' 'Perfil Public').Status | Should Be 'FAIL'
    }
    It 'collector: reads rules with their ports and remote addresses (mocked cmdlets)' {
        Mock Get-NetFirewallProfile { @([pscustomobject]@{ Name = 'Public'; Enabled = $true }) }
        Mock Get-NetFirewallRule { @([pscustomobject]@{ DisplayName = 'Daubert Hub 8082'; Profile = 'Private' }) }
        Mock Get-FirewallRuleFilter { @{ Port = [pscustomobject]@{ Protocol = 'TCP'; LocalPort = '8082' }; Address = [pscustomobject]@{ RemoteAddress = 'LocalSubnet' }; App = [pscustomobject]@{ Program = 'Any' } } }
        Mock Get-ListenerFacts { @() }
        $fw = Get-FirewallFacts
        $fw.Available | Should Be $true
        $fw.Rules[0].LocalPort[0] | Should Be '8082'
        $fw.Rules[0].Remote[0] | Should Be 'LocalSubnet'
    }
}

Describe 'Docker' {
    It '5. Docker healthy -> daemon, api healthy, web running, api not published' {
        $c = Invoke-Eval (New-HealthyFacts)
        (Get-Row $c 'Docker' 'Daemon').Status | Should Be 'PASS'
        (Get-Row $c 'Docker' 'PROD api').Status | Should Be 'PASS'
        (Get-Row $c 'Docker' 'PROD web').Status | Should Be 'PASS'
        (Get-Row $c 'Docker' 'API no publicada').Status | Should Be 'PASS'
    }
    It '6. Docker absent -> FAIL' {
        $f = New-HealthyFacts
        $f.Docker = @{ Installed = $false; Version = ''; DaemonUp = $false; Wsl2 = $false; AutoStart = $null; RunKey = $false; Containers = @(); Projects = @(); Networks = @() }
        $c = Invoke-Eval $f
        (Get-Row $c 'Docker' 'Instalado').Status | Should Be 'FAIL'
        (Get-Row $c 'Startup' 'Docker Desktop').Status | Should Be 'FAIL'
    }
    It 'unhealthy api -> FAIL' {
        $f = New-HealthyFacts
        $f.Docker.Containers[0].Health = 'unhealthy'
        (Get-Row (Invoke-Eval $f) 'Docker' 'PROD api').Status | Should Be 'FAIL'
    }
    It 'api publishing a port to the host -> FAIL' {
        $f = New-HealthyFacts
        $f.Docker.Containers[0].Ports = @(@{ HostIp = '0.0.0.0'; HostPort = '3000'; ContainerPort = '3000/tcp' })
        (Get-Row (Invoke-Eval $f) 'Docker' 'API no publicada').Status | Should Be 'FAIL'
    }
    It 'daemon down -> FAIL' {
        $f = New-HealthyFacts
        $f.Docker.DaemonUp = $false
        (Get-Row (Invoke-Eval $f) 'Docker' 'Daemon').Status | Should Be 'FAIL'
    }
    It 'Docker Desktop autostart disabled -> FAIL, and PROD containers without restart policy -> FAIL' {
        $f = New-HealthyFacts
        $f.Docker.AutoStart = $false
        $f.Docker.Containers[1].Restart = 'no'
        $c = Invoke-Eval $f
        (Get-Row $c 'Startup' 'Docker Desktop').Status | Should Be 'FAIL'
        (Get-Row $c 'Startup' 'Contenedores restart').Status | Should Be 'FAIL'
    }
    It 'collector: parses the container table from docker inspect without running anything mutating (mocked seam)' {
        Mock Test-ToolAvailable { $true }
        Mock Get-DiagText { '{"AutoStart":true}' }
        Mock Invoke-DiagRead {
            $line = $Exe + ' ' + ($CmdArgs -join ' ')
            if ($line -match '^docker version --format \{\{\.Server') { return @{ Code = 0; Out = @('29.0.0') } }
            if ($line -match '^docker info') { return @{ Code = 0; Out = @('5.15.0-microsoft-standard-WSL2|Docker Desktop') } }
            if ($line -match '^docker ps') { return @{ Code = 0; Out = @('daubert-hub-api-1') } }
            if ($line -match '^docker inspect') { return @{ Code = 0; Out = @('/daubert-hub-api-1|0123456789abcdef|daubert-hub-api|daubert-hub|running|healthy|unless-stopped||daubert-hub_pilot=172.20.0.2,') } }
            if ($line -match '^docker network ls') { return @{ Code = 0; Out = @('daubert-hub_pilot') } }
            throw ('inesperado: ' + $line)
        }
        $d = Get-DockerFacts
        $d.Installed | Should Be $true
        $d.DaemonUp | Should Be $true
        $d.Wsl2 | Should Be $true
        $d.AutoStart | Should Be $true
        $d.Containers[0].Name | Should Be 'daubert-hub-api-1'
        $d.Containers[0].Health | Should Be 'healthy'
        $d.Containers[0].Restart | Should Be 'unless-stopped'
        $d.Containers[0].Networks[0].Ip | Should Be '172.20.0.2'
    }
    It 'parses published ports (IPv4 and IPv6) from the inspect line' {
        $c = ConvertFrom-DockerInspectLine '/web|abcdef0123456789|img|daubert-hub|running||unless-stopped|0.0.0.0:8082->80/tcp,:::8082->80/tcp,|net=172.20.0.3,'
        @($c.Ports).Count | Should Be 2
        $c.Ports[1].HostIp | Should Be '::'
        $c.Ports[0].HostPort | Should Be '8082'
    }
}

Describe 'PostgreSQL' {
    It '7. service running and automatic -> PASS' {
        $c = Invoke-Eval (New-HealthyFacts)
        (Get-Row $c 'PostgreSQL' 'Servicio').Status | Should Be 'PASS'
        (Get-Row $c 'Startup' 'PostgreSQL').Status | Should Be 'PASS'
    }
    It 'service stopped -> FAIL' {
        $f = New-HealthyFacts
        $f.Postgres.Status = 'Stopped'
        (Get-Row (Invoke-Eval $f) 'PostgreSQL' 'Servicio').Status | Should Be 'FAIL'
    }
    It '8. listener on 5432 is reported; a missing listener -> FAIL' {
        $c = Invoke-Eval (New-HealthyFacts)
        (Get-Row $c 'PostgreSQL' 'Listener 5432').Detail | Should Match '127\.0\.0\.1'
        $f = New-HealthyFacts
        $f.Postgres.Listener = @{ Port = 5432; Addresses = @(); Pid = 0; Process = '' }
        (Get-Row (Invoke-Eval $f) 'PostgreSQL' 'Listener 5432').Status | Should Be 'FAIL'
    }
    It 'loopback-only pg_hba -> PASS and never asks for Docker network rules' {
        $c = Invoke-Eval (New-HealthyFacts)
        $row = Get-Row $c 'PostgreSQL' 'pg_hba.conf'
        $row.Status | Should Be 'PASS'
        $row.Detail | Should Not Match '172\.20|192\.168\.65'
        (Get-Row $c 'PostgreSQL' 'Arquitectura').Detail | Should Match 'host\.docker\.internal'
    }
    It 'a non-loopback TCP rule -> WARN; a trust rule -> FAIL; includes -> WARN' {
        $f = New-HealthyFacts
        $f.Postgres.HbaRules += @{ Type = 'host'; Database = 'all'; User = 'all'; Address = '192.0.2.0/24'; Method = 'scram-sha-256' }
        (Get-Row (Invoke-Eval $f) 'PostgreSQL' 'pg_hba.conf').Status | Should Be 'WARN'
        $f = New-HealthyFacts
        $f.Postgres.HbaRules += @{ Type = 'host'; Database = 'all'; User = 'all'; Address = '127.0.0.1/32'; Method = 'trust' }
        (Get-Row (Invoke-Eval $f) 'PostgreSQL' 'pg_hba.conf').Status | Should Be 'FAIL'
        $f = New-HealthyFacts
        $f.Postgres.Includes = @(@{ Type = 'conf-include'; Address = "include_dir = 'conf.d'" })
        (Get-Row (Invoke-Eval $f) 'PostgreSQL' 'Includes').Status | Should Be 'WARN'
    }
    It 'parses pg_hba text (host/local/include lines, ignoring comments)' {
        $rules = @(ConvertFrom-HbaText @('# comment', 'host all all 127.0.0.1/32 scram-sha-256', 'host all all 127.0.0.1 255.255.255.255 scram-sha-256', 'local all all scram-sha-256', 'include_dir conf.d'))
        $rules.Count | Should Be 4
        $rules[1].Method | Should Be 'scram-sha-256'
        $rules[3].Type | Should Be 'include_dir'
    }
    It 'collector: reads the service, data dir and pg_hba without SQL (mocked)' {
        Mock Get-Service { [pscustomobject]@{ Name = 'postgresql-x64-18'; Status = 'Running'; StartType = 'Automatic' } }
        Mock Get-CimInstance { [pscustomobject]@{ PathName = '"C:\pg\bin\pg_ctl.exe" runservice -N "postgresql-x64-18" -D "C:\pgdata" -w' } }
        Mock Get-ListenerFacts { @(@{ Port = 5432; Addresses = @('127.0.0.1'); Pid = 1; Process = 'postgres' }) }
        Mock Get-DiagText {
            if ($Path -like '*pg_hba.conf') { return "host all all 127.0.0.1/32 scram-sha-256`nhost all all ::1/128 scram-sha-256" }
            return "listen_addresses = '*'`nport = 5432"
        }
        $p = Get-PostgresFacts
        $p.ServiceFound | Should Be $true
        $p.Version | Should Be '18'
        $p.DataDir | Should Be 'C:\pgdata'
        @($p.HbaRules).Count | Should Be 2
        $p.ListenAddresses | Should Be '*'
        @($p.Includes).Count | Should Be 0
    }
}

Describe 'n8n' {
    It '9. n8n running as a service with automatic startup -> PASS' {
        $c = Invoke-Eval (New-HealthyFacts)
        (Get-Row $c 'n8n' 'Proceso').Status | Should Be 'PASS'
        (Get-Row $c 'n8n' 'Supervisor').Status | Should Be 'PASS'
        (Get-Row $c 'Startup' 'n8n').Status | Should Be 'PASS'
    }
    It '10. n8n running from a user session without service/task/startup -> not automatic (FAIL), interactive and unsupervised (WARN)' {
        $f = New-HealthyFacts
        $f.N8n.Services = @(); $f.N8n.AutoStart = $false; $f.N8n.SessionId = 2
        $c = Invoke-Eval $f
        (Get-Row $c 'Startup' 'n8n').Status | Should Be 'FAIL'
        (Get-Row $c 'n8n' 'Sesion interactiva').Status | Should Be 'WARN'
        (Get-Row $c 'n8n' 'Supervisor').Status | Should Be 'WARN'
        (Get-Row $c 'n8n' 'Proceso').Status | Should Be 'PASS'
    }
    It 'n8n supervised by an enabled AtLogOn task (no service, no AutoAdminLogon) -> Startup PASS, Supervisor PASS, interactive WARN stays separate' {
        $f = New-HealthyFacts
        $f.N8n.Services = @(); $f.N8n.AutoStart = $true; $f.N8n.LogonTask = 'Daubert - n8n Supervisor'; $f.N8n.SessionId = 2
        $f.Session.AutoLogon = $false
        $c = Invoke-Eval $f
        (Get-Row $c 'Startup' 'n8n').Status | Should Be 'PASS'
        (Get-Row $c 'Startup' 'n8n').Detail | Should Match 'Daubert - n8n Supervisor'
        (Get-Row $c 'n8n' 'Supervisor').Status | Should Be 'PASS'
        (Get-Row $c 'n8n' 'Sesion interactiva').Status | Should Be 'WARN'
        (Get-Row $c 'Startup' 'Arranque desatendido').Status | Should Be 'WARN'
    }
    It 'Test-LogonTaskForUser accepts an enabled logon trigger for the principal (domain-qualified or not)' {
        $t = @{ Name = 'x'; State = 'Running'; UserId = 'hubuser'; Triggers = @(@{ Type = 'MSFT_TaskLogonTrigger'; UserId = 'HUB-PC\hubuser'; Delay = 'PT1M'; Enabled = $true }) }
        (Test-LogonTaskForUser $t) | Should Be $true
    }
    It 'Test-LogonTaskForUser rejects disabled tasks, other users, disabled triggers and non-logon triggers' {
        $trg = @{ Type = 'MSFT_TaskLogonTrigger'; UserId = 'PC\hubuser'; Delay = ''; Enabled = $true }
        (Test-LogonTaskForUser @{ State = 'Disabled'; UserId = 'hubuser'; Triggers = @($trg) }) | Should Be $false
        (Test-LogonTaskForUser @{ State = 'Ready'; UserId = 'other'; Triggers = @($trg) }) | Should Be $false
        (Test-LogonTaskForUser @{ State = 'Ready'; UserId = 'hubuser'; Triggers = @(@{ Type = 'MSFT_TaskLogonTrigger'; UserId = 'PC\hubuser'; Enabled = $false }) }) | Should Be $false
        (Test-LogonTaskForUser @{ State = 'Ready'; UserId = 'hubuser'; Triggers = @(@{ Type = 'MSFT_TaskDailyTrigger'; UserId = ''; Enabled = $true }) }) | Should Be $false
        (Test-LogonTaskForUser @{ State = 'Ready'; UserId = 'hubuser'; Triggers = @() }) | Should Be $false
    }
    It 'n8n not running -> FAIL' {
        $f = New-HealthyFacts
        $f.N8n.Running = $false
        (Get-Row (Invoke-Eval $f) 'n8n' 'Proceso').Status | Should Be 'FAIL'
    }
    It 'reports the number of user-path references (never their content) and warns when > 0' {
        $f = New-HealthyFacts
        $f.N8n.UserPathRefs = @(@{ Location = 'repo'; Count = 5 })
        $row = Get-Row (Invoke-Eval $f) 'n8n' 'Rutas de usuario: repo'
        $row.Status | Should Be 'WARN'
        $row.Detail | Should Match '^5 referencias'
    }
}

Describe 'Energy' {
    It '11. sleep enabled with AC power -> FAIL' {
        $f = New-HealthyFacts
        $f.Energy.AcSleepMinutes = 30
        (Get-Row (Invoke-Eval $f) 'Energy' 'Suspension (CA)').Status | Should Be 'FAIL'
    }
    It 'sleep never and hibernate never -> PASS; hibernate timer set -> FAIL' {
        $c = Invoke-Eval (New-HealthyFacts)
        (Get-Row $c 'Energy' 'Suspension (CA)').Status | Should Be 'PASS'
        (Get-Row $c 'Energy' 'Hibernacion (CA)').Status | Should Be 'PASS'
        $f = New-HealthyFacts
        $f.Energy.AcHibernateMinutes = 180
        (Get-Row (Invoke-Eval $f) 'Energy' 'Hibernacion (CA)').Status | Should Be 'FAIL'
    }
    It 'parses powercfg /query output independent of locale (last two values are AC and DC)' {
        $out = @('  GUID de subgrupo: x', '    Configuracion minima posible: 0x00000000', '    Configuracion maxima posible: 0xffffffff', '    Indice de configuracion de alimentacion de CA actual: 0x00000708', '    Indice de configuracion de alimentacion de CC actual: 0x00000384')
        $r = ConvertFrom-PowerCfgQuery $out
        $r.AcMinutes | Should Be 30
        $r.DcMinutes | Should Be 15
        (ConvertFrom-PowerCfgQuery @('nada')) | Should Be $null
    }
    It 'collector: reads only through powercfg query verbs (mocked seam)' {
        Mock Test-ToolAvailable { $true }
        Mock Invoke-DiagRead {
            if ($CmdArgs[0] -eq '/getactivescheme') { return @{ Code = 0; Out = @('GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Equilibrado)') } }
            return @{ Code = 0; Out = @('x: 0x00000000', 'x: 0x00000000') }
        }
        $e = Get-EnergyFacts
        $e.Plan | Should Be 'Equilibrado'
        $e.AcSleepMinutes | Should Be 0
    }
}

Describe 'Host' {
    It '12. BitLocker protecting the system drive -> PASS' {
        (Get-Row (Invoke-Eval (New-HealthyFacts)) 'Host' 'BitLocker').Status | Should Be 'PASS'
    }
    It '12. BitLocker off -> WARN; not readable (not elevated) -> INFO, never claimed as PASS' {
        $f = New-HealthyFacts
        $f.Host.BitLocker.Volumes = @(@{ Mount = $env:SystemDrive; Protection = 0 })
        (Get-Row (Invoke-Eval $f) 'Host' 'BitLocker').Status | Should Be 'WARN'
        $f = New-HealthyFacts
        $f.Host.BitLocker = @{ Known = $false; Volumes = @() }
        (Get-Row (Invoke-Eval $f) 'Host' 'BitLocker').Status | Should Be 'INFO'
    }
    It 'low RAM / low disk / old Windows update are flagged' {
        $f = New-HealthyFacts
        $f.Host.RamGB = 4; $f.Host.Disks[0].FreeGB = 5; $f.Host.LastHotfix = (Get-Date).AddDays(-400)
        $c = Invoke-Eval $f
        (Get-Row $c 'Host' 'RAM').Status | Should Be 'WARN'
        (Get-Row $c 'Host' 'Disco C:').Status | Should Be 'FAIL'
        (Get-Row $c 'Host' 'Windows Update').Status | Should Be 'WARN'
    }
}

Describe 'Daubert Hub repository' {
    It '13. clean working tree -> PASS, dirty -> WARN (evaluators)' {
        (Get-Row (Invoke-Eval (New-HealthyFacts)) 'Hub' 'Working tree').Status | Should Be 'PASS'
        $f = New-HealthyFacts
        $f.Repo.DirtyCount = 3
        $row = Get-Row (Invoke-Eval $f) 'Hub' 'Working tree'
        $row.Status | Should Be 'WARN'
        $row.Detail | Should Match '3 archivos'
    }
    It '13. collector: counts dirty files through git status only (mocked seam)' {
        Mock Test-ToolAvailable { $true }
        Mock Read-SafeEnvKeys { @{ Exists = $true; HUB_PORT = '8082' } }
        Mock Invoke-DiagHttp { @{ Code = 200; Body = '{"status":"ok","database":"connected","environment":"PRODUCTION","version":"1.0.0","commit":"abc1234"}' } }
        Mock Invoke-DiagRead {
            $line = $Exe + ' ' + ($CmdArgs -join ' ')
            if ($line -match 'rev-parse --show-toplevel') { return @{ Code = 0; Out = @('C:/repo') } }
            if ($line -match 'branch --show-current') { return @{ Code = 0; Out = @('main') } }
            if ($line -match 'rev-parse --short HEAD') { return @{ Code = 0; Out = @('abc1234') } }
            if ($line -match 'status --short') { return @{ Code = 0; Out = @(' M a.txt', '?? b.txt') } }
            if ($line -match 'remote get-url origin') { return @{ Code = 0; Out = @('https://user:secret@example.test/r.git') } }
            throw ('inesperado: ' + $line)
        }
        $r = Get-RepoFacts $script:DefaultRepoRoot
        $r.IsRepo | Should Be $true
        $r.DirtyCount | Should Be 2
        $r.Branch | Should Be 'main'
        $r.Health.Database | Should Be 'connected'
        $r.HubPort | Should Be 8082
    }
    It 'health that is unreachable -> FAIL; database not connected -> FAIL' {
        $f = New-HealthyFacts
        $f.Repo.Health = $null
        (Get-Row (Invoke-Eval $f) 'Hub' '/api/health').Status | Should Be 'FAIL'
        $f = New-HealthyFacts
        $f.Repo.Health.Database = 'disconnected'
        (Get-Row (Invoke-Eval $f) 'Hub' '/api/health').Status | Should Be 'FAIL'
    }
    It 'branch other than main -> WARN' {
        $f = New-HealthyFacts
        $f.Repo.Branch = 'feature/x'
        (Get-Row (Invoke-Eval $f) 'Hub' 'Rama').Status | Should Be 'WARN'
    }
}

Describe 'TEST/PROD separation, secrets, backups, DNS' {
    It 'same HUB_PORT or DB_NAME between TEST and PROD -> FAIL' {
        $f = New-HealthyFacts
        $f.Separation.TestEnv.HUB_PORT = '8082'; $f.Separation.TestEnv.DB_NAME = 'daubert_global'
        $c = Invoke-Eval $f
        (Get-Row $c 'TEST/PROD' 'Puertos distintos').Status | Should Be 'FAIL'
        (Get-Row $c 'TEST/PROD' 'Base de datos distinta').Status | Should Be 'FAIL'
    }
    It 'COMPOSE_PROJECT_NAME defined or compose files without name: -> WARN (reported, not corrected)' {
        $f = New-HealthyFacts
        $f.Separation.ProjectEnvVar = 'foo'; $f.Repo.ComposeHasName = $false
        $c = Invoke-Eval $f
        (Get-Row $c 'TEST/PROD' 'COMPOSE_PROJECT_NAME').Status | Should Be 'WARN'
        (Get-Row $c 'TEST/PROD' 'Nombre del proyecto').Status | Should Be 'WARN'
    }
    It 'secret files: tracked in Git -> FAIL, readable by extra identities -> WARN, values never read' {
        $f = New-HealthyFacts
        $f.Secrets.Files[0].Tracked = $true
        (Get-Row (Invoke-Eval $f) 'Secrets' 'PROD env').Status | Should Be 'FAIL'
        $f = New-HealthyFacts
        $f.Secrets.Files[0].AclRisk = @('BUILTIN\Users')
        $row = Get-Row (Invoke-Eval $f) 'Secrets' 'PROD env'
        $row.Status | Should Be 'WARN'
        $row.Detail | Should Match 'BUILTIN\\Users'
    }
    It 'Read-SafeEnvKeys returns only the non-secret keys' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('diag-env-' + [guid]::NewGuid().ToString('N') + '.env')
        try {
            Set-Content -LiteralPath $tmp -Value @('HUB_PORT=8082', 'DB_NAME=daubert_global', 'DB_PASSWORD=supersecret', 'CATERPILLAR_REPROCESS_WEBHOOK_TOKEN=tok123')
            $r = Read-SafeEnvKeys $tmp
            $r.HUB_PORT | Should Be '8082'
            $r.DB_NAME | Should Be 'daubert_global'
            $r.ContainsKey('DB_PASSWORD') | Should Be $false
            ($r.Values -join ' ') | Should Not Match 'supersecret|tok123'
        } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
    It 'stale backups -> WARN, missing tier directory -> FAIL' {
        $f = New-HealthyFacts
        $f.Storage.Tiers[1].Latest = (Get-Date).AddDays(-10)
        $f.Storage.Tiers[0].Exists = $false
        $c = Invoke-Eval $f
        (Get-Row $c 'Backups' 'Tier DAILY').Status | Should Be 'WARN'
        (Get-Row $c 'Backups' 'Tier FREQUENT').Status | Should Be 'FAIL'
    }
    It 'missing or failed backup tasks are flagged' {
        $f = New-HealthyFacts
        $f.Storage.Tasks = @($f.Storage.Tasks | Where-Object { $_.Name -ne 'Daubert - n8n Weekly' })
        $f.Storage.Tasks[0].LastResult = 1
        $c = Invoke-Eval $f
        (Get-Row $c 'Startup' 'Tarea Daubert - n8n Weekly').Status | Should Be 'FAIL'
        (Get-Row $c 'Startup' ('Tarea ' + $f.Storage.Tasks[0].Name)).Status | Should Be 'WARN'
    }
    It 'DNS: no hostname requested -> INFO; resolves to this IP -> PASS; does not resolve -> WARN' {
        (Get-Row (Invoke-Eval (New-HealthyFacts)) 'DNS' 'Nombre del Hub').Status | Should Be 'INFO'
        $f = New-HealthyFacts
        $f.Dns.Requested = 'hub.example.internal'; $f.Dns.Resolved = @('192.0.2.11')
        (Get-Row (Invoke-Eval $f) 'DNS' 'Resolver hub.example.internal').Status | Should Be 'PASS'
        $f.Dns.Resolved = @()
        (Get-Row (Invoke-Eval $f) 'DNS' 'Resolver hub.example.internal').Status | Should Be 'WARN'
    }
}

Describe 'V1 blockers vs warnings (Wi-Fi host)' {
    It 'a healthy Wi-Fi-only host is SERVIDOR PREPARADO (Ethernet absence does not block)' {
        $s = Get-DiagSummary (Invoke-Eval (New-HealthyFacts))
        $s.Conclusion | Should Be 'SERVIDOR PREPARADO'
    }
    It 'the current blockers: missing LAN rule for TCP 8082 and n8n without automatic startup are FAIL' {
        $f = New-HealthyFacts
        $f.Firewall.Rules = @()
        $f.N8n.Services = @(); $f.N8n.AutoStart = $false
        $c = Invoke-Eval $f
        (Get-Row $c 'Firewall' 'Hub 8082').Status | Should Be 'FAIL'
        (Get-Row $c 'Startup' 'n8n').Status | Should Be 'FAIL'
        (Get-DiagSummary $c).Conclusion | Should Be 'SERVIDOR NO PREPARADO'
    }
    It 'Docker AutoStart, secrets, Dropbox and hardcoded paths stay as WARN/FAIL-free warnings with only the two blockers present' {
        $f = New-HealthyFacts
        $f.Dropbox.AutoStart = $false
        $f.Secrets.Files[0].AclRisk = @('BUILTIN\Users')
        $f.N8n.UserPathRefs = @(@{ Location = 'repo'; Count = 5 })
        $c = Invoke-Eval $f
        @($c | Where-Object { $_.Status -eq 'FAIL' }).Count | Should Be 0
        @($c | Where-Object { $_.Status -eq 'WARN' }).Count | Should BeGreaterThan 2
        (Get-DiagSummary $c).Conclusion | Should Be 'SERVIDOR PREPARADO CON ADVERTENCIAS'
    }
    It 'nothing in the network area can modify IP, DHCP, DNS or the router: only read seams are used' {
        $text = Get-Content -LiteralPath $scriptPath -Raw
        $text | Should Not Match '(?i)(Set|New|Remove)-Net(IPAddress|IPInterface|Route|Adapter|FirewallRule|Neighbor)|Set-DnsClient|Disable-NetAdapter|Enable-NetAdapter|netsh\s+(interface|advfirewall)\s+set'
        (Get-Content -LiteralPath $scriptPath -Raw) | Should Not Match 'Invoke-WebRequest[^\n]*192\.168'
    }
}

Describe 'Summary, target state and conclusions' {
    It 'WARN only -> SERVIDOR PREPARADO CON ADVERTENCIAS (exit 2); FAIL -> SERVIDOR NO PREPARADO (exit 1)' {
        $w = Get-DiagSummary @([pscustomobject]@{ Status = 'PASS' }, [pscustomobject]@{ Status = 'WARN' })
        $w.Conclusion | Should Be 'SERVIDOR PREPARADO CON ADVERTENCIAS'
        $w.ExitCode | Should Be 2
        $x = Get-DiagSummary @([pscustomobject]@{ Status = 'WARN' }, [pscustomobject]@{ Status = 'FAIL' })
        $x.Conclusion | Should Be 'SERVIDOR NO PREPARADO'
        $x.ExitCode | Should Be 1
    }
    It 'the target state lists the required rows and marks the router reservation as not verifiable' {
        $null = Invoke-Eval (New-HealthyFacts)
        $t = @(Get-TargetState 8082)
        (@($t | Where-Object { $_.Item -eq 'TCP 5432 LAN' })[0]).Requirement | Should Be 'FORBIDDEN'
        (@($t | Where-Object { $_.Item -eq 'TCP 8082 LAN' })[0]).State | Should Be 'CUMPLE'
        (@($t | Where-Object { $_.Item -eq 'DHCP reservation' })[0]).Requirement | Should Be 'PENDING (router)'
        (@($t | Where-Object { $_.Item -eq 'DHCP reservation' })[0]).State | Should Match 'PENDIENTE'
        (@($t | Where-Object { $_.Item -eq 'Wi-Fi (red de V1)' })[0]).Requirement | Should Be 'REQUIRED (V1)'
        (@($t | Where-Object { $_.Item -eq 'Ethernet' })[0]).Requirement | Should Be 'RECOMMENDED (availability)'
        (@($t | Where-Object { $_.Item -eq 'Ethernet' })[0]).State | Should Match 'OPCIONAL'
        (@($t | Where-Object { $_.Item -eq 'Cloudflare' })[0]).Requirement | Should Be 'FUTURE/OPTIONAL'
        (@($t | Where-Object { $_.Item -eq 'DNS interno' })[0]).State | Should Match 'FUERA DE V1'
    }
}

Describe 'Main: output, JSON and exit codes' {
    BeforeEach {
        $script:Printed = @()
        $script:Facts = New-HealthyFacts
        $script:FactsCalls = 0
        Mock Get-DiagFacts { $script:FactsCalls++; return $script:Facts }
        Mock Write-Host { $script:Printed += [string]$Object }
    }
    It '14. -Json emits one parseable document with summary, checks, network facts and no table' {
        $code = Invoke-DiagMain $true '' '' @()
        $code | Should Be 0
        $doc = ($script:Printed -join "`n") | ConvertFrom-Json
        $doc.schemaVersion | Should Be 1
        $doc.readOnly | Should Be $true
        $doc.conclusion | Should Be 'SERVIDOR PREPARADO'
        $doc.network.Mac | Should Be '02-00-5E-00-00-01'
        @($doc.checks).Count | Should BeGreaterThan 20
        @($doc.target).Count | Should BeGreaterThan 5
        ($script:Printed -join "`n") | Should Not Match 'Area\s+Check\s+Status'
    }
    It '15. exit 0 for a ready server, and the table ends with the summary and conclusion' {
        $code = Invoke-DiagMain $false '' '' @()
        $code | Should Be 0
        $text = $script:Printed -join "`n"
        $text | Should Match 'Area\s+Check\s+Status\s+Detail'
        $text | Should Match 'Resumen: \d+ PASS, 0 WARN, 0 FAIL'
        $text | Should Match 'SERVIDOR PREPARADO'
        $text | Should Match 'ESTADO OBJETIVO DAUBERT HUB SERVER'
    }
    It '15. exit 2 when there are only warnings' {
        $script:Facts.Dropbox.AutoStart = $false
        (Invoke-DiagMain $false '' '' @()) | Should Be 2
        ($script:Printed -join "`n") | Should Match 'SERVIDOR PREPARADO CON ADVERTENCIAS'
    }
    It '15. exit 1 when there is a FAIL (and a WARN does not hide it)' {
        $script:Facts.Firewall.Rules = @()
        $script:Facts.Dropbox.AutoStart = $false
        (Invoke-DiagMain $false '' '' @()) | Should Be 1
        ($script:Printed -join "`n") | Should Match 'SERVIDOR NO PREPARADO'
    }
    It '15. exit 3 for usage errors: unsupported arguments (-Configure/-Repair/-Uninstall), bad RepoPath, bad hostname' {
        (Invoke-DiagMain $false '' '' @('-Configure')) | Should Be 3
        (Invoke-DiagMain $false 'C:\definitely\not\here\xyz' '' @()) | Should Be 3
        (Invoke-DiagMain $false '' 'not a host name!' @()) | Should Be 3
        $script:FactsCalls | Should Be 0
    }
    It 'never prints secrets that leak into a detail' {
        Save-Check 'X' 'Y' 'INFO' 'DB_PASSWORD=hunter2 token: abc123 postgres://u:pw@h/db'
        $row = Get-Row @($script:Checks) 'X' 'Y'
        $row.Detail | Should Not Match 'hunter2|abc123|:pw@'
        (Protect-Line 'Authorization: Bearer xyz') | Should Not Match 'xyz'
    }
}

Describe 'Read-only guarantees' {
    It 'allows only read verbs through Invoke-DiagRead' {
        Test-ReadOnlyCommand 'docker' @('ps', '-a') | Should Be $null
        Test-ReadOnlyCommand 'docker' @('inspect', 'x') | Should Be $null
        Test-ReadOnlyCommand 'docker' @('network', 'ls') | Should Be $null
        Test-ReadOnlyCommand 'git' @('-C', 'C:\r', 'status', '--short') | Should Be $null
        Test-ReadOnlyCommand 'git' @('-C', 'C:\r', 'remote', 'get-url', 'origin') | Should Be $null
        Test-ReadOnlyCommand 'powercfg' @('/query', 'SCHEME_CURRENT') | Should Be $null
        Test-ReadOnlyCommand 'schtasks' @('/query') | Should Be $null
        Test-ReadOnlyCommand 'manage-bde' @('-status') | Should Be $null
    }
    It 'refuses every mutating command before executing it' {
        $bad = @(
            @('docker', @('compose', 'up', '-d')), @('docker', @('compose', 'down')), @('docker', @('restart', 'x')), @('docker', @('rm', 'x')),
            @('docker', @('system', 'prune')), @('docker', @('build', '.')), @('docker', @('pull', 'x')), @('docker', @('network', 'rm', 'x')),
            @('git', @('commit', '-m', 'x')), @('git', @('push')), @('git', @('checkout', 'x')), @('git', @('remote', 'add', 'x', 'y')), @('git', @('branch', '-D', 'x')),
            @('powercfg', @('/change', 'standby-timeout-ac', '0')), @('powercfg', @('/hibernate', 'off')), @('powercfg', @('/setacvalueindex', 'a')),
            @('schtasks', @('/create')), @('schtasks', @('/delete')), @('schtasks', @('/run')), @('manage-bde', @('-on', 'C:')),
            @('netsh', @('advfirewall', 'set')), @('sc', @('stop', 'x')), @('powershell', @('-Command', 'x')))
        foreach ($b in $bad) {
            $reason = Test-ReadOnlyCommand $b[0] $b[1]
            ($b[0] + ' ' + ($b[1] -join ' ') + ' -> ' + [string]$reason) | Should Not Match '-> $'
        }
        { Invoke-DiagRead 'docker' @('compose', 'up', '-d') } | Should Throw 'Lectura rechazada'
        { Invoke-DiagRead 'netsh' @('advfirewall', 'reset') } | Should Throw 'Lectura rechazada'
    }
    It 'the script source contains no state-changing cmdlets, no file writes and no write HTTP methods' {
        $text = Get-Content -LiteralPath $scriptPath -Raw
        $code = ($text -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
        $found = @([regex]::Matches($code, '\b(Set|New|Remove|Enable|Disable|Start|Stop|Restart|Register|Unregister|Install|Uninstall|Clear|Move|Rename|Copy|Add|Out|Import|Export|Update|Grant|Revoke|Suspend|Resume|Reset)-[A-Za-z]+') |
                ForEach-Object { $_.Value } | Where-Object { @('Set-StrictMode', 'New-Object', 'Out-Null') -notcontains $_ } | Select-Object -Unique)
        ($found -join ', ') | Should Be ''
        $code | Should Not Match '(?i)-Method\s+(Post|Put|Delete|Patch)'
        $code | Should Not Match '(?i)\[System\.IO\.File\]::(Write|Append|Delete|Move|Copy)'
        $code | Should Not Match '(?i)Invoke-(Expression|Command)'
    }
    It 'does not define -Configure, -Repair or -Uninstall' {
        $text = Get-Content -LiteralPath $scriptPath -Raw
        $param = [regex]::Match($text, '(?s)\[CmdletBinding\(\)\]\s*param\((.*?)\)\s*Set-StrictMode').Groups[1].Value
        $param | Should Not Match 'Configure|Repair|Uninstall'
    }
}
