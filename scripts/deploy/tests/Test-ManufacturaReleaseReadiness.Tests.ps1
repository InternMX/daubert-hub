# Pester 3.4 tests for scripts\deploy\Test-ManufacturaReleaseReadiness.ps1
# Run with:  Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\deploy\tests
# Nothing real is contacted: psql, files, health and docker go through the script's seams, mocked here.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. ([System.IO.Path]::GetFullPath((Join-Path $here '..\Test-ManufacturaReleaseReadiness.ps1')))

$script:AllTables = 'cliente_abreviaturas,confirmaciones_revision,documentos,firma_autorizaciones,firmas,pdf_contenidos,pdfs,revision_responsables,revisiones'
$script:Markers = 'POSTCHECK_020_PASS POSTCHECK_021_PASS POSTCHECK_022_PASS POSTCHECK_023_PASS POSTCHECK_024_PASS POSTCHECK_026_PASS MANUFACTURA_SQL_COMPLETE'
$script:NginxOk = "server {`n location = /api/manufacturing-sheets/documents/signatures {`n  client_max_body_size 3m;`n  proxy_pass http://api:3000;`n }`n location ^~ /api/ { proxy_pass http://api:3000; }`n}"

function New-ReadyState {
    return @{
        Sql      = [ordered]@{ db = 'daubert_global'; schema = '1'; tables = $script:AllTables; policies = '33'; backup_tables = $script:AllTables; no_rls = '0'; m022 = '1'; m024 = '1'; backup_role = 'ok'; cat025 = '0' }
        SqlFails = $false
        Files    = @{
            'backup.psm1'   = "`$arguments = @('-Fc', '--no-password', '--enable-row-security')"
            'prod.env'      = "DB_NAME=daubert_global`nDB_PASSWORD=no-debe-imprimirse`nMANUFACTURING_ENABLED=`nMANUFACTURING_EMISSION_ENV="
            'evidence.txt'  = $script:Markers
            'default.conf'  = $script:NginxOk
            'imagenes.json' = '{"formato":"1","commit":"abc","interfazManufacturaCompilada":false,"imagenes":[{"servicio":"api","imageId":"sha256:aaa"},{"servicio":"web","imageId":"sha256:bbb"}]}'
        }
        Images   = @{ 'x-api-1' = 'sha256:aaa'; 'x-web-1' = 'sha256:bbb' }
        Health   = [pscustomobject]@{ status = 'ok'; database = 'connected'; commit = '16153a8' }
    }
}
function Set-ReadinessMocks {
    Mock Invoke-ReadinessSql { if ($script:State.SqlFails) { throw 'psql failed (exit 2)' }; @($script:State.Sql.Keys | ForEach-Object { $_ + '=' + $script:State.Sql[$_] }) }
    Mock Read-ReadinessText { if ($script:State.Files.ContainsKey($Path)) { $script:State.Files[$Path] } else { $null } }
    Mock Invoke-ReadinessHealth { if ($null -eq $script:State.Health) { throw 'down' }; $script:State.Health }
    Mock Get-ReadinessContainerImage { if ($script:State.Images.ContainsKey($Name)) { $script:State.Images[$Name] } else { '' } }
    Mock Get-ReadinessFileSha256 { if ($script:State.Files.ContainsKey($Path)) { 'sha-' + $Path } else { '' } }
    Mock Write-ReadinessEvidence { $script:EvidenceLine = $Line }
    Mock Write-Host { $script:Out += [string]$Object }
}
function Invoke-Readiness {
    param([hashtable]$Override = @{})
    $script:Out = @(); $script:EvidenceLine = ''
    $p = @{ Phase = 'PreEnable'; Psql = 'psql'; BackupModule = 'backup.psm1'; EnvFile = 'prod.env'; MigrationsEvidence = 'evidence.txt'; HealthUrl = 'http://x/api/health'; ExpectedCommit = '16153a8'
        ImagesManifest = ''; ImagesManifestSha256 = ''; Containers = @(); NginxConf = 'default.conf'; ClosurePolicyFile = ''; ClosurePolicySha256 = ''; EvidenceFile = 'C:\fuera\readiness.txt'; SkipDatabase = $false }
    foreach ($k in $Override.Keys) { $p[$k] = $Override[$k] }
    $r = @(Invoke-ReadinessMain $p)
    return $r[-1]
}
function Get-Out { return ($script:Out -join "`n") }
function Get-Fails { return @($script:Out | Where-Object { $_ -like 'FAIL *' }) }

Describe 'Readiness de Manufactura: cualquier fallo bloquea (exit 1 + MANUFACTURA_READINESS_FAIL)' {
    BeforeEach { $script:SavedDb = $env:PGDATABASE; $env:PGDATABASE = 'daubert_global'; $script:State = New-ReadyState; Set-ReadinessMocks }
    AfterEach { $env:PGDATABASE = $script:SavedDb }

    It 'entorno correctamente preparado: todos los controles PASS, exit 0 y evidencia PASS' {
        (Invoke-Readiness) | Should Be 0
        @(Get-Fails).Count | Should Be 0
        $script:EvidenceLine | Should Match '^MANUFACTURA_READINESS_PASS phase=PreEnable '
        (Get-Out) | Should Match 'todos los controles PASS'
    }

    It 'entorno preparado en fase PreDeploy con imagenes validadas y web sin interfaz: PASS' {
        $sha = Get-TextSha256 $script:State.Files['imagenes.json']
        (Invoke-Readiness @{ Phase = 'PreDeploy'; ImagesManifest = 'imagenes.json'; ImagesManifestSha256 = $sha; Containers = @('x-api-1,x-web-1') }) | Should Be 0
        $script:EvidenceLine | Should Match '^MANUFACTURA_READINESS_PASS phase=PreDeploy '
    }

    It 'base de datos equivocada (el servidor informa otra base): FAIL' {
        $script:State.Sql.db = 'daubert_hub_test'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL base conectada = daubert_global'
        $script:EvidenceLine | Should Match '^MANUFACTURA_READINESS_FAIL'
    }

    It 'base de datos equivocada (PGDATABASE apunta a otra base): FAIL' {
        $env:PGDATABASE = 'postgres'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL base conectada = daubert_global'
    }

    It 'DB_NAME del archivo de entorno distinto de daubert_global: FAIL' {
        $script:State.Files['prod.env'] = "DB_NAME=daubert_hub_test`nMANUFACTURING_ENABLED="
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL configuracion: DB_NAME = daubert_global'
    }

    It 'esquema manufactura inexistente: FAIL en el esquema y en cada migracion' {
        $script:State.Sql = [ordered]@{ db = 'daubert_global'; schema = '0'; tables = ''; policies = '0'; backup_tables = ''; no_rls = '0'; m022 = '0'; m024 = '0'; backup_role = 'ok'; cat025 = '0' }
        $script:State.Files['backup.psm1'] = "`$arguments = @('-Fc', '--no-password')"
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL existe el esquema manufactura'
        foreach ($n in '020', '021', '022', '023', '024', '026') { (Get-Out) | Should Match ('FAIL migracion ' + $n + ' aplicada') }
        (Get-Out) | Should Match 'FAIL RLS activa'
    }

    It 'migraciones incompletas: solo 020 y 021 aplicadas' {
        $script:State.Sql.tables = 'confirmaciones_revision,documentos,firma_autorizaciones,firmas,pdf_contenidos,pdfs,revision_responsables,revisiones'
        $script:State.Sql.policies = '21'; $script:State.Sql.backup_tables = ''; $script:State.Sql.m022 = '0'; $script:State.Sql.m024 = '0'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'PASS migracion 020 aplicada'
        (Get-Out) | Should Match 'PASS migracion 021 aplicada'
        foreach ($n in '022', '023', '024', '026') { (Get-Out) | Should Match ('FAIL migracion ' + $n + ' aplicada') }
        (Get-Out) | Should Match 'FAIL manufactura tiene exactamente las 9 tablas :: faltan: cliente_abreviaturas'
    }

    It 'migraciones incompletas: falta solo la 022 (misma cantidad de tablas y politicas)' {
        $script:State.Sql.m022 = '0'
        (Invoke-Readiness) | Should Be 1
        @(Get-Fails).Count | Should Be 1
        (Get-Out) | Should Match 'FAIL migracion 022 aplicada'
    }

    It 'migraciones incompletas: falta solo la 024 (misma cantidad de tablas y politicas)' {
        $script:State.Sql.m024 = '0'
        (Invoke-Readiness) | Should Be 1
        @(Get-Fails).Count | Should Be 1
        (Get-Out) | Should Match 'FAIL migracion 024 aplicada'
    }

    It 'la evidencia de migraciones sin todos los marcadores: FAIL' {
        $script:State.Files['evidence.txt'] = 'POSTCHECK_020_PASS POSTCHECK_021_PASS'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL la evidencia de migraciones contiene todos los marcadores .* :: faltan: POSTCHECK_022_PASS'
    }

    It 'politicas RLS incompletas: cantidad distinta de 33' {
        $script:State.Sql.policies = '32'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL manufactura tiene 33 politicas RLS'
    }

    It 'politicas RLS incompletas: una tabla sin RLS' {
        $script:State.Sql.no_rls = '1'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL RLS activa en todas las tablas'
    }

    It 'politicas RLS incompletas: una tabla sin su politica de respaldo' {
        $script:State.Sql.backup_tables = ($script:AllTables -replace ',pdf_contenidos', ''); $script:State.Sql.policies = '32'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL migracion 026 aplicada: pol_respaldo_sel .* :: sin politica de respaldo: pdf_contenidos'
    }

    It 'migracion 026 ausente con el modulo de respaldo YA parchado: FAIL (respaldo con tablas vacias y exit 0)' {
        $script:State.Sql.backup_tables = ''; $script:State.Sql.policies = '24'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL migracion 026 aplicada'
        (Get-Out) | Should Match 'FAIL respaldo y migracion 026 coherentes .* :: bandera SIN politica'
    }

    It 'migracion 026 presente con el modulo de respaldo SIN parchar: FAIL (pg_dump fallaria)' {
        $script:State.Files['backup.psm1'] = "`$arguments = @('-Fc', '--no-password')"
        (Invoke-Readiness) | Should Be 1
        @(Get-Fails).Count | Should Be 1
        (Get-Out) | Should Match 'FAIL respaldo y migracion 026 coherentes .* :: politica SIN bandera'
    }

    It 'daubert_backup con BYPASSRLS o superusuario: FAIL' {
        $script:State.Sql.backup_role = 'bypassrls'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL daubert_backup existe y no es superusuario ni BYPASSRLS'
    }

    It 'objetos de la 025 de Caterpillar presentes: FAIL' {
        $script:State.Sql.cat025 = '1'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL no hay objetos de la 025 de Caterpillar'
    }

    It 'configuracion contradictoria: ENABLED=true sin EMISSION_ENV=PRODUCCION' {
        $script:State.Files['prod.env'] = "DB_NAME=daubert_global`nMANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV="
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL configuracion: MANUFACTURING_ENABLED=true exige MANUFACTURING_EMISSION_ENV=PRODUCCION'
    }

    It 'configuracion contradictoria: EMISSION_ENV=PRUEBA con la base de produccion' {
        $script:State.Files['prod.env'] = "DB_NAME=daubert_global`nMANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRUEBA"
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL configuracion: MANUFACTURING_EMISSION_ENV vacia o PRODUCCION'
    }

    It 'configuracion contradictoria: valor que la API no acepta (True, 1, si)' {
        foreach ($v in 'True', '1', 'si') {
            $script:State.Files['prod.env'] = "DB_NAME=daubert_global`nMANUFACTURING_ENABLED=$v`nMANUFACTURING_EMISSION_ENV=PRODUCCION"
            (Invoke-Readiness) | Should Be 1
            (Get-Out) | Should Match 'FAIL configuracion: MANUFACTURING_ENABLED vacia, true o false'
        }
    }

    It 'configuracion contradictoria: Manufactura habilitada con la base sin preparar' {
        $script:State.Files['prod.env'] = "DB_NAME=daubert_global`nMANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRODUCCION"
        $script:State.Sql.m024 = '0'
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL configuracion: Manufactura solo se habilita con la base completamente preparada'
    }

    It 'configuracion coherente para habilitar (true + PRODUCCION) con la base preparada: PASS' {
        $script:State.Files['prod.env'] = "DB_NAME=daubert_global`nMANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRODUCCION"
        (Invoke-Readiness) | Should Be 0
    }

    It 'fase PreDeploy: la configuracion ya habilita Manufactura (activacion accidental): FAIL' {
        $script:State.Files['prod.env'] = "DB_NAME=daubert_global`nMANUFACTURING_ENABLED=true`nMANUFACTURING_EMISSION_ENV=PRODUCCION"
        (Invoke-Readiness @{ Phase = 'PreDeploy' }) | Should Be 1
        (Get-Out) | Should Match 'FAIL fase PreDeploy: la configuracion NO habilita Manufactura'
    }

    It 'fase PreDeploy: imagen web con la interfaz compilada y el API apagado: FAIL' {
        $script:State.Files['imagenes.json'] = $script:State.Files['imagenes.json'] -replace '"interfazManufacturaCompilada":false', '"interfazManufacturaCompilada":true'
        $sha = Get-TextSha256 $script:State.Files['imagenes.json']
        (Invoke-Readiness @{ Phase = 'PreDeploy'; ImagesManifest = 'imagenes.json'; ImagesManifestSha256 = $sha; Containers = @('x-api-1', 'x-web-1') }) | Should Be 1
        (Get-Out) | Should Match 'FAIL fase PreDeploy: la imagen web NO trae compilada la interfaz'
    }

    It 'imagenes: SHA-256 del manifiesto distinto, imagen distinta o contenedor inexistente: FAIL' {
        (Invoke-Readiness @{ ImagesManifest = 'imagenes.json'; ImagesManifestSha256 = ('0' * 64); Containers = @('x-api-1') }) | Should Be 1
        (Get-Out) | Should Match 'FAIL SHA-256 del manifiesto de imagenes'
        $sha = Get-TextSha256 $script:State.Files['imagenes.json']
        $script:State.Images['x-web-1'] = 'sha256:otra'
        (Invoke-Readiness @{ ImagesManifest = 'imagenes.json'; ImagesManifestSha256 = $sha; Containers = @('x-web-1', 'no-existe-api-1') }) | Should Be 1
        (Get-Out) | Should Match 'FAIL imagen en ejecucion de x-web-1'
        (Get-Out) | Should Match 'FAIL imagen en ejecucion de no-existe-api-1'
    }

    It 'nginx externo sin la ruta de firmas, o con el limite ampliado en mas rutas: FAIL' {
        $script:State.Files['default.conf'] = "server { location ^~ /api/ { proxy_pass http://api:3000; } }"
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL nginx externo: ruta exacta de firmas'
        $script:State.Files['default.conf'] = "server { client_max_body_size 3m;`n" + $script:NginxOk + "}"
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL nginx externo: client_max_body_size no aparece en ninguna otra ruta'
    }

    It 'commit en ejecucion distinto del esperado, salud degradada o sin respuesta: FAIL' {
        $script:State.Health = [pscustomobject]@{ status = 'ok'; database = 'connected'; commit = 'fffffff' }
        (Invoke-Readiness) | Should Be 1; (Get-Out) | Should Match 'FAIL commit en ejecucion = el esperado'
        $script:State.Health = [pscustomobject]@{ status = 'ok'; database = 'unavailable'; commit = '16153a8' }
        (Invoke-Readiness) | Should Be 1; (Get-Out) | Should Match 'FAIL /api/health ok y base conectada'
        $script:State.Health = $null
        (Invoke-Readiness) | Should Be 1; (Get-Out) | Should Match 'FAIL /api/health responde'
    }

    It 'lo que no se puede comprobar es un FALLO, nunca una omision (psql falla, archivos ausentes, sin controles)' {
        $script:State.SqlFails = $true
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Match 'FAIL la base respondio a la consulta de comprobacion'
        (Get-Out) | Should Match 'FAIL respaldo y migracion 026 coherentes'
        $script:State = New-ReadyState; $script:State.Files.Remove('prod.env'); $script:State.Files.Remove('evidence.txt'); $script:State.Files.Remove('default.conf'); $script:State.Files.Remove('backup.psm1')
        (Invoke-Readiness) | Should Be 1
        @(Get-Fails).Count | Should Be 4
        (Invoke-Readiness @{ SkipDatabase = $true; BackupModule = ''; EnvFile = ''; MigrationsEvidence = ''; HealthUrl = ''; NginxConf = '' }) | Should Be 1
        (Get-Out) | Should Match 'FAIL se ejecuto al menos un control'
    }

    It 'no imprime ningun otro valor del archivo de entorno (secretos)' {
        (Invoke-Readiness) | Should Be 0
        (Get-Out) | Should Not Match 'no-debe-imprimirse'
        $script:State.Files['prod.env'] = "DB_NAME=otra`nDB_PASSWORD=no-debe-imprimirse`nMANUFACTURING_ENABLED=x"
        (Invoke-Readiness) | Should Be 1
        (Get-Out) | Should Not Match 'no-debe-imprimirse'
    }

    It 'la consulta de comprobacion es de solo lectura (solo SELECT)' {
        $script:ReadinessSql | Should Not Match '(?i)\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|set_config)\b'
    }
}

Describe 'Readiness: politica de cierre seleccionada para la ventana (archivos reales versionados)' {
    $root = [System.IO.Path]::GetFullPath((Join-Path $here '..\..\..'))
    $operativa = Join-Path $root 'deploy\closure\entry-closure-policy.conf'
    $manufactura = Join-Path $root 'deploy\closure\entry-closure-policy.manufactura.conf'
    $shaOp = (Get-FileHash -LiteralPath $operativa -Algorithm SHA256).Hash.ToLower()
    $shaMf = (Get-FileHash -LiteralPath $manufactura -Algorithm SHA256).Hash.ToLower()

    It 'la politica operativa por omision es exactamente la instalada en produccion (no cambio)' {
        $shaOp | Should Be 'e86f47494d87222122938c6b580cec465cecdf3835c037ce947f60f9e340068f'
        (Get-Content -LiteralPath $operativa -Raw) | Should Not Match 'manufacturing-sheets'
    }

    It 'la politica de Manufactura con su SHA-256 autorizado: PASS' {
        $r = @(Test-ReadinessClosurePolicy (Get-Content -LiteralPath $manufactura -Raw) $shaMf $shaMf)
        @($r | Where-Object { -not $_.Ok }).Count | Should Be 0
        $r.Count | Should Be 3
    }

    It 'la politica de Manufactura es la operativa mas una sola linea de ruta y dos de comentario' {
        $a = @(Get-Content -LiteralPath $operativa); $b = @(Get-Content -LiteralPath $manufactura)
        $extra = @($b | Where-Object { $a -notcontains $_ })
        $extra.Count | Should Be 3
        @($extra | Where-Object { $_ -notmatch '^\s*#' }).Count | Should Be 1
        @($a | Where-Object { $b -notcontains $_ }).Count | Should Be 0
    }

    It 'seleccionar la politica operativa para la ventana de Manufactura: FAIL (no bloquea sus escrituras)' {
        $r = @(Test-ReadinessClosurePolicy (Get-Content -LiteralPath $operativa -Raw) $shaOp $shaOp)
        (@($r | Where-Object { -not $_.Ok }) | ForEach-Object { $_.Name }) -join '|' | Should Match 'bloquea las escrituras bajo /api/manufacturing-sheets'
    }

    It 'SHA-256 distinto del autorizado, sin SHA-256 autorizado o archivo ausente: FAIL' {
        $t = Get-Content -LiteralPath $manufactura -Raw
        @(Test-ReadinessClosurePolicy $t $shaMf ('0' * 64) | Where-Object { -not $_.Ok }).Count | Should Be 1
        @(Test-ReadinessClosurePolicy $t $shaMf '' | Where-Object { -not $_.Ok }).Count | Should Be 1
        @(Test-ReadinessClosurePolicy ($t + "`n# cambio") 'otro' $shaMf | Where-Object { -not $_.Ok }).Count | Should Be 1
        @(Test-ReadinessClosurePolicy $null '' $shaMf | Where-Object { -not $_.Ok }).Count | Should Be 1
    }

    It 'integrado en la corrida: un archivo de politica ausente es un FALLO' {
        $script:SavedDb = $env:PGDATABASE; $env:PGDATABASE = 'daubert_global'; $script:State = New-ReadyState; Set-ReadinessMocks
        (Invoke-Readiness @{ ClosurePolicyFile = 'no-existe.conf'; ClosurePolicySha256 = 'x' }) | Should Be 1
        (Get-Out) | Should Match 'FAIL politica de cierre seleccionada legible'
        $env:PGDATABASE = $script:SavedDb
    }
}
