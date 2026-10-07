# Pester 3.4 tests for scripts\server\Configure-DaubertServer.ps1 (phased configuration: -WhatIf and -Apply)
#
# Run with:  Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\server\tests
#
# The plan is a pure function of a facts table. The phases run against a simulated "world": every read seam and
# the single mutation seam are mocked, so nothing touches the real host. The seam itself is tested with the real
# cmdlets mocked (and, for the ACL operation, with a real temporary file).

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = [System.IO.Path]::GetFullPath((Join-Path $here '..\Configure-DaubertServer.ps1'))
. $scriptPath

$script:Printed = @()
$script:FactsCalls = 0
$script:PhaseCalls = @()
$script:World = $null
$script:UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$script:HubRuleObj = @{ Name = 'x'; DisplayName = 'Daubert Hub - TCP 8082 (LAN)'; Group = 'Daubert Hub'; Enabled = 'True'; Profile = 'Any'; Direction = 'Inbound'; Action = 'Allow'; Protocol = 'TCP'; LocalPort = @('8082'); RemoteAddress = @('LocalSubnet'); RemotePort = @('Any'); Program = 'Any'; Service = 'Any'; InterfaceType = 'Any'; EdgeTraversal = 'Block' }
$script:BlockRuleObj = @{ Name = 'y'; DisplayName = 'Daubert Hub - Block LAN TCP 5678'; Group = 'Daubert Hub'; Enabled = 'True'; Profile = 'Any'; Direction = 'Inbound'; Action = 'Block'; Protocol = 'TCP'; LocalPort = @('5678'); RemoteAddress = @('LocalSubnet'); RemotePort = @('Any'); Program = 'Any'; Service = 'Any'; InterfaceType = 'Any'; EdgeTraversal = 'Block' }
$script:NodeRuleObj = @{ Name = 'TCP Query User{A}C:\program files\nodejs\node.exe'; DisplayName = 'Node.js JavaScript Runtime'; Group = ''; Enabled = 'True'; Profile = 'Private'; Direction = 'Inbound'; Action = 'Allow'; EdgeTraversal = 'DeferToUser'
    Protocol = 'TCP'; LocalPort = @('Any'); RemotePort = @('Any'); RemoteAddress = @('Any'); Program = 'C:\program files\nodejs\node.exe'; Service = 'Any'; InterfaceType = 'Any' }

function New-ConfigFacts {
    return @{
        Elevated = $true; User = 'PC\svc'; UserSid = 'S-1-5-21-1000'
        Network = @{ DefaultAdapter = 'Wi-Fi'; ActiveProfiles = @('Public'); GatewayCheck = @{ Gateway = '192.0.2.1'; Tcp = 'open'; TcpPort = 80; NeighborState = 'Reachable'; NeighborMac = 'AA-BB-CC-00-00-01' }
            Adapters = @(@{ Name = 'Wi-Fi'; Kind = 'Wi-Fi'; Status = 'Up'; Mac = '02-00-5E-00-00-01'; IPv4 = @('192.0.2.11'); IPv6 = @(); Gateway = '192.0.2.1'; Dns = @('192.0.2.1'); Dhcp = $true; Profile = 'Public'; IsDefault = $true; PowerSaving = 'Disabled' }) }
        Energy = @{ Plan = 'Alto rendimiento'; WifiPowerSavingAc = 0 }
        Firewall = @{ Available = $true; Profiles = @{}; Rules = @(); Listeners = @() }
        HubRules = @(); BlockRules = @()
        NodeRules = @($script:NodeRuleObj)
        N8nListener = @{ Port = 5678; Addresses = @('::'); Pid = 17244; Process = 'node' }
        N8nConnections = @(@{ ClientAddress = '127.0.0.1'; ServerAddress = '127.0.0.1'; Process = 'com.docker.backend' })
        N8n = @{ Running = $true; Pid = 17244; SessionId = 2 }
        SupervisorTask = @(); SupervisorSourceExists = $true
        WebhookTargets = @(@{ Name = 'CATERPILLAR_REPROCESS_WEBHOOK_URL'; Target = 'http://host.docker.internal:5678' })
        Secrets = @(
            @{ Label = 'pilot.prod.env'; Path = 'C:\repo\deploy\pilot.prod.env'; Exists = $true; Owner = 'PC\svc'; Protected = $false; Needs = 'el usuario que ejecuta docker compose'
                Entries = @(@{ Identity = 'PC\CodexSandboxUsers'; Sid = 'S-1-5-21-2000'; Rights = 'ReadAndExecute'; Type = 'Allow'; Inherited = $true }, @{ Identity = 'PC\svc'; Sid = 'S-1-5-21-1000'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $true },
                    @{ Identity = 'NT AUTHORITY\SYSTEM'; Sid = 'S-1-5-18'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $true }, @{ Identity = 'BUILTIN\Administrators'; Sid = 'S-1-5-32-544'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $true }) }
            @{ Label = '.env.prod-temp'; Path = 'C:\repo\.env.prod-temp'; Exists = $true; Owner = 'PC\svc'; Protected = $false; Needs = 'a determinar'
                Entries = @(@{ Identity = 'PC\svc'; Sid = 'S-1-5-21-1000'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $true }, @{ Identity = 'NT AUTHORITY\SYSTEM'; Sid = 'S-1-5-18'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $true }, @{ Identity = 'BUILTIN\Administrators'; Sid = 'S-1-5-32-544'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $true }) }
            @{ Label = 'pilot.test.env'; Path = 'C:\repo\deploy\pilot.test.env'; Exists = $false; Entries = @(); Needs = '' })
        EnvProdTempRefs = 0
        PathRefs = @(@{ Path = 'C:\repo\n8n\x.json'; Count = 3 })
        TaskPathRefs = @('Daubert - n8n Weekly')
        Session = @{ AutoLogon = $false }
        Docker = @{ AutoStart = $true }
    }
}

function Get-Step {
    param($Steps, [string]$Area, [string]$Target)
    return (@($Steps | Where-Object { $_.Area -eq $Area -and $_.Target -like $Target }) | Select-Object -First 1)
}

# ---- simulated world for the phase tests (dot-sourced inside BeforeEach so the mocks live in the test scope)
$script:WorldInit = {
    $script:World = @{ Hub = @(); Block = @(); Node = @($script:NodeRuleObj); N8nOpen = 'open'; ApiAfterBlock = 'open'; BlockApplied = $false; HubBad = $false; BlockBad = $false; NodeMutates = $false
        Listener = $true; Procs = @(@{ Pid = 100; SessionId = 2; Owner = $env:USERNAME }); ProcsAfterStart = $null; Started = $false; Task = @(); TaskLogon = 'Interactive'; Log = @(); LogAfterStart = $true
        AutoLogon = $false; AutoLogonFlips = $false; Mut = @(); Acl = @{}; AclNoChange = $false; Readable = $true; TaskUser = ('PC\' + $env:USERNAME) }
    foreach ($leaf in 'pilot.prod.env', 'pilot.test.env', '.env.prod-temp', 'config') {
        $script:World.Acl[$leaf] = @{ Exists = $true; Protected = $false; Entries = @(
                @{ Identity = 'PC\CodexSandboxUsers'; Sid = 'S-1-5-21-2000'; Rights = 'Modify'; Type = 'Allow'; Inherited = $true },
                @{ Identity = 'PC\me'; Sid = $script:UserSid; Rights = 'FullControl'; Type = 'Allow'; Inherited = $true },
                @{ Identity = 'NT AUTHORITY\SYSTEM'; Sid = 'S-1-5-18'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $true },
                @{ Identity = 'BUILTIN\Administrators'; Sid = 'S-1-5-32-544'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $true }) }
    }
    Mock Start-ConfigSleep { }
    Mock Get-FirewallRuleDetailByName {
        switch ($DisplayName) {
            'Daubert Hub - TCP 8082 (LAN)' { return @($script:World.Hub) }
            'Daubert Hub - Block LAN TCP 5678' { return @($script:World.Block) }
            'Node.js JavaScript Runtime' { return @($script:World.Node) }
            default { return @() }
        }
    }
    Mock Invoke-ConfigMutation {
        $script:World.Mut += $Name
        switch ($Name) {
            'Firewall.Hub8082.Upsert' { $r = @{} + $script:HubRuleObj; if ($script:World.HubBad) { $r.RemoteAddress = @('Any') }; $script:World.Hub = @($r) }
            'Firewall.N8nBlock.Upsert' {
                $r = @{} + $script:BlockRuleObj; if ($script:World.BlockBad) { $r.RemoteAddress = @('Any') }
                $script:World.Block = @($r); $script:World.BlockApplied = $true
                if ($script:World.NodeMutates) { $n = @{} + $script:NodeRuleObj; $n.Profile = 'Any'; $script:World.Node = @($n) }
            }
            'Task.N8nSupervisor.Register' { $script:World.Task = @(@{ Name = 'Daubert - n8n Supervisor'; State = 'Ready'; LogonType = $script:World.TaskLogon; UserId = $script:World.TaskUser }) }
            'Task.N8nSupervisor.Start' {
                $script:World.Started = $true
                if ($script:World.LogAfterStart) { $script:World.Log = @('2026-10-05 20:00:00 [SUPERVISOR] Instancia de n8n existente adoptada (PID 100); no se inicia otra.') }
                if ($null -ne $script:World.ProcsAfterStart) { $script:World.Procs = $script:World.ProcsAfterStart }
                if ($script:World.AutoLogonFlips) { $script:World.AutoLogon = $true }
            }
            'Acl.Secret.Apply' {
                if (-not $script:World.AclNoChange) {
                    $leaf = Split-Path -Leaf $Params.Path
                    $ents = @(); foreach ($s in @($Params.Sids)) { $ents += @{ Identity = $s; Sid = $s; Rights = 'FullControl'; Type = 'Allow'; Inherited = $false } }
                    $script:World.Acl[$leaf] = @{ Exists = $true; Protected = $true; Entries = $ents }
                }
            }
        }
    }
    Mock Test-ApiToHostPort { if ($script:World.BlockApplied) { return $script:World.ApiAfterBlock } return $script:World.N8nOpen }
    Mock Get-ListenerFacts { if ($script:World.Listener) { return @(@{ Port = 5678; Addresses = @('::'); Pid = 1; Process = 'node' }) } return @(@{ Port = 5678; Addresses = @(); Pid = 0; Process = '' }) }
    Mock Get-N8nMainProcesses { return @($script:World.Procs) }
    Mock Get-SupervisorLogLines { return @($script:World.Log) }
    Mock Get-SessionFacts { return @{ AutoLogon = $script:World.AutoLogon } }
    Mock Get-ScheduledTaskFacts {
        if ($NamePattern -match 'Supervisor') { return @($script:World.Task) }
        return @(@{ Name = 'Daubert - PostgreSQL Daily'; State = 'Ready'; LogonType = 'S4U'; UserId = $script:World.TaskUser; Actions = '' })
    }
    Mock Get-AclDetail { $leaf = Split-Path -Leaf $Path; $a = $script:World.Acl[$leaf]; return @{ Path = $Path; Exists = $a.Exists; Owner = ''; Protected = $a.Protected; Entries = $a.Entries } }
    Mock Test-FileReadable { return $script:World.Readable }
}

function Invoke-PhaseQuiet {
    param([string]$Name)
    $script:Mode = 'Apply'
    try { return (Invoke-ConfigPhase $Name 'C:\repo') } finally { $script:Mode = 'WhatIf' }
}

# =============================================================================================== phase selection
Describe 'Phase selection' {
    It 'maps numbers and names to canonical phases, keeps the canonical order and accepts All' {
        (ConvertTo-PhaseList @('1')) | Should Be 'Network'
        (ConvertTo-PhaseList @('network')) | Should Be 'Network'
        (ConvertTo-PhaseList @('N8nNetwork')) | Should Be 'N8nNetwork'
        (ConvertTo-PhaseList @('2')) | Should Be 'N8nNetwork'
        (ConvertTo-PhaseList @('3')) | Should Be 'N8nSupervisor'
        (ConvertTo-PhaseList @('Secrets')) | Should Be 'Secrets'
        (ConvertTo-PhaseList @('5')) | Should Be 'Verify'
        ((ConvertTo-PhaseList @('3', '1')) -join ',') | Should Be 'Network,N8nSupervisor'
        ((ConvertTo-PhaseList @('Secrets,Network')) -join ',') | Should Be 'Network,Secrets'
        ((ConvertTo-PhaseList @('all')) -join ',') | Should Be 'Network,N8nNetwork,N8nSupervisor,Secrets,Verify'
    }
    It 'invalid or empty selections return $null' {
        (ConvertTo-PhaseList @('6')) | Should Be $null
        (ConvertTo-PhaseList @('1', 'banana')) | Should Be $null
        (ConvertTo-PhaseList @()) | Should Be $null
    }
    It 'each phase plan contains only its own steps (phases are independent)' {
        $f = New-ConfigFacts
        @(Get-PhaseSteps 'Network' $f | Where-Object { $_.Phase -ne 1 }).Count | Should Be 0
        @(Get-PhaseSteps 'N8nNetwork' $f | Where-Object { $_.Phase -ne 2 }).Count | Should Be 0
        @(Get-PhaseSteps 'N8nSupervisor' $f | Where-Object { $_.Phase -ne 3 }).Count | Should Be 0
        @(Get-PhaseSteps 'Secrets' $f | Where-Object { $_.Phase -ne 4 }).Count | Should Be 0
        @(Get-PhaseSteps 'Verify' $f | Where-Object { $_.Phase -ne 5 }).Count | Should Be 0
        $only = @(New-ConfigPlan $f @('N8nNetwork'))
        @($only | Where-Object { $_.Area -eq 'Firewall' }).Count | Should Be 0
        @($only | Where-Object { $_.Area -eq 'n8n/Firewall' }).Count | Should BeGreaterThan 0
    }
    It 'the full plan (no phase) includes the general context and all five phases' {
        $p = New-ConfigPlan (New-ConfigFacts) @()
        (Get-Step $p 'Contexto' 'Sesion') | Should Not Be $null
        foreach ($n in 1..5) { @($p | Where-Object { $_.Phase -eq $n }).Count | Should BeGreaterThan 0 }
    }
}

# =============================================================================================== WhatIf plan
Describe 'Plan: Firewall 8082 (phase 1)' {
    It 'plans exactly the Hub rule: Inbound/Allow/TCP/8082/LocalSubnet/Profile Any/Group Daubert Hub' {
        $s = Get-Step (New-ConfigPlan (New-ConfigFacts) @('Network')) 'Firewall' 'Daubert Hub - TCP 8082*'
        $s.Action | Should Be 'CREATE'
        foreach ($p in '-Direction Inbound', '-Action Allow', '-Protocol TCP', '-LocalPort 8082', '-RemoteAddress LocalSubnet', '-Profile Any', "-Group 'Daubert Hub'") { $s.Command | Should Match ([regex]::Escape($p)) }
        $s.Detail | Should Match 'Internet'
        $s.Command | Should Not Match '-RemoteAddress Any'
    }
    It 'an existing correct rule -> NOOP; a different one -> UPDATE listing the differences' {
        $f = New-ConfigFacts
        $f.HubRules = @($script:HubRuleObj)
        (Get-Step (New-ConfigPlan $f @('Network')) 'Firewall' 'Daubert Hub - TCP 8082*').Action | Should Be 'NOOP'
        $bad = @{} + $script:HubRuleObj; $bad.RemoteAddress = @('Any'); $bad.Profile = 'Private'
        $f.HubRules = @($bad)
        $s = Get-Step (New-ConfigPlan $f @('Network')) 'Firewall' 'Daubert Hub - TCP 8082*'
        $s.Action | Should Be 'UPDATE'
        $s.Detail | Should Match 'RemoteAddress=Any'
        $s.Detail | Should Match 'Profile=Private'
    }
    It 'ports 3000 and 5432 without rules -> NOOP; with a rule -> DECISION' {
        $p = New-ConfigPlan (New-ConfigFacts) @('Network')
        (Get-Step $p 'Firewall' 'TCP 3000 LAN').Action | Should Be 'NOOP'
        (Get-Step $p 'Firewall' 'TCP 5432 LAN').Action | Should Be 'NOOP'
        $f = New-ConfigFacts
        $f.Firewall.Rules = @(@{ Name = 'pg'; Profile = 'Any'; Protocol = 'TCP'; LocalPort = @('5432'); Remote = @('Any'); Program = 'Any' })
        (Get-Step (New-ConfigPlan $f @('Network')) 'Firewall' 'TCP 5432 LAN').Action | Should Be 'DECISION'
    }
}

Describe 'Plan: n8n network (phase 2) and the Node.js rules' {
    It 'plans a Block rule for 5678 limited to LocalSubnet, never Any, never loopback' {
        $s = Get-Step (New-ConfigPlan (New-ConfigFacts) @('N8nNetwork')) 'n8n/Firewall' 'Daubert Hub - Block LAN TCP 5678'
        $s.Action | Should Be 'CREATE'
        foreach ($p in '-Direction Inbound', '-Action Block', '-Protocol TCP', '-LocalPort 5678', '-RemoteAddress LocalSubnet', '-Profile Any') { $s.Command | Should Match ([regex]::Escape($p)) }
        $s.Command | Should Not Match '-RemoteAddress (Any|127|::1|\*)'
        $s.Detail | Should Match 'Loopback no se bloquea'
    }
    It 'an existing correct block rule -> NOOP; one with remote Any -> UPDATE' {
        $f = New-ConfigFacts
        $f.BlockRules = @($script:BlockRuleObj)
        (Get-Step (New-ConfigPlan $f @('N8nNetwork')) 'n8n/Firewall' 'Daubert Hub - Block LAN TCP 5678').Action | Should Be 'NOOP'
        $bad = @{} + $script:BlockRuleObj; $bad.RemoteAddress = @('Any')
        $f.BlockRules = @($bad)
        (Get-Step (New-ConfigPlan $f @('N8nNetwork')) 'n8n/Firewall' 'Daubert Hub - Block LAN TCP 5678').Action | Should Be 'UPDATE'
    }
    It 'lists the Node.js rule properties and states they are NOT modified; no command touches them' {
        $p = New-ConfigPlan (New-ConfigFacts) @('N8nNetwork')
        $info = Get-Step $p 'n8n/Firewall' 'Regla Node.js: TCP*'
        foreach ($m in 'enabled=True', 'action=Allow', 'profile=Private', 'remoteAddress=Any', 'edge=DeferToUser') { $info.Detail | Should Match $m }
        (Get-Step $p 'n8n/Firewall' 'Regla Node.js (NO se modifica)').Detail | Should Match 'no se modifican ni se eliminan'
        @($p | Where-Object { $_.Command -match '(?i)Remove-NetFirewallRule|Disable-NetFirewallRule|node' }).Count | Should Be 0
    }
    It 'does not change the production binding of n8n (no 127.0.0.1 / N8N_LISTEN_ADDRESS in any command)' {
        $p = New-ConfigPlan (New-ConfigFacts) @('N8nNetwork')
        @($p | Where-Object { $_.Command -match '127\.0\.0\.1|N8N_LISTEN_ADDRESS|N8N_HOST' }).Count | Should Be 0
        (Get-Step $p 'n8n/Firewall' 'Listener 5678').Detail | Should Match 'no se cambia a 127\.0\.0\.1'
    }
    It 'reports the origin Windows sees (loopback from com.docker.backend) and does not guess when there is no live Docker connection' {
        (Get-Step (New-ConfigPlan (New-ConfigFacts) @('N8nNetwork')) 'n8n/Firewall' 'Origen que ve Windows').Detail | Should Match 'loopback'
        $f = New-ConfigFacts
        $f.N8nConnections = @(@{ ClientAddress = '::1'; ServerAddress = '::1'; Process = 'msedge' })
        (Get-Step (New-ConfigPlan $f @('N8nNetwork')) 'n8n/Firewall' 'Origen que ve Windows').Detail | Should Match 'Sin conexion de Docker'
    }
    It 'webhook targets keep only scheme://host:port and never the path or token' {
        (ConvertTo-HostPort 'http://host.docker.internal:5678/webhook/abc-secret-token') | Should Be 'http://host.docker.internal:5678'
        Mock Invoke-DiagRead { @{ Code = 0; Out = @('CATERPILLAR_REPROCESS_WEBHOOK_URL=http://host.docker.internal:5678/webhook/abc-secret-token') } }
        $t = @(Get-ApiWebhookTargets)
        $t[0].Target | Should Be 'http://host.docker.internal:5678'
        ($t | ConvertTo-Json) | Should Not Match 'secret-token'
    }
}

Describe 'Plan: n8n supervisor (phase 3)' {
    It 'designs logs, script and task without NSSM/WinSW, with the required behaviours and no AutoAdminLogon' {
        $p = New-ConfigPlan (New-ConfigFacts) @('N8nSupervisor')
        $script = Get-Step $p 'n8n' 'Script *'
        $task = Get-Step $p 'n8n' 'Tarea "Daubert - n8n Supervisor"'
        (Get-Step $p 'n8n' 'Directorio de logs*').Detail | Should Match 'n8n-supervisor\.log'
        foreach ($m in 'mutex', 'duplicad', 'Docker', 'Dropbox', '5678', 'reinicia', 'adopta') { $script.Detail | Should Match $m }
        foreach ($m in 'al iniciar sesion', 'retraso de 1 min', 'MultipleInstances=IgnoreNew', 'reintentos', 'Interactive', 'no guarda ninguna contrasena', 'NO se habilita AutoAdminLogon') { $task.Detail | Should Match $m }
        (($p | ForEach-Object { $_.Detail + ' ' + $_.Command }) -join ' ') | Should Not Match '(?i)nssm|winsw'
    }
    It 'never touches workflows/credentials and does not stop the running n8n; an existing task -> NOOP' {
        $p = New-ConfigPlan (New-ConfigFacts) @('N8nSupervisor')
        (Get-Step $p 'n8n' 'Workflows y credenciales').Action | Should Be 'SKIP'
        (Get-Step $p 'n8n' 'Estado actual').Detail | Should Match 'ADOPTA'
        $f = New-ConfigFacts
        $f.SupervisorTask = @(@{ Name = 'Daubert - n8n Supervisor'; State = 'Ready' })
        (Get-Step (New-ConfigPlan $f @('N8nSupervisor')) 'n8n' 'Tarea "Daubert - n8n Supervisor"').Action | Should Be 'NOOP'
    }
}

Describe 'Plan: secrets (phase 4): proposed ACL' {
    It 'shows current ACL, who needs access and the proposed ACL (user, SYSTEM, Administrators), removing CodexSandboxUsers and inheritance' {
        $s = Get-Step (New-ConfigPlan (New-ConfigFacts) @('Secrets')) 'Secretos' 'pilot.prod.env'
        $s.Action | Should Be 'UPDATE'
        $s.Detail | Should Match 'ACL actual: PC\\CodexSandboxUsers: ReadAndExecute'
        $s.Detail | Should Match 'necesita acceso: el usuario que ejecuta docker compose'
        $s.Detail | Should Match 'ACL propuesta: PC\\svc: FullControl \| NT AUTHORITY\\SYSTEM: FullControl \| BUILTIN\\Administrators: FullControl'
        $s.Detail | Should Match 'se quitaria: PC\\CodexSandboxUsers'
        $s.Detail | Should Match 'se desactiva la herencia'
    }
    It 'an ACL already restricted -> NOOP; a missing file -> INFO; .env.prod-temp is never deleted' {
        $p = New-ConfigPlan (New-ConfigFacts) @('Secrets')
        (Get-Step $p 'Secretos' '.env.prod-temp').Action | Should Be 'NOOP'
        (Get-Step $p 'Secretos' 'pilot.test.env').Action | Should Be 'INFO'
        (Get-Step $p 'Secretos' 'Contenido').Detail | Should Match 'no se borra ningun archivo'
        $f = New-ConfigFacts
        $f.Secrets[1].Entries += @{ Identity = 'PC\CodexSandboxUsers'; Sid = 'S-1-5-21-2000'; Rights = 'Modify'; Type = 'Allow'; Inherited = $true }
        $d = @((New-ConfigPlan $f @('Secrets')) | Where-Object { $_.Action -eq 'DECISION' -and $_.Target -eq '.env.prod-temp' })[0]
        $d.Detail | Should Match 'NO se borra ni se mueve'
    }
}

Describe 'Plan: general (Wi-Fi, router, compose, boot)' {
    It 'passes the Wi-Fi checks; adapter power saving is only reported (energy is not touched)' {
        $p = New-ConfigPlan (New-ConfigFacts) @()
        foreach ($t in 'Wi-Fi', 'Conexion principal', 'IP actual', 'Gateway', 'DHCP', 'Conectividad local') { (Get-Step $p 'Wi-Fi' $t).Action | Should Be 'CHECK' }
        $f = New-ConfigFacts
        $f.Network.Adapters[0].PowerSaving = 'Enabled'
        $s = Get-Step (New-ConfigPlan $f @()) 'Wi-Fi' 'Adaptador Wi-Fi'
        $s.Action | Should Be 'DECISION'
        $s.Command | Should Be ''
        (Get-Step $p 'Energia' 'Plan de energia').Action | Should Be 'NOOP'
    }
    It 'keeps Public, reports the DHCP reservation as PENDING, never touches router/IP/DHCP/DNS' {
        $p = New-ConfigPlan (New-ConfigFacts) @()
        (Get-Step $p 'Red' 'Perfil de red').Detail | Should Match 'se mantiene Public'
        $d = Get-Step $p 'Red' 'DHCP reservation*'
        $d.Action | Should Be 'INFO'
        $d.Detail | Should Match 'PENDIENTE'
        $d.Detail | Should Match '02-00-5E-00-00-01 -> 192\.0\.2\.11'
        $d.Detail | Should Match 'NO toca el router'
        @($p | Where-Object { $_.Command -match '(?i)NetIPAddress|NetIPInterface|DnsClient|NetRoute|NetConnectionProfile|netsh|dhcp|router' }).Count | Should Be 0
    }
    It 'compose project stays daubert-hub; Docker is untouched; unattended boot stays a DECISION without AutoAdminLogon' {
        $p = New-ConfigPlan (New-ConfigFacts) @()
        (Get-Step $p 'Compose' 'Proyecto PROD').Detail | Should Match 'se mantiene "daubert-hub"'
        (Get-Step $p 'Docker' 'Docker Desktop AutoStart').Detail | Should Match 'No se usa docker compose down ni se reinicia PostgreSQL'
        $d = Get-Step $p 'Arranque' 'Inicio de sesion de Windows'
        $d.Action | Should Be 'DECISION'
        $d.Detail | Should Match 'decision de inicio de sesion de Windows'
        @($p | Where-Object { $_.Command -match '(?i)AutoAdminLogon|Winlogon|DefaultPassword' }).Count | Should Be 0
    }
    It 'portability is documented only' {
        $p = New-ConfigPlan (New-ConfigFacts) @()
        (Get-Step $p 'Portabilidad' 'Rutas del perfil de usuario').Detail | Should Match '3 referencias en 1 archivos \+ 1 tareas programadas; NO se modifican'
        @($p | Where-Object { $_.Area -eq 'Portabilidad' -and $_.WouldChange }).Count | Should Be 0
    }
}

# =============================================================================================== rule logic
Describe 'Firewall rule logic and loopback protection' {
    It 'Get-RuleDiff: exact rule has no differences; each property mismatch is reported; Group is separate' {
        (Get-RuleDiff $script:HubRuleObj $script:HubRuleSpec).Diff.Count | Should Be 0
        $r = @{} + $script:HubRuleObj; $r.Action = 'Block'; $r.LocalPort = @('8080'); $r.Enabled = 'False'; $r.Group = 'Other'
        $d = Get-RuleDiff $r $script:HubRuleSpec
        ($d.Diff -join ' ') | Should Match 'Action=Block'
        ($d.Diff -join ' ') | Should Match 'LocalPort=8080'
        ($d.Diff -join ' ') | Should Match 'Enabled=False'
        $d.GroupMismatch | Should Be $true
    }
    It 'the block rule protects loopback only when RemoteAddress is exactly LocalSubnet' {
        (Test-RuleProtectsLoopback $script:BlockRuleObj) | Should Be $true
        foreach ($bad in @('Any'), @('*'), @('127.0.0.1'), @('::1'), @('LocalSubnet', '127.0.0.1'), @('192.0.2.0/24')) {
            $r = @{} + $script:BlockRuleObj; $r.RemoteAddress = $bad
            (Test-RuleProtectsLoopback $r) | Should Be $false
        }
    }
    It 'the specs are exactly the agreed rules' {
        $h = $script:HubRuleSpec
        ($h.Direction + $h.Action + $h.Protocol + $h.LocalPort + $h.RemoteAddress + $h.Profile + $h.Group) | Should Be 'InboundAllowTCP8082LocalSubnetAnyDaubert Hub'
        $b = $script:BlockRuleSpec
        ($b.Direction + $b.Action + $b.Protocol + $b.LocalPort + $b.RemoteAddress + $b.Profile + $b.Group) | Should Be 'InboundBlockTCP5678LocalSubnetAnyDaubert Hub'
        $h.DisplayName | Should Be 'Daubert Hub - TCP 8082 (LAN)'
    }
}

# =============================================================================================== phase 1
Describe 'Phase 1 Network (-Apply, simulated world)' {
    BeforeEach { . $script:WorldInit }
    It 'creates the rule, verifies it, and performs exactly one mutation (nothing for n8n, ACL, tasks, energy, router, Docker)' {
        $r = Invoke-PhaseQuiet 'Network'
        $r.Ok | Should Be $true
        ($script:World.Mut -join ',') | Should Be 'Firewall.Hub8082.Upsert'
        $r.Changed[0] | Should Be 'Daubert Hub - TCP 8082 (LAN)'
        ($r.Lines -join ' ') | Should Match 'exactamente los parametros esperados'
        @($r.External).Count | Should Be 1
    }
    It 'an already correct rule -> no mutation' {
        $script:World.Hub = @($script:HubRuleObj)
        $r = Invoke-PhaseQuiet 'Network'
        $r.Ok | Should Be $true
        @($script:World.Mut).Count | Should Be 0
    }
    It 'fails when the verification finds different parameters after applying' {
        $script:World.HubBad = $true
        $r = Invoke-PhaseQuiet 'Network'
        $r.Ok | Should Be $false
        $r.Failure | Should Match 'no tiene los parametros esperados'
    }
    It 'a rule with a different group (cannot be changed) or duplicates blocks the phase without mutating' {
        $g = @{} + $script:HubRuleObj; $g.Group = 'Otro'; $g.RemoteAddress = @('Any')
        $script:World.Hub = @($g)
        $r = Invoke-PhaseQuiet 'Network'
        $r.Ok | Should Be $false; $r.Blocked | Should Be $true
        @($script:World.Mut).Count | Should Be 0
        $script:World.Hub = @($script:HubRuleObj, $script:HubRuleObj)
        (Invoke-PhaseQuiet 'Network').Blocked | Should Be $true
        @($script:World.Mut).Count | Should Be 0
    }
}

# =============================================================================================== phase 2
Describe 'Phase 2 N8nNetwork (-Apply, simulated world)' {
    BeforeEach { . $script:WorldInit }
    It 'applies the block rule, verifies it, proves Node.js rules are unchanged and API -> n8n still works' {
        $r = Invoke-PhaseQuiet 'N8nNetwork'
        $r.Ok | Should Be $true
        ($script:World.Mut -join ',') | Should Be 'Firewall.N8nBlock.Upsert'
        $text = $r.Lines -join ' '
        $text | Should Match 'Linea base API Docker -> n8n:5678 = open'
        $text | Should Match 'loopback no afectado'
        $text | Should Match 'regla\(s\) de Node.js siguen identicas'
        $text | Should Match 'API Docker -> n8n:5678 sigue funcionando'
        ($r.External -join ' ') | Should Match 'LAN -> 5678 bloqueado'
    }
    It 'no baseline (API -> n8n already failing) or nothing listening -> blocked, no mutation' {
        $script:World.N8nOpen = 'timeout'
        $r = Invoke-PhaseQuiet 'N8nNetwork'
        $r.Blocked | Should Be $true
        @($script:World.Mut).Count | Should Be 0
        . $script:WorldInit
        $script:World.Listener = $false
        (Invoke-PhaseQuiet 'N8nNetwork').Blocked | Should Be $true
        @($script:World.Mut).Count | Should Be 0
    }
    It 'API -> n8n failing after the block -> CONFIGURATION FAILED, no automatic rollback (only the one mutation)' {
        $script:World.ApiAfterBlock = 'timeout'
        $r = Invoke-PhaseQuiet 'N8nNetwork'
        $r.Ok | Should Be $false
        $r.Failure | Should Match 'CONFIGURATION FAILED'
        $r.Failure | Should Match 'NO se hace rollback automatico'
        ($script:World.Mut -join ',') | Should Be 'Firewall.N8nBlock.Upsert'
    }
    It 'fails if the existing Node.js rules change during the phase' {
        $script:World.NodeMutates = $true
        $r = Invoke-PhaseQuiet 'N8nNetwork'
        $r.Ok | Should Be $false
        $r.Failure | Should Match 'reglas de Node.js cambiaron'
    }
    It 'fails if the resulting block rule could affect loopback (RemoteAddress not LocalSubnet)' {
        $script:World.BlockBad = $true
        (Invoke-PhaseQuiet 'N8nNetwork').Ok | Should Be $false
    }
}

# =============================================================================================== phase 3
Describe 'Phase 3 N8nSupervisor (-Apply, simulated world)' {
    BeforeEach { . $script:WorldInit }
    It 'creates logs dir, script and task, starts the task once and verifies everything; no AutoAdminLogon operation' {
        $r = Invoke-PhaseQuiet 'N8nSupervisor'
        $r.Ok | Should Be $true
        ($script:World.Mut -join ',') | Should Be 'Dir.Create,File.CopySupervisor,Task.N8nSupervisor.Register,Task.N8nSupervisor.Start'
        $text = $r.Lines -join ' '
        foreach ($m in 'LogonType Interactive', 'registro su arranque', 'n8n escucha en 5678', 'una sola instancia', 'API Docker -> n8n:5678 funciona', 'AutoAdminLogon sin cambios') { $text | Should Match $m }
    }
    It 'a task that is not Interactive (would need a stored password) fails the phase' {
        $script:World.TaskLogon = 'Password'
        $r = Invoke-PhaseQuiet 'N8nSupervisor'
        $r.Ok | Should Be $false
        $r.Failure | Should Match 'no es Interactive'
        ($script:World.Mut -contains 'Task.N8nSupervisor.Start') | Should Be $false
    }
    It 'a second n8n instance after starting, a missing log line, or no listener fail the phase' {
        $script:World.ProcsAfterStart = @(@{ Pid = 1; SessionId = 2; Owner = 'x' }, @{ Pid = 2; SessionId = 2; Owner = 'x' })
        (Invoke-PhaseQuiet 'N8nSupervisor').Failure | Should Match 'exactamente 1 instancia'
        . $script:WorldInit
        $script:World.LogAfterStart = $false
        (Invoke-PhaseQuiet 'N8nSupervisor').Failure | Should Match 'log del supervisor'
        . $script:WorldInit
        $script:World.Listener = $false
        (Invoke-PhaseQuiet 'N8nSupervisor').Failure | Should Match 'no escucha en 5678'
    }
    It 'two n8n instances before starting block the phase without mutating' {
        $script:World.Procs = @(@{ Pid = 1; SessionId = 2; Owner = 'x' }, @{ Pid = 2; SessionId = 2; Owner = 'x' })
        $r = Invoke-PhaseQuiet 'N8nSupervisor'
        $r.Blocked | Should Be $true
        @($script:World.Mut).Count | Should Be 0
    }
    It 'fails if AutoAdminLogon changes during the phase; an existing task is not registered twice' {
        $script:World.AutoLogonFlips = $true
        (Invoke-PhaseQuiet 'N8nSupervisor').Failure | Should Match 'AutoAdminLogon cambio'
        . $script:WorldInit
        $script:World.Task = @(@{ Name = 'Daubert - n8n Supervisor'; State = 'Ready'; LogonType = 'Interactive'; UserId = 'PC\x' })
        $null = Invoke-PhaseQuiet 'N8nSupervisor'
        ($script:World.Mut -contains 'Task.N8nSupervisor.Register') | Should Be $false
    }
}

# =============================================================================================== phase 4
Describe 'Phase 4 Secrets (-Apply, simulated world)' {
    BeforeEach { . $script:WorldInit }
    It 'shows state and target of every file, applies the ACL to the four files with exactly user/SYSTEM/Administrators and deletes nothing' {
        $r = Invoke-PhaseQuiet 'Secrets'
        $r.Ok | Should Be $true
        @($script:World.Mut | Where-Object { $_ -eq 'Acl.Secret.Apply' }).Count | Should Be 4
        @($script:World.Mut | Where-Object { $_ -ne 'Acl.Secret.Apply' }).Count | Should Be 0
        $text = $r.Lines -join "`n"
        $text | Should Match 'pilot\.prod\.env ESTADO:'
        $text | Should Match 'pilot\.prod\.env DESTINO:.*se quita: PC\\CodexSandboxUsers'
        $text | Should Match '\.env\.prod-temp DESTINO:'
        $text | Should Match 'ninguno fue borrado'
        $text | Should Match 'tareas Daubert corren como el usuario actual'
        $text | Should Match 'n8n corre como el usuario actual'
        $a = $script:World.Acl['pilot.prod.env']
        (@($a.Entries | ForEach-Object { $_.Sid }) -join ',') | Should Be ($script:UserSid + ',S-1-5-18,S-1-5-32-544')
        @($a.Entries | Where-Object { $_.Sid -eq 'S-1-5-21-2000' }).Count | Should Be 0
        $a.Protected | Should Be $true
    }
    It 'fails when the ACL still grants access to another identity after applying' {
        $script:World.AclNoChange = $true
        $r = Invoke-PhaseQuiet 'Secrets'
        $r.Ok | Should Be $false
        $r.Failure | Should Match 'aun concede acceso'
    }
    It 'fails when the current user can no longer read a file, or a Daubert task / n8n run as someone else' {
        $script:World.Readable = $false
        (Invoke-PhaseQuiet 'Secrets').Failure | Should Match 'ya no puede leer'
        . $script:WorldInit
        $script:World.TaskUser = 'PC\otro'
        (Invoke-PhaseQuiet 'Secrets').Failure | Should Match 'ya no tendria acceso'
        . $script:WorldInit
        $script:World.Procs = @(@{ Pid = 1; SessionId = 2; Owner = 'otro' })
        (Invoke-PhaseQuiet 'Secrets').Failure | Should Match 'n8n corre como otro'
    }
    It 'files that are already correct are not touched' {
        foreach ($leaf in 'pilot.prod.env', 'pilot.test.env', '.env.prod-temp', 'config') {
            $script:World.Acl[$leaf] = @{ Exists = $true; Protected = $true; Entries = @(@{ Identity = 'a'; Sid = $script:UserSid; Rights = 'FullControl'; Type = 'Allow'; Inherited = $false }, @{ Identity = 'b'; Sid = 'S-1-5-18'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $false }, @{ Identity = 'c'; Sid = 'S-1-5-32-544'; Rights = 'FullControl'; Type = 'Allow'; Inherited = $false }) }
        }
        $r = Invoke-PhaseQuiet 'Secrets'
        $r.Ok | Should Be $true
        @($script:World.Mut).Count | Should Be 0
    }
}

# =============================================================================================== phase 5
Describe 'Phase 5 Verify (read-only)' {
    BeforeEach {
        . $script:WorldInit
        Mock Get-RepoFacts { @{ HubPort = 8082 } }
        Mock Test-DiagTcp { 'open' }
        Mock Get-FirewallFacts { @{ Available = $true; Profiles = @{}; Rules = @(); Listeners = @() } }
        Mock Get-ApiHealthFacts { @{ Code = 200; Status = 'ok'; Database = 'connected' } }
        Mock Get-ContainerState { if ($Name -match 'api') { return @{ State = 'running'; Health = 'healthy' } } return @{ State = 'running'; Health = '' } }
        Mock Get-Service { [pscustomobject]@{ Name = 'postgresql-x64-18'; Status = 'Running' } }
        Mock Get-NetworkFacts { @{ Adapters = @(@{ Name = 'Wi-Fi'; Kind = 'Wi-Fi'; Status = 'Up'; IPv4 = @('192.0.2.11') }) } }
        Mock Get-DiagFacts { @{} }
        Mock Invoke-DiagEvaluation { @([pscustomobject]@{ Area = 'X'; Check = 'Y'; Status = 'PASS'; Detail = '' }) }
    }
    It 'passes all local checks, marks the LAN checks as EXTERNAL (not invented) and runs the diagnostic without any mutation' {
        $r = Invoke-PhaseQuiet 'Verify'
        $r.Ok | Should Be $true
        $text = $r.Lines -join "`n"
        foreach ($m in '8082 responde en el servidor', 'API -> PostgreSQL', 'API -> n8n', 'Docker api healthy', 'n8n activo', 'PostgreSQL activo', 'Wi-Fi conectado', 'Diagnostico completo') { $text | Should Match $m }
        $text | Should Match '\[EXTERNAL\] 8082 accesible desde la LAN'
        @($r.External).Count | Should Be 4
        @($script:World.Mut).Count | Should Be 0
    }
    It 'a listener rule for 5432, a failing API -> n8n or a diagnostic FAIL fail the phase' {
        Mock Get-FirewallFacts { @{ Available = $true; Profiles = @{}; Rules = @(@{ Name = 'pg lan'; Protocol = 'TCP'; LocalPort = @('5432'); Remote = @('LocalSubnet'); Program = 'Any'; Profile = 'Any' }); Listeners = @() } }
        (Invoke-PhaseQuiet 'Verify').Failure | Should Match '5432 sin regla de entrada LAN'
        Mock Get-FirewallFacts { @{ Available = $true; Profiles = @{}; Rules = @(); Listeners = @() } }
        $script:World.N8nOpen = 'timeout'
        (Invoke-PhaseQuiet 'Verify').Failure | Should Match 'API -> n8n'
        $script:World.N8nOpen = 'open'
        Mock Invoke-DiagEvaluation { @([pscustomobject]@{ Area = 'Firewall'; Check = 'Hub 8082'; Status = 'FAIL'; Detail = 'x' }) }
        (Invoke-PhaseQuiet 'Verify').Failure | Should Match 'diagnostico completo'
    }
}

# Phase 5 must accept exactly what Diagnose accepts: it reuses Diagnose (no second n8n heuristic).
Describe 'Phase 5 and Diagnose stay aligned (n8n logon-task startup)' {
    $configSource = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'Configure-DaubertServer.ps1') -Raw
    It 'Configure dot-sources Diagnose and defines no n8n startup/logon-task heuristic of its own' {
        $configSource | Should Match 'Diagnose-DaubertServer\.ps1'
        $configSource | Should Match 'Invoke-DiagEvaluation'
        $configSource | Should Not Match 'function\s+Test-LogonTaskForUser'
        $configSource | Should Not Match '(?i)\.AutoStart\s*='
        $configSource | Should Not Match 'MSFT_TaskLogonTrigger'
    }
    It 'the real Diagnose evaluation of an n8n host supervised by an enabled AtLogOn task (no AutoAdminLogon) has no FAIL for Startup/n8n and keeps Arranque desatendido as WARN' {
        $script:Checks = New-Object System.Collections.ArrayList
        $task = @{ Name = 'Daubert - n8n Supervisor'; State = 'Running'; LogonType = 'Interactive'; UserId = 'hubuser'
            Triggers = @(@{ Type = 'MSFT_TaskLogonTrigger'; UserId = 'HUB-PC\hubuser'; Delay = 'PT1M'; Enabled = $true })
            Actions = 'powershell.exe -File "C:\ProgramData\DaubertHub\Server\Start-DaubertN8nSupervisor.ps1" n8n' }
        Mock Get-ScheduledTaskFacts { return @($task) }
        Mock Get-CimInstance { return @() }
        Mock Get-DiagText { return $null }
        Mock Get-ListenerFacts { return @(@{ Port = 5678; Addresses = @('::'); Pid = 1; Process = 'node' }) }
        Mock Get-Service { return @() }
        Mock Get-Process { return @() }
        Mock Get-StartupEntries { return @() }
        Mock Get-UserPathReferenceCount { return 0 }
        Mock Get-UserPathReferenceDetail { return @() }
        $n8n = Get-N8nFacts $env:TEMP
        $n8n.LogonTask | Should Be 'Daubert - n8n Supervisor'
        $n8n.AutoStart | Should Be $true
        Test-StartupChecks @{ Installed = $true; AutoStart = $true; RunKey = $true; Containers = @() } @{ ServiceFound = $true; StartType = 'Automatic' } $n8n @{ AutoStart = $true } @{ SchedulerRunning = $true; Tasks = @() } $env:TEMP
        Test-SessionChecks @{ AutoLogon = $false }
        $rows = @($script:Checks)
        (@($rows | Where-Object { $_.Check -eq 'n8n' -and $_.Area -eq 'Startup' })[0]).Status | Should Be 'PASS'
        (@($rows | Where-Object { $_.Check -eq 'Arranque desatendido' })[0]).Status | Should Be 'WARN'
    }
}

# =============================================================================================== orchestration
Describe 'Apply orchestration: confirmation, elevation, stop on failure' {
    BeforeEach {
        $script:Printed = @(); $script:PhaseCalls = @(); $script:FactsCalls = 0; $script:Confirms = 0
        $script:PhaseResults = @{}
        Mock Write-Host { $script:Printed += [string]$Object }
        Mock Get-ConfigFacts { $script:FactsCalls++; return (New-ConfigFacts) }
        Mock Test-ConfigElevated { $true }
        Mock Read-ConfigConfirmation { $script:Confirms++; 'CONFIGURE DAUBERT SERVER' }
        Mock Invoke-ConfigPhase {
            $script:PhaseCalls += $Name
            $res = New-PhaseResult $Name
            if ($script:PhaseResults.ContainsKey($Name)) { $o = $script:PhaseResults[$Name]; if ($o -eq 'fail') { Set-PhaseFailure $res 'boom' } elseif ($o -eq 'failafterchange') { $res.Changed += 'x'; Set-PhaseFailure $res 'boom' } elseif ($o -eq 'blocked') { Set-PhaseFailure $res 'precondicion' $true } }
            return $res
        }
    }
    It 'applies only the selected phase' {
        (Invoke-ConfigMain $false $true @('2') '' @()) | Should Be 0
        ($script:PhaseCalls -join ',') | Should Be 'N8nNetwork'
        ($script:Printed -join "`n") | Should Match 'CONFIGURACION CORRECTA: fases N8nNetwork'
    }
    It 'applies several phases in canonical order' {
        (Invoke-ConfigMain $false $true @('Secrets', '1') '' @()) | Should Be 0
        ($script:PhaseCalls -join ',') | Should Be 'Network,Secrets'
    }
    It 'All runs the five phases in order' {
        (Invoke-ConfigMain $false $true @('All') '' @()) | Should Be 0
        ($script:PhaseCalls -join ',') | Should Be 'Network,N8nNetwork,N8nSupervisor,Secrets,Verify'
    }
    It 'stops at the first failing phase: later phases never run, exit 5, no rollback' {
        $script:PhaseResults['N8nNetwork'] = 'failafterchange'
        (Invoke-ConfigMain $false $true @('All') '' @()) | Should Be 5
        ($script:PhaseCalls -join ',') | Should Be 'Network,N8nNetwork'
        $text = $script:Printed -join "`n"
        $text | Should Match 'CONFIGURATION FAILED en la fase N8nNetwork'
        $text | Should Match 'Fases NO ejecutadas: N8nSupervisor, Secrets, Verify'
        $text | Should Match 'No se hizo rollback automatico'
    }
    It 'a phase blocked before changing anything -> CONFIGURACION BLOQUEADA, exit 1, later phases not run' {
        $script:PhaseResults['Network'] = 'blocked'
        (Invoke-ConfigMain $false $true @('All') '' @()) | Should Be 1
        ($script:PhaseCalls -join ',') | Should Be 'Network'
        ($script:Printed -join "`n") | Should Match 'CONFIGURACION BLOQUEADA'
    }
    It 'an unexpected exception in a phase is a failed phase and stops the run' {
        Mock Invoke-ConfigPhase { $script:PhaseCalls += $Name; throw 'inesperado' }
        (Invoke-ConfigMain $false $true @('All') '' @()) | Should Be 5
        ($script:PhaseCalls -join ',') | Should Be 'Network'
    }
    It 'without elevation, phases 1/2/3 are blocked before asking confirmation or running anything; phase 4 does not need it' {
        Mock Test-ConfigElevated { $false }
        (Invoke-ConfigMain $false $true @('1') '' @()) | Should Be 1
        (Invoke-ConfigMain $false $true @('All') '' @()) | Should Be 1
        @($script:PhaseCalls).Count | Should Be 0
        $script:Confirms | Should Be 0
        (Invoke-ConfigMain $false $true @('4') '' @()) | Should Be 0
        ($script:PhaseCalls -join ',') | Should Be 'Secrets'
    }
    It 'a wrong confirmation phrase cancels without running any phase' {
        Mock Read-ConfigConfirmation { 'yes' }
        (Invoke-ConfigMain $false $true @('1') '' @()) | Should Be 1
        @($script:PhaseCalls).Count | Should Be 0
        ($script:Printed -join "`n") | Should Match 'Confirmacion incorrecta'
    }
    It 'the mutation mode is only active during -Apply and is always reset' {
        $script:Mode | Should Be 'WhatIf'
        Mock Invoke-ConfigPhase { $script:ModeSeen = $script:Mode; $script:PhaseCalls += $Name; return (New-PhaseResult $Name) }
        (Invoke-ConfigMain $false $true @('1') '' @()) | Should Be 0
        $script:ModeSeen | Should Be 'Apply'
        $script:Mode | Should Be 'WhatIf'
        Mock Invoke-ConfigPhase { throw 'x' }
        $null = Invoke-ConfigMain $false $true @('1') '' @()
        $script:Mode | Should Be 'WhatIf'
    }
    It 'usage errors (exit 3): -Apply without -Phase, bad phase, -Phase without mode, both modes, unknown arguments, bad RepoPath' {
        (Invoke-ConfigMain $false $true @() '' @()) | Should Be 3
        (Invoke-ConfigMain $false $true @('9') '' @()) | Should Be 3
        (Invoke-ConfigMain $false $false @('1') '' @()) | Should Be 3
        (Invoke-ConfigMain $true $true @('1') '' @()) | Should Be 3
        (Invoke-ConfigMain $true $false @() '' @('-Configure')) | Should Be 3
        (Invoke-ConfigMain $true $false @() 'C:\definitely\not\here\xyz' @()) | Should Be 3
        @($script:PhaseCalls).Count | Should Be 0
        $script:FactsCalls | Should Be 0
    }
    It 'no mode and no phase prints the usage and does nothing' {
        (Invoke-ConfigMain $false $false @() '' @()) | Should Be 0
        ($script:Printed -join "`n") | Should Match 'Uso: Configure-DaubertServer'
        $script:FactsCalls | Should Be 0
    }
}

# =============================================================================================== WhatIf never mutates
Describe 'Mode -WhatIf never mutates' {
    BeforeEach {
        $script:Printed = @(); $script:FactsCalls = 0; $script:PhaseCalls = @(); $script:MutationCalls = 0
        Mock Write-Host { $script:Printed += [string]$Object }
        Mock Get-ConfigFacts { $script:FactsCalls++; return (New-ConfigFacts) }
        Mock Invoke-ConfigMutation { $script:MutationCalls++ }
        Mock Invoke-ConfigPhase { $script:PhaseCalls += $Name }
        Mock Read-ConfigConfirmation { $script:MutationCalls++; return 'CONFIGURE DAUBERT SERVER' }
        foreach ($m in 'New-NetFirewallRule', 'Set-NetFirewallRule', 'Remove-NetFirewallRule', 'Enable-NetFirewallRule', 'Disable-NetFirewallRule', 'Register-ScheduledTask', 'Unregister-ScheduledTask',
            'Set-ScheduledTask', 'Start-ScheduledTask', 'Set-Acl', 'Set-NetAdapterPowerManagement', 'Set-ItemProperty', 'New-Item', 'Remove-Item', 'Copy-Item', 'Set-Content', 'Out-File', 'Stop-Process', 'Start-Process', 'Restart-Service', 'Stop-Service', 'Set-Service', 'Set-NetIPInterface', 'Set-DnsClientServerAddress', 'Set-NetConnectionProfile') {
            Mock $m { $script:MutationCalls++ }
        }
    }
    It 'the full plan prints, exits 0, and reaches no mutation, no phase and no confirmation' {
        (Invoke-ConfigMain $true $false @() '' @()) | Should Be 0
        $script:FactsCalls | Should Be 1
        $script:MutationCalls | Should Be 0
        @($script:PhaseCalls).Count | Should Be 0
        $text = $script:Printed -join "`n"
        $text | Should Match 'PLAN DE CONFIGURACION DAUBERT HUB SERVER V1'
        $text | Should Match 'comando previsto \(no ejecutado\)'
        $text | Should Match 'WHATIF: no se modifico nada'
        $text | Should Match '0 operaciones ejecutadas'
    }
    It 'each phase has its own WhatIf and none of them mutates' {
        foreach ($p in '1', '2', '3', '4', '5', 'Network', 'N8nNetwork', 'N8nSupervisor', 'Secrets', 'Verify', 'All') {
            (Invoke-ConfigMain $true $false @($p) '' @()) | Should Be 0
        }
        $script:MutationCalls | Should Be 0
        @($script:PhaseCalls).Count | Should Be 0
        ($script:Printed -join "`n") | Should Match 'PLAN DE LAS FASES Network \(WhatIf'
    }
    It 'WhatIf of one phase shows only that phase' {
        $null = Invoke-ConfigMain $true $false @('1') '' @()
        $text = $script:Printed -join "`n"
        $text | Should Match 'Daubert Hub - TCP 8082'
        $text | Should Not Match 'Block LAN TCP 5678'
        $text | Should Not Match 'Tarea "Daubert - n8n Supervisor"'
    }
    It 'secrets are filtered from the printed plan' {
        $f = New-ConfigFacts
        $f.Secrets[0].Needs = 'DB_PASSWORD=hunter2'
        Mock Get-ConfigFacts { return $f }
        $null = Invoke-ConfigMain $true $false @() '' @()
        ($script:Printed -join "`n") | Should Not Match 'hunter2'
    }
}

Describe 'Mutation seam (real function, cmdlets mocked)' {
    BeforeEach { $script:Calls = @(); $script:Mode = 'WhatIf' }
    AfterEach { $script:Mode = 'WhatIf' }
    It 'refuses every operation outside -Apply' {
        Mock New-NetFirewallRule { $script:Calls += 'new' }
        Mock Set-NetFirewallRule { $script:Calls += 'set' }
        foreach ($n in $script:AllowedMutations) { { Invoke-ConfigMutation $n @{} } | Should Throw 'fuera de -Apply' }
        @($script:Calls).Count | Should Be 0
    }
    It 'refuses operations that are not in the allowlist, in Apply mode too (no AutoAdminLogon, no Node.js edit, no delete)' {
        $script:Mode = 'Apply'
        foreach ($n in 'Registry.Winlogon.Set', 'Firewall.NodeJs.Disable', 'Firewall.NodeJs.Remove', 'File.Delete', 'Docker.ComposeDown', 'Postgres.Restart', 'Router.Dhcp.Reserve') { { Invoke-ConfigMutation $n @{} } | Should Throw 'no permitida' }
    }
    It 'Hub rule: New-NetFirewallRule with exactly Inbound/Allow/TCP/8082/LocalSubnet/Profile Any/Group' {
        $script:Mode = 'Apply'
        Mock New-NetFirewallRule { $script:Calls += @{ D = $DisplayName; G = $Group; Dir = $Direction; A = $Action; P = $Protocol; LP = $LocalPort; RA = $RemoteAddress; Pr = $Profile } }
        Invoke-ConfigMutation 'Firewall.Hub8082.Upsert' @{ Exists = $false }
        $c = $script:Calls[0]
        ($c.D + '|' + $c.G + '|' + $c.Dir + '|' + $c.A + '|' + $c.P + '|' + $c.LP + '|' + $c.RA + '|' + $c.Pr) | Should Be 'Daubert Hub - TCP 8082 (LAN)|Daubert Hub|Inbound|Allow|TCP|8082|LocalSubnet|Any'
    }
    It 'Block rule: Action Block, TCP 5678, RemoteAddress exactly LocalSubnet (never Any), Profile Any' {
        $script:Mode = 'Apply'
        Mock New-NetFirewallRule { $script:Calls += @{ D = $DisplayName; Dir = $Direction; A = $Action; P = $Protocol; LP = $LocalPort; RA = $RemoteAddress; Pr = $Profile } }
        Invoke-ConfigMutation 'Firewall.N8nBlock.Upsert' @{ Exists = $false }
        $c = $script:Calls[0]
        ($c.D + '|' + $c.Dir + '|' + $c.A + '|' + $c.P + '|' + $c.LP + '|' + $c.RA + '|' + $c.Pr) | Should Be 'Daubert Hub - Block LAN TCP 5678|Inbound|Block|TCP|5678|LocalSubnet|Any'
    }
    It 'updating an existing rule only ever targets the Daubert rule names (never Node.js) and never removes or disables anything' {
        $script:Mode = 'Apply'
        Mock Set-NetFirewallRule { $script:Calls += $DisplayName }
        Mock Remove-NetFirewallRule { $script:Calls += 'REMOVE' }
        Mock Disable-NetFirewallRule { $script:Calls += 'DISABLE' }
        Invoke-ConfigMutation 'Firewall.Hub8082.Upsert' @{ Exists = $true }
        Invoke-ConfigMutation 'Firewall.N8nBlock.Upsert' @{ Exists = $true }
        ($script:Calls -join ',') | Should Be 'Daubert Hub - TCP 8082 (LAN),Daubert Hub - Block LAN TCP 5678'
        ($script:Calls -join ',') | Should Not Match 'Node|REMOVE|DISABLE'
    }
    It 'the supervisor task is Interactive with no password, IgnoreNew, AtLogOn with 1 min delay (real task objects, only Register is mocked)' {
        $script:Mode = 'Apply'
        Mock Register-ScheduledTask { $script:Calls += @{ Name = $TaskName; Delay = $Trigger.Delay; Multi = $Settings.MultipleInstances; Arg = $Action.Arguments; Logon = [string]$Principal.LogonType; Run = [string]$Principal.RunLevel; TrigType = $Trigger.CimClass.CimClassName } }
        Invoke-ConfigMutation 'Task.N8nSupervisor.Register' @{}
        $r = $script:Calls[0]
        $r.Name | Should Be 'Daubert - n8n Supervisor'
        $r.Logon | Should Be 'Interactive'
        $r.Run | Should Be 'Limited'
        $r.Delay | Should Be 'PT1M'
        $r.Multi | Should Be 'IgnoreNew'
        $r.TrigType | Should Match 'LogonTrigger'
        $r.Arg | Should Match '-WindowStyle Hidden -File "C:\\ProgramData\\DaubertHub\\Server\\Start-DaubertN8nSupervisor\.ps1"'
    }
    It 'Dir.Create refuses paths outside the Daubert server folder; Acl.Secret.Apply refuses unknown files' {
        $script:Mode = 'Apply'
        Mock New-Item { $script:Calls += 'new-item' }
        { Invoke-ConfigMutation 'Dir.Create' @{ Path = 'C:\Windows\System32\x' } } | Should Throw 'fuera de'
        { Invoke-ConfigMutation 'Acl.Secret.Apply' @{ Path = 'C:\Windows\win.ini'; Sids = @('S-1-5-18') } } | Should Throw 'no permitido'
        @($script:Calls).Count | Should Be 0
        Invoke-ConfigMutation 'Dir.Create' @{ Path = 'C:\ProgramData\DaubertHub\Server\logs' }
        @($script:Calls).Count | Should Be 1
    }
}

Describe 'ACL operation on a real temporary file' {
    It 'leaves exactly the requested identities with FullControl and a protected ACL, and keeps the file' {
        $dir = Join-Path ([System.IO.Path]::GetTempPath()) ('cfg-acl-' + [guid]::NewGuid().ToString('N'))
        $file = Join-Path $dir 'config'
        try {
            New-Item -ItemType Directory -Path $dir | Out-Null
            Set-Content -LiteralPath $file -Value 'x'
            $script:Mode = 'Apply'
            Invoke-ConfigMutation 'Acl.Secret.Apply' @{ Path = $file; Sids = @($script:UserSid, 'S-1-5-18', 'S-1-5-32-544') }
            $script:Mode = 'WhatIf'
            $d = Get-AclDetail $file
            $d.Protected | Should Be $true
            (@($d.Entries | ForEach-Object { $_.Sid } | Sort-Object) -join ',') | Should Be ((@($script:UserSid, 'S-1-5-18', 'S-1-5-32-544') | Sort-Object) -join ',')
            @($d.Entries | Where-Object { $_.Rights -notmatch 'FullControl' }).Count | Should Be 0
            (Test-FileReadable $file) | Should Be $true
            (Test-Path -LiteralPath $file) | Should Be $true
        } finally { $script:Mode = 'WhatIf'; Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

Describe 'API probe is fixed and read-only' {
    It 'only host.docker.internal on 5678/5432 is accepted; anything else is refused before running docker' {
        (Test-ProbeRequest 'host.docker.internal' 5678) | Should Be $null
        (Test-ProbeRequest 'host.docker.internal' 5432) | Should Be $null
        (Test-ProbeRequest 'example.com' 5678) | Should Match 'no permitido'
        (Test-ProbeRequest 'host.docker.internal' 22) | Should Match 'no permitido'
        { Invoke-ConfigProbe 'example.com' 5678 } | Should Throw 'Sonda rechazada'
        { Invoke-ConfigProbe 'host.docker.internal' 3000 } | Should Throw 'Sonda rechazada'
    }
    It 'the probe script only connects (no data is written) and prints OPEN/REFUSED/TIMEOUT/ERROR' {
        $script:ApiProbeScript | Should Match 'net'
        $script:ApiProbeScript | Should Not Match '\.write\(|\.end\(|http|require\([''"](fs|child_process)'
    }
}

# =============================================================================================== static guarantees
Describe 'Static guarantees of the script' {
    BeforeAll {
        $tokens = $null; $errs = $null
        $script:Ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errs)
        $script:AstErrors = @($errs).Count
        $script:CmdAsts = @($script:Ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true))
        function Get-OwnerFunction($node) { $p = $node.Parent; while ($p -and $p -isnot [System.Management.Automation.Language.FunctionDefinitionAst]) { $p = $p.Parent }; if ($p) { return $p.Name } return '' }
        $script:CmdInfo = @($script:CmdAsts | ForEach-Object { @{ Name = [string]$_.GetCommandName(); Owner = (Get-OwnerFunction $_); Ast = $_ } } | Where-Object { $_.Name })
    }
    It 'parses without errors' { $script:AstErrors | Should Be 0 }
    It 'has only the WhatIf/Apply/Phase/RepoPath parameters (no AutoAdminLogon, router or DHCP switch)' {
        $names = @($script:Ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
        ($names -join ',') | Should Be 'WhatIf,Apply,Phase,RepoPath,UnknownArguments'
    }
    It 'outside the mutation seam no state-changing cmdlet or native mutation tool is ever invoked' {
        $ok = @('New-Object', 'New-Step', 'New-ConfigPlan', 'New-PhaseResult', 'Set-StrictMode', 'Set-PhaseFailure', 'Out-Null', 'Start-Sleep', 'Start-ConfigSleep')
        $bad = @($script:CmdInfo | Where-Object { $_.Owner -ne 'Invoke-ConfigMutation' -and $_.Name -match '^(Set|New|Remove|Enable|Disable|Start|Stop|Restart|Register|Unregister|Install|Uninstall|Clear|Move|Rename|Copy|Add|Out|Grant|Revoke|Reset|Update|Import|Export)-' -and $ok -notcontains $_.Name } | ForEach-Object { $_.Owner + ': ' + $_.Name })
        ($bad -join ', ') | Should Be ''
        @($script:CmdInfo | Where-Object { @('icacls', 'netsh', 'schtasks', 'powercfg', 'reg', 'sc', 'git', 'Invoke-Expression') -contains $_.Name }).Count | Should Be 0
        @($script:CmdInfo | Where-Object { $_.Name -eq 'docker' -and $_.Owner -ne 'Invoke-ConfigProbe' }).Count | Should Be 0
        @($script:CmdInfo | Where-Object { $_.Name -eq 'Start-Sleep' -and $_.Owner -ne 'Start-ConfigSleep' }).Count | Should Be 0
    }
    It 'inside the seam only the approved cmdlets appear (no Remove/Disable/Stop/Restart/Unregister/registry/Winlogon)' {
        $allowed = @('Set-NetFirewallRule', 'New-NetFirewallRule', 'New-Item', 'Copy-Item', 'New-ScheduledTaskAction', 'New-ScheduledTaskTrigger', 'New-ScheduledTaskSettingsSet', 'New-ScheduledTaskPrincipal', 'Register-ScheduledTask',
            'Start-ScheduledTask', 'Get-Acl', 'Set-Acl', 'New-Object', 'Out-Null', 'Split-Path', 'Join-Path')
        $inside = @($script:CmdInfo | Where-Object { $_.Owner -eq 'Invoke-ConfigMutation' })
        $notAllowed = @($inside | Where-Object { $allowed -notcontains $_.Name } | ForEach-Object { $_.Name })
        ($notAllowed -join ', ') | Should Be ''
        @($inside | Where-Object { $_.Name -match 'Remove-|Disable-|Stop-|Restart-|Unregister-|ItemProperty|Winlogon' }).Count | Should Be 0
    }
    It 'every Set-NetFirewallRule in the seam targets only the Hub or the Block rule name' {
        $sets = @($script:CmdInfo | Where-Object { $_.Name -eq 'Set-NetFirewallRule' })
        $sets.Count | Should Be 2
        foreach ($s in $sets) {
            $els = @($s.Ast.CommandElements)
            $idx = -1; for ($i = 0; $i -lt $els.Count; $i++) { if ($els[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and $els[$i].ParameterName -eq 'DisplayName') { $idx = $i } }
            $idx | Should BeGreaterThan 0
            $els[$idx + 1].Extent.Text | Should Match '^\$script:(HubRuleName|BlockRuleName)$'
        }
    }
    It 'no ScheduledTask principal parameter stores credentials (no -Password, LogonType Interactive only)' {
        $p = @($script:CmdInfo | Where-Object { $_.Name -eq 'New-ScheduledTaskPrincipal' })
        $p.Count | Should Be 1
        $txt = $p[0].Ast.Extent.Text
        $txt | Should Match '-LogonType Interactive'
        $txt | Should Not Match '(?i)-Password|S4U|ServiceAccount'
        (Get-Content -LiteralPath $scriptPath -Raw) | Should Not Match '(?i)(Set|New)-ItemProperty[^\r\n]*Winlogon|DefaultPassword\s*='
    }
    It 'the mutation seam is called only from the phase functions, each with its own operations (phases do not cross)' {
        $calls = @($script:CmdInfo | Where-Object { $_.Name -eq 'Invoke-ConfigMutation' -and $_.Owner -ne 'Invoke-ConfigMutation' })
        $owners = @($calls | ForEach-Object { $_.Owner } | Select-Object -Unique | Sort-Object)
        ($owners -join ',') | Should Be 'Invoke-PhaseN8nNetwork,Invoke-PhaseN8nSupervisor,Invoke-PhaseNetwork,Invoke-PhaseSecrets'
        function Get-Ops($fn) { (@($calls | Where-Object { $_.Owner -eq $fn } | ForEach-Object { $_.Ast.CommandElements[1].Value } | Sort-Object -Unique)) -join ',' }
        (Get-Ops 'Invoke-PhaseNetwork') | Should Be 'Firewall.Hub8082.Upsert'
        (Get-Ops 'Invoke-PhaseN8nNetwork') | Should Be 'Firewall.N8nBlock.Upsert'
        (Get-Ops 'Invoke-PhaseSecrets') | Should Be 'Acl.Secret.Apply'
        (Get-Ops 'Invoke-PhaseN8nSupervisor') | Should Be 'Dir.Create,File.CopySupervisor,Task.N8nSupervisor.Register,Task.N8nSupervisor.Start'
    }
    It 'the allowlist of mutations contains no router, DHCP, DNS, Docker, PostgreSQL, registry or delete operation' {
        ($script:AllowedMutations -join ' ') | Should Not Match '(?i)router|dhcp|dns|docker|postgres|registry|winlogon|delete|remove|restart|node'
    }
    It 'docker is only read through inspect (Invoke-DiagRead) or the fixed probe: no compose down/restart, no PostgreSQL restart, no n8n import/export' {
        $docker = @($script:CmdInfo | Where-Object { $_.Name -eq 'Invoke-DiagRead' -and @($_.Ast.CommandElements).Count -gt 2 -and $_.Ast.CommandElements[1].Extent.Text -eq "'docker'" })
        $docker.Count | Should BeGreaterThan 0
        foreach ($d in $docker) { $d.Ast.CommandElements[2].Extent.Text | Should Match "^@\('inspect'" }
        $code = [regex]::Replace((Get-Content -LiteralPath $scriptPath -Raw), '(?s)<#.*?#>', '')
        $code | Should Not Match '(?i)Restart-Service|pg_ctl|n8n\s+(import|export)'
    }
}
