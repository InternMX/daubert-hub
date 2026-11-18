<#
.SYNOPSIS
    ENSAYO (Fase 6D) del ciclo completo del respaldo CIFRADO: pipeline real (Start-DaubertPostgresBackup.ps1 de un CLON) -> .age + .sha256 -> comprobacion del artefacto final
    (verificar-artefacto-cifrado.ps1: descifrado, desempaquetado, restauracion aislada), con un par de claves age DESECHABLE generado para el ensayo.

.DESCRIPTION
    No usa ni busca claves operativas, no lee %ProgramData%\DaubertHub\Backup\config.json (no se pasa -ConfigPath), no toca el destino real de respaldos, ni su lock, ni sus logs,
    ni las tareas programadas: TODAS las rutas (-BackupRoot, -StagingRoot, -LogRoot, -LockRoot, pgpass, recipients) apuntan a -Sandbox. La base es el PostgreSQL desechable del ensayo.
    -Clone: clon del repositorio cuyo scripts\backup se ejecuta (con el parche --enable-row-security aplicado para los casos positivos).
    -Tiers: Frequent (solo dump), Daily (dump + schema-only en 7z), Monthly (+ globals).
    Salida: una linea por artefacto y por negativo; exit 1 si algo no se comporta como se espera.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Clone,
    [Parameter(Mandatory = $true)][string]$Sandbox,
    [Parameter(Mandatory = $true)][string]$RolesFile,
    [string[]]$Tiers = @('Frequent', 'Daily', 'Monthly'),
    [string]$Label = 'positivo',
    [ValidateSet('integro', 'rechazado', 'pipeline-falla')][string]$Expect = 'integro',
    [switch]$Negatives,
    [int]$Port = 55434,
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe',
    [string]$AgePath = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$realRepo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
$cl = [System.IO.Path]::GetFullPath($Clone).TrimEnd('\'); $sb = [System.IO.Path]::GetFullPath($Sandbox).TrimEnd('\')
if ($cl -ieq $realRepo) { throw 'Refusing: -Clone must be a disposable clone, never the working repository.' }
if (($sb + '\').StartsWith($realRepo + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing: -Sandbox must be outside the repository.' }
if ($Port -in 5432, 5433) { throw 'Refusing standard PostgreSQL ports.' }
if (-not $AgePath) { $AgePath = (Get-Command age.exe -ErrorAction Stop).Source }
$keygen = Join-Path (Split-Path -Parent $AgePath) 'age-keygen.exe'
function Native([string]$Exe, [string[]]$A) { $p = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $o = & $Exe @A 2>&1; $c = $LASTEXITCODE } finally { $ErrorActionPreference = $p }; return [pscustomobject]@{ Code = $c; Out = @($o | ForEach-Object { [string]$_ }) } }
$script:bad = 0
function Expect([bool]$Ok, [string]$Text) { Write-Host ($(if ($Ok) { 'OK   ' } else { 'MAL  ' }) + $Text); if (-not $Ok) { $script:bad++ } }

# Claves DESECHABLES del ensayo (custodia sintetica FUERA de las rutas administradas por el respaldo).
$custody = Join-Path $sb 'custodia-sintetica'; $managed = Join-Path $sb ('administrado-' + $Label)
New-Item -ItemType Directory -Force -Path $custody, $managed | Out-Null
$identity = Join-Path $custody 'age-identity-ENSAYO.txt'
if (-not (Test-Path -LiteralPath $identity)) { $k = Native $keygen @('-o', $identity); if ($k.Code -ne 0) { throw 'age-keygen failed' } }
$other = Join-Path $custody 'age-identity-OTRA.txt'
if (-not (Test-Path -LiteralPath $other)) { $null = Native $keygen @('-o', $other) }
$recipients = Join-Path $managed 'age-recipients.txt'
$pub = @((Native $keygen @('-y', $identity)).Out | Where-Object { $_ -like 'age1*' })[0]
Set-Content -LiteralPath $recipients -Value $pub -Encoding ASCII
$pgpass = Join-Path $managed 'pgpass-ensayo.conf'
Set-Content -LiteralPath $pgpass -Value ('127.0.0.1:' + $Port + ':daubert_global:daubert_backup:scratch') -Encoding ASCII
$backupRoot = Join-Path $managed 'destino'; $staging = Join-Path $managed 'staging'; $logs = Join-Path $managed 'logs'; $locks = Join-Path $managed 'locks'
New-Item -ItemType Directory -Force -Path $backupRoot, $staging, $logs, $locks | Out-Null
$flag = (Get-Content -LiteralPath (Join-Path $cl 'scripts\backup\lib\BackupPgTools.psm1') -Raw) -match "'--enable-row-security'"
Write-Host ("===== $Label :: clon " + $(if ($flag) { 'CON' } else { 'SIN' }) + ' parche de respaldos; clave publica de ensayo ' + $pub.Substring(0, 12) + '...; se espera: ' + $Expect)

$stamp = Get-Date
foreach ($tier in $Tiers) {
    $stamp = $stamp.AddMinutes(1)
    $a = @('-NoProfile', '-File', (Join-Path $cl 'scripts\backup\commands\Start-DaubertPostgresBackup.ps1'), '-Tier', $tier, '-BackupRoot', $backupRoot, '-StagingRoot', $staging, '-PgBinPath', $PgBin, '-PgPassFile', $pgpass,
        '-PgHost', '127.0.0.1', '-PgPort', [string]$Port, '-PgUser', 'daubert_backup', '-PgDatabase', 'daubert_global', '-SevenZipPath', $SevenZipPath, '-AgePath', $AgePath, '-RecipientsFilePath', $recipients, '-LogRoot', $logs, '-LockRoot', $locks)
    $r = Native 'powershell' $a
    $age = @(Get-ChildItem -LiteralPath $backupRoot -Recurse -Filter '*.age' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $tier.ToUpper() } | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
    $left = @(Get-ChildItem -LiteralPath $staging -Recurse -File -ErrorAction SilentlyContinue).Count
    Write-Host ("[$tier] pipeline exit=$($r.Code) publicado=" + $(if ($age.Count) { $age[0].Name + ' (' + $age[0].Length + ' bytes)' } else { 'NADA' }) + " ; texto plano restante en staging=$left")
    if ($Expect -eq 'pipeline-falla') { Expect ($r.Code -ne 0 -and $age.Count -eq 0) "[$tier] el pipeline FALLA y no publica nada"; continue }
    if ($r.Code -ne 0 -or $age.Count -eq 0) { Expect $false "[$tier] el pipeline debia publicar un artefacto"; continue }
    Expect ($left -eq 0) "[$tier] no queda texto plano en staging"
    $vArgs = @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'verificar-artefacto-cifrado.ps1'), '-Artifact', $age[0].FullName, '-IdentityFile', $identity, '-WorkDir', (Join-Path $sb ('trabajo-' + $Label + '-' + $tier)), '-AgePath', $AgePath, '-SevenZipPath', $SevenZipPath, '-PgBin', $PgBin, '-RolesFile', $RolesFile)
    $v = Native 'powershell' $vArgs
    $v.Out | Set-Content -LiteralPath (Join-Path $sb ("verificacion-$Label-$tier.log")) -Encoding UTF8
    foreach ($l in @($v.Out | Where-Object { $_ -match '^(FAIL|Contenido|RESULTADO|   FAIL)' })) { Write-Host ('     ' + $(if ($l.Length -gt 210) { $l.Substring(0, 210) } else { $l })) }
    if ($Expect -eq 'integro') { Expect ($v.Code -eq 0) "[$tier] el ARTEFACTO FINAL (descifrado + restauracion) es integro" } else { Expect ($v.Code -ne 0) "[$tier] exit 0 del pipeline, pero el ARTEFACTO FINAL se RECHAZA" }

    if ($Negatives -and $tier -eq $Tiers[0]) {
        $neg = Join-Path $sb 'negativos'; New-Item -ItemType Directory -Force -Path $neg | Out-Null
        function Verify([string]$Art, [string]$Id, [string]$Name) { $w = Join-Path $sb ('trabajo-neg-' + $Name); $x = Native 'powershell' @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'verificar-artefacto-cifrado.ps1'), '-Artifact', $Art, '-IdentityFile', $Id, '-WorkDir', $w, '-AgePath', $AgePath, '-SevenZipPath', $SevenZipPath, '-PgBin', $PgBin, '-RolesFile', $RolesFile)
            $why = @($x.Out | Where-Object { $_ -like 'FAIL *' } | Select-Object -First 1); Expect ($x.Code -ne 0 -and -not (Test-Path -LiteralPath $w)) ("negativo $Name -> RECHAZADO" + $(if ($why.Count) { ' (' + ($why[0] -replace ' ::.*$', '') + ')' } else { '' }) + '; sin texto plano residual') }
        Verify $age[0].FullName $other 'clave-equivocada'
        $t1 = Join-Path $neg 'alterado.age'; $bytes = [System.IO.File]::ReadAllBytes($age[0].FullName); $bytes[[int]($bytes.Length / 2)] = $bytes[[int]($bytes.Length / 2)] -bxor 0xFF; [System.IO.File]::WriteAllBytes($t1, $bytes); Copy-Item -LiteralPath ($age[0].FullName + '.sha256') -Destination ($t1 + '.sha256')
        Verify $t1 $identity 'un-byte-alterado-sidecar-original'
        $t2 = Join-Path $neg 'alterado-sidecar-recalculado.age'; [System.IO.File]::WriteAllBytes($t2, $bytes); Set-Content -LiteralPath ($t2 + '.sha256') -Value ((Get-FileHash -LiteralPath $t2 -Algorithm SHA256).Hash.ToLower() + '  alterado-sidecar-recalculado.age') -Encoding ASCII
        Verify $t2 $identity 'un-byte-alterado-sidecar-recalculado'
        $t3 = Join-Path $neg 'truncado.age'; [System.IO.File]::WriteAllBytes($t3, $bytes[0..([int]($bytes.Length * 0.7))]); Set-Content -LiteralPath ($t3 + '.sha256') -Value ((Get-FileHash -LiteralPath $t3 -Algorithm SHA256).Hash.ToLower() + '  truncado.age') -Encoding ASCII
        Verify $t3 $identity 'truncado-sidecar-recalculado'
        $t4 = Join-Path $neg 'sin-sidecar.age'; Copy-Item -LiteralPath $age[0].FullName -Destination $t4
        Verify $t4 $identity 'sin-sidecar'
    }
}
Write-Host ("RESULTADO[$Label]: " + $(if ($script:bad) { "$($script:bad) comportamiento(s) inesperado(s)" } else { 'todo se comporto como se esperaba' }))
exit $(if ($script:bad) { 1 } else { 0 })
