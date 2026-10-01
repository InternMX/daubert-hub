#Requires -Version 5.1
<#
    BackupTasks.psm1
    Task Scheduler reproducible para el backup de PostgreSQL de Daubert Hub.

    Las ÚNICAS tareas administradas son:
      - Daubert - PostgreSQL Frequent
      - Daubert - PostgreSQL Daily
      - Daubert - PostgreSQL Monthly

    Diseño:
      - Cada tarea se define por XML de Task Scheduler generado por
        New-BackupTaskXml (función pura, testeable sin tocar el sistema) y
        se registra con Register-ScheduledTask -Xml. Usar XML para los tres
        tiers da un único mecanismo, cubre el trigger MENSUAL (que
        New-ScheduledTaskTrigger de PS 5.1 no soporta) y permite fijar
        MultipleInstancesPolicy=IgnoreNew de forma explícita.
      - Las tareas llaman al entrypoint canónico con -Tier y -ConfigPath;
        NINGÚN secreto viaja en los argumentos (la contraseña vive solo en
        el pgpass referenciado por config.json).
      - Daily y Monthly (SOLO ellas) usan trigger diario con repetición horaria y -OnlyIfDue: si el equipo
        estuvo apagado o un intento falló (p. ej. lock ocupado), el siguiente disparo lo reintenta y, cuando ya
        existe el backup válido del periodo, los disparos siguientes terminan en 0 sin hacer nada. Monthly ya
        NO depende de un único disparo el día 1: el día del mes lo decide el script (schedules.Monthly.dayOfMonth).
      - Las tareas coexisten con el lock interno del script: IgnoreNew evita
        instancias solapadas de la MISMA tarea; el lock cubre tiers distintos.
      - Idempotencia: la descripción de cada tarea lleva una marca y un hash
        de la definición (def=<hash>). Si coincide -> Unchanged; si difiere
        -> Update; si el nombre existe SIN la marca -> Blocked (nunca se
        toca una tarea ajena).
      - Las operaciones reales sobre el sistema están confinadas a 3
        wrappers finos (Get-/Register-/Unregister-...) que las pruebas
        mockean: ningún test registra tareas reales.
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupLocalConfig.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupElevation.psm1') -DisableNameChecking

$script:ManagedMarker = 'DaubertHub-Managed-Backup'
$script:TaskNames = [ordered]@{
    Frequent = 'Daubert - PostgreSQL Frequent'
    Daily    = 'Daubert - PostgreSQL Daily'
    Monthly  = 'Daubert - PostgreSQL Monthly'
}
# Fecha ancla fija (determinista): la primera ejecución real la fija StartWhenAvailable/repetición.
$script:AnchorDate = '2026-01-01'
# Oportunidades de reintento de Daily/Monthly: el trigger se repite cada hora durante 24 h desde su hora
# de inicio (como Frequent) y, con -OnlyIfDue, cada disparo solo hace backup si FALTA el del periodo.
$script:RetryInterval = 'PT1H'

function Get-BackupTaskName {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][ValidateSet('Frequent', 'Daily', 'Monthly')][string]$Tier)
    return $script:TaskNames[$Tier]
}

function Get-BackupManagedTaskNames {
    <# Nombres EXACTOS de las únicas tareas que este módulo puede tocar. #>
    [CmdletBinding()]
    param()
    return @($script:TaskNames.Values)
}

function ConvertTo-XmlText {
    param([string]$Text)
    return [System.Security.SecurityElement]::Escape($Text)
}

function Get-BackupTaskArguments {
    <# Argumentos de powershell.exe: entrypoint canónico + Tier + ConfigPath. SIN secretos. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Frequent', 'Daily', 'Monthly')][string]$Tier,
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [switch]$OnlyIfDue,
        [Nullable[int]]$LockTimeoutSeconds = $null
    )
    $arguments = ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Tier {1} -ConfigPath "{2}"' -f $ScriptPath, $Tier, $ConfigPath)
    if ($OnlyIfDue) { $arguments += ' -OnlyIfDue' }
    if ($null -ne $LockTimeoutSeconds -and $LockTimeoutSeconds -gt 0) { $arguments += " -LockTimeoutSeconds $LockTimeoutSeconds" }
    return $arguments
}

function Get-BackupTaskDefinitionHash {
    <# Hash corto y determinista de todo lo que define la tarea (para idempotencia). #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Tier,
        [Parameter(Mandatory = $true)]$Schedule,
        [Parameter(Mandatory = $true)][string]$PowerShellPath,
        [Parameter(Mandatory = $true)][string]$Arguments,
        [Parameter(Mandatory = $true)][string]$LogonType,
        [Parameter(Mandatory = $true)][string]$UserId
    )
    # Frequent conserva EXACTAMENTE su definición (y su hash) anterior; Daily/Monthly pasan a v2 (repetición
    # horaria + -OnlyIfDue en los argumentos), de modo que re-registrar las ACTUALIZA.
    $canonicalParts = @(
        $(if ($Tier -eq 'Frequent') { 'v1' } else { 'v2' }), $Tier, "start=$($Schedule.startTime)",
        "interval=$(Get-OptionalProperty -Object $Schedule -Name 'intervalHours')",
        "dom=$(Get-OptionalProperty -Object $Schedule -Name 'dayOfMonth')",
        $PowerShellPath, $Arguments, $LogonType, $UserId
    )
    if ($Tier -ne 'Frequent') { $canonicalParts += "retry=$($script:RetryInterval)" }
    $canonical = $canonicalParts -join '|'
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical)) } finally { $sha.Dispose() }
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 16)
}

function New-BackupTaskXml {
    <#
        Genera el XML de Task Scheduler (esquema 1.2) de un tier. Función
        pura: no lee ni escribe el sistema.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Frequent', 'Daily', 'Monthly')][string]$Tier,
        [Parameter(Mandatory = $true)]$Schedule,
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [string]$PowerShellPath = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
        [ValidateSet('S4U', 'Interactive')][string]$LogonType = 'S4U',
        [string]$UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
        [Nullable[int]]$LockTimeoutSeconds = $null
    )

    $sErrors = @(Test-ScheduleDefinition -Tier $Tier -Schedule $Schedule)
    if ($sErrors.Count -gt 0) { throw ("Schedule inválido para ${Tier}: " + ($sErrors -join '; ')) }

    $startTime = Get-OptionalProperty -Object $Schedule -Name 'startTime'
    if (-not $startTime) { throw "Schedule de $Tier sin startTime." }
    $startBoundary = "$($script:AnchorDate)T$($startTime):00"

    # Daily/Monthly: -OnlyIfDue + repetición horaria. Frequent no cambia (sin -OnlyIfDue; espera de lock solo si se configura > 0).
    $retries = ($Tier -ne 'Frequent')
    if ($null -eq $LockTimeoutSeconds) { $LockTimeoutSeconds = Get-DefaultLockTimeoutSeconds -Tier $Tier }
    $arguments = Get-BackupTaskArguments -Tier $Tier -ScriptPath $ScriptPath -ConfigPath $ConfigPath -OnlyIfDue:$retries -LockTimeoutSeconds $LockTimeoutSeconds
    $defHash = Get-BackupTaskDefinitionHash -Tier $Tier -Schedule $Schedule -PowerShellPath $PowerShellPath -Arguments $arguments -LogonType $LogonType -UserId $UserId
    $description = "$($script:ManagedMarker) tier=$Tier def=$defHash. Gestionada por scripts/backup/commands/Register-DaubertBackupTasks.ps1; no editar a mano."

    $repetition = ''
    $scheduleBlock = ''
    switch ($Tier) {
        'Frequent' {
            $interval = [int](Get-OptionalProperty -Object $Schedule -Name 'intervalHours')
            if ($interval -lt 24) {
                $repetition = "      <Repetition>`r`n        <Interval>PT${interval}H</Interval>`r`n        <Duration>P1D</Duration>`r`n        <StopAtDurationEnd>false</StopAtDurationEnd>`r`n      </Repetition>`r`n"
            }
            $scheduleBlock = "      <ScheduleByDay>`r`n        <DaysInterval>1</DaysInterval>`r`n      </ScheduleByDay>`r`n"
        }
        'Daily' {
            $repetition = "      <Repetition>`r`n        <Interval>$($script:RetryInterval)</Interval>`r`n        <Duration>P1D</Duration>`r`n        <StopAtDurationEnd>false</StopAtDurationEnd>`r`n      </Repetition>`r`n"
            $scheduleBlock = "      <ScheduleByDay>`r`n        <DaysInterval>1</DaysInterval>`r`n      </ScheduleByDay>`r`n"
        }
        'Monthly' {
            # Ya NO es un disparo único el día dayOfMonth: dispara TODOS los días, cada hora, y -OnlyIfDue decide.
            # "Toca" desde dayOfMonth a startTime hasta que exista un Monthly válido de ese mes (puede ser días después).
            $repetition = "      <Repetition>`r`n        <Interval>$($script:RetryInterval)</Interval>`r`n        <Duration>P1D</Duration>`r`n        <StopAtDurationEnd>false</StopAtDurationEnd>`r`n      </Repetition>`r`n"
            $scheduleBlock = "      <ScheduleByDay>`r`n        <DaysInterval>1</DaysInterval>`r`n      </ScheduleByDay>`r`n"
        }
    }

    $workDir = Split-Path -Parent $ScriptPath

    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Daubert Hub</Author>
    <Description>$(ConvertTo-XmlText $description)</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
$repetition      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
$scheduleBlock    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(ConvertTo-XmlText $UserId)</UserId>
      <LogonType>$LogonType</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT4H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(ConvertTo-XmlText $PowerShellPath)</Command>
      <Arguments>$(ConvertTo-XmlText $arguments)</Arguments>
      <WorkingDirectory>$(ConvertTo-XmlText $workDir)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
    return $xml
}

# ---------------------------------------------------------------------------
# Wrappers finos sobre el sistema (lo ÚNICO que las pruebas mockean)
# ---------------------------------------------------------------------------

function Get-BackupScheduledTaskDefinition {
    <# Devuelve { TaskName, Xml } de la tarea, o $null si no existe. Solo lectura. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$TaskName)
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { return $null }
    [pscustomobject]@{ TaskName = $TaskName; Xml = [string](Export-ScheduledTask -TaskName $TaskName) }
}

function Get-BackupTaskAdminStatus {
    <# Contexto de privilegios para ADMINISTRAR tareas (solo Register/Unregister; ejecutar backups no lo requiere). #>
    [CmdletBinding()]
    param()
    [pscustomobject]@{ IsAdministrator = [bool](Test-IsAdministrator) }
}
function Register-BackupScheduledTaskXml {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$Xml
    )
    # -ErrorAction Stop: sin él, "Acceso denegado" es un error NO terminante (los módulos no heredan el $ErrorActionPreference del script) y el fallo pasaría por éxito.
    Register-ScheduledTask -TaskName $TaskName -Xml $Xml -Force -ErrorAction Stop | Out-Null
}

function Unregister-BackupScheduledTaskByName {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$TaskName)
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
}

# ---------------------------------------------------------------------------
# Plan / registro / desregistro
# ---------------------------------------------------------------------------

function Get-BackupTaskPlan {
    <#
        Calcula (sin cambiar nada) qué haría el registro para cada tier:
        Create | Update | Unchanged | Blocked. Devuelve objetos
        { Tier, TaskName, Action, Reason, Xml, Definition }.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$LocalConfig,
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [string[]]$Tier = @('Frequent', 'Daily', 'Monthly'),
        [string]$PowerShellPath = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
        [ValidateSet('S4U', 'Interactive')][string]$LogonType = 'S4U',
        [string]$UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    )

    $plan = New-Object System.Collections.Generic.List[object]
    foreach ($t in $Tier) {
        $schedule = Get-LocalConfigSchedule -Config $LocalConfig -Tier $t
        $lockTimeout = Get-LocalConfigLockTimeout -Config $LocalConfig -Tier $t
        $xml = New-BackupTaskXml -Tier $t -Schedule $schedule -ScriptPath $ScriptPath -ConfigPath $ConfigPath -PowerShellPath $PowerShellPath -LogonType $LogonType -UserId $UserId -LockTimeoutSeconds $lockTimeout
        $hash = [regex]::Match($xml, 'def=([0-9a-f]{16})').Groups[1].Value
        $name = Get-BackupTaskName -Tier $t
        $existing = Get-BackupScheduledTaskDefinition -TaskName $name

        if ($null -eq $existing) { $action = 'Create'; $reason = 'La tarea no existe.' }
        elseif ($existing.Xml -notmatch [regex]::Escape($script:ManagedMarker)) { $action = 'Blocked'; $reason = 'Existe una tarea con ese nombre que NO fue creada por Daubert Hub; no se toca.' }
        elseif ($existing.Xml -match "def=$hash") { $action = 'Unchanged'; $reason = 'Ya está registrada con la misma definición.' }
        else { $action = 'Update'; $reason = 'Existe pero su definición difiere (schedule, rutas o cuenta).' }

        $plan.Add([pscustomobject]@{ Tier = $t; TaskName = $name; Action = $action; Reason = $reason; Xml = $xml; Definition = $hash })
    }
    , $plan.ToArray()
}

function Get-BackupTaskPlanDetail {
    <#
        Resume, a partir del XML que se va a registrar (la fuente de verdad), todo lo que un
        operador necesita inspeccionar: horario, ejecutable, script, tier, ConfigPath,
        principal/logon y política de concurrencia. Solo contiene rutas y valores de
        configuración: nunca secretos.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Xml)

    $x = New-Object System.Xml.XmlDocument
    $x.LoadXml($Xml)
    $task = $x.Task
    $trigger = $task.Triggers.CalendarTrigger
    $time = ([string]$trigger.StartBoundary) -replace '^.*T(\d{2}:\d{2}).*$', '$1'

    if ($trigger.SelectSingleNode("*[local-name()='ScheduleByMonth']")) {
        $schedule = "día $($trigger.ScheduleByMonth.DaysOfMonth.Day) de cada mes a las $time"
    }
    elseif ($trigger.SelectSingleNode("*[local-name()='Repetition']")) {
        $hours = [regex]::Match([string]$trigger.Repetition.Interval, 'PT(\d+)H').Groups[1].Value
        $schedule = "cada $hours h, todos los días, empezando a las $time"
        if ([string]$task.Actions.Exec.Arguments -match ' -OnlyIfDue(\s|$)') { $schedule += ' (solo hace backup si falta el del periodo: -OnlyIfDue)' }
    }
    else { $schedule = "todos los días a las $time" }

    $arguments = [string]$task.Actions.Exec.Arguments
    [pscustomobject]@{
        Schedule          = $schedule
        Executable        = [string]$task.Actions.Exec.Command
        Arguments         = $arguments
        Script            = [regex]::Match($arguments, '-File "([^"]+)"').Groups[1].Value
        Tier              = [regex]::Match($arguments, '-Tier (\w+)').Groups[1].Value
        ConfigPath        = [regex]::Match($arguments, '-ConfigPath "([^"]+)"').Groups[1].Value
        WorkingDirectory  = [string]$task.Actions.Exec.WorkingDirectory
        UserId            = [string]$task.Principals.Principal.UserId
        LogonType         = [string]$task.Principals.Principal.LogonType
        RunLevel          = [string]$task.Principals.Principal.RunLevel
        MultipleInstances = [string]$task.Settings.MultipleInstancesPolicy
        StartWhenAvailable = [string]$task.Settings.StartWhenAvailable
        ExecutionTimeLimit = [string]$task.Settings.ExecutionTimeLimit
        AllowOnBatteries  = ([string]$task.Settings.DisallowStartIfOnBatteries -eq 'false')
    }
}

function Format-BackupTaskPlan {
    <# Líneas legibles del plan (para -WhatIf y para el registro real). Sin secretos. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Plan)

    foreach ($p in @($Plan)) {
        $d = Get-BackupTaskPlanDetail -Xml $p.Xml
        "$($p.TaskName)  [$($p.Action.ToUpperInvariant())]  $($p.Reason)"
        "    Horario      : $($d.Schedule)"
        "    Ejecutable   : $($d.Executable)"
        "    Script       : $($d.Script)"
        "    Tier         : $($d.Tier)"
        "    ConfigPath   : $($d.ConfigPath)"
        "    Directorio   : $($d.WorkingDirectory)"
        "    Cuenta/logon : $($d.UserId) / $($d.LogonType) ($($d.RunLevel))"
        "    Concurrencia : MultipleInstances=$($d.MultipleInstances); StartWhenAvailable=$($d.StartWhenAvailable); límite de ejecución $($d.ExecutionTimeLimit); con batería: $(if ($d.AllowOnBatteries) { 'permitido' } else { 'no' })"
    }
}

function Register-BackupTasks {
    <#
        Ejecuta el plan: registra/actualiza solo lo necesario. Soporta -WhatIf/-Confirm. Nunca toca
        tareas ajenas (Action=Blocked se reporta y se omite). Devuelve
        { Tier, TaskName, Action, Result, Error } con Result:
          Created | Updated | Unchanged | Blocked | WhatIf | Failed | NotAttempted
        Created/Updated SOLO si Register-ScheduledTask terminó correctamente. Ante el primer fallo
        se detiene: esa tarea queda Failed (con el error técnico) y las siguientes NotAttempted.
    #>
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([Parameter(Mandatory = $true)]$Plan)

    $failed = $false
    foreach ($item in $Plan) {
        $err = $null
        if ($item.Action -eq 'Unchanged') { $result = 'Unchanged' }
        elseif ($item.Action -eq 'Blocked') { $result = 'Blocked' }
        elseif ($failed) { $result = 'NotAttempted' }
        elseif ($PSCmdlet.ShouldProcess($item.TaskName, "$($item.Action) tarea programada")) {
            try {
                Register-BackupScheduledTaskXml -TaskName $item.TaskName -Xml $item.Xml
                $result = if ($item.Action -eq 'Create') { 'Created' } else { 'Updated' }
            }
            catch {
                $failed = $true
                $result = 'Failed'
                $err = $_.Exception.Message
            }
        }
        else { $result = 'WhatIf' }
        [pscustomobject]@{ Tier = $item.Tier; TaskName = $item.TaskName; Action = $item.Action; Result = $result; Error = $err }
    }
}

function Get-BackupTaskRemovalPlan {
    <# Solo lectura: qué tareas administradas existirían para eliminar. { Tier, TaskName, State: NotFound | Foreign | Managed }. #>
    [CmdletBinding()]
    param([string[]]$Tier = @('Frequent', 'Daily', 'Monthly'))
    foreach ($t in $Tier) {
        $name = Get-BackupTaskName -Tier $t
        $existing = Get-BackupScheduledTaskDefinition -TaskName $name
        $state = if ($null -eq $existing) { 'NotFound' } elseif ($existing.Xml -notmatch [regex]::Escape($script:ManagedMarker)) { 'Foreign' } else { 'Managed' }
        [pscustomobject]@{ Tier = $t; TaskName = $name; State = $state }
    }
}

function Unregister-BackupTasks {
    <#
        Elimina SOLO las tareas administradas (nombres exactos) que conserven la marca de Daubert
        Hub. Una tarea con un nombre igual pero sin marca se omite (Skipped-Foreign). Soporta
        -WhatIf. Devuelve { Tier, TaskName, Result, Error } con Result:
          Removed | NotFound | Skipped-Foreign | WhatIf | Failed | NotAttempted
        Removed SOLO si la eliminación terminó correctamente; ante el primer fallo se detiene.
    #>
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([string[]]$Tier = @('Frequent', 'Daily', 'Monthly'))

    $failed = $false
    foreach ($item in @(Get-BackupTaskRemovalPlan -Tier $Tier)) {
        $err = $null
        if ($item.State -eq 'NotFound') { $result = 'NotFound' }
        elseif ($item.State -eq 'Foreign') { $result = 'Skipped-Foreign' }
        elseif ($failed) { $result = 'NotAttempted' }
        elseif ($PSCmdlet.ShouldProcess($item.TaskName, 'Eliminar tarea programada')) {
            try { Unregister-BackupScheduledTaskByName -TaskName $item.TaskName; $result = 'Removed' }
            catch { $failed = $true; $result = 'Failed'; $err = $_.Exception.Message }
        }
        else { $result = 'WhatIf' }
        [pscustomobject]@{ Tier = $item.Tier; TaskName = $item.TaskName; Result = $result; Error = $err }
    }
}
Export-ModuleMember -Function Get-BackupTaskName, Get-BackupManagedTaskNames, Get-BackupTaskArguments, Get-BackupTaskDefinitionHash, New-BackupTaskXml, `
    Get-BackupScheduledTaskDefinition, Register-BackupScheduledTaskXml, Unregister-BackupScheduledTaskByName, `
    Get-BackupTaskPlan, Get-BackupTaskPlanDetail, Format-BackupTaskPlan, Register-BackupTasks, Unregister-BackupTasks, Get-BackupTaskRemovalPlan, Get-BackupTaskAdminStatus
