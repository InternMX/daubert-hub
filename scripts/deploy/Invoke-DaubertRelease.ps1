<#
.SYNOPSIS
    Fase 2A: plan de release de solo lectura para Windows PowerShell 5.1.
.DESCRIPTION
    Exige el SHA completo aprobado, comprueba HEAD y delega preflight, estado del Hub,
    rama, limpieza, sincronizacion y simulacion a Deploy-DaubertHub.ps1 -WhatIf.
    No escribe logs ni archivos temporales. La salida externa queda en memoria y solo
    se muestran campos de formato conocido; nunca argumentos, errores ni salida cruda.
    Exit: 0 APTO (no desplegado), 1 BLOQUEADO, 2 SIN CAMBIOS, 3 uso incorrecto.
    No implementa Deploy ni Rollback ni acepta credenciales o excepciones a las compuertas.
.PARAMETER Plan
    Unico modo disponible; obligatorio.
.PARAMETER ExpectedCommit
    SHA hexadecimal completo (40 caracteres) del candidato aprobado fuera del script.
    Debe coincidir exactamente con HEAD; no se aceptan tags, ramas ni SHA abreviados.
#>
#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][switch]$Plan,
    [Parameter(Mandatory = $true)][string]$ExpectedCommit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ReleaseRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:ReleaseDeployPath = Join-Path $PSScriptRoot 'Deploy-DaubertHub.ps1'

function Invoke-ReleaseRead {
    # Lista exacta: ninguna entrada del usuario puede seleccionar un verbo o script.
    param([ValidateSet('Head', 'Simulation')][string]$Operation, [string]$Commit)
    if ($Operation -eq 'Head') {
        $exe = 'git'
        $nativeArgs = @('--no-optional-locks', '-C', $script:ReleaseRoot, 'rev-parse', '--verify', 'HEAD^{commit}')
    } else {
        if ($Commit -notmatch '\A[0-9a-fA-F]{40}\z') { throw 'SHA invalido.' }
        $exe = Join-Path $PSHOME 'powershell.exe'
        $nativeArgs = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script:ReleaseDeployPath, '-WhatIf', '-Candidate', $Commit)
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $LASTEXITCODE = $null
        $output = & $exe @nativeArgs 2>$null
        $code = if ($null -eq $LASTEXITCODE) { 1 } else { $LASTEXITCODE }
    } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Out = @($output) }
}

function Invoke-ReleaseMain {
    param([bool]$DoPlan, [string]$ApprovedCommit)
    if (-not $DoPlan -or $ApprovedCommit -notmatch '\A[0-9a-fA-F]{40}\z') {
        Write-Host 'USO INCORRECTO: indique -Plan -ExpectedCommit <SHA completo aprobado de 40 caracteres>. Codigo: 3.'
        return 3
    }
    $commit = $ApprovedCommit.ToLowerInvariant()
    Write-Host '=== Daubert Hub: plan de release (solo lectura) ==='
    Write-Host ('Commit aprobado: ' + $commit)
    try {
        $head = Invoke-ReleaseRead 'Head'
        if ($head.Code -ne 0 -or $head.Out.Count -ne 1 -or [string]$head.Out[0] -ne $commit) {
            Write-Host 'BLOQUEADO: HEAD no coincide con el commit aprobado o no se pudo leer. Codigo: 1.'
            return 1
        }
        $result = Invoke-ReleaseRead 'Simulation' $commit
        # Detecta un cambio de candidato durante las comprobaciones; el plan no reserva el repo.
        $head = Invoke-ReleaseRead 'Head'
        if ($head.Code -ne 0 -or $head.Out.Count -ne 1 -or [string]$head.Out[0] -ne $commit) {
            Write-Host 'BLOQUEADO: HEAD cambio durante la validacion o no se pudo releer. Codigo: 1.'
            return 1
        }
        foreach ($line in $result.Out) {
            if ([string]$line -match '\AResumen: (\d+) PASS, (\d+) WARN, (\d+) FAIL\z') {
                Write-Host ('Preflight: ' + $Matches[1] + ' correctos, ' + $Matches[2] + ' advertencias, ' + $Matches[3] + ' fallos.')
            }
            if ([string]$line -match '\ACommit actual en PROD\s*:\s*([0-9a-f]{7,40})\z') {
                Write-Host ('Commit observado en el Hub: ' + $Matches[1])
            }
        }
        switch ($result.Code) {
            0 { Write-Host 'APTO: preflight y simulacion existentes completados. Revisar advertencias y aprobacion operativa; no se desplego nada. Codigo: 0.'; return 0 }
            2 { Write-Host 'SIN CAMBIOS DE HUB/DOCKER: no hay nada que desplegar; no reiniciar para actualizar el SHA. Codigo: 2.'; return 2 }
            default { Write-Host 'BLOQUEADO: preflight o simulacion fallidos. Revisar el checklist y las comprobaciones existentes en el entorno autorizado. Codigo: 1.'; return 1 }
        }
    } catch {
        Write-Host 'BLOQUEADO: no se pudieron completar las comprobaciones de solo lectura. Codigo: 1.'
        return 1
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-ReleaseMain ([bool]$Plan) $ExpectedCommit)
}
