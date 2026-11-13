<#
.SYNOPSIS
    ENSAYO (Fase 6C.3) de la secuencia coordinada de mantenimiento de respaldos + migraciones de Manufactura, en un entorno AISLADO. No toca PROD, ni las tareas programadas reales
    (su control se SIMULA en un archivo de estado; el estado real solo se LEE para mostrarlo), ni scripts/backup del arbol operativo.

.DESCRIPTION
    "Arbol operativo" del ensayo = un CLON (-Operative) en el commit previo al parche de respaldos. El parche llega como en la liberacion real: un commit de la rama candidata
    (-CandidateRef, ya presente en el clon) que se incorpora con `git merge --ff-only` DENTRO de la ventana.
    Base = PostgreSQL 18 desechable (contenedor -PgContainer, puerto de loopback -Port) con la base base_snapshot (copia del respaldo autorizado); cada corrida recrea daubert_global desde ella.

    Pasos (cualquier fallo DETIENE la secuencia; no se continua con un respaldo no comprobado):
      1. Estado de las tareas programadas (ninguna en ejecucion).            5. Migraciones 020-024 y 026 (Invoke-ManufacturaMigrations.ps1).
      2. Respaldo previo + comprobacion de integridad (restauracion).        6. Readiness (fase PreDeploy).
      3. Pausar tareas (SIMULADO).                                            7. Respaldo nuevo + integridad + restauracion en instancia aislada.
      4. Parche de respaldos (ff-only) + respaldo de control sin migrar.     8. Reanudar tareas (SIMULADO) y corrida de comprobacion.
    Un exit 0 de pg_dump NUNCA basta: cada respaldo se da por bueno solo si verificar-respaldo-manufactura.cjs --restaurar termina sin fallos.

    Escenarios (-Scenario): completa | previo-corrupto | sin-parche | bandera-sin-026 | tarea-en-ejecucion.  -SkipReadiness deja ver el fallo del respaldo mismo.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Operative,
    [Parameter(Mandatory = $true)][string]$PrePatchCommit,
    [Parameter(Mandatory = $true)][string]$CandidateRef,
    [Parameter(Mandatory = $true)][string]$Evidence,
    [Parameter(Mandatory = $true)][string]$RolesFile,
    [Parameter(Mandatory = $true)][string]$ManifestSha256,
    [ValidateSet('completa', 'previo-corrupto', 'sin-parche', 'bandera-sin-026', 'tarea-en-ejecucion')][string]$Scenario = 'completa',
    [switch]$SkipReadiness,
    [string]$PgContainer = 'ens63-pg',
    [int]$Port = 55433,
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$tools = $PSScriptRoot
$realRepo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
$op = [System.IO.Path]::GetFullPath($Operative).TrimEnd('\')
if ($op -ieq $realRepo) { throw 'Refusing: -Operative must be a disposable clone, never the working repository.' }
if ($Port -in 5432, 5433, 5434) { throw 'Refusing standard PostgreSQL ports.' }
if ($PgContainer -notmatch '^ens\d+-pg') { throw 'Refusing: -PgContainer must be a rehearsal container (ensNN-pg...).' }
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
$psql = Join-Path $PgBin 'psql.exe'
$env:PGHOST = '127.0.0.1'; $env:PGPORT = [string]$Port; $env:PGUSER = 'postgres'; $env:PGPASSWORD = 'scratch'; $env:PGDATABASE = 'daubert_global'
$stateFile = Join-Path $Evidence ("tareas-simuladas-$Scenario.json")
$taskNames = @('Daubert - PostgreSQL Frequent', 'Daubert - PostgreSQL Daily', 'Daubert - PostgreSQL Monthly')

function Run([scriptblock]$Block) { $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $o = & $Block 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }; return [pscustomobject]@{ Code = $code; Out = @($o | ForEach-Object { [string]$_ }) } }
function Stop-Sequence([string]$Step, [string]$Why, [string]$Action) {
    Write-Host ("DETENIDO en el paso $Step :: $Why")
    Write-Host ("  Accion documentada: $Action")
    Write-Host ("  Tareas (simuladas): " + (Get-Content -LiteralPath $stateFile -Raw).Trim())
    Write-Host ("RESULTADO[$Scenario]: SECUENCIA DETENIDA en el paso $Step")
    exit 1
}
function Set-Tasks([string]$State) { $h = [ordered]@{}; foreach ($t in $taskNames) { $h[$t] = $State }; ($h | ConvertTo-Json -Compress) | Set-Content -LiteralPath $stateFile -Encoding ASCII }
function Backup([string]$Name) {
    $out = Join-Path $Evidence ("$Scenario-$Name.dump")
    $r = Run { & powershell -NoProfile -File (Join-Path $tools 'ensayo-despliegue\probar-pgdump-modulo.ps1') -Clone $op -OutputPath $out -Port $Port }
    Write-Host ('   ' + (($r.Out | Where-Object { $_ -match 'PGDUMP_MODULO|stderr' } | ForEach-Object { if ($_.Length -gt 200) { $_.Substring(0, 200) } else { $_ } }) -join ' || '))
    return [pscustomobject]@{ Code = $r.Code; Path = $out }
}
function Verify([string]$Dump, [bool]$Previo) {
    $counts = Join-Path $Evidence ("$Scenario-filas-" + [System.IO.Path]::GetFileNameWithoutExtension($Dump) + '.txt')
    $c = Run { & $psql -X -q -At -F '|' -f (Join-Path $tools 'contar-filas.readonly.sql') }
    if ($c.Code -ne 0) { return $false }
    $c.Out | Set-Content -LiteralPath $counts -Encoding ASCII
    $a = @((Join-Path $tools 'verificar-respaldo-manufactura.cjs'), '--dump', $Dump, '--pg-bin', $PgBin, '--restaurar', '--filas-origen', $counts, '--roles', $RolesFile)
    if ($Previo) { $a += '--previo' }
    $v = Run { & node @a }
    $log = [System.IO.Path]::ChangeExtension($Dump, '.verificacion.log'); $v.Out | Set-Content -LiteralPath $log -Encoding UTF8
    $pass = @($v.Out | Where-Object { $_ -like 'PASS *' }).Count; $fail = @($v.Out | Where-Object { $_ -like 'FAIL *' })
    Write-Host ("   integridad: $pass PASS / $($fail.Count) FAIL (exit $($v.Code))" + $(if ($fail.Count) { ' :: ' + (($fail | Select-Object -First 2 | ForEach-Object { if ($_.Length -gt 150) { $_.Substring(0, 150) } else { $_ } }) -join ' | ') } else { '' }))
    return ($v.Code -eq 0)
}

Write-Host ("===== ESCENARIO: $Scenario" + $(if ($SkipReadiness) { ' (sin readiness: se deja ver el fallo del respaldo)' } else { '' }))
# Estado inicial del ensayo: base sin migrar y "arbol operativo" sin parche.
$null = Run { & docker exec $PgContainer psql -U postgres -q -c 'DROP DATABASE IF EXISTS daubert_global WITH (FORCE)' -c 'CREATE DATABASE daubert_global TEMPLATE base_snapshot' }
$null = Run { & git -C $op reset -q --hard $PrePatchCommit }
Set-Tasks $(if ($Scenario -eq 'tarea-en-ejecucion') { 'Running' } else { 'Ready' })

Write-Host '1. Estado de las tareas programadas'
try { $real = @(Get-ScheduledTask -TaskName 'Daubert - PostgreSQL*' -ErrorAction Stop | ForEach-Object { $_.TaskName + '=' + $_.State }); Write-Host ('   (solo lectura, tareas reales: ' + ($real -join ', ') + ')') } catch { Write-Host '   (tareas reales no legibles desde esta sesion)' }
$sim = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$busy = @($taskNames | Where-Object { [string]$sim.$_ -ne 'Ready' })
if ($busy.Count) { Stop-Sequence '1' ('tarea(s) no en estado Ready: ' + ($busy -join ', ')) 'Esperar a que termine la corrida en curso (no interrumpirla) y volver a empezar; no se cambio nada.' }

Write-Host '2. Respaldo previo (modulo actual, rol daubert_backup) + integridad con restauracion'
$b = Backup 'previo'
if ($b.Code -ne 0) { Stop-Sequence '2' 'el respaldo previo fallo' 'No iniciar la ventana. Diagnosticar el respaldo con la operacion normal; no se cambio nada.' }
if ($Scenario -eq 'previo-corrupto') { $bytes = [System.IO.File]::ReadAllBytes($b.Path); [System.IO.File]::WriteAllBytes($b.Path, $bytes[0..([int]($bytes.Length * 0.6))]); Write-Host '   (ensayo: el archivo se trunco al 60 % despues de un exit 0)' }
if (-not (Verify $b.Path $true)) { Stop-Sequence '2' 'el respaldo previo NO paso la comprobacion de integridad (un exit 0 no basta)' 'No iniciar la ventana: sin respaldo previo comprobado no se migra. No se cambio nada.' }

Write-Host '3. Pausar las tareas de respaldo (SIMULADO: Disable-ScheduledTask en la ventana real)'
Set-Tasks 'Disabled'

Write-Host '4. Parche de respaldos (git merge --ff-only de la candidata) + respaldo de control ANTES de migrar'
if ($Scenario -ne 'sin-parche') {
    $m = Run { & git -C $op merge -q --ff-only $CandidateRef }
    if ($m.Code -ne 0) { Stop-Sequence '4' 'no se pudo incorporar el commit del parche (ff-only)' 'Reanudar las tareas (el arbol sigue como estaba) y cancelar la ventana.' }
    $flag = (Get-Content -LiteralPath (Join-Path $op 'scripts\backup\lib\BackupPgTools.psm1') -Raw) -match "'--enable-row-security'"
    if (-not $flag) { Stop-Sequence '4' 'el modulo no contiene --enable-row-security tras el merge' 'git reset al commit previo, reanudar tareas, cancelar.' }
    $b = Backup 'control-con-parche-sin-migrar'
    if ($b.Code -ne 0 -or -not (Verify $b.Path $true)) { Stop-Sequence '4' 'el respaldo con el parche (base aun sin migrar) no es integro' 'Volver al commit previo al parche (git reset --hard <previo>), comprobar un respaldo, reanudar las tareas y cancelar la ventana. La base no se ha tocado.' }
} else { Write-Host '   (ensayo: el parche NO se aplica)' }

Write-Host '5. Migraciones de Manufactura'
$until = $(if ($Scenario -eq 'bandera-sin-026') { '024' } else { '026' })
$ev = Join-Path $Evidence ("$Scenario-migraciones.txt")
# Sin -UntilStep el procedimiento termina con el humo de solo lectura y MANUFACTURA_SQL_COMPLETE (una parada por etapas NO los escribe y readiness la rechaza).
$mArgs = @('-NoProfile', '-File', (Join-Path $op 'scripts\deploy\Invoke-ManufacturaMigrations.ps1'), '-DatabaseManifestSha256', $ManifestSha256, '-Apply', '-EvidenceFile', $ev, '-Psql', $psql)
if ($until -ne '026') { $mArgs += @('-UntilStep', $until) }
$mg = Run { & powershell @mArgs }
Write-Host ("   Invoke-ManufacturaMigrations hasta la $until : exit $($mg.Code)")
if ($mg.Code -ne 0) { Stop-Sequence '5' 'una migracion fallo' 'El procedimiento ya se detuvo sin DOWN. Mantener Manufactura apagada y las tareas en pausa hasta decidir (ver plan de reversion: migraciones parciales).' }

if (-not $SkipReadiness) {
    Write-Host '6. Readiness (PreDeploy): base, coherencia respaldo/026 y evidencia'
    $rd = Run { & powershell -NoProfile -File (Join-Path $op 'scripts\deploy\Test-ManufacturaReleaseReadiness.ps1') -Phase PreDeploy -Psql $psql -BackupModule (Join-Path $op 'scripts\backup\lib\BackupPgTools.psm1') -MigrationsEvidence $ev -EvidenceFile (Join-Path $Evidence ("$Scenario-readiness.txt")) }
    $rd.Out | Set-Content -LiteralPath (Join-Path $Evidence ("$Scenario-readiness.log")) -Encoding UTF8
    foreach ($l in @($rd.Out | Where-Object { $_ -like 'FAIL *' -or $_ -like 'RESULTADO*' })) { Write-Host ('   ' + $(if ($l.Length -gt 220) { $l.Substring(0, 220) } else { $l })) }
    if ($rd.Code -ne 0) { Stop-Sequence '6' 'readiness FALLO' 'No desplegar ni habilitar. Las tareas siguen en pausa: corregir (aplicar el parche o completar las migraciones) y repetir desde el paso que falto.' }
} else { Write-Host '6. (readiness omitido en este escenario)' }

Write-Host '7. Respaldo nuevo + integridad + restauracion en instancia aislada (sin red)'
$b = Backup 'posterior'
if ($b.Code -ne 0) { Stop-Sequence '7' 'pg_dump FALLO tras las migraciones' 'Manufactura sigue apagada. Verificar que el parche esta aplicado; NO reanudar las tareas hasta que un respaldo pase la integridad.' }
if (-not (Verify $b.Path $false)) { Stop-Sequence '7' 'el respaldo termino con exit 0 pero NO es integro' 'NO darlo por bueno. Manufactura sigue apagada y las tareas en pausa; corregir la causa (politica 026 / parche) y repetir este paso.' }

Write-Host '8. Reanudar las tareas (SIMULADO: Enable-ScheduledTask) y corrida de comprobacion'
Set-Tasks 'Ready'
$b = Backup 'comprobacion-tras-reanudar'
if ($b.Code -ne 0 -or -not (Verify $b.Path $false)) { Stop-Sequence '8' 'la corrida de comprobacion tras reanudar no es integra' 'Volver a pausar las tareas y diagnosticar; Manufactura sigue apagada.' }
Write-Host ("   Tareas (simuladas): " + (Get-Content -LiteralPath $stateFile -Raw).Trim())
Write-Host ("RESULTADO[$Scenario]: SECUENCIA COMPLETA (todos los respaldos comprobados)")
exit 0
