#Requires -Version 5.1
<#
    Pruebas de la Fase C del backup de n8n: config independiente, instalador, preflight y Task Scheduler.

    IMPORTANTE:
      - Todo el sistema está mockeado: NO se registran tareas reales, NO se ejecuta ningún backup ni snapshot,
        NO se abre ningún UAC real, NO se toca n8n ni PostgreSQL. Ningún ejecutable sintético.
      - Seams mockeados: Get-BackupScheduledTaskDefinition / Register-BackupScheduledTaskXml /
        Unregister-BackupScheduledTaskByName (tareas), Test-IsAdministrator / Start-ElevatedProcess (UAC),
        Invoke-NodeProcess (Node), Test-BackupToolPath (herramientas).
      - La instalación de n8n es una carpeta temporal con archivos de texto minúsculos.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\Backup-N8nProductization.Tests.ps1"
#>

$backupRoot = Split-Path -Parent $PSScriptRoot
$commandsDir = Join-Path $backupRoot 'commands'
. (Join-Path $PSScriptRoot 'helpers\N8nTestDoubles.ps1')
foreach ($m in 'BackupConfig', 'BackupLocalConfig', 'BackupLock', 'BackupHash', 'BackupElevation', 'BackupTasks', 'BackupPreflight', 'BackupN8nConfig', 'BackupN8nSqlite', 'BackupN8nStaging', 'BackupN8nTasks', 'BackupN8nInstall', 'BackupN8nPreflight', 'BackupN8nPipeline') {
    Import-Module (Join-Path $backupRoot "lib\$m.psm1") -Force -DisableNameChecking
}

$script:PrivateKeyText = 'AGE-SECRET-KEY-' + '1' + ('Q' * 40)
$script:Sched = [pscustomobject]@{ dayOfWeek = 'Sunday'; time = '04:30' }
$script:EntryScript = Join-Path $commandsDir 'Start-DaubertN8nBackup.ps1'

function New-ProdEnv {
    # Entorno temporal completo: instalación n8n falsa + n8n-config.json válido escrito con el código real.
    $e = New-N8nTestEnv
    $pd = Join-Path $e.Root 'programdata'
    $paths = Get-N8nDefaultPaths -ProgramDataRoot $pd -LocalAppDataRoot (Join-Path $e.Root 'localappdata')
    New-Item -ItemType Directory -Path $paths.ConfigRoot, $e.LogRoot, $e.LockRoot -Force | Out-Null
    Copy-Item -LiteralPath $e.RecipientsFilePath -Destination $paths.RecipientsFilePath
    $cfg = New-N8nConfigObject -N8nRoot $e.N8nRoot -NodePath $e.NodePath -N8nPackagePath $e.N8nPackagePath -SevenZipPath $e.SevenZipPath -AgePath $e.AgePath `
        -RecipientsFilePath $paths.RecipientsFilePath -BackupRoot $e.BackupRoot -StagingRoot $e.StagingRoot -LogRoot $e.LogRoot -LockRoot $e.LockRoot
    Write-N8nBackupConfig -Path $paths.ConfigPath -Config $cfg | Out-Null
    # Herramientas: archivos de texto reales con nombres NO ejecutables (Test-BackupToolPath solo comprueba existencia).
    New-Item -ItemType Directory -Path (Join-Path $e.Root 'tools') -Force | Out-Null
    foreach ($tool in $e.NodePath, $e.SevenZipPath, $e.AgePath) { [System.IO.File]::WriteAllText($tool, 'herramienta de prueba (archivo de texto)') }
    $e | Add-Member -NotePropertyName Paths -NotePropertyValue $paths
    $e | Add-Member -NotePropertyName ConfigPath -NotePropertyValue $paths.ConfigPath
    return $e
}

function Set-TaskMocks {
    $global:TaskState = @{}
    $global:RegCalls = New-Object 'System.Collections.Generic.List[string]'
    $global:UnregCalls = New-Object 'System.Collections.Generic.List[string]'
    $global:RegFail = $null
    Mock Get-BackupScheduledTaskDefinition { if ($global:TaskState.ContainsKey($TaskName)) { [pscustomobject]@{ TaskName = $TaskName; Xml = $global:TaskState[$TaskName] } } else { $null } } -ModuleName BackupN8nTasks
    Mock Register-BackupScheduledTaskXml { if ($global:RegFail) { throw $global:RegFail }; $global:RegCalls.Add($TaskName); $global:TaskState[$TaskName] = $Xml } -ModuleName BackupN8nTasks
    Mock Unregister-BackupScheduledTaskByName { if ($global:RegFail) { throw $global:RegFail }; $global:UnregCalls.Add($TaskName); $global:TaskState.Remove($TaskName) } -ModuleName BackupN8nTasks
}

function Invoke-CmdScript {
    # Ejecuta un comando in-process y devuelve { ExitCode; Text } (todos los streams).
    param([string]$Name, [hashtable]$Params = @{})
    $global:LASTEXITCODE = $null
    $out = & (Join-Path $commandsDir $Name) @Params *>&1 | Out-String
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Text = $out }
}

function New-TestPrompter {
    param([hashtable]$Ask = @{}, [hashtable]$Confirm = @{}, [string]$Choose = 'Cancelar')
    $global:Said = New-Object 'System.Collections.Generic.List[string]'
    [pscustomobject]@{
        Write   = { param($m) $global:Said.Add([string]$m) }
        Ask     = { param($prompt, $default) foreach ($k in $Ask.Keys) { if ($prompt -like "*$k*") { return $Ask[$k] } }; return $default }.GetNewClosure()
        Confirm = { param($prompt, $defaultYes) foreach ($k in $Confirm.Keys) { if ($prompt -like "*$k*") { return [bool]$Confirm[$k] } }; return [bool]$defaultYes }.GetNewClosure()
        Choose  = { param($p, $o) $Choose }.GetNewClosure()
    }
}

function New-InstallPaths {
    param($Env)
    [pscustomobject]@{ ConfigRoot = $Env.Paths.ConfigRoot; ConfigPath = $Env.Paths.ConfigPath; RecipientsFilePath = $Env.Paths.RecipientsFilePath; LogRoot = $Env.LogRoot; LockRoot = $Env.LockRoot; StagingRoot = $Env.StagingRoot }
}

$script:NodeOk = { param($NodePath) [pscustomobject]@{ Supported = $true; Version = '24.0.0'; HasSqlite = $true; HasDatabaseSync = $true; HasBackup = $true; VersionOk = $true; Reason = '' } }

# ===========================================================================
Describe 'n8n config productivo - independiente del de PostgreSQL' {

    BeforeEach { $script:e = New-ProdEnv }
    AfterEach { Remove-Item -LiteralPath $script:e.Root -Recurse -Force -ErrorAction SilentlyContinue; Clear-FakeTools }

    It 'la ruta canónica es %ProgramData%\DaubertHub\Backup\n8n-config.json y NO es la de PostgreSQL' {
        $d = Get-N8nDefaultPaths
        $d.ConfigPath | Should Be (Join-Path $env:ProgramData 'DaubertHub\Backup\n8n-config.json')
        $d.ConfigPath | Should Not Be (Get-DefaultBackupPaths).ConfigPath
        (Split-Path -Leaf $d.ConfigPath) | Should Be 'n8n-config.json'
    }
    It 'un config generado es válido y trae todos los campos, retención 56/90 días y schedule domingo 04:30' {
        $o = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
        (Test-N8nConfigObject -Config $o).IsValid | Should Be $true
        foreach ($f in 'schemaVersion', 'n8nRoot', 'nodePath', 'n8nPackagePath', 'sevenZipPath', 'agePath', 'recipientsFilePath', 'backupRoot', 'stagingRoot', 'logRoot', 'lockRoot', 'retention', 'schedules') { ($o.PSObject.Properties.Name -contains $f) | Should Be $true }
        $o.retention.Weekly.unit | Should Be 'Days'; $o.retention.Weekly.value | Should Be 56
        $o.retention.OnChange.unit | Should Be 'Days'; $o.retention.OnChange.value | Should Be 90
        $o.schedules.Weekly.dayOfWeek | Should Be 'Sunday'; $o.schedules.Weekly.time | Should Be '04:30'
        ($o.schedules.PSObject.Properties.Name -contains 'OnChange') | Should Be $false
    }
    It 'n8nPackagePath es opcional' {
        $o = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
        $o.PSObject.Properties.Remove('n8nPackagePath')
        (Test-N8nConfigObject -Config $o).IsValid | Should Be $true
    }
    It 'rechaza configs inválidos: campo faltante, ruta relativa, schemaVersion, retención, schedule' {
        $base = { Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json }
        $o = & $base; $o.PSObject.Properties.Remove('agePath'); (Test-N8nConfigObject -Config $o).IsValid | Should Be $false
        $o = & $base; $o.backupRoot = 'relativa\ruta'; (Test-N8nConfigObject -Config $o).IsValid | Should Be $false
        $o = & $base; $o.schemaVersion = 99; (Test-N8nConfigObject -Config $o).IsValid | Should Be $false
        $o = & $base; $o.retention.Weekly.value = 0; (Test-N8nConfigObject -Config $o).IsValid | Should Be $false
        $o = & $base; $o.schedules.Weekly.dayOfWeek = 'Domingo'; (Test-N8nConfigObject -Config $o).IsValid | Should Be $false
        $o = & $base; $o.schedules.Weekly.dayOfWeek = 'sunday'; (Test-N8nConfigObject -Config $o).IsValid | Should Be $false
        $o = & $base; $o.schedules.Weekly.time = '25:00'; (Test-N8nConfigObject -Config $o).IsValid | Should Be $false
        $o = & $base; $o.schedules | Add-Member -NotePropertyName Daily -NotePropertyValue ([pscustomobject]@{ time = '01:00' }); (Test-N8nConfigObject -Config $o).IsValid | Should Be $false
    }
    It 'OnChange NO puede tener schedule (es manual)' {
        $o = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
        $o.schedules | Add-Member -NotePropertyName OnChange -NotePropertyValue ([pscustomobject]@{ dayOfWeek = 'Monday'; time = '01:00' })
        $r = Test-N8nConfigObject -Config $o
        $r.IsValid | Should Be $false
        ($r.Errors -join ' ') | Should Match 'OnChange'
    }
    It 'rechaza secretos: encryption key, password, token, credentials, identidad age y clave privada en un valor' {
        foreach ($k in 'encryptionKey', 'password', 'apiToken', 'credentials', 'ageIdentity', 'privateKey') {
            $o = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
            $o | Add-Member -NotePropertyName $k -NotePropertyValue 'VALOR_SECRETO_ZZZ'
            $r = Test-N8nConfigObject -Config $o
            $r.IsValid | Should Be $false
            ($r.Errors -join ' ') | Should Not Match 'VALOR_SECRETO_ZZZ'
        }
        $o = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
        $o.lockRoot = $script:PrivateKeyText
        (Test-N8nConfigObject -Config $o).IsValid | Should Be $false
    }
    It 'Write-N8nBackupConfig es atómico e idempotente y no deja temporales' {
        $cfg = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
        (Write-N8nBackupConfig -Path $script:e.ConfigPath -Config $cfg).Changed | Should Be $false
        $cfg.lockRoot = (Join-Path $script:e.Root 'otros-locks')
        (Write-N8nBackupConfig -Path $script:e.ConfigPath -Config $cfg).Changed | Should Be $true
        @(Get-ChildItem -LiteralPath (Split-Path -Parent $script:e.ConfigPath) -Filter '*.tmp').Count | Should Be 0
    }
    It 'un config con secretos se rechaza ANTES de tocar disco y deja el anterior intacto' {
        $before = Get-FileHash -LiteralPath $script:e.ConfigPath
        $cfg = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
        $cfg | Add-Member -NotePropertyName encryptionKey -NotePropertyValue 'XYZ'
        { Write-N8nBackupConfig -Path $script:e.ConfigPath -Config $cfg } | Should Throw
        (Get-FileHash -LiteralPath $script:e.ConfigPath).Hash | Should Be $before.Hash
        @(Get-ChildItem -LiteralPath (Split-Path -Parent $script:e.ConfigPath) -Filter '*.tmp').Count | Should Be 0
    }
    It 'el archivo escrito no contiene secretos ni el contenido de .n8n\config' {
        $raw = Get-Content -LiteralPath $script:e.ConfigPath -Raw
        $raw | Should Not Match $global:N8nMarker
        $raw | Should Not Match '(?i)encryption|password|token|credential|AGE-SECRET-KEY'
    }
    It 'separación: el config de n8n no es válido como config de PostgreSQL y viceversa' {
        (Read-LocalBackupConfig -Path $script:e.ConfigPath).IsValid | Should Be $false
        $pgPath = Join-Path (Split-Path -Parent $script:e.ConfigPath) 'config.json'
        $pg = New-LocalBackupConfigObject -PostgresBin (Join-Path $script:e.Root 'pg') -SevenZipPath $script:e.SevenZipPath -AgePath $script:e.AgePath -RecipientsFilePath $script:e.Paths.RecipientsFilePath `
            -PgPassFile (Join-Path $script:e.Root 'secrets\pgpass.conf') -BackupRoot $script:e.BackupRoot -StagingRoot $script:e.StagingRoot -LogRoot $script:e.LogRoot -LockRoot $script:e.LockRoot
        Write-LocalBackupConfig -Path $pgPath -Config $pg | Out-Null
        (Read-N8nBackupConfigFile -Path $pgPath).IsValid | Should Be $false
        (Read-LocalBackupConfig -Path $pgPath).IsValid | Should Be $true
        (Test-Path -LiteralPath $script:e.ConfigPath) | Should Be $true
    }
    It 'Get-N8nSchedule: default domingo 04:30 y respeta el config' {
        (Get-N8nSchedule -Config ([pscustomobject]@{})).dayOfWeek | Should Be 'Sunday'
        (Get-N8nSchedule -Config ([pscustomobject]@{})).time | Should Be '04:30'
        $s = Get-N8nSchedule -Config ([pscustomobject]@{ schedules = [pscustomobject]@{ Weekly = [pscustomobject]@{ dayOfWeek = 'Friday'; time = '23:15' } } })
        $s.dayOfWeek | Should Be 'Friday'; $s.time | Should Be '23:15'
    }
    It 'el motor sigue resolviendo este config (-ConfigPath) con retención por defecto' {
        $r = Resolve-N8nBackupRunConfig -Tier Weekly -ConfigPath $script:e.ConfigPath
        @($r.Errors).Count | Should Be 0
        $r.Config.RetentionValue | Should Be 56
        (Resolve-N8nBackupRunConfig -Tier OnChange -ConfigPath $script:e.ConfigPath).Config.RetentionValue | Should Be 90
    }
}

# ===========================================================================
Describe 'Sondeo de Node: node:sqlite, DatabaseSync y backup()' {

    BeforeEach {
        $global:NodeVer = 'v24.19.0'
        $global:ProbeJson = '{"sqlite":true,"databaseSync":true,"backup":true}'
        Mock Invoke-NodeProcess {
            if ($ArgumentList -contains '--version') { [pscustomobject]@{ ExitCode = 0; StdOut = "$($global:NodeVer)`n"; StdErr = '' } }
            else { [pscustomobject]@{ ExitCode = 0; StdOut = $global:ProbeJson; StdErr = '' } }
        } -ModuleName BackupN8nSqlite
    }

    It 'Node con node:sqlite, DatabaseSync y backup(): soportado' {
        $r = Test-N8nNodeSqliteSupport -NodePath 'x'
        $r.Supported | Should Be $true; $r.Version | Should Be '24.19.0'; $r.HasBackup | Should Be $true
    }
    It 'Node SIN node:sqlite: no soportado' {
        $global:ProbeJson = '{"sqlite":false,"databaseSync":false,"backup":false}'
        $r = Test-N8nNodeSqliteSupport -NodePath 'x'
        $r.Supported | Should Be $false; $r.Reason | Should Match 'node:sqlite'
    }
    It 'Node SIN backup(): no soportado' {
        $global:ProbeJson = '{"sqlite":true,"databaseSync":true,"backup":false}'
        $r = Test-N8nNodeSqliteSupport -NodePath 'x'
        $r.Supported | Should Be $false; $r.HasDatabaseSync | Should Be $true; $r.Reason | Should Match 'backup\(\)'
    }
    It 'Node SIN DatabaseSync: no soportado' {
        $global:ProbeJson = '{"sqlite":true,"databaseSync":false,"backup":true}'
        (Test-N8nNodeSqliteSupport -NodePath 'x').Supported | Should Be $false
    }
    It 'versión de Node anterior a la mínima: no soportado' {
        $global:NodeVer = 'v20.11.0'
        $r = Test-N8nNodeSqliteSupport -NodePath 'x'
        $r.Supported | Should Be $false; $r.VersionOk | Should Be $false
    }
    It 'sondeo con salida inválida o fallo de proceso: no soportado (sin lanzar)' {
        $global:ProbeJson = 'no-es-json'
        (Test-N8nNodeSqliteSupport -NodePath 'x').Supported | Should Be $false
    }
    It 'el sondeo no abre ninguna base de datos ni el helper de snapshot' {
        Test-N8nNodeSqliteSupport -NodePath 'x' | Out-Null
        Assert-MockCalled Invoke-NodeProcess -ModuleName BackupN8nSqlite -Times 0 -ParameterFilter { $ArgumentList -contains '--source' }
    }
}

# ===========================================================================
Describe 'Task Scheduler n8n - XML de la tarea (función pura)' {

    $script1 = Join-Path $commandsDir 'Start-DaubertN8nBackup.ps1'
    $cfgPath = Join-Path $env:ProgramData 'DaubertHub\Backup\n8n-config.json'
    $psPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

    It 'nombre exacto de la única tarea administrada' {
        Get-N8nTaskName | Should Be 'Daubert - n8n Weekly'
        @(Get-N8nManagedTaskNames).Count | Should Be 1
        @(Get-N8nManagedTaskNames)[0] | Should Be 'Daubert - n8n Weekly'
    }
    It 'schedule por defecto: domingo 04:30 (trigger semanal)' {
        $x = [xml](New-N8nTaskXml -Schedule $script:Sched -ScriptPath $script1 -ConfigPath $cfgPath -UserId 'EQUIPO\usuario')
        $t = $x.Task.Triggers.CalendarTrigger
        $t.StartBoundary | Should Match 'T04:30:00$'
        @($t.ScheduleByWeek.DaysOfWeek.ChildNodes | ForEach-Object { $_.LocalName }) -join ',' | Should Be 'Sunday'
        $t.ScheduleByWeek.WeeksInterval | Should Be '1'
    }
    It 'el schedule es configurable (se lee de la config, no está hardcodeado)' {
        $x = [xml](New-N8nTaskXml -Schedule ([pscustomobject]@{ dayOfWeek = 'Wednesday'; time = '23:15' }) -ScriptPath $script1 -ConfigPath $cfgPath -UserId 'EQUIPO\usuario')
        $x.Task.Triggers.CalendarTrigger.StartBoundary | Should Match 'T23:15:00$'
        @($x.Task.Triggers.CalendarTrigger.ScheduleByWeek.DaysOfWeek.ChildNodes | ForEach-Object { $_.LocalName }) -join ',' | Should Be 'Wednesday'
    }
    It 'un schedule inválido lanza y no genera XML' {
        { New-N8nTaskXml -Schedule ([pscustomobject]@{ dayOfWeek = 'Domingo'; time = '04:30' }) -ScriptPath $script1 -ConfigPath $cfgPath } | Should Throw
        { New-N8nTaskXml -Schedule ([pscustomobject]@{ dayOfWeek = 'Sunday'; time = '4:30' }) -ScriptPath $script1 -ConfigPath $cfgPath } | Should Throw
    }
    It 'política: S4U, LeastPrivilege (Limited), IgnoreNew, StartWhenAvailable, PT4H, batería permitida' {
        $x = [xml](New-N8nTaskXml -Schedule $script:Sched -ScriptPath $script1 -ConfigPath $cfgPath -UserId 'EQUIPO\usuario')
        $x.Task.Principals.Principal.LogonType | Should Be 'S4U'
        $x.Task.Principals.Principal.RunLevel | Should Be 'LeastPrivilege'
        $x.Task.Principals.Principal.UserId | Should Be 'EQUIPO\usuario'
        $x.Task.Settings.MultipleInstancesPolicy | Should Be 'IgnoreNew'
        $x.Task.Settings.StartWhenAvailable | Should Be 'true'
        $x.Task.Settings.ExecutionTimeLimit | Should Be 'PT4H'
        $x.Task.Settings.DisallowStartIfOnBatteries | Should Be 'false'
        $x.Task.Settings.StopIfGoingOnBatteries | Should Be 'false'
    }
    It 'acción exacta: powershell.exe con los argumentos pedidos, rutas absolutas reales y WorkingDirectory = commands' {
        $x = [xml](New-N8nTaskXml -Schedule $script:Sched -ScriptPath $script1 -ConfigPath $cfgPath -PowerShellPath $psPath -UserId 'EQUIPO\usuario')
        $exec = $x.Task.Actions.Exec
        $exec.Command | Should Be $psPath
        $exec.Arguments | Should Be ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Tier Weekly -ConfigPath "{1}"' -f $script1, $cfgPath)
        [System.IO.Path]::IsPathRooted($exec.Command) | Should Be $true
        $exec.Arguments | Should Match '-File "[A-Za-z]:\\'
        $exec.Arguments | Should Match '-ConfigPath "[A-Za-z]:\\'
        $exec.WorkingDirectory | Should Be $commandsDir
        $exec.Arguments | Should Match 'commands\\Start-DaubertN8nBackup\.ps1"'
    }
    It 'ON_CHANGE no genera tarea: la única acción es -Tier Weekly y no hay tarea OnChange' {
        $x = New-N8nTaskXml -Schedule $script:Sched -ScriptPath $script1 -ConfigPath $cfgPath -UserId 'EQUIPO\usuario'
        $x | Should Not Match 'OnChange|ON_CHANGE'
        (Get-N8nTaskArguments -ScriptPath $script1 -ConfigPath $cfgPath) | Should Match '-Tier Weekly'
        (Get-N8nManagedTaskNames | Where-Object { $_ -match 'Change' }) | Should BeNullOrEmpty
        ((Get-Command (Join-Path $commandsDir 'Register-DaubertN8nBackupTask.ps1')).Parameters.Keys -contains 'Tier') | Should Be $false
    }
    It 'sin secretos en XML ni argumentos' {
        $x = New-N8nTaskXml -Schedule $script:Sched -ScriptPath $script1 -ConfigPath $cfgPath -UserId 'EQUIPO\usuario'
        $x | Should Not Match '(?i)password|secret|token|credential|encryption|AGE-SECRET-KEY'
    }
    It 'la descripción lleva una marca PROPIA de n8n (distinta de la de PostgreSQL) y un hash de definición' {
        $x = New-N8nTaskXml -Schedule $script:Sched -ScriptPath $script1 -ConfigPath $cfgPath -UserId 'EQUIPO\usuario'
        $x | Should Match 'DaubertHub-Managed-N8nBackup'
        $x | Should Not Match 'DaubertHub-Managed-Backup '
        $x | Should Match 'def=[0-9a-f]{16}'
    }
    It 'el hash cambia si cambia el horario, el config o la cuenta' {
        $h = { param($s, $c, $u) [regex]::Match((New-N8nTaskXml -Schedule $s -ScriptPath $script1 -ConfigPath $c -UserId $u), 'def=([0-9a-f]{16})').Groups[1].Value }
        $a = & $h $script:Sched $cfgPath 'A\u'
        $a | Should Be (& $h $script:Sched $cfgPath 'A\u')
        $a | Should Not Be (& $h ([pscustomobject]@{ dayOfWeek = 'Monday'; time = '04:30' }) $cfgPath 'A\u')
        $a | Should Not Be (& $h $script:Sched ($cfgPath + 'x') 'A\u')
        $a | Should Not Be (& $h $script:Sched $cfgPath 'B\u')
    }
}

# ===========================================================================
Describe 'Task Scheduler n8n - plan, registro e idempotencia (wrappers mockeados)' {

    BeforeEach { $script:e = New-ProdEnv; Set-TaskMocks; $script:cfgObj = (Read-N8nBackupConfigFile -Path $script:e.ConfigPath).Config }
    AfterEach { Remove-Item -LiteralPath $script:e.Root -Recurse -Force -ErrorAction SilentlyContinue; Clear-FakeTools }

    function Get-Plan { Get-N8nTaskPlan -Config $script:cfgObj -ScriptPath $script:EntryScript -ConfigPath $script:e.ConfigPath -UserId 'EQUIPO\usuario' }

    It 'sin tarea existente: Create; Register la crea (Created) una sola vez' {
        $plan = Get-Plan
        @($plan).Count | Should Be 1
        $plan[0].Action | Should Be 'Create'
        @(Register-N8nTask -Plan $plan)[0].Result | Should Be 'Created'
        $global:RegCalls.Count | Should Be 1
        $global:RegCalls[0] | Should Be 'Daubert - n8n Weekly'
    }
    It 'idempotente: repetir el registro da Unchanged y no vuelve a registrar' {
        Register-N8nTask -Plan (Get-Plan) | Out-Null
        $plan = Get-Plan
        $plan[0].Action | Should Be 'Unchanged'
        @(Register-N8nTask -Plan $plan)[0].Result | Should Be 'Unchanged'
        $global:RegCalls.Count | Should Be 1
    }
    It 'si cambia el schedule en el config: Update (Updated)' {
        Register-N8nTask -Plan (Get-Plan) | Out-Null
        $script:cfgObj.schedules.Weekly.dayOfWeek = 'Friday'
        $plan = Get-Plan
        $plan[0].Action | Should Be 'Update'
        @(Register-N8nTask -Plan $plan)[0].Result | Should Be 'Updated'
        ([xml]$global:TaskState['Daubert - n8n Weekly']).Task.Triggers.CalendarTrigger.ScheduleByWeek.DaysOfWeek.ChildNodes[0].LocalName | Should Be 'Friday'
    }
    It '-WhatIf no registra nada' {
        $r = @(Register-N8nTask -Plan (Get-Plan) -WhatIf)
        $r[0].Result | Should Be 'WhatIf'
        $global:RegCalls.Count | Should Be 0
    }
    It 'tarea ajena con el mismo nombre: Blocked, no se toca' {
        $global:TaskState['Daubert - n8n Weekly'] = '<Task><RegistrationInfo><Description>la hizo otra persona</Description></RegistrationInfo></Task>'
        $plan = Get-Plan
        $plan[0].Action | Should Be 'Blocked'
        @(Register-N8nTask -Plan $plan)[0].Result | Should Be 'Blocked'
        $global:RegCalls.Count | Should Be 0
        (Get-N8nTaskRemovalPlan).State | Should Be 'Foreign'
    }
    It 'Task Scheduler rechaza (acceso denegado): Failed, nunca Created' {
        $global:RegFail = 'Acceso denegado'
        $r = @(Register-N8nTask -Plan (Get-Plan))[0]
        $r.Result | Should Be 'Failed'
        $r.Error | Should Match 'Acceso denegado'
        $global:TaskState.ContainsKey('Daubert - n8n Weekly') | Should Be $false
    }
    It 'Unregister elimina solo la tarea n8n administrada' {
        Register-N8nTask -Plan (Get-Plan) | Out-Null
        (Unregister-N8nTask).Result | Should Be 'Removed'
        $global:UnregCalls.Count | Should Be 1
        (Unregister-N8nTask).Result | Should Be 'NotFound'
    }
    It 'Unregister no toca una tarea ajena con el mismo nombre (Skipped-Foreign)' {
        $global:TaskState['Daubert - n8n Weekly'] = '<Task>ajena</Task>'
        (Unregister-N8nTask).Result | Should Be 'Skipped-Foreign'
        $global:UnregCalls.Count | Should Be 0
    }
    It 'no toca las tareas de PostgreSQL ni ninguna otra: Register/Unregister solo invocan el nombre n8n' {
        foreach ($n in (Get-BackupManagedTaskNames)) { $global:TaskState[$n] = "<Task><RegistrationInfo><Description>DaubertHub-Managed-Backup tier=X def=abc</Description></RegistrationInfo></Task>" }
        $global:TaskState['Otra tarea'] = '<Task>otra</Task>'
        $snap = ($global:TaskState.Keys | Sort-Object | ForEach-Object { "$_=$($global:TaskState[$_])" }) -join "`n"
        Register-N8nTask -Plan (Get-Plan) | Out-Null
        Unregister-N8nTask | Out-Null
        foreach ($n in @($global:RegCalls) + @($global:UnregCalls)) { $n | Should Be 'Daubert - n8n Weekly' }
        $after = ($global:TaskState.Keys | Sort-Object | Where-Object { $_ -ne 'Daubert - n8n Weekly' } | ForEach-Object { "$_=$($global:TaskState[$_])" }) -join "`n"
        $after | Should Be $snap
    }
    It 'PostgreSQL: los nombres administrados por BackupTasks siguen siendo exactamente los tres originales y no incluyen el de n8n' {
        (Get-BackupManagedTaskNames) -join '|' | Should Be 'Daubert - PostgreSQL Frequent|Daubert - PostgreSQL Daily|Daubert - PostgreSQL Monthly'
        (Get-BackupManagedTaskNames) -contains 'Daubert - n8n Weekly' | Should Be $false
    }
    It 'el detalle del plan muestra horario, script, tier Weekly, config y política sin secretos' {
        $text = (Format-N8nTaskPlan -Plan (Get-Plan)) -join "`n"
        $text | Should Match 'semanal, Sunday a las 04:30'
        $text | Should Match 'Tier         : Weekly'
        $text | Should Match 'S4U'
        $text | Should Match 'IgnoreNew'
        $text | Should Match 'PT4H'
        $text | Should Not Match '(?i)password|secret|token|AGE-SECRET'
    }
    It 'Test-N8nTaskDefinition: definición exacta = sin problemas; cualquier desviación se detecta' {
        $xml = (Get-Plan)[0].Xml
        @(Test-N8nTaskDefinition -Xml $xml -ConfigPath $script:e.ConfigPath -Schedule $script:Sched).Count | Should Be 0
        @(Test-N8nTaskDefinition -Xml $xml -ConfigPath ($script:e.ConfigPath + 'x') -Schedule $script:Sched).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml $xml -ConfigPath $script:e.ConfigPath -Schedule ([pscustomobject]@{ dayOfWeek = 'Monday'; time = '04:30' })).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml ($xml -replace 'IgnoreNew', 'Parallel') -ConfigPath $script:e.ConfigPath -Schedule $script:Sched).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml ($xml -replace 'PT4H', 'PT1H') -ConfigPath $script:e.ConfigPath -Schedule $script:Sched).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml ($xml -replace '<LogonType>S4U', '<LogonType>Interactive') -ConfigPath $script:e.ConfigPath -Schedule $script:Sched).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml ($xml -replace 'LeastPrivilege', 'HighestAvailable') -ConfigPath $script:e.ConfigPath -Schedule $script:Sched).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml ($xml -replace '<StartWhenAvailable>true', '<StartWhenAvailable>false') -ConfigPath $script:e.ConfigPath -Schedule $script:Sched).Count | Should BeGreaterThan 0
    }
}

# ===========================================================================
Describe 'Validación del XML real exportado por Windows (RunLevel omitido al ser el valor por defecto)' {

    $script1 = Join-Path $commandsDir 'Start-DaubertN8nBackup.ps1'
    $cfgPath = Join-Path $env:ProgramData 'DaubertHub\Backup\n8n-config.json'
    $gen = New-N8nTaskXml -Schedule $script:Sched -ScriptPath $script1 -ConfigPath $cfgPath -UserId 'EQUIPO\usuario'
    # Forma real de Export-ScheduledTask: sin <RunLevel> (LeastPrivilege/Limited es el default) y con <URI>.
    $real = ($gen -replace '\s*<RunLevel>LeastPrivilege</RunLevel>', '') -replace '</Description>', '</Description><URI>\Daubert - n8n Weekly</URI>'

    It 'XML generado internamente con <RunLevel>LeastPrivilege</RunLevel>: válido' {
        $gen | Should Match '<RunLevel>LeastPrivilege</RunLevel>'
        @(Test-N8nTaskDefinition -Xml $gen -ConfigPath $cfgPath -Schedule $script:Sched).Count | Should Be 0
        (Get-N8nTaskPlanDetail -Xml $gen).RunLevel | Should Be 'LeastPrivilege'
    }
    It 'XML con la forma real exportada (sin <RunLevel>): válido y normalizado a LeastPrivilege' {
        $real | Should Not Match 'RunLevel'
        @(Test-N8nTaskDefinition -Xml $real -ConfigPath $cfgPath -Schedule $script:Sched).Count | Should Be 0
        (Get-N8nTaskPlanDetail -Xml $real).RunLevel | Should Be 'LeastPrivilege'
    }
    It '<RunLevel> vacío: se normaliza a LeastPrivilege (válido)' {
        $empty = $gen -replace '<RunLevel>LeastPrivilege</RunLevel>', '<RunLevel></RunLevel>'
        @(Test-N8nTaskDefinition -Xml $empty -ConfigPath $cfgPath -Schedule $script:Sched).Count | Should Be 0
    }
    It '<RunLevel>HighestAvailable</RunLevel>: reporta problema de RunLevel (y nada más)' {
        $hi = $gen -replace 'LeastPrivilege', 'HighestAvailable'
        $p = @(Test-N8nTaskDefinition -Xml $hi -ConfigPath $cfgPath -Schedule $script:Sched)
        $p.Count | Should Be 1
        $p[0] | Should Match 'RunLevel distinto de LeastPrivilege'
    }
    It 'XML mal formado: XML ilegible' {
        (@(Test-N8nTaskDefinition -Xml '<Task><Principals>' -ConfigPath $cfgPath -Schedule $script:Sched) -join '|') | Should Be 'XML ilegible'
        (@(Test-N8nTaskDefinition -Xml 'no es xml' -ConfigPath $cfgPath -Schedule $script:Sched) -join '|') | Should Be 'XML ilegible'
    }
    It 'el XML real sin RunLevel no lanza bajo Set-StrictMode -Version Latest' {
        Set-StrictMode -Version Latest
        { Get-N8nTaskPlanDetail -Xml $real } | Should Not Throw
        { Test-N8nTaskDefinition -Xml $real -ConfigPath $cfgPath -Schedule $script:Sched } | Should Not Throw
    }
    It 'las demás validaciones siguen siendo estrictas con el XML real (IgnoreNew, S4U, PT4H, horario, config)' {
        @(Test-N8nTaskDefinition -Xml ($real -replace 'IgnoreNew', 'Parallel') -ConfigPath $cfgPath -Schedule $script:Sched).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml ($real -replace '<LogonType>S4U', '<LogonType>Password') -ConfigPath $cfgPath -Schedule $script:Sched).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml ($real -replace 'PT4H', 'PT1H') -ConfigPath $cfgPath -Schedule $script:Sched).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml ($real -replace '<Sunday />', '<Monday />') -ConfigPath $cfgPath -Schedule $script:Sched).Count | Should BeGreaterThan 0
        @(Test-N8nTaskDefinition -Xml $real -ConfigPath ($cfgPath + 'x') -Schedule $script:Sched).Count | Should BeGreaterThan 0
    }
    It 'otros nodos opcionales ausentes se normalizan al default de Windows (sin lanzar) y se detectan si incumplen la política' {
        $min = $real -replace '\s*<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>', '' -replace '\s*<StartWhenAvailable>true</StartWhenAvailable>', '' -replace '\s*<ExecutionTimeLimit>PT4H</ExecutionTimeLimit>', '' -replace '\s*<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>', '' -replace '\s*<WorkingDirectory>[^<]*</WorkingDirectory>', ''
        Set-StrictMode -Version Latest
        $d = Get-N8nTaskPlanDetail -Xml $min
        $d.MultipleInstances | Should Be 'IgnoreNew'
        $d.StartWhenAvailable | Should Be 'false'
        $d.ExecutionTimeLimit | Should Be 'PT72H'
        $d.AllowOnBatteries | Should Be $false
        $d.WorkingDirectory | Should Be ''
        $pr = @(Test-N8nTaskDefinition -Xml $min -ConfigPath $cfgPath -Schedule $script:Sched) -join ' | '
        $pr | Should Match 'StartWhenAvailable'
        $pr | Should Match 'PT4H'
        $pr | Should Match 'batería'
        $pr | Should Not Match 'ilegible'
    }
    It 'Format-N8nTaskPlan acepta el XML real sin RunLevel' {
        { Format-N8nTaskPlan -Plan ([pscustomobject]@{ TaskName = 'Daubert - n8n Weekly'; Action = 'Unchanged'; Reason = 'x'; Xml = $real }) } | Should Not Throw
    }
}

Describe 'Register/Unregister-DaubertN8nBackupTask (in-process, scheduler y UAC mockeados)' {

    BeforeEach {
        $script:e = New-ProdEnv; Set-TaskMocks
        Mock Test-IsAdministrator { $global:IsAdmin } -ModuleName BackupElevation
        $global:ElevCalls = 0; $global:ElevArgs = $null; $global:ElevResult = $null
        Mock Start-ElevatedProcess { $global:ElevCalls++; $global:ElevArgs = $ArgumentList; $global:ElevResult } -ModuleName BackupElevation
        $global:IsAdmin = $false
        $global:ElevResult = [pscustomobject]@{ Started = $true; Cancelled = $false; ExitCode = 0; Error = $null }
        $script:savedNoReload = $env:DAUBERT_BACKUP_NO_RELOAD
        $env:DAUBERT_BACKUP_NO_RELOAD = '1'
    }
    AfterEach {
        $env:DAUBERT_BACKUP_NO_RELOAD = $script:savedNoReload
        Remove-Item -LiteralPath $script:e.Root -Recurse -Force -ErrorAction SilentlyContinue; Clear-FakeTools
    }

    function Invoke-Reg { param([hashtable]$Extra = @{}) $p = @{ ConfigPath = $script:e.ConfigPath }; foreach ($k in $Extra.Keys) { $p[$k] = $Extra[$k] }; Invoke-CmdScript 'Register-DaubertN8nBackupTask.ps1' $p }

    It '-WhatIf funciona sin admin: exit 0, muestra el plan y no registra ni pide UAC' {
        $r = Invoke-Reg @{ WhatIf = $true }
        $r.ExitCode | Should Be 0
        $r.Text | Should Match 'Daubert - n8n Weekly'
        $r.Text | Should Match 'CREATE'
        $global:RegCalls.Count | Should Be 0
        $global:ElevCalls | Should Be 0
    }
    It 'registro real sin admin: fail fast exit 5, sin tocar nada y sin UAC' {
        $r = Invoke-Reg
        $r.ExitCode | Should Be 5
        $r.Text | Should Match 'ELEVADA'
        $global:RegCalls.Count | Should Be 0
        $global:ElevCalls | Should Be 0
    }
    It 'registro real con admin: exit 0 y tarea Created' {
        $global:IsAdmin = $true
        $r = Invoke-Reg
        $r.ExitCode | Should Be 0
        $r.Text | Should Match 'Created'
        $global:RegCalls.Count | Should Be 1
        $global:ElevCalls | Should Be 0
    }
    It 'idempotente: segunda ejecución = Unchanged, exit 0 y sin nuevo registro (ni UAC aunque no sea admin)' {
        $global:IsAdmin = $true
        (Invoke-Reg).ExitCode | Should Be 0
        $global:IsAdmin = $false
        $r = Invoke-Reg
        $r.ExitCode | Should Be 0
        $r.Text | Should Match 'Unchanged'
        $global:RegCalls.Count | Should Be 1
        $global:ElevCalls | Should Be 0
    }
    It 'acceso denegado de Task Scheduler: exit 6 y NUNCA informa Created' {
        $global:IsAdmin = $true
        $global:RegFail = 'Acceso denegado'
        $r = Invoke-Reg
        $r.ExitCode | Should Be 6
        $r.Text | Should Match 'Failed'
        $r.Text | Should Not Match 'Created'
        $global:TaskState.ContainsKey('Daubert - n8n Weekly') | Should Be $false
    }
    It 'UAC cancelado con -RequestElevation: exit 7, sin cambios' {
        $global:ElevResult = [pscustomobject]@{ Started = $false; Cancelled = $true; ExitCode = $null; Error = 'cancelado' }
        $r = Invoke-Reg @{ RequestElevation = $true }
        $r.ExitCode | Should Be 7
        $r.Text | Should Match 'CANCELADO'
        $global:ElevCalls | Should Be 1
        $global:RegCalls.Count | Should Be 0
    }
    It '-RequestElevation con éxito: pide UAC UNA vez, propaga el exit del proceso elevado y no pasa secretos' {
        $r = Invoke-Reg @{ RequestElevation = $true }
        $r.ExitCode | Should Be 0
        $global:ElevCalls | Should Be 1
        $global:ElevArgs | Should Match 'Register-DaubertN8nBackupTask\.ps1'
        $global:ElevArgs | Should Match '-ConfigPath'
        $global:ElevArgs | Should Not Match '(?i)password|secret|token|AGE-SECRET|encryption'
        $global:ElevArgs | Should Not Match $global:N8nMarker
    }
    It 'ya elevado con -RequestElevation: no hay segundo UAC' {
        $global:IsAdmin = $true
        (Invoke-Reg @{ RequestElevation = $true }).ExitCode | Should Be 0
        $global:ElevCalls | Should Be 0
    }
    It 'el exit del proceso elevado se propaga' {
        $global:ElevResult = [pscustomobject]@{ Started = $true; Cancelled = $false; ExitCode = 6; Error = $null }
        (Invoke-Reg @{ RequestElevation = $true }).ExitCode | Should Be 6
    }
    It 'tarea ajena con ese nombre: exit 4, no se toca' {
        $global:IsAdmin = $true
        $global:TaskState['Daubert - n8n Weekly'] = '<Task>ajena</Task>'
        (Invoke-Reg).ExitCode | Should Be 4
        $global:RegCalls.Count | Should Be 0
    }
    It 'config inválido o inexistente: exit 3' {
        (Invoke-CmdScript 'Register-DaubertN8nBackupTask.ps1' @{ ConfigPath = (Join-Path $script:e.Root 'no-existe.json') }).ExitCode | Should Be 3
    }
    It 'un config de PostgreSQL pasado por error se rechaza (exit 3): no se mezcla con el de n8n' {
        $pgPath = Join-Path $script:e.Root 'config.json'
        $pg = New-LocalBackupConfigObject -PostgresBin (Join-Path $script:e.Root 'pg') -SevenZipPath $script:e.SevenZipPath -AgePath $script:e.AgePath -RecipientsFilePath $script:e.RecipientsFilePath `
            -PgPassFile (Join-Path $script:e.Root 'secrets\pgpass.conf') -BackupRoot $script:e.BackupRoot -StagingRoot $script:e.StagingRoot -LogRoot $script:e.LogRoot -LockRoot $script:e.LockRoot
        Write-LocalBackupConfig -Path $pgPath -Config $pg | Out-Null
        (Invoke-CmdScript 'Register-DaubertN8nBackupTask.ps1' @{ ConfigPath = $pgPath }).ExitCode | Should Be 3
    }
    It 'el schedule registrado sale de n8n-config.json' {
        $cfg = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
        $cfg.schedules.Weekly.dayOfWeek = 'Thursday'; $cfg.schedules.Weekly.time = '02:10'
        Write-N8nBackupConfig -Path $script:e.ConfigPath -Config $cfg | Out-Null
        $global:IsAdmin = $true
        (Invoke-Reg).ExitCode | Should Be 0
        $x = [xml]$global:TaskState['Daubert - n8n Weekly']
        $x.Task.Triggers.CalendarTrigger.StartBoundary | Should Match 'T02:10:00$'
        $x.Task.Triggers.CalendarTrigger.ScheduleByWeek.DaysOfWeek.ChildNodes[0].LocalName | Should Be 'Thursday'
        $x.Task.Actions.Exec.Arguments | Should Match ([regex]::Escape($script:e.ConfigPath))
    }
    It 'la salida no contiene secretos ni el contenido de .n8n\config' {
        $global:IsAdmin = $true
        $r = Invoke-Reg
        $r.Text | Should Not Match $global:N8nMarker
        $r.Text | Should Not Match '(?i)AGE-SECRET|password'
    }
    It 'Unregister -WhatIf sin admin: exit 0 y no elimina' {
        $global:IsAdmin = $true; Invoke-Reg | Out-Null; $global:IsAdmin = $false
        (Invoke-CmdScript 'Unregister-DaubertN8nBackupTask.ps1' @{ WhatIf = $true }).ExitCode | Should Be 0
        $global:UnregCalls.Count | Should Be 0
        $global:TaskState.ContainsKey('Daubert - n8n Weekly') | Should Be $true
    }
    It 'Unregister sin admin: exit 5; con admin elimina (exit 0); repetirlo es seguro' {
        $global:IsAdmin = $true; Invoke-Reg | Out-Null; $global:IsAdmin = $false
        (Invoke-CmdScript 'Unregister-DaubertN8nBackupTask.ps1').ExitCode | Should Be 5
        $global:IsAdmin = $true
        (Invoke-CmdScript 'Unregister-DaubertN8nBackupTask.ps1').ExitCode | Should Be 0
        $global:TaskState.ContainsKey('Daubert - n8n Weekly') | Should Be $false
        (Invoke-CmdScript 'Unregister-DaubertN8nBackupTask.ps1').ExitCode | Should Be 0
    }
    It 'Unregister: error de Task Scheduler = exit 6; UAC cancelado = exit 7' {
        $global:IsAdmin = $true; Invoke-Reg | Out-Null
        $global:RegFail = 'Acceso denegado'
        (Invoke-CmdScript 'Unregister-DaubertN8nBackupTask.ps1').ExitCode | Should Be 6
        $global:RegFail = $null; $global:IsAdmin = $false
        $global:ElevResult = [pscustomobject]@{ Started = $false; Cancelled = $true; ExitCode = $null; Error = 'cancelado' }
        (Invoke-CmdScript 'Unregister-DaubertN8nBackupTask.ps1' @{ RequestElevation = $true }).ExitCode | Should Be 7
    }
    It 'Unregister no toca las tareas de PostgreSQL ni ajenas' {
        foreach ($n in (Get-BackupManagedTaskNames)) { $global:TaskState[$n] = '<Task>DaubertHub-Managed-Backup</Task>' }
        $global:IsAdmin = $true; Invoke-Reg | Out-Null
        (Invoke-CmdScript 'Unregister-DaubertN8nBackupTask.ps1').ExitCode | Should Be 0
        foreach ($n in (Get-BackupManagedTaskNames)) { $global:TaskState.ContainsKey($n) | Should Be $true }
        @($global:UnregCalls).Count | Should Be 1
    }
    It 'ON_CHANGE no genera tarea: tras registrar solo existe la tarea Weekly' {
        $global:IsAdmin = $true; Invoke-Reg | Out-Null
        @($global:TaskState.Keys).Count | Should Be 1
        @($global:TaskState.Keys | Where-Object { $_ -match 'Change|OnChange' }).Count | Should Be 0
    }
    It 'los comandos usan el cargador central, sin Import-Module manual ni compilar código, y todas sus funciones están en la clausura' {
        foreach ($n in 'Register-DaubertN8nBackupTask.ps1', 'Unregister-DaubertN8nBackupTask.ps1') {
            $src = Get-Content -LiteralPath (Join-Path $commandsDir $n) -Raw
            $src | Should Match ([regex]::Escape("`$DaubertBackupModules = @('N8nTasks')"))
            $src | Should Match 'Import-DaubertBackupModules\.ps1'
            $src | Should Not Match 'Import-Module'
            $src | Should Not Match ('(?i)Add' + '-Type|Start-Process|RunAs')
        }
    }
}

# ===========================================================================
Describe 'Preflight n8n (Invoke-N8nPreflight; Node, scheduler y espacio inyectados)' {

    BeforeEach {
        $script:e = New-ProdEnv
        $script:now = [datetime]'2026-09-28T14:00:07'
        $script:cfgObj = (Read-N8nBackupConfigFile -Path $script:e.ConfigPath).Config
        $script:nodeProbe = $script:NodeOk
        $script:taskXml = (Get-N8nTaskPlan -Config $script:cfgObj -ScriptPath $script:EntryScript -ConfigPath $script:e.ConfigPath -UserId 'EQUIPO\usuario')[0].Xml
        $script:taskQuery = { param($Names) [pscustomobject]@{ TaskName = 'Daubert - n8n Weekly'; Exists = $true; State = 'Ready'; LastTaskResult = 0; Xml = $script:taskXml } }
        $script:space = { param($Path) [double](100GB) }
        New-Item -ItemType Directory -Path (Join-Path $script:e.BackupRoot 'N8N\WEEKLY') -Force | Out-Null
        $script:wk = Join-Path $script:e.BackupRoot 'N8N\WEEKLY\n8n_WEEKLY_20260927_040000.age'
        [System.IO.File]::WriteAllText($script:wk, 'contenido cifrado de prueba')
        New-BackupFileHash -Path $script:wk | Out-Null
    }
    AfterEach { Remove-Item -LiteralPath $script:e.Root -Recurse -Force -ErrorAction SilentlyContinue; Clear-FakeTools }

    function Invoke-Pf { param([hashtable]$Extra = @{})
        $p = @{ ConfigPath = $script:e.ConfigPath; NodeProbe = $script:nodeProbe; TaskQuery = $script:taskQuery; FreeSpaceProvider = $script:space; Now = $script:now }
        foreach ($k in $Extra.Keys) { $p[$k] = $Extra[$k] }
        Invoke-N8nPreflight @p
    }
    function Get-Chk { param($R, [string]$Name) @($R.Checks | Where-Object { $_.Name -eq $Name })[0] }

    It 'entorno sano: PASS, exit 0 y todos los checks PASS' {
        $r = Invoke-Pf
        $r.Overall | Should Be 'PASS'
        $r.ExitCode | Should Be 0
        @($r.Checks | Where-Object { $_.Status -ne 'PASS' }).Count | Should Be 0
        foreach ($n in 'PowerShell version', 'n8n config file', 'n8n config JSON', 'n8n config secrets', 'n8n config schema', 'n8n root', 'n8n database.sqlite', 'n8n config (archivo)', 'Node', 'Node version', 'node:sqlite', 'DatabaseSync', 'sqlite backup()', '7-Zip', 'age', 'Recipients file', 'Public recipient', 'No age private key', 'Backup root', 'Backup root writable', 'Staging', 'Log root', 'Lock root', 'Free space (backup root)', 'Scheduled Task (Weekly)', 'Last Weekly SHA-256', 'Last Weekly backup') {
            (Get-Chk $r $n) | Should Not BeNullOrEmpty
        }
    }
    It 'sin la tarea WEEKLY registrada: WARN (no FAIL), exit 1' {
        $script:taskQuery = { param($Names) [pscustomobject]@{ TaskName = 'Daubert - n8n Weekly'; Exists = $false; State = $null; LastTaskResult = $null; Xml = $null } }
        $r = Invoke-Pf
        $r.Overall | Should Be 'WARN'; $r.ExitCode | Should Be 1
        (Get-Chk $r 'Scheduled Task (Weekly)').Status | Should Be 'WARN'
        @($r.Checks | Where-Object { $_.Status -eq 'FAIL' }).Count | Should Be 0
    }
    It 'tarea con definición inesperada (horario distinto del config) o deshabilitada: WARN' {
        $other = $script:cfgObj.PSObject.Copy()
        $xml = $script:taskXml -replace '<Sunday />', '<Monday />'
        $script:taskQuery = { param($Names) [pscustomobject]@{ TaskName = 'Daubert - n8n Weekly'; Exists = $true; State = 'Ready'; LastTaskResult = 0; Xml = $xml } }.GetNewClosure()
        (Get-Chk (Invoke-Pf) 'Scheduled Task (Weekly)').Status | Should Be 'WARN'
        $script:taskQuery = { param($Names) [pscustomobject]@{ TaskName = 'Daubert - n8n Weekly'; Exists = $true; State = 'Disabled'; LastTaskResult = 0; Xml = $null } }
        (Get-Chk (Invoke-Pf) 'Scheduled Task (Weekly)').Status | Should Be 'WARN'
    }
    It 'sin ningún backup todavía: WARN' {
        Remove-Item -LiteralPath (Join-Path $script:e.BackupRoot 'N8N') -Recurse -Force
        $r = Invoke-Pf
        $r.Overall | Should Be 'WARN'
        (Get-Chk $r 'Last valid backup').Status | Should Be 'WARN'
    }
    It 'último backup: hash correcto = PASS; hash incorrecto = FAIL (exit 2)' {
        (Get-Chk (Invoke-Pf) 'Last Weekly SHA-256').Status | Should Be 'PASS'
        [System.IO.File]::WriteAllText($script:wk, 'contenido ALTERADO')
        $r = Invoke-Pf
        (Get-Chk $r 'Last Weekly SHA-256').Status | Should Be 'FAIL'
        $r.Overall | Should Be 'FAIL'; $r.ExitCode | Should Be 2
    }
    It 'sidecar ausente: WARN; -SkipHashVerify: WARN sin verificar' {
        Remove-Item -LiteralPath "$($script:wk).sha256" -Force
        (Get-Chk (Invoke-Pf) 'Last Weekly backup').Status | Should Be 'WARN'
        New-BackupFileHash -Path $script:wk | Out-Null
        (Get-Chk (Invoke-Pf @{ SkipHashVerify = $true }) 'Last Weekly SHA-256').Status | Should Be 'WARN'
    }
    It 'backup Weekly demasiado antiguo: WARN' {
        (Get-Chk (Invoke-Pf @{ Now = [datetime]'2026-11-01T00:00:00' }) 'Last Weekly backup').Status | Should Be 'WARN'
    }
    It 'database.sqlite ausente: FAIL' {
        Remove-Item -LiteralPath (Join-Path $script:e.N8nRoot 'database.sqlite') -Force
        $r = Invoke-Pf
        (Get-Chk $r 'n8n database.sqlite').Status | Should Be 'FAIL'
        $r.ExitCode | Should Be 2
    }
    It 'archivo config de n8n ausente: FAIL (obligatorio)' {
        Remove-Item -LiteralPath (Join-Path $script:e.N8nRoot 'config') -Force
        $r = Invoke-Pf
        (Get-Chk $r 'n8n config (archivo)').Status | Should Be 'FAIL'
        $r.ExitCode | Should Be 2
    }
    It 'n8nRoot inexistente: FAIL' {
        Remove-Item -LiteralPath $script:e.N8nRoot -Recurse -Force
        (Get-Chk (Invoke-Pf) 'n8n root').Status | Should Be 'FAIL'
    }
    It 'n8n-config.json inexistente / JSON roto / con secretos / esquema inválido: FAIL' {
        (Invoke-N8nPreflight -ConfigPath (Join-Path $script:e.Root 'no.json')).ExitCode | Should Be 2
        $bad = Join-Path $script:e.Root 'roto.json'; [System.IO.File]::WriteAllText($bad, '{ no es json')
        (Invoke-Pf @{ ConfigPath = $bad }).ExitCode | Should Be 2
        $sec = Join-Path $script:e.Root 'secretos.json'
        $o = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json; $o | Add-Member -NotePropertyName encryptionKey -NotePropertyValue 'VALOR_SECRETO_ZZZ'
        [System.IO.File]::WriteAllText($sec, ($o | ConvertTo-Json -Depth 6))
        $r = Invoke-Pf @{ ConfigPath = $sec }
        (Get-Chk $r 'n8n config secrets').Status | Should Be 'FAIL'
        (($r.Checks | ForEach-Object { $_.Detail }) -join ' ') | Should Not Match 'VALOR_SECRETO_ZZZ'
        $inv = Join-Path $script:e.Root 'invalido.json'
        $o2 = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json; $o2.PSObject.Properties.Remove('agePath')
        [System.IO.File]::WriteAllText($inv, ($o2 | ConvertTo-Json -Depth 6))
        (Get-Chk (Invoke-Pf @{ ConfigPath = $inv }) 'n8n config schema').Status | Should Be 'FAIL'
    }
    It 'clave privada age en una ruta administrada: FAIL, y el contenido no se imprime' {
        [System.IO.File]::WriteAllText((Join-Path $script:e.LogRoot 'nota.txt'), $script:PrivateKeyText)
        $r = Invoke-Pf
        (Get-Chk $r 'No age private key').Status | Should Be 'FAIL'
        $r.ExitCode | Should Be 2
        (($r.Checks | ForEach-Object { $_.Detail }) -join ' ') | Should Not Match 'AGE-SECRET-KEY-1[A-Z0-9]{10}'
    }
    It 'destinatarios: archivo con clave privada o sin clave pública: FAIL' {
        [System.IO.File]::WriteAllText($script:e.Paths.RecipientsFilePath, $script:PrivateKeyText)
        (Get-Chk (Invoke-Pf) 'Public recipient').Status | Should Be 'FAIL'
        [System.IO.File]::WriteAllText($script:e.Paths.RecipientsFilePath, '# vacío')
        (Get-Chk (Invoke-Pf) 'Public recipient').Status | Should Be 'FAIL'
    }
    It 'Node sin node:sqlite / sin backup() / sin DatabaseSync / versión vieja: FAIL' {
        $script:nodeProbe = { param($p) [pscustomobject]@{ Supported = $false; Version = '20.1.0'; HasSqlite = $false; HasDatabaseSync = $false; HasBackup = $false; VersionOk = $false; Reason = 'Este Node no ofrece el módulo node:sqlite.' } }
        $r = Invoke-Pf
        (Get-Chk $r 'node:sqlite').Status | Should Be 'FAIL'
        (Get-Chk $r 'Node version').Status | Should Be 'FAIL'
        $script:nodeProbe = { param($p) [pscustomobject]@{ Supported = $false; Version = '24.0.0'; HasSqlite = $true; HasDatabaseSync = $true; HasBackup = $false; VersionOk = $true; Reason = 'sin backup()' } }
        $r = Invoke-Pf
        (Get-Chk $r 'sqlite backup()').Status | Should Be 'FAIL'
        (Get-Chk $r 'DatabaseSync').Status | Should Be 'PASS'
        $r.ExitCode | Should Be 2
    }
    It 'node.exe inexistente: FAIL' {
        Remove-Item -LiteralPath $script:e.NodePath -Force
        (Get-Chk (Invoke-Pf) 'Node').Status | Should Be 'FAIL'
    }
    It '7-Zip o age inexistentes: FAIL' {
        Remove-Item -LiteralPath $script:e.SevenZipPath, $script:e.AgePath -Force
        $r = Invoke-Pf
        (Get-Chk $r '7-Zip').Status | Should Be 'FAIL'; (Get-Chk $r 'age').Status | Should Be 'FAIL'
    }
    It 'espacio libre bajo: WARN; crítico: FAIL' {
        $script:space = { param($Path) [double](3GB) }
        (Get-Chk (Invoke-Pf) 'Free space (backup root)').Status | Should Be 'WARN'
        $script:space = { param($Path) [double](0.2GB) }
        (Get-Chk (Invoke-Pf) 'Free space (backup root)').Status | Should Be 'FAIL'
    }
    It 'backupRoot no escribible/inexistente: FAIL' {
        $cfg = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
        $cfg.backupRoot = (Join-Path $script:e.Root 'no-existe\x')
        $p = Join-Path $script:e.Root 'otro.json'; [System.IO.File]::WriteAllText($p, ($cfg | ConvertTo-Json -Depth 6))
        (Get-Chk (Invoke-Pf @{ ConfigPath = $p }) 'Backup root').Status | Should Be 'FAIL'
    }
    It 'staging dentro de n8nRoot: FAIL' {
        $cfg = Get-Content -LiteralPath $script:e.ConfigPath -Raw | ConvertFrom-Json
        $cfg.stagingRoot = (Join-Path $script:e.N8nRoot 'staging-mal')
        $p = Join-Path $script:e.Root 'otro2.json'; [System.IO.File]::WriteAllText($p, ($cfg | ConvertTo-Json -Depth 6))
        (Invoke-Pf @{ ConfigPath = $p }).ExitCode | Should Be 2
    }
    It 'residuos de staging de una ejecución interrumpida: WARN' {
        New-Item -ItemType Directory -Path (Join-Path $script:e.N8nStaging ([guid]::NewGuid().ToString('N'))) -Force | Out-Null
        (Get-Chk (Invoke-Pf) 'Staging residue').Status | Should Be 'WARN'
    }
    It 'NO lee .n8n\config: con el archivo bloqueado en exclusiva el preflight sigue funcionando y no filtra su contenido' {
        $fs = [System.IO.File]::Open((Join-Path $script:e.N8nRoot 'config'), 'Open', 'ReadWrite', 'None')
        try {
            $r = Invoke-Pf
            (Get-Chk $r 'n8n config (archivo)').Status | Should Be 'PASS'
            $r.Overall | Should Be 'PASS'
            (($r.Checks | ForEach-Object { $_.Detail }) -join ' ') | Should Not Match $global:N8nMarker
        }
        finally { $fs.Dispose() }
    }
    It 'NO ejecuta snapshot, backup ni restore, y no modifica la instalación de n8n (sondeo real con Invoke-NodeProcess mockeado)' {
        Mock Invoke-NodeProcess {
            if ($ArgumentList -contains '--version') { [pscustomobject]@{ ExitCode = 0; StdOut = 'v24.19.0'; StdErr = '' } }
            else { [pscustomobject]@{ ExitCode = 0; StdOut = '{"sqlite":true,"databaseSync":true,"backup":true}'; StdErr = '' } }
        } -ModuleName BackupN8nSqlite
        $before = Get-N8nTreeFingerprint -Path $script:e.N8nRoot
        $r = Invoke-N8nPreflight -ConfigPath $script:e.ConfigPath -TaskQuery $script:taskQuery -FreeSpaceProvider $script:space -Now $script:now
        $r.Overall | Should Be 'PASS'
        Assert-MockCalled Invoke-NodeProcess -ModuleName BackupN8nSqlite -Times 0 -ParameterFilter { ($ArgumentList -join ' ') -match 'n8n-sqlite-snapshot|--source|--dest' }
        (Get-N8nTreeFingerprint -Path $script:e.N8nRoot) | Should Be $before
        @(Get-ChildItem -LiteralPath $script:e.StagingRoot -Recurse -Force -ErrorAction SilentlyContinue).Count | Should Be 0
    }
    It 'el reporte legible incluye OVERALL y nunca secretos' {
        $text = (Format-PreflightReport -Result (Invoke-Pf)) -join "`n"
        $text | Should Match 'OVERALL: PASS'
        $text | Should Not Match $global:N8nMarker
    }
    It 'el código del preflight nunca lee config ni abre la SQLite' {
        foreach ($line in (Get-Content -LiteralPath (Join-Path $backupRoot 'lib\BackupN8nPreflight.psm1'))) {
            if ($line -match '^\s*#') { continue }
            ($line -match '(Get-Content|ReadAllText|ReadAllBytes|Select-String|DatabaseSync|Copy-Item)' -and $line -match "'config'|database\.sqlite") | Should Be $false
        }
    }
    It 'Test-DaubertN8nBackupEnvironment.ps1: sin config devuelve exit 2 (proceso nuevo, recarga real)' {
        $bad = Join-Path ([System.IO.Path]::GetTempPath()) ('no-existe-' + [guid]::NewGuid().ToString('N') + '\n8n-config.json')
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $commandsDir 'Test-DaubertN8nBackupEnvironment.ps1') -ConfigPath $bad 2>&1 | Out-Null
        $LASTEXITCODE | Should Be 2
    }
}

# ===========================================================================
Describe 'Instalador n8n (Invoke-N8nInstall; prompter, detección y Node simulados)' {

    BeforeEach {
        $script:e = New-ProdEnv
        Remove-Item -LiteralPath $script:e.ConfigPath -Force
        $script:paths = New-InstallPaths $script:e
        $e2 = $script:e
        $script:det = { @{ N8nRoot = $e2.N8nRoot; Node = $e2.NodePath; N8nPackage = $e2.N8nPackagePath; SevenZip = $e2.SevenZipPath; Age = $e2.AgePath; Dropbox = @() } }.GetNewClosure()
        $script:ask = @{ 'destino de backups' = $script:e.BackupRoot }
        Mock Invoke-NodeProcess { [pscustomobject]@{ ExitCode = 0; StdOut = ''; StdErr = '' } } -ModuleName BackupN8nSqlite
    }
    AfterEach { Remove-Item -LiteralPath $script:e.Root -Recurse -Force -ErrorAction SilentlyContinue; Clear-FakeTools }

    function Invoke-Inst { param([string]$Mode = 'Auto', [hashtable]$Ask = $script:ask, [hashtable]$Confirm = @{}, [scriptblock]$Detector = $script:det, [scriptblock]$Probe = $script:NodeOk, [scriptblock]$Register, [string]$Choose = 'Cancelar')
        $pr = New-TestPrompter -Ask $Ask -Confirm $Confirm -Choose $Choose
        $p = @{ ConfigPath = $script:e.ConfigPath; Paths = $script:paths; Prompter = $pr; Detector = $Detector; NodeProbe = $Probe; Mode = $Mode }
        if ($Register) { $p.RegisterTasks = $Register }
        Invoke-N8nInstall @p
    }

    It 'instalación nueva: escribe un n8n-config.json válido, sin secretos, con retención y schedule por defecto' {
        $r = Invoke-Inst
        $r.Action | Should Be 'Installed'
        $r.ConfigChanged | Should Be $true
        $cfg = Read-N8nBackupConfigFile -Path $script:e.ConfigPath
        $cfg.IsValid | Should Be $true
        $cfg.Config.n8nRoot | Should Be $script:e.N8nRoot
        $cfg.Config.schedules.Weekly.dayOfWeek | Should Be 'Sunday'
        $cfg.Config.retention.OnChange.value | Should Be 90
        (Get-Content -LiteralPath $script:e.ConfigPath -Raw) | Should Not Match '(?i)encryption|password|token|credential|AGE-SECRET'
    }
    It 'es idempotente: Repair/Reconfigure con lo mismo no reescribe el archivo (NoChange)' {
        Invoke-Inst | Out-Null
        $h = (Get-FileHash -LiteralPath $script:e.ConfigPath).Hash
        $t = (Get-Item -LiteralPath $script:e.ConfigPath).LastWriteTimeUtc
        (Invoke-Inst -Mode Repair).Action | Should Be 'NoChange'
        (Invoke-Inst -Mode Reconfigure -Confirm @{ 'rutas locales' = $true }).Action | Should Be 'NoChange'
        (Get-FileHash -LiteralPath $script:e.ConfigPath).Hash | Should Be $h
        (Get-Item -LiteralPath $script:e.ConfigPath).LastWriteTimeUtc | Should Be $t
        @(Get-ChildItem -LiteralPath (Split-Path -Parent $script:e.ConfigPath) -Filter '*.tmp').Count | Should Be 0
    }
    It 'Auto con config existente pregunta: Validar no modifica; Cancelar no modifica' {
        Invoke-Inst | Out-Null
        $h = (Get-FileHash -LiteralPath $script:e.ConfigPath).Hash
        (Invoke-Inst -Choose 'Validar').Action | Should Be 'Validated'
        (Invoke-Inst -Choose 'Cancelar').Action | Should Be 'Cancelled'
        (Get-FileHash -LiteralPath $script:e.ConfigPath).Hash | Should Be $h
    }
    It 'NO lee el contenido de .n8n\config: funciona con el archivo bloqueado en exclusiva y jamás lo imprime' {
        $fs = [System.IO.File]::Open((Join-Path $script:e.N8nRoot 'config'), 'Open', 'ReadWrite', 'None')
        try {
            (Invoke-Inst).Action | Should Be 'Installed'
            (Invoke-Inst -Mode Validate).Action | Should Be 'Validated'
            (Invoke-Inst -Mode Repair).Action | Should Be 'NoChange'
        }
        finally { $fs.Dispose() }
        ($global:Said -join "`n") | Should Not Match $global:N8nMarker
        (Get-Content -LiteralPath $script:e.ConfigPath -Raw) | Should Not Match $global:N8nMarker
    }
    It 'el código del instalador nunca lee ni copia el archivo config de n8n' {
        foreach ($f in 'lib\BackupN8nInstall.psm1', 'commands\Install-DaubertN8nBackup.ps1') {
            foreach ($line in (Get-Content -LiteralPath (Join-Path $backupRoot $f))) {
                if ($line -match '^\s*#') { continue }
                ($line -match '(Get-Content|ReadAllText|ReadAllBytes|Select-String|Copy-Item)' -and $line -match "'config'|n8nRoot|N8nRoot") | Should Be $false
            }
        }
    }
    It 'no ejecuta backup ni snapshot: Invoke-NodeProcess nunca recibe el helper y no se crea nada en backupRoot' {
        (Invoke-Inst).Action | Should Be 'Installed'
        Assert-MockCalled Invoke-NodeProcess -ModuleName BackupN8nSqlite -Times 0 -ParameterFilter { ($ArgumentList -join ' ') -match 'n8n-sqlite-snapshot|--source' }
        @(Get-ChildItem -LiteralPath $script:e.BackupRoot -Recurse -Force -ErrorAction SilentlyContinue).Count | Should Be 0
    }
    It 'no modifica la instalación de n8n' {
        $before = Get-N8nTreeFingerprint -Path $script:e.N8nRoot
        Invoke-Inst | Out-Null
        (Get-N8nTreeFingerprint -Path $script:e.N8nRoot) | Should Be $before
    }
    It 'registrar WEEKLY: por defecto NO (no se invoca el registro)' {
        $global:RegInvoked = 0
        $r = Invoke-Inst -Register { $global:RegInvoked++; $true }
        $r.TasksRegistered | Should Be $false
        $global:RegInvoked | Should Be 0
        ($global:Said -join "`n") | Should Match 'NO registrada'
    }
    It 'registrar WEEKLY con confirmación explícita: delega en el registro; si el registro falla no se informa éxito' {
        $global:RegInvoked = 0
        (Invoke-Inst -Confirm @{ 'registrar' = $true } -Register { $global:RegInvoked++; $true }).TasksRegistered | Should Be $true
        $global:RegInvoked | Should Be 1
        Remove-Item -LiteralPath $script:e.ConfigPath -Force
        (Invoke-Inst -Confirm @{ 'registrar' = $true } -Register { $false }).TasksRegistered | Should Be $false
    }
    It 'Node sin node:sqlite: MissingPrerequisites, sin escribir config' {
        $probe = { param($p) [pscustomobject]@{ Supported = $false; Version = '20.0.0'; HasSqlite = $false; HasDatabaseSync = $false; HasBackup = $false; VersionOk = $false; Reason = 'Este Node (20.0.0) no ofrece el módulo node:sqlite.' } }
        $r = Invoke-Inst -Probe $probe
        $r.Action | Should Be 'MissingPrerequisites'
        Test-Path -LiteralPath $script:e.ConfigPath | Should Be $false
        ($global:Said -join "`n") | Should Match 'node:sqlite'
    }
    It 'Node sin backup(): MissingPrerequisites con el motivo' {
        $probe = { param($p) [pscustomobject]@{ Supported = $false; Version = '24.0.0'; HasSqlite = $true; HasDatabaseSync = $true; HasBackup = $false; VersionOk = $true; Reason = 'node:sqlite no expone backup().' } }
        (Invoke-Inst -Probe $probe).Action | Should Be 'MissingPrerequisites'
        ($global:Said -join "`n") | Should Match 'backup\(\)'
        Test-Path -LiteralPath $script:e.ConfigPath | Should Be $false
    }
    It 'falta database.sqlite o el archivo config en la carpeta de n8n: MissingPrerequisites' {
        Remove-Item -LiteralPath (Join-Path $script:e.N8nRoot 'database.sqlite') -Force
        (Invoke-Inst).Action | Should Be 'MissingPrerequisites'
        Set-Content -LiteralPath (Join-Path $script:e.N8nRoot 'database.sqlite') -Value 'x'
        Remove-Item -LiteralPath (Join-Path $script:e.N8nRoot 'config') -Force
        (Invoke-Inst).Action | Should Be 'MissingPrerequisites'
        Test-Path -LiteralPath $script:e.ConfigPath | Should Be $false
    }
    It 'rutas manuales: acepta la carpeta de n8n indicada por el usuario cuando la detección no la encuentra' {
        $det0 = { @{ N8nRoot = $null; Node = $null; N8nPackage = $null; SevenZip = $null; Age = $null; Dropbox = @() } }
        $ask = @{ 'Carpeta de datos de n8n' = $script:e.N8nRoot; 'node.exe' = $script:e.NodePath; '7z.exe' = $script:e.SevenZipPath; 'age.exe' = $script:e.AgePath; 'destino de backups' = $script:e.BackupRoot }
        $r = Invoke-Inst -Detector $det0 -Ask $ask
        $r.Action | Should Be 'Installed'
        (Read-N8nBackupConfigFile -Path $script:e.ConfigPath).Config.nodePath | Should Be $script:e.NodePath
    }
    It 'n8nPackagePath opcional: sin detección se omite del config' {
        $e2 = $script:e
        $det0 = { @{ N8nRoot = $e2.N8nRoot; Node = $e2.NodePath; N8nPackage = $null; SevenZip = $e2.SevenZipPath; Age = $e2.AgePath; Dropbox = @() } }.GetNewClosure()
        (Invoke-Inst -Detector $det0).Action | Should Be 'Installed'
        (Get-Content -LiteralPath $script:e.ConfigPath -Raw) | Should Not Match 'n8nPackagePath'
    }
    It 'archivo de destinatarios con clave privada: Failed y no se escribe el config' {
        [System.IO.File]::WriteAllText($script:e.Paths.RecipientsFilePath, $script:PrivateKeyText)
        (Invoke-Inst).Action | Should Be 'Failed'
        Test-Path -LiteralPath $script:e.ConfigPath | Should Be $false
        ($global:Said -join "`n") | Should Not Match 'AGE-SECRET-KEY-1[A-Z0-9]{10}'
    }
    It 'clave privada pegada en el prompt de destinatario: se rechaza y no se guarda' {
        Remove-Item -LiteralPath $script:e.Paths.RecipientsFilePath -Force
        $ask = @{ 'destino de backups' = $script:e.BackupRoot; 'Clave' = $script:PrivateKeyText }
        (Invoke-Inst -Ask $ask).Action | Should Be 'MissingPrerequisites'
        Test-Path -LiteralPath $script:e.Paths.RecipientsFilePath | Should Be $false
        Test-Path -LiteralPath $script:e.ConfigPath | Should Be $false
    }
    It 'clave pública pegada en el prompt: se guarda el archivo de destinatarios (solo pública)' {
        Remove-Item -LiteralPath $script:e.Paths.RecipientsFilePath -Force
        $pub = 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123'
        $r = Invoke-Inst -Ask @{ 'destino de backups' = $script:e.BackupRoot; 'Clave' = $pub }
        $r.RecipientsWritten | Should Be $true
        (Get-Content -LiteralPath $script:e.Paths.RecipientsFilePath -Raw) | Should Match $pub
    }
    It 'clave privada age dentro de una ruta administrada: Failed y no se escribe el config' {
        [System.IO.File]::WriteAllText((Join-Path $script:e.LogRoot 'pegado.txt'), $script:PrivateKeyText)
        (Invoke-Inst).Action | Should Be 'Failed'
        Test-Path -LiteralPath $script:e.ConfigPath | Should Be $false
    }
    It 'stagingRoot dentro de la carpeta de n8n: MissingPrerequisites' {
        $script:paths.StagingRoot = Join-Path $script:e.N8nRoot 'staging'
        (Invoke-Inst).Action | Should Be 'MissingPrerequisites'
        Test-Path -LiteralPath $script:e.ConfigPath | Should Be $false
    }
    It 'reutiliza 7-Zip/age/destinatarios/destino del config de PostgreSQL SOLO como lectura (no lo modifica)' {
        $pgPath = Join-Path (Split-Path -Parent $script:e.ConfigPath) 'config.json'
        $pg = New-LocalBackupConfigObject -PostgresBin (Join-Path $script:e.Root 'pg') -SevenZipPath $script:e.SevenZipPath -AgePath $script:e.AgePath -RecipientsFilePath $script:e.Paths.RecipientsFilePath `
            -PgPassFile (Join-Path $script:e.Root 'secrets\pgpass.conf') -BackupRoot $script:e.BackupRoot -StagingRoot $script:e.StagingRoot -LogRoot $script:e.LogRoot -LockRoot $script:e.LockRoot
        Write-LocalBackupConfig -Path $pgPath -Config $pg | Out-Null
        $h = (Get-FileHash -LiteralPath $pgPath).Hash
        $e2 = $script:e
        $det0 = { @{ N8nRoot = $e2.N8nRoot; Node = $e2.NodePath; N8nPackage = $null; SevenZip = $null; Age = $null; Dropbox = @() } }.GetNewClosure()
        $r = Invoke-Inst -Detector $det0 -Ask @{}
        $r.Action | Should Be 'Installed'
        $c = (Read-N8nBackupConfigFile -Path $script:e.ConfigPath).Config
        $c.sevenZipPath | Should Be $script:e.SevenZipPath
        $c.backupRoot | Should Be $script:e.BackupRoot
        (Get-FileHash -LiteralPath $pgPath).Hash | Should Be $h
        (Test-Path -LiteralPath $script:e.ConfigPath) | Should Be $true
        $script:e.ConfigPath | Should Not Be $pgPath
    }
    It 'el instalador no escribe en el config de PostgreSQL aunque exista ni toca sus tareas' {
        foreach ($line in (Get-Content -LiteralPath (Join-Path $backupRoot 'lib\BackupN8nInstall.psm1'))) {
            if ($line -match '^\s*#') { continue }
            ($line -match 'Write-LocalBackupConfig|New-PgPassFile|Register-BackupTasks|Unregister-BackupTasks') | Should Be $false
        }
    }
    It 'carpeta de backups inexistente: pregunta y la crea solo si se confirma' {
        $nuevo = Join-Path $script:e.Root 'destino-nuevo'
        $r = Invoke-Inst -Ask @{ 'destino de backups' = $nuevo } -Confirm @{ 'Crearla' = $true }
        $r.Action | Should Be 'Installed'
        Test-Path -LiteralPath $nuevo -PathType Container | Should Be $true
    }
    It 'Get-N8nInstallFieldProblem valida los campos' {
        Get-N8nInstallFieldProblem -Name 'n8nRoot' -Value $script:e.N8nRoot | Should BeNullOrEmpty
        Get-N8nInstallFieldProblem -Name 'n8nRoot' -Value 'relativa' | Should Not BeNullOrEmpty
        Get-N8nInstallFieldProblem -Name 'n8nPackagePath' -Value '' | Should BeNullOrEmpty
        Get-N8nInstallFieldProblem -Name 'n8nPackagePath' -Value $script:e.N8nRoot | Should Not BeNullOrEmpty
        Get-N8nInstallFieldProblem -Name 'nodePath' -Value $script:e.NodePath -NodeProbe $script:NodeOk | Should BeNullOrEmpty
    }
    It 'el comando: cargador central, elevación solo cuando hace falta (sonda real), sin UAC propio ni parámetros secretos' {
        $src = Get-Content -LiteralPath (Join-Path $commandsDir 'Install-DaubertN8nBackup.ps1') -Raw
        $src | Should Match ([regex]::Escape("`$DaubertBackupModules = @('N8nInstall', 'N8nTasks')"))
        $src | Should Not Match 'Import-Module'
        $src | Should Not Match ('(?i)Add' + '-Type|Start-Process|RunAs|ConvertFrom-SecureString|Read-Host[^\r\n]*AsSecureString')
        $src | Should Match "Get-ElevationRequirement -Operation 'WriteProgramData'"
        $src | Should Match 'Invoke-ElevationGate'
        $src | Should Match 'Register-DaubertN8nBackupTask\.ps1'
        ((Get-Command (Join-Path $commandsDir 'Install-DaubertN8nBackup.ps1')).Parameters.Keys | Where-Object { $_ -match '(?i)private|identity|secret|token|password' }) | Should BeNullOrEmpty
    }
    It 'UAC solo cuando hace falta: escribir en una carpeta escribible no la requiere; en una no escribible sí' {
        (Get-ElevationRequirement -Operation 'WriteProgramData' -Path $script:e.Paths.ConfigRoot).Required | Should Be $false
        Mock Test-PathWritableByCurrentUser { $false } -ModuleName BackupElevation
        (Get-ElevationRequirement -Operation 'WriteProgramData' -Path $script:e.Paths.ConfigRoot).Required | Should Be $true
    }
    It 'Install -Mode Cancel termina con exit 0 sin pedir elevación ni escribir' {
        $env:DAUBERT_BACKUP_NO_RELOAD = '1'
        try {
            $r = Invoke-CmdScript 'Install-DaubertN8nBackup.ps1' @{ ConfigPath = $script:e.ConfigPath; Mode = 'Cancel'; ProgramDataRoot = (Join-Path $script:e.Root 'programdata'); LocalAppDataRoot = (Join-Path $script:e.Root 'localappdata') }
        }
        finally { Remove-Item Env:\DAUBERT_BACKUP_NO_RELOAD -ErrorAction SilentlyContinue }
        $r.ExitCode | Should Be 0
        Test-Path -LiteralPath $script:e.ConfigPath | Should Be $false
    }
}

# ===========================================================================
Describe 'Separación con PostgreSQL y cargador de módulos' {

    $loader = Join-Path $backupRoot 'lib\Import-DaubertBackupModules.ps1'

    It 'la clausura de los comandos n8n incluye todas sus dependencias y la de Pipeline (PostgreSQL) NO cambia' {
        (& { . $loader; Resolve-DaubertBackupModuleClosure -Name @('Pipeline') }) | Should Be @('Config', 'LocalConfig', 'Naming', 'Logging', 'Lock', 'Hash', 'PgTools', 'Packaging', 'Encryption', 'Retention', 'Publish', 'Pipeline')
        (& { . $loader; Resolve-DaubertBackupModuleClosure -Name @('Tasks') }) | Should Be @('Elevation', 'Config', 'LocalConfig', 'Tasks')
        $t = & { . $loader; Resolve-DaubertBackupModuleClosure -Name @('N8nTasks') }
        ($t -contains 'Elevation') | Should Be $true
        ($t -contains 'Tasks') | Should Be $true
        ($t -contains 'Pipeline') | Should Be $false
        $i = & { . $loader; Resolve-DaubertBackupModuleClosure -Name @('N8nInstall') }
        ($i -contains 'Pipeline') | Should Be $false
    }
    It 'todas las funciones Daubert que invocan los comandos n8n están exportadas por la clausura de sus módulos' {
        $expected = [ordered]@{
            'Install-DaubertN8nBackup.ps1'           = @('N8nInstall', 'N8nTasks')
            'Test-DaubertN8nBackupEnvironment.ps1'   = @('N8nPreflight')
            'Register-DaubertN8nBackupTask.ps1'      = @('N8nTasks')
            'Unregister-DaubertN8nBackupTask.ps1'    = @('N8nTasks')
            'Start-DaubertN8nBackup.ps1'             = @('N8nPipeline')
        }
        $graph = & { . $loader; $DaubertBackupModuleGraph }
        $allExports = @{}
        foreach ($k in $graph.Keys) {
            foreach ($fn in (Get-Module ("Backup$k") | Select-Object -First 1).ExportedFunctions.Keys) { $allExports[$fn] = $k }
        }
        foreach ($name in $expected.Keys) {
            $closure = & { . $loader; Resolve-DaubertBackupModuleClosure -Name $expected[$name] }
            $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $commandsDir $name), [ref]$null, [ref]$null)
            $used = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Select-Object -Unique
            $missing = @($used | Where-Object { $allExports.ContainsKey($_) -and ($closure -notcontains $allExports[$_]) })
            $missing | Should BeNullOrEmpty
        }
    }
    It 'los nuevos comandos cargan sus módulos en un proceso nuevo (rutas de import correctas)' {
        $bad = Join-Path ([System.IO.Path]::GetTempPath()) ('no-existe-' + [guid]::NewGuid().ToString('N') + '.json')
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $commandsDir 'Register-DaubertN8nBackupTask.ps1') -ConfigPath $bad 2>&1 | Out-Null
        $LASTEXITCODE | Should Be 3
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $commandsDir 'Install-DaubertN8nBackup.ps1') -ConfigPath $bad -Mode Cancel 2>&1 | Out-Null
        $LASTEXITCODE | Should Be 0
    }
    It 'los archivos de PostgreSQL no fueron modificados por esta fase (contenido sin referencias a n8n)' {
        foreach ($f in 'BackupTasks.psm1', 'BackupPipeline.psm1', 'BackupPreflight.psm1', 'BackupInstall.psm1', 'BackupLocalConfig.psm1', 'BackupConfig.psm1') {
            (Get-Content -LiteralPath (Join-Path $backupRoot "lib\$f") -Raw) | Should Not Match '(?i)\bn8n\b'
        }
        (Get-Content -LiteralPath (Join-Path $commandsDir 'Start-DaubertPostgresBackup.ps1') -Raw) | Should Not Match '(?i)\bn8n\b'
    }
    It 'la documentación operativa de n8n existe y cubre WEEKLY, ON_CHANGE, layout, config separado, restore, plaintext, scheduler, preflight y el bug conocido' {
        $doc = Join-Path (Split-Path -Parent (Split-Path -Parent $backupRoot)) 'docs\operations\n8n-backup-automation.md'
        Test-Path -LiteralPath $doc | Should Be $true
        $t = Get-Content -LiteralPath $doc -Raw
        foreach ($w in 'Weekly', 'OnChange', 'n8n-config\.json', 'Daubert - n8n Weekly', 'Test-DaubertN8nBackupEnvironment', 'communityNodes', 'texto plano', 'S4U', 'IgnoreNew', 'PT4H', 'Layout', 'restaurar') { $t | Should Match $w }
        $t | Should Match 'nodes\\` \*\*sigue incluido'
    }
}
