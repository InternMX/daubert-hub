<#
.SYNOPSIS
    Ensayo de scripts\deploy\Invoke-ManufacturaMigrations.ps1 contra una instancia PostgreSQL DESECHABLE (copia de daubert_global) y sobre un CLON aislado del repositorio.

.DESCRIPTION
    Escenarios (cada uno debe comportarse como se espera; el codigo de salida es 1 si alguno no lo hace):
      A. sin -Apply solo verifica el manifiesto e imprime el plan, sin tocar la base
      B. SHA-256 del manifiesto incorrecto: se niega antes de cualquier SQL
      C. archivo de migracion editado en el arbol de trabajo (sin commit): se niega antes de cualquier SQL
      D. manifiesto con otro orden o con la 025: se niega aunque se le entregue su nuevo SHA-256
      E. base de datos equivocada (PGDATABASE distinta de daubert_global): se niega
      F. contrasena incorrecta: se detiene en la comprobacion de conexion sin aplicar nada
      G. ventana por etapas (-UntilStep 021), desviacion de privilegios provocada y -FromStep 022: se detiene en la verificacion transversal y NO llega a la 023
      H. instancia nueva: aplicacion completa 020-024 y 026 con evidencia y marcadores
      I. repeticion sobre la base ya migrada: se detiene en el precheck de la 020 y no cambia nada
    Requiere: el contenedor `ens-c1-pg` (puerto local 55451) y un clon aislado. No toca ninguna otra base ni servicio.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Clone,
    [Parameter(Mandatory = $true)][string]$ManifestSha256,
    [Parameter(Mandatory = $true)][string]$Evidencia,
    [string]$PsqlExe = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
    [string]$Contenedor = 'ens-c1-pg',
    [string]$ScriptMk = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$mine = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$cloneFull = [System.IO.Path]::GetFullPath($Clone)
if ($cloneFull.TrimEnd('\') -ieq $mine.TrimEnd('\')) { throw 'Refusing to run on the working repository: pass an isolated clone.' }
$null = New-Item -ItemType Directory -Force -Path $Evidencia
$inv = Join-Path $cloneFull 'scripts\deploy\Invoke-ManufacturaMigrations.ps1'
$script:fails = 0
$env:PGHOST = '127.0.0.1'; $env:PGPORT = '55451'; $env:PGUSER = 'postgres'; $env:PGPASSWORD = 'scratch'; $env:PGDATABASE = 'daubert_global'

function Run-Inv([string[]]$ArgList) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $inv @ArgList 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
    return @{ Code = $code; Out = $out }
}
function Sql([string]$Q) { $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { return ((& $PsqlExe -X -At -F '|' -c $Q 2>&1 | Out-String).Trim()) } finally { $ErrorActionPreference = $prev } }
function Expect([string]$Name, [bool]$Cond, [string]$Detalle = '') {
    Write-Host ($(if ($Cond) { 'PASS ' } else { 'FAIL ' }) + $Name + $(if (-not $Cond -and $Detalle) { '  :: ' + $Detalle.Substring(0, [Math]::Min(300, $Detalle.Length)) } else { '' }))
    if (-not $Cond) { $script:fails++ }
}
function Estado { return (Sql "SELECT (to_regnamespace('manufactura') IS NOT NULL), (SELECT count(*) FROM pg_policies WHERE schemaname='manufactura'), (SELECT count(*) FROM pg_tables WHERE schemaname='manufactura')") }
$ev = Join-Path $Evidencia 'evidencia_migraciones.txt'
$base = @('-DatabaseManifestSha256', $ManifestSha256, '-Psql', $PsqlExe)

# A
$r = Run-Inv $base
Expect 'A. sin -Apply: verifica el manifiesto, imprime el plan (020,021,022,023,024,026) y excluye la 025' ($r.Code -eq 0 -and $r.Out -match 'Manifest OK' -and $r.Out -match '020' -and $r.Out -match '026' -and $r.Out -match 'Excluded on purpose: Caterpillar 025') $r.Out
Expect 'A. el plan no toco la base (manufactura no existe)' ((Estado) -eq 'f|0|0') (Estado)

# B
$r = Run-Inv @('-DatabaseManifestSha256', ('0' * 64), '-Apply', '-EvidenceFile', $ev)
Expect 'B. SHA-256 del manifiesto incorrecto: se niega antes de cualquier SQL' ($r.Code -ne 0 -and $r.Out -match 'does not match' -and -not (Test-Path $ev)) $r.Out
Expect 'B. la base sigue intacta' ((Estado) -eq 'f|0|0')

# C
$p = Join-Path $cloneFull 'database\migrations\daubert_global\20261108_022_manufactura_inventario_firmas_admin_prod.up.sql'
Add-Content -LiteralPath $p -Value '-- edicion local no autorizada'
$r = Run-Inv ($base + @('-Apply', '-EvidenceFile', $ev))
Expect 'C. migracion editada en el arbol de trabajo (sin commit): se niega antes de cualquier SQL' ($r.Code -ne 0 -and $r.Out -match 'differs from the manifest' -and -not (Test-Path $ev)) $r.Out
Expect 'C. la base sigue intacta' ((Estado) -eq 'f|0|0')
& git -C $cloneFull checkout -q -- database 2>&1 | Out-Null

# D
$man = Join-Path $cloneFull 'deploy\release-manifests\manufactura-database-release.json'
$orig = Get-Content -LiteralPath $man -Raw
function ShaTexto([string]$t) { $b = [System.Text.Encoding]::UTF8.GetBytes(($t -replace "`r`n", "`n")); return ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($b))).Replace('-', '').ToLower() }
$j = $orig | ConvertFrom-Json
$o = @($j.ordenMigraciones); $j.ordenMigraciones = @($o[0], $o[2], $o[1], $o[3], $o[4], $o[5])
$t1 = $j | ConvertTo-Json -Depth 10; Set-Content -LiteralPath $man -Value $t1 -Encoding UTF8
$r = Run-Inv @('-DatabaseManifestSha256', (ShaTexto (Get-Content -LiteralPath $man -Raw)), '-Apply', '-EvidenceFile', $ev)
Expect 'D. manifiesto con las migraciones en otro orden (aunque se entregue su SHA-256): se niega' ($r.Code -ne 0 -and $r.Out -match 'authorised' -and -not (Test-Path $ev)) $r.Out
$j = $orig | ConvertFrom-Json
$j.ordenMigraciones = @($j.ordenMigraciones) + [pscustomobject]@{ paso = '025'; id = '20261106_025_caterpillar_folio_recovery_test'; fases = @('precheck', 'up', 'postcheck'); reversion = 'down' }
Set-Content -LiteralPath $man -Value ($j | ConvertTo-Json -Depth 10) -Encoding UTF8
$r = Run-Inv @('-DatabaseManifestSha256', (ShaTexto (Get-Content -LiteralPath $man -Raw)), '-Apply', '-EvidenceFile', $ev)
Expect 'D. manifiesto con la 025 de Caterpillar como paso (aunque se entregue su SHA-256): se niega' ($r.Code -ne 0 -and $r.Out -match 'authorised' -and -not (Test-Path $ev)) $r.Out
& git -C $cloneFull checkout -q -- deploy 2>&1 | Out-Null
Expect 'D. la base sigue intacta' ((Estado) -eq 'f|0|0')

# E
$env:PGDATABASE = 'postgres'
$r = Run-Inv ($base + @('-Apply', '-EvidenceFile', $ev))
Expect 'E. PGDATABASE distinta de daubert_global: se niega' ($r.Code -ne 0 -and $r.Out -match 'PGDATABASE must be daubert_global') $r.Out
$env:PGDATABASE = 'daubert_global'

# F
$env:PGPASSWORD = 'incorrecta'
$r = Run-Inv ($base + @('-Apply', '-EvidenceFile', $ev))
$env:PGPASSWORD = 'scratch'
Expect 'F. contrasena incorrecta: se detiene en la comprobacion de conexion y deja constancia (STOPPED)' ($r.Code -ne 0 -and (Test-Path $ev) -and ((Get-Content $ev -Raw) -match 'STOPPED') -and ((Get-Content $ev -Raw) -notmatch 'precheck')) $r.Out
Expect 'F. la base sigue intacta' ((Estado) -eq 'f|0|0')
Remove-Item -LiteralPath $ev -Force -ErrorAction SilentlyContinue

# G
$ev2 = Join-Path $Evidencia 'evidencia_etapas.txt'
$r = Run-Inv ($base + @('-Apply', '-EvidenceFile', $ev2, '-UntilStep', '021'))
Expect 'G. ventana por etapas: 020 y 021 aplicadas y verificadas, se detiene (-UntilStep 021)' ($r.Code -eq 0 -and ((Get-Content $ev2 -Raw) -match 'STAGED_STOP_AFTER_021') -and ((Get-Content $ev2 -Raw) -match 'POSTCHECK_021_PASS')) $r.Out
Expect 'G. estado tras 020-021: esquema con 8 tablas' ((Estado) -match '^t\|\d+\|8$') (Estado)
$null = Sql 'GRANT SELECT ON manufactura.firmas TO n8n_app'
$ev3 = Join-Path $Evidencia 'evidencia_reanudacion.txt'
$r = Run-Inv ($base + @('-Apply', '-EvidenceFile', $ev3, '-FromStep', '022'))
$txt = Get-Content $ev3 -Raw
Expect 'G. con un privilegio indebido (n8n_app lee manufactura) la reanudacion se DETIENE en la verificacion transversal de la 022' ($r.Code -ne 0 -and $txt -match 'transversal verification failed' -and $txt -match 'POSTCHECK_022_PASS' -and $txt -notmatch 'VERIFY_022_PASS') $r.Out
Expect 'G. NO llego a aplicar la 023 (abreviaturas)' ($txt -notmatch '20261108_023' -and (Sql "SELECT to_regclass('manufactura.cliente_abreviaturas') IS NULL") -eq 't') $txt
$null = Sql 'REVOKE SELECT ON manufactura.firmas FROM n8n_app'

# H (instancia nueva)
if ($ScriptMk) { $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; $unix = ($ScriptMk.Replace('\', '/')) -replace '^([A-Za-z]):', '/$1'; $unix = $unix.Substring(0, 1) + $unix.Substring(1, 1).ToLower() + $unix.Substring(2); $gb = 'C:Program FilesGitinash.exe'; if (-not (Test-Path $gb)) { $gb = (Get-Command bash).Source }; & $gb -c ('bash ' + $unix) 2>&1 | Out-Null; $ErrorActionPreference = $prev; Start-Sleep -Seconds 3 }
$ev4 = Join-Path $Evidencia 'evidencia_completa.txt'
$r = Run-Inv ($base + @('-Apply', '-EvidenceFile', $ev4))
$txt = Get-Content $ev4 -Raw
$marcadores = 'POSTCHECK_020_PASS', 'POSTCHECK_021_PASS', 'POSTCHECK_022_PASS', 'POSTCHECK_023_PASS', 'POSTCHECK_024_PASS', 'POSTCHECK_026_PASS', 'VERIFY_026_PASS', 'SMOKE_READONLY_PASS', 'MANUFACTURA_SQL_COMPLETE'
Expect 'H. aplicacion completa en instancia nueva: 020, 021, 022, 023, 024 y 026 con todos los marcadores de evidencia' ($r.Code -eq 0 -and (@($marcadores | Where-Object { $txt -notmatch $_ }).Count -eq 0)) ($r.Out + ' faltan: ' + (($marcadores | Where-Object { $txt -notmatch $_ }) -join ','))
$orden = @([regex]::Matches($txt, 'POSTCHECK_(\d+)_PASS') | ForEach-Object { $_.Groups[1].Value })
Expect 'H. el orden aplicado fue 020,021,022,023,024,026' (($orden -join ',') -eq '020,021,022,023,024,026') ($orden -join ',')
Expect 'H. estado final: esquema manufactura, 33 politicas (24 de la aplicacion + 9 de respaldo) y 9 tablas' ((Estado) -eq 't|33|9') (Estado)
Expect 'H. la 025 de Caterpillar NO se instalo (no existe el esquema cat_recovery_test)' ((Sql "SELECT to_regnamespace('cat_recovery_test') IS NULL") -eq 't')
Expect 'H. la evidencia no contiene contrasenas' ($txt -notmatch 'scratch|PGPASSWORD')

# I
$antes = Estado; $ev5 = Join-Path $Evidencia 'evidencia_repeticion.txt'
$r = Run-Inv ($base + @('-Apply', '-EvidenceFile', $ev5))
$txt = Get-Content $ev5 -Raw
Expect 'I. repetir sobre la base ya migrada: se detiene en el precheck de la 020 (STOPPED) sin aplicar nada' ($r.Code -ne 0 -and $txt -match 'STOPPED' -and $txt -notmatch '--- 20261108_020_manufactura_gestor_documental_prod up') $r.Out
Expect 'I. el estado de la base no cambio' ((Estado) -eq $antes)

Write-Host ('RESULTADO: ' + $(if ($script:fails) { "$($script:fails) escenario(s) FALLARON" } else { 'todos los escenarios se comportaron como se esperaba' }))
exit $(if ($script:fails) { 1 } else { 0 })
