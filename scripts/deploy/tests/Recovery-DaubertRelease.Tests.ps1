# Exercises the ACTUAL documented rollback block against an in-memory Docker store.
# The docker function fails closed outside its mock: no native Docker can be invoked.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '..\Deploy-DaubertHub.ps1')
$script:ChecklistPath = Join-Path $script:RepoRoot 'docs\operations\deployment-checklist.md'

function docker {
    throw 'Docker externo prohibido en las pruebas de recuperacion.'
}

function Invoke-DocumentedRecovery {
    $text = Get-Content -LiteralPath $script:ChecklistPath -Raw
    if ($text -notmatch '(?s)\*\*Rollback del Hub\*\*.*?```powershell\r?\n(.*?)```') { throw 'No se encontro el procedimiento de rollback.' }
    # Only replace operator inputs, never the commands under test.
    $body = $Matches[1] -replace '(?m)^\$(prev|new|rollbackDigests)\s*=.*\r?\n', ''
    $prev = 'bbbbbbb'; $new = 'aaaaaaa'
    $rollbackDigests = $script:Recovery.Expected
    $cf = Get-ComposeBaseArgs
    & ([scriptblock]::Create($body))
}

function Invoke-RecoveryDocker {
    param([string[]]$NativeArgs)
    $s = $script:Recovery
    $s.Calls += ,@($NativeArgs)
    $global:LASTEXITCODE = 0
    if ($NativeArgs[0] -eq 'image' -and $NativeArgs[1] -eq 'inspect') {
        $ref = $NativeArgs[2]
        if (-not $s.Tags.ContainsKey($ref)) { $global:LASTEXITCODE = 1; return }
        return $s.Tags[$ref]
    }
    if ($NativeArgs.Count -eq 3 -and $NativeArgs[0] -eq 'tag') {
        if ($NativeArgs[2] -eq $s.FailTarget -or -not $s.Tags.ContainsKey($NativeArgs[1])) { $global:LASTEXITCODE = 1; return }
        $s.Tags[$NativeArgs[2]] = $s.Tags[$NativeArgs[1]]
        return
    }
    $expected = @('compose') + (Get-ComposeBaseArgs) + @('up', '-d', '--no-build', 'api', 'web')
    if (($NativeArgs -join ' ') -ceq ($expected -join ' ')) {
        if ($s.ComposeFails) { $global:LASTEXITCODE = 1; return }
        foreach ($svc in @('api', 'web')) { $s.Running[$svc] = $s.Tags['daubert-hub-' + $svc + ':latest'] }
        return
    }
    throw 'Comando fuera del rollback de api/web permitido en el simulador.'
}

Describe 'Recuperacion operativa: rollback documental sin servicios reales' {
    BeforeEach {
        $script:Recovery = @{
            Expected = @{ api = ('sha256:' + ('1' * 64)); web = ('sha256:' + ('2' * 64)) }
            Tags = @{}; Running = @{}; Calls = @(); FailTarget = ''; ComposeFails = $false
        }
        foreach ($svc in @('api', 'web')) {
            $script:Recovery.Tags['daubert-hub-' + $svc + ':rollback-bbbbbbb'] = $script:Recovery.Expected[$svc]
            $script:Recovery.Tags['daubert-hub-' + $svc + ':latest'] = 'sha256:' + ('3' * 64)
            $script:Recovery.Running[$svc] = 'sha256:' + ('3' * 64)
        }
        Mock docker { Invoke-RecoveryDocker $args }
        Mock Invoke-RestMethod { [pscustomobject]@{ status = 'ok'; database = 'connected'; environment = 'PRODUCTION'; commit = 'bbbbbbb' } }
        Mock Write-Host { }
    }

    It 'recupera una recreacion parcial, conserva imagenes fallidas y solo recrea api/web sin build' {
        $script:Recovery.Running.web = $script:Recovery.Expected.web
        Invoke-DocumentedRecovery
        foreach ($svc in @('api', 'web')) {
            $script:Recovery.Running[$svc] | Should Be $script:Recovery.Expected[$svc]
            $script:Recovery.Tags['daubert-hub-' + $svc + ':failed-aaaaaaa'] | Should Be ('sha256:' + ('3' * 64))
            $script:Recovery.Tags['daubert-hub-' + $svc + ':rollback-bbbbbbb'] | Should Be $script:Recovery.Expected[$svc]
        }
        @($script:Recovery.Calls | Where-Object { $_[0] -eq 'compose' }).Count | Should Be 1
    }
    It 'sin una de las dos anclas no toca etiquetas ni contenedores' {
        $script:Recovery.Tags.Remove('daubert-hub-web:rollback-bbbbbbb')
        { Invoke-DocumentedRecovery } | Should Throw
        @($script:Recovery.Calls | Where-Object { $_[0] -in @('tag', 'compose') }).Count | Should Be 0
    }
    It 'con ancla alterada respecto a la evidencia previa bloquea antes de mutar' {
        $script:Recovery.Tags['daubert-hub-web:rollback-bbbbbbb'] = 'sha256:' + ('9' * 64)
        { Invoke-DocumentedRecovery } | Should Throw
        @($script:Recovery.Calls | Where-Object { $_[0] -in @('tag', 'compose') }).Count | Should Be 0
    }
    It 'no sobrescribe etiquetas failed existentes' {
        $script:Recovery.Tags['daubert-hub-api:failed-aaaaaaa'] = 'sha256:' + ('9' * 64)
        { Invoke-DocumentedRecovery } | Should Throw
        @($script:Recovery.Calls | Where-Object { $_[0] -in @('tag', 'compose') }).Count | Should Be 0
    }
    It 'si falla preservar una imagen fallida se detiene sin compose' {
        $script:Recovery.FailTarget = 'daubert-hub-api:failed-aaaaaaa'
        { Invoke-DocumentedRecovery } | Should Throw
        @($script:Recovery.Calls | Where-Object { $_[0] -eq 'compose' }).Count | Should Be 0
    }
    It 'si falla devolver un ancla a latest se detiene sin compose' {
        $script:Recovery.FailTarget = 'daubert-hub-web:latest'
        { Invoke-DocumentedRecovery } | Should Throw
        @($script:Recovery.Calls | Where-Object { $_[0] -eq 'compose' }).Count | Should Be 0
    }
    It 'compose fallido no se declara recuperacion correcta' {
        $script:Recovery.ComposeFails = $true
        { Invoke-DocumentedRecovery } | Should Throw
    }
    It 'un health que no vuelve al commit anterior no se declara recuperacion correcta' {
        Mock Invoke-RestMethod { [pscustomobject]@{ status = 'ok'; database = 'connected'; environment = 'PRODUCTION'; commit = 'aaaaaaa' } }
        { Invoke-DocumentedRecovery } | Should Throw
    }
    It 'todos los comandos registrados estan limitados a imagenes Hub y compose api/web' {
        Invoke-DocumentedRecovery
        foreach ($call in $script:Recovery.Calls) {
            ($call -join ' ') | Should Not Match '(?i)\b(down|prune|remove-orphans|postgres|psql|n8n)\b'
            if ($call[0] -eq 'tag') {
                $call[1] | Should Match '^daubert-hub-(api|web):'
                $call[2] | Should Match '^daubert-hub-(api|web):'
            }
        }
    }
}
