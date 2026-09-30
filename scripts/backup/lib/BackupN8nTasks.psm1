#Requires -Version 5.1
<#
    BackupN8nTasks.psm1
    Task Scheduler del backup de n8n. La ÚNICA tarea administrada es:
        Daubert - n8n Weekly
    (ON_CHANGE es manual y NO tiene tarea.)

    Diseño (mismo patrón que BackupTasks.psm1, sin modificarlo):
      - La tarea se define por XML generado por New-N8nTaskXml (función pura) y se registra con los
        wrappers genéricos ya existentes de BackupTasks (Get-BackupScheduledTaskDefinition,
        Register-BackupScheduledTaskXml, Unregister-BackupScheduledTaskByName), que las pruebas
        mockean: ningún test toca Task Scheduler real.
      - El schedule sale de n8n-config.json (schedules.Weekly: dayOfWeek + time; default domingo 04:30).
      - Acción: powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File
        "<repo>\scripts\backup\commands\Start-DaubertN8nBackup.ps1" -Tier Weekly -ConfigPath "<n8n-config.json>".
        Ningún secreto viaja en los argumentos.
      - Política: S4U, LeastPrivilege, IgnoreNew, StartWhenAvailable, PT4H, con batería permitido.
      - Idempotencia: la descripción lleva la marca DaubertHub-Managed-N8nBackup y un hash de la
        definición (def=<hash>). Igual -> Unchanged; distinto -> Update; mismo nombre SIN marca ->
        Blocked (nunca se toca una tarea ajena). La marca es distinta de la de PostgreSQL.
#>

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'BackupTasks.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupElevation.psm1') -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'BackupN8nConfig.psm1') -DisableNameChecking

$script:N8nManagedMarker = 'DaubertHub-Managed-N8nBackup'
$script:N8nTaskName = 'Daubert - n8n Weekly'
$script:N8nAnchorDate = '2026-01-01'

function Get-N8nTaskName { [CmdletBinding()] param() return $script:N8nTaskName }

function Get-N8nManagedTaskNames {
    <# Nombres EXACTOS de las únicas tareas que este módulo puede tocar. #>
    [CmdletBinding()] param()
    return @($script:N8nTaskName)
}

function ConvertTo-N8nXmlText { param([string]$Text) return [System.Security.SecurityElement]::Escape($Text) }

function Get-N8nTaskArguments {
    <# Argumentos de powershell.exe: entrypoint canónico + -Tier Weekly + -ConfigPath. SIN secretos. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ScriptPath, [Parameter(Mandatory = $true)][string]$ConfigPath)
    return ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Tier Weekly -ConfigPath "{1}"' -f $ScriptPath, $ConfigPath)
}

function Get-N8nTaskDefinitionHash {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Schedule,
        [Parameter(Mandatory = $true)][string]$PowerShellPath,
        [Parameter(Mandatory = $true)][string]$Arguments,
        [Parameter(Mandatory = $true)][string]$LogonType,
        [Parameter(Mandatory = $true)][string]$UserId
    )
    $canonical = @('n8n-v1', 'Weekly', "dow=$($Schedule.dayOfWeek)", "time=$($Schedule.time)", $PowerShellPath, $Arguments, $LogonType, $UserId) -join '|'
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical)) } finally { $sha.Dispose() }
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 16)
}

function New-N8nTaskXml {
    <# XML de Task Scheduler (esquema 1.2) de la tarea Weekly. Función pura: no lee ni escribe el sistema. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Schedule,
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [string]$PowerShellPath = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
        [ValidateSet('S4U', 'Interactive')][string]$LogonType = 'S4U',
        [string]$UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    )

    $days = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
    if ($days -cnotcontains [string]$Schedule.dayOfWeek) { throw "Schedule inválido: dayOfWeek '$($Schedule.dayOfWeek)'." }
    if ([string]$Schedule.time -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { throw "Schedule inválido: time '$($Schedule.time)' (HH:mm)." }

    $arguments = Get-N8nTaskArguments -ScriptPath $ScriptPath -ConfigPath $ConfigPath
    $defHash = Get-N8nTaskDefinitionHash -Schedule $Schedule -PowerShellPath $PowerShellPath -Arguments $arguments -LogonType $LogonType -UserId $UserId
    $description = "$($script:N8nManagedMarker) tier=Weekly def=$defHash. Gestionada por scripts/backup/commands/Register-DaubertN8nBackupTask.ps1; no editar a mano."
    $startBoundary = "$($script:N8nAnchorDate)T$($Schedule.time):00"
    $workDir = Split-Path -Parent $ScriptPath

    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Daubert Hub</Author>
    <Description>$(ConvertTo-N8nXmlText $description)</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek>
          <$($Schedule.dayOfWeek) />
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(ConvertTo-N8nXmlText $UserId)</UserId>
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
      <Command>$(ConvertTo-N8nXmlText $PowerShellPath)</Command>
      <Arguments>$(ConvertTo-N8nXmlText $arguments)</Arguments>
      <WorkingDirectory>$(ConvertTo-N8nXmlText $workDir)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
    return $xml
}

function Get-N8nTaskPlan {
    <# Calcula (sin cambiar nada): Create | Update | Unchanged | Blocked. Devuelve { TaskName, Action, Reason, Xml, Definition }. #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Config,
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [string]$PowerShellPath = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'),
        [ValidateSet('S4U', 'Interactive')][string]$LogonType = 'S4U',
        [string]$UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    )
    $schedule = Get-N8nSchedule -Config $Config
    $xml = New-N8nTaskXml -Schedule $schedule -ScriptPath $ScriptPath -ConfigPath $ConfigPath -PowerShellPath $PowerShellPath -LogonType $LogonType -UserId $UserId
    $hash = [regex]::Match($xml, 'def=([0-9a-f]{16})').Groups[1].Value
    $existing = Get-BackupScheduledTaskDefinition -TaskName $script:N8nTaskName

    if ($null -eq $existing) { $action = 'Create'; $reason = 'La tarea no existe.' }
    elseif ($existing.Xml -notmatch [regex]::Escape($script:N8nManagedMarker)) { $action = 'Blocked'; $reason = 'Existe una tarea con ese nombre que NO fue creada por Daubert Hub; no se toca.' }
    elseif ($existing.Xml -match "def=$hash") { $action = 'Unchanged'; $reason = 'Ya está registrada con la misma definición.' }
    else { $action = 'Update'; $reason = 'Existe pero su definición difiere (schedule, rutas o cuenta).' }

    , @([pscustomobject]@{ TaskName = $script:N8nTaskName; Action = $action; Reason = $reason; Xml = $xml; Definition = $hash })
}

function Get-N8nXmlText {
    <#
        Lee (tolerante a StrictMode) el texto de un nodo opcional recorriendo -Path por nombre local
        (sin depender del namespace). Ausente o vacío -> $Default. Nunca lanza por un nodo ausente.
    #>
    param($Node, [string[]]$Path, [string]$Default = '')
    $n = $Node
    foreach ($step in $Path) {
        if ($null -eq $n) { break }
        $n = $n.SelectSingleNode("*[local-name()='$step']")
    }
    if ($null -eq $n -or [string]::IsNullOrWhiteSpace($n.InnerText)) { return $Default }
    return $n.InnerText.Trim()
}

function Get-N8nTaskPlanDetail {
    <#
        Resumen inspeccionable del XML de la tarea (el generado o el que EXPORTA Windows). Solo rutas y
        valores: nunca secretos. Task Scheduler omite al exportar los valores por defecto, así que los
        nodos opcionales ausentes se normalizan al valor por defecto de Windows:
          RunLevel ausente -> LeastPrivilege; MultipleInstancesPolicy -> IgnoreNew;
          StartWhenAvailable -> false; ExecutionTimeLimit -> PT72H; DisallowStartIfOnBatteries -> true.
        Un XML mal formado SÍ lanza (LoadXml).
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Xml)
    $x = New-Object System.Xml.XmlDocument
    $x.LoadXml($Xml)
    $task = $x.DocumentElement
    $trigger = $task.SelectSingleNode("*[local-name()='Triggers']/*[local-name()='CalendarTrigger']")
    $time = (Get-N8nXmlText -Node $trigger -Path @('StartBoundary')) -replace '^.*T(\d{2}:\d{2}).*$', '$1'
    $dowNode = if ($trigger) { $trigger.SelectSingleNode("*[local-name()='ScheduleByWeek']/*[local-name()='DaysOfWeek']") } else { $null }
    $day = if ($dowNode) { @($dowNode.ChildNodes | Where-Object { $_.NodeType -eq 'Element' } | ForEach-Object { $_.LocalName }) -join ',' } else { '' }
    $arguments = Get-N8nXmlText -Node $task -Path @('Actions', 'Exec', 'Arguments')
    [pscustomobject]@{
        Schedule           = "semanal, $day a las $time"
        DayOfWeek          = $day
        Time               = $time
        Executable         = Get-N8nXmlText -Node $task -Path @('Actions', 'Exec', 'Command')
        Arguments          = $arguments
        Script             = [regex]::Match($arguments, '-File "([^"]+)"').Groups[1].Value
        Tier               = [regex]::Match($arguments, '-Tier (\w+)').Groups[1].Value
        ConfigPath         = [regex]::Match($arguments, '-ConfigPath "([^"]+)"').Groups[1].Value
        WorkingDirectory   = Get-N8nXmlText -Node $task -Path @('Actions', 'Exec', 'WorkingDirectory')
        UserId             = Get-N8nXmlText -Node $task -Path @('Principals', 'Principal', 'UserId')
        LogonType          = Get-N8nXmlText -Node $task -Path @('Principals', 'Principal', 'LogonType')
        RunLevel           = Get-N8nXmlText -Node $task -Path @('Principals', 'Principal', 'RunLevel') -Default 'LeastPrivilege'
        MultipleInstances  = Get-N8nXmlText -Node $task -Path @('Settings', 'MultipleInstancesPolicy') -Default 'IgnoreNew'
        StartWhenAvailable = Get-N8nXmlText -Node $task -Path @('Settings', 'StartWhenAvailable') -Default 'false'
        ExecutionTimeLimit = Get-N8nXmlText -Node $task -Path @('Settings', 'ExecutionTimeLimit') -Default 'PT72H'
        AllowOnBatteries   = ((Get-N8nXmlText -Node $task -Path @('Settings', 'DisallowStartIfOnBatteries') -Default 'true') -eq 'false')
    }
}
function Format-N8nTaskPlan {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Plan)
    foreach ($p in @($Plan)) {
        $d = Get-N8nTaskPlanDetail -Xml $p.Xml
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

function Register-N8nTask {
    <#
        Ejecuta el plan. Soporta -WhatIf. Devuelve { TaskName, Action, Result, Error } con Result:
        Created | Updated | Unchanged | Blocked | WhatIf | Failed. Created/Updated SOLO si
        Register-ScheduledTask terminó correctamente (el wrapper usa -ErrorAction Stop).
    #>
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([Parameter(Mandatory = $true)]$Plan)
    foreach ($item in $Plan) {
        $err = $null
        if ($item.Action -eq 'Unchanged') { $result = 'Unchanged' }
        elseif ($item.Action -eq 'Blocked') { $result = 'Blocked' }
        elseif ($PSCmdlet.ShouldProcess($item.TaskName, "$($item.Action) tarea programada")) {
            try {
                Register-BackupScheduledTaskXml -TaskName $item.TaskName -Xml $item.Xml
                $result = if ($item.Action -eq 'Create') { 'Created' } else { 'Updated' }
            }
            catch { $result = 'Failed'; $err = $_.Exception.Message }
        }
        else { $result = 'WhatIf' }
        [pscustomobject]@{ TaskName = $item.TaskName; Action = $item.Action; Result = $result; Error = $err }
    }
}

function Get-N8nTaskRemovalPlan {
    <# Solo lectura: { TaskName, State: NotFound | Foreign | Managed }. #>
    [CmdletBinding()] param()
    $existing = Get-BackupScheduledTaskDefinition -TaskName $script:N8nTaskName
    $state = if ($null -eq $existing) { 'NotFound' } elseif ($existing.Xml -notmatch [regex]::Escape($script:N8nManagedMarker)) { 'Foreign' } else { 'Managed' }
    [pscustomobject]@{ TaskName = $script:N8nTaskName; State = $state }
}

function Unregister-N8nTask {
    <# Elimina SOLO 'Daubert - n8n Weekly' y solo si conserva la marca de n8n. Result: Removed | NotFound | Skipped-Foreign | WhatIf | Failed. #>
    [CmdletBinding(SupportsShouldProcess = $true)]
    param()
    $item = Get-N8nTaskRemovalPlan
    $err = $null
    if ($item.State -eq 'NotFound') { $result = 'NotFound' }
    elseif ($item.State -eq 'Foreign') { $result = 'Skipped-Foreign' }
    elseif ($PSCmdlet.ShouldProcess($item.TaskName, 'Eliminar tarea programada')) {
        try { Unregister-BackupScheduledTaskByName -TaskName $item.TaskName; $result = 'Removed' }
        catch { $result = 'Failed'; $err = $_.Exception.Message }
    }
    else { $result = 'WhatIf' }
    [pscustomobject]@{ TaskName = $item.TaskName; Result = $result; Error = $err }
}

function Test-N8nTaskDefinition {
    <#
        Comprueba la definición EXACTA de una tarea registrada contra lo esperado: marca de n8n,
        entrypoint canónico commands\Start-DaubertN8nBackup.ps1, -Tier Weekly, -ConfigPath en uso,
        S4U, LeastPrivilege, IgnoreNew, StartWhenAvailable, PT4H, batería permitida y el horario
        del config. Devuelve la lista de problemas (vacía = correcta). Solo lee el XML: sin secretos.
    #>
    [CmdletBinding()]
    param([string]$Xml, [string]$ConfigPath, $Schedule)

    $problems = New-Object System.Collections.Generic.List[string]
    try { $d = Get-N8nTaskPlanDetail -Xml $Xml; $x2 = New-Object System.Xml.XmlDocument; $x2.LoadXml($Xml) } catch { return @('XML ilegible') }
    if ((Get-N8nXmlText -Node $x2.DocumentElement -Path @('RegistrationInfo', 'Description')) -notmatch [regex]::Escape($script:N8nManagedMarker)) { $problems.Add('no fue creada por Daubert Hub (backup de n8n)') }
    if ($d.Arguments -notmatch 'commands\\Start-DaubertN8nBackup\.ps1"') { $problems.Add('no ejecuta commands\Start-DaubertN8nBackup.ps1') }
    if ($d.Tier -ne 'Weekly') { $problems.Add('no usa -Tier Weekly') }
    if ($ConfigPath -and $d.ConfigPath.ToLowerInvariant() -ne $ConfigPath.ToLowerInvariant()) { $problems.Add('no usa el -ConfigPath en uso') }
    if ($d.Arguments -notmatch '^-NoProfile -NonInteractive -ExecutionPolicy Bypass ') { $problems.Add('argumentos de powershell.exe inesperados') }
    if ($d.LogonType -ne 'S4U') { $problems.Add('LogonType distinto de S4U') }
    if ($d.RunLevel -ne 'LeastPrivilege') { $problems.Add('RunLevel distinto de LeastPrivilege') }
    if ($d.MultipleInstances -ne 'IgnoreNew') { $problems.Add('permite instancias solapadas (falta IgnoreNew)') }
    if ($d.StartWhenAvailable -ne 'true') { $problems.Add('falta StartWhenAvailable') }
    if ($d.ExecutionTimeLimit -ne 'PT4H') { $problems.Add('ExecutionTimeLimit distinto de PT4H') }
    if (-not $d.AllowOnBatteries) { $problems.Add('no permite ejecutar con batería') }
    if ($Schedule) {
        if ($d.DayOfWeek -ne [string]$Schedule.dayOfWeek -or $d.Time -ne [string]$Schedule.time) { $problems.Add("horario $($d.DayOfWeek) $($d.Time) distinto del configurado ($($Schedule.dayOfWeek) $($Schedule.time))") }
    }
    return $problems.ToArray()
}

Export-ModuleMember -Function Get-N8nTaskName, Get-N8nManagedTaskNames, Get-N8nTaskArguments, Get-N8nTaskDefinitionHash, New-N8nTaskXml, Get-N8nTaskPlan, Get-N8nTaskPlanDetail, Format-N8nTaskPlan, Register-N8nTask, Get-N8nTaskRemovalPlan, Unregister-N8nTask, Test-N8nTaskDefinition
