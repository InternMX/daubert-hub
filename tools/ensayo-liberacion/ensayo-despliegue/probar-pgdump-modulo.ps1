<#
.SYNOPSIS
    Ejecuta el Invoke-PgDump REAL del modulo scripts\backup\lib\BackupPgTools.psm1 de un CLON (parchado o no) contra la instancia DESECHABLE del ensayo 6C.2, con el rol daubert_backup
    y un pgpass de ensayo. No usa la configuracion local de respaldos, ni destinos de publicacion, ni cifrado, ni tareas programadas.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Clone,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [int]$Port = 55433,
    [string]$Database = 'daubert_global',
    [string]$User = 'daubert_backup',
    [string]$Password = 'scratch',
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
    [switch]$SchemaOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Port -in 5432, 5433, 5434) { throw 'Refusing standard PostgreSQL ports: this tool is only for the disposable rehearsal instance.' }
$mod = Join-Path ([System.IO.Path]::GetFullPath($Clone)) 'scripts\backup\lib\BackupPgTools.psm1'
$dir = Join-Path ([System.IO.Path]::GetTempPath()) ('ens62-pgpass-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $dir | Out-Null
try {
    $pgpass = Join-Path $dir 'pgpass.conf'
    Set-Content -LiteralPath $pgpass -Value ('127.0.0.1:' + $Port + ':' + $Database + ':' + $User + ':' + $Password) -Encoding ASCII
    Import-Module $mod -Force
    $cfg = [pscustomobject]@{ PgBinPath = $PgBin; PgHost = '127.0.0.1'; PgPort = $Port; PgUser = $User; PgDatabase = $Database; PgPassFile = $pgpass }
    $r = if ($SchemaOnly) { Invoke-PgDump -Config $cfg -OutputPath $OutputPath -SchemaOnly } else { Invoke-PgDump -Config $cfg -OutputPath $OutputPath }
    $flag = (Get-Content -LiteralPath $mod -Raw) -match "'--enable-row-security'"
    $size = $(if (Test-Path -LiteralPath $OutputPath) { (Get-Item -LiteralPath $OutputPath).Length } else { 0 })
    Write-Host ('PGDUMP_MODULO exit=' + $r.ExitCode + ' success=' + $r.Success + ' modulo_con_enable_row_security=' + $flag + ' bytes=' + $size)
    if (-not $r.Success) { Write-Host ('stderr: ' + (($r.StdErrTail -split "`n" | Select-Object -First 3) -join ' | ')) }
    exit $(if ($r.Success) { 0 } else { 1 })
} finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
