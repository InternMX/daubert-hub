<#
.SYNOPSIS
    Phased configuration of the Daubert Hub Server V1 host (Windows PowerShell 5.1).

.DESCRIPTION
    Modes (mutually exclusive):
      -WhatIf            Reads the host (read-only) and prints the plan. Without -Phase: the full plan. With -Phase:
                         only the plan of those phases. It never reaches a mutation.
      -Apply -Phase ...  Applies ONLY the selected phases, in order, stopping at the first failure. It requires an
                         explicit -Phase, an elevated session for the phases that need it, and the typed phrase
                         CONFIGURE DAUBERT SERVER. There is no automatic rollback.
      (none)             Prints the usage.

    Phases (each one can be run on its own; -Phase accepts a number or a name, one or several, or All):
      1 Network        Rule "Daubert Hub - TCP 8082 (LAN)": Inbound, Allow, TCP, LocalPort 8082,
                       RemoteAddress LocalSubnet, Profile Any. Verified right after.
      2 N8nNetwork     Block rule "Daubert Hub - Block LAN TCP 5678": Inbound, Block, TCP, 5678, RemoteAddress
                       LocalSubnet only (loopback is never blocked). The existing Node.js rules are not touched.
                       Checks API(Docker) -> n8n:5678 before and after; if it fails: CONFIGURATION FAILED.
      3 N8nSupervisor  Task Scheduler task "Daubert - n8n Supervisor" (no NSSM/WinSW, no AutoAdminLogon, no stored
                       password); verifies a single n8n instance, port 5678, API -> n8n and the supervisor log.
      4 Secrets        Restricts the ACL of pilot.prod.env, pilot.test.env, .env.prod-temp and .n8n\config to the
                       current user, SYSTEM and Administrators (removes CodexSandboxUsers, drops inheritance).
                       Nothing is deleted. State and target are shown before changing each file.
      5 Verify         Read-only verification + the full diagnostic.

    Exit codes: 0 ok | 1 blocked before changing anything (preconditions, elevation, confirmation) | 3 usage error |
    5 a phase failed after starting (CONFIGURATION FAILED; later phases are NOT run).

    Never done by this script: router/DHCP/DNS changes, AutoAdminLogon, docker compose down/restart, restarting
    PostgreSQL, touching n8n workflows or credentials, removing or editing the Node.js firewall rules, deleting files.

    Design: every native command goes through Invoke-DiagRead (read-only allowlist, from the diagnostic) or the
    fixed API probe. The ONLY function that can change the host is Invoke-ConfigMutation: it refuses to run outside
    -Apply, accepts only a short allowlist of named operations and validates their targets.
#>
[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$Apply,
    [string[]]$Phase,
    [string]$RepoPath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$UnknownArguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Dot-sourcing the diagnostic binds its own (empty) parameters in this scope: keep ours first.
$script:CfgWhatIf = [bool]$WhatIf
$script:CfgApply = [bool]$Apply
$script:CfgPhase = @($Phase | Where-Object { $_ })
$script:CfgRepoPath = $RepoPath
$script:CfgUnknown = @($UnknownArguments | Where-Object { $_ })
. (Join-Path $PSScriptRoot 'Diagnose-DaubertServer.ps1')

$script:Mode = 'WhatIf'
$script:ConfirmationPhrase = 'CONFIGURE DAUBERT SERVER'
$script:HubRuleName = 'Daubert Hub - TCP 8082 (LAN)'
$script:BlockRuleName = 'Daubert Hub - Block LAN TCP 5678'
$script:HubRuleGroup = 'Daubert Hub'
$script:NodeRuleDisplayName = 'Node.js JavaScript Runtime'
$script:HubRuleSpec = @{ DisplayName = $script:HubRuleName; Group = 'Daubert Hub'; Direction = 'Inbound'; Action = 'Allow'; Protocol = 'TCP'; LocalPort = '8082'; RemoteAddress = 'LocalSubnet'; Profile = 'Any' }
$script:BlockRuleSpec = @{ DisplayName = $script:BlockRuleName; Group = 'Daubert Hub'; Direction = 'Inbound'; Action = 'Block'; Protocol = 'TCP'; LocalPort = '5678'; RemoteAddress = 'LocalSubnet'; Profile = 'Any' }
$script:SupervisorTaskName = 'Daubert - n8n Supervisor'
$script:ServerDataDir = 'C:\ProgramData\DaubertHub\Server'
$script:SupervisorLogDir = 'C:\ProgramData\DaubertHub\Server\logs'
$script:SupervisorInstalled = 'C:\ProgramData\DaubertHub\Server\Start-DaubertN8nSupervisor.ps1'
$script:SupervisorSource = (Join-Path $PSScriptRoot 'Start-DaubertN8nSupervisor.ps1')
$script:SupervisorLogFile = 'C:\ProgramData\DaubertHub\Server\logs\n8n-supervisor.log'
$script:ApiContainer = 'daubert-hub-api-1'
$script:N8nPort = 5678
$script:AllPhases = @('Network', 'N8nNetwork', 'N8nSupervisor', 'Secrets', 'Verify')
$script:ElevatedPhases = @('Network', 'N8nNetwork', 'N8nSupervisor')
$script:SecretLeafNames = @('pilot.prod.env', 'pilot.test.env', '.env.prod-temp', 'config')
$script:WebhookEnvNames = @('CATERPILLAR_REPROCESS_WEBHOOK_URL', 'PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL')
$script:AllowedMutations = @('Firewall.Hub8082.Upsert', 'Firewall.N8nBlock.Upsert', 'Dir.Create', 'File.CopySupervisor', 'Task.N8nSupervisor.Register', 'Task.N8nSupervisor.Start', 'Acl.Secret.Apply')
$script:ApiProbeScript = "const n=require('net');const s=n.connect({host:process.argv[1],port:+process.argv[2]});s.setTimeout(4000);s.on('connect',()=>{console.log('OPEN');s.destroy()});s.on('timeout',()=>{console.log('TIMEOUT');s.destroy()});s.on('error',e=>{console.log(e.code==='ECONNREFUSED'?'REFUSED':'ERROR');});"
$script:ExitOk = 0
$script:ExitBlocked = 1
$script:ExitConfigUsage = 3
$script:ExitFailed = 5

# ================================================================== Seams (reads)
function Test-ConfigElevated {
    try { return (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch { return $false }
}

function Read-ConfigConfirmation {
    return (Read-Host ('Para aplicar escriba exactamente: ' + $script:ConfirmationPhrase))
}

function Start-ConfigSleep {
    param([int]$Seconds)
    Start-Sleep -Seconds $Seconds
}

function Wait-ConfigUntil {
    param([scriptblock]$Condition, [int]$TimeoutSeconds = 60, [int]$IntervalSeconds = 3)
    $waited = 0
    while ($true) {
        if (& $Condition) { return $true }
        if ($waited -ge $TimeoutSeconds) { return $false }
        Start-ConfigSleep $IntervalSeconds
        $waited += $IntervalSeconds
    }
}

function Test-ProbeRequest {
    # Returns $null when the request is exactly the fixed, read-only TCP probe; otherwise the reason it is refused.
    param([string]$Target, [int]$TargetPort)
    if ($Target -ne 'host.docker.internal') { return 'destino no permitido: solo host.docker.internal' }
    if (@(5678, 5432) -notcontains $TargetPort) { return 'puerto no permitido' }
    return $null
}

function Invoke-ConfigProbe {
    # TCP connect (no request is sent) from the API container to host.docker.internal:<port>. Only this fixed command.
    param([string]$Target = 'host.docker.internal', [int]$TargetPort)
    $refused = Test-ProbeRequest $Target $TargetPort
    if ($refused) { throw ('Sonda rechazada: ' + $refused) }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = & docker exec $script:ApiContainer node -e $script:ApiProbeScript $Target ([string]$TargetPort) 2>$null } catch { return 'error' } finally { $ErrorActionPreference = $previous }
    $line = @($out | Where-Object { $_ }) | Select-Object -Last 1
    switch ([string]$line) { 'OPEN' { return 'open' } 'REFUSED' { return 'refused' } 'TIMEOUT' { return 'timeout' } default { return 'error' } }
}

function Test-ApiToHostPort {
    param([int]$TargetPort)
    return (Invoke-ConfigProbe 'host.docker.internal' $TargetPort)
}

function Get-FirewallRuleDetail {
    param($Rule)
    $flt = Get-FirewallRuleFilter $Rule
    $svc = Get-NetFirewallServiceFilter -AssociatedNetFirewallRule $Rule -ErrorAction SilentlyContinue
    $itf = Get-NetFirewallInterfaceTypeFilter -AssociatedNetFirewallRule $Rule -ErrorAction SilentlyContinue
    return @{
        Name = [string]$Rule.Name; DisplayName = [string]$Rule.DisplayName; Group = [string]$Rule.Group; Enabled = [string]$Rule.Enabled
        Profile = [string]$Rule.Profile; Direction = [string]$Rule.Direction; Action = [string]$Rule.Action; EdgeTraversal = [string]$Rule.EdgeTraversalPolicy
        Protocol = [string](Get-Prop $flt.Port 'Protocol' 'Any'); LocalPort = (ConvertTo-PortList (Get-Prop $flt.Port 'LocalPort' 'Any')); RemotePort = (ConvertTo-PortList (Get-Prop $flt.Port 'RemotePort' 'Any'))
        RemoteAddress = (ConvertTo-PortList (Get-Prop $flt.Address 'RemoteAddress' 'Any')); Program = [string](Get-Prop $flt.App 'Program' 'Any')
        Service = [string](Get-Prop $svc 'Service' 'Any'); InterfaceType = [string](Get-Prop $itf 'InterfaceType' 'Any')
    }
}

function Get-FirewallRuleDetailByName {
    # Read-only: every inbound rule with this exact display name, in full.
    param([string]$DisplayName)
    $out = @()
    try { foreach ($r in @(Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction Stop | Where-Object { [string]$_.Direction -eq 'Inbound' })) { $out += (Get-FirewallRuleDetail $r) } } catch { }
    return $out
}

function Get-NodeRuleSnapshot {
    # Read-only snapshot of the existing Node.js rules, used to prove they are not modified.
    return @(Get-FirewallRuleDetailByName $script:NodeRuleDisplayName | Sort-Object { $_.Name })
}

function Get-ConnectionsToPort {
    param([int]$Port)
    $rows = @()
    foreach ($c in @(Get-NetTCPConnection -RemotePort $Port -State Established -ErrorAction SilentlyContinue)) {
        $name = ''
        try { $name = [string](Get-Process -Id $c.OwningProcess -ErrorAction Stop).Name } catch { }
        $rows += @{ ClientAddress = [string]$c.LocalAddress; ServerAddress = [string]$c.RemoteAddress; Process = $name }
    }
    return $rows
}

function Get-N8nMainProcesses {
    # Main n8n processes only (not the task runner). Owner name when it can be read.
    $out = @()
    try {
        foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop | Where-Object { [string]$_.CommandLine -match '[\\/]n8n[\\/]bin[\\/]n8n(\s|"|$)' })) {
            $owner = ''
            try { $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction Stop; $owner = [string]$o.User } catch { }
            $out += @{ Pid = [int]$p.ProcessId; SessionId = [int]$p.SessionId; Owner = $owner }
        }
    } catch { }
    return $out
}

function Get-ContainerState {
    param([string]$Name)
    $r = Invoke-DiagRead 'docker' @('inspect', '--format', '{{.State.Status}}|{{if index .State `Health`}}{{.State.Health.Status}}{{end}}', $Name)
    if ($r.Code -ne 0 -or $r.Out.Count -eq 0) { return @{ State = ''; Health = '' } }
    $p = @($r.Out[0] -split '\|', 2)
    $health = ''
    if ($p.Count -gt 1) { $health = $p[1] }
    return @{ State = $p[0]; Health = $health }
}

function Get-ApiHealthFacts {
    param([int]$HubPort = 8082)
    $resp = Invoke-DiagHttp ('http://127.0.0.1:' + $HubPort + '/api/health')
    if (-not $resp) { return $null }
    $h = @{ Code = $resp.Code; Status = ''; Database = '' }
    try { $j = $resp.Body | ConvertFrom-Json; $h.Status = [string](Get-Prop $j 'status' ''); $h.Database = [string](Get-Prop $j 'database' '') } catch { }
    return $h
}

function Get-SupervisorLogLines {
    $t = Get-DiagText $script:SupervisorLogFile
    if (-not $t) { return @() }
    return @($t -split "`r?`n" | Where-Object { $_ } | Select-Object -Last 50)
}

function Test-FileReadable {
    param([string]$Path)
    try { $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite'); $fs.Dispose(); return $true } catch { return $false }
}

function Get-AclDetail {
    param([string]$Path)
    $d = @{ Path = $Path; Exists = (Test-Path -LiteralPath $Path -PathType Leaf); Owner = ''; Protected = $false; Entries = @() }
    if (-not $d.Exists) { return $d }
    try {
        $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
        $d.Owner = [string]$acl.Owner; $d.Protected = [bool]$acl.AreAccessRulesProtected
        $entries = @()
        foreach ($r in @($acl.Access)) {
            $sid = ''
            try { $sid = $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = [string]$r.IdentityReference }
            $entries += @{ Identity = [string]$r.IdentityReference; Sid = $sid; Rights = [string]$r.FileSystemRights; Type = [string]$r.AccessControlType; Inherited = [bool]$r.IsInherited }
        }
        $d.Entries = $entries
    } catch { $d.Unreadable = $true }
    return $d
}

function Get-FileReferenceCount {
    param([string]$Needle, [string[]]$Roots)
    $count = 0
    foreach ($root in $Roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $items = @()
        if (Test-Path -LiteralPath $root -PathType Leaf) { $items = @(Get-Item -LiteralPath $root) }
        else { $items = @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.(ps1|psm1|yaml|yml|json|cjs|js|cmd)$' -and $_.FullName -notmatch '\\(node_modules|\.git|tests|docs)\\|\\scripts\\server\\' -and $_.Length -lt 2MB }) }
        foreach ($i in $items) {
            $t = Get-DiagText $i.FullName
            if ($t) { $count += ([regex]::Matches($t, [regex]::Escape($Needle))).Count }
        }
    }
    return $count
}

function Get-UserPathReferenceDetail {
    param([string[]]$Roots, [string]$ExtensionPattern = '\.(json|ps1|psm1|cmd|bat|xml|yaml|yml|js|cjs)$')
    $needle = ($env:USERPROFILE + '\').ToLowerInvariant()
    $alt = $needle.Replace('\', '/')
    $out = @()
    foreach ($root in $Roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $ExtensionPattern -and $_.Length -lt 2MB -and $_.FullName -notmatch '\\(node_modules|\.git|dist)\\' })) {
            $text = Get-DiagText $file.FullName
            if (-not $text) { continue }
            $lower = $text.ToLowerInvariant()
            $n = ([regex]::Matches($lower, [regex]::Escape($needle))).Count + ([regex]::Matches($lower, [regex]::Escape($alt))).Count
            if ($n -gt 0) { $out += @{ Path = $file.FullName; Count = $n } }
        }
    }
    return $out
}

function ConvertTo-HostPort {
    param([string]$Url)
    if ($Url -match '^(https?://[^/\s?#]+)') { return $Matches[1] }
    return ''
}

function Get-ApiWebhookTargets {
    $targets = @()
    $filter = ($script:WebhookEnvNames | ForEach-Object { '(eq (index $p 0) `' + $_ + '`)' }) -join ' '
    $fmt = '{{range .Config.Env}}{{$p := split . `=`}}{{if or ' + $filter + '}}{{println .}}{{end}}{{end}}'
    $r = Invoke-DiagRead 'docker' @('inspect', '--format', $fmt, $script:ApiContainer)
    if ($r.Code -ne 0) { return $targets }
    foreach ($line in $r.Out) {
        if ($line -match '^([A-Z_]+)=(.*)$') { $hp = ConvertTo-HostPort $Matches[2]; if ($hp) { $targets += @{ Name = $Matches[1]; Target = $hp } } }
    }
    return $targets
}

# ================================================================== The ONLY mutation seam
function Invoke-ConfigMutation {
    # Refuses to run outside -Apply, accepts only named, allowlisted operations and validates their targets.
    param([string]$Name, [hashtable]$Params = @{})
    if ($script:Mode -ne 'Apply') { throw ('Mutacion rechazada fuera de -Apply: ' + $Name) }
    if ($script:AllowedMutations -notcontains $Name) { throw ('Mutacion no permitida: ' + $Name) }
    switch ($Name) {
        'Firewall.Hub8082.Upsert' {
            if ($Params.Contains('Exists') -and $Params.Exists) {
                Set-NetFirewallRule -DisplayName $script:HubRuleName -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8082 -RemoteAddress LocalSubnet -Profile Any
            } else {
                New-NetFirewallRule -DisplayName $script:HubRuleName -Group $script:HubRuleGroup -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8082 -RemoteAddress LocalSubnet -Profile Any -Enabled True | Out-Null
            }
        }
        'Firewall.N8nBlock.Upsert' {
            if ($Params.Contains('Exists') -and $Params.Exists) {
                Set-NetFirewallRule -DisplayName $script:BlockRuleName -Enabled True -Direction Inbound -Action Block -Protocol TCP -LocalPort 5678 -RemoteAddress LocalSubnet -Profile Any
            } else {
                New-NetFirewallRule -DisplayName $script:BlockRuleName -Group $script:HubRuleGroup -Direction Inbound -Action Block -Protocol TCP -LocalPort 5678 -RemoteAddress LocalSubnet -Profile Any -Enabled True | Out-Null
            }
        }
        'Dir.Create' {
            $p = [string]$Params.Path
            if (-not $p.StartsWith($script:ServerDataDir, [System.StringComparison]::OrdinalIgnoreCase)) { throw ('Directorio fuera de ' + $script:ServerDataDir) }
            New-Item -ItemType Directory -Path $p -Force | Out-Null
        }
        'File.CopySupervisor' {
            Copy-Item -LiteralPath $script:SupervisorSource -Destination $script:SupervisorInstalled -Force
        }
        'Task.N8nSupervisor.Register' {
            $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
            $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script:SupervisorInstalled + '"')
            $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
            $trigger.Delay = 'PT1M'
            $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval ([TimeSpan]::FromMinutes(1)) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
            $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
            Register-ScheduledTask -TaskName $script:SupervisorTaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Daubert Hub: supervisa n8n (adopta la instancia existente, evita duplicados, reinicia si muere).' | Out-Null
        }
        'Task.N8nSupervisor.Start' {
            Start-ScheduledTask -TaskName $script:SupervisorTaskName
        }
        'Acl.Secret.Apply' {
            $path = [string]$Params.Path
            if ($script:SecretLeafNames -notcontains (Split-Path -Leaf $path)) { throw ('ACL: archivo no permitido: ' + $path) }
            $acl = Get-Acl -LiteralPath $path
            $acl.SetAccessRuleProtection($true, $false)
            foreach ($existing in @($acl.Access)) { [void]$acl.RemoveAccessRule($existing) }
            foreach ($sid in @($Params.Sids)) {
                $id = New-Object System.Security.Principal.SecurityIdentifier([string]$sid)
                $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($id, 'FullControl', 'Allow')
                $acl.AddAccessRule($rule)
            }
            Set-Acl -LiteralPath $path -AclObject $acl
        }
    }
}

# ================================================================== Facts (read-only, for the plan)
function Get-ConfigFacts {
    param([string]$RepoRoot)
    $facts = @{}
    $facts.Elevated = (Test-ConfigElevated)
    $facts.User = ($env:USERDOMAIN + '\' + $env:USERNAME)
    $facts.UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $facts.Network = Get-NetworkFacts
    $facts.Energy = Get-EnergyFacts
    $facts.Firewall = Get-FirewallFacts
    $facts.HubRules = @(Get-FirewallRuleDetailByName $script:HubRuleName)
    $facts.BlockRules = @(Get-FirewallRuleDetailByName $script:BlockRuleName)
    $facts.NodeRules = @(Get-NodeRuleSnapshot)
    $facts.N8nListener = (Get-ListenerFacts @($script:N8nPort)) | Select-Object -First 1
    $facts.N8nConnections = @(Get-ConnectionsToPort $script:N8nPort)
    $facts.N8n = Get-N8nFacts $RepoRoot
    $facts.SupervisorTask = @(Get-ScheduledTaskFacts ('^' + [regex]::Escape($script:SupervisorTaskName) + '$'))
    $facts.SupervisorSourceExists = (Test-Path -LiteralPath $script:SupervisorSource)
    $facts.WebhookTargets = @(Get-ApiWebhookTargets)
    $secretPaths = @(
        @{ Label = 'pilot.prod.env'; Path = (Join-Path $RepoRoot 'deploy\pilot.prod.env'); Needs = 'el usuario que ejecuta docker compose / el deploy' }
        @{ Label = 'pilot.test.env'; Path = (Join-Path $RepoRoot 'deploy\pilot.test.env'); Needs = 'el usuario que ejecuta docker compose / el deploy' }
        @{ Label = '.env.prod-temp'; Path = (Join-Path $RepoRoot '.env.prod-temp'); Needs = 'a determinar (ver referencias de uso)' }
        @{ Label = '.n8n\config'; Path = (Join-Path $env:USERPROFILE '.n8n\config'); Needs = 'el usuario que ejecuta n8n (y su backup)' })
    $facts.Secrets = @($secretPaths | ForEach-Object { $a = Get-AclDetail $_.Path; $a.Label = $_.Label; $a.Needs = $_.Needs; $a })
    $facts.EnvProdTempRefs = (Get-FileReferenceCount '.env.prod-temp' @((Join-Path $RepoRoot 'compose.yaml'), (Join-Path $RepoRoot 'compose.pilot.yaml'), (Join-Path $RepoRoot 'compose.prod-temp.yaml'), (Join-Path $RepoRoot 'scripts'), (Join-Path $RepoRoot 'deploy')))
    $facts.PathRefs = @(Get-UserPathReferenceDetail @((Join-Path $RepoRoot 'n8n'), (Join-Path $RepoRoot 'scripts'), 'C:\ProgramData\DaubertHub\Backup'))
    $facts.TaskPathRefs = @(Get-ScheduledTaskFacts 'Daubert' | Where-Object { ([string]$_.Actions).ToLowerInvariant().Contains($env:USERPROFILE.ToLowerInvariant()) } | ForEach-Object { $_.Name })
    $facts.Session = Get-SessionFacts
    $facts.Docker = @{ AutoStart = (Get-DockerFacts).AutoStart }
    return $facts
}

# ================================================================== Rule comparison (pure)
function Get-RuleDiff {
    # Differences between a rule and its spec. Group cannot be changed on an existing rule, so it is reported apart.
    param($Rule, [hashtable]$Spec)
    $diff = @()
    if ($Rule.Enabled -ne 'True') { $diff += 'Enabled=' + $Rule.Enabled + ' (esperado True)' }
    if ($Rule.Direction -ne $Spec.Direction) { $diff += 'Direction=' + $Rule.Direction }
    if ($Rule.Action -ne $Spec.Action) { $diff += 'Action=' + $Rule.Action }
    if ($Rule.Protocol -ne $Spec.Protocol) { $diff += 'Protocol=' + $Rule.Protocol }
    if ((@($Rule.LocalPort) -join ',') -ne $Spec.LocalPort) { $diff += 'LocalPort=' + (@($Rule.LocalPort) -join ',') }
    if ((@($Rule.RemoteAddress) -join ',') -ne $Spec.RemoteAddress) { $diff += 'RemoteAddress=' + (@($Rule.RemoteAddress) -join ',') }
    if ($Rule.Profile -ne $Spec.Profile) { $diff += 'Profile=' + $Rule.Profile }
    if ($Rule.Program -ne 'Any') { $diff += 'Program=' + $Rule.Program }
    return @{ Diff = $diff; GroupMismatch = ($Rule.Group -ne $Spec.Group) }
}

function Test-RuleProtectsLoopback {
    # True when the rule can never match loopback traffic: its remote scope is exactly LocalSubnet.
    param($Rule)
    $remote = @($Rule.RemoteAddress)
    if ($remote.Count -ne 1 -or $remote[0] -ne 'LocalSubnet') { return $false }
    return $true
}

function Get-DesiredHubRuleDiff {
    param($Rule)
    $r = Get-RuleDiff $Rule $script:HubRuleSpec
    $d = @($r.Diff)
    if ($r.GroupMismatch) { $d += 'Group=' + $Rule.Group }
    return $d
}

# ================================================================== Plan (pure)
function New-Step {
    param([string]$Area, [string]$Action, [string]$Target, [string]$Detail, [string]$Command = '', [int]$PhaseNumber = 0)
    # Action: CREATE | UPDATE (would change the host) | NOOP | CHECK | INFO | DECISION | SKIP
    return [pscustomobject]@{ Area = $Area; Action = $Action; Target = $Target; Detail = $Detail; Command = $Command; Phase = $PhaseNumber
        WouldChange = (@('CREATE', 'UPDATE') -contains $Action) }
}

function Format-AclLine {
    param($Entry)
    return ($Entry.Identity + ': ' + $Entry.Rights + ' (' + $Entry.Type + ', ' + $(if ($Entry.Inherited) { 'heredada' } else { 'explicita' }) + ')')
}

function Get-GeneralSteps {
    param($Facts)
    $steps = @()
    $steps += New-Step 'Contexto' 'INFO' 'Sesion' ($(if ($Facts.Elevated) { 'elevada' } else { 'NO elevada: -Apply de las fases 1, 2 y 3 requiere administrador; el ahorro de energia del adaptador y algunas ACL no se pueden verificar' }) + ' (usuario ' + $Facts.User + ')')
    $null = $script:Checks.Clear()
    Test-NetworkChecks $Facts.Network
    $wifiRows = @($script:Checks | Where-Object { @('Wi-Fi', 'Conexion principal', 'IP actual', 'Gateway', 'DHCP', 'Conectividad local', 'Wi-Fi ahorro de energia') -contains $_.Check })
    foreach ($r in $wifiRows) { $steps += New-Step 'Wi-Fi' $(if ($r.Status -eq 'FAIL' -or $r.Status -eq 'WARN') { 'DECISION' } else { 'CHECK' }) $r.Check ($r.Status + ': ' + $r.Detail) }
    $ad = @($Facts.Network.Adapters | Where-Object { $_.Kind -eq 'Wi-Fi' -and $_.Status -eq 'Up' }) | Select-Object -First 1
    if ($ad) {
        $ps = [string](Get-Prop $ad 'PowerSaving' '')
        if ($ps -eq 'Enabled') { $steps += New-Step 'Wi-Fi' 'DECISION' ('Adaptador ' + $ad.Name) 'Windows puede apagar el adaptador para ahorrar energia; corregirlo NO esta en las fases de esta version (no se toca la energia)' }
        elseif ($ps -eq 'Disabled') { $steps += New-Step 'Wi-Fi' 'NOOP' ('Adaptador ' + $ad.Name) 'Windows ya no puede apagar el adaptador' }
        else { $steps += New-Step 'Wi-Fi' 'CHECK' ('Adaptador ' + $ad.Name) 'ahorro de energia del adaptador NO verificable en esta sesion (ejecutar elevado)' }
    }
    $psm = Get-Prop $Facts.Energy 'WifiPowerSavingAc'
    $steps += New-Step 'Energia' 'NOOP' 'Plan de energia' ('plan ' + [string](Get-Prop $Facts.Energy 'Plan' '?') + '; Wi-Fi modo ahorro con corriente = ' + $(if ($null -eq $psm) { 'n/d' } else { [string]$psm }) + ' (sin cambios; la energia no se toca)')
    $steps += New-Step 'Red' 'INFO' 'Perfil de red' 'se mantiene Public (decision de V1): la regla del Hub usa Profile Any y no depende de cambiarlo a Private'
    $primary = @($Facts.Network.Adapters | Where-Object { $_.Status -eq 'Up' -and @($_.IPv4).Count -gt 0 }) | Select-Object -First 1
    $mac = $(if ($primary) { [string]$primary.Mac } else { '?' }); $ip = $(if ($primary -and @($primary.IPv4).Count -gt 0) { [string]$primary.IPv4[0] } else { '?' })
    $steps += New-Step 'Red' 'INFO' 'DHCP reservation (router de la LAN)' ('PENDIENTE de autorizacion: ' + $mac + ' -> ' + $ip + '. El script NO toca el router ni la IP/DHCP/DNS del equipo. Hasta que exista la IP puede cambiar')
    $steps += New-Step 'Red' 'INFO' 'DNS interno' 'fuera de V1 por ahora'
    $steps += New-Step 'Red' 'INFO' 'Ethernet' 'no es requisito en V1 (recomendado para disponibilidad)'
    $steps += New-Step 'Compose' 'INFO' 'Proyecto PROD' 'se mantiene "daubert-hub"; renombrarlo a daubert-hub-prod queda para un release controlado posterior'
    $steps += New-Step 'Docker' 'NOOP' 'Docker Desktop AutoStart' ('AutoStart=' + [string](Get-Prop $Facts.Docker 'AutoStart' '?') + ' (ya activo; sin cambios). Web/API siguen en Docker; PostgreSQL y n8n siguen en Windows. No se usa docker compose down ni se reinicia PostgreSQL')
    return $steps
}

function Get-PhaseSteps {
    param([string]$Name, $Facts)
    $steps = @()
    switch ($Name) {
        'Network' {
            $hubRules = @($Facts.HubRules)
            if ($hubRules.Count -eq 0) {
                $steps += New-Step 'Firewall' 'CREATE' $script:HubRuleName 'permitir TCP 8082 solo desde la subred local: Inbound / Allow / TCP / LocalPort 8082 / RemoteAddress LocalSubnet / Profile Any / Group Daubert Hub. Ningun puerto se abre hacia Internet (el router no se toca; sin port forwarding). Se verifica la regla justo despues' ("New-NetFirewallRule -DisplayName '" + $script:HubRuleName + "' -Group '" + $script:HubRuleGroup + "' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8082 -RemoteAddress LocalSubnet -Profile Any") 1
            } else {
                $diff = @(Get-DesiredHubRuleDiff $hubRules[0])
                if ($diff.Count -eq 0) { $steps += New-Step 'Firewall' 'NOOP' $script:HubRuleName 'la regla ya existe con las propiedades objetivo' '' 1 }
                else { $steps += New-Step 'Firewall' 'UPDATE' $script:HubRuleName ('corregir: ' + ($diff -join '; ')) ("Set-NetFirewallRule -DisplayName '" + $script:HubRuleName + "' -Enabled True -Action Allow -Protocol TCP -LocalPort 8082 -RemoteAddress LocalSubnet -Profile Any") 1 }
            }
            $others = @($Facts.Firewall.Rules | Where-Object { $_.Name -ne $script:HubRuleName -and ($_.Protocol -eq 'TCP' -or $_.Protocol -eq '6') -and $_.Program -eq 'Any' -and (Test-PortMatch $_.LocalPort 8082) -and (@($_.LocalPort) -notcontains 'Any') })
            if ($others.Count -gt 0) { $steps += New-Step 'Firewall' 'INFO' 'Otras reglas de 8082' ('existen ' + $others.Count + ' regla(s) TCP sin programa que ya cubren 8082: ' + (@($others | ForEach-Object { $_.Name + ' [' + (@($_.Remote) -join ',') + ']' }) -join ', ')) '' 1 }
            foreach ($p in 3000, 5432) {
                $rules = @($Facts.Firewall.Rules | Where-Object { (Test-PortMatch $_.LocalPort $p) -and (@($_.LocalPort) -notcontains 'Any') })
                $steps += New-Step 'Firewall' $(if ($rules.Count -eq 0) { 'NOOP' } else { 'DECISION' }) ('TCP ' + $p + ' LAN') $(if ($rules.Count -eq 0) { 'sin regla de entrada: bloqueado por el firewall por defecto' } else { 'existe una regla de entrada: revisar (' + (@($rules | ForEach-Object { $_.Name }) -join ', ') + ')' }) '' 1
            }
            $steps += New-Step 'Firewall' 'SKIP' 'Fase 1' 'no toca n8n, ACL, tareas, energia, router ni Docker' '' 1
        }
        'N8nNetwork' {
            $l = $Facts.N8nListener
            $addr = @(); if ($l) { $addr = @($l.Addresses) }
            $steps += New-Step 'n8n/Firewall' 'INFO' 'Listener 5678' $(if ($addr.Count -gt 0) { 'escucha en ' + ($addr -join ', ') + ' (' + $l.Process + ', PID ' + $l.Pid + '); el binding de PRODUCCION no se cambia a 127.0.0.1' } else { 'nada escucha en 5678: la fase 2 se bloquea (no se podria verificar API -> n8n)' }) '' 2
            foreach ($t in @($Facts.WebhookTargets)) { $steps += New-Step 'n8n/Firewall' 'INFO' ('API -> ' + $t.Name) ('el API usa ' + $t.Target + ' (solo host:puerto)') '' 2 }
            $groups = @($Facts.N8nConnections | ForEach-Object { $_.Process + ' desde ' + $_.ClientAddress + ' -> ' + $_.ServerAddress } | Select-Object -Unique)
            $dockerConn = @($Facts.N8nConnections | Where-Object { $_.Process -match 'docker' })
            $steps += New-Step 'n8n/Firewall' 'INFO' 'Origen que ve Windows' $(if ($dockerConn.Count -gt 0) { 'conexiones del proceso de Docker Desktop llegan como ' + (@($dockerConn | ForEach-Object { $_.ClientAddress } | Select-Object -Unique) -join ', ') + ' (loopback: no coincide con RemoteAddress LocalSubnet y no depende de la regla Node.js)' } elseif ($groups.Count -gt 0) { 'conexiones activas ahora: ' + ($groups -join '; ') + '. Sin conexion de Docker en este instante: la del API es corta; la fase 2 la comprueba con una sonda antes y despues' } else { 'sin conexiones activas en este instante; la fase 2 lo comprueba con una sonda antes y despues' }) '' 2
            foreach ($nr in @($Facts.NodeRules)) {
                $steps += New-Step 'n8n/Firewall' 'INFO' ('Regla Node.js: ' + $nr.Name) ('enabled=' + $nr.Enabled + ', ' + $nr.Direction + ', action=' + $nr.Action + ', profile=' + $nr.Profile + ', protocol=' + $nr.Protocol + ', localPort=' + (@($nr.LocalPort) -join ',') + ', remoteAddress=' + (@($nr.RemoteAddress) -join ',') + ', program=' + $nr.Program + ', service=' + $nr.Service + ', edge=' + $nr.EdgeTraversal + ', interface=' + $nr.InterfaceType) '' 2
            }
            $steps += New-Step 'n8n/Firewall' 'INFO' 'Regla Node.js (NO se modifica)' 'las reglas existentes de Node.js no se modifican ni se eliminan; la fase 2 compara una instantanea antes y despues y falla si cambian' '' 2
            $blk = @($Facts.BlockRules)
            if ($blk.Count -eq 0) {
                $steps += New-Step 'n8n/Firewall' 'CREATE' $script:BlockRuleName 'bloquear la entrada TCP 5678 SOLO desde la subred local: Inbound / Block / TCP / LocalPort 5678 / RemoteAddress LocalSubnet / Profile Any / Group Daubert Hub. Loopback no se bloquea (RemoteAddress nunca es Any ni incluye 127.0.0.1/::1). Despues: LAN->5678 bloqueado (requiere cliente externo) y API Docker->n8n:5678 debe seguir funcionando; si la sonda falla: CONFIGURATION FAILED y se detiene' ("New-NetFirewallRule -DisplayName '" + $script:BlockRuleName + "' -Group '" + $script:HubRuleGroup + "' -Direction Inbound -Action Block -Protocol TCP -LocalPort 5678 -RemoteAddress LocalSubnet -Profile Any") 2
            } else {
                $r = Get-RuleDiff $blk[0] $script:BlockRuleSpec
                $d = @($r.Diff); if ($r.GroupMismatch) { $d += 'Group=' + $blk[0].Group }
                if ($d.Count -eq 0) { $steps += New-Step 'n8n/Firewall' 'NOOP' $script:BlockRuleName 'la regla de bloqueo ya existe con las propiedades objetivo' '' 2 }
                else { $steps += New-Step 'n8n/Firewall' 'UPDATE' $script:BlockRuleName ('corregir: ' + ($d -join '; ')) ("Set-NetFirewallRule -DisplayName '" + $script:BlockRuleName + "' -Enabled True -Action Block -Protocol TCP -LocalPort 5678 -RemoteAddress LocalSubnet -Profile Any") 2 }
            }
        }
        'N8nSupervisor' {
            $n8n = $Facts.N8n
            $sup = @($Facts.SupervisorTask)
            $steps += New-Step 'n8n' 'INFO' 'Estado actual' $(if ($n8n.Running) { 'n8n corre manualmente (PID ' + $n8n.Pid + ', sesion ' + $n8n.SessionId + ') sin servicio ni tarea; el supervisor ADOPTA esa instancia: no se detiene ni se reinicia, y no se inicia una segunda' } else { 'n8n no esta corriendo: el supervisor lo iniciara' }) '' 3
            if (-not (Get-Prop $Facts 'SupervisorSourceExists' $true)) { $steps += New-Step 'n8n' 'DECISION' 'Script del supervisor' 'falta scripts\server\Start-DaubertN8nSupervisor.ps1 en el repositorio' '' 3 }
            $steps += New-Step 'n8n' 'CREATE' ('Directorio de logs ' + $script:SupervisorLogDir) 'n8n-supervisor.log (intentos, PID, puerto, reinicios; rotado a 5 MB; sin secretos)' '' 3
            $steps += New-Step 'n8n' 'CREATE' ('Script ' + $script:SupervisorInstalled) 'copia de scripts\server\Start-DaubertN8nSupervisor.ps1: mutex global (evita instancias duplicadas); si ya hay un n8n lo adopta; si 5678 esta ocupado por otro programa no inicia nada; espera a Docker (daemon) y Dropbox con limite; arranca n8n con el node/n8n actuales sin tocar workflows ni credenciales; espera a 5678 (max 120 s); vigila el proceso y lo reinicia con espera creciente si muere' '' 3
            if ($sup.Count -eq 0) {
                $steps += New-Step 'n8n' 'CREATE' ('Tarea "' + $script:SupervisorTaskName + '"') ('trigger: al iniciar sesion de ' + $Facts.User + ' con retraso de 1 min; accion: powershell -NoProfile -WindowStyle Hidden -File el script anterior; MultipleInstances=IgnoreNew; sin limite de duracion; reintentos de la tarea 999 cada 1 min; RunLevel Limited; LogonType Interactive (no guarda ninguna contrasena). NO se habilita AutoAdminLogon: el arranque tras reinicio depende de que el usuario inicie sesion. Despues se inicia la tarea una vez para verificar') ("Register-ScheduledTask -TaskName '" + $script:SupervisorTaskName + "' (accion/trigger/settings segun el diseno)") 3
            } else { $steps += New-Step 'n8n' 'NOOP' ('Tarea "' + $script:SupervisorTaskName + '"') ('ya existe (estado ' + $sup[0].State + ')') '' 3 }
            $steps += New-Step 'n8n' 'CHECK' 'Verificacion de la fase' 'una sola instancia principal de n8n; n8n escucha en 5678; API -> n8n:5678; el log del supervisor registra su arranque; la tarea es Interactive' '' 3
            $steps += New-Step 'n8n' 'SKIP' 'Workflows y credenciales' 'no se leen ni se modifican' '' 3
        }
        'Secrets' {
            $needed = @($Facts.UserSid, 'S-1-5-18', 'S-1-5-32-544')
            foreach ($sf in @($Facts.Secrets)) {
                if (-not $sf.Exists) { $steps += New-Step 'Secretos' 'INFO' $sf.Label 'no existe en este equipo' '' 4; continue }
                $cur = @($sf.Entries | ForEach-Object { Format-AclLine $_ })
                $extra = @($sf.Entries | Where-Object { $_.Type -eq 'Allow' -and $needed -notcontains $_.Sid })
                $detail = 'ACL actual: ' + ($cur -join ' | ') + ' || necesita acceso: ' + $sf.Needs + ' (+ SYSTEM y Administradores)'
                if ($extra.Count -eq 0) { $steps += New-Step 'Secretos' 'NOOP' $sf.Label ($detail + ' || ya restringida a los necesarios') '' 4; continue }
                $inherited = (@($extra | Where-Object { $_.Inherited }).Count -gt 0)
                $proposed = 'ACL propuesta: ' + $Facts.User + ': FullControl | NT AUTHORITY\SYSTEM: FullControl | BUILTIN\Administrators: FullControl; se quitaria: ' + (@($extra | ForEach-Object { $_.Identity }) -join ', ') + $(if ($inherited) { ' (heredada: se desactiva la herencia en este archivo)' } else { '' })
                $steps += New-Step 'Secretos' 'UPDATE' $sf.Label ($detail + ' || ' + $proposed + '. Despues se verifica que el usuario, las tareas Daubert y n8n conservan acceso. Nota: CodexSandboxUsers parece el grupo del sandbox de herramientas de IA; confirmar que no necesita leerlo') 'Set-Acl (ACL protegida con usuario, SYSTEM y Administradores: FullControl)' 4
                if ($sf.Label -eq '.env.prod-temp') { $steps += New-Step 'Secretos' 'DECISION' '.env.prod-temp' ('referencias de uso en compose/scripts/deploy: ' + [string]$Facts.EnvProdTempRefs + '. NO se borra ni se mueve (solo se restringe la ACL); si es 0 es candidato a archivarse fuera del repo') '' 4 }
            }
            $steps += New-Step 'Secretos' 'SKIP' 'Contenido' 'ningun valor se lee ni se imprime; no se borra ningun archivo' '' 4
        }
        'Verify' {
            $steps += New-Step 'Verificacion' 'CHECK' 'Fase 5' 'solo lectura: diagnostico completo; 8082 responde en el servidor; 3000/5432/5678 sin regla de entrada LAN; API -> PostgreSQL (/api/health database=connected); API -> n8n:5678; contenedores healthy/running; n8n activo y una sola instancia; PostgreSQL activo; Wi-Fi conectado' '' 5
            $steps += New-Step 'Verificacion' 'INFO' 'Accesibilidad desde la LAN' 'desde el propio servidor no se puede probar el firewall (el trafico a la propia IP no pasa por el filtrado); queda como verificacion EXTERNA desde un cliente de la LAN: 8082 debe abrir; 3000, 5432 y 5678 deben dar timeout' '' 5
            $steps += New-Step 'Verificacion' 'SKIP' 'DHCP/DNS/router' 'no se tocan' '' 5
        }
    }
    return $steps
}

function New-ConfigPlan {
    param($Facts, [string[]]$Phases = @())
    $steps = @()
    if (@($Phases).Count -eq 0) {
        $steps += Get-GeneralSteps $Facts
        foreach ($p in $script:AllPhases) { $steps += Get-PhaseSteps $p $Facts }
        $total = 0
        foreach ($r in @($Facts.PathRefs)) { $total += [int]$r.Count }
        $steps += New-Step 'Portabilidad' 'INFO' 'Rutas del perfil de usuario' ([string]$total + ' referencias en ' + @($Facts.PathRefs).Count + ' archivos + ' + @($Facts.TaskPathRefs).Count + ' tareas programadas; NO se modifican en esta fase')
        foreach ($r in @($Facts.PathRefs)) { $steps += New-Step 'Portabilidad' 'INFO' $r.Path ([string]$r.Count + ' referencia(s)') }
        foreach ($tn in @($Facts.TaskPathRefs)) { $steps += New-Step 'Portabilidad' 'INFO' ('Tarea ' + $tn) 'la accion referencia la ruta del perfil de usuario' }
        $steps += New-Step 'Arranque' 'DECISION' 'Inicio de sesion de Windows' $(if ($Facts.Session.AutoLogon) { 'AutoAdminLogon esta configurado (no se audita ninguna credencial)' } else { 'sin AutoAdminLogon (no se habilita ni se modifica): tras un reinicio solo PostgreSQL (servicio) arranca solo; Docker Desktop, la tarea del supervisor de n8n y Dropbox esperan a que un usuario inicie sesion. El arranque completamente desatendido depende de una decision de inicio de sesion de Windows' })
    } else {
        foreach ($p in $Phases) { $steps += Get-PhaseSteps $p $Facts }
    }
    return $steps
}

# ================================================================== Phase selection
function ConvertTo-PhaseList {
    # Canonical, ordered phase names, or $null when any value is invalid.
    param([string[]]$Values)
    $map = @{ '1' = 'Network'; 'network' = 'Network'; '2' = 'N8nNetwork'; 'n8nnetwork' = 'N8nNetwork'; '3' = 'N8nSupervisor'; 'n8nsupervisor' = 'N8nSupervisor'; '4' = 'Secrets'; 'secrets' = 'Secrets'; '5' = 'Verify'; 'verify' = 'Verify' }
    $picked = @()
    foreach ($v in @($Values)) {
        foreach ($piece in ([string]$v -split ',')) {
            $k = $piece.Trim().ToLowerInvariant()
            if (-not $k) { continue }
            if ($k -eq 'all') { return @($script:AllPhases) }
            if (-not $map.ContainsKey($k)) { return $null }
            $picked += $map[$k]
        }
    }
    if ($picked.Count -eq 0) { return $null }
    return @($script:AllPhases | Where-Object { $picked -contains $_ })
}

# ================================================================== Phase execution (-Apply)
function New-PhaseResult {
    param([string]$Name)
    return @{ Name = $Name; Ok = $true; Blocked = $false; Changed = @(); External = @(); Lines = @(); Failure = '' }
}

function Set-PhaseFailure {
    param($Result, [string]$Message, [bool]$Blocked = $false)
    $Result.Ok = $false; $Result.Blocked = $Blocked; $Result.Failure = $Message
    $Result.Lines += ('FALLO: ' + $Message)
}

function Invoke-PhaseNetwork {
    $r = New-PhaseResult 'Network'
    $existing = @(Get-FirewallRuleDetailByName $script:HubRuleName)
    if ($existing.Count -gt 1) { Set-PhaseFailure $r ('hay ' + $existing.Count + ' reglas con el nombre "' + $script:HubRuleName + '": revisar manualmente') $true; return $r }
    if ($existing.Count -eq 1) {
        $cmp = Get-RuleDiff $existing[0] $script:HubRuleSpec
        $r.Lines += ('Estado actual: regla existente; diferencias: ' + $(if (@($cmp.Diff).Count -gt 0) { @($cmp.Diff) -join '; ' } else { 'ninguna' }))
        if ($cmp.GroupMismatch) { Set-PhaseFailure $r ('la regla existente tiene el grupo "' + $existing[0].Group + '" y un grupo no se puede cambiar: corregirlo manualmente') $true; return $r }
    } else { $r.Lines += 'Estado actual: la regla no existe' }
    $r.Lines += 'Destino: Inbound / Allow / TCP / LocalPort 8082 / RemoteAddress LocalSubnet / Profile Any'
    $needsChange = ($existing.Count -eq 0) -or (@((Get-RuleDiff $existing[0] $script:HubRuleSpec).Diff).Count -gt 0)
    if ($needsChange) {
        Invoke-ConfigMutation 'Firewall.Hub8082.Upsert' @{ Exists = ($existing.Count -eq 1) }
        $r.Changed += $script:HubRuleName
    } else { $r.Lines += 'Sin cambios: la regla ya es correcta.' }
    $after = @(Get-FirewallRuleDetailByName $script:HubRuleName)
    if ($after.Count -ne 1) { Set-PhaseFailure $r ('verificacion: se esperaba exactamente 1 regla y hay ' + $after.Count); return $r }
    $cmp2 = Get-RuleDiff $after[0] $script:HubRuleSpec
    if (@($cmp2.Diff).Count -gt 0 -or $cmp2.GroupMismatch) { Set-PhaseFailure $r ('verificacion: la regla no tiene los parametros esperados (' + (@($cmp2.Diff) -join '; ') + $(if ($cmp2.GroupMismatch) { '; Group=' + $after[0].Group } else { '' }) + ')'); return $r }
    $r.Lines += 'Verificado: la regla existe con exactamente los parametros esperados.'
    $r.External += 'LAN -> 8082 accesible: verificar desde un cliente de la LAN (debe abrir)'
    return $r
}

function Invoke-PhaseN8nNetwork {
    $r = New-PhaseResult 'N8nNetwork'
    $l = (Get-ListenerFacts @($script:N8nPort)) | Select-Object -First 1
    if (-not $l -or @($l.Addresses).Count -eq 0) { Set-PhaseFailure $r 'nada escucha en 5678: no se puede verificar API -> n8n; no se aplica nada' $true; return $r }
    $baseline = Test-ApiToHostPort $script:N8nPort
    $r.Lines += ('Linea base API Docker -> n8n:5678 = ' + $baseline)
    if ($baseline -ne 'open') { Set-PhaseFailure $r ('la linea base API -> n8n no funciona (' + $baseline + '): no se aplica nada para no confundir causas') $true; return $r }
    $nodeBefore = Get-NodeRuleSnapshot
    $existing = @(Get-FirewallRuleDetailByName $script:BlockRuleName)
    if ($existing.Count -gt 1) { Set-PhaseFailure $r ('hay ' + $existing.Count + ' reglas con el nombre "' + $script:BlockRuleName + '": revisar manualmente') $true; return $r }
    if ($existing.Count -eq 1) {
        $cmp = Get-RuleDiff $existing[0] $script:BlockRuleSpec
        $r.Lines += ('Estado actual: regla existente; diferencias: ' + $(if (@($cmp.Diff).Count -gt 0) { @($cmp.Diff) -join '; ' } else { 'ninguna' }))
        if ($cmp.GroupMismatch) { Set-PhaseFailure $r 'la regla de bloqueo existente tiene otro grupo: corregirlo manualmente' $true; return $r }
    } else { $r.Lines += 'Estado actual: la regla de bloqueo no existe' }
    $r.Lines += 'Destino: Inbound / Block / TCP / LocalPort 5678 / RemoteAddress LocalSubnet / Profile Any (loopback no se bloquea; las reglas de Node.js no se tocan)'
    $needsChange = ($existing.Count -eq 0) -or (@((Get-RuleDiff $existing[0] $script:BlockRuleSpec).Diff).Count -gt 0)
    if ($needsChange) {
        Invoke-ConfigMutation 'Firewall.N8nBlock.Upsert' @{ Exists = ($existing.Count -eq 1) }
        $r.Changed += $script:BlockRuleName
    } else { $r.Lines += 'Sin cambios: la regla de bloqueo ya es correcta.' }
    $after = @(Get-FirewallRuleDetailByName $script:BlockRuleName)
    if ($after.Count -ne 1) { Set-PhaseFailure $r ('CONFIGURATION FAILED: se esperaba exactamente 1 regla de bloqueo y hay ' + $after.Count); return $r }
    $cmp2 = Get-RuleDiff $after[0] $script:BlockRuleSpec
    if (@($cmp2.Diff).Count -gt 0 -or $cmp2.GroupMismatch) { Set-PhaseFailure $r ('CONFIGURATION FAILED: la regla de bloqueo no tiene los parametros esperados (' + (@($cmp2.Diff) -join '; ') + ')'); return $r }
    if (-not (Test-RuleProtectsLoopback $after[0])) { Set-PhaseFailure $r 'CONFIGURATION FAILED: la regla de bloqueo no esta limitada a LocalSubnet (podria bloquear loopback)'; return $r }
    $r.Lines += 'Verificado: regla de bloqueo con exactamente los parametros esperados, limitada a LocalSubnet (loopback no afectado).'
    $nodeAfter = Get-NodeRuleSnapshot
    if ((ConvertTo-Json $nodeBefore -Depth 5 -Compress) -ne (ConvertTo-Json $nodeAfter -Depth 5 -Compress)) { Set-PhaseFailure $r 'CONFIGURATION FAILED: las reglas de Node.js cambiaron durante la fase (no deberian tocarse)'; return $r }
    $r.Lines += ('Verificado: las ' + @($nodeAfter).Count + ' regla(s) de Node.js siguen identicas.')
    $probe = Test-ApiToHostPort $script:N8nPort
    $r.Lines += ('API Docker -> n8n:5678 despues del bloqueo = ' + $probe)
    if ($probe -ne 'open') {
        Set-PhaseFailure $r ('CONFIGURATION FAILED: API -> n8n:5678 fallo tras aplicar el bloqueo (' + $probe + '). No se continua y NO se hace rollback automatico. Rollback manual: Remove-NetFirewallRule -DisplayName "' + $script:BlockRuleName + '"')
        return $r
    }
    $r.Lines += 'Verificado: API Docker -> n8n:5678 sigue funcionando.'
    $r.External += 'LAN -> 5678 bloqueado: verificar desde un cliente de la LAN (debe dar timeout)'
    return $r
}

function Invoke-PhaseN8nSupervisor {
    $r = New-PhaseResult 'N8nSupervisor'
    if (-not (Test-Path -LiteralPath $script:SupervisorSource)) { Set-PhaseFailure $r ('falta ' + $script:SupervisorSource) $true; return $r }
    $before = @(Get-N8nMainProcesses)
    if ($before.Count -gt 1) { Set-PhaseFailure $r ('ya hay ' + $before.Count + ' instancias principales de n8n: resolverlo manualmente antes de crear el supervisor') $true; return $r }
    $autoBefore = [bool](Get-SessionFacts).AutoLogon
    $r.Lines += ('Estado actual: instancias de n8n = ' + $before.Count + '; AutoAdminLogon = ' + $autoBefore + ' (no se modifica)')
    $existingTask = @(Get-ScheduledTaskFacts ('^' + [regex]::Escape($script:SupervisorTaskName) + '$'))
    Invoke-ConfigMutation 'Dir.Create' @{ Path = $script:SupervisorLogDir }
    $r.Changed += $script:SupervisorLogDir
    Invoke-ConfigMutation 'File.CopySupervisor' @{}
    $r.Changed += $script:SupervisorInstalled
    if ($existingTask.Count -eq 0) { Invoke-ConfigMutation 'Task.N8nSupervisor.Register' @{}; $r.Changed += ('Tarea ' + $script:SupervisorTaskName) }
    else { $r.Lines += 'La tarea ya existe: no se vuelve a registrar.' }
    $task = @(Get-ScheduledTaskFacts ('^' + [regex]::Escape($script:SupervisorTaskName) + '$'))
    if ($task.Count -ne 1) { Set-PhaseFailure $r 'verificacion: la tarea del supervisor no existe tras registrarla'; return $r }
    if ($task[0].LogonType -ne 'Interactive') { Set-PhaseFailure $r ('verificacion: la tarea no es Interactive (' + $task[0].LogonType + '): podria requerir almacenar una contrasena'); return $r }
    $r.Lines += 'Verificado: tarea registrada con LogonType Interactive (sin contrasena almacenada).'
    Invoke-ConfigMutation 'Task.N8nSupervisor.Start' @{}
    $logged = Wait-ConfigUntil { @(Get-SupervisorLogLines | Where-Object { $_ -match 'adoptada|n8n iniciado|escucha en el puerto' }).Count -gt 0 } 90 3
    if (-not $logged) { Set-PhaseFailure $r 'verificacion: el log del supervisor no registro su arranque en 90 s'; return $r }
    $r.Lines += ('Verificado: el supervisor registro su arranque en ' + $script:SupervisorLogFile)
    $listening = Wait-ConfigUntil { $l = (Get-ListenerFacts @($script:N8nPort)) | Select-Object -First 1; $l -and @($l.Addresses).Count -gt 0 } 120 3
    if (-not $listening) { Set-PhaseFailure $r 'verificacion: n8n no escucha en 5678'; return $r }
    $r.Lines += 'Verificado: n8n escucha en 5678.'
    $after = @(Get-N8nMainProcesses)
    if ($after.Count -ne 1) { Set-PhaseFailure $r ('verificacion: debe haber exactamente 1 instancia principal de n8n y hay ' + $after.Count); return $r }
    $r.Lines += ('Verificado: una sola instancia de n8n (PID ' + $after[0].Pid + ').')
    $probe = Test-ApiToHostPort $script:N8nPort
    if ($probe -ne 'open') { Set-PhaseFailure $r ('CONFIGURATION FAILED: API -> n8n:5678 = ' + $probe); return $r }
    $r.Lines += 'Verificado: API Docker -> n8n:5678 funciona.'
    if ([bool](Get-SessionFacts).AutoLogon -ne $autoBefore) { Set-PhaseFailure $r 'AutoAdminLogon cambio durante la fase (no deberia tocarse)'; return $r }
    $r.Lines += 'Verificado: AutoAdminLogon sin cambios.'
    return $r
}

function Invoke-PhaseSecrets {
    param([string]$RepoRoot)
    $r = New-PhaseResult 'Secrets'
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $needed = @($userSid, 'S-1-5-18', 'S-1-5-32-544')
    $user = ($env:USERDOMAIN + '\' + $env:USERNAME)
    $targets = @(
        @{ Label = 'pilot.prod.env'; Path = (Join-Path $RepoRoot 'deploy\pilot.prod.env') }
        @{ Label = 'pilot.test.env'; Path = (Join-Path $RepoRoot 'deploy\pilot.test.env') }
        @{ Label = '.env.prod-temp'; Path = (Join-Path $RepoRoot '.env.prod-temp') }
        @{ Label = '.n8n\config'; Path = (Join-Path $env:USERPROFILE '.n8n\config') })
    $work = @()
    foreach ($t in $targets) {
        $a = Get-AclDetail $t.Path
        if (-not $a.Exists) { $r.Lines += ($t.Label + ': no existe, se omite'); continue }
        $extra = @($a.Entries | Where-Object { $_.Type -eq 'Allow' -and $needed -notcontains $_.Sid })
        $r.Lines += ($t.Label + ' ESTADO: ' + (@($a.Entries | ForEach-Object { Format-AclLine $_ }) -join ' | '))
        $r.Lines += ($t.Label + ' DESTINO: ' + $user + ', NT AUTHORITY\SYSTEM, BUILTIN\Administrators = FullControl; ACL protegida' + $(if ($extra.Count -gt 0) { '; se quita: ' + (@($extra | ForEach-Object { $_.Identity }) -join ', ') } else { ' (ya correcta)' }))
        if ($extra.Count -gt 0 -or (-not $a.Protected -and (@($a.Entries | Where-Object { $_.Inherited }).Count -gt 0))) { $work += $t }
    }
    foreach ($t in $work) {
        Invoke-ConfigMutation 'Acl.Secret.Apply' @{ Path = $t.Path; Sids = $needed }
        $r.Changed += $t.Label
    }
    foreach ($t in $targets) {
        $a = Get-AclDetail $t.Path
        if (-not $a.Exists) { continue }
        $sids = @($a.Entries | Where-Object { $_.Type -eq 'Allow' } | ForEach-Object { $_.Sid } | Select-Object -Unique)
        $extra = @($sids | Where-Object { $needed -notcontains $_ })
        if ($extra.Count -gt 0) { Set-PhaseFailure $r ('verificacion: ' + $t.Label + ' aun concede acceso a ' + ($extra -join ', ')); return $r }
        foreach ($n in $needed) { if ($sids -notcontains $n) { Set-PhaseFailure $r ('verificacion: ' + $t.Label + ' perdio el acceso de ' + $n); return $r } }
        if (-not $a.Protected) { Set-PhaseFailure $r ('verificacion: ' + $t.Label + ' sigue heredando permisos'); return $r }
        if (-not (Test-FileReadable $t.Path)) { Set-PhaseFailure $r ('verificacion: el usuario actual ya no puede leer ' + $t.Label); return $r }
    }
    $r.Lines += 'Verificado: solo el usuario, SYSTEM y Administradores tienen acceso; el usuario actual puede leer cada archivo; ninguno fue borrado.'
    foreach ($tk in @(Get-ScheduledTaskFacts '^Daubert - ')) {
        $uid = [string](Get-Prop $tk 'UserId' '')
        if ($uid -and $uid -notmatch ('(^|\\)' + [regex]::Escape($env:USERNAME) + '$') -and $uid -notmatch 'SYSTEM') { Set-PhaseFailure $r ('verificacion: la tarea "' + $tk.Name + '" corre como ' + $uid + ', que ya no tendria acceso'); return $r }
    }
    $r.Lines += 'Verificado: las tareas Daubert corren como el usuario actual (conservan acceso).'
    foreach ($p in @(Get-N8nMainProcesses)) {
        if ($p.Owner -and $p.Owner -ne $env:USERNAME) { Set-PhaseFailure $r ('verificacion: n8n corre como ' + $p.Owner + ', que ya no tendria acceso a .n8n\config'); return $r }
    }
    $r.Lines += 'Verificado: n8n corre como el usuario actual (conserva acceso).'
    return $r
}

function Get-VerifyChecks {
    param([string]$RepoRoot)
    $acc = New-Object System.Collections.ArrayList
    $hp = (Get-RepoFacts $RepoRoot).HubPort
    $loc = Test-DiagTcp '127.0.0.1' $hp 2000
    [void]$acc.Add([pscustomobject]@{ Name = '8082 responde en el servidor'; Status = $(if ($loc -eq 'open') { 'PASS' } else { 'FAIL' }); Detail = ('TCP 127.0.0.1:' + $hp + ' = ' + $loc) })
    [void]$acc.Add([pscustomobject]@{ Name = '8082 accesible desde la LAN'; Status = 'EXTERNAL'; Detail = 'requiere un cliente de la LAN (el servidor no puede probar su propio firewall)' })
    $fw = Get-FirewallFacts
    foreach ($port in 3000, 5432, 5678) {
        $allow = @($fw.Rules | Where-Object { (Test-PortMatch $_.LocalPort $port) -and (@($_.LocalPort) -notcontains 'Any') -and $_.Program -eq 'Any' -and ($_.Protocol -eq 'TCP' -or $_.Protocol -eq '6') })
        [void]$acc.Add([pscustomobject]@{ Name = ([string]$port + ' sin regla de entrada LAN'); Status = $(if ($allow.Count -eq 0) { 'PASS' } else { 'FAIL' }); Detail = $(if ($allow.Count -eq 0) { 'sin regla de entrada que lo permita' } else { 'regla permisiva: ' + $allow[0].Name }) })
        [void]$acc.Add([pscustomobject]@{ Name = ([string]$port + ' no accesible desde la LAN'); Status = 'EXTERNAL'; Detail = 'requiere un cliente de la LAN (debe dar timeout)' })
    }
    $health = Get-ApiHealthFacts $hp
    [void]$acc.Add([pscustomobject]@{ Name = 'API -> PostgreSQL'; Status = $(if ($health -and $health.Database -eq 'connected' -and $health.Status -eq 'ok') { 'PASS' } else { 'FAIL' }); Detail = $(if ($health) { '/api/health status=' + $health.Status + ' database=' + $health.Database } else { '/api/health sin respuesta' }) })
    $np = Test-ApiToHostPort $script:N8nPort
    [void]$acc.Add([pscustomobject]@{ Name = 'API -> n8n'; Status = $(if ($np -eq 'open') { 'PASS' } else { 'FAIL' }); Detail = ('API Docker -> host.docker.internal:5678 = ' + $np) })
    $api = Get-ContainerState $script:ApiContainer
    [void]$acc.Add([pscustomobject]@{ Name = 'Docker api healthy'; Status = $(if ($api.State -eq 'running' -and $api.Health -eq 'healthy') { 'PASS' } else { 'FAIL' }); Detail = ($script:ApiContainer + ': ' + $api.State + ' / ' + $api.Health) })
    $web = Get-ContainerState 'daubert-hub-web-1'
    [void]$acc.Add([pscustomobject]@{ Name = 'Docker web running'; Status = $(if ($web.State -eq 'running') { 'PASS' } else { 'FAIL' }); Detail = ('daubert-hub-web-1: ' + $web.State) })
    $n8n = @(Get-N8nMainProcesses)
    [void]$acc.Add([pscustomobject]@{ Name = 'n8n activo (una instancia)'; Status = $(if ($n8n.Count -eq 1) { 'PASS' } else { 'FAIL' }); Detail = ('instancias principales: ' + $n8n.Count) })
    $pg = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue) | Select-Object -First 1
    [void]$acc.Add([pscustomobject]@{ Name = 'PostgreSQL activo'; Status = $(if ($pg -and [string]$pg.Status -eq 'Running') { 'PASS' } else { 'FAIL' }); Detail = $(if ($pg) { $pg.Name + ': ' + $pg.Status } else { 'sin servicio postgresql*' }) })
    $net = Get-NetworkFacts
    $wifi = @($net.Adapters | Where-Object { $_.Kind -eq 'Wi-Fi' -and $_.Status -eq 'Up' })
    [void]$acc.Add([pscustomobject]@{ Name = 'Wi-Fi conectado'; Status = $(if ($wifi.Count -gt 0) { 'PASS' } else { 'FAIL' }); Detail = $(if ($wifi.Count -gt 0) { $wifi[0].Name + ' ' + (@($wifi[0].IPv4) -join ',') } else { 'ningun adaptador Wi-Fi conectado' }) })
    return @($acc)
}

function Invoke-PhaseVerify {
    param([string]$RepoRoot)
    $r = New-PhaseResult 'Verify'
    $checks = @(Get-VerifyChecks $RepoRoot)
    foreach ($ch in $checks) {
        $r.Lines += ('[' + $ch.Status.PadRight(8) + '] ' + $ch.Name + ': ' + $ch.Detail)
        if ($ch.Status -eq 'EXTERNAL') { $r.External += ($ch.Name + ': ' + $ch.Detail) }
    }
    $bad = @($checks | Where-Object { $_.Status -eq 'FAIL' })
    $facts = Get-DiagFacts $RepoRoot ''
    $diag = @(Invoke-DiagEvaluation $facts $RepoRoot)
    $sum = Get-DiagSummary $diag
    $r.Lines += ('Diagnostico completo: ' + $sum.Pass + ' PASS, ' + $sum.Warn + ' WARN, ' + $sum.Fail + ' FAIL -> ' + $sum.Conclusion)
    foreach ($d in @($diag | Where-Object { $_.Status -eq 'FAIL' })) { $r.Lines += ('  FAIL del diagnostico: ' + $d.Area + '/' + $d.Check + ': ' + $d.Detail) }
    if ($bad.Count -gt 0) { Set-PhaseFailure $r ('verificaciones fallidas: ' + (@($bad | ForEach-Object { $_.Name }) -join ', ')); return $r }
    if ($sum.Fail -gt 0) { Set-PhaseFailure $r 'el diagnostico completo todavia reporta FAIL'; return $r }
    return $r
}

function Invoke-ConfigPhase {
    param([string]$Name, [string]$RepoRoot)
    switch ($Name) {
        'Network' { return (Invoke-PhaseNetwork) }
        'N8nNetwork' { return (Invoke-PhaseN8nNetwork) }
        'N8nSupervisor' { return (Invoke-PhaseN8nSupervisor) }
        'Secrets' { return (Invoke-PhaseSecrets $RepoRoot) }
        'Verify' { return (Invoke-PhaseVerify $RepoRoot) }
    }
    throw ('Fase desconocida: ' + $Name)
}

# ================================================================== Output
function Show-ConfigPlan {
    param($Steps, [string]$Title = 'PLAN DE CONFIGURACION DAUBERT HUB SERVER V1 (WhatIf: no se ejecuta ninguna operacion mutante)')
    Write-Host $Title
    $area = ''
    foreach ($s in $Steps) {
        if ($s.Area -ne $area) { $area = $s.Area; Write-Host ''; Write-Host ('== ' + $area + ' ==') }
        Write-Host (Protect-Line ('[' + $s.Action.PadRight(8) + '] ' + $s.Target + ': ' + $s.Detail))
        if ($s.Command) { Write-Host (Protect-Line ('             comando previsto (no ejecutado): ' + $s.Command)) }
    }
    $change = @($Steps | Where-Object { $_.WouldChange }).Count
    $decisions = @($Steps | Where-Object { $_.Action -eq 'DECISION' }).Count
    Write-Host ''
    Write-Host ('Resumen del plan: ' + $change + ' cambio(s) que una ejecucion real haria, ' + $decisions + ' decision(es) pendiente(s), 0 operaciones ejecutadas.')
    Write-Host 'WHATIF: no se modifico nada (firewall, n8n, ACL, energia, Docker, router y PROD intactos).'
}

function Show-PhaseResult {
    param($Result)
    Write-Host ''
    Write-Host ('--- Fase ' + $Result.Name + ' ---')
    foreach ($l in $Result.Lines) { Write-Host (Protect-Line $l) }
    if (@($Result.Changed).Count -gt 0) { Write-Host (Protect-Line ('Cambios realizados: ' + (@($Result.Changed) -join '; '))) }
    foreach ($e in @($Result.External)) { Write-Host (Protect-Line ('PENDIENTE DE VERIFICACION EXTERNA: ' + $e)) }
    Write-Host ('Fase ' + $Result.Name + ': ' + $(if ($Result.Ok) { 'OK' } else { 'FALLIDA' }))
}

function Show-ConfigUsage {
    Write-Host 'Uso: Configure-DaubertServer.ps1 -WhatIf [-Phase <fases>] [-RepoPath <ruta>]'
    Write-Host '     Configure-DaubertServer.ps1 -Apply -Phase <fases> [-RepoPath <ruta>]'
    Write-Host 'Fases: 1|Network  2|N8nNetwork  3|N8nSupervisor  4|Secrets  5|Verify  All   (una o varias, se ejecutan en orden)'
    Write-Host '  -WhatIf  Lee el equipo (solo lectura) y muestra el plan completo o el de las fases elegidas; no modifica nada.'
    Write-Host ('  -Apply   Aplica SOLO las fases elegidas; requiere -Phase explicita, sesion elevada en 1/2/3 y escribir: ' + $script:ConfirmationPhrase)
    Write-Host 'Se detiene en la primera fase que falla; no hay rollback automatico. Sin modo no se hace nada.'
}

function Invoke-ConfigMain {
    param([bool]$DoWhatIf, [bool]$DoApply, [string[]]$PhaseArg, [string]$RepoPathArg, [string[]]$Unknown)
    $extra = @()
    if ($Unknown) { $extra = @($Unknown | Where-Object { $_ }) }
    if ($extra.Count -gt 0) { Write-Host ('Error: argumentos no soportados: ' + ($extra -join ' ')); Show-ConfigUsage; return $script:ExitConfigUsage }
    if ($DoWhatIf -and $DoApply) { Write-Host 'Error: -WhatIf y -Apply son mutuamente excluyentes. No se hizo nada.'; return $script:ExitConfigUsage }
    $phases = @()
    $phaseGiven = $false
    if ($PhaseArg) { $phaseGiven = (@($PhaseArg | Where-Object { $_ }).Count -gt 0) }
    if ($phaseGiven) {
        $phases = ConvertTo-PhaseList $PhaseArg
        if ($null -eq $phases) { Write-Host ('Error: fase no valida: ' + (@($PhaseArg) -join ',')); Show-ConfigUsage; return $script:ExitConfigUsage }
    }
    if (-not $DoWhatIf -and -not $DoApply) {
        Show-ConfigUsage
        if ($phaseGiven) { Write-Host 'Error: -Phase requiere -WhatIf o -Apply.'; return $script:ExitConfigUsage }
        return $script:ExitOk
    }
    if ($DoApply -and @($phases).Count -eq 0) { Write-Host 'Error: -Apply requiere -Phase explicita (1..5, nombres o All). No se hizo nada.'; return $script:ExitConfigUsage }
    $root = $script:DefaultRepoRoot
    if ($RepoPathArg) {
        if (-not (Test-Path -LiteralPath $RepoPathArg -PathType Container)) { Write-Host ('Error: -RepoPath no existe: ' + $RepoPathArg); Show-ConfigUsage; return $script:ExitConfigUsage }
        $root = [System.IO.Path]::GetFullPath($RepoPathArg)
    }

    if ($DoWhatIf) {
        $script:Mode = 'WhatIf'
        $facts = Get-ConfigFacts $root
        $steps = @(New-ConfigPlan $facts @($phases))
        $title = 'PLAN DE CONFIGURACION DAUBERT HUB SERVER V1 (WhatIf: no se ejecuta ninguna operacion mutante)'
        if (@($phases).Count -gt 0) { $title = 'PLAN DE LAS FASES ' + (@($phases) -join ', ') + ' (WhatIf: no se ejecuta ninguna operacion mutante)' }
        Show-ConfigPlan $steps $title
        return $script:ExitOk
    }

    # ---- Apply
    $needsAdmin = @($phases | Where-Object { $script:ElevatedPhases -contains $_ })
    if ($needsAdmin.Count -gt 0 -and -not (Test-ConfigElevated)) {
        Write-Host ('BLOQUEADO: las fases ' + ($needsAdmin -join ', ') + ' requieren una sesion elevada (administrador). No se cambio nada.')
        return $script:ExitBlocked
    }
    Write-Host ('Fases a aplicar, en orden: ' + (@($phases) -join ' -> '))
    Write-Host 'Se detiene en la primera fase que falle; no hay rollback automatico.'
    $answer = Read-ConfigConfirmation
    if ($answer -cne $script:ConfirmationPhrase) { Write-Host 'Confirmacion incorrecta: configuracion cancelada. No se cambio nada.'; return $script:ExitBlocked }
    $script:Mode = 'Apply'
    $external = @()
    try {
        for ($i = 0; $i -lt @($phases).Count; $i++) {
            $name = @($phases)[$i]
            $result = $null
            try { $result = Invoke-ConfigPhase $name $root }
            catch { $result = New-PhaseResult $name; Set-PhaseFailure $result ('error inesperado: ' + $_.Exception.Message.Split("`n")[0]) }
            Show-PhaseResult $result
            $external += @($result.External)
            if (-not $result.Ok) {
                $pending = @($phases | Select-Object -Skip ($i + 1))
                $blocked = ($result.Blocked -and @($result.Changed).Count -eq 0)
                Write-Host ''
                Write-Host ($(if ($blocked) { 'CONFIGURACION BLOQUEADA' } else { 'CONFIGURATION FAILED' }) + ' en la fase ' + $name + ': ' + $result.Failure)
                if ($pending.Count -gt 0) { Write-Host ('Fases NO ejecutadas: ' + ($pending -join ', ')) }
                Write-Host 'No se hizo rollback automatico de ningun cambio.'
                if ($blocked) { return $script:ExitBlocked }
                return $script:ExitFailed
            }
        }
    } finally { $script:Mode = 'WhatIf' }
    Write-Host ''
    Write-Host ('CONFIGURACION CORRECTA: fases ' + (@($phases) -join ', ') + '.')
    if ($external.Count -gt 0) { Write-Host ('Quedan ' + $external.Count + ' verificacion(es) EXTERNA(S) desde un cliente de la LAN (no comprobables desde el servidor).') }
    return $script:ExitOk
}

# Dot-sourcing (tests) only defines the functions above.
if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-ConfigMain $script:CfgWhatIf $script:CfgApply $script:CfgPhase $script:CfgRepoPath $script:CfgUnknown)
}
