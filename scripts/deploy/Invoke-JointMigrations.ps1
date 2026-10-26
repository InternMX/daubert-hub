<#
.SYNOPSIS
    Applies, in the window, the SQL of the joint release (Pagos 019 + Caterpillar 013 + role + 016) with prechecks and postchecks, and writes the evidence file that
    Deploy-DaubertHub.ps1 -AcknowledgeMigrationsAlreadyApplied requires (Windows PowerShell 5.1).

.DESCRIPTION
    Order (each step = precheck -> up -> postcheck, stop at the first failure; nothing is retried):
      1. 20261023_019_payment_file_recovery_prod   (Pagos)         2. 20261020_013_caterpillar_cancellation
      3. role n8n_cat_prod (worker_role_prod.template.sql)          4. 20261024_016_caterpillar_atomic_admission_prod
    The order does not change the final schema (verified both ways); it is fixed so the procedure is the same every time.

    Connection: standard libpq variables of THIS process (PGHOST, PGPORT, PGUSER, PGDATABASE=daubert_global, PGPASSWORD or a pgpass file) set by the operator; they are never
    printed. The role password comes from the environment variable CAT_WORKER_PASSWORD (never a parameter, never printed). Every psql call uses ON_ERROR_STOP.
    Without -Apply nothing is executed: the plan is printed. This script never touches Docker, n8n or the Hub.

.PARAMETER Apply         Execute (default: print the plan only).
.PARAMETER EvidenceFile  Output file (default: <repo>\..\evidence\joint-migrations-<timestamp>.txt is NOT used; pass a path outside the repository).
.PARAMETER Psql          psql executable (default: psql on PATH).
.PARAMETER SkipRole      Do not create the role (it already exists; the 016 postcheck still verifies its privileges).
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [Parameter(Mandatory = $true)][string]$EvidenceFile,
    [string]$Psql = 'psql',
    [switch]$SkipRole
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\database\migrations\daubert_global'))
if ($env:PGDATABASE -ne 'daubert_global') { throw 'PGDATABASE must be daubert_global' }
$evidenceFull = [System.IO.Path]::GetFullPath($EvidenceFile)
if ($evidenceFull.StartsWith([System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')), [System.StringComparison]::OrdinalIgnoreCase)) { throw 'EvidenceFile must be outside the repository' }

$steps = @(
    @{ name = '019 Pagos recovery'; id = '20261023_019_payment_file_recovery_prod'; marker = 'POSTCHECK_019_EXECUTED_OK'; expect = $null },
    @{ name = '013 Caterpillar cancellation'; id = '20261020_013_caterpillar_cancellation'; marker = 'POSTCHECK_013_PASS'; expect = 'PRECHECK_013_PASS' },
    @{ name = 'role n8n_cat_prod'; id = '20261024_016_caterpillar_worker_role_prod.template'; marker = ''; expect = $null },
    @{ name = '016 Caterpillar atomic admission'; id = '20261024_016_caterpillar_atomic_admission_prod'; marker = 'POSTCHECK_016_PASS'; expect = 'PRECHECK_016_PASS' }
)
foreach ($s in $steps) { foreach ($suffix in $(if ($s.id -like '*template') { @('.sql') } else { @('.precheck.sql', '.up.sql', '.postcheck.sql') })) { if (-not (Test-Path -LiteralPath (Join-Path $dir ($s.id + $suffix)))) { throw "Missing $($s.id)$suffix" } } }
if (-not $Apply) {
    Write-Host 'PLAN (nothing executed; add -Apply inside the window):'
    foreach ($s in $steps) { Write-Host (" - {0}: {1}" -f $s.name, $s.id) }
    Write-Host "Evidence file: $evidenceFull"
    exit 0
}
if (-not $SkipRole -and -not $env:CAT_WORKER_PASSWORD) { throw 'CAT_WORKER_PASSWORD (environment variable) is required to create the role' }

function Invoke-Sql([string]$file, [string[]]$extra) {
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $Psql -X -q -v ON_ERROR_STOP=1 @extra -f $file 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Out = $out }
}
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $evidenceFull)
Set-Content -LiteralPath $evidenceFull -Encoding ASCII -Value ("JOINT MIGRATIONS EVIDENCE " + (Get-Date -Format s))
foreach ($s in $steps) {
    Write-Host ("== {0}" -f $s.name)
    if ($s.id -like '*template') {
        if ($SkipRole) { Write-Host 'role step skipped by -SkipRole'; continue }
        $r = Invoke-Sql (Join-Path $dir ($s.id + '.sql')) @('-v', "worker_password=$($env:CAT_WORKER_PASSWORD)")
        if ($r.Code -ne 0) { throw "role step failed (exit $($r.Code))" }
        Add-Content -LiteralPath $evidenceFull -Encoding ASCII -Value "ROLE_STEP_OK"
        continue
    }
    foreach ($phase in 'precheck', 'up', 'postcheck') {
        $r = Invoke-Sql (Join-Path $dir ("$($s.id).$phase.sql")) @()
        Add-Content -LiteralPath $evidenceFull -Encoding ASCII -Value ("--- {0} {1} exit={2}`n{3}" -f $s.id, $phase, $r.Code, $r.Out.Trim())
        if ($r.Code -ne 0) { throw "$($s.name): $phase failed (exit $($r.Code)); see $evidenceFull. Nothing further was run." }
        if ($phase -eq 'precheck' -and $s.expect -and $r.Out -notmatch $s.expect) { throw "$($s.name): precheck did not print $($s.expect); nothing was applied" }
        if ($phase -eq 'postcheck') {
            if ($s.marker -like '*EXECUTED_OK') { Add-Content -LiteralPath $evidenceFull -Encoding ASCII -Value $s.marker }
            elseif ($r.Out -notmatch $s.marker) { throw "$($s.name): postcheck did not print $($s.marker)" }
        }
    }
}
Add-Content -LiteralPath $evidenceFull -Encoding ASCII -Value 'JOINT_SQL_COMPLETE'
Write-Host "JOINT SQL COMPLETE. Evidence: $evidenceFull"
