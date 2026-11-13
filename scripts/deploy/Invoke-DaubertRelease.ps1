<#
.SYNOPSIS
    Releases supervisados para Windows PowerShell 5.1: Plan o Deploy.
.DESCRIPTION
    Exige el SHA completo aprobado, comprueba HEAD y delega preflight, estado del Hub,
    rama, limpieza, sincronizacion y simulacion a Deploy-DaubertHub.ps1 -WhatIf.
    Plan no escribe logs ni archivos temporales. La salida externa queda en memoria y solo
    se muestran campos de formato conocido; nunca argumentos, errores ni salida cruda.
    Exit: 0 APTO (no desplegado), 1 BLOQUEADO, 2 SIN CAMBIOS, 3 uso incorrecto.
    Deploy exige sincronizacion remota estricta y conserva la confirmacion real del script
    existente. Exit 5: deployment fallido o resultado incierto; no hay rollback automatico.
.PARAMETER Plan
    Simulacion de solo lectura, excluyente con Deploy.
.PARAMETER Deploy
    Publica mediante Deploy-DaubertHub.ps1, sin omitir ni responder su confirmacion.
.PARAMETER RequireClosedWindow
    Exige el cierre existente en simulacion y deployment; nunca cambia su estado.
.PARAMETER ExpectedCommit
    SHA hexadecimal completo (40 caracteres) del candidato aprobado fuera del script.
    Debe coincidir exactamente con HEAD; no se aceptan tags, ramas ni SHA abreviados.
#>
#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Plan,
    [Parameter(Mandatory = $true)][string]$ExpectedCommit,
    [switch]$Deploy,
    [switch]$RequireClosedWindow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ReleaseRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:ReleaseDeployPath = Join-Path $PSScriptRoot 'Deploy-DaubertHub.ps1'

function Invoke-ReleaseRead {
    # Lista exacta: ninguna entrada del usuario puede seleccionar un verbo o script.
    param([ValidateSet('Head', 'Simulation')][string]$Operation, [string]$Commit, [bool]$Strict = $false, [bool]$ClosedWindow = $false)
    if ($Operation -eq 'Head') {
        $exe = 'git'
        $nativeArgs = @('--no-optional-locks', '-C', $script:ReleaseRoot, 'rev-parse', '--verify', 'HEAD^{commit}')
    } else {
        if ($Commit -notmatch '\A[0-9a-fA-F]{40}\z') { throw 'SHA invalido.' }
        $exe = Join-Path $PSHOME 'powershell.exe'
        $nativeArgs = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script:ReleaseDeployPath, '-WhatIf', '-Candidate', $Commit)
        if ($Strict) { $nativeArgs += '-RequireSynchronizedMain' }
        if ($ClosedWindow) { $nativeArgs += '-RequireClosedWindow' }
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $global:LASTEXITCODE = $null
        $output = & $exe @nativeArgs 2>$null
        $code = if ($null -eq $global:LASTEXITCODE) { 1 } else { $global:LASTEXITCODE }
    } finally { $ErrorActionPreference = $previous }
    return @{ Code = $code; Out = @($output) }
}

function Invoke-ReleaseDeployment {
    param([string]$Commit, [bool]$ClosedWindow)
    if ($Commit -notmatch '\A[0-9a-f]{40}\z') { throw 'SHA invalido.' }
    # Invocacion de script en la misma consola: Read-Host conserva su host y stdin reales.
    # Se capturan stdout e Information (Write-Host), nunca la entrada de confirmacion.
    $global:LASTEXITCODE = $null
    Push-Location -LiteralPath $script:ReleaseRoot
    try {
        $lines = @(& $script:ReleaseDeployPath -Deploy -Candidate $Commit -RequireSynchronizedMain -RequireClosedWindow:$ClosedWindow 6>&1 2>$null)
        $code = if ($null -eq $global:LASTEXITCODE) { 5 } else { $global:LASTEXITCODE }
    } finally { Pop-Location }
    return @{ Code = $code; Out = $lines }
}

function Write-ReleaseRecord {
    param($Record, [string]$LocalData = [Environment]::GetFolderPath('LocalApplicationData'))
    # Evidencia best-effort, sin salida externa ni configuracion adicional del operador.
    try {
        $local = $LocalData
        if (-not [IO.Path]::IsPathRooted($local)) { throw 'Ruta no local.' }
        $dir = [IO.Path]::GetFullPath((Join-Path $local 'DaubertHub\releases'))
        if ($dir.StartsWith($script:ReleaseRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or $dir -match '(?i)dropbox') { throw 'Ruta no permitida.' }
        $ancestor = $dir
        while ($ancestor) {
            if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Ruta redirigida.' }
            $ancestor = [IO.Path]::GetDirectoryName($ancestor)
        }
        [IO.Directory]::CreateDirectory($dir) | Out-Null
        $path = Join-Path $dir (([guid]::NewGuid().ToString()) + '.json')
        [IO.File]::WriteAllText($path, ($Record | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
        Write-Host 'Evidencia JSON guardada en LocalAppData\DaubertHub\releases (fuera del repositorio y Dropbox).'
    } catch {
        Write-Host 'ADVERTENCIA: evidencia local no guardada; registrar el resultado en el expediente operativo. El resultado del deployment se conserva.'
    }
}

function Invoke-ReleasePublish {
    param([string]$Commit, [bool]$ClosedWindow, [string]$Previous, [string]$Version)
    $code = 5
    try {
        Write-Host ('Commit anterior: ' + $Previous + '; version candidata: ' + $Version)
        Write-Host 'Comprobaciones y simulacion: correctas. Se solicitara la confirmacion interactiva real DEPLOY DAUBERT HUB.'
        $r = Invoke-ReleaseDeployment $Commit $ClosedWindow
        switch ($r.Code) {
            0 { $code = 0; Write-Host 'DEPLOYMENT CORRECTO. Verificaciones posteriores: aprobadas por el script de deployment. Codigo: 0.' }
            1 { $code = 1; Write-Host 'DEPLOYMENT BLOQUEADO O CANCELADO. Verificaciones posteriores: no completadas. Codigo: 1.' }
            2 { $code = 2; Write-Host 'SIN CAMBIOS: no se desplego nada. Verificaciones posteriores: no ejecutadas. Codigo: 2.' }
            default { Write-Host 'DEPLOYMENT FALLIDO O INCIERTO. Verificaciones posteriores: no aprobadas o no completadas. Codigo: 5.' }
        }
    } catch {
        Write-Host 'DEPLOYMENT FALLIDO O INCIERTO: no se pudo obtener un resultado fiable. Verificaciones posteriores: no confirmadas. Codigo: 5.'
    } finally {
        if ($code -ne 0) { Write-Host 'No hay rollback automatico. Consultar docs/operations/deployment-checklist.md, seccion ROLLBACK; comprobar el estado antes de intervenir.' }
        Write-ReleaseRecord ([ordered]@{ schema = 1; utc = [DateTime]::UtcNow.ToString('o'); approvedCommit = $Commit; previousCommit = $Previous; candidateVersion = $Version; exitCode = $code; postChecksPassed = ($code -eq 0); requireClosedWindow = $ClosedWindow })
    }
    return $code
}

function Invoke-ReleaseMain {
    param([bool]$DoPlan, [string]$ApprovedCommit, [bool]$DoDeploy = $false, [bool]$ClosedWindow = $false)
    if ($DoPlan -eq $DoDeploy -or $ApprovedCommit -notmatch '\A[0-9a-fA-F]{40}\z') {
        Write-Host 'USO INCORRECTO: indique -Plan o -Deploy (excluyentes) y -ExpectedCommit <SHA completo aprobado de 40 caracteres>. Codigo: 3.'
        return 3
    }
    $commit = $ApprovedCommit.ToLowerInvariant()
    Write-Host ('=== Daubert Hub: ' + $(if ($DoPlan) { 'plan de release (solo lectura)' } else { 'deployment supervisado' }) + ' ===')
    Write-Host ('Commit aprobado: ' + $commit)
    try {
        $head = Invoke-ReleaseRead 'Head'
        if ($head.Code -ne 0 -or $head.Out.Count -ne 1 -or [string]$head.Out[0] -ne $commit) {
            Write-Host 'BLOQUEADO: HEAD no coincide con el commit aprobado o no se pudo leer. Codigo: 1.'
            return 1
        }
        $result = Invoke-ReleaseRead 'Simulation' $commit $DoDeploy $ClosedWindow
        # Detecta un cambio de candidato durante las comprobaciones; el plan no reserva el repo.
        $head = Invoke-ReleaseRead 'Head'
        if ($head.Code -ne 0 -or $head.Out.Count -ne 1 -or [string]$head.Out[0] -ne $commit) {
            Write-Host 'BLOQUEADO: HEAD cambio durante la validacion o no se pudo releer. Codigo: 1.'
            return 1
        }
        $previous = @(); $versions = @()
        foreach ($line in $result.Out) {
            if ([string]$line -match '\AResumen: (\d+) PASS, (\d+) WARN, (\d+) FAIL\z') {
                Write-Host ('Preflight: ' + $Matches[1] + ' correctos, ' + $Matches[2] + ' advertencias, ' + $Matches[3] + ' fallos.')
            }
            if ([string]$line -match '\ACommit actual en PROD\s*:\s*([0-9a-f]{7,40})\z') {
                $previous += $Matches[1]
                Write-Host ('Commit observado en el Hub: ' + $Matches[1])
            }
            if ([string]$line -match '\AAPP_VERSION\s*:\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\z') { $versions += $Matches[1] }
        }
        switch ($result.Code) {
            0 {
                if ($DoDeploy) {
                    if ($previous.Count -ne 1 -or $versions.Count -ne 1) { Write-Host 'BLOQUEADO: resumen del candidato ambiguo o incompleto. Codigo: 1.'; return 1 }
                    return (Invoke-ReleasePublish $commit $ClosedWindow $previous[0] $versions[0])
                }
                Write-Host 'APTO: preflight y simulacion existentes completados. Revisar advertencias y aprobacion operativa; no se desplego nada. Codigo: 0.'; return 0
            }
            2 { Write-Host 'SIN CAMBIOS DE HUB/DOCKER: no hay nada que desplegar; no reiniciar para actualizar el SHA. Codigo: 2.'; return 2 }
            default { Write-Host 'BLOQUEADO: preflight o simulacion fallidos. Revisar el checklist y las comprobaciones existentes en el entorno autorizado. Codigo: 1.'; return 1 }
        }
    } catch {
        Write-Host 'BLOQUEADO: no se pudieron completar las comprobaciones de solo lectura. Codigo: 1.'
        return 1
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-ReleaseMain ([bool]$Plan) $ExpectedCommit ([bool]$Deploy) ([bool]$RequireClosedWindow))
}
