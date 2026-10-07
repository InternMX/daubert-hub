# Pester 3.4 tests for scripts\server\Start-DaubertN8nSupervisor.ps1 (pure logic only: nothing is started)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = [System.IO.Path]::GetFullPath((Join-Path $here '..\Start-DaubertN8nSupervisor.ps1'))
. $scriptPath

Describe 'Supervisor logic' {
    It 'back-off grows 15,30,60,120,240 and is capped at 300 seconds' {
        (1..7 | ForEach-Object { Get-BackoffSeconds $_ }) -join ',' | Should Be '15,30,60,120,240,300,300'
        (Get-BackoffSeconds 0) | Should Be 15
    }
    It 'recognises only the n8n main process, not its task runner or other node processes' {
        (Test-N8nMainCommandLine '"C:\Program Files\nodejs\node.exe" C:\Users\x\AppData\Roaming\npm/node_modules/n8n/bin/n8n ') | Should Be $true
        (Test-N8nMainCommandLine '"node.exe" "C:\Users\x\AppData\Roaming\npm\node_modules\n8n\bin\n8n"') | Should Be $true
        (Test-N8nMainCommandLine 'node --disallow-code-generation-from-strings C:\Users\x\AppData\Roaming\npm\node_modules\n8n\node_modules\@n8n\task-runner\dist\start.js') | Should Be $false
        (Test-N8nMainCommandLine 'node C:\app\server.js') | Should Be $false
        (Test-N8nMainCommandLine '') | Should Be $false
    }
    It 'uses a global mutex and a single log file; it parses without errors' {
        $script:MutexName | Should Match '^Global\\DaubertHub-N8nSupervisor$'
        $tokens = $null; $errs = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errs)
        @($errs).Count | Should Be 0
    }
    It 'does not touch workflows, credentials, Winlogon, firewall or compose' {
        $code = ((Get-Content -LiteralPath $scriptPath -Raw) -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
        $code | Should Not Match '(?i)Winlogon|AutoAdminLogon|DefaultPassword|NetFirewall|docker\s+compose|n8n\s+(import|export)|\.n8n[\\/]config|encryptionKey|credentials?\s*='
    }
    It 'it only stops a process it started itself (the new one), never an adopted instance' {
        $text = Get-Content -LiteralPath $scriptPath -Raw
        ([regex]::Matches($text, 'Stop-Process')).Count | Should Be 1
        $text | Should Match 'Stop-Process -Id \$p\.Id'
    }
}

Describe 'Docker / node start-up resilience' {
    BeforeEach {
        $script:DependencyWaitSeconds = 30
        $script:NodeWaitSeconds = 30
        Mock Start-Sleep { }
        Mock Write-SupervisorLog { }
        $script:clock = [datetime]'2026-01-01T00:00:00'
        Mock Get-Date { $script:clock = $script:clock.AddSeconds(5); $script:clock }
    }
    It 'waits while docker.exe does not exist yet and succeeds when it appears' {
        $script:n = 0
        Mock Get-DockerPath { $script:n++; if ($script:n -ge 3) { 'C:\fake\docker.exe' } else { $null } }
        Mock Invoke-DockerInfo { 0 }
        (Wait-DockerReady 120) | Should Be $true
        Assert-MockCalled Write-SupervisorLog -ParameterFilter { $Message -like 'Esperando Docker CLI*' } -Exactly 1 -Scope It
    }
    It 'waits while the CLI exists but the daemon is down, then succeeds' {
        $script:n = 0
        Mock Get-DockerPath { 'C:\fake\docker.exe' }
        Mock Invoke-DockerInfo { $script:n++; if ($script:n -ge 3) { 0 } else { 1 } }
        (Wait-DockerReady 120) | Should Be $true
        Assert-MockCalled Write-SupervisorLog -ParameterFilter { $Message -like 'Docker CLI encontrado pero*' } -Exactly 1 -Scope It
    }
    It 'returns false (no throw) when docker.exe never appears' {
        Mock Get-DockerPath { $null }
        Mock Invoke-DockerInfo { 0 }
        (Wait-DockerReady 30) | Should Be $false
        Assert-MockCalled Invoke-DockerInfo -Exactly 0 -Scope It
    }
    It 'returns false when the daemon never answers' {
        Mock Get-DockerPath { 'C:\fake\docker.exe' }
        Mock Invoke-DockerInfo { 1 }
        (Wait-DockerReady 30) | Should Be $false
    }
    It 'Wait-Until treats a throwing condition as not-yet and retries' {
        $script:n = 0
        (Wait-Until { $script:n++; if ($script:n -lt 3) { throw 'boom' } $true } 60 1) | Should Be $true
        (Wait-Until { throw 'always' } 10 1) | Should Be $false
    }
    It 'Wait-Dependencies keeps the old behaviour when Docker and Dropbox are already up' {
        Mock Wait-DockerReady { $true }
        Mock Get-Process { [pscustomobject]@{ Name = 'Dropbox' } }
        { Wait-Dependencies } | Should Not Throw
        Assert-MockCalled Write-SupervisorLog -ParameterFilter { $Message -eq 'Docker daemon disponible: True' } -Exactly 1 -Scope It
        Assert-MockCalled Write-SupervisorLog -ParameterFilter { $Message -eq 'Dropbox en ejecucion: True' } -Exactly 1 -Scope It
    }
    It 'Wait-Dependencies does not throw when Docker and Dropbox never come up' {
        Mock Wait-DockerReady { $false }
        Mock Get-Process { $null }
        { Wait-Dependencies } | Should Not Throw
        Assert-MockCalled Write-SupervisorLog -ParameterFilter { $Message -eq 'Docker daemon disponible: False' } -Exactly 1 -Scope It
    }
    It 'Get-N8nLaunch waits for node.exe to become resolvable' {
        $script:n = 0
        Mock Get-Command { $script:n++; if ($script:n -ge 3) { [pscustomobject]@{ Source = 'C:\node\node.exe' } } else { $null } } -ParameterFilter { $Name -eq 'node.exe' }
        Mock Test-Path { $true }
        (Get-N8nLaunch).Node | Should Be 'C:\node\node.exe'
    }
    It 'Get-N8nLaunch throws a controlled error (caught by the loop) if node.exe never appears' {
        Mock Get-Command { $null } -ParameterFilter { $Name -eq 'node.exe' }
        { Get-N8nLaunch } | Should Throw 'node.exe'
    }
}

Describe 'Docker path resolution' {
    It 'Invoke-DockerInfo never throws, even under ErrorActionPreference Stop with stderr output or a missing exe' {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Stop'
        try {
            { Invoke-DockerInfo 'C:\does\not\exist\docker.exe' } | Should Not Throw
            (Invoke-DockerInfo 'C:\does\not\exist\docker.exe') | Should Be -1
            (Invoke-DockerInfo "$env:SystemRoot\System32\whoami.exe") | Should Not Be -1
        } finally { $ErrorActionPreference = $old }
    }
    It 'resolves docker through Get-Command when present' {
        Mock Get-Command { [pscustomobject]@{ Source = 'C:\from\path\docker.exe' } } -ParameterFilter { $Name -eq 'docker.exe' }
        (Get-DockerPath) | Should Be 'C:\from\path\docker.exe'
    }
    It 'falls back to LOCALAPPDATA when Get-Command finds nothing' {
        $old = $env:LOCALAPPDATA
        try {
            $env:LOCALAPPDATA = 'C:\Fake\Local'
            Mock Get-Command { $null } -ParameterFilter { $Name -eq 'docker.exe' }
            Mock Test-Path { $true }
            (Get-DockerPath) | Should Be 'C:\Fake\Local\Programs\DockerDesktop\resources\bin\docker.exe'
            Mock Test-Path { $false }
            (Get-DockerPath) | Should BeNullOrEmpty
        } finally { $env:LOCALAPPDATA = $old }
    }
}
