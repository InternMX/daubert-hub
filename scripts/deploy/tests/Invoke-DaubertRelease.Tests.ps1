# Pester 3.4 / Windows PowerShell 5.1. No operaciones externas reales.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$releasePath = [IO.Path]::GetFullPath((Join-Path $here '..\Invoke-DaubertRelease.ps1'))
. $releasePath -Plan -ExpectedCommit ('a' * 40)

Describe 'Fase 2A: contrato y resumen seguro' {
    BeforeEach {
        $script:Approved = 'a' * 40
        $script:ReleaseHead = $script:Approved
        $script:ReleaseCode = 0
        $script:ReleaseOutput = @('Resumen: 21 PASS, 2 WARN, 0 FAIL', 'Commit actual en PROD : abc1234')
        $script:ReleasePrinted = @()
        Mock Write-Host { $script:ReleasePrinted += [string]$Object }
        Mock Invoke-ReleaseRead {
            if ($Operation -eq 'Head') { return @{ Code = 0; Out = @($script:ReleaseHead) } }
            return @{ Code = $script:ReleaseCode; Out = $script:ReleaseOutput }
        }
    }

    It 'acepta SHA completo, resume preflight y estado, y delega una sola simulacion' {
        (Invoke-ReleaseMain $true $script:Approved.ToUpperInvariant()) | Should Be 0
        ($script:ReleasePrinted -join '|') | Should Match 'APTO: preflight y simulacion'
        ($script:ReleasePrinted -join '|') | Should Match '21 correctos, 2 advertencias, 0 fallos'
        ($script:ReleasePrinted -join '|') | Should Match 'Hub: abc1234'
        Assert-MockCalled Invoke-ReleaseRead -Scope It -Times 1 -Exactly -ParameterFilter { $Operation -eq 'Simulation' -and $Commit -eq $script:Approved }
        Assert-MockCalled Invoke-ReleaseRead -Scope It -Times 2 -Exactly -ParameterFilter { $Operation -eq 'Head' }
    }

    It 'rechaza sin operaciones las referencias, SHA cortos, espacios e inyecciones' {
        foreach ($invalid in @('', 'HEAD', 'main', 'abc1234', ('a' * 39), ('a' * 41), ('g' * 40), (('a' * 40) + "`n"), '--output=secret', 'token=ficcion')) {
            (Invoke-ReleaseMain $true $invalid) | Should Be 3
        }
        (Invoke-ReleaseMain $false $script:Approved) | Should Be 3
        Assert-MockCalled Invoke-ReleaseRead -Scope It -Times 0 -Exactly
        ($script:ReleasePrinted -join '|') | Should Not Match 'token=ficcion'
    }

    It 'bloquea otro commit y no consulta el Hub' {
        $script:ReleaseHead = 'b' * 40
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
        Assert-MockCalled Invoke-ReleaseRead -Scope It -Times 0 -Exactly -ParameterFilter { $Operation -eq 'Simulation' }
    }

    It 'bloquea lecturas de HEAD fallidas o ambiguas' {
        Mock Invoke-ReleaseRead { @{ Code = 1; Out = @() } }
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
        Mock Invoke-ReleaseRead { @{ Code = 0; Out = @($script:Approved, $script:Approved) } }
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
    }

    It 'detecta que HEAD cambio durante la simulacion' {
        Mock Invoke-ReleaseRead {
            if ($Operation -eq 'Head') { return @{ Code = 0; Out = @($script:ReleaseHead) } }
            $script:ReleaseHead = 'b' * 40
            return @{ Code = 0; Out = @() }
        }
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
        ($script:ReleasePrinted -join '|') | Should Match 'HEAD cambio'
    }

    It 'distingue ausencia de cambios de una validacion apta' {
        $script:ReleaseCode = 2
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 2
        ($script:ReleasePrinted -join '|') | Should Match 'SIN CAMBIOS DE HUB/DOCKER'
    }

    It 'normaliza fallos conocidos y codigos inesperados como bloqueo' {
        foreach ($code in @(1, 3, 5, -1, 99)) {
            $script:ReleaseCode = $code
            (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
        }
    }

    It 'no revela salida cruda ni excepciones, incluso secretos sin nombre' {
        $script:ReleaseOutput += @('secreto-ficticio-sin-etiqueta', 'password=ficcion', 'https://user:ficcion@example.invalid', 'Commit actual en PROD : abc1234 token=ficcion')
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 0
        Mock Invoke-ReleaseRead { throw 'secreto-ficticio-sin-etiqueta' }
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
        ($script:ReleasePrinted -join '|') | Should Not Match 'ficcion|secreto-ficticio|example.invalid'
    }

    It 'declara ambos parametros obligatorios y no ofrece Deploy ni Rollback' {
        $command = Get-Command $releasePath
        foreach ($name in @('Plan', 'ExpectedCommit')) {
            @($command.Parameters[$name].Attributes | Where-Object { $_ -is [Management.Automation.ParameterAttribute] -and $_.Mandatory }).Count | Should Be 1
        }
        $command.Parameters.ContainsKey('Deploy') | Should Be $false
        $command.Parameters.ContainsKey('Rollback') | Should Be $false
    }
}

# Integracion con el flujo y las compuertas reales de Deploy; hechos y procesos simulados.
. (Join-Path $here '..\Deploy-DaubertHub.ps1')
Describe 'Fase 2A: reutiliza WhatIf sin mutaciones' {
    BeforeEach {
        $script:Approved = 'a' * 40
        $script:PreflightResult = 0
        $script:ReleasePrinted = @()
        $services = @{}
        foreach ($svc in @('api', 'web')) {
            $services[$svc] = [pscustomobject]@{
                Image = ('daubert-hub-' + $svc + ':latest'); RunningDigest = 'sha256:abc'; TagDigest = 'sha256:abc'
                Anchor = ('daubert-hub-' + $svc + ':rollback-abc1234'); AnchorExists = $false; AnchorDigest = ''
            }
        }
        $script:ReleaseContext = [pscustomobject]@{
            CandidateFull = $script:Approved; HeadFull = $script:Approved; HeadShort = 'aaaaaaa'; Dirty = @()
            AppVersion = '1.0.0'; Closure = @{ ConfExists = $true; ConfSha = 'aa'; PolicySha = 'aa' }
            Health = [pscustomobject]@{ status = 'ok'; database = 'connected'; environment = 'PRODUCTION' }
            PreviousCommit = 'abc1234'; DeltaKnown = $true; HubDockerFiles = @('apps/api/src/index.ts')
            MigrationFiles = @(); N8nFiles = @(); ComposeImages = @('daubert-hub-api', 'daubert-hub-web')
            Services = $services; HealthUrl = 'http://localhost:8082/api/health'
        }
        Mock Write-Host { $script:ReleasePrinted += [string]$Object }
        Mock Get-DeployContext { $script:ReleaseContext }
        Mock Invoke-DeployRead {
            if ($Exe -ne 'powershell') { throw 'Proceso inesperado' }
            return @{ Code = $script:PreflightResult; Out = @('preflight simulado') }
        }
        Mock Invoke-DeployMutation { throw 'Mutacion prohibida' }
        Mock Invoke-DeployHttp { throw 'HTTP real prohibido' }
        Mock Read-DeployConfirmation { throw 'Confirmacion prohibida' }
        Mock Invoke-ReleaseRead {
            if ($Operation -eq 'Head') { return @{ Code = 0; Out = @($script:Approved) } }
            $code = Invoke-DeployMain $false $true $false $Commit 0
            return @{ Code = $code; Out = @() }
        }
    }
    AfterEach {
        Assert-MockCalled Invoke-DeployMutation -Scope It -Times 0 -Exactly
        Assert-MockCalled Invoke-DeployHttp -Scope It -Times 0 -Exactly
        Assert-MockCalled Read-DeployConfirmation -Scope It -Times 0 -Exactly
    }

    It 'recorre preflight, contexto, gate y plan existentes en WhatIf' {
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 0
        $script:Mode | Should Be 'WhatIf'
        Assert-MockCalled Get-DeployContext -Scope It -Times 1 -Exactly -ParameterFilter { $Candidate -eq $script:Approved }
        Assert-MockCalled Invoke-DeployRead -Scope It -Times 1 -Exactly -ParameterFilter { $Exe -eq 'powershell' -and $CmdArgs[-1] -eq $script:Approved }
    }
    It 'un preflight bloqueado (rama, limpieza o sincronizacion) detiene el flujo' {
        $script:PreflightResult = 1
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
        Assert-MockCalled Get-DeployContext -Scope It -Times 0 -Exactly
    }
    It 'preflight sin cambios termina sin calcular un plan' {
        $script:PreflightResult = 2
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 2
        Assert-MockCalled Get-DeployContext -Scope It -Times 0 -Exactly
    }
    It 'el gate compartido bloquea un repositorio sucio' {
        $script:ReleaseContext.Dirty = @('?? archivo-local')
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
        ($script:ReleasePrinted -join '|') | Should Match 'arbol de trabajo no esta limpio'
    }
    It 'el gate compartido bloquea un candidato incorrecto o un Hub sin salud' {
        $script:ReleaseContext.CandidateFull = 'b' * 40
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
        $script:ReleaseContext.CandidateFull = $script:Approved
        $script:ReleaseContext.Health = $null
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
    }
    It 'el delta compartido sin cambios no recomienda desplegar' {
        $script:ReleaseContext.HubDockerFiles = @()
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 2
    }
    It 'no concede excepciones para migraciones o n8n' {
        $script:ReleaseContext.MigrationFiles = @('database/migracion.sql')
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
        $script:ReleaseContext.MigrationFiles = @()
        $script:ReleaseContext.N8nFiles = @('n8n/workflow.json')
        (Invoke-ReleaseMain $true $script:Approved) | Should Be 1
    }
}

Describe 'Fase 2A: frontera externa' {
    It 'rechaza operaciones desconocidas y candidatos invalidos antes de ejecutar procesos' {
        { Invoke-ReleaseRead 'Deploy' ('a' * 40) } | Should Throw
        { Invoke-ReleaseRead 'Simulation' '--help' } | Should Throw
    }
    It 'solo invoca Git de lectura y el script fijo en WhatIf, sin archivos de salida' {
        $text = Get-Content -LiteralPath $releasePath -Raw
        $text | Should Match ([regex]::Escape("'--no-optional-locks', '-C', " + '$script:ReleaseRoot' + ", 'rev-parse', '--verify', 'HEAD^{commit}'"))
        $text | Should Match ([regex]::Escape("'-WhatIf', '-Candidate', " + '$Commit'))
        $text | Should Not Match '(?i)\b(Start-Process|Set-Content|Out-File|New-Item|Start-Service|Restart-Service|Invoke-Sqlcmd|Start-Transcript)\b'
    }
}
