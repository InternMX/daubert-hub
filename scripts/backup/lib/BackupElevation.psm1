#Requires -Version 5.1
<#
    BackupElevation.psm1
    Capa CENTRAL y reutilizable de elevación administrativa (UAC) del subsistema de
    backup. Ningún comando debe implementar su propia lógica de elevación: todos usan
    Invoke-ElevationGate / Request-AdministrativeElevation.

    Principios:
      - Nada se ejecuta elevado por defecto: el wizard/los comandos se abren SIN privilegios
        y solo las operaciones que realmente los necesitan (ver Get-ElevationRequirement)
        solicitan elevación, mediante el UAC estándar de Windows y de forma EXPLÍCITA
        (el comando recibe -RequestElevation). Sin ese consentimiento, un comando lanzado
        por CLI falla limpiamente (exit 5) indicando que requiere PowerShell elevada.
      - Si el proceso YA está elevado no se vuelve a pedir UAC (una sola elevación).
      - -WhatIf, diagnóstico, preflight, lectura de configuración y los backups nunca
        requieren elevación.
      - Sin autoelevación silenciosa, sin bypass de UAC, sin deshabilitar UAC, sin guardar
        credenciales administrativas.
      - NUNCA viajan secretos en los argumentos del proceso elevado: se rechazan parámetros
        con nombre de secreto, valores con forma de secreto y SecureString/PSCredential. El
        proceso elevado recarga su configuración de las ubicaciones autorizadas.
      - Sin Add-Type ni ejecutables auxiliares; solo System.Security.Principal y Start-Process.

    Códigos de salida estables de los comandos que usan esta capa:
      5  requiere elevación y no se solicitó (fail fast; no se modificó nada)
      7  el usuario canceló/denegó el UAC (no es éxito; no queda estado parcial; se puede reintentar)
    (Si el proceso elevado se lanzó, se propaga su propio código de salida.)
#>

Set-StrictMode -Version Latest

$script:SecretNamePattern = '(?i)(pass(word|wd|phrase)?$|^pgpass|secret|token|api[-_]?key|private|credential|identity)'
$script:SecretValuePattern = '(?i)(AGE-SECRET-KEY-|PGPASSWORD\s*=|://[^/\s:@]+:[^@\s]+@)'

# Operaciones conocidas y si REALMENTE requieren administrador (no se asume que todas lo hagan).
# 'Probe' = depende del entorno y se decide comprobando permisos reales.
$script:OperationCatalog = @{
    RegisterTasks        = @{ Required = $true;  Reason = 'Register-ScheduledTask exige elevación para crear/modificar tareas.' }
    UnregisterTasks      = @{ Required = $true;  Reason = 'Unregister-ScheduledTask exige elevación para eliminar tareas.' }
    WriteProgramData     = @{ Required = 'Probe'; Reason = 'Escribir en %ProgramData% solo requiere elevación si la carpeta no es escribible para el usuario actual.' }
    InstallPrerequisites = @{ Required = $false; Reason = 'winget solicita su propio UAC solo si el paquete lo necesita; el script no se eleva.' }
    Preflight            = @{ Required = $false; Reason = 'Solo lectura.' }
    Diagnose             = @{ Required = $false; Reason = 'Solo lectura.' }
    ReadConfig           = @{ Required = $false; Reason = 'Solo lectura.' }
    RunBackup            = @{ Required = $false; Reason = 'Los backups no requieren administrador.' }
    Status               = @{ Required = $false; Reason = 'Solo lectura.' }
}

function Test-IsAdministrator {
    <#
        $true si el proceso actual está ELEVADO. Solo System.Security.Principal (compatible con
        Windows PowerShell 5.1, sin Add-Type, sin ejecutables, sin consultar Task Scheduler).
        Seam: las pruebas lo mockean.
    #>
    [CmdletBinding()]
    param()
    try {
        $principal = New-Object System.Security.Principal.WindowsPrincipal([System.Security.Principal.WindowsIdentity]::GetCurrent())
        return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    catch { return $false }
}

function Test-PathWritableByCurrentUser {
    <# Sondeo real (crea y borra un archivo) en la carpeta o en su ancestro existente más cercano. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)
    $dir = $Path
    while ($dir -and -not (Test-Path -LiteralPath $dir -PathType Container)) { $dir = Split-Path -Parent $dir }
    if (-not $dir) { return $false }
    $probe = Join-Path $dir (".daubert-elev-probe-{0}.tmp" -f [guid]::NewGuid().ToString('N'))
    try { [System.IO.File]::WriteAllText($probe, 'x'); Remove-Item -LiteralPath $probe -Force; return $true }
    catch { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue; return $false }
}

function Get-ElevationRequirement {
    <#
        Decide si una operación necesita elevación ANTES de empezarla.
        -WhatIf nunca la requiere. Devuelve { Operation, Required, Reason }.
        Para 'WriteProgramData' se comprueba con -Path si el usuario actual puede escribir.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Operation,
        [switch]$WhatIf,
        [string]$Path
    )
    if (-not $script:OperationCatalog.ContainsKey($Operation)) { throw "Operación desconocida para elevación: '$Operation'. Válidas: $($script:OperationCatalog.Keys -join ', ')" }
    $entry = $script:OperationCatalog[$Operation]
    if ($WhatIf) { return [pscustomobject]@{ Operation = $Operation; Required = $false; Reason = '-WhatIf nunca requiere elevación.' } }
    $required = $entry.Required
    if ($required -eq 'Probe') { $required = if ($Path) { -not (Test-PathWritableByCurrentUser -Path $Path) } else { $true } }
    [pscustomobject]@{ Operation = $Operation; Required = [bool]$required; Reason = $entry.Reason }
}

function ConvertTo-ElevationArgumentString {
    <#
        Serializa parámetros NO sensibles a argumentos de -File. Rechaza (lanza) cualquier
        parámetro con nombre de secreto, valor con forma de secreto, SecureString o
        PSCredential. switches: $true -> "-Nombre"; $false/$null se omiten; arrays -> a,b,c.
    #>
    [CmdletBinding()]
    param([System.Collections.IDictionary]$Parameters = @{})

    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($name in $Parameters.Keys) {
        $value = $Parameters[$name]
        if ($value -is [System.Security.SecureString] -or $value -is [System.Management.Automation.PSCredential]) { throw "Se rechaza pasar '$name' al proceso elevado: es una credencial." }
        if ($null -eq $value) { continue }
        # Un interruptor (true/false) no puede transportar un secreto: p. ej. -SkipPgPass es seguro aunque su nombre contenga "Pass".
        if ($value -is [System.Management.Automation.SwitchParameter]) { if ($value.IsPresent) { $parts.Add("-$name") }; continue }
        if ($value -is [bool]) { if ($value) { $parts.Add("-$name") }; continue }
        if ($name -match $script:SecretNamePattern) { throw "Se rechaza pasar el parámetro '$name' al proceso elevado: parece un secreto (los secretos nunca viajan por línea de comandos)." }
        $text = (@($value) | ForEach-Object { [string]$_ }) -join ','
        if ($text -match $script:SecretValuePattern) { throw "Se rechaza pasar '$name' al proceso elevado: su valor tiene forma de secreto." }
        $parts.Add("-$name")
        $parts.Add('"' + ($text -replace '"', '\"') + '"')
    }
    return ($parts -join ' ')
}

function Start-ElevatedProcess {
    <#
        Único punto que lanza un proceso elevado (UAC estándar: -Verb RunAs). Seam mockeable: las
        pruebas nunca abren un UAC real. Devuelve { Started, Cancelled, ExitCode, Error }.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string]$ArgumentList
    )
    try {
        $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -Verb RunAs -Wait -PassThru -ErrorAction Stop
        return [pscustomobject]@{ Started = $true; Cancelled = $false; ExitCode = [int]$proc.ExitCode; Error = $null }
    }
    catch {
        # 1223 = ERROR_CANCELLED: el usuario canceló/denegó el UAC.
        $native = $null
        $ex = $_.Exception
        while ($ex -and $null -eq $native) { if ($ex -is [System.ComponentModel.Win32Exception]) { $native = $ex.NativeErrorCode }; $ex = $ex.InnerException }
        $cancelled = ($native -eq 1223) -or ($_.Exception.Message -match '(?i)cancel')
        return [pscustomobject]@{ Started = $false; Cancelled = $cancelled; ExitCode = $null; Error = $_.Exception.Message }
    }
}

function Request-AdministrativeElevation {
    <#
        Relanza un script con UAC estándar pasando SOLO parámetros no sensibles. Si el proceso ya
        está elevado NO relanza (no hay segundo UAC): devuelve AlreadyElevated=$true.
        Devuelve { AlreadyElevated, Started, Cancelled, ExitCode, ArgumentString, Error }.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [System.Collections.IDictionary]$Parameters = @{},
        [string]$PowerShellPath = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
    )
    if (Test-IsAdministrator) {
        return [pscustomobject]@{ AlreadyElevated = $true; Started = $false; Cancelled = $false; ExitCode = $null; ArgumentString = $null; Error = $null }
    }
    $argString = '-NoProfile -ExecutionPolicy Bypass -File "' + $ScriptPath + '"'
    $extra = ConvertTo-ElevationArgumentString -Parameters $Parameters
    if ($extra) { $argString += ' ' + $extra }
    $r = Start-ElevatedProcess -FilePath $PowerShellPath -ArgumentList $argString
    [pscustomobject]@{ AlreadyElevated = $false; Started = $r.Started; Cancelled = $r.Cancelled; ExitCode = $r.ExitCode; ArgumentString = $argString; Error = $r.Error }
}

function Invoke-ElevationGate {
    <#
        Punto único de decisión para cualquier comando con una operación privilegiada:
          - no requerida (o -WhatIf)            -> Proceed
          - requerida y ya elevado              -> Proceed (sin segundo UAC)
          - requerida, no elevado, sin consentimiento (-RequestElevation ausente)
                                                -> FailFast (exit 5; nada se modificó)
          - requerida, no elevado, con consentimiento
                                                -> UAC estándar una vez:
                                                   Relaunched (exit = el del proceso elevado) |
                                                   Cancelled (exit 7; no es éxito, se puede reintentar)
        El llamador imprime Message y sale con ExitCode cuando Action != Proceed.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][bool]$Required,
        [Parameter(Mandatory = $true)][string]$OperationName,
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [System.Collections.IDictionary]$Parameters = @{},
        [bool]$RequestElevation = $false
    )

    if (-not $Required) { return [pscustomobject]@{ Action = 'Proceed'; ExitCode = 0; Message = $null } }
    if (Test-IsAdministrator) { return [pscustomobject]@{ Action = 'Proceed'; ExitCode = 0; Message = $null } }

    if (-not $RequestElevation) {
        return [pscustomobject]@{
            Action = 'FailFast'; ExitCode = 5
            Message = "$OperationName requiere una PowerShell ELEVADA. No se modificó nada. Abra PowerShell como Administrador y repita el comando, o añada -RequestElevation para que se solicite el UAC de Windows ahora."
        }
    }

    $r = Request-AdministrativeElevation -ScriptPath $ScriptPath -Parameters $Parameters
    if ($r.AlreadyElevated) { return [pscustomobject]@{ Action = 'Proceed'; ExitCode = 0; Message = $null } }
    if ($r.Cancelled) {
        return [pscustomobject]@{ Action = 'Cancelled'; ExitCode = 7; Message = "$OperationName CANCELADO: el UAC fue cancelado o denegado, así que no se aplicó ningún cambio. Puede reintentarlo cuando quiera." }
    }
    if (-not $r.Started) {
        return [pscustomobject]@{ Action = 'Cancelled'; ExitCode = 7; Message = "$OperationName no pudo iniciar el proceso elevado ($($r.Error)); no se aplicó ningún cambio." }
    }
    [pscustomobject]@{ Action = 'Relaunched'; ExitCode = [int]$r.ExitCode; Message = "$OperationName ejecutado en un proceso elevado (código de salida $($r.ExitCode))." }
}

Export-ModuleMember -Function Test-IsAdministrator, Test-PathWritableByCurrentUser, Get-ElevationRequirement, ConvertTo-ElevationArgumentString, Start-ElevatedProcess, Request-AdministrativeElevation, Invoke-ElevationGate
