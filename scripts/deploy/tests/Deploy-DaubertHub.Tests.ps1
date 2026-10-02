# Pester 3.4 tests for scripts\deploy\Deploy-DaubertHub.ps1
#
# Run with:  Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\deploy\tests
#
# These tests NEVER run a deployment: every external process goes through the script's two
# seams (Invoke-DeployRead / Invoke-DeployMutation), which are mocked here, and the real seams
# are only exercised with arguments that are refused BEFORE anything is executed.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = [System.IO.Path]::GetFullPath((Join-Path $here '..\Deploy-DaubertHub.ps1'))
. $scriptPath

$script:RealVersion = (Get-Content -LiteralPath (Join-Path $script:RepoRoot 'package.json') -Raw | ConvertFrom-Json).version
$script:Head = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
$script:HeadShort = 'a1b2c3d'
$script:Prev = 'fbda7c6'
$script:Printed = @()
$script:Mutations = @()
$script:Fake = $null

function New-Fake {
    return @{
        PreflightCode   = 0
        HeadFull        = $script:Head
        CandidateFull   = $script:Head
        HeadShort       = $script:HeadShort
        Dirty           = @()
        Files           = @('apps/web/src/App.tsx', 'docs/operations/README.md')
        Images          = @('daubert-hub-web', 'daubert-hub-api')
        HealthStatus    = 'ok'
        HealthDatabase  = 'connected'
        HealthEnv       = 'PRODUCTION'
        HealthVersion   = $script:RealVersion
        HealthCommit    = $script:Prev
        Running         = @{ api = 'sha256:aaaaaaaaaaaaaaaa'; web = 'sha256:bbbbbbbbbbbbbbbb' }
        Tags            = @{ 'daubert-hub-api:latest' = 'sha256:aaaaaaaaaaaaaaaa'; 'daubert-hub-web:latest' = 'sha256:bbbbbbbbbbbbbbbb' }
        TagNoOp         = $false
        UpFails         = $false
        UpUpdatesHealth = $true
        UpEnv           = $null
        PsLines         = @('NAME   STATUS', 'daubert-hub-api-1   Up (healthy)', 'daubert-hub-web-1   Up')
        Confirmation    = 'DEPLOY DAUBERT HUB'
        ApiHealth       = 'healthy'
        State           = 'running'
    }
}

function Get-FakeRead {
    param([string]$Exe, [string[]]$CmdArgs)
    $f = $script:Fake
    $line = $Exe + ' ' + ($CmdArgs -join ' ')
    if ($Exe -eq 'powershell') { return @{ Code = $f.PreflightCode; Out = @('(salida simulada del preflight)') } }
    if ($line -match 'rev-parse --short HEAD') { return @{ Code = 0; Out = @($f.HeadShort) } }
    if ($line -match 'rev-parse (\S+)$') {
        if ($Matches[1] -eq 'HEAD') { return @{ Code = 0; Out = @($f.HeadFull) } }
        return @{ Code = 0; Out = @($f.CandidateFull) }
    }
    if ($line -match 'status --short') { return @{ Code = 0; Out = @($f.Dirty) } }
    if ($line -match 'cat-file -e') { return @{ Code = 0; Out = @() } }
    if ($line -match 'diff --name-only') { return @{ Code = 0; Out = @($f.Files) } }
    if ($line -match 'config --images') { return @{ Code = 0; Out = @($f.Images) } }
    if ($line -match ' ps$') { return @{ Code = 0; Out = @($f.PsLines) } }
    if ($line -match 'inspect daubert-hub-(api|web)-1 --format \{\{if \.ImageManifestDescriptor') { return @{ Code = 0; Out = @($f.Running[$Matches[1]]) } }
    if ($line -match 'inspect daubert-hub-api-1 --format \{\{\.State\.Health\.Status') { return @{ Code = 0; Out = @($f.ApiHealth) } }
    if ($line -match 'inspect daubert-hub-(api|web)-1 --format \{\{\.State\.Status') { return @{ Code = 0; Out = @($f.State) } }
    if ($line -match 'image inspect (\S+) --platform') {
        if ($f.Tags.ContainsKey($Matches[1])) { return @{ Code = 0; Out = @($f.Tags[$Matches[1]]) } }
        return @{ Code = 1; Out = @() }
    }
    if ($line -match 'image inspect (\S+) --format') {
        if ($f.Tags.ContainsKey($Matches[1])) { return @{ Code = 0; Out = @($f.Tags[$Matches[1]]) } }
        return @{ Code = 1; Out = @() }
    }
    throw ('Lectura no simulada en la prueba: ' + $line)
}

function Get-FakeHttp {
    param([string]$Url)
    $f = $script:Fake
    if ($Url -match '/api/health$') {
        $json = '{"status":"' + $f.HealthStatus + '","database":"' + $f.HealthDatabase + '","environment":"' + $f.HealthEnv + '","version":"' + $f.HealthVersion + '","commit":"' + $f.HealthCommit + '"}'
        return @{ Status = 200; Content = $json }
    }
    return @{ Status = 200; Content = '<html></html>' }
}

function Invoke-Main {
    param([bool]$P = $false, [bool]$W = $false, [bool]$D = $false, [string]$C = 'HEAD', [int]$T = 0)
    $script:Printed = @()
    $script:Mutations = @()
    $result = @(Invoke-DeployMain $P $W $D $C $T)
    return $result[-1]
}

function Set-StandardMocks {
    Mock Invoke-DeployRead { Get-FakeRead $Exe $CmdArgs }
    Mock Invoke-DeployHttp { Get-FakeHttp $Url }
    Mock Read-HubPort { '8082' }
    Mock Start-DeploySleep { }
    Mock Read-DeployConfirmation { $script:Fake.Confirmation }
    Mock Write-Host { $script:Printed += [string]$Object }
    Mock Invoke-DeployMutation {
        $f = $script:Fake
        $script:Mutations += , @{ Exe = $Exe; Args = @($CmdArgs) }
        if ($CmdArgs[0] -eq 'tag') {
            if (-not $f.TagNoOp) { $f.Tags[$CmdArgs[2]] = $f.Tags[$CmdArgs[1]] }
            return @{ Code = 0; Out = @() }
        }
        $f.UpEnv = @{ AppVersion = $env:APP_VERSION; GitCommit = $env:GIT_COMMIT }
        if ($f.UpFails) { return @{ Code = 1; Out = @() } }
        if ($f.UpUpdatesHealth) { $f.HealthCommit = $f.HeadShort }
        return @{ Code = 0; Out = @() }
    }
}

function Get-PrintedText { return ($script:Printed -join "`n") }

Describe 'Modos' {
    BeforeEach { $script:Fake = New-Fake; Set-StandardMocks }

    It 'sin modo muestra el uso y no ejecuta nada' {
        (Invoke-Main) | Should Be 0
        (Get-PrintedText) | Should Match 'mutuamente excluyentes'
        Assert-MockCalled Invoke-DeployRead -Times 0 -Exactly
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }

    It 'dos modos a la vez se rechazan con exit 3 y no ejecutan nada' {
        (Invoke-Main -P $true -W $true) | Should Be 3
        (Invoke-Main -W $true -D $true) | Should Be 3
        (Invoke-Main -P $true -D $true) | Should Be 3
        (Invoke-Main -P $true -W $true -D $true) | Should Be 3
        Assert-MockCalled Invoke-DeployRead -Times 0 -Exactly
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }

    It '-Preflight propaga 0, 1 y 2, solo lee y no calcula contexto' {
        foreach ($code in 0, 1, 2) {
            $script:Fake.PreflightCode = $code
            (Invoke-Main -P $true) | Should Be $code
        }
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
        Assert-MockCalled Invoke-DeployHttp -Times 0 -Exactly
        Assert-MockCalled Invoke-DeployRead -Times 3 -Exactly -ParameterFilter { $Exe -eq 'powershell' }
        Assert-MockCalled Invoke-DeployRead -Times 0 -Exactly -ParameterFilter { $Exe -ne 'powershell' }
    }
}

Describe 'Preflight como puerta' {
    BeforeEach { $script:Fake = New-Fake; Set-StandardMocks }

    It 'preflight exit 1 aborta -Deploy sin tocar nada ni pedir confirmacion' {
        $script:Fake.PreflightCode = 1
        (Invoke-Main -D $true) | Should Be 1
        (Get-PrintedText) | Should Match 'PREFLIGHT BLOQUEADO'
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
        Assert-MockCalled Read-DeployConfirmation -Times 0 -Exactly
        Assert-MockCalled Invoke-DeployHttp -Times 0 -Exactly
    }

    It 'preflight exit 2 devuelve 2 con el mensaje de sin cambios (WhatIf y Deploy)' {
        $script:Fake.PreflightCode = 2
        (Invoke-Main -W $true) | Should Be 2
        (Get-PrintedText) | Should Match 'SIN CAMBIOS DE HUB/DOCKER - NO HAY NADA QUE DESPLEGAR'
        (Invoke-Main -D $true) | Should Be 2
        (Get-PrintedText) | Should Match 'NO HAY NADA QUE DESPLEGAR'
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
        Assert-MockCalled Read-DeployConfirmation -Times 0 -Exactly
    }

    It 'sin cambios de Hub/Docker en el delta propio devuelve 2 aunque el preflight diga 0' {
        $script:Fake.Files = @('docs/operations/README.md', 'scripts/deploy/Deploy-DaubertHub.ps1')
        (Invoke-Main -D $true) | Should Be 2
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
        Assert-MockCalled Read-DeployConfirmation -Times 0 -Exactly
    }
}

Describe 'Validaciones previas (Deploy)' {
    BeforeEach { $script:Fake = New-Fake; Set-StandardMocks }

    It 'candidato distinto de HEAD es FAIL' {
        $script:Fake.CandidateFull = 'ffffffffffffffffffffffffffffffffffffffff'
        (Invoke-Main -D $true -C 'HEAD~1') | Should Be 1
        (Get-PrintedText) | Should Match 'no es exactamente HEAD'
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }

    It 'arbol sucio es FAIL' {
        $script:Fake.Dirty = @(' M apps/api/src/main.ts')
        (Invoke-Main -D $true) | Should Be 1
        (Get-PrintedText) | Should Match 'no esta limpio'
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }

    It 'commit anterior invalido aborta (unknown, vacio, mayusculas, demasiado corto)' {
        foreach ($bad in 'unknown', '', 'FBDA7C6', 'abc12', 'fbda7c6; echo') {
            $script:Fake.HealthCommit = $bad
            (Invoke-Main -D $true) | Should Be 1
            (Get-PrintedText) | Should Match 'Commit anterior invalido'
        }
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }

    It 'si PROD no esta sano aborta' {
        $script:Fake.HealthDatabase = 'disconnected'
        (Invoke-Main -D $true) | Should Be 1
        (Get-PrintedText) | Should Match 'database distinta de connected'
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }

    It 'una etiqueta de rollback existente aborta y nunca se sobrescribe' {
        foreach ($svc in 'api', 'web') {
            $script:Fake = New-Fake
            $script:Fake.Tags[('daubert-hub-' + $svc + ':rollback-' + $script:Prev)] = 'sha256:cccc'
            (Invoke-Main -D $true) | Should Be 1
            (Get-PrintedText) | Should Match 'ya existe'
            $script:Mutations.Count | Should Be 0
        }
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
        Assert-MockCalled Read-DeployConfirmation -Times 0 -Exactly
    }

    It 'si la imagen en ejecucion no es la etiquetada aborta' {
        $script:Fake.Running['web'] = 'sha256:dddddddddddddddd'
        (Invoke-Main -D $true) | Should Be 1
        (Get-PrintedText) | Should Match 'no hay ancla de rollback fiable'
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }

    It 'si Compose no usaria las imagenes de PROD aborta' {
        $script:Fake.Images = @('otra-imagen')
        (Invoke-Main -D $true) | Should Be 1
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }

    It 'un release con migraciones o cambios de n8n no se despliega con el script' {
        $script:Fake.Files = @('apps/api/src/x.ts', 'database/migrations/daubert_global/20261002_012_x_prod.up.sql')
        (Invoke-Main -D $true) | Should Be 1
        (Get-PrintedText) | Should Match 'migraciones'
        $script:Fake.Files = @('apps/api/src/x.ts', 'n8n/workflows/x.json')
        (Invoke-Main -D $true) | Should Be 1
        (Get-PrintedText) | Should Match 'n8n'
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }
}

Describe '-WhatIf no muta' {
    BeforeEach { $script:Fake = New-Fake; Set-StandardMocks }

    It 'muestra el plan completo y no ejecuta ninguna operacion mutante' {
        (Invoke-Main -W $true) | Should Be 0
        $text = Get-PrintedText
        $text | Should Match 'WhatIf: no se ejecuto ninguna operacion mutante'
        $text | Should Match ('Commit actual en PROD : ' + $script:Prev)
        $text | Should Match ('Commit a desplegar    : ' + $script:HeadShort)
        $text | Should Match ('APP_VERSION           : ' + [regex]::Escape($script:RealVersion))
        $text | Should Match 'Servicios afectados   : api, web'
        $text | Should Match 'apps/web/src/App.tsx'
        $text | Should Match ('docker tag daubert-hub-api:latest daubert-hub-api:rollback-' + $script:Prev)
        $text | Should Match ('docker tag daubert-hub-web:latest daubert-hub-web:rollback-' + $script:Prev)
        $text | Should Match 'up -d --build api web'
        $text | Should Match 'Checks post-deploy'
        $text | Should Match 'Rollback disponible'
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
        Assert-MockCalled Read-DeployConfirmation -Times 0 -Exactly
    }
}

Describe 'Seam real de mutacion (sin mocks)' {
    It 'rechaza cualquier mutacion fuera de -Deploy antes de ejecutar nada' {
        foreach ($mode in 'WhatIf', 'Preflight', 'None') {
            $script:Mode = $mode
            { Invoke-DeployMutation 'docker' @('tag', 'daubert-hub-api:latest', ('daubert-hub-api:rollback-' + $script:Prev)) } | Should Throw 'bloqueada'
            { Invoke-DeployMutation 'docker' @('compose', 'up') } | Should Throw 'bloqueada'
        }
        $script:Mode = 'None'
    }
}

Describe 'Confirmacion explicita' {
    BeforeEach { $script:Fake = New-Fake; Set-StandardMocks }

    It 'cualquier entrada distinta de la frase exacta cancela sin tocar PROD' {
        foreach ($answer in 'deploy daubert hub', 'DEPLOY', 'y', 'yes', 's', '', $null, 'DEPLOY DAUBERT HUB ', ' DEPLOY DAUBERT HUB', 'Deploy Daubert Hub') {
            $script:Fake.Confirmation = $answer
            (Invoke-Main -D $true) | Should Be 1
            (Get-PrintedText) | Should Match 'Confirmacion incorrecta'
            $script:Mutations.Count | Should Be 0
        }
        Assert-MockCalled Invoke-DeployMutation -Times 0 -Exactly
    }

    It 'la frase exacta permite continuar' {
        $script:Fake.Confirmation = 'DEPLOY DAUBERT HUB'
        (Invoke-Main -D $true) | Should Be 0
        Assert-MockCalled Read-DeployConfirmation -Times 1 -Exactly -Scope It
    }
}

Describe 'Deploy exitoso (simulado)' {
    BeforeEach { $script:Fake = New-Fake; Set-StandardMocks }

    It 'crea las anclas antes del build y recrea exclusivamente api y web' {
        (Invoke-Main -D $true) | Should Be 0
        $script:Mutations.Count | Should Be 3
        $script:Mutations[0].Args -join ' ' | Should Be ('tag daubert-hub-api:latest daubert-hub-api:rollback-' + $script:Prev)
        $script:Mutations[1].Args -join ' ' | Should Be ('tag daubert-hub-web:latest daubert-hub-web:rollback-' + $script:Prev)
        $expected = @('compose', '--project-name', 'daubert-hub', '--env-file', 'deploy/pilot.prod.env', '-f', 'compose.pilot.yaml', '-f', 'compose.prod-temp.yaml', 'up', '-d', '--build', 'api', 'web')
        ($script:Mutations[2].Args -join ' ') | Should Be ($expected -join ' ')
        (Get-PrintedText) | Should Match 'DEPLOYMENT CORRECTO'
        foreach ($m in $script:Mutations) { $m.Exe | Should Be 'docker' }
    }

    It 'el plan afecta unicamente api y web' {
        $ctx = Get-DeployContext 'HEAD'
        $plan = New-DeployPlan $ctx
        ($plan.Services -join ',') | Should Be 'api,web'
        ($plan.Anchors | ForEach-Object { $_.Service }) -join ',' | Should Be 'api,web'
        ($plan.ComposeArgs | Select-Object -Last 2) -join ',' | Should Be 'api,web'
        ($plan.ComposeArgs -contains 'postgres-test') | Should Be $false
    }

    It 'APP_VERSION sale del package.json raiz y GIT_COMMIT es el commit corto de HEAD durante el build' {
        (Invoke-Main -D $true) | Should Be 0
        $script:Fake.UpEnv.AppVersion | Should Be $script:RealVersion
        $script:Fake.UpEnv.GitCommit | Should Be $script:HeadShort
    }

    It 'las variables de entorno se restauran al terminar' {
        $env:APP_VERSION = 'valor-previo'
        $env:GIT_COMMIT = 'otro-previo'
        try {
            (Invoke-Main -D $true) | Should Be 0
            $env:APP_VERSION | Should Be 'valor-previo'
            $env:GIT_COMMIT | Should Be 'otro-previo'
        } finally {
            $env:APP_VERSION = $null
            $env:GIT_COMMIT = $null
        }
    }
}

Describe 'Fallos durante el deploy' {
    BeforeEach { $script:Fake = New-Fake; Set-StandardMocks }

    It 'si el health post-deploy no coincide: DEPLOYMENT FALLIDO, ROLLBACK DISPONIBLE y sin rollback automatico' {
        $script:Fake.UpUpdatesHealth = $false
        (Invoke-Main -D $true) | Should Be 5
        $text = Get-PrintedText
        $text | Should Match 'DEPLOYMENT FALLIDO'
        $text | Should Match 'ROLLBACK DISPONIBLE'
        $text | Should Match 'distinto del candidato'
        $text | Should Match 'No se hizo rollback automatico'
        $script:Mutations.Count | Should Be 3
    }

    It 'si docker compose up falla: DEPLOYMENT FALLIDO y no se ejecuta nada mas' {
        $script:Fake.UpFails = $true
        (Invoke-Main -D $true) | Should Be 5
        (Get-PrintedText) | Should Match 'DEPLOYMENT FALLIDO'
        $script:Mutations.Count | Should Be 3
    }

    It 'si una ancla no queda creada se aborta ANTES del build' {
        $script:Fake.TagNoOp = $true
        (Invoke-Main -D $true) | Should Be 1
        (Get-PrintedText) | Should Match 'Abortado antes del build'
        @($script:Mutations | Where-Object { $_.Args[0] -eq 'compose' }).Count | Should Be 0
    }

    It 'si el servicio no esta en ejecucion tras el up se reporta como fallo' {
        $script:Fake.State = 'exited'
        (Invoke-Main -D $true) | Should Be 5
        (Get-PrintedText) | Should Match 'no esta en ejecucion'
    }
}

Describe 'Secretos' {
    BeforeEach { $script:Fake = New-Fake; Set-StandardMocks }

    It 'Protect-Line oculta contrasenas, tokens y secretos' {
        (Protect-Line 'DB_PASSWORD=hunter2') | Should Be 'DB_PASSWORD=***'
        (Protect-Line 'CATERPILLAR_REPROCESS_WEBHOOK_TOKEN: abcdef123456') | Should Be 'CATERPILLAR_REPROCESS_WEBHOOK_TOKEN: ***'
        (Protect-Line 'Authorization: Bearer xyz') | Should Match '\*\*\*'
        (Protect-Line 'client_secret = s3cr3t') | Should Match '\*\*\*'
        (Protect-Line 'texto normal sin nada') | Should Be 'texto normal sin nada'
    }

    It 'la salida de un deploy con secretos en la salida de Compose no los imprime' {
        $script:Fake.PsLines = @('DB_PASSWORD=supersecreto123', 'PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN=tok-abc-999', 'api Up')
        (Invoke-Main -D $true) | Should Be 0
        $text = Get-PrintedText
        $text | Should Not Match 'supersecreto123'
        $text | Should Not Match 'tok-abc-999'
        $text | Should Match 'DB_PASSWORD=\*\*\*'
    }

    It 'el script no lee ni nombra secretos del archivo de entorno' {
        $source = Get-Content -LiteralPath $scriptPath -Raw
        $source | Should Not Match 'DB_PASSWORD'
        $source | Should Not Match '_TOKEN'
        $source | Should Not Match 'Get-Content[^\r\n]*pilot\.prod\.env'
    }
}

Describe 'Comandos prohibidos' {
    $docker = 'docker'
    $cf = @('--project-name', 'daubert-hub', '--env-file', 'deploy/pilot.prod.env', '-f', 'compose.pilot.yaml', '-f', 'compose.prod-temp.yaml')

    It 'la lista de mutaciones permitidas acepta exactamente el tag de ancla y el compose up api web' {
        (Test-AllowedMutation 'docker' @('tag', 'daubert-hub-api:latest', 'daubert-hub-api:rollback-fbda7c6')) | Should BeNullOrEmpty
        (Test-AllowedMutation 'docker' @('tag', 'daubert-hub-web:latest', 'daubert-hub-web:rollback-fbda7c6')) | Should BeNullOrEmpty
        (Test-AllowedMutation 'docker' (@('compose') + $cf + @('up', '-d', '--build', 'api', 'web'))) | Should BeNullOrEmpty
    }

    It 'rechaza down, rm, rmi, prune, restart, commit, remove-orphans y variantes' {
        $forbidden = @(
            (@('compose') + $cf + @('down')),
            (@('compose') + $cf + @('down', '-v')),
            (@('compose') + $cf + @('up', '-d', '--build', 'api', 'web', '--remove-orphans')),
            (@('compose') + $cf + @('up', '-d', '--build', '--remove-orphans', 'api', 'web')),
            (@('compose') + $cf + @('up', '-d', '--build')),
            (@('compose') + $cf + @('up', '-d', '--build', 'api', 'web', 'postgres-test')),
            (@('compose') + $cf + @('up', '-d', '--build', 'api')),
            (@('compose') + $cf + @('up', '-d', '--no-build', 'api', 'web')),
            (@('compose') + $cf + @('rm', '-f')),
            (@('compose') + $cf + @('restart', 'api')),
            (@('compose') + $cf + @('stop')),
            @('rm', '-f', 'daubert-hub-api-1'),
            @('rmi', 'daubert-hub-api:latest'),
            @('restart', 'daubert-hub-api-1'),
            @('system', 'prune', '-f'),
            @('image', 'prune', '-a'),
            @('builder', 'prune'),
            @('commit', 'daubert-hub-web-1', 'x:y'),
            @('save', 'daubert-hub-api:latest', '-o', 'x.tar'),
            @('tag', 'daubert-hub-api:latest', 'daubert-hub-api:latest'),
            @('tag', 'daubert-hub-api:latest', 'daubert-hub-api:failed-fbda7c6'),
            @('tag', 'daubert-hub-api:latest', 'daubert-hub-web:rollback-fbda7c6'),
            @('tag', 'daubert-hub-api:latest', 'daubert-hub-api:rollback-unknown'),
            @('tag', 'daubert-hub-api:latest', 'daubert-hub-api:rollback-FBDA7C6'),
            @('tag', 'daubert-hub-test-api:latest', 'daubert-hub-api:rollback-fbda7c6'),
            @('tag', 'daubert-hub-api:rollback-fbda7c6', 'daubert-hub-api:latest')
        )
        foreach ($args_ in $forbidden) {
            (Test-AllowedMutation $docker $args_) | Should Not BeNullOrEmpty
            $script:Mode = 'Deploy'
            { Invoke-DeployMutation $docker $args_ } | Should Throw 'rechazada'
        }
        foreach ($exe in 'git', 'powershell', 'cmd', 'psql', 'curl') {
            (Test-AllowedMutation $exe @('push')) | Should Not BeNullOrEmpty
        }
        $script:Mode = 'None'
    }

    It 'las lecturas rechazan comandos mutantes de docker y git' {
        $refused = @(
            @('docker', @('rm', '-f', 'x')), @('docker', @('rmi', 'x')), @('docker', @('tag', 'a', 'b')),
            @('docker', @('compose', '--project-name', 'daubert-hub', 'down')),
            @('docker', @('compose', '--project-name', 'daubert-hub', 'up', '-d')),
            @('docker', @('system', 'prune')), @('docker', @('restart', 'x')), @('docker', @('commit', 'x', 'y')),
            @('git', @('fetch')), @('git', @('pull')), @('git', @('checkout', 'main')), @('git', @('reset', '--hard')),
            @('git', @('clean', '-fd')), @('git', @('push')), @('git', @('commit', '-m', 'x')), @('git', @('branch', 'nueva')),
            @('powershell', @('-Command', 'Get-Date')), @('cmd', @('/c', 'dir')), @('psql', @('-c', 'select 1'))
        )
        foreach ($c in $refused) { (Test-ReadOnlyCommand $c[0] $c[1]) | Should Not BeNullOrEmpty }
        (Test-ReadOnlyCommand 'git' @('--no-optional-locks', 'status', '--short')) | Should BeNullOrEmpty
        (Test-ReadOnlyCommand 'docker' @('image', 'inspect', 'x', '--format', '{{.Id}}')) | Should BeNullOrEmpty
        (Test-ReadOnlyCommand 'docker' (@('compose') + $cf + @('config', '--images'))) | Should BeNullOrEmpty
        (Test-ReadOnlyCommand 'docker' (@('compose') + $cf + @('ps'))) | Should BeNullOrEmpty
        { Invoke-DeployRead 'docker' @('rm', '-f', 'x') } | Should Throw 'rechazada'
        { Invoke-DeployRead 'git' @('fetch') } | Should Throw 'rechazada'
    }

    It 'estaticamente: solo los dos seams ejecutan procesos externos' {
        $tokens = $null; $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
        @($errors).Count | Should Be 0
        $amp = [System.Management.Automation.Language.TokenKind]::Ampersand
        $calls = @($ast.FindAll({ param($n) ($n -is [System.Management.Automation.Language.CommandAst]) -and ($n.InvocationOperator -eq $amp) }, $true))
        $calls.Count | Should Be 2
        $owners = @()
        foreach ($call in $calls) {
            $node = $call.Parent
            while ($node -and -not ($node -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $node = $node.Parent }
            $owners += $node.Name
        }
        (($owners | Sort-Object) -join ',') | Should Be 'Invoke-DeployMutation,Invoke-DeployRead'
    }

    It 'estaticamente: no usa cmdlets de escritura ni comandos prohibidos en sus cadenas' {
        $tokens = $null; $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
        $banned = 'Remove-Item', 'Set-Content', 'Add-Content', 'Out-File', 'New-Item', 'Copy-Item', 'Move-Item', 'Rename-Item', 'Clear-Content', 'Set-Item', 'Invoke-Expression', 'Invoke-Command', 'Start-Process', 'Stop-Process', 'Stop-Service', 'Restart-Service'
        $names = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ })
        foreach ($b in $banned) { ($names -contains $b) | Should Be $false }
        $strings = @($tokens | Where-Object { $_.Kind -eq 'StringLiteral' -or $_.Kind -eq 'StringExpandable' } | ForEach-Object { $_.Text })
        $joined = $strings -join "`n"
        $joined | Should Not Match '(?i)\b(down|prune|rmi|restart)\b'
        $joined | Should Not Match '--remove-orphans'
        $joined | Should Not Match '(?i)git\s+(fetch|pull|checkout|reset|clean|push)'
        $joined | Should Not Match '(?i)docker\s+(rm|commit|save|stop|kill)\b'
    }
}

Describe 'Esquema de salida' {
    It 'los codigos de salida documentados son 0, 1, 2, 3 y 5' {
        $help = Get-Content -LiteralPath $scriptPath -Raw
        $help | Should Match '0 ok \| 1 blocked or aborted \| 2 nothing to deploy'
        $help | Should Match '5 DEPLOYMENT FAILED'
    }
}
