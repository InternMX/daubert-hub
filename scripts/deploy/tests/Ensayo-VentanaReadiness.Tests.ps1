# Pester 3.4 tests for tools\ensayo-liberacion\ensayo-readiness-parcial.ps1 (paso 6 de ensayo-ventana-respaldos.ps1).
# Run with:  Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\deploy\tests
# Nothing real is run: the rehearsal is NEVER executed here (it is destructive on a clone and a disposable PostgreSQL). The real readiness producer runs with its
# seams mocked and with EXACTLY the arguments the rehearsal passes, and its evidence is fed to the rehearsal validator and to the deployment consumer.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = [System.IO.Path]::GetFullPath((Join-Path $here '..\..\..'))
. (Join-Path $root 'scripts\deploy\Test-ManufacturaReleaseReadiness.ps1')
. (Join-Path $root 'tools\ensayo-liberacion\ensayo-readiness-parcial.ps1')
$script:DeployAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts\deploy\Deploy-DaubertHub.ps1'), [ref]$null, [ref]$null)
. ([scriptblock]::Create($script:DeployAst.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-ManufacturingReadinessEvidence' }, $true).Extent.Text))
$script:EnsayoPath = Join-Path $root 'tools\ensayo-liberacion\ensayo-ventana-respaldos.ps1'

$script:AllTables = 'cliente_abreviaturas,confirmaciones_revision,documentos,firma_autorizaciones,firmas,pdf_contenidos,pdfs,revision_responsables,revisiones'
$script:Markers = 'POSTCHECK_020_PASS POSTCHECK_021_PASS POSTCHECK_022_PASS POSTCHECK_023_PASS POSTCHECK_024_PASS POSTCHECK_026_PASS MANUFACTURA_SQL_COMPLETE'

function New-EnsayoState {
    # Disposable rehearsal database after 020-024 + 026, patched backup module, complete migrations evidence (escenario "completa").
    return @{
        Sql      = [ordered]@{ db = 'daubert_global'; schema = '1'; tables = $script:AllTables; policies = '33'; backup_tables = $script:AllTables; no_rls = '0'; m022 = '1'; m024 = '1'; backup_role = 'ok'; cat025 = '0' }
        SqlFails = $false
        Files    = @{ 'BackupPgTools.psm1' = "`$arguments = @('-Fc', '--no-password', '--enable-row-security')"; 'completa-migraciones.txt' = $script:Markers }
    }
}
function Set-EnsayoMocks {
    Mock Invoke-ReadinessSql { if ($script:State.SqlFails) { throw 'psql failed (exit 2)' }; @($script:State.Sql.Keys | ForEach-Object { $_ + '=' + $script:State.Sql[$_] }) }
    Mock Read-ReadinessText { if ($script:State.Files.ContainsKey($Path)) { $script:State.Files[$Path] } else { $null } }
    Mock Invoke-ReadinessHealth { throw 'el ensayo no tiene /api/health' }
    Mock Get-ReadinessContainerImage { '' }
    Mock Get-ReadinessFileSha256 { '' }
    Mock Write-ReadinessEvidence { $script:EvidenceLine = $Line + "`n" }
    Mock Write-Host { $script:Out += [string]$Object }
}
function Invoke-EnsayoReadiness {
    # The exact invocation of ensayo-ventana-respaldos.ps1, paso 6: -Phase PreDeploy -Psql -BackupModule -MigrationsEvidence -EvidenceFile.
    param([hashtable]$Override = @{})
    $script:Out = @(); $script:EvidenceLine = $null
    $p = @{ Phase = 'PreDeploy'; Psql = 'psql'; BackupModule = 'BackupPgTools.psm1'; EnvFile = ''; MigrationsEvidence = 'completa-migraciones.txt'; HealthUrl = ''; ExpectedCommit = ''
        ImagesManifest = ''; ImagesManifestSha256 = ''; Containers = @(); NginxConf = ''; ClosurePolicyFile = ''; ClosurePolicySha256 = ''; EvidenceFile = 'C:\fuera\completa-readiness-diagnostico-ensayo.txt'; SkipDatabase = $false }
    foreach ($k in $Override.Keys) { $p[$k] = $Override[$k] }
    $r = @(Invoke-ReadinessMain $p)
    return [pscustomobject]@{ Code = [int]$r[-1]; Out = @($script:Out); Evidence = $script:EvidenceLine }
}
function Get-Why { param($R) return @(Test-EnsayoReadinessParcial $R.Code $R.Out $R.Evidence) }

Describe 'Ensayo de ventana, paso 6: el diagnostico parcial acredita SOLO el ensayo de respaldos, nunca el despliegue ni la habilitacion' {
    BeforeEach { $script:SavedDb = $env:PGDATABASE; $env:PGDATABASE = 'daubert_global'; $script:State = New-EnsayoState; Set-EnsayoMocks }
    AfterEach { $env:PGDATABASE = $script:SavedDb }

    It 'escenario normal (completa): readiness responde PARTIAL exit 2 con bd, respaldo y migraciones en PASS y el ensayo continua' {
        $r = Invoke-EnsayoReadiness
        $r.Code | Should Be 2
        $r.Evidence | Should Match '^MANUFACTURA_READINESS_PARTIAL phase=PreDeploy perfil=diagnostico controles=\d+ fallos=0 grupos=bd,respaldo,migraciones commit=- faltan=configuracion,salud,imagenes,nginx,cierre '
        @(Get-Why $r).Count | Should Be 0
    }

    It 'la evidencia del ensayo nunca es PASS ni la acepta el consumidor de despliegue' {
        $r = Invoke-EnsayoReadiness
        $r.Evidence | Should Not Match 'MANUFACTURA_READINESS_PASS'
        $ev = [pscustomobject]@{ Exists = $true; AgeHours = 0; Text = $r.Evidence }
        ((Test-ManufacturingReadinessEvidence $ev 6 '16153a8' (Get-Date).ToUniversalTime()) -join ' ') | Should Match 'NO habilitar'
    }

    It 'escenario sin-parche (026 presente, modulo sin --enable-row-security): FAIL exit 1 y el ensayo se detiene' {
        $script:State.Files['BackupPgTools.psm1'] = "`$arguments = @('-Fc', '--no-password')"
        $r = Invoke-EnsayoReadiness
        $r.Code | Should Be 1
        ((Get-Why $r) -join ' ') | Should Match 'readiness FALLO'
        ((Get-Why $r) -join ' ') | Should Match 'respaldo y migracion 026 coherentes'
    }

    It 'escenario bandera-sin-026 (migraciones hasta la 024, modulo parchado): FAIL exit 1 y el ensayo se detiene' {
        $script:State.Sql.backup_tables = ''; $script:State.Sql.policies = '24'
        $script:State.Files['completa-migraciones.txt'] = 'POSTCHECK_020_PASS POSTCHECK_021_PASS POSTCHECK_022_PASS POSTCHECK_023_PASS POSTCHECK_024_PASS'
        $r = Invoke-EnsayoReadiness
        $r.Code | Should Be 1
        @(Get-Why $r).Count | Should BeGreaterThan 0
        ((Get-Why $r) -join ' ') | Should Match 'FAIL'
    }

    It 'base no consultable, evidencia de migraciones ausente o modulo ilegible: se detiene' {
        $script:State.SqlFails = $true
        @(Get-Why (Invoke-EnsayoReadiness)).Count | Should BeGreaterThan 0
        $script:State = New-EnsayoState; $script:State.Files.Remove('completa-migraciones.txt')
        @(Get-Why (Invoke-EnsayoReadiness)).Count | Should BeGreaterThan 0
        $script:State = New-EnsayoState; $script:State.Files.Remove('BackupPgTools.psm1')
        @(Get-Why (Invoke-EnsayoReadiness)).Count | Should BeGreaterThan 0
    }

    It 'un exit 2 NO basta: faltan controles requeridos por el ensayo (sin -BackupModule, sin -MigrationsEvidence, -SkipDatabase): se detiene' {
        foreach ($o in @(@{ BackupModule = '' }, @{ MigrationsEvidence = '' }, @{ SkipDatabase = $true })) {
            $r = Invoke-EnsayoReadiness $o
            $r.Code | Should Be 2
            $why = (Get-Why $r) -join ' '
            $why | Should Match 'no es el diagnostico parcial esperado del ensayo|control del ensayo no ejecutado'
        }
    }

    It 'grupos de mas tambien se rechazan (el ensayo acredita exactamente sus controles)' {
        $script:State.Files['default.conf'] = "location = /api/manufacturing-sheets/documents/signatures { client_max_body_size 3m; }"
        $r = Invoke-EnsayoReadiness @{ NginxConf = 'default.conf' }
        $r.Code | Should Be 2
        ((Get-Why $r) -join ' ') | Should Match 'no es el diagnostico parcial esperado'
    }

    It 'resultados inesperados: exit 0, exit distinto de 0/1/2 o exit 2 con FAIL en la salida: se detiene' {
        $ok = Invoke-EnsayoReadiness
        ((Test-EnsayoReadinessParcial 0 $ok.Out $ok.Evidence) -join ' ') | Should Match 'exit 0 \(PASS\) inesperado'
        ((Test-EnsayoReadinessParcial 3 $ok.Out $ok.Evidence) -join ' ') | Should Match 'exit 3 inesperado'
        ((Test-EnsayoReadinessParcial -1 $ok.Out $ok.Evidence) -join ' ') | Should Match 'inesperado'
        ((Test-EnsayoReadinessParcial 2 (@($ok.Out) + 'FAIL algo') $ok.Evidence) -join ' ') | Should Match 'control\(es\) FAIL'
    }

    It 'evidencia ausente, duplicada, contradictoria o alterada: se detiene' {
        $ok = Invoke-EnsayoReadiness
        $line = $ok.Evidence.TrimEnd()
        $bad = @(
            $null,
            '',
            ($line + "`n" + $line),
            ($line + "`nMANUFACTURA_READINESS_FAIL phase=PreDeploy"),
            ($line -replace 'READINESS_PARTIAL', 'READINESS_PASS'),
            ($line -replace 'READINESS_PARTIAL', 'READINESS_FAIL'),
            ($line -replace 'phase=PreDeploy', 'phase=PreEnable'),
            ($line -replace 'fallos=0', 'fallos=1'),
            ($line -replace 'perfil=diagnostico', 'perfil=completo-v1'),
            ($line -replace 'grupos=bd,respaldo,migraciones', 'grupos=respaldo,migraciones'),
            ($line -replace 'faltan=configuracion,salud,imagenes,nginx,cierre', 'faltan=-'),
            ($line -replace 'controles=\d+', 'controles=99'),
            'MANUFACTURA_READINESS_PASS phase=PreDeploy controles=24 fallos=0 2026-11-13T10:00:00Z'
        )
        foreach ($t in $bad) { @(Test-EnsayoReadinessParcial 2 $ok.Out $t).Count | Should BeGreaterThan 0 }
        @(Test-EnsayoReadinessParcial 2 $ok.Out ([string][char]0xFEFF + $line + "`r`n")).Count | Should Be 0
    }

    It 'un control propio del ensayo ausente de la salida, o duplicado, impide continuar' {
        $ok = Invoke-EnsayoReadiness
        $sinCoherencia = @($ok.Out | Where-Object { $_ -notlike 'PASS respaldo y migracion 026 coherentes*' })
        ((Test-EnsayoReadinessParcial 2 $sinCoherencia $ok.Evidence) -join ' ') | Should Match 'control del ensayo no ejecutado o no aprobado: respaldo y migracion 026 coherentes'
        $doble = @($ok.Out) + 'PASS la evidencia de migraciones contiene todos los marcadores (020-024, 026 y COMPLETE)'
        @(Test-EnsayoReadinessParcial 2 $doble $ok.Evidence).Count | Should BeGreaterThan 0
    }
}

Describe 'Ensayo de ventana: el script usa la acreditacion del diagnostico y no la confunde con autorizacion' {
    $text = Get-Content -LiteralPath $script:EnsayoPath -Raw
    $errs = $null; $ast = [System.Management.Automation.Language.Parser]::ParseFile($script:EnsayoPath, [ref]$null, [ref]$errs)

    It 'se analiza sin errores en PowerShell 5.1' { @($errs).Count | Should Be 0 }

    It 'el paso 6 invoca readiness PreDeploy con EXACTAMENTE los argumentos de sus grupos (bd, respaldo, migraciones)' {
        $calls = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'powershell' -and $n.Extent.Text -match 'Test-ManufacturaReleaseReadiness\.ps1' }, $true))
        $calls.Count | Should Be 1
        $params = @($calls[0].CommandElements | Where-Object { $_ -is [System.Management.Automation.Language.CommandParameterAst] } | ForEach-Object { $_.ParameterName }) | Sort-Object
        ($params -join ',') | Should Be 'BackupModule,EvidenceFile,File,MigrationsEvidence,NoProfile,Phase,Psql'
        $calls[0].Extent.Text | Should Match '-Phase PreDeploy '
        $calls[0].Extent.Text | Should Not Match 'SkipDatabase|PreEnable'
    }

    It 'decide con Test-EnsayoReadinessParcial (no con exit -ne 0 ni con exit 2 a secas) y nunca escribe un PASS' {
        $text | Should Match '\. \(Join-Path \$tools ''ensayo-readiness-parcial\.ps1''\)'
        $text | Should Match 'Test-EnsayoReadinessParcial \$rd\.Code \$rd\.Out \$rdText'
        $text | Should Not Match '\$rd\.Code -(ne|eq|le|lt|ge|gt|in)'
        $text | Should Not Match 'MANUFACTURA_READINESS_PASS'
        $text | Should Match 'readiness-diagnostico-ensayo\.txt'
        $text | Should Match 'NO es evidencia de despliegue ni de habilitacion'
    }

    It 'conserva las salvaguardas de aislamiento y los escenarios negativos' {
        $text | Should Match "Refusing: -Operative must be a disposable clone"
        $text | Should Match 'Refusing standard PostgreSQL ports'
        $text | Should Match "-PgContainer must be a rehearsal container"
        $text | Should Match "\[ValidateSet\('completa', 'previo-corrupto', 'sin-parche', 'bandera-sin-026', 'tarea-en-ejecucion'\)\]"
        $text | Should Match 'if \(-not \$SkipReadiness\)'
    }
}
