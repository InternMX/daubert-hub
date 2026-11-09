<#
.SYNOPSIS
    Applies, in the maintenance window and by hand-supervised steps, the PRODUCTION migrations of Manufactura (020-024 and 026) with prechecks, postchecks and the transversal verification,
    and writes the evidence file that Deploy-DaubertHub.ps1 -AcknowledgeMigrationsAlreadyApplied requires (Windows PowerShell 5.1).

.DESCRIPTION
    Order (fixed, never taken from the folder): 020 -> 021 -> 022 -> 023 -> 024 -> 026. Each step = precheck -> up -> postcheck -> transversal verification; the first failure stops everything
    (nothing further is run, nothing is retried, no DOWN is executed automatically).

    Before any SQL it verifies the RELEASE MANIFEST (scripts/deploy/generar-manifiesto-database.cjs):
      * the SHA-256 of the manifest text (LF line endings) equals -DatabaseManifestSha256 (delivered outside the repository);
      * the steps of the manifest are EXACTLY 020,021,022,023,024,026 (the Caterpillar 025 of another branch can never be listed);
      * every precheck/up/postcheck file and the two read-only verifiers exist in HEAD with the SHA-256 of the manifest AND the working-tree copy has the same content (LF-normalised).
    Connection: standard libpq variables of THIS process (PGHOST, PGPORT, PGUSER, PGDATABASE=daubert_global, PGPASSWORD or a pgpass file) set by the operator; never printed. It refuses to run
    unless the connected database is daubert_global and the role is an administrator, and the 'manufactura' schema state is the one the next step expects (each precheck enforces it).
    Without -Apply NOTHING is executed against the database: the verified plan is printed. This script never touches Docker, n8n, the Hub or any other database.

.PARAMETER Apply                    Execute (default: verify the manifest and print the plan only).
.PARAMETER EvidenceFile             Output file, OUTSIDE the repository (required with -Apply).
.PARAMETER DatabaseManifest         Manifest path (default deploy/release-manifests/manufactura-database-release.json).
.PARAMETER DatabaseManifestSha256   SHA-256 of the manifest text, from the authorisation record (required).
.PARAMETER Psql                     psql executable (default: psql on PATH).
.PARAMETER UntilStep                Optional: stop after this step (020, 021, 022, 023, 024 or 026), for staged windows and rehearsals.
.PARAMETER FromStep                 Optional: resume at this step after a staged stop (earlier steps are NOT re-run; the baseline is then captured at this moment, so it only proves that nothing outside Manufactura changed since then).
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$EvidenceFile = '',
    [string]$DatabaseManifest = 'deploy/release-manifests/manufactura-database-release.json',
    [Parameter(Mandatory = $true)][string]$DatabaseManifestSha256,
    [string]$Psql = 'psql',
    [ValidateSet('', '020', '021', '022', '023', '024', '026')][string]$UntilStep = '',
    [ValidateSet('020', '021', '022', '023', '024', '026')][string]$FromStep = '020'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$dir = Join-Path $repo 'database\migrations\daubert_global'
$expectedOrder = @('020', '021', '022', '023', '024', '026')
$stepVars = @{ '020' = 'baseline'; '021' = 'huella_101'; '022' = 'huella_manufactura'; '023' = 'huella_manufactura'; '024' = 'huella_resto'; '026' = 'dos_huellas' }
$baselineNames = @('baseline_users', 'baseline_empresas', 'baseline_audit_cambios', 'baseline_tablas_fp', 'baseline_funciones_fp', 'baseline_columnas_fp', 'baseline_triggers_fp', 'baseline_privilegios_fp', 'baseline_roles_fp', 'baseline_acl_bases_fp', 'baseline_esquemas_acl_fp')

function Get-Sha256Text([byte[]]$Bytes) {
    $h = [System.Security.Cryptography.SHA256]::Create().ComputeHash($Bytes)
    return ([System.BitConverter]::ToString($h)).Replace('-', '').ToLower()
}
function Get-NormalizedBytes([string]$Path) {
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) -replace "`r`n", "`n"
    return [System.Text.Encoding]::UTF8.GetBytes($text)
}
function Get-GitBlobBytes([string]$RepoPath) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'git'; $psi.Arguments = '-C "' + $repo + '" cat-file blob HEAD:' + $RepoPath
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $ms = New-Object System.IO.MemoryStream
    $p.StandardOutput.BaseStream.CopyTo($ms)
    $null = $p.StandardError.ReadToEnd(); $p.WaitForExit()
    if ($p.ExitCode -ne 0) { return $null }
    return $ms.ToArray()
}

# ------------------------------------------------------------------ 1. manifest (no database involved)
$manifestFull = if ([System.IO.Path]::IsPathRooted($DatabaseManifest)) { $DatabaseManifest } else { Join-Path $repo $DatabaseManifest }
if (-not (Test-Path -LiteralPath $manifestFull)) { throw "Manifest not found: $manifestFull" }
$manifestSha = Get-Sha256Text (Get-NormalizedBytes $manifestFull)
if ($manifestSha -ne $DatabaseManifestSha256.ToLower()) { throw "Manifest SHA-256 ($manifestSha) does not match -DatabaseManifestSha256. Nothing was run." }
$manifest = [System.IO.File]::ReadAllText($manifestFull, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
if ([string]$manifest.formato -ne '1') { throw 'Unsupported manifest format.' }
$order = @($manifest.ordenMigraciones | ForEach-Object { [string]$_.paso })
if (($order -join ',') -ne ($expectedOrder -join ',')) { throw ("The manifest steps are '" + ($order -join ',') + "' but exactly '" + ($expectedOrder -join ',') + "' are authorised. Nothing was run.") }
$byPath = @{}; foreach ($a in @($manifest.archivos)) { $byPath[[string]$a.ruta] = $a }
$prefix = 'database/migrations/daubert_global/'
$steps = @()
foreach ($s in @($manifest.ordenMigraciones)) {
    if ([string]$s.id -match '_025_|caterpillar') { throw "Step $($s.paso) points at a forbidden migration ($($s.id))." }
    $files = @{}
    foreach ($phase in 'precheck', 'up', 'postcheck') {
        $rel = $prefix + $s.id + '.' + $phase + '.sql'
        if (-not $byPath.ContainsKey($rel)) { throw "$rel is not in the manifest." }
        $entry = $byPath[$rel]
        if ([string]$entry.categoria -ne 'produccion_aplicar') { throw "$rel has category $($entry.categoria), expected produccion_aplicar." }
        $git = Get-GitBlobBytes $rel
        if ($null -eq $git) { throw "$rel does not exist in HEAD." }
        if ((Get-Sha256Text $git) -ne [string]$entry.sha256) { throw "$rel in HEAD differs from the manifest (SHA-256). Nothing was run." }
        $local = Join-Path $dir ($s.id + '.' + $phase + '.sql')
        if (-not (Test-Path -LiteralPath $local)) { throw "Working-tree file missing: $local" }
        if ((Get-Sha256Text (Get-NormalizedBytes $local)) -ne [string]$entry.sha256) { throw "Working-tree copy of $rel differs from the manifest (uncommitted or edited file). Nothing was run." }
        $files[$phase] = $local
    }
    $steps += [pscustomobject]@{ Paso = [string]$s.paso; Id = [string]$s.id; Files = $files }
}
$verifier = $null; $smoke = $null
foreach ($name in @($manifest.lecturaProduccion)) {
    $rel = $prefix + $name; if (-not $byPath.ContainsKey($rel)) { throw "$rel is not in the manifest." }
    $local = Join-Path $dir $name
    if ((Get-Sha256Text (Get-NormalizedBytes $local)) -ne [string]$byPath[$rel].sha256) { throw "$rel differs from the manifest. Nothing was run." }
    if ($name -like '*verificar_fuera_de_manufactura*') { $verifier = $local } elseif ($name -like '*smoke_solo_lectura*') { $smoke = $local }
}
if (-not $verifier -or -not $smoke) { throw 'The manifest must list the transversal verifier and the read-only smoke.' }

Write-Host ("Manifest OK: {0} ({1} files authorised for database/, base {2})" -f $manifestSha.Substring(0, 12), @($manifest.archivos).Count, ([string]$manifest.base).Substring(0, 7))
if (-not $Apply) {
    Write-Host 'PLAN (nothing executed; add -Apply, -EvidenceFile inside the window):'
    foreach ($s in $steps) { Write-Host (" - {0}: {1}  (precheck -> up -> postcheck -> transversal verification)" -f $s.Paso, $s.Id) }
    Write-Host (" - read-only smoke: {0}" -f (Split-Path -Leaf $smoke))
    Write-Host 'Excluded on purpose: Caterpillar 025 (other branch), every daubert_hub_test file, database/maintenance, tools, replica_only. DOWN files are never run automatically.'
    exit 0
}

# ------------------------------------------------------------------ 2. database (only with -Apply)
if (-not $EvidenceFile) { throw '-EvidenceFile is required with -Apply.' }
$evidenceFull = [System.IO.Path]::GetFullPath($EvidenceFile)
if ($evidenceFull.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'EvidenceFile must be outside the repository' }
if ($env:PGDATABASE -ne 'daubert_global') { throw 'PGDATABASE must be daubert_global' }

function Invoke-Sql([string]$File, [string[]]$Extra) {
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $Psql -X -v ON_ERROR_STOP=1 -At -F '|' @Extra -f $File 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Out = $out }
}
function Invoke-SqlText([string]$Sql) {
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $Psql -X -v ON_ERROR_STOP=1 -At -F '|' -c $Sql 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Out = $out }
}
function Get-BoolRows([string]$Out) { return @($Out -split "`r?`n" | Where-Object { $_ -match '^[tf](\|[tf])+$' }) }
function Test-AllTrue([string]$Out) {
    $rows = @(Get-BoolRows $Out)
    if ($rows.Count -eq 0) { return $false }
    foreach ($row in $rows) { if (($row -split '\|') -contains 'f') { return $false } }
    return $true
}
function Add-Evidence([string]$Text) { Add-Content -LiteralPath $evidenceFull -Encoding ASCII -Value $Text }
function Stop-Step([string]$Message) { Add-Evidence ("STOPPED: " + $Message); throw ($Message + " Nothing further was run; see $evidenceFull.") }

$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $evidenceFull)
Set-Content -LiteralPath $evidenceFull -Encoding ASCII -Value ("MANUFACTURA MIGRATIONS EVIDENCE " + (Get-Date -Format s) + " manifest=" + $manifestSha)

$who = Invoke-SqlText "SELECT current_database(), (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), (SELECT count(*) FROM pg_namespace WHERE nspname = 'manufactura')"
Add-Evidence ("--- connection check exit=" + $who.Code + "`n" + $who.Out.Trim())
if ($who.Code -ne 0 -or $who.Out.Trim() -notmatch '^daubert_global\|t\|[01]$') { Stop-Step 'Not connected to daubert_global as an administrator.' }

$cap = Invoke-Sql $verifier @()
if ($cap.Code -ne 0) { Stop-Step 'The transversal verifier failed to capture the baseline.' }
$cmdLine = @($cap.Out -split "`r?`n" | Where-Object { $_.StartsWith('psql ') }) | Select-Object -First 1
$baseVars = @()
if ($cmdLine) { foreach ($m in [regex]::Matches($cmdLine, '-v (f_[a-z]+)=([0-9a-f]{32})')) { $baseVars += @('-v', ($m.Groups[1].Value + '=' + $m.Groups[2].Value)) } }
if ($baseVars.Count -ne 28) { Stop-Step ("The baseline must have 14 fingerprints (found " + ($baseVars.Count / 2) + ").") }
Add-Evidence 'BASELINE_CAPTURED (14 fingerprints, read-only)'

foreach ($s in $steps) {
    if ([int]$s.Paso -lt [int]$FromStep) { Add-Evidence ('SKIPPED_' + $s.Paso + ' (-FromStep ' + $FromStep + ')'); continue }
    Write-Host ("== {0} {1}" -f $s.Paso, $s.Id)
    $pre = Invoke-Sql $s.Files['precheck'] @()
    Add-Evidence ("--- {0} precheck exit={1}`n{2}" -f $s.Id, $pre.Code, $pre.Out.Trim())
    if ($pre.Code -ne 0) { Stop-Step "$($s.Paso): precheck failed (exit $($pre.Code))." }
    $rows = @(Get-BoolRows $pre.Out)
    if ($rows.Count -eq 0) { Stop-Step "$($s.Paso): the precheck printed no checks." }
    foreach ($row in $rows) { if (($row -split '\|') -contains 'f') { Stop-Step "$($s.Paso): the precheck has a false check." } }
    # variables the postcheck needs
    $vars = @()
    $lines = @($pre.Out -split "`r?`n" | Where-Object { $_ })
    switch ($stepVars[$s.Paso]) {
        'baseline' {
            $row = @($lines | Where-Object { $_.Contains('|') -and $_ -notmatch '^[tf](\|[tf])+$' }) | Select-Object -Last 1
            $vals = @(if ($row) { $row -split '\|' })
            if ($vals.Count -ne $baselineNames.Count -or @($vals | Where-Object { $_ -eq '' }).Count -gt 0) { Stop-Step '020: the precheck did not print the 11 baseline values.' }
            for ($i = 0; $i -lt $baselineNames.Count; $i++) { $vars += @('-v', ($baselineNames[$i] + '=' + $vals[$i])) }
        }
        'dos_huellas' {
            $row = @($lines | Where-Object { $_ -match '^[0-9a-f]{32}\|[0-9a-f]{32}$' }) | Select-Object -First 1
            if (-not $row) { Stop-Step '026: the precheck did not print the two fingerprints.' }
            $p = $row -split '\|'; $vars += @('-v', ('huella_politicas_app=' + $p[0]), '-v', ('huella_privilegios=' + $p[1]))
        }
        default {
            $h = @($lines | Where-Object { $_ -match '^[0-9a-f]{32}$' }) | Select-Object -First 1
            if (-not $h) { Stop-Step "$($s.Paso): the precheck did not print its fingerprint." }
            $vars += @('-v', ($stepVars[$s.Paso] + '=' + $h))
        }
    }
    $up = Invoke-Sql $s.Files['up'] @()
    Add-Evidence ("--- {0} up exit={1}`n{2}" -f $s.Id, $up.Code, $up.Out.Trim())
    if ($up.Code -ne 0 -or $up.Out -notmatch 'UP_OK') { Stop-Step "$($s.Paso): UP failed (exit $($up.Code)). The UP is one transaction: nothing of this step remains." }
    $post = Invoke-Sql $s.Files['postcheck'] $vars
    Add-Evidence ("--- {0} postcheck exit={1}`n{2}" -f $s.Id, $post.Code, $post.Out.Trim())
    if ($post.Code -ne 0 -or -not (Test-AllTrue $post.Out)) { Stop-Step "$($s.Paso): postcheck is not all true. The UP WAS applied: review before any DOWN (never automatic)." }
    Add-Evidence ("POSTCHECK_{0}_PASS" -f $s.Paso)
    $ver = Invoke-Sql $verifier (@('-v', ('nivel=' + [int]$s.Paso)) + $baseVars)
    Add-Evidence ("--- transversal verification level {0} exit={1}`n{2}" -f $s.Paso, $ver.Code, $ver.Out.Trim())
    if ($ver.Code -ne 0 -or -not (Test-AllTrue $ver.Out)) { Stop-Step "$($s.Paso): the transversal verification failed (something outside Manufactura changed or a privilege differs)." }
    Add-Evidence ("VERIFY_{0}_PASS" -f $s.Paso)
    if ($UntilStep -eq $s.Paso) { Add-Evidence ("STAGED_STOP_AFTER_" + $s.Paso); Write-Host "Stopped after $($s.Paso) (-UntilStep). Evidence: $evidenceFull"; exit 0 }
}
$sm = Invoke-Sql $smoke @()
Add-Evidence ("--- read-only smoke exit={0}`n{1}" -f $sm.Code, $sm.Out.Trim())
$smRows = @($sm.Out -split "`r?`n" | Where-Object { $_ -match '^\d+\|' })
if ($sm.Code -ne 0 -or $smRows.Count -lt 10 -or @($smRows | Where-Object { $_ -notmatch '\|t$' }).Count -gt 0) { Stop-Step 'The read-only smoke failed.' }
Add-Evidence 'SMOKE_READONLY_PASS'
Add-Evidence 'MANUFACTURA_SQL_COMPLETE'
Write-Host "MANUFACTURA SQL COMPLETE. Evidence: $evidenceFull"
