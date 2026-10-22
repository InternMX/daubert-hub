# Fresh custom-format backup of daubert_hub_test ONLY. Read-only against PostgreSQL; never prints the URL or password.
# Usage (PowerShell with the authorized TEST variable already set):
#   $env:TEST_DATABASE_URL_MIGRATOR = '<postgres://postgres:...@host:5432/daubert_hub_test>'
#   .\scripts\backup-caterpillar-test-db.ps1
$ErrorActionPreference = 'Stop'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$dir = 'C:\Users\06\Documents\Daubert\respaldos-postgres-test'
$uri = [Uri]$env:TEST_DATABASE_URL_MIGRATOR
if ($uri.AbsolutePath -ne '/daubert_hub_test' -or [Uri]::UnescapeDataString($uri.UserInfo.Split(':')[0]) -ne 'postgres' -or $uri.Query) { throw 'Only postgres@daubert_hub_test with no query parameters is allowed' }
if ($dir -like '*Dropbox*' -or $dir -like '*daubert-hub*') { throw 'Backup directory must be outside Dropbox and Git worktrees' }
$file = Join-Path $dir ('daubert_hub_test_pre015_{0}.dump' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path $file) { throw 'Refusing to overwrite an existing backup' }
$env:PGPASSWORD = [Uri]::UnescapeDataString($uri.UserInfo.Substring($uri.UserInfo.IndexOf(':') + 1))
try {
  & "$bin\pg_dump.exe" -h $uri.Host -p $(if ($uri.Port -gt 0) { $uri.Port } else { 5432 }) -U postgres -d daubert_hub_test -Fc --no-password -f $file
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
} finally { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
$item = Get-Item $file
if ($item.Length -le 0) { throw 'Empty backup' }
$list = & "$bin\pg_restore.exe" --list $file
if ($LASTEXITCODE -ne 0) { throw 'pg_restore --list failed' }
$header = $list | Select-Object -First 20
if (-not ($header -match 'dbname: daubert_hub_test')) { throw 'Archive does not identify daubert_hub_test' }
[pscustomobject]@{ file = $file; bytes = $item.Length; sha256 = (Get-FileHash $file -Algorithm SHA256).Hash; database = 'daubert_hub_test'
  catalogEntries = ($list | Where-Object { $_ -and $_ -notmatch '^;' }).Count
  note = 'pg_restore --list reads the catalog only; it is NOT a restore test. Restore into a disposable database before the cutover.' } | ConvertTo-Json
