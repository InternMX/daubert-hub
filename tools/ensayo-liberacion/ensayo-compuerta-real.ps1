<#
.SYNOPSIS
    Ensayo de la compuerta de database/ de Deploy-DaubertHub.ps1 con git REAL y el manifiesto REAL, sobre un CLON AISLADO del repositorio (nunca sobre el repositorio de trabajo).

.DESCRIPTION
    Para cada escenario modifica el clon (commit local en el clon), construye el contexto con `git diff --name-only <base> HEAD -- database` y `git rev-parse HEAD:<ruta>` y llama a la funcion
    pura Test-DatabaseManifest del script de despliegue del clon. No usa Docker, ni PostgreSQL, ni la configuracion de produccion, ni /api/health: solo git y archivos del clon.
    Salida: PASS/FAIL por escenario; codigo de salida 1 si algun escenario no se comporta como se espera (los positivos deben ACEPTARSE; los negativos, BLOQUEARSE por la razon esperada).

    Uso:  git clone --no-hardlinks <repo> <carpeta fuera del repo> ; git -C <carpeta> checkout <candidata>
          powershell -File tools\ensayo-liberacion\ensayo-compuerta-real.ps1 -Clone <carpeta> -Base 16153a8 -ManifestSha256 <sha>
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Clone,
    [Parameter(Mandatory = $true)][string]$Base,
    [Parameter(Mandatory = $true)][string]$ManifestSha256,
    [string]$Manifest = 'deploy/release-manifests/manufactura-database-release.json',
    [string[]]$Expected = @('20261108_0', '20261109_026'),
    [string]$Cat025Repo = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$cloneFull = [System.IO.Path]::GetFullPath($Clone)
$mine = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ($cloneFull.TrimEnd('\') -ieq $mine.TrimEnd('\')) { throw 'Refusing to run on the working repository: pass an isolated clone.' }
if (-not (Test-Path -LiteralPath (Join-Path $cloneFull '.git'))) { throw 'The clone is not a git repository.' }
function G {
    param([string[]]$A)
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'   # git writes warnings (line endings) to stderr; only the exit code decides
    try { $o = & git -C $cloneFull @A 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previo }
    if ($code -ne 0) { throw ('git ' + ($A -join ' ') + ' failed: ' + ($o | Out-String)) }
    return $o
}
$null = G @('config', 'user.email', 'ensayo@example.invalid'); $null = G @('config', 'user.name', 'ensayo')

. (Join-Path $cloneFull 'scripts\deploy\Deploy-DaubertHub.ps1')    # only defines functions (dot-sourced)
Set-Location $cloneFull
$prefix = 'database/migrations/daubert_global/'

function Get-Reasons {
    $files = @(& git -C $cloneFull diff --name-only $Base HEAD -- database)
    $blobs = @{}
    $manifestLeido = Read-DeployManifest $Manifest
    $todos = @($files)
    if ($manifestLeido.Json) { foreach ($a in @($manifestLeido.Json.archivos)) { if ([string]$a.categoria -like 'produccion_*') { $todos += [string]$a.ruta } } }
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    foreach ($f in @($todos | Select-Object -Unique)) { $o = & git -C $cloneFull rev-parse ('HEAD:' + $f) 2>$null; $blobs[$f] = $(if ($LASTEXITCODE -eq 0) { [string]$o } else { '' }) }
    $ErrorActionPreference = $previo
    $script:Options = @{ DatabaseManifest = $Manifest; DatabaseManifestSha256 = $ManifestSha256 }
    $ctx = [pscustomobject]@{ MigrationFiles = $files; MigrationBlobs = $blobs; Manifest = (Read-DeployManifest $Manifest) }
    return @(Test-DatabaseManifest $ctx $script:Options $Expected $prefix)
}
$script:fails = 0
function Expect([string]$Name, [string]$Pattern) {
    $r = @(Get-Reasons)
    if ($Pattern -eq 'ACCEPT') { $okNow = ($r.Count -eq 0) } else { $okNow = ($r.Count -gt 0 -and (($r -join ' | ') -match $Pattern)) }
    $estado = $(if ($okNow) { 'PASS ' } else { 'FAIL ' })
    $detalle = $(if ($r.Count -eq 0) { 'ACEPTADO (0 razones de bloqueo)' } else { 'BLOQUEADO (' + $r.Count + '): ' + (($r | Select-Object -First 2) -join ' | ') })
    Write-Host ($estado + $Name + '  => ' + $detalle)
    if (-not $okNow) { $script:fails++ }
}
function Commit([string]$Msg) { $null = G @('add', '-A'); $null = G @('commit', '-q', '-m', $Msg, '--allow-empty') }
function Reset-Clone { $null = G @('reset', '-q', '--hard', $script:start) }
$script:start = (G @('rev-parse', 'HEAD') | Select-Object -First 1)

Expect '1. conjunto legitimo de la liberacion (77 archivos, sin cambios): ACEPTADO' 'ACCEPT'

$p = $prefix + '20261199_099_sorpresa_prod.up.sql'; Set-Content -LiteralPath (Join-Path $cloneFull $p) -Value 'SELECT 1;'; Commit 'sorpresa'
Expect '2. migracion de produccion inesperada: BLOQUEADA' 'no autorizado por el manifiesto'; Reset-Clone

$p = Join-Path $cloneFull ($prefix + '20261108_024_manufactura_consulta_compartida_borradores_prod.up.sql'); Add-Content -LiteralPath $p -Value '-- cambio no autorizado'; Commit 'modifica 024'
Expect '3. migracion conocida (024 UP) modificada: BLOQUEADA' 'MODIFICADO respecto del manifiesto'; Reset-Clone

$p = Join-Path $cloneFull ($prefix + '20261109_026_manufactura_respaldo_rls_prod.postcheck.sql'); Add-Content -LiteralPath $p -Value '-- cambio no autorizado'; Commit 'modifica 026 postcheck'
Expect '4. postcheck de la 026 modificado: BLOQUEADO' 'MODIFICADO respecto del manifiesto'; Reset-Clone

$p = Join-Path $cloneFull 'database/migrations/daubert_hub_test/20261030_101_manufactura_gestor_documental_test.up.sql'; Add-Content -LiteralPath $p -Value '-- cambio'; Commit 'modifica TEST 101'
Expect '5. archivo TEST modificado: BLOQUEADO' 'MODIFICADO respecto del manifiesto'; Reset-Clone

$p = 'database/migrations/daubert_hub_test/20261110_106_nueva_test.up.sql'; Set-Content -LiteralPath (Join-Path $cloneFull $p) -Value 'SELECT 1;'; Commit 'nueva TEST 106'
Expect '6. archivo TEST nuevo no listado: BLOQUEADO' 'no autorizado por el manifiesto'; Reset-Clone

$p = 'database/maintenance/daubert_hub_test/otro_borrado.delete.sql'; Set-Content -LiteralPath (Join-Path $cloneFull $p) -Value 'DELETE FROM x;'; Commit 'mantenimiento nuevo'
Expect '7. script de mantenimiento nuevo no listado: BLOQUEADO' 'no autorizado por el manifiesto'; Reset-Clone

if ($Cat025Repo) {
    foreach ($t in 'precheck', 'up', 'postcheck', 'down') { $o = & git -C $Cat025Repo show ('feat/cat-safe-folio-recovery:database/migrations/daubert_global/20261106_025_caterpillar_folio_recovery_test.' + $t + '.sql'); Set-Content -LiteralPath (Join-Path $cloneFull ($prefix + '20261106_025_caterpillar_folio_recovery_test.' + $t + '.sql')) -Value $o }
    Commit 'agrega CAT 025'
    Expect '8. migracion 025 de recuperacion Caterpillar presente: BLOQUEADA' 'prohibido'; Reset-Clone
}

Remove-Item -LiteralPath (Join-Path $cloneFull ($prefix + '20261108_021_manufactura_responsables_firmas_prod.up.sql')); Commit 'elimina 021 UP'
Expect '9. archivo autorizado eliminado: BLOQUEADO' 'ausente o distinto en HEAD'; Reset-Clone

# El manifiesto alterado (por ejemplo para listar un archivo nuevo) cambia su SHA-256 y ya no coincide con el registro de autorizacion.
$m = Join-Path $cloneFull $Manifest; $texto = Get-Content -LiteralPath $m -Raw; Set-Content -LiteralPath $m -Value ($texto.TrimEnd() + "`n ") -NoNewline; Commit 'manifiesto alterado'
Expect '10. manifiesto alterado (SHA-256 distinto del autorizado): BLOQUEADO' 'no coincide con -DatabaseManifestSha256'; Reset-Clone

$saved = $ManifestSha256; $ManifestSha256 = ('0' * 64)
Expect '11. SHA-256 de autorizacion incorrecto: BLOQUEADO' 'no coincide con -DatabaseManifestSha256'
$ManifestSha256 = $saved

$Expected = @('20261108_020'); Expect '12. -ExpectedMigrations que no cubre todas las migraciones de produccion: BLOQUEADO' 'fuera de -ExpectedMigrations'; $Expected = @('20261108_0', '20261109_026')
Expect '13. de nuevo el conjunto legitimo tras restaurar el clon: ACEPTADO' 'ACCEPT'

Write-Host ('RESULTADO: ' + $(if ($script:fails) { "$($script:fails) escenario(s) FALLARON" } else { 'todos los escenarios se comportaron como se esperaba' }))
exit $(if ($script:fails) { 1 } else { 0 })
