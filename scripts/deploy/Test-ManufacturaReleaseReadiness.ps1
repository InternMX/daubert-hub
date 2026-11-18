<#
.SYNOPSIS
    READ-ONLY readiness check for the Manufactura release. It runs no SQL writes, no Docker mutation and changes no service. Windows PowerShell 5.1.

.DESCRIPTION
    /api/health cannot see these problems (it stays "ok" with the Manufactura flag on and no schema), so this check is MANDATORY before deploying and before enabling.
    Every check prints PASS/FAIL. ANY failure => exit code 1 and the evidence file (if requested) says MANUFACTURA_READINESS_FAIL: do NOT deploy / do NOT enable.
    A check that cannot be evaluated (psql error, unreadable file, unreachable health) is a FAILURE, never a skip.

    Phases
      PreDeploy  Before deploying the candidate with Manufactura OFF. Database fully migrated (020-024 + 026), configuration must NOT enable Manufactura, web image without the UI.
      PreEnable  Before turning Manufactura on. Same database checks; the configuration that will be used must be coherent (ENABLED=true needs EMISSION_ENV=PRODUCCION).

    Checks
      Database (PG* environment variables of the operator; never printed):
        connected database is daubert_global (asked to the SERVER, not only PGDATABASE); schema manufactura exists; one marker per migration 020, 021, 022, 023, 024, 026;
        exactly the 9 tables; 33 policies; a SELECT policy pol_respaldo_sel for daubert_backup on EVERY table; RLS enabled on every table; daubert_backup is neither superuser nor BYPASSRLS;
        no Caterpillar 025 objects (schema cat_recovery_test).
      Backup coupling (-BackupModule): the module passes --enable-row-security  <=>  the pol_respaldo_sel policies exist
        (flag without policy = dump with EMPTY tables and exit 0; policy without flag = pg_dump fails).
      Configuration (-EnvFile; only DB_NAME, MANUFACTURING_ENABLED and MANUFACTURING_EMISSION_ENV are read, nothing is printed but those three):
        mirrors apps/api/src/config/environment.ts resolveManufacturing; contradictions fail.
      Migrations evidence (-MigrationsEvidence): contains every POSTCHECK_0NN_PASS and MANUFACTURA_SQL_COMPLETE.
      Closure policy (-ClosurePolicyFile, -ClosurePolicySha256): the policy SELECTED for the window has the authorised SHA-256 and blocks writes under /api/manufacturing-sheets.
      Running commit (-HealthUrl, -ExpectedCommit), images (-ImagesManifest, -ImagesManifestSha256, -Containers), external nginx file (-NginxConf).

    Profiles (contract completo-v1)
      COMPLETE   Every mandatory control group of the phase was RUN and PASSED: bd, respaldo, configuracion, migraciones, salud (+ -ExpectedCommit), imagenes (manifest + its
                 authorised SHA-256 + exactly one API and one Web container + interfazManufacturaCompilada as a JSON boolean), nginx, cierre (file + authorised SHA-256).
                 PreEnable is complete only when the evaluated configuration IS the enabling one (MANUFACTURING_ENABLED=true); PreEnable needs the web WITH the
                 interface, PreDeploy WITHOUT it.
      DIAGNOSTIC Any group missing (argument absent, -SkipDatabase, a container missing, PreEnable with a non-enabling configuration). The selected controls run and print
                 PASS/FAIL, but the run NEVER produces enabling evidence: exit 2 and MANUFACTURA_READINESS_PARTIAL (exit 1 / FAIL if any executed control failed).
    -EvidenceFile (outside the repository) receives exactly ONE line:
      MANUFACTURA_READINESS_<PASS|FAIL|PARTIAL> phase=<phase> perfil=<completo-v1|diagnostico> controles=<n> fallos=<n> grupos=<groups run> commit=<7 hex|-> faltan=<groups|-> <UTC>
    PASS is written ONLY for a complete profile with zero failures. Deploy-DaubertHub.ps1 accepts nothing but that single PASS line with phase=PreEnable perfil=completo-v1,
    the complete group list, fallos=0, commit = the commit running in PROD and a recent timestamp, whenever the production env file enables Manufactura.
    Exit codes: 0 complete PASS, 1 any FAIL, 2 partial diagnostic (no authority).

    Dot-sourcing only defines the functions (tests).
#>
[CmdletBinding()]
param(
    [ValidateSet('PreDeploy', 'PreEnable')][string]$Phase = 'PreEnable',
    [string]$Psql = 'psql',
    [string]$BackupModule = '',
    [string]$EnvFile = '',
    [string]$MigrationsEvidence = '',
    [string]$HealthUrl = '',
    [string]$ExpectedCommit = '',
    [string]$ImagesManifest = '',
    [string]$ImagesManifestSha256 = '',
    [string[]]$Containers = @(),
    [string]$NginxConf = '',
    [string]$ClosurePolicyFile = '',
    [string]$ClosurePolicySha256 = '',
    [string]$EvidenceFile = '',
    [switch]$SkipDatabase
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ReadinessTables = @('cliente_abreviaturas', 'confirmaciones_revision', 'documentos', 'firma_autorizaciones', 'firmas', 'pdf_contenidos', 'pdfs', 'revision_responsables', 'revisiones')
$script:ReadinessProfile = 'completo-v1'
# Mandatory control groups of the complete profile (same set for both phases; what differs per phase is the expected content: configuration and web interface).
$script:ReadinessGroups = @('bd', 'respaldo', 'configuracion', 'migraciones', 'salud', 'imagenes', 'nginx', 'cierre')
$script:ReadinessMarkers = @('POSTCHECK_020_PASS', 'POSTCHECK_021_PASS', 'POSTCHECK_022_PASS', 'POSTCHECK_023_PASS', 'POSTCHECK_024_PASS', 'POSTCHECK_026_PASS', 'MANUFACTURA_SQL_COMPLETE')
$script:ReadinessSql = @"
select 'db=' || current_database();
select 'schema=' || count(*) from pg_namespace where nspname='manufactura';
select 'tables=' || coalesce(string_agg(tablename, ',' order by tablename), '') from pg_tables where schemaname='manufactura';
select 'policies=' || count(*) from pg_policies where schemaname='manufactura';
select 'backup_tables=' || coalesce(string_agg(tablename, ',' order by tablename), '') from pg_policies where schemaname='manufactura' and policyname='pol_respaldo_sel' and cmd='SELECT' and roles::text='{daubert_backup}';
select 'no_rls=' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='manufactura' and c.relkind='r' and not c.relrowsecurity;
select 'm022=' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='manufactura' and p.proname='fn_firmas_inventario';
select 'm024=' || count(*) from pg_policies where schemaname='manufactura' and tablename='revisiones' and policyname='pol_revisiones_sel' and qual like '%BORRADOR%' and qual like '%fn_actor_id() IS NOT NULL%';
select 'backup_role=' || coalesce((select (case when rolsuper then 'super' when rolbypassrls then 'bypassrls' else 'ok' end) from pg_roles where rolname='daubert_backup'), 'missing');
select 'cat025=' || count(*) from pg_namespace where nspname='cat_recovery_test';
"@

# ------------------------------------------------------------------ Seams (mocked in the tests)
function Invoke-ReadinessSql {
    # One read-only psql call; returns the output lines. Throws on any psql error (the caller turns it into a FAIL).
    param([string]$PsqlExe, [string]$Sql)
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = & $PsqlExe -X -q -At -v ON_ERROR_STOP=1 -c $Sql 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { throw ('psql failed (exit ' + $code + ')') }
    return @($o | ForEach-Object { [string]$_ })
}
function Read-ReadinessText { param([string]$Path) if (-not (Test-Path -LiteralPath $Path)) { return $null }; return [string](Get-Content -LiteralPath $Path -Raw) }
function Get-ReadinessFileSha256 { param([string]$Path) if (-not (Test-Path -LiteralPath $Path)) { return '' }; return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower() }
function Invoke-ReadinessHealth { param([string]$Url) return ((Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json) }
function Get-ReadinessContainerImage {
    param([string]$Name)
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $id = & docker inspect $Name --format '{{.Image}}' 2>$null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    if ($code -ne 0) { return '' }
    return [string]$id
}

# ------------------------------------------------------------------ Facts
function ConvertTo-ReadinessFacts {
    # Pure: "key=value" lines -> hashtable.
    param([string[]]$Lines)
    $facts = @{}
    foreach ($line in @($Lines)) { $i = ([string]$line).IndexOf('='); if ($i -gt 0) { $facts[([string]$line).Substring(0, $i)] = ([string]$line).Substring($i + 1) } }
    return $facts
}
function Get-ReadinessEnvFlags {
    # Pure: text of an env file -> the three values that decide Manufactura. Nothing else is kept.
    param([string]$Text)
    $flags = @{ DB_NAME = ''; MANUFACTURING_ENABLED = ''; MANUFACTURING_EMISSION_ENV = '' }
    foreach ($line in @(([string]$Text) -split "`r?`n")) {
        if ($line -match '^\s*(DB_NAME|MANUFACTURING_ENABLED|MANUFACTURING_EMISSION_ENV)\s*=\s*(.*?)\s*$') { $flags[$Matches[1]] = $Matches[2].Trim('"').Trim("'") }
    }
    return $flags
}
function Get-TextSha256 {
    param([string]$Text)
    $lf = $Text -replace "`r`n", "`n"
    return ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash((New-Object System.Text.UTF8Encoding($false)).GetBytes($lf))) -replace '-', '').ToLower()
}

# ------------------------------------------------------------------ Checks (pure: facts -> results)
function New-ReadinessResult { param([bool]$Ok, [string]$Name, [string]$Detail = '') return [pscustomobject]@{ Ok = $Ok; Name = $Name; Detail = $Detail } }

function Test-ReadinessDatabase {
    # $Facts: hashtable from ConvertTo-ReadinessFacts, or $null when the query could not be run.
    param($Facts, [string]$PgDatabase)
    $r = @()
    if ($null -eq $Facts -or -not $Facts.ContainsKey('db')) { return @(New-ReadinessResult $false 'la base respondio a la consulta de comprobacion' 'no se pudo consultar (psql); sin datos NO se habilita') }
    $get = { param($k) if ($Facts.ContainsKey($k)) { [string]$Facts[$k] } else { '' } }
    $db = & $get 'db'
    $r += New-ReadinessResult ($db -eq 'daubert_global' -and $PgDatabase -eq 'daubert_global') 'base conectada = daubert_global (servidor y PGDATABASE)' ("servidor=$db PGDATABASE=$PgDatabase")
    $schema = ((& $get 'schema') -eq '1')
    $r += New-ReadinessResult $schema 'existe el esquema manufactura' 'el esquema no existe: las migraciones 020-024 y 026 no se han aplicado'
    $tables = @((& $get 'tables') -split ',' | Where-Object { $_ })
    $r += New-ReadinessResult ($tables -contains 'documentos') 'migracion 020 aplicada (documentos)'
    $r += New-ReadinessResult ($tables -contains 'firmas') 'migracion 021 aplicada (firmas)'
    $r += New-ReadinessResult ((& $get 'm022') -eq '1') 'migracion 022 aplicada (fn_firmas_inventario)'
    $r += New-ReadinessResult ($tables -contains 'cliente_abreviaturas') 'migracion 023 aplicada (cliente_abreviaturas)'
    $r += New-ReadinessResult ((& $get 'm024') -eq '1') 'migracion 024 aplicada (pol_revisiones_sel con consulta compartida de borradores)'
    $missing = @($script:ReadinessTables | Where-Object { $tables -notcontains $_ }); $extra = @($tables | Where-Object { $script:ReadinessTables -notcontains $_ })
    $r += New-ReadinessResult ($missing.Count -eq 0 -and $extra.Count -eq 0) 'manufactura tiene exactamente las 9 tablas' ('faltan: ' + ($missing -join ',') + ' ; sobran: ' + ($extra -join ','))
    $backup = @((& $get 'backup_tables') -split ',' | Where-Object { $_ })
    $noBackup = @($script:ReadinessTables | Where-Object { $backup -notcontains $_ })
    $r += New-ReadinessResult ($noBackup.Count -eq 0 -and $backup.Count -eq 9) 'migracion 026 aplicada: pol_respaldo_sel (SELECT, daubert_backup) en las 9 tablas' ('sin politica de respaldo: ' + ($noBackup -join ','))
    $r += New-ReadinessResult ((& $get 'policies') -eq '33') 'manufactura tiene 33 politicas RLS (24 de la aplicacion + 9 de respaldo)' ('politicas=' + (& $get 'policies'))
    $r += New-ReadinessResult ($schema -and (& $get 'no_rls') -eq '0') 'RLS activa en todas las tablas de manufactura' ('tablas sin RLS=' + (& $get 'no_rls'))
    $r += New-ReadinessResult ((& $get 'backup_role') -eq 'ok') 'daubert_backup existe y no es superusuario ni BYPASSRLS' (& $get 'backup_role')
    $r += New-ReadinessResult ((& $get 'cat025') -eq '0') 'no hay objetos de la 025 de Caterpillar (cat_recovery_test)' ('esquemas=' + (& $get 'cat025'))
    return $r
}

function Test-ReadinessBackupCoupling {
    # $ModuleText: text of BackupPgTools.psm1 ($null = unreadable). $Facts may be $null.
    param($ModuleText, $Facts)
    if ($null -eq $ModuleText) { return @(New-ReadinessResult $false 'modulo de respaldo legible' 'no se pudo leer -BackupModule') }
    if ($null -eq $Facts -or -not $Facts.ContainsKey('backup_tables')) { return @(New-ReadinessResult $false 'respaldo y migracion 026 coherentes' 'sin datos de la base no se puede comprobar') }
    $flag = ($ModuleText -match "'--enable-row-security'")
    $policies = (@(([string]$Facts['backup_tables']) -split ',' | Where-Object { $_ }).Count -gt 0)
    $detail = $(if ($flag -and -not $policies) { 'bandera SIN politica: el respaldo saldria con las tablas de manufactura VACIAS y exit 0' } elseif ($policies -and -not $flag) { 'politica SIN bandera: pg_dump FALLA; aplicar el parche de respaldos' } else { '' })
    return @(New-ReadinessResult ($flag -eq $policies) 'respaldo y migracion 026 coherentes (--enable-row-security <=> pol_respaldo_sel)' $detail)
}

function Test-ReadinessConfiguration {
    # Mirrors resolveManufacturing (apps/api/src/config/environment.ts). $DatabaseReady: every database check passed.
    # The web interface (interfazManufacturaCompilada) is checked by Test-ReadinessWebUi with the images manifest.
    param($Flags, [string]$PhaseName, [bool]$DatabaseReady)
    $r = @()
    if ($null -eq $Flags) { return @(New-ReadinessResult $false 'archivo de entorno legible' 'no se pudo leer -EnvFile') }
    $enabled = [string]$Flags['MANUFACTURING_ENABLED']; $emission = [string]$Flags['MANUFACTURING_EMISSION_ENV']; $db = [string]$Flags['DB_NAME']
    $r += New-ReadinessResult ($db -eq 'daubert_global') 'configuracion: DB_NAME = daubert_global' ("DB_NAME=$db")
    $r += New-ReadinessResult ($enabled -ceq '' -or $enabled -ceq 'true' -or $enabled -ceq 'false') 'configuracion: MANUFACTURING_ENABLED vacia, true o false' ("valor=$enabled (la API no arranca con otro valor)")
    $r += New-ReadinessResult ($emission -ceq '' -or $emission -ceq 'PRODUCCION') 'configuracion: MANUFACTURING_EMISSION_ENV vacia o PRODUCCION' ("valor=$emission (PRUEBA u otro valor impiden el arranque con la base de produccion)")
    $on = ($enabled -ceq 'true')
    $r += New-ReadinessResult (-not $on -or $emission -ceq 'PRODUCCION') 'configuracion: MANUFACTURING_ENABLED=true exige MANUFACTURING_EMISSION_ENV=PRODUCCION' 'contradictoria: la API no arranca'
    $r += New-ReadinessResult (-not $on -or $DatabaseReady) 'configuracion: Manufactura solo se habilita con la base completamente preparada' 'ENABLED=true con la base sin preparar: /api/health diria ok y las rutas darian 500'
    if ($PhaseName -eq 'PreDeploy') {
        $r += New-ReadinessResult (-not $on) 'fase PreDeploy: la configuracion NO habilita Manufactura' 'MANUFACTURING_ENABLED=true antes del despliegue apagado (activacion accidental)'
    }
    return $r
}

function Test-ReadinessWebUi {
    # interfazManufacturaCompilada of the images manifest: must be a JSON boolean (a string "false" is NOT accepted); PreDeploy expects false, PreEnable expects true.
    param($ManifestText, [string]$PhaseName)
    $j = $null; try { $j = $ManifestText | ConvertFrom-Json } catch { $j = $null }
    $has = ($null -ne $j -and @($j.PSObject.Properties.Name) -contains 'interfazManufacturaCompilada' -and $j.interfazManufacturaCompilada -is [bool])
    if (-not $has) { return @(New-ReadinessResult $false 'manifiesto de imagenes: interfazManufacturaCompilada verificable (booleano)' 'ausente o no booleano: no se puede comprobar la interfaz de la web; sin dato NO se habilita') }
    $ui = [bool]$j.interfazManufacturaCompilada
    if ($PhaseName -eq 'PreDeploy') { return @(New-ReadinessResult (-not $ui) 'fase PreDeploy: la imagen web NO trae compilada la interfaz de Manufactura' 'interfazManufacturaCompilada=true con el API apagado') }
    return @(New-ReadinessResult $ui 'fase PreEnable: la imagen web trae compilada la interfaz de Manufactura' 'API habilitada con una web sin la interfaz')
}

function Get-ReadinessContainerService {
    # Pure: container name -> 'api' | 'web' | '' (ambiguous or unidentifiable names are never guessed).
    param([string]$Name)
    $a = ($Name -match 'api'); $w = ($Name -match 'web')
    if ($a -and -not $w) { return 'api' }
    if ($w -and -not $a) { return 'web' }
    return ''
}

function Get-ReadinessProfileGaps {
    # Pure: which mandatory groups of the complete profile were NOT (or could not be) evaluated. Empty = complete. Each gap is "<group>: <reason>".
    param([hashtable]$P, $Flags)
    $g = @()
    if ($P.SkipDatabase) { $g += 'bd: -SkipDatabase'; $g += 'respaldo: -SkipDatabase (sin datos de la base no se comprueba)' }
    elseif (-not $P.BackupModule) { $g += 'respaldo: falta -BackupModule' }
    if (-not $P.EnvFile) { $g += 'configuracion: falta -EnvFile' }
    elseif ($P.Phase -eq 'PreEnable' -and ($null -eq $Flags -or [string]$Flags['MANUFACTURING_ENABLED'] -cne 'true')) { $g += 'configuracion: PreEnable exige evaluar la configuracion que habilita (MANUFACTURING_ENABLED=true)' }
    if (-not $P.MigrationsEvidence) { $g += 'migraciones: falta -MigrationsEvidence' }
    if (-not $P.HealthUrl) { $g += 'salud: falta -HealthUrl' }
    if (-not $P.ExpectedCommit) { $g += 'salud: falta -ExpectedCommit' }
    elseif ([string]$P.ExpectedCommit -notmatch '\A[0-9a-fA-F]{7,40}\z') { $g += 'salud: -ExpectedCommit no es un SHA hexadecimal de 7 a 40 caracteres' }
    if (-not $P.ImagesManifest) { $g += 'imagenes: falta -ImagesManifest' }
    if (-not $P.ImagesManifestSha256) { $g += 'imagenes: falta -ImagesManifestSha256' }
    $names = @(@($P.Containers) | ForEach-Object { ([string]$_) -split ',' } | Where-Object { $_ })
    $svc = @($names | ForEach-Object { Get-ReadinessContainerService $_ })
    if (@($svc | Where-Object { $_ -eq 'api' }).Count -ne 1) { $g += 'imagenes: -Containers debe incluir exactamente un contenedor API' }
    if (@($svc | Where-Object { $_ -eq 'web' }).Count -ne 1) { $g += 'imagenes: -Containers debe incluir exactamente un contenedor Web' }
    if (@($svc | Where-Object { -not $_ }).Count -gt 0) { $g += 'imagenes: -Containers incluye nombres sin servicio identificable (api/web)' }
    if (-not $P.NginxConf) { $g += 'nginx: falta -NginxConf' }
    if (-not $P.ClosurePolicyFile) { $g += 'cierre: falta -ClosurePolicyFile' }
    if (-not $P.ClosurePolicySha256) { $g += 'cierre: falta -ClosurePolicySha256' }
    return $g
}

function Test-ReadinessEvidence {
    param($Text)
    if ($null -eq $Text) { return @(New-ReadinessResult $false 'evidencia de migraciones legible' 'no existe -MigrationsEvidence') }
    $missing = @($script:ReadinessMarkers | Where-Object { -not ([string]$Text).Contains($_) })
    return @(New-ReadinessResult ($missing.Count -eq 0) 'la evidencia de migraciones contiene todos los marcadores (020-024, 026 y COMPLETE)' ('faltan: ' + ($missing -join ',')))
}

function Test-ReadinessNginx {
    param($Text)
    if ($null -eq $Text) { return @(New-ReadinessResult $false 'archivo externo de nginx legible' 'no existe -NginxConf') }
    $sizes = @([regex]::Matches($Text, 'client_max_body_size'))
    $ok = $Text -match 'location\s*=\s*/api/manufacturing-sheets/documents/signatures\s*\{[^}]*client_max_body_size\s+3m\s*;'
    return @(
        (New-ReadinessResult $ok 'nginx externo: ruta exacta de firmas con client_max_body_size 3m' 'sin ella una firma de 1-2 MB recibe 413'),
        (New-ReadinessResult ($sizes.Count -le 1) 'nginx externo: client_max_body_size no aparece en ninguna otra ruta' ('apariciones=' + $sizes.Count))
    )
}

function Test-ReadinessClosurePolicy {
    # $Text/$Sha of the closure policy SELECTED for the window ($null = unreadable). The SHA-256 is of the file bytes (what Set-EntryClosure.ps1 installs).
    param($Text, [string]$Sha, [string]$AuthorisedSha)
    if ($null -eq $Text -or -not $Sha) { return @(New-ReadinessResult $false 'politica de cierre seleccionada legible' 'no existe -ClosurePolicyFile') }
    return @(
        (New-ReadinessResult ([bool]$AuthorisedSha -and $Sha -eq $AuthorisedSha.ToLower()) 'politica de cierre seleccionada: SHA-256 = el autorizado' $Sha),
        (New-ReadinessResult ($Text -match '(?m)^\s*~\*\^/api/manufacturing-sheets\(\?:/\|\$\)\s+1;') 'politica de cierre seleccionada: bloquea las escrituras bajo /api/manufacturing-sheets' 'es la politica operativa anterior: durante el cierre las escrituras de Manufactura llegarian al API'),
        (New-ReadinessResult ($Text -match 'payment-notifications\|remissions/caterpillar' -and $Text -match 'return 503;') 'politica de cierre seleccionada: conserva el bloqueo de Pagos y Caterpillar' '')
    )
}

function Test-ReadinessImages {
    # $ManifestText may be $null. $RunningIds: hashtable container -> image id ('' = container not found).
    param($ManifestText, [string]$AuthorisedSha, [string[]]$ContainerNames, $RunningIds)
    if ($null -eq $ManifestText) { return @(New-ReadinessResult $false 'manifiesto de imagenes legible' 'no existe -ImagesManifest') }
    $r = @()
    $sha = Get-TextSha256 $ManifestText
    $r += New-ReadinessResult ([bool]$AuthorisedSha -and $sha -eq $AuthorisedSha.ToLower()) 'SHA-256 del manifiesto de imagenes = el autorizado' $sha
    $m = $null; try { $m = $ManifestText | ConvertFrom-Json } catch { $m = $null }
    if ($null -eq $m) { $r += New-ReadinessResult $false 'manifiesto de imagenes valido' 'JSON invalido'; return $r }
    $props = @($m.PSObject.Properties.Name)
    $entries = @($(if ($props -contains 'imagenes') { @($m.imagenes) } else { @() }) | Where-Object { $null -ne $_ })
    $svcOk = @('api', 'web' | Where-Object { $s = $_; $e = @($entries | Where-Object { [string]$_.servicio -eq $s }); $e.Count -eq 1 -and [string]$e[0].imageId })
    $r += New-ReadinessResult (($props -contains 'formato') -and [string]$m.formato -eq '1' -and $svcOk.Count -eq 2) 'manifiesto de imagenes completo (formato 1; una imagen api y una web con imageId)' ('servicios completos: ' + ($svcOk -join ','))
    foreach ($c in @($ContainerNames)) {
        $svc = Get-ReadinessContainerService $c
        if (-not $svc) { $r += New-ReadinessResult $false ('contenedor ' + $c + ' con servicio identificable (api/web)') 'nombre ambiguo o desconocido: no se compara con ninguna imagen'; continue }
        $entry = @($entries | Where-Object { [string]$_.servicio -eq $svc }) | Select-Object -First 1
        $want = $(if ($entry) { [string]$entry.imageId } else { '' }); $have = [string]$RunningIds[$c]
        $r += New-ReadinessResult ([bool]$have -and $have -eq $want) ('imagen en ejecucion de ' + $c + ' = imagen validada') ("en ejecucion=$have validada=$want")
    }
    return $r
}

# ------------------------------------------------------------------ Main
function Invoke-ReadinessMain {
    param([hashtable]$P)
    $results = @()
    $facts = $null; $dbReady = $false
    if (-not $P.SkipDatabase) {
        try { $facts = ConvertTo-ReadinessFacts (Invoke-ReadinessSql $P.Psql $script:ReadinessSql) } catch { $facts = $null }
        $dbResults = @(Test-ReadinessDatabase $facts ([string]$env:PGDATABASE))
        $results += $dbResults
        $dbReady = (@($dbResults | Where-Object { -not $_.Ok }).Count -eq 0)
        if ($P.BackupModule) { $results += @(Test-ReadinessBackupCoupling (Read-ReadinessText $P.BackupModule) $facts) }
    }
    $groups = @()
    if (-not $P.SkipDatabase) { $groups += 'bd'; if ($P.BackupModule) { $groups += 'respaldo' } }
    $manifestText = $null
    if ($P.ImagesManifest) {
        $groups += 'imagenes'
        $manifestText = Read-ReadinessText $P.ImagesManifest
        $ids = @{}
        $names = @($P.Containers | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
        foreach ($c in $names) { if (Get-ReadinessContainerService $c) { $ids[$c] = Get-ReadinessContainerImage $c } }
        $results += @(Test-ReadinessImages $manifestText $P.ImagesManifestSha256 $names $ids)
        if ($null -ne $manifestText) { $results += @(Test-ReadinessWebUi $manifestText $P.Phase) }
    }
    $flags = $null
    if ($P.EnvFile) {
        $groups += 'configuracion'
        $text = Read-ReadinessText $P.EnvFile
        $flags = $(if ($null -eq $text) { $null } else { Get-ReadinessEnvFlags $text })
        $results += @(Test-ReadinessConfiguration $flags $P.Phase ($dbReady -and -not $P.SkipDatabase))
    }
    if ($P.MigrationsEvidence) { $groups += 'migraciones'; $results += @(Test-ReadinessEvidence (Read-ReadinessText $P.MigrationsEvidence)) }
    $runningCommit = '-'
    if ($P.HealthUrl) {
        $groups += 'salud'
        $h = $null; try { $h = Invoke-ReadinessHealth $P.HealthUrl } catch { $h = $null }
        if ($null -eq $h) { $results += New-ReadinessResult $false '/api/health responde' 'sin respuesta' }
        else {
            $results += New-ReadinessResult ([string]$h.status -eq 'ok' -and [string]$h.database -eq 'connected') '/api/health ok y base conectada' ('status=' + [string]$h.status + ' database=' + [string]$h.database)
            if ($P.ExpectedCommit) {
                $want = $P.ExpectedCommit.Substring(0, [Math]::Min(7, $P.ExpectedCommit.Length)).ToLower()
                $commitOk = ([string]$P.ExpectedCommit -match '\A[0-9a-fA-F]{7,40}\z' -and ([string]$h.commit).ToLower() -ceq $want)
                $results += New-ReadinessResult $commitOk 'commit en ejecucion = el esperado' ('en ejecucion=' + [string]$h.commit + ' esperado=' + $want)
                if ($commitOk) { $runningCommit = $want }
            }
        }
    }
    if ($P.NginxConf) { $groups += 'nginx'; $results += @(Test-ReadinessNginx (Read-ReadinessText $P.NginxConf)) }
    if ($P.ClosurePolicyFile) { $groups += 'cierre'; $results += @(Test-ReadinessClosurePolicy (Read-ReadinessText $P.ClosurePolicyFile) (Get-ReadinessFileSha256 $P.ClosurePolicyFile) $P.ClosurePolicySha256) }

    if (@($results).Count -eq 0) { $results += New-ReadinessResult $false 'se ejecuto al menos un control' 'nada que comprobar: revise los parametros' }
    foreach ($x in $results) { Write-Host ($(if ($x.Ok) { 'PASS ' } else { 'FAIL ' }) + $x.Name + $(if (-not $x.Ok -and $x.Detail) { ' :: ' + $x.Detail } else { '' })) }
    $fails = @($results | Where-Object { -not $_.Ok }).Count
    $gaps = @(Get-ReadinessProfileGaps $P $flags)
    $complete = ($gaps.Count -eq 0)
    foreach ($gap in $gaps) { Write-Host ('NO EJECUTADO ' + $gap) }
    # PASS exists ONLY for a complete profile without failures; anything else has no authority to deploy or enable.
    $kind = $(if ($fails) { 'FAIL' } elseif ($complete) { 'PASS' } else { 'PARTIAL' })
    $profileName = $(if ($complete) { $script:ReadinessProfile } else { 'diagnostico' })
    $missing = @($gaps | ForEach-Object { ($_ -split ':')[0] } | Select-Object -Unique)
    $groups = @($script:ReadinessGroups | Where-Object { $groups -contains $_ })
    $verdict = 'MANUFACTURA_READINESS_' + $kind + ' phase=' + $P.Phase + ' perfil=' + $profileName
    $line = $verdict + ' controles=' + @($results).Count + ' fallos=' + $fails + ' grupos=' + $(if ($groups.Count) { $groups -join ',' } else { '-' }) + ' commit=' + $runningCommit + ' faltan=' + $(if ($missing.Count) { $missing -join ',' } else { '-' }) + ' ' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    if ($P.EvidenceFile) { Write-ReadinessEvidence $P.EvidenceFile $line }
    $summary = $(if ($fails) { "$fails control(es) FALLARON: NO desplegar ni habilitar Manufactura" }
        elseif ($complete) { 'perfil ' + $script:ReadinessProfile + ': todos los controles PASS y todos los grupos obligatorios ejecutados' }
        else { 'DIAGNOSTICO PARCIAL: los controles ejecutados pasan pero faltan grupos obligatorios (' + ($missing -join ',') + '): esta corrida NO autoriza desplegar ni habilitar' })
    Write-Host ('RESULTADO: ' + $summary + '  [' + $verdict + ']')
    return $(if ($fails) { 1 } elseif ($complete) { 0 } else { 2 })
}
function Write-ReadinessEvidence {
    param([string]$Path, [string]$Line)
    $repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\') + '\'
    if ([System.IO.Path]::GetFullPath($Path).StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'The evidence file must be OUTSIDE the repository.' }
    [System.IO.File]::WriteAllText($Path, $Line + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

if ($MyInvocation.InvocationName -ne '.') {
    $p = @{ Phase = $Phase; Psql = $Psql; BackupModule = $BackupModule; EnvFile = $EnvFile; MigrationsEvidence = $MigrationsEvidence; HealthUrl = $HealthUrl; ExpectedCommit = $ExpectedCommit
        ImagesManifest = $ImagesManifest; ImagesManifestSha256 = $ImagesManifestSha256; Containers = @($Containers); NginxConf = $NginxConf; ClosurePolicyFile = $ClosurePolicyFile; ClosurePolicySha256 = $ClosurePolicySha256; EvidenceFile = $EvidenceFile; SkipDatabase = [bool]$SkipDatabase }
    exit (Invoke-ReadinessMain $p)
}
