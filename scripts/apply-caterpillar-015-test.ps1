# Gated cutover of migration 015 on daubert_hub_test ONLY. Without -Apply it stops after the read-only precheck (dry run).
#   $env:TEST_DATABASE_URL_MIGRATOR = '<postgres://postgres:...@host:5432/daubert_hub_test>'
#   .\scripts\apply-caterpillar-015-test.ps1 -BackupFile <dump> -BackupSha256 <hash> -OldWorkflowDeactivated            # dry run
#   .\scripts\apply-caterpillar-015-test.ps1 -BackupFile <dump> -BackupSha256 <hash> -OldWorkflowDeactivated -Apply     # real cutover
# Never prints the URL/password. Never runs down.sql. A failed step stops everything; nothing is cleaned up automatically.
param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [Parameter(Mandatory = $true)][string]$BackupSha256,
  [switch]$OldWorkflowDeactivated,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$dir = Join-Path $PSScriptRoot '..\database\migrations\daubert_global'
$stem = '20261022_015_caterpillar_atomic_admission_test'
$uri = [Uri]$env:TEST_DATABASE_URL_MIGRATOR
if ($uri.AbsolutePath -ne '/daubert_hub_test' -or [Uri]::UnescapeDataString($uri.UserInfo.Split(':')[0]) -ne 'postgres' -or $uri.Query) { throw 'Only postgres@daubert_hub_test with no query parameters is allowed' }
if (-not $OldWorkflowDeactivated) { throw 'Confirm the previous TEST workflow is deactivated with no running executions (-OldWorkflowDeactivated)' }
if (-not (Test-Path -LiteralPath $BackupFile)) { throw 'Backup file not found' }
if ((Get-FileHash -LiteralPath $BackupFile -Algorithm SHA256).Hash -ne $BackupSha256.ToUpper()) { throw 'Backup SHA-256 mismatch' }
$env:PGPASSWORD = [Uri]::UnescapeDataString($uri.UserInfo.Substring($uri.UserInfo.IndexOf(':') + 1))
$port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
function Invoke-Sql([string]$File, [string]$Command) {
  $arguments = @('-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', $uri.Host, '-p', $port, '-U', 'postgres', '-d', 'daubert_hub_test', '--no-password')
  $arguments += if ($File) { @('-f', $File) } else { @('-c', $Command) }
  $output = & $psql @arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql failed ($File$Command): $($output | Select-Object -Last 3 | Out-String)" }
  return ($output | Out-String).Trim()
}
try {
  $identity = Invoke-Sql $null "SELECT current_database()||'|'||current_user"
  if ($identity -ne 'daubert_hub_test|postgres') { throw 'Unexpected database identity' }
  $busy = Invoke-Sql $null "SELECT count(*) FROM ops.ejecuciones_automatizacion e JOIN ops.automatizaciones a USING(automatizacion_id) WHERE a.codigo='REMISIONES_CATERPILLAR' AND e.estado='PROCESANDO'"
  if ($busy -ne '0') { throw "$busy Caterpillar executions are PROCESANDO; reconcile them first" }
  $pre = Invoke-Sql (Join-Path $dir "$stem.precheck.sql") $null
  if ($pre -notmatch 'PRECHECK_015_PASS') { throw 'Precheck did not pass' }
  Write-Host 'PRECHECK_015_PASS (identity, backup hash and idle state verified)'
  if (-not $Apply) { Write-Host 'Dry run: nothing was changed. Re-run with -Apply to cut over.'; return }
  Invoke-Sql (Join-Path $dir "$stem.up.sql") $null | Out-Null
  Write-Host 'UP applied'
  $post = Invoke-Sql (Join-Path $dir "$stem.postcheck.sql") $null
  if ($post -notmatch 'POSTCHECK_015_PASS') { throw 'Postcheck did not pass: do NOT use the workflow; see the runbook recovery section' }
  Write-Host 'POSTCHECK_015_PASS'
  Write-Host 'Next: node apps\api\scripts\caterpillar-015-readonly-check.cjs  (review workerExecutableFunctions) and the checks in the runbook.'
} finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
