# Pester 3.4 tests for scripts\deploy\DaubertOps.Common.psm1. Everything runs under TestDrive / temp: the real operational root is never touched.
# Run with:  Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\deploy\tests

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $here '..\DaubertOps.Common.psm1') -Force

$script:Canon = [System.Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRODUCCION`n")
$script:CanonSha = '3b540e4e9f3a335f6eed213a0af33c935f31fa01c687f5e6c9cad3d8aa23396a'
$script:Sentinel = 'SENTINEL_SECRET_123'
function New-Base { param([string]$Extra = '') return ("DB_HOST=db`nDB_NAME=daubert_global`nDB_PASSWORD=" + $script:Sentinel + "`n" + $Extra) }
function New-TestPaths { param([string]$Name) $root = Join-Path $TestDrive $Name; return (Get-DaubertOpsPaths -Root $root) }
function Set-Prepared { param($Paths, [byte[]]$Bytes) New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Paths.OverlayPreparada) | Out-Null; [IO.File]::WriteAllBytes($Paths.OverlayPreparada, $Bytes) }

Describe 'Rutas y huella del overlay canonico' {
    Context 'rutas' { It 'derivan del raiz indicado' { $p = Get-DaubertOpsPaths -Root 'C:\x'; $p.OverlayActiva | Should Be 'C:\x\manufactura\activa\manufactura.env'; $p.LockFile | Should Be 'C:\x\locks\operacion.lock' } }
    Context 'sha' { It 'el overlay canonico tiene el SHA del acta' { Get-DaubertBytesSha256 $script:Canon | Should Be $script:CanonSha } }
}

Describe 'Test-DaubertOverlayBytes: solo los 65 bytes canonicos' {
    Context 'canonico' { It 'es valido' { (Test-DaubertOverlayBytes $script:Canon).Valido | Should Be $true } }
    $cases = @(
        @{ n = 'BOM'; b = ([byte[]](0xEF, 0xBB, 0xBF) + $script:Canon) },
        @{ n = 'CRLF'; b = [Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=true`r`nMANUFACTURING_EMISSION_ENV=PRODUCCION`r`n") },
        @{ n = 'sin LF final'; b = [Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRODUCCION") },
        @{ n = 'linea vacia extra'; b = [Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRODUCCION`n`n") },
        @{ n = 'tercera linea'; b = [Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRODUCCION`nX=1`n") },
        @{ n = 'orden invertido'; b = [Text.Encoding]::ASCII.GetBytes("MANUFACTURING_EMISSION_ENV=PRODUCCION`nMANUFACTURING_ENABLED=true`n") },
        @{ n = 'True'; b = [Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=True`nMANUFACTURING_EMISSION_ENV=PRODUCCION`n") },
        @{ n = 'espacio final'; b = [Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRODUCCION `n") },
        @{ n = 'false'; b = [Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=false`nMANUFACTURING_EMISSION_ENV=PRODUCCION`n") },
        @{ n = 'vacio'; b = [byte[]]@() },
        @{ n = 'byte extra'; b = ($script:Canon + [byte[]](0x20)) }
    )
    foreach ($c in $cases) { Context $c.n { It 'es invalido' { (Test-DaubertOverlayBytes $c.b).Valido | Should Be $false } } }
}

Describe 'Get-DaubertEffectiveManufacturing: la base no habilita; el overlay si' {
    foreach ($v in @('MANUFACTURING_ENABLED=false', 'MANUFACTURING_ENABLED=', '')) {
        Context ('base "' + $v + '" + overlay') { It 'habilita' { (Get-DaubertEffectiveManufacturing (New-Base ($v + "`n")) $script:Canon).Habilita | Should Be $true } }
        Context ('base "' + $v + '" sin overlay') { It 'no habilita' { (Get-DaubertEffectiveManufacturing (New-Base ($v + "`n"))).Habilita | Should Be $false } }
    }
    Context 'base con EMISSION=PRODUCCION y ENABLED=false + overlay' { It 'habilita' { (Get-DaubertEffectiveManufacturing (New-Base "MANUFACTURING_ENABLED=false`nMANUFACTURING_EMISSION_ENV=PRODUCCION`n") $script:Canon).Habilita | Should Be $true } }
    Context 'comentario que menciona la clave' { It 'se ignora' { $r = Get-DaubertEffectiveManufacturing (New-Base "# MANUFACTURING_ENABLED=true (no usar)`n") $script:Canon; $r.Habilita | Should Be $true; @($r.Errores).Count | Should Be 0 } }
    $bad = @(
        @{ n = 'base true'; t = 'MANUFACTURING_ENABLED=true'; e = 'BASE_HABILITA' },
        @{ n = 'TRUE'; t = 'MANUFACTURING_ENABLED=TRUE'; e = 'BASE_VALOR_INVALIDO' },
        @{ n = '1'; t = 'MANUFACTURING_ENABLED=1'; e = 'BASE_VALOR_INVALIDO' },
        @{ n = 'comillas'; t = 'MANUFACTURING_ENABLED="false"'; e = 'BASE_SINTAXIS_MANUFACTURING_ENABLED' },
        @{ n = 'comilla simple'; t = "MANUFACTURING_ENABLED='false'"; e = 'BASE_SINTAXIS_MANUFACTURING_ENABLED' },
        @{ n = 'export'; t = 'export MANUFACTURING_ENABLED=false'; e = 'BASE_SINTAXIS_MANUFACTURING_ENABLED' },
        @{ n = 'espacios'; t = 'MANUFACTURING_ENABLED = false'; e = 'BASE_SINTAXIS_MANUFACTURING_ENABLED' },
        @{ n = 'comentario en linea'; t = 'MANUFACTURING_ENABLED=false # x'; e = 'BASE_SINTAXIS_MANUFACTURING_ENABLED' },
        @{ n = 'dos puntos'; t = 'MANUFACTURING_ENABLED: false'; e = 'BASE_SINTAXIS_MANUFACTURING_ENABLED' },
        @{ n = 'duplicada'; t = "MANUFACTURING_ENABLED=false`nMANUFACTURING_ENABLED=false"; e = 'BASE_DUPLICADA_MANUFACTURING_ENABLED' },
        @{ n = 'otra capitalizacion'; t = 'Manufacturing_Enabled=false'; e = 'BASE_SINTAXIS_MANUFACTURING_ENABLED' },
        @{ n = 'PRUEBA'; t = 'MANUFACTURING_EMISSION_ENV=PRUEBA'; e = 'BASE_EMISION_INVALIDA' }
    )
    foreach ($c in $bad) {
        Context ('negativo: ' + $c.n) { It ('rechaza con ' + $c.e + ' y no habilita') { $r = Get-DaubertEffectiveManufacturing (New-Base ($c.t + "`n")) $script:Canon; $r.Habilita | Should Be $false; ($r.Errores -contains $c.e) | Should Be $true } }
    }
    Context 'DB_NAME de TEST' { It 'rechaza' { $r = Get-DaubertEffectiveManufacturing "DB_NAME=daubert_hub_test`n" $script:Canon; $r.Habilita | Should Be $false; ($r.Errores -contains 'BASE_DB_NAME_NO_PRODUCCION') | Should Be $true } }
    Context 'overlay no canonico' { It 'no habilita' { (Get-DaubertEffectiveManufacturing (New-Base) ([Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=true`n"))).Habilita | Should Be $false } }
    Context 'no filtra secretos' { It 'el centinela no aparece en el resultado' { (Get-DaubertEffectiveManufacturing (New-Base) $script:Canon | ConvertTo-Json -Depth 10) | Should Not Match $script:Sentinel } }
}

Describe 'ConvertFrom-DaubertContainerEnv: solo tres claves' {
    $json = { param([string[]]$e) return ('[' + (($e | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']') }
    Context 'encendido' { It 'Encendido' { (ConvertFrom-DaubertContainerEnv (& $json @('DB_NAME=daubert_global', 'MANUFACTURING_ENABLED=true', 'MANUFACTURING_EMISSION_ENV=PRODUCCION', ('DB_PASSWORD=' + $script:Sentinel)))).Estado | Should Be 'Encendido' } }
    Context 'sin claves' { It 'Apagado' { (ConvertFrom-DaubertContainerEnv (& $json @('DB_NAME=daubert_global', 'MANUFACTURING_ENABLED='))).Estado | Should Be 'Apagado' } }
    Context 'true con PRUEBA' { It 'NoArrancaria' { (ConvertFrom-DaubertContainerEnv (& $json @('DB_NAME=daubert_global', 'MANUFACTURING_ENABLED=true', 'MANUFACTURING_EMISSION_ENV=PRUEBA'))).Estado | Should Be 'NoArrancaria' } }
    Context 'duplicada' { It 'Indeterminado' { (ConvertFrom-DaubertContainerEnv (& $json @('MANUFACTURING_ENABLED=true', 'MANUFACTURING_ENABLED=false'))).Estado | Should Be 'Indeterminado' } }
    Context 'JSON invalido' { It 'Indeterminado' { (ConvertFrom-DaubertContainerEnv '{no json').Estado | Should Be 'Indeterminado' } }
    Context 'nulo' { It 'Indeterminado' { (ConvertFrom-DaubertContainerEnv $null).Estado | Should Be 'Indeterminado' } }
    Context 'secretos' { It 'el centinela no aparece en el resultado' { (ConvertFrom-DaubertContainerEnv (& $json @(('DB_PASSWORD=' + $script:Sentinel), ('BIND_API_KEY=' + $script:Sentinel), 'MANUFACTURING_ENABLED=true')) | ConvertTo-Json -Depth 10) | Should Not Match $script:Sentinel } }
}

Describe 'Higiene de la sesion' {
    Context 'detecta por nombre, nunca por valor' {
        It 'informa MANUFACTURING_ENABLED y DOCKER_HOST definidas (aunque vacias en valor)' {
            $env:MANUFACTURING_ENABLED = $script:Sentinel; $env:DOCKER_HOST = 'x'
            try { $h = @(Get-DaubertSessionHazards); ($h -contains 'MANUFACTURING_ENABLED') | Should Be $true; ($h -contains 'DOCKER_HOST') | Should Be $true; ($h -join ',') | Should Not Match $script:Sentinel }
            finally { Remove-Item Env:\MANUFACTURING_ENABLED -ErrorAction SilentlyContinue; Remove-Item Env:\DOCKER_HOST -ErrorAction SilentlyContinue }
        }
    }
    Context 'saneamiento temporal' {
        It 'retira las variables dentro del bloque y las restaura despues, tambien con excepcion' {
            $env:COMPOSE_FILE = 'otro.yaml'
            try {
                $inside = Invoke-DaubertWithSanitizedEnvironment { [Environment]::GetEnvironmentVariable('COMPOSE_FILE', 'Process') }
                [string]::IsNullOrEmpty($inside) | Should Be $true
                $env:COMPOSE_FILE | Should Be 'otro.yaml'
                { Invoke-DaubertWithSanitizedEnvironment { throw 'falla' } } | Should Throw
                $env:COMPOSE_FILE | Should Be 'otro.yaml'
            } finally { Remove-Item Env:\COMPOSE_FILE -ErrorAction SilentlyContinue }
        }
    }
}

Describe 'Bloqueo cooperativo' {
    Context 'exclusion entre procesos y liberacion al morir el titular' {
        It 'otro proceso no lo obtiene mientras se tiene, si despues de Exit y si despues de matar al titular' {
            $lock = Join-Path $TestDrive 'locks\operacion.lock'
            $module = (Resolve-Path (Join-Path $here '..\DaubertOps.Common.psm1')).Path
            $probe = "Import-Module '$module'; try { `$h = Enter-DaubertOperationLock -Path '$lock' -Purpose sonda; Exit-DaubertOperationLock `$h; 'OBTENIDO' } catch { if (`$_.Exception.Message -like 'DAUBERT_LOCK_OCUPADO*') { 'OCUPADO' } else { 'ERROR ' + `$_.Exception.Message } }"
            $h = Enter-DaubertOperationLock -Path $lock -Purpose prueba
            try { (& powershell.exe -NoProfile -Command $probe) | Should Be 'OCUPADO' } finally { Exit-DaubertOperationLock $h }
            (& powershell.exe -NoProfile -Command $probe) | Should Be 'OBTENIDO'
            $holder = Start-Process powershell.exe -ArgumentList '-NoProfile', '-Command', "Import-Module '$module'; `$h = Enter-DaubertOperationLock -Path '$lock' -Purpose titular; Start-Sleep -Seconds 60" -PassThru -WindowStyle Hidden
            try {
                $deadline = (Get-Date).AddSeconds(20)
                while ((Get-Date) -lt $deadline -and -not (Get-DaubertOperationLockInfo $lock | Where-Object { $_.proposito -eq 'titular' })) { Start-Sleep -Milliseconds 200 }
                (& powershell.exe -NoProfile -Command $probe) | Should Be 'OCUPADO'
            } finally { Stop-Process -Id $holder.Id -Force -ErrorAction SilentlyContinue; $holder.WaitForExit() }
            (& powershell.exe -NoProfile -Command $probe) | Should Be 'OBTENIDO'
        }
    }
    Context 'contenido corrupto y Exit doble' {
        It 'un archivo de bloqueo con basura no impide obtenerlo; Exit dos veces es inocuo' {
            $lock = Join-Path $TestDrive 'locks2\operacion.lock'; New-Item -ItemType Directory -Force (Split-Path -Parent $lock) | Out-Null; [IO.File]::WriteAllText($lock, 'basura{')
            $h = Enter-DaubertOperationLock -Path $lock -Purpose prueba
            (Get-DaubertOperationLockInfo $lock).proposito | Should Be 'prueba'
            Exit-DaubertOperationLock $h; Exit-DaubertOperationLock $h
        }
    }
}

Describe 'Transicion supervisada del overlay: fallos entre cada paso' {
    Context 'camino feliz' {
        It 'publica, verifica y retira a historial' {
            $p = New-TestPaths 'feliz'; Set-Prepared $p $script:Canon
            (Publish-DaubertOverlay -Paths $p -ExpectedSha256 $script:CanonSha).Resultado | Should Be 'Publicada'
            $s = Get-DaubertOverlayState -Paths $p; $s.Activa.Valida | Should Be $true; $s.Coherente | Should Be $true
            (Unpublish-DaubertOverlay -Paths $p -Motivo 'disabled').Resultado | Should Be 'Retirada'
            (Get-DaubertOverlayState -Paths $p).Activa.Existe | Should Be $false
            @(Get-ChildItem $p.OverlayHistorialDir).Count | Should Be 1
        }
    }
    Context 'P1 preparada ausente' { It 'falla sin temporal ni activa' { $p = New-TestPaths 'p1a'; { Publish-DaubertOverlay -Paths $p -ExpectedSha256 $script:CanonSha } | Should Throw 'P1 PREPARADA_AUSENTE'; Test-Path $p.OverlayActiva | Should Be $false } }
    Context 'P1 preparada no canonica' { It 'falla' { $p = New-TestPaths 'p1b'; Set-Prepared $p ([Text.Encoding]::ASCII.GetBytes("MANUFACTURING_ENABLED=true`n")); { Publish-DaubertOverlay -Paths $p -ExpectedSha256 $script:CanonSha } | Should Throw 'P1 PREPARADA_NO_CANONICA'; Test-Path $p.OverlayActiva | Should Be $false } }
    Context 'P1 SHA autorizado distinto' { It 'falla' { $p = New-TestPaths 'p1c'; Set-Prepared $p $script:Canon; { Publish-DaubertOverlay -Paths $p -ExpectedSha256 ('0' * 64) } | Should Throw 'P1 PREPARADA_SHA_DISTINTO' } }
    Context 'P2 activa ya existe' {
        It 'no toca la activa existente' {
            $p = New-TestPaths 'p2'; Set-Prepared $p $script:Canon; New-Item -ItemType Directory -Force $p.OverlayActivaDir | Out-Null; [IO.File]::WriteAllBytes($p.OverlayActiva, [byte[]](1, 2, 3))
            { Publish-DaubertOverlay -Paths $p -ExpectedSha256 $script:CanonSha } | Should Throw 'P2 ACTIVA_YA_EXISTE'
            ([IO.File]::ReadAllBytes($p.OverlayActiva) -join ',') | Should Be '1,2,3'
        }
    }
    Context 'P3 fallo al escribir el temporal' {
        It 'sin temporal ni activa' {
            Mock -ModuleName DaubertOps.Common Write-OverlayTemp { throw 'disco lleno' }
            $p = New-TestPaths 'p3'; Set-Prepared $p $script:Canon
            { Publish-DaubertOverlay -Paths $p -ExpectedSha256 $script:CanonSha } | Should Throw 'disco lleno'
            $s = Get-DaubertOverlayState -Paths $p; $s.Activa.Existe | Should Be $false; @($s.Temporales).Count | Should Be 0
        }
    }
    Context 'P4 temporal alterado' {
        It 'borra su temporal y no activa' {
            Mock -ModuleName DaubertOps.Common Write-OverlayTemp { param([string]$Path, [byte[]]$Bytes) [IO.File]::WriteAllBytes($Path, [byte[]](9, 9)) }
            $p = New-TestPaths 'p4'; Set-Prepared $p $script:Canon
            { Publish-DaubertOverlay -Paths $p -ExpectedSha256 $script:CanonSha } | Should Throw 'P4 TEMPORAL_SHA_DISTINTO'
            $s = Get-DaubertOverlayState -Paths $p; $s.Activa.Existe | Should Be $false; @($s.Temporales).Count | Should Be 0
        }
    }
    Context 'P5 fallo al renombrar' {
        It 'borra su temporal y no activa' {
            Mock -ModuleName DaubertOps.Common Move-OverlayFile { throw 'acceso denegado' }
            $p = New-TestPaths 'p5'; Set-Prepared $p $script:Canon
            { Publish-DaubertOverlay -Paths $p -ExpectedSha256 $script:CanonSha } | Should Throw 'acceso denegado'
            $s = Get-DaubertOverlayState -Paths $p; $s.Activa.Existe | Should Be $false; @($s.Temporales).Count | Should Be 0
        }
    }
    Context 'P6 activa no verificada' {
        It 'informa ActivaNoVerificada y el retiro deja el estado coherente' {
            Mock -ModuleName DaubertOps.Common Move-OverlayFile { param([string]$From, [string]$To) [IO.File]::WriteAllBytes($To, [byte[]](7)); Remove-Item -LiteralPath $From }
            $p = New-TestPaths 'p6'; Set-Prepared $p $script:Canon
            (Publish-DaubertOverlay -Paths $p -ExpectedSha256 $script:CanonSha).Resultado | Should Be 'ActivaNoVerificada'
            (Get-DaubertOverlayState -Paths $p).Coherente | Should Be $false
        }
        It 'Unpublish retira la activa no verificada' {
            $p = New-TestPaths 'p6b'; New-Item -ItemType Directory -Force $p.OverlayActivaDir | Out-Null; [IO.File]::WriteAllBytes($p.OverlayActiva, [byte[]](7))
            (Unpublish-DaubertOverlay -Paths $p -Motivo 'no-verificada').Resultado | Should Be 'Retirada'
            $s = Get-DaubertOverlayState -Paths $p; $s.Activa.Existe | Should Be $false; $s.Coherente | Should Be $true
        }
    }
    Context 'proceso muerto entre P3 y P5 (temporal huerfano)' {
        It 'el estado lo marca incoherente y la limpieza solo borra temporales' {
            $p = New-TestPaths 'huerfano'; Set-Prepared $p $script:Canon; New-Item -ItemType Directory -Force $p.OverlayActivaDir | Out-Null
            [IO.File]::WriteAllBytes((Join-Path $p.OverlayActivaDir 'manufactura.env.abc.tmp'), $script:Canon)
            $s = Get-DaubertOverlayState -Paths $p; $s.Coherente | Should Be $false; @($s.Temporales).Count | Should Be 1
            Clear-DaubertOverlayTemporales -Paths $p | Should Be 1
            $s = Get-DaubertOverlayState -Paths $p; $s.Coherente | Should Be $true; $s.Preparada.Valida | Should Be $true; $s.Activa.Existe | Should Be $false
        }
    }
    Context 'retiro con colision de nombre en historial' {
        It 'agrega sufijo y no sobrescribe' {
            $p = New-TestPaths 'colision'; New-Item -ItemType Directory -Force $p.OverlayActivaDir, $p.OverlayHistorialDir | Out-Null
            [IO.File]::WriteAllBytes($p.OverlayActiva, $script:Canon); $first = (Unpublish-DaubertOverlay -Paths $p -Motivo 'x').Destino
            [IO.File]::WriteAllBytes($p.OverlayActiva, $script:Canon)
            Mock -ModuleName DaubertOps.Common Get-Date { [datetime]'2026-11-19T12:00:00Z' }
            $null = Unpublish-DaubertOverlay -Paths $p -Motivo 'x'
            [IO.File]::WriteAllBytes($p.OverlayActiva, $script:Canon); $third = (Unpublish-DaubertOverlay -Paths $p -Motivo 'x').Destino
            $third | Should Match '-x-1\.env$'
            @(Get-ChildItem $p.OverlayHistorialDir).Count | Should Be 3
            Test-Path $first | Should Be $true
        }
    }
    Context 'retiro cuando el movimiento falla' {
        It 'lanza y la activa sigue presente' {
            Mock -ModuleName DaubertOps.Common Move-OverlayFile { throw 'bloqueado' }
            $p = New-TestPaths 'retirofalla'; New-Item -ItemType Directory -Force $p.OverlayActivaDir | Out-Null; [IO.File]::WriteAllBytes($p.OverlayActiva, $script:Canon)
            { Unpublish-DaubertOverlay -Paths $p -Motivo 'x' } | Should Throw 'bloqueado'
            Test-Path $p.OverlayActiva | Should Be $true
        }
    }
}

Describe 'Politica de cierre con Manufactura habilitada (Set-EntryClosure -Action Close)' {
    $matrix = @(
        @{ ov = $false; api = 'Apagado'; e = 'Apagada' }, @{ ov = $true; api = 'Apagado'; e = 'Habilitada' }, @{ ov = $false; api = 'Encendido'; e = 'Habilitada' },
        @{ ov = $false; api = 'Indeterminado'; e = 'Indeterminada' }, @{ ov = $false; api = 'NoArrancaria'; e = 'Indeterminada' }, @{ ov = $true; api = 'Indeterminado'; e = 'Habilitada' }
    )
    foreach ($m in $matrix) { Context ("overlay=" + $m.ov + " api=" + $m.api) { It ('estado ' + $m.e) { Get-DaubertManufacturingRuntimeState -OverlayActivaExiste $m.ov -ContainerEstado $m.api | Should Be $m.e } } }
    Context 'apagada: comportamiento historico' { It 'admite Operativa y Manufactura' { Test-DaubertClosurePolicyAllowed -Policy Operativa -Estado Apagada | Should BeNullOrEmpty; Test-DaubertClosurePolicyAllowed -Policy Manufactura -Estado Apagada | Should BeNullOrEmpty } }
    Context 'habilitada' { It 'rechaza Operativa y admite Manufactura' { Test-DaubertClosurePolicyAllowed -Policy Operativa -Estado Habilitada | Should Match 'HABILITADA'; Test-DaubertClosurePolicyAllowed -Policy Manufactura -Estado Habilitada | Should BeNullOrEmpty } }
    Context 'indeterminada' { It 'falla cerrado: rechaza Operativa, admite Manufactura' { Test-DaubertClosurePolicyAllowed -Policy Operativa -Estado Indeterminada | Should Match 'No se pudo determinar'; Test-DaubertClosurePolicyAllowed -Policy Manufactura -Estado Indeterminada | Should BeNullOrEmpty } }
    Context 'compatibilidad Pagos y Caterpillar' {
        It 'ambas politicas siguen bloqueando Pagos y Caterpillar y solo la de Manufactura bloquea sus rutas' {
            $root = Join-Path $here '..\..\..\deploy\closure'
            $op = [IO.File]::ReadAllText((Join-Path $root 'entry-closure-policy.conf')); $mf = [IO.File]::ReadAllText((Join-Path $root 'entry-closure-policy.manufactura.conf'))
            foreach ($t in @($op, $mf)) { $t | Should Match 'payment-notifications\|remissions/caterpillar'; $t | Should Match 'return 503;' }
            $op | Should Not Match 'manufacturing-sheets\(\?:/\|\$\)'
            $mf | Should Match '~\*\^/api/manufacturing-sheets\(\?:/\|\$\) 1;'
        }
        It 'el guard solo actua en Close y las sondas de Pagos y Caterpillar no cambiaron' {
            $s = [IO.File]::ReadAllText((Join-Path $here '..\Set-EntryClosure.ps1'))
            $s | Should Match "if \(\`$Action -eq 'Close'\) \{"
            foreach ($r in @('/api/automations/payment-notifications/0/reprocess', '/api/automations/remissions/caterpillar/executions/0/reprocess', '/api/automations/remissions/caterpillar/executions/0/remittances/0/cancel', '/api/companies/0/aliases/payment-notifications')) { $s.Contains($r) | Should Be $true }
        }
    }
}
Describe 'Hallazgos de la revision independiente (modulo)' {
    $json = { param([string[]]$e) return ('[' + (($e | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']') }
    Context 'H9: espejo de resolveManufacturing' {
        It 'TEST sin banderas => Encendido (habilitado por omision)' { (ConvertFrom-DaubertContainerEnv (& $json @('DB_NAME=daubert_hub_test'))).Estado | Should Be 'Encendido' }
        It 'TEST con ENABLED=false => Apagado' { (ConvertFrom-DaubertContainerEnv (& $json @('DB_NAME=daubert_hub_test', 'MANUFACTURING_ENABLED=false'))).Estado | Should Be 'Apagado' }
        It 'TEST con PRODUCCION => NoArrancaria' { (ConvertFrom-DaubertContainerEnv (& $json @('DB_NAME=daubert_hub_test', 'MANUFACTURING_EMISSION_ENV=PRODUCCION'))).Estado | Should Be 'NoArrancaria' }
        It 'sin DB_NAME => Indeterminado' { (ConvertFrom-DaubertContainerEnv (& $json @('MANUFACTURING_ENABLED=false'))).Estado | Should Be 'Indeterminado' }
        It 'otra base con true => NoArrancaria' { (ConvertFrom-DaubertContainerEnv (& $json @('DB_NAME=otra', 'MANUFACTURING_ENABLED=true'))).Estado | Should Be 'NoArrancaria' }
        It 'PROD con ENABLED vacio y EMISSION PRODUCCION => Apagado' { (ConvertFrom-DaubertContainerEnv (& $json @('DB_NAME=daubert_global', 'MANUFACTURING_ENABLED=', 'MANUFACTURING_EMISSION_ENV=PRODUCCION'))).Estado | Should Be 'Apagado' }
        It 'valor invalido => NoArrancaria' { (ConvertFrom-DaubertContainerEnv (& $json @('DB_NAME=daubert_global', 'MANUFACTURING_ENABLED=yes'))).Estado | Should Be 'NoArrancaria' }
        It 'con TEST encendido, Close Operativa se rechaza' { Test-DaubertClosurePolicyAllowed -Policy Operativa -Estado (Get-DaubertManufacturingRuntimeState -OverlayActivaExiste $false -ContainerEstado 'Encendido') | Should Match 'HABILITADA' }
    }
    Context 'H7: lectura fallida despues de renombrar' {
        It 'devuelve ActivaNoVerificada (no lanza) y la activa existe' {
            $p = Get-DaubertOpsPaths -Root (Join-Path $TestDrive 'h7'); New-Item -ItemType Directory -Force (Split-Path -Parent $p.OverlayPreparada) | Out-Null
            [IO.File]::WriteAllBytes($p.OverlayPreparada, $script:Canon)
            Mock -ModuleName DaubertOps.Common Read-OverlayBytes { param([string]$Path) if ($Path -like '*activa\manufactura.env') { throw 'compartido' }; [IO.File]::ReadAllBytes($Path) }
            (Publish-DaubertOverlay -Paths $p -ExpectedSha256 $script:CanonSha).Resultado | Should Be 'ActivaNoVerificada'
            Test-Path $p.OverlayActiva | Should Be $true
        }
    }
}