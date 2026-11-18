<#
.SYNOPSIS
    Acreditacion del readiness DIAGNOSTICO del ensayo de ventana (ensayo-ventana-respaldos.ps1, paso 6). Solo define funciones (se carga con dot-sourcing). Windows PowerShell 5.1.

.DESCRIPTION
    El ensayo corre en un entorno desechable (clon + PostgreSQL de ensayo): no hay API ni Web en ejecucion, /api/health, manifiesto de imagenes, nginx externo ni ventana de cierre.
    Por eso NO puede producir un readiness completo (completo-v1) sin simular produccion, y ejecuta a proposito el perfil parcial de sus propios controles:
      bd (migraciones, 9 tablas, 33 politicas, RLS, rol de respaldo, sin 025) + respaldo (--enable-row-security <=> pol_respaldo_sel) + migraciones (marcadores de evidencia).
    Test-ManufacturaReleaseReadiness.ps1 responde a esa invocacion con exit 2 y MANUFACTURA_READINESS_PARTIAL perfil=diagnostico, que NO autoriza desplegar ni habilitar.

    Test-EnsayoReadinessParcial permite continuar el ENSAYO solo si TODO lo siguiente se cumple (si no, el ensayo se detiene):
      - exit exactamente 2 (1 = algun FAIL; 0 = PASS inesperado para esta invocacion: el contrato cambio; cualquier otro = resultado inesperado);
      - el archivo de evidencia existe y tiene UNA sola linea: PARTIAL, phase=PreDeploy, perfil=diagnostico, fallos=0, grupos=EXACTAMENTE bd,respaldo,migraciones,
        commit=-, faltan=EXACTAMENTE configuracion,salud,imagenes,nginx,cierre;
      - la salida no tiene ninguna linea FAIL, dice DIAGNOSTICO PARCIAL, tiene tantas lineas PASS como controles declara y contiene los PASS de los controles propios del ensayo.
    El resultado es una acreditacion del ENSAYO de respaldos; nunca es ni produce evidencia de despliegue o de habilitacion.
#>

$script:EnsayoReadinessGrupos = 'bd,respaldo,migraciones'
$script:EnsayoReadinessFaltan = 'configuracion,salud,imagenes,nginx,cierre'
# Controles propios del ensayo que deben figurar como PASS (prefijos de las lineas de Test-ManufacturaReleaseReadiness.ps1).
$script:EnsayoReadinessControles = @(
    'PASS base conectada = daubert_global',
    'PASS existe el esquema manufactura',
    'PASS migracion 026 aplicada: pol_respaldo_sel',
    'PASS manufactura tiene 33 politicas RLS',
    'PASS RLS activa en todas las tablas de manufactura',
    'PASS daubert_backup existe y no es superusuario ni BYPASSRLS',
    'PASS respaldo y migracion 026 coherentes',
    'PASS la evidencia de migraciones contiene todos los marcadores'
)

function Test-EnsayoReadinessParcial {
    # Pura: (exit, salida, texto de la evidencia o $null) -> motivos para DETENER el ensayo. Lista vacia = el diagnostico del ensayo esta acreditado.
    param([int]$Code, [string[]]$Output, $EvidenceText)
    $m = @()
    if ($Code -eq 1) { $m += 'readiness FALLO (exit 1)' }
    elseif ($Code -eq 0) { $m += 'exit 0 (PASS) inesperado para el perfil parcial del ensayo: el contrato de readiness cambio; revisar antes de continuar' }
    elseif ($Code -ne 2) { $m += ('exit ' + $Code + ' inesperado') }
    $out = @($Output | ForEach-Object { [string]$_ })
    $fails = @($out | Where-Object { $_ -like 'FAIL *' })
    if ($fails.Count -gt 0) { $m += ('la salida contiene ' + $fails.Count + ' control(es) FAIL') }
    if (@($out | Where-Object { $_ -like 'RESULTADO: DIAGNOSTICO PARCIAL*' }).Count -ne 1) { $m += 'la salida no declara un unico RESULTADO de DIAGNOSTICO PARCIAL' }
    foreach ($c in $script:EnsayoReadinessControles) { if (@($out | Where-Object { $_.StartsWith($c) }).Count -ne 1) { $m += ('control del ensayo no ejecutado o no aprobado: ' + $c.Substring(5)) } }
    if ($null -eq $EvidenceText) { $m += 'no existe el archivo de evidencia del readiness'; return $m }
    $lines = @((([string]$EvidenceText).TrimStart([char]0xFEFF)) -split "`r?`n" | Where-Object { $_.Trim() })
    if ($lines.Count -ne 1) { $m += ('la evidencia debe tener exactamente una linea y tiene ' + $lines.Count); return $m }
    $rx = '\AMANUFACTURA_READINESS_PARTIAL phase=PreDeploy perfil=diagnostico controles=(?<n>\d{1,4}) fallos=0 grupos=' + [regex]::Escape($script:EnsayoReadinessGrupos) +
        ' commit=- faltan=' + [regex]::Escape($script:EnsayoReadinessFaltan) + ' \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\z'
    $e = [regex]::Match([string]$lines[0], $rx)
    if (-not $e.Success) { $m += ('la evidencia no es el diagnostico parcial esperado del ensayo (PARTIAL PreDeploy, fallos=0, grupos ' + $script:EnsayoReadinessGrupos + ', faltan ' + $script:EnsayoReadinessFaltan + '): ' + $lines[0]); return $m }
    $passes = @($out | Where-Object { $_ -like 'PASS *' }).Count
    if ([int]$e.Groups['n'].Value -lt 1 -or [int]$e.Groups['n'].Value -ne $passes) { $m += ('controles declarados (' + $e.Groups['n'].Value + ') distintos de las lineas PASS de la salida (' + $passes + ')') }
    return $m
}
