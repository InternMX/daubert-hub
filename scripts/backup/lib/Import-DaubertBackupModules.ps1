<#
    Import-DaubertBackupModules.ps1  (se carga con dot-sourcing, NO se ejecuta solo)

    Carga los módulos de lib/ que necesita un comando operativo garantizando
    que se usa SIEMPRE el código actual del repo, sin depender de qué versión
    tenga cacheada la sesión de PowerShell.

    CAUSA que resuelve: `Import-Module X -Force` solo recarga X. Los módulos
    que X importa de forma anidada (sin -Force) se reutilizan desde la
    sesión, así que tras editar p. ej. BackupPgTools.psm1 un comando que solo
    forzaba BackupPipeline seguía ejecutando el BackupPgTools antiguo.

    POLÍTICA: se recarga con -Force la CLAUSURA de dependencias de los
    módulos pedidos, en ORDEN de dependencias (hojas primero). Así cada
    dependiente se recarga después de sus dependencias y enlaza con las
    instancias nuevas; nunca queda un módulo nuevo apuntando a uno viejo.
    Solo se tocan módulos Daubert (Backup*.psm1 de esta carpeta), por ruta
    explícita: jamás módulos ajenos (Pester, Microsoft.PowerShell.*, ...).

    Uso (en el comando, ANTES de llamar a cualquier función de los módulos):
        $DaubertBackupModules = @('Pipeline')
        . (Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'lib') 'Import-DaubertBackupModules.ps1')

    Los módulos se importan en el ámbito del comando (no en el global): al
    terminar el script no dejan funciones sueltas en la sesión del usuario.

    Clases: solo BackupPipeline define una clase (BackupStageError) y la usa
    únicamente dentro de su propio módulo, por lo que recargarla es seguro;
    los módulos que la importan no la referencian.

    Solo para pruebas/diagnóstico: con $env:DAUBERT_BACKUP_NO_RELOAD = '1' se
    importa sin -Force (reutiliza los módulos ya cargados, p. ej. con mocks de
    Pester). Por defecto SIEMPRE se recarga.
#>

# Grafo de dependencias entre módulos de lib/. El ORDEN de las claves es un
# orden topológico (cada módulo aparece después de todo lo que importa).
$DaubertBackupModuleGraph = [ordered]@{
    Elevation     = @()
    Config        = @()
    LocalConfig   = @('Config')
    Naming        = @()
    Logging       = @()
    Lock          = @()
    Hash          = @()
    PgTools       = @()
    Packaging     = @()
    Encryption    = @()
    Retention     = @('Naming')
    Publish       = @('Retention', 'Naming')
    Pipeline      = @('Config', 'LocalConfig', 'Naming', 'Logging', 'Lock', 'Hash', 'PgTools', 'Packaging', 'Encryption', 'Retention', 'Publish')
    Tasks         = @('Config', 'LocalConfig', 'Elevation')
    Preflight     = @('Config', 'LocalConfig')
    Install       = @('Config', 'LocalConfig')
    Prerequisites = @('Config')
}

function Resolve-DaubertBackupModuleClosure {
    <# Devuelve, en orden de dependencias, los módulos pedidos más todas sus dependencias transitivas. #>
    param([string[]]$Name = @())
    $needed = @{}
    $visit = $null
    $visit = {
        param($n)
        if (-not $DaubertBackupModuleGraph.Contains($n)) { throw "Módulo Daubert desconocido: '$n'. Válidos: $($DaubertBackupModuleGraph.Keys -join ', ')" }
        if ($needed.ContainsKey($n)) { return }
        $needed[$n] = $true
        foreach ($d in $DaubertBackupModuleGraph[$n]) { & $visit $d }
    }
    foreach ($n in $Name) { & $visit $n }
    @($DaubertBackupModuleGraph.Keys | Where-Object { $needed.ContainsKey($_) })
}

if ($null -ne (Get-Variable -Name DaubertBackupModules -ErrorAction SilentlyContinue)) {
    $daubertReload = ($env:DAUBERT_BACKUP_NO_RELOAD -ne '1')
    foreach ($daubertModule in (Resolve-DaubertBackupModuleClosure -Name $DaubertBackupModules)) {
        $daubertModulePath = Join-Path $PSScriptRoot "Backup$daubertModule.psm1"
        if ($daubertReload) { Import-Module $daubertModulePath -Force -DisableNameChecking }
        else { Import-Module $daubertModulePath -DisableNameChecking }
    }
}
