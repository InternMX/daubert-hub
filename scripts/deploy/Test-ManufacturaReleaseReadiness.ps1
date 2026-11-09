<#
.SYNOPSIS
    READ-ONLY readiness check for the Manufactura release (before enabling it). It changes nothing: no SQL writes, no Docker mutation, no file writes.

.DESCRIPTION
    Closes the gaps that /api/health cannot see (health stays "ok" with the Manufactura flag on and no schema). Each check prints PASS/FAIL; exit code 1 if any fails (do NOT enable).
      1. Database: PGDATABASE is daubert_global; schema manufactura has the 9 tables, 33 policies (24 application + 9 pol_respaldo_sel) and RLS on every table.
      2. Backup coupling: the backup module (-BackupModule) passes --enable-row-security  <=>  the pol_respaldo_sel policies exist (the flag without policy dumps EMPTY tables; the policy without
         the flag makes pg_dump FAIL). Only the consistent states pass.
      3. Running commit (-HealthUrl /api/health) equals the base the database manifest was generated against (-ExpectedBase).
      4. Images: the running api/web container image IDs equal the images manifest (-ImagesManifest, -ImagesManifestSha256).
      5. External nginx conf (-NginxConf): contains the exact location for firma uploads with client_max_body_size 3m (otherwise signatures of 1-2 MB get 413).
      6. No Caterpillar 025 objects in the database (schema caterpillar folio recovery absent).
    Connection: PG* environment variables (operator-provided; never printed). Use -Psql to point to psql.exe.
#>
[CmdletBinding()]
param(
    [string]$Psql = 'psql',
    [string]$BackupModule = '',
    [string]$HealthUrl = '',
    [string]$ExpectedBase = '',
    [string]$ImagesManifest = '',
    [string]$ImagesManifestSha256 = '',
    [string[]]$Containers = @(),
    [string]$NginxConf = '',
    [switch]$SkipDatabase
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:fails = 0
function Check([bool]$Ok, [string]$Name, [string]$Detail = '') {
    Write-Host ($(if ($Ok) { 'PASS ' } else { 'FAIL ' }) + $Name + $(if (-not $Ok -and $Detail) { ' :: ' + $Detail } else { '' }))
    if (-not $Ok) { $script:fails++ }
}
function Query([string]$Sql) {
    $o = & $Psql -X -q -At -v ON_ERROR_STOP=1 -c $Sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('psql failed: ' + (($o | Out-String) -replace '(?i)password[^\r\n]*', 'password ***')) }
    return @($o | ForEach-Object { [string]$_ })
}
$policies = -1
if (-not $SkipDatabase) {
    Check ($env:PGDATABASE -eq 'daubert_global') 'PGDATABASE es daubert_global' ([string]$env:PGDATABASE)
    $tables = [int]@(Query "select count(*) from pg_tables where schemaname='manufactura'")[0]
    $policies = [int]@(Query "select count(*) from pg_policies where schemaname='manufactura'")[0]
    $backupPol = [int]@(Query "select count(*) from pg_policies where schemaname='manufactura' and policyname='pol_respaldo_sel'")[0]
    $noRls = [int]@(Query "select count(*) from pg_tables where schemaname='manufactura' and not rowsecurity")[0]
    Check ($tables -eq 9) 'esquema manufactura con 9 tablas' ([string]$tables)
    Check ($policies -eq 33 -and $backupPol -eq 9) 'manufactura con 33 politicas (24 + 9 pol_respaldo_sel)' ("politicas=$policies respaldo=$backupPol")
    Check ($noRls -eq 0) 'RLS activa en todas las tablas de manufactura' ([string]$noRls)
    $cat = [int]@(Query "select count(*) from information_schema.schemata where schema_name ilike '%folio_recovery%'")[0]
    Check ($cat -eq 0) 'no hay objetos de la 025 de Caterpillar' ([string]$cat)
    if ($BackupModule) {
        $hasFlag = ((Get-Content -LiteralPath $BackupModule -Raw) -match "'--enable-row-security'")
        Check ($hasFlag -eq ($backupPol -gt 0)) 'respaldo y politica 026 consistentes (--enable-row-security <=> pol_respaldo_sel)' ("modulo_con_bandera=$hasFlag politicas_respaldo=$backupPol")
    }
}
if ($HealthUrl) {
    $h = (Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
    Check ($h.status -eq 'ok' -and $h.database -eq 'connected') '/api/health ok y base conectada' ($h | ConvertTo-Json -Compress)
    if ($ExpectedBase) { Check ([string]$h.commit -eq $ExpectedBase.Substring(0, [Math]::Min(7, $ExpectedBase.Length))) 'commit en ejecucion = base del manifiesto de database/' ('en ejecucion=' + $h.commit + ' esperado=' + $ExpectedBase) }
}
if ($ImagesManifest) {
    $t = ((Get-Content -LiteralPath $ImagesManifest -Raw) -replace "`r`n", "`n")
    $sha = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($t))) -replace '-', '').ToLower()
    Check ($ImagesManifestSha256 -and $sha -eq $ImagesManifestSha256.ToLower()) 'SHA-256 del manifiesto de imagenes = el autorizado' $sha
    $m = $t | ConvertFrom-Json
    foreach ($c in @($Containers | ForEach-Object { $_ -split "," } | Where-Object { $_ })) {
        $svc = $(if ($c -match 'api') { 'api' } else { 'web' })
        $id = [string](& docker inspect $c --format '{{.Image}}' 2>$null)
        $want = [string](@($m.imagenes | Where-Object { $_.servicio -eq $svc })[0].imageId)
        Check ($id -eq $want) ('imagen en ejecucion de ' + $c + ' = imagen validada') ("en ejecucion=$id validada=$want")
    }
}
if ($NginxConf) {
    $conf = (Get-Content -LiteralPath $NginxConf -Raw)
    $ok = $conf -match 'location\s*=\s*/api/manufacturing-sheets/documents/signatures\s*\{[^}]*client_max_body_size\s+3m'
    Check $ok 'nginx externo: ruta de firmas con client_max_body_size 3m' $NginxConf
}
Write-Host ('RESULTADO: ' + $(if ($script:fails) { "$($script:fails) control(es) FALLARON: NO habilitar Manufactura" } else { 'todos los controles PASS' }))
exit $(if ($script:fails) { 1 } else { 0 })
