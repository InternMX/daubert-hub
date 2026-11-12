# Exercises the ACTUAL documented rollback block against an in-memory Docker store.
# The docker function fails closed outside its mock: no native Docker can be invoked.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '..\Deploy-DaubertHub.ps1')
$script:ChecklistPath = Join-Path $script:RepoRoot 'docs\operations\deployment-checklist.md'
$script:RehearsalPath = Join-Path $script:RepoRoot 'docs\operations\rollback-rehearsal.md'

function docker {
    throw 'Docker externo prohibido en las pruebas de recuperacion.'
}

function Get-DocumentedRecoveryBody {
    $text = Get-Content -LiteralPath $script:ChecklistPath -Raw -Encoding UTF8
    if ($text -notmatch '(?s)\*\*Rollback del Hub\*\*.*?```powershell\r?\n(.*?)```') { throw 'No se encontro el procedimiento de rollback.' }
    # Only replace operator inputs, never the commands under test.
    return ($Matches[1] -replace '(?m)^\$(prev|new|rollbackDigests)\s*=.*\r?\n', '')
}

function Invoke-DocumentedRecovery {
    $body = Get-DocumentedRecoveryBody
    $prev = 'bbbbbbb'; $new = 'aaaaaaa'
    $rollbackDigests = $script:Recovery.Expected
    $cf = Get-ComposeBaseArgs
    & ([scriptblock]::Create($body))
}

function Invoke-DocumentedComposeResume {
    # Only the tail of the SAME checklist block (Compose + health): what rollback-rehearsal.md
    # allows after the read-only diagnosis returns LISTO_PARA_COMPOSE.
    $body = Get-DocumentedRecoveryBody
    $at = $body.IndexOf('docker compose @cf up -d --no-build api web')
    if ($at -lt 0) { throw 'No se encontro el paso Compose del rollback.' }
    $prev = 'bbbbbbb'
    $rollbackDigests = $script:Recovery.Expected
    $cf = Get-ComposeBaseArgs
    & ([scriptblock]::Create("`$ErrorActionPreference = 'Continue'`n" + $body.Substring($at)))
}

function Invoke-RehearsalDiagnosis {
    $text = Get-Content -LiteralPath $script:RehearsalPath -Raw -Encoding UTF8
    if ($text -notmatch '(?s)<!-- bloque-probado: diagnostico-recuperacion -->\s*```powershell\r?\n(.*?)```') { throw 'No se encontro el bloque de diagnostico.' }
    $body = $Matches[1] -replace '(?m)^\$(prev|new|rollbackDigests)\s*=.*\r?\n', ''
    $prev = 'bbbbbbb'; $new = 'aaaaaaa'
    $rollbackDigests = $script:Recovery.Expected
    return (& ([scriptblock]::Create($body)))
}

function New-RecoveryState {
    $s = @{
        Expected = @{ api = ('sha256:' + ('1' * 64)); web = ('sha256:' + ('2' * 64)) }
        New = ('sha256:' + ('3' * 64))
        Tags = @{}; Running = @{}; Status = @{}; Health = @{}; Calls = @()
        FailTarget = ''; ComposeFails = $false; ComposeOnly = @('api', 'web'); HealthAfter = 'healthy'
        InterruptAt = 0; Mutations = 0
        Composed = $false; InspectFails = @(); InspectRaw = @{}; RunOverride = @{}; StatusAfter = @{}; StartingReads = 0
    }
    foreach ($svc in @('api', 'web')) {
        $s.Tags['daubert-hub-' + $svc + ':rollback-bbbbbbb'] = $s.Expected[$svc]
        $s.Tags['daubert-hub-' + $svc + ':latest'] = $s.New
        $s.Running[$svc] = $s.New
        $s.Status[$svc] = 'running'
        $s.Health[$svc] = ''
    }
    $s.Health.api = 'healthy'
    return $s
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
    if ($NativeArgs[0] -eq 'inspect') {
        $m = [regex]::Match([string]$NativeArgs[1], '^daubert-hub-(api|web)-1$')
        if (-not $m.Success) { $global:LASTEXITCODE = 1; return }
        if (($NativeArgs -join ' ') -notmatch 'ImageManifestDescriptor.*\|.*State\.Status.*\|.*State\.Health') { throw 'Formato de docker inspect no simulado.' }
        $svc = $m.Groups[1].Value
        if ($s.InspectFails -contains $svc) { $global:LASTEXITCODE = 1; return }
        if ($s.InspectRaw.ContainsKey($svc)) { return $s.InspectRaw[$svc] }
        $health = $s.Health[$svc]
        if ($svc -eq 'api' -and $s.Composed -and $s.StartingReads -gt 0) { $s.StartingReads--; $health = 'starting' }
        return ($s.Running[$svc] + '|' + $s.Status[$svc] + '|' + $health)
    }
    $mutating = ($NativeArgs.Count -eq 3 -and $NativeArgs[0] -eq 'tag') -or $NativeArgs[0] -eq 'compose'
    if ($mutating) {
        $s.Mutations++
        if ($s.InterruptAt -gt 0 -and $s.Mutations -eq $s.InterruptAt) { throw 'Interrupcion simulada de la consola de recuperacion.' }
    }
    if ($NativeArgs.Count -eq 3 -and $NativeArgs[0] -eq 'tag') {
        if ($NativeArgs[2] -eq $s.FailTarget -or -not $s.Tags.ContainsKey($NativeArgs[1])) { $global:LASTEXITCODE = 1; return }
        $s.Tags[$NativeArgs[2]] = $s.Tags[$NativeArgs[1]]
        return
    }
    $expected = @('compose') + (Get-ComposeBaseArgs) + @('up', '-d', '--no-build', 'api', 'web')
    if (($NativeArgs -join ' ') -ceq ($expected -join ' ')) {
        if ($s.ComposeFails) { $global:LASTEXITCODE = 1; return }
        foreach ($svc in $s.ComposeOnly) {
            $s.Running[$svc] = $s.Tags['daubert-hub-' + $svc + ':latest']
            $s.Status[$svc] = 'running'
        }
        if ($s.ComposeOnly -contains 'api') { $s.Health.api = $s.HealthAfter }
        foreach ($svc in @($s.RunOverride.Keys)) { $s.Running[$svc] = $s.RunOverride[$svc] }
        foreach ($svc in @($s.StatusAfter.Keys)) { $s.Status[$svc] = $s.StatusAfter[$svc] }
        $s.Composed = $true
        return
    }
    throw 'Comando fuera del rollback de api/web permitido en el simulador.'
}

function Invoke-RecoveryHealth {
    # /api/health follows the simulated api container: the commit comes from the image it runs.
    $s = $script:Recovery
    if ($s.Health.api -ne 'healthy') { throw 'No es posible conectar con el servidor remoto (simulado).' }
    $commit = if ($s.Running.api -ceq $s.Expected.api) { 'bbbbbbb' } else { 'aaaaaaa' }
    return [pscustomobject]@{ status = 'ok'; database = 'connected'; environment = 'PRODUCTION'; commit = $commit }
}

function Get-RecoveryMutations {
    return @($script:Recovery.Calls | Where-Object { $_[0] -in @('tag', 'compose') })
}

Describe 'Recuperacion operativa: rollback documental sin servicios reales' {
    BeforeEach {
        $script:Recovery = New-RecoveryState
        Mock docker { Invoke-RecoveryDocker $args }
        Mock Invoke-RestMethod { [pscustomobject]@{ status = 'ok'; database = 'connected'; environment = 'PRODUCTION'; commit = 'bbbbbbb' } }
        Mock Write-Host { }
        Mock Start-Sleep { }
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

Describe 'Fase 3D: API que no llega a healthy tras el rollback' {
    BeforeEach {
        $script:Recovery = New-RecoveryState
        Mock docker { Invoke-RecoveryDocker $args }
        Mock Write-Host { }
        Mock Start-Sleep { }
    }

    It 'health inaccesible (API no responde) no se declara recuperacion correcta' {
        $script:Recovery.HealthAfter = 'unhealthy'
        Mock Invoke-RestMethod { Invoke-RecoveryHealth }
        { Invoke-DocumentedRecovery } | Should Throw
        @($script:Recovery.Calls | Where-Object { $_[0] -eq 'compose' }).Count | Should Be 1
    }
    It 'health con <Campo>=<Valor> no se declara recuperacion correcta' -TestCases @(
        @{ Campo = 'status'; Valor = 'error' },
        @{ Campo = 'database'; Valor = 'disconnected' },
        @{ Campo = 'environment'; Valor = 'TEST' },
        @{ Campo = 'commit'; Valor = 'ccccccc' }
    ) {
        param($Campo, $Valor)
        $script:HealthOverride = @{ Campo = $Campo; Valor = $Valor }
        Mock Invoke-RestMethod {
            $h = [ordered]@{ status = 'ok'; database = 'connected'; environment = 'PRODUCTION'; commit = 'bbbbbbb' }
            $h[$script:HealthOverride.Campo] = $script:HealthOverride.Valor
            [pscustomobject]$h
        }
        { Invoke-DocumentedRecovery } | Should Throw
    }
}

Describe 'Fase 3D: diagnostico de recuperacion de solo lectura (rollback-rehearsal.md)' {
    BeforeEach {
        $script:Recovery = New-RecoveryState
        Mock docker { Invoke-RecoveryDocker $args }
        Mock Invoke-RestMethod { Invoke-RecoveryHealth }
        Mock Write-Host { }
        Mock Start-Sleep { }
    }

    It 'antes del rollback, con anclas correctas, indica SIN_INICIAR y no muta nada' {
        Invoke-RehearsalDiagnosis | Should Be 'SIN_INICIAR'
        @(Get-RecoveryMutations).Count | Should Be 0
    }
    It 'tras un rollback completo y sano indica RECUPERADO' {
        Invoke-DocumentedRecovery
        Invoke-RehearsalDiagnosis | Should Be 'RECUPERADO'
    }
    It 'ancla <Caso> bloquea el diagnostico' -TestCases @(
        @{ Caso = 'inexistente'; Digest = $null },
        @{ Caso = 'con digest distinto al registrado'; Digest = ('sha256:' + ('9' * 64)) }
    ) {
        param($Caso, $Digest)
        if ($Digest) { $script:Recovery.Tags['daubert-hub-api:rollback-bbbbbbb'] = $Digest } else { $script:Recovery.Tags.Remove('daubert-hub-api:rollback-bbbbbbb') }
        Invoke-RehearsalDiagnosis | Should Be 'BLOQUEADO'
        @(Get-RecoveryMutations).Count | Should Be 0
    }
    It 'una evidencia previa mal formada bloquea aunque el ancla exista' {
        $script:Recovery.Expected = @{ api = 'sha256:abc'; web = $script:Recovery.Expected.web }
        $script:Recovery.Tags['daubert-hub-api:rollback-bbbbbbb'] = 'sha256:abc'
        Invoke-RehearsalDiagnosis | Should Be 'BLOQUEADO'
    }
    It 'solo ejecuta lecturas: docker image inspect y docker inspect de los contenedores Hub' {
        Invoke-RehearsalDiagnosis | Out-Null
        foreach ($call in $script:Recovery.Calls) {
            $ok = ($call[0] -eq 'image' -and $call[1] -eq 'inspect' -and $call[2] -match '^daubert-hub-(api|web):') -or ($call[0] -eq 'inspect' -and $call[1] -match '^daubert-hub-(api|web)-1$')
            $ok | Should Be $true
        }
        Assert-MockCalled Invoke-RestMethod -Times 1 -Exactly -Scope It -ParameterFilter { $Uri -eq 'http://localhost:8082/api/health' }
    }
    It 'un health inaccesible no hace fallar el diagnostico (lo informa en el veredicto)' {
        $script:Recovery.Health.api = 'starting'
        { Invoke-RehearsalDiagnosis } | Should Not Throw
    }
}

Describe 'Fase 3D: recreacion parcial de API/Web' {
    BeforeEach {
        $script:Recovery = New-RecoveryState
        Mock docker { Invoke-RecoveryDocker $args }
        Mock Invoke-RestMethod { Invoke-RecoveryHealth }
        Mock Write-Host { }
        Mock Start-Sleep { }
    }

    It 'un Compose con exit 0 que solo recrea api (health HTTP correcto) NO se declara completado; el diagnostico indica LISTO_PARA_COMPOSE' {
        $script:Recovery.ComposeOnly = @('api')
        { Invoke-DocumentedRecovery } | Should Throw 'web ejecuta'
        $script:Recovery.Running.web | Should Be $script:Recovery.New
        Assert-MockCalled Write-Host -Times 0 -Scope It -ParameterFilter { "$Object" -match 'completado' }
        Invoke-RehearsalDiagnosis | Should Be 'LISTO_PARA_COMPOSE'
    }
    It 'tras detectar la recreacion parcial, reanudar solo Compose completa la recuperacion sin volver a etiquetar' {
        $script:Recovery.ComposeOnly = @('api')
        { Invoke-DocumentedRecovery } | Should Throw
        $tagsBefore = @($script:Recovery.Calls | Where-Object { $_[0] -eq 'tag' }).Count
        $script:Recovery.ComposeOnly = @('api', 'web')
        Invoke-DocumentedComposeResume
        @($script:Recovery.Calls | Where-Object { $_[0] -eq 'tag' }).Count | Should Be $tagsBefore
        Invoke-RehearsalDiagnosis | Should Be 'RECUPERADO'
    }
    It 'contenedores recreados con la imagen anterior pero api no healthy: RECREADO_NO_SANO (no se vuelve a etiquetar ni recrear)' {
        $script:Recovery.HealthAfter = 'unhealthy'
        { Invoke-DocumentedRecovery } | Should Throw
        Invoke-RehearsalDiagnosis | Should Be 'RECREADO_NO_SANO'
    }
    It 'web detenido tras Compose no se diagnostica como recuperado' {
        Invoke-DocumentedRecovery
        $script:Recovery.Status.web = 'exited'
        Invoke-RehearsalDiagnosis | Should Be 'LISTO_PARA_COMPOSE'
    }
    It 'health HTTP con commit incorrecto pese a contenedores en el ancla: RECREADO_NO_SANO' {
        Invoke-DocumentedRecovery
        Mock Invoke-RestMethod { [pscustomobject]@{ status = 'ok'; database = 'connected'; environment = 'PRODUCTION'; commit = 'aaaaaaa' } }
        Invoke-RehearsalDiagnosis | Should Be 'RECREADO_NO_SANO'
    }
}

Describe 'Fase 3D: recuperacion interrumpida o detenida a mitad' {
    BeforeEach {
        $script:Recovery = New-RecoveryState
        Mock docker { Invoke-RecoveryDocker $args }
        Mock Invoke-RestMethod { Invoke-RecoveryHealth }
        Mock Write-Host { }
        Mock Start-Sleep { }
    }

    It 'interrupcion en la mutacion <At> (<Momento>): diagnostico <Veredicto> y repetir el bloque completo no muta nada' -TestCases @(
        @{ At = 2; Momento = 'api preservada, web no'; Veredicto = 'PARCIAL' },
        @{ At = 3; Momento = 'ambas preservadas, ninguna restaurada'; Veredicto = 'PARCIAL' },
        @{ At = 4; Momento = 'api restaurada, web no'; Veredicto = 'PARCIAL' },
        @{ At = 5; Momento = 'etiquetas restauradas, Compose no ejecutado'; Veredicto = 'LISTO_PARA_COMPOSE' }
    ) {
        param($At, $Momento, $Veredicto)
        $script:Recovery.InterruptAt = $At
        { Invoke-DocumentedRecovery } | Should Throw
        $script:Recovery.InterruptAt = 0
        Invoke-RehearsalDiagnosis | Should Be $Veredicto
        $before = @(Get-RecoveryMutations).Count
        { Invoke-DocumentedRecovery } | Should Throw
        @(Get-RecoveryMutations).Count | Should Be $before
        $script:Recovery.Running.api | Should Be $script:Recovery.New
    }
    It 'fallo al <Paso> deja un estado PARCIAL sin Compose' -TestCases @(
        @{ Paso = 'preservar web tras preservar api'; Target = 'daubert-hub-web:failed-aaaaaaa' },
        @{ Paso = 'restaurar web tras restaurar api'; Target = 'daubert-hub-web:latest' }
    ) {
        param($Paso, $Target)
        $script:Recovery.FailTarget = $Target
        { Invoke-DocumentedRecovery } | Should Throw
        @($script:Recovery.Calls | Where-Object { $_[0] -eq 'compose' }).Count | Should Be 0
        Invoke-RehearsalDiagnosis | Should Be 'PARCIAL'
    }
    It 'Compose fallido deja las etiquetas coherentes: LISTO_PARA_COMPOSE y reanudacion sin re-etiquetar' {
        $script:Recovery.ComposeFails = $true
        { Invoke-DocumentedRecovery } | Should Throw
        Invoke-RehearsalDiagnosis | Should Be 'LISTO_PARA_COMPOSE'
        $script:Recovery.ComposeFails = $false
        $tags = @($script:Recovery.Calls | Where-Object { $_[0] -eq 'tag' }).Count
        Invoke-DocumentedComposeResume
        @($script:Recovery.Calls | Where-Object { $_[0] -eq 'tag' }).Count | Should Be $tags
        Invoke-RehearsalDiagnosis | Should Be 'RECUPERADO'
    }
    It 'tras una interrupcion las imagenes failed conservan la version fallida y las anclas no cambian' {
        $script:Recovery.InterruptAt = 4
        { Invoke-DocumentedRecovery } | Should Throw
        foreach ($svc in @('api', 'web')) {
            $script:Recovery.Tags['daubert-hub-' + $svc + ':failed-aaaaaaa'] | Should Be $script:Recovery.New
            $script:Recovery.Tags['daubert-hub-' + $svc + ':rollback-bbbbbbb'] | Should Be $script:Recovery.Expected[$svc]
        }
    }
}

Describe 'Fase 3D: verificacion posterior del bloque de rollback (contenedores, digests y health)' {
    BeforeEach {
        $script:Recovery = New-RecoveryState
        Mock docker { Invoke-RecoveryDocker $args }
        Mock Invoke-RestMethod { Invoke-RecoveryHealth }
        Mock Write-Host { }
        Mock Start-Sleep { }
    }

    It 'recuperacion completa: solo entonces emite el mensaje de completado' {
        { Invoke-DocumentedRecovery } | Should Not Throw
        Assert-MockCalled Write-Host -Times 1 -Exactly -Scope It -ParameterFilter { "$Object" -match '^Rollback por imagen completado' }
        foreach ($svc in @('api', 'web')) { $script:Recovery.Running[$svc] | Should Be $script:Recovery.Expected[$svc] }
    }
    It 'compara el manifiesto en ejecucion de cada contenedor, no solo la etiqueta latest' {
        Invoke-DocumentedRecovery
        foreach ($svc in @('api', 'web')) {
            @($script:Recovery.Calls | Where-Object { $_[0] -eq 'inspect' -and $_[1] -eq ('daubert-hub-' + $svc + '-1') -and ($_ -join ' ') -match 'ImageManifestDescriptor' }).Count | Should BeGreaterThan 0
        }
    }
    It 'API correcta con Web ejecutando <Caso>: falla explicitamente sin mensaje de completado' -TestCases @(
        @{ Caso = 'la imagen fallida'; Digest = ('sha256:' + ('3' * 64)) },
        @{ Caso = 'otra imagen'; Digest = ('sha256:' + ('4' * 64)) },
        @{ Caso = 'la imagen de api'; Digest = ('sha256:' + ('1' * 64)) }
    ) {
        param($Caso, $Digest)
        $script:Recovery.RunOverride = @{ web = $Digest }
        { Invoke-DocumentedRecovery } | Should Throw 'web ejecuta'
        Assert-MockCalled Write-Host -Times 0 -Scope It -ParameterFilter { "$Object" -match 'completado:' }
        Assert-MockCalled Start-Sleep -Times 0 -Scope It
    }
    It 'Web con estado <Estado> tras Compose: falla tras agotar reintentos y nunca declara completado' -TestCases @(
        @{ Estado = 'exited' }, @{ Estado = 'created' }, @{ Estado = 'restarting' }
    ) {
        param($Estado)
        $script:Recovery.StatusAfter = @{ web = $Estado }
        { Invoke-DocumentedRecovery } | Should Throw 'Rollback NO completado'
        Assert-MockCalled Write-Host -Times 1 -Scope It -ParameterFilter { "$Object" -match "PENDIENTE: web: estado '$Estado'" }
        Assert-MockCalled Write-Host -Times 0 -Scope It -ParameterFilter { "$Object" -match 'completado:' }
        Assert-MockCalled Start-Sleep -Times 35 -Exactly -Scope It
    }
    It 'API detenida tras Compose: falla y no declara completado' {
        $script:Recovery.StatusAfter = @{ api = 'exited' }
        { Invoke-DocumentedRecovery } | Should Throw 'Rollback NO completado'
        Assert-MockCalled Write-Host -Times 1 -Scope It -ParameterFilter { "$Object" -match "PENDIENTE: api: estado 'exited'" }
    }
    It 'digest en ejecucion invalido (<Caso>): falla al instante' -TestCases @(
        @{ Caso = 'sin ImageManifestDescriptor'; Raw = '|running|' },
        @{ Caso = 'truncado'; Raw = 'sha256:abc|running|' },
        @{ Caso = 'mayusculas'; Raw = ('sha256:' + ('A' * 64) + '|running|') }
    ) {
        param($Caso, $Raw)
        $script:Recovery.InspectRaw = @{ web = $Raw }
        { Invoke-DocumentedRecovery } | Should Throw 'digest de manifiesto valido'
        Assert-MockCalled Start-Sleep -Times 0 -Scope It
    }
    It 'error al inspeccionar <Svc> (exit no cero): falla explicitamente' -TestCases @(@{ Svc = 'api' }, @{ Svc = 'web' }) {
        param($Svc)
        $script:Recovery.InspectFails = @($Svc)
        { Invoke-DocumentedRecovery } | Should Throw ('no se pudo inspeccionar daubert-hub-' + $Svc + '-1')
        Assert-MockCalled Write-Host -Times 0 -Scope It -ParameterFilter { "$Object" -match 'completado:' }
    }
    It 'salida de inspect mal formada (sin separadores) falla explicitamente' {
        $script:Recovery.InspectRaw = @{ api = ('sha256:' + ('1' * 64)) }
        { Invoke-DocumentedRecovery } | Should Throw 'no se pudo inspeccionar daubert-hub-api-1'
    }
    It 'API en starting que pasa a healthy: reintenta y completa' {
        $script:Recovery.StartingReads = 3
        { Invoke-DocumentedRecovery } | Should Not Throw
        Assert-MockCalled Start-Sleep -Times 3 -Exactly -Scope It
        Assert-MockCalled Write-Host -Times 1 -Exactly -Scope It -ParameterFilter { "$Object" -match '^Rollback por imagen completado' }
    }
    It 'API que nunca llega a healthy: falla tras el limite con pendientes de salud y health' {
        $script:Recovery.HealthAfter = 'unhealthy'
        { Invoke-DocumentedRecovery } | Should Throw 'Rollback NO completado'
        Assert-MockCalled Write-Host -Times 1 -Scope It -ParameterFilter { "$Object" -match "PENDIENTE: api: salud 'unhealthy'" }
        Assert-MockCalled Write-Host -Times 1 -Scope It -ParameterFilter { "$Object" -match 'PENDIENTE: health: sin respuesta' }
        Assert-MockCalled Write-Host -Times 0 -Scope It -ParameterFilter { "$Object" -match 'completado:' }
    }
    It 'la verificacion posterior solo lee: tras el Compose no hay mas tag ni compose' {
        $script:Recovery.StartingReads = 2
        Invoke-DocumentedRecovery
        $calls = @($script:Recovery.Calls)
        $composeAt = -1
        for ($i = 0; $i -lt $calls.Count; $i++) { if ($calls[$i][0] -eq 'compose') { $composeAt = $i } }
        $composeAt | Should BeGreaterThan -1
        for ($i = $composeAt + 1; $i -lt $calls.Count; $i++) { $calls[$i][0] | Should Be 'inspect' }
    }
}
