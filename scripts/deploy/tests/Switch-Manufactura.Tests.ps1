# Pester 3.4 tests for scripts\deploy\Switch-Manufactura.ps1. No docker, git, HTTP or real operational path is used: every seam is mocked
# and the lock / overlay files live under TestDrive.
# Run with:  Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\deploy\tests

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '..\Switch-Manufactura.ps1')

$script:Sha = '3b540e4e9f3a335f6eed213a0af33c935f31fa01c687f5e6c9cad3d8aa23396a'
$script:PolM = 'dcadb58dc1cd8d124b383462e1390160155e3012d053b1e0fd021ef2f147bdd9'
$script:ManSha = ('a' * 64)
function New-Manifest { param([bool]$Ui = $true, [string]$Commit = 'abc1234ffffffffffffffffffffffffffffffffff', [string]$ApiId = 'sha256:idx-api', [string]$WebId = 'sha256:idx-web', [string]$Sha = $script:ManSha)
    return [pscustomobject]@{ Exists = $true; Sha256 = $Sha; Json = [pscustomobject]@{ formato = '1'; commit = $Commit; interfazManufacturaCompilada = $Ui; imagenes = @([pscustomobject]@{ servicio = 'api'; imageId = $ApiId }, [pscustomobject]@{ servicio = 'web'; imageId = $WebId }) } }
}
function New-Ctx {
    $c = [pscustomobject]@{
        HeadShort = 'abc1234'; Dirty = @(); Health = [pscustomobject]@{ status = 'ok'; database = 'connected'; environment = 'PRODUCTION'; commit = 'abc1234' }
        Api = [pscustomobject]@{ Digest = 'sha256:api'; ContainerId = 'c-api'; StartedAt = 't1'; Health = 'healthy' }
        Web = [pscustomobject]@{ Digest = 'sha256:web'; ContainerId = 'c-web'; StartedAt = 't1'; Health = '' }
        ReleaseTags = @{ api = 'sha256:api'; web = 'sha256:web' }; LatestTags = @{ api = 'sha256:api'; web = 'sha256:web' }; ReleaseIds = @{ api = 'sha256:idx-api'; web = 'sha256:idx-web' }; ApiEstado = 'Apagado'
        ClosureProbe = [pscustomobject]@{ Code = 503; Closed = $true }
        Base = [pscustomobject]@{ Enabled = 'false'; Emission = $null; Habilita = $false; Errores = @() }
        Overlay = [pscustomobject]@{ Preparada = [pscustomobject]@{ Existe = $true; Valida = $true; Sha256 = $script:Sha }; Activa = [pscustomobject]@{ Existe = $false; Valida = $false; Sha256 = '' }; Temporales = @(); Coherente = $true; Errores = @() }
        ClosureSha = $script:PolM; ManufacturaPolicySha = $script:PolM; Hazards = @()
    }
    return $c
}
function New-Evidence { param([string]$Verdict = 'PASS', [string]$Phase = 'PreEnable', [string]$Profile = 'completo-v1', [string]$Commit = 'abc1234', [string]$Groups = 'bd,respaldo,configuracion,migraciones,salud,imagenes,nginx,cierre', [string]$Missing = '-', [datetime]$When = (Get-Date).ToUniversalTime())
    return ('MANUFACTURA_READINESS_' + $Verdict + ' phase=' + $Phase + ' perfil=' + $Profile + ' controles=40 fallos=0 grupos=' + $Groups + ' commit=' + $Commit + ' faltan=' + $Missing + ' ' + $When.ToString('yyyy-MM-ddTHH:mm:ssZ'))
}
function New-Params { param([hashtable]$Extra = @{})
    $p = @{ Enable = $true; Disable = $false; Apply = $true; OverlaySha256 = $script:Sha; ReadinessEvidence = 'C:\fuera\readiness.txt'; ImagesManifest = 'C:\fuera\imagenes.json'; ImagesManifestSha256 = $script:ManSha; ClosurePolicySha256 = $script:PolM; EvidenceMaxAgeHours = 2; HealthTimeoutSeconds = 5; Root = (Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))) }
    foreach ($k in $Extra.Keys) { $p[$k] = $Extra[$k] }
    return $p
}
function Set-FlowMocks { param($Ctx, [string]$Evidence = (New-Evidence))
    $script:CtxQueue = $Ctx; $script:EvidenceText = $Evidence
    Mock Get-SwitchContext { $script:CtxQueue }
    Mock Read-SwitchText { $script:EvidenceText } -ParameterFilter { $Path -eq 'C:\fuera\readiness.txt' }
    Mock Get-SwitchFileAgeHours { 0.1 }
    Mock Read-SwitchManifest { New-Manifest }
    Mock Read-SwitchConfirmation { 'HABILITAR MANUFACTURA' }
    Mock Publish-DaubertOverlay { [pscustomobject]@{ UltimoPaso = 'P6'; Resultado = 'Publicada'; Sha256 = $script:Sha } }
    Mock Invoke-SwitchCompose { 0 }
    Mock Test-SwitchPost { @() }
    Mock Invoke-SwitchToOff { '' }
    Mock Write-Host { }
}

Describe 'Test-SwitchEvidence: solo el PASS completo de PreEnable del commit en ejecucion' {
    $now = (Get-Date).ToUniversalTime()
    Context 'valida' { It 'sin motivos' { @(Test-SwitchEvidence (New-Evidence) 0.1 2 'abc1234' $now).Count | Should Be 0 } }
    $bad = @(
        @{ n = 'ausente'; t = $null; a = 0 }, @{ n = 'antigua por archivo'; t = (New-Evidence); a = 3 },
        @{ n = 'PARTIAL'; t = (New-Evidence -Verdict 'PARTIAL' -Profile 'diagnostico'); a = 0 }, @{ n = 'fase PreDeploy'; t = (New-Evidence -Phase 'PreDeploy'); a = 0 },
        @{ n = 'otro commit'; t = (New-Evidence -Commit 'fff0000'); a = 0 }, @{ n = 'grupos incompletos'; t = (New-Evidence -Groups 'bd,respaldo'); a = 0 },
        @{ n = 'faltan'; t = (New-Evidence -Missing 'nginx'); a = 0 }, @{ n = 'dos lineas'; t = ((New-Evidence) + "`n" + (New-Evidence)); a = 0 },
        @{ n = 'fecha futura'; t = (New-Evidence -When $now.AddHours(1)); a = 0 }, @{ n = 'fecha interna antigua'; t = (New-Evidence -When $now.AddHours(-3)); a = 0 },
        @{ n = 'formato anterior'; t = 'MANUFACTURA_READINESS_PASS phase=PreEnable'; a = 0 }
    )
    foreach ($c in $bad) { Context $c.n { It 'se rechaza' { @(Test-SwitchEvidence $c.t $c.a 2 'abc1234' $now).Count | Should BeGreaterThan 0 } } }
}

Describe 'Test-SwitchEnableGate: cualquier motivo bloquea' {
    Context 'contexto correcto' { It 'sin motivos' { @(Test-SwitchEnableGate (New-Ctx) $script:Sha $script:PolM @()).Count | Should Be 0 } }
    $cases = @(
        @{ n = 'sesion contaminada'; f = { param($c) $c.Hazards = @('MANUFACTURING_ENABLED') }; m = 'La sesion define' },
        @{ n = 'arbol sucio'; f = { param($c) $c.Dirty = @(' M x') }; m = 'no esta limpio' },
        @{ n = 'health caido'; f = { param($c) $c.Health = $null }; m = 'No responde' },
        @{ n = 'otro commit en ejecucion'; f = { param($c) $c.Health.commit = 'fff0000' }; m = 'no es HEAD' },
        @{ n = 'imagen api distinta'; f = { param($c) $c.Api.Digest = 'sha256:otra' }; m = 'api: la imagen en ejecucion' },
        @{ n = 'imagen web distinta'; f = { param($c) $c.Web.Digest = '' }; m = 'web: la imagen en ejecucion' },
        @{ n = 'base habilita'; f = { param($c) $c.Base.Errores = @('BASE_HABILITA') }; m = 'archivo base' },
        @{ n = 'base ilegible'; f = { param($c) $c.Base = $null }; m = 'pilot.prod.env' },
        @{ n = 'overlay con otro sha'; f = { param($c) $c.Overlay.Preparada.Sha256 = ('0' * 64) }; m = 'overlay preparado' },
        @{ n = 'overlay no canonico'; f = { param($c) $c.Overlay.Preparada.Valida = $false }; m = 'overlay preparado' },
        @{ n = 'overlay activo ya existe'; f = { param($c) $c.Overlay.Activa.Existe = $true }; m = 'overlay activo' },
        @{ n = 'temporales'; f = { param($c) $c.Overlay.Temporales = @('x.tmp') }; m = 'temporales' },
        @{ n = 'api ya encendida'; f = { param($c) $c.ApiEstado = 'Encendido' }; m = 'no esta apagada' },
        @{ n = 'api indeterminada'; f = { param($c) $c.ApiEstado = 'Indeterminado' }; m = 'no esta apagada' },
        @{ n = 'ventana abierta'; f = { param($c) $c.ClosureSha = 'abierto' }; m = 'no esta cerrada' }
    )
    foreach ($c in $cases) { Context $c.n { It ('bloquea: ' + $c.m) { $ctx = New-Ctx; & $c.f $ctx; ((Test-SwitchEnableGate $ctx $script:Sha $script:PolM @()) -join ' | ') | Should Match $c.m } } }
    Context 'motivos de evidencia vacios llegan como null' { It 'no bloquean' { @(Test-SwitchEnableGate (New-Ctx) $script:Sha $script:PolM $null).Count | Should Be 0; @(Test-SwitchEnableGate (New-Ctx) $script:Sha $script:PolM @()).Count | Should Be 0 } }
    Context 'sin SHA autorizados' { It 'bloquea' { @(Test-SwitchEnableGate (New-Ctx) '' '' @()).Count | Should Be 2 } }
    Context 'politica de cierre autorizada distinta' { It 'bloquea' { ((Test-SwitchEnableGate (New-Ctx) $script:Sha ('1' * 64) @()) -join ' ') | Should Match 'no esta cerrada' } }
}

Describe 'Invoke-SwitchMain -Enable: transicion supervisada con compensacion' {
    Context 'sin -Apply' { It 'valida y no muta' { Set-FlowMocks (New-Ctx); Invoke-SwitchMain (New-Params @{ Apply = $false }) | Should Be 0; Assert-MockCalled Publish-DaubertOverlay -Times 0 -Exactly; Assert-MockCalled Invoke-SwitchCompose -Times 0 -Exactly } }
    Context 'camino feliz' { It 'publica, recrea solo api con overlay y verifica' { Set-FlowMocks (New-Ctx); Invoke-SwitchMain (New-Params) | Should Be 0; Assert-MockCalled Invoke-SwitchCompose -Times 1 -Exactly -ParameterFilter { $WithOverlay -eq $true }; Assert-MockCalled Invoke-SwitchToOff -Times 0 -Exactly } }
    Context 'compuerta' { It 'bloquea antes de pedir confirmacion' { $c = New-Ctx; $c.ApiEstado = 'Encendido'; Set-FlowMocks $c; Invoke-SwitchMain (New-Params) | Should Be 1; Assert-MockCalled Read-SwitchConfirmation -Times 0 -Exactly; Assert-MockCalled Publish-DaubertOverlay -Times 0 -Exactly } }
    Context 'evidencia PARTIAL' { It 'bloquea' { Set-FlowMocks (New-Ctx) (New-Evidence -Verdict 'PARTIAL'); Invoke-SwitchMain (New-Params) | Should Be 1; Assert-MockCalled Publish-DaubertOverlay -Times 0 -Exactly } }
    Context 'frase incorrecta' { It 'no muta' { Set-FlowMocks (New-Ctx); Mock Read-SwitchConfirmation { 'si' }; Invoke-SwitchMain (New-Params) | Should Be 1; Assert-MockCalled Publish-DaubertOverlay -Times 0 -Exactly } }
    Context 'el estado cambia despues de confirmar (TOCTOU)' {
        It 'no muta' {
            Set-FlowMocks (New-Ctx); $script:Calls = 0
            Mock Get-SwitchContext { $script:Calls++; $c = New-Ctx; if ($script:Calls -gt 1) { $c.Web.ContainerId = 'c-web-nuevo' }; $c }
            Invoke-SwitchMain (New-Params) | Should Be 1; Assert-MockCalled Publish-DaubertOverlay -Times 0 -Exactly
        }
    }
    Context 'fallo al publicar el overlay (P1-P5)' { It 'no recrea nada y devuelve 1' { Set-FlowMocks (New-Ctx); Mock Publish-DaubertOverlay { throw 'P5 acceso denegado' }; Invoke-SwitchMain (New-Params) | Should Be 1; Assert-MockCalled Invoke-SwitchCompose -Times 0 -Exactly; Assert-MockCalled Invoke-SwitchToOff -Times 0 -Exactly } }
    Context 'overlay activo no verificado (P6)' { It 'compensa sin recrear con overlay' { Set-FlowMocks (New-Ctx); Mock Publish-DaubertOverlay { [pscustomobject]@{ UltimoPaso = 'P6'; Resultado = 'ActivaNoVerificada'; Sha256 = 'x' } }; Invoke-SwitchMain (New-Params) | Should Be 5; Assert-MockCalled Invoke-SwitchCompose -Times 0 -Exactly; Assert-MockCalled Invoke-SwitchToOff -Times 1 -Exactly -ParameterFilter { $Motivo -eq 'failed' } } }
    Context 'compose con overlay falla' { It 'compensa y devuelve 5' { Set-FlowMocks (New-Ctx); Mock Invoke-SwitchCompose { 1 }; Invoke-SwitchMain (New-Params) | Should Be 5; Assert-MockCalled Invoke-SwitchToOff -Times 1 -Exactly } }
    Context 'postcheck falla (api no healthy, flag no encendido o web recreado)' { It 'compensa y devuelve 5' { Set-FlowMocks (New-Ctx); Mock Test-SwitchPost { @('api no quedo healthy') }; Invoke-SwitchMain (New-Params) | Should Be 5; Assert-MockCalled Invoke-SwitchToOff -Times 1 -Exactly } }
    Context 'la compensacion falla' { It 'devuelve 6 (indeterminado -> R2)' { Set-FlowMocks (New-Ctx); Mock Invoke-SwitchCompose { 1 }; Mock Invoke-SwitchToOff { 'docker compose up (sin overlay) fallo.' }; Invoke-SwitchMain (New-Params) | Should Be 6 } }
    Context 'bloqueo ocupado' { It 'devuelve 1 sin leer estado' { Set-FlowMocks (New-Ctx); Mock Enter-DaubertOperationLock { throw 'DAUBERT_LOCK_OCUPADO: otra operacion' }; Invoke-SwitchMain (New-Params) | Should Be 1; Assert-MockCalled Get-SwitchContext -Times 0 -Exactly } }
    Context 'uso' { It 'sin -Enable ni -Disable devuelve 3' { Mock Write-Host { }; Invoke-SwitchMain (New-Params @{ Enable = $false }) | Should Be 3 } }
}

Describe 'Invoke-SwitchMain -Disable: es la reversion' {
    Context 'sin evidencia' { It 'apaga y devuelve 0' { $c = New-Ctx; $c.ApiEstado = 'Encendido'; Set-FlowMocks $c; Invoke-SwitchMain (New-Params @{ Enable = $false; Disable = $true; ReadinessEvidence = '' }) | Should Be 0; Assert-MockCalled Invoke-SwitchToOff -Times 1 -Exactly -ParameterFilter { $Motivo -eq 'disabled' } } }
    Context 'no verifica apagado' { It 'devuelve 6' { Set-FlowMocks (New-Ctx); Mock Invoke-SwitchToOff { 'api no quedo healthy' }; Invoke-SwitchMain (New-Params @{ Enable = $false; Disable = $true }) | Should Be 6 } }
    Context 'sesion contaminada' { It 'bloquea' { $c = New-Ctx; $c.Hazards = @('DOCKER_HOST'); Set-FlowMocks $c; Invoke-SwitchMain (New-Params @{ Enable = $false; Disable = $true }) | Should Be 1; Assert-MockCalled Invoke-SwitchToOff -Times 0 -Exactly } }
}

Describe 'Invoke-SwitchToOff: retiro + recreacion con OFF forzado + verificacion; ultimo recurso detener api' {
    Context 'ok' { It 'devuelve vacio y recrea con OFF forzado' { Mock Unpublish-DaubertOverlay { [pscustomobject]@{ Resultado = 'Retirada' } }; Mock Invoke-SwitchCompose { 0 }; Mock Test-SwitchPost { @() }; $script:Paths = Get-DaubertOpsPaths -Root $TestDrive; Invoke-SwitchToOff (New-Ctx) 'x' 5 | Should Be ''; Assert-MockCalled Invoke-SwitchCompose -Times 1 -Exactly -ParameterFilter { $WithOverlay -eq $false -and $ForceOff -eq $true -and $Verb -eq 'up' } } }
    Context 'retiro del overlay falla (hallazgo 3)' {
        It 'igual recrea con OFF forzado y, si queda apagada, informa el problema del overlay' {
            Mock Unpublish-DaubertOverlay { throw 'bloqueado' }; Mock Invoke-SwitchCompose { 0 }; Mock Test-SwitchPost { @() }; Mock Invoke-SwitchStopApi { 0 }; Mock Invoke-SwitchRead { @{ Code = 0; Out = @('false') } }
            $script:Paths = Get-DaubertOpsPaths -Root $TestDrive
            $m = Invoke-SwitchToOff (New-Ctx) 'x' 5
            $m | Should Match 'no se pudo retirar'
            Assert-MockCalled Invoke-SwitchCompose -Times 1 -Exactly -ParameterFilter { $ForceOff -eq $true -and $Verb -eq 'up' }
        }
    }
    Context 'compose OFF falla (hallazgo 3)' {
        It 'detiene el contenedor api como ultimo recurso y lo verifica' {
            Mock Unpublish-DaubertOverlay { [pscustomobject]@{ Resultado = 'Retirada' } }
            Mock Invoke-SwitchCompose { 1 }; Mock Invoke-SwitchStopApi { 0 }
            Mock Invoke-SwitchRead { @{ Code = 0; Out = @('false') } }
            $script:Paths = Get-DaubertOpsPaths -Root $TestDrive
            $m = Invoke-SwitchToOff (New-Ctx) 'x' 5
            $m | Should Match 'fallo'; $m | Should Match 'DETENIDO \(verificado\)'
            Assert-MockCalled Invoke-SwitchStopApi -Times 1 -Exactly
        }
        It 'si ni siquiera puede detenerlo lo dice' {
            Mock Unpublish-DaubertOverlay { [pscustomobject]@{ Resultado = 'Retirada' } }; Mock Invoke-SwitchCompose { 1 }; Mock Invoke-SwitchStopApi { 1 }; Mock Invoke-SwitchRead { @{ Code = 0; Out = @('true') } }
            $script:Paths = Get-DaubertOpsPaths -Root $TestDrive
            Invoke-SwitchToOff (New-Ctx) 'x' 5 | Should Match 'NO se pudo detener'
        }
    }
    Context 'no queda apagada' { It 'informa e intenta detener' { Mock Unpublish-DaubertOverlay { [pscustomobject]@{ Resultado = 'Retirada' } }; Mock Invoke-SwitchCompose { 0 }; Mock Test-SwitchPost { @('api no quedo healthy con Manufactura Apagado.') }; Mock Invoke-SwitchRead { @{ Code = 0; Out = @('false') } }; $script:Paths = Get-DaubertOpsPaths -Root $TestDrive; Mock Invoke-SwitchStopApi { 0 }; Invoke-SwitchToOff (New-Ctx) 'x' 5 | Should Match 'healthy'; Assert-MockCalled Invoke-SwitchStopApi -Times 1 -Exactly } }
    Context 'excepcion al recrear' { It 'no se escapa: informa y detiene' { Mock Unpublish-DaubertOverlay { [pscustomobject]@{ Resultado = 'Retirada' } }; Mock Invoke-SwitchCompose { throw 'boom' }; Mock Invoke-SwitchStopApi { 0 }; Mock Invoke-SwitchRead { @{ Code = 1; Out = @() } }; $script:Paths = Get-DaubertOpsPaths -Root $TestDrive; Invoke-SwitchToOff (New-Ctx) 'x' 5 | Should Match 'error al recrear' } }
}
Describe 'Invoke-SwitchCompose: solo api, sin build, entorno saneado' {
    Context 'argumentos' {
        It 'con overlay agrega el segundo --env-file; nunca --build ni web' {
            function docker { $script:DockerArgs = $args; $global:LASTEXITCODE = 0 }
            Mock Write-Host { }
            Invoke-SwitchCompose $true 'C:\o\manufactura.env' | Should Be 0
            $j = ($script:DockerArgs -join ' ')
            $j | Should Match '--env-file deploy/pilot.prod.env --env-file C:\\o\\manufactura.env'
            $j | Should Match 'up -d --no-build --no-deps api$'
            $j | Should Not Match ' web'
            Invoke-SwitchCompose $false '' | Should Be 0
            ($script:DockerArgs -join ' ') | Should Not Match 'manufactura.env'
        }
        It 'no hereda MANUFACTURING_ENABLED de la sesion' {
            function docker { $script:SeenFlag = [Environment]::GetEnvironmentVariable('MANUFACTURING_ENABLED', 'Process'); $global:LASTEXITCODE = 0 }
            Mock Write-Host { }
            $env:MANUFACTURING_ENABLED = 'true'
            try { $null = Invoke-SwitchCompose $false ''; [string]::IsNullOrEmpty($script:SeenFlag) | Should Be $true; $env:MANUFACTURING_ENABLED | Should Be 'true' } finally { Remove-Item Env:\MANUFACTURING_ENABLED -ErrorAction SilentlyContinue }
        }
    }
}

Describe 'Hallazgos de la revision independiente (regresiones)' {
    Context 'H1: la evidencia caduca o se reemplaza mientras la confirmacion esta abierta' {
        It 'se revalida tras confirmar y no publica' {
            Set-FlowMocks (New-Ctx); $script:EvReads = 0
            Mock Read-SwitchText { $script:EvReads++; if ($script:EvReads -gt 1) { New-Evidence -Verdict 'PARTIAL' -Profile 'diagnostico' } else { New-Evidence } } -ParameterFilter { $Path -eq 'C:\fuera\readiness.txt' }
            Invoke-SwitchMain (New-Params) | Should Be 1
            Assert-MockCalled Publish-DaubertOverlay -Times 0 -Exactly
        }
        It 'tambien si el archivo envejece pasado el maximo' {
            Set-FlowMocks (New-Ctx); $script:AgeReads = 0
            Mock Get-SwitchFileAgeHours { $script:AgeReads++; if ($script:AgeReads -gt 1) { 5 } else { 0.1 } }
            Invoke-SwitchMain (New-Params) | Should Be 1
            Assert-MockCalled Publish-DaubertOverlay -Times 0 -Exactly
        }
    }
    Context 'H2: una excepcion despues de publicar pasa por la compensacion' {
        It 'compensa y devuelve 5' {
            Set-FlowMocks (New-Ctx); Mock Test-SwitchPost { throw 'La propiedad commit no existe' }
            Invoke-SwitchMain (New-Params) | Should Be 5
            Assert-MockCalled Invoke-SwitchToOff -Times 1 -Exactly -ParameterFilter { $Motivo -eq 'failed' }
        }
    }
    Context 'H2b: health sin commit' {
        It 'Test-SwitchPost no lanza si health no trae commit' {
            Mock Wait-SwitchApi { $true }
            Mock Get-SwitchContext { $c = New-Ctx; $c.Health = [pscustomobject]@{ status = 'ok' }; $c }
            $script:Paths = Get-DaubertOpsPaths -Root $TestDrive
            @(Test-SwitchPost (New-Ctx) 'Encendido' 5).Count | Should Be 0   # H6: sin health via nginx (puede apuntar a la api vieja hasta el Reload)
        }
    }
    Context 'H4: OFF forzado independiente del archivo base' {
        It 'el proceso docker ve MANUFACTURING_ENABLED=false y EMISSION=PRODUCCION (OFF valido en PROD); la sesion queda como estaba' {
            function docker { $script:SeenEnabled = [Environment]::GetEnvironmentVariable('MANUFACTURING_ENABLED', 'Process'); $script:SeenEmission = [Environment]::GetEnvironmentVariable('MANUFACTURING_EMISSION_ENV', 'Process'); $global:LASTEXITCODE = 0 }
            Mock Write-Host { }
            $null = Invoke-SwitchCompose $false '' $true 'up'
            $script:SeenEnabled | Should Be 'false'
            $script:SeenEmission | Should Be 'PRODUCCION'
            [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('MANUFACTURING_EMISSION_ENV', 'Process')) | Should Be $true
            [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('MANUFACTURING_ENABLED', 'Process')) | Should Be $true
        }
        It 'el ultimo recurso detiene el contenedor api directamente' {
            function docker { $script:DockerArgs = $args; $global:LASTEXITCODE = 0 }
            Mock Write-Host { }
            Invoke-SwitchStopApi | Should Be 0
            ($script:DockerArgs -join ' ') | Should Be 'stop daubert-hub-api-1'
        }
        It 'H3: un inspect fallido NO cuenta como detenido; solo Running=false' {
            Mock Invoke-SwitchRead { @{ Code = 1; Out = @() } }; Test-SwitchApiStopped | Should Be $false
            Mock Invoke-SwitchRead { @{ Code = 0; Out = @('true') } }; Test-SwitchApiStopped | Should Be $false
            Mock Invoke-SwitchRead { @{ Code = 0; Out = @('false') } }; Test-SwitchApiStopped | Should Be $true
        }
    }
    Context 'H5: Nginx debe bloquear en vivo' {
        It 'una sonda que llega a la API (401) bloquea aunque el archivo sea la politica cerrada' { $c = New-Ctx; $c.ClosureProbe = [pscustomobject]@{ Code = 401; Closed = $false }; ((Test-SwitchEnableGate $c $script:Sha $script:PolM @()) -join ' ') | Should Match 'no bloquea en vivo' }
        It 'sin respuesta bloquea' { $c = New-Ctx; $c.ClosureProbe = $null; ((Test-SwitchEnableGate $c $script:Sha $script:PolM @()) -join ' ') | Should Match 'no bloquea en vivo' }
        It 'Set-EntryClosure toma el mismo bloqueo de operacion para toda accion salvo Status' {
            $s = [IO.File]::ReadAllText((Join-Path $here '..\Set-EntryClosure.ps1'))
            $s | Should Match "if \(\`$Action -ne 'Status'\) \{ \`$opLock = Enter-DaubertOperationLock"
            $s | Should Match '\} finally \{ Exit-DaubertOperationLock \$opLock \}'
        }
    }
    Context 'H6: :latest debe ser la misma imagen validada' {
        It 'bloquea si :latest de api apunta a otra imagen' { $c = New-Ctx; $c.LatestTags['api'] = 'sha256:otra'; ((Test-SwitchEnableGate $c $script:Sha $script:PolM @()) -join ' ') | Should Match ':latest apunta a otra imagen' }
        It 'bloquea si :latest de web no existe' { $c = New-Ctx; $c.LatestTags['web'] = ''; ((Test-SwitchEnableGate $c $script:Sha $script:PolM @()) -join ' ') | Should Match 'web: la imagen en ejecucion' }
    }
    Context 'H8: no se imprime la salida cruda de Compose' {
        It 'un secreto en la salida de docker no llega a la consola' {
            function docker { 'failed to read deploy/pilot.prod.env: line 3: DB_PASSWORD=SENTINEL_SECRET_123'; $global:LASTEXITCODE = 1 }
            $script:Printed = @(); Mock Write-Host { $script:Printed += [string]$Object }
            Invoke-SwitchCompose $false '' | Should Be 1
            ($script:Printed -join "`n") | Should Not Match 'SENTINEL_SECRET_123'
        }
    }
}
Describe 'Hallazgo 4: el manifiesto autorizado fija las imagenes' {
    $ctx = New-Ctx
    Context 'valido' { It 'sin motivos' { @(Test-SwitchManifest (New-Manifest) $script:ManSha $ctx).Count | Should Be 0 } }
    Context 'etiquetas release y latest movidas juntas a otras imagenes' { It 'bloquea' { $c = New-Ctx; $c.ReleaseIds['api'] = 'sha256:otra'; ((Test-SwitchManifest (New-Manifest) $script:ManSha $c) -join ' ') | Should Match 'ya no es la imagen validada' } }
    Context 'SHA no autorizado' { It 'bloquea' { ((Test-SwitchManifest (New-Manifest -Sha ('b' * 64)) $script:ManSha $ctx) -join ' ') | Should Match 'no es el autorizado' } }
    Context 'sin SHA autorizado' { It 'bloquea' { ((Test-SwitchManifest (New-Manifest) '' $ctx) -join ' ') | Should Match 'obligatorio' } }
    Context 'manifiesto ausente' { It 'bloquea' { ((Test-SwitchManifest ([pscustomobject]@{ Exists = $false; Sha256 = ''; Json = $null }) $script:ManSha $ctx) -join ' ') | Should Match 'Falta el manifiesto' } }
    Context 'otro commit' { It 'bloquea' { ((Test-SwitchManifest (New-Manifest -Commit 'fff0000aaaa') $script:ManSha $ctx) -join ' ') | Should Match 'no es del commit' } }
    Context 'web sin interfaz' { It 'bloquea' { ((Test-SwitchManifest (New-Manifest -Ui $false) $script:ManSha $ctx) -join ' ') | Should Match 'interfaz de Manufactura' } }
    Context 'flujo' { It 'Enable se niega sin publicar' { Set-FlowMocks (New-Ctx); Mock Read-SwitchManifest { New-Manifest -ApiId 'sha256:distinta' }; Invoke-SwitchMain (New-Params) | Should Be 1; Assert-MockCalled Publish-DaubertOverlay -Times 0 -Exactly } }
}