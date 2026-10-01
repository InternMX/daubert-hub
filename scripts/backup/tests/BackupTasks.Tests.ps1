#Requires -Version 5.1
<#
    Pruebas de Task Scheduler (BackupTasks.psm1). TODO está mockeado: los tres
    wrappers que tocan el sistema (Get-/Register-/Unregister-...) se
    sustituyen por simulaciones; ningún test registra, modifica ni consulta
    tareas reales.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupTasks.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupConfig.psm1') -Force
Import-Module (Join-Path $moduleRoot 'lib\BackupLocalConfig.psm1') -Force
Import-Module (Join-Path $moduleRoot 'lib\BackupTasks.psm1') -Force

$global:TestScript = 'C:\Repos con espacios\daubert-hub\scripts\backup\commands\Start-DaubertPostgresBackup.ps1'
$global:TestConfig = 'C:\ProgramData\DaubertHub\Backup\config.json'
$global:TestPs = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$global:TestUser = 'PC-TEST\operador'

function Get-XmlDoc { param([string]$Xml) $d = New-Object System.Xml.XmlDocument; $d.LoadXml($Xml); $d }
function New-XmlNs { param($Doc) $ns = New-Object System.Xml.XmlNamespaceManager($Doc.NameTable); $ns.AddNamespace('t', 'http://schemas.microsoft.com/windows/2004/02/mit/task'); ,$ns }

function New-TaskXmlFor {
    param([string]$Tier, $Schedule = $null, [string]$LogonType = 'S4U', [string]$ConfigPath = $global:TestConfig, [string]$ScriptPath = $global:TestScript)
    if ($null -eq $Schedule) { $Schedule = Get-DefaultSchedule -Tier $Tier }
    New-BackupTaskXml -Tier $Tier -Schedule $Schedule -ScriptPath $ScriptPath -ConfigPath $ConfigPath -PowerShellPath $global:TestPs -LogonType $LogonType -UserId $global:TestUser
}

Describe 'BackupTasks - generación de XML (funciones puras)' {

    It 'las únicas tareas administradas son las tres con nombres exactos' {
        $names = Get-BackupManagedTaskNames
        $names.Count | Should Be 3
        ($names -contains 'Daubert - PostgreSQL Frequent') | Should Be $true
        ($names -contains 'Daubert - PostgreSQL Daily') | Should Be $true
        ($names -contains 'Daubert - PostgreSQL Monthly') | Should Be $true
    }

    foreach ($tier in 'Frequent', 'Daily', 'Monthly') {
        It "$tier : el XML está bien formado y usa el esquema de Task Scheduler 1.2" {
            $doc = Get-XmlDoc (New-TaskXmlFor -Tier $tier)
            $doc.DocumentElement.LocalName | Should Be 'Task'
            $doc.DocumentElement.GetAttribute('version') | Should Be '1.2'
        }

        It "$tier : MultipleInstancesPolicy = IgnoreNew" {
            $doc = Get-XmlDoc (New-TaskXmlFor -Tier $tier)
            $ns = New-XmlNs $doc
            $doc.SelectSingleNode('//t:Settings/t:MultipleInstancesPolicy', $ns).InnerText | Should Be 'IgnoreNew'
        }

        It "$tier : llama al entrypoint canónico con -Tier y -ConfigPath" {
            $doc = Get-XmlDoc (New-TaskXmlFor -Tier $tier)
            $ns = New-XmlNs $doc
            $taskArgs = $doc.SelectSingleNode('//t:Exec/t:Arguments', $ns).InnerText
            $taskArgs | Should Match 'Start-DaubertPostgresBackup\.ps1'
            $taskArgs | Should Match "-Tier $tier"
            $taskArgs | Should Match '-ConfigPath "C:\\ProgramData\\DaubertHub\\Backup\\config\.json"'
            $taskArgs | Should Match '-File "C:\\Repos con espacios\\'
            $doc.SelectSingleNode('//t:Exec/t:Command', $ns).InnerText | Should Be $global:TestPs
        }

        It "$tier : ningún secreto en los argumentos" {
            $doc = Get-XmlDoc (New-TaskXmlFor -Tier $tier)
            $ns = New-XmlNs $doc
            $taskArgs = $doc.SelectSingleNode('//t:Exec/t:Arguments', $ns).InnerText
            $taskArgs | Should Not Match '(?i)password|passwd|pgpass|secret|token|PGPASSWORD|AGE-SECRET|-Identity'
        }

        It "$tier : la descripción lleva la marca de tarea administrada y el hash de la definición" {
            $doc = Get-XmlDoc (New-TaskXmlFor -Tier $tier)
            $ns = New-XmlNs $doc
            $d = $doc.SelectSingleNode('//t:RegistrationInfo/t:Description', $ns).InnerText
            $d | Should Match 'DaubertHub-Managed-Backup'
            $d | Should Match "tier=$tier"
            $d | Should Match 'def=[0-9a-f]{16}'
        }

        It "$tier : LeastPrivilege y cuenta indicada" {
            $doc = Get-XmlDoc (New-TaskXmlFor -Tier $tier)
            $ns = New-XmlNs $doc
            $doc.SelectSingleNode('//t:Principal/t:RunLevel', $ns).InnerText | Should Be 'LeastPrivilege'
            $doc.SelectSingleNode('//t:Principal/t:UserId', $ns).InnerText | Should Be $global:TestUser
        }
    }

    It 'Frequent: repetición cada intervalHours (por defecto 4h) desde startTime, todos los días' {
        $doc = Get-XmlDoc (New-TaskXmlFor -Tier Frequent)
        $ns = New-XmlNs $doc
        $doc.SelectSingleNode('//t:CalendarTrigger/t:Repetition/t:Interval', $ns).InnerText | Should Be 'PT4H'
        $doc.SelectSingleNode('//t:CalendarTrigger/t:Repetition/t:Duration', $ns).InnerText | Should Be 'P1D'
        $doc.SelectSingleNode('//t:CalendarTrigger/t:StartBoundary', $ns).InnerText | Should Be '2026-01-01T00:30:00'
        $doc.SelectSingleNode('//t:CalendarTrigger/t:ScheduleByDay/t:DaysInterval', $ns).InnerText | Should Be '1'
    }

    It 'Frequent: respeta un intervalo personalizado desde config' {
        $doc = Get-XmlDoc (New-TaskXmlFor -Tier Frequent -Schedule ([pscustomobject]@{ startTime = '01:00'; intervalHours = 6 }))
        $ns = New-XmlNs $doc
        $doc.SelectSingleNode('//t:Repetition/t:Interval', $ns).InnerText | Should Be 'PT6H'
        $doc.SelectSingleNode('//t:StartBoundary', $ns).InnerText | Should Be '2026-01-01T01:00:00'
    }

    It 'Daily: trigger diario a la hora de config con repetición horaria (PT1H durante P1D) = oportunidades de reintento' {
        $doc = Get-XmlDoc (New-TaskXmlFor -Tier Daily)
        $ns = New-XmlNs $doc
        $doc.SelectSingleNode('//t:CalendarTrigger/t:Repetition/t:Interval', $ns).InnerText | Should Be 'PT1H'
        $doc.SelectSingleNode('//t:CalendarTrigger/t:Repetition/t:Duration', $ns).InnerText | Should Be 'P1D'
        $doc.SelectSingleNode('//t:CalendarTrigger/t:Repetition/t:StopAtDurationEnd', $ns).InnerText | Should Be 'false'
        $doc.SelectSingleNode('//t:StartBoundary', $ns).InnerText | Should Be '2026-01-01T02:00:00'
        $doc.SelectSingleNode('//t:ScheduleByDay/t:DaysInterval', $ns).InnerText | Should Be '1'
    }

    It 'Monthly: YA NO es un disparo único mensual: trigger diario + repetición horaria durante 24 h (el día lo decide -OnlyIfDue)' {
        $doc = Get-XmlDoc (New-TaskXmlFor -Tier Monthly -Schedule ([pscustomobject]@{ startTime = '03:00'; dayOfMonth = 5 }))
        $ns = New-XmlNs $doc
        $doc.SelectSingleNode('//t:ScheduleByMonth', $ns) | Should BeNullOrEmpty
        $doc.SelectSingleNode('//t:ScheduleByDay/t:DaysInterval', $ns).InnerText | Should Be '1'
        $doc.SelectSingleNode('//t:CalendarTrigger/t:Repetition/t:Interval', $ns).InnerText | Should Be 'PT1H'
        $doc.SelectSingleNode('//t:CalendarTrigger/t:Repetition/t:Duration', $ns).InnerText | Should Be 'P1D'
        $doc.SelectSingleNode('//t:StartBoundary', $ns).InnerText | Should Be '2026-01-01T03:00:00'
    }

    It 'los schedules inválidos se rechazan al generar el XML' {
        { New-TaskXmlFor -Tier Monthly -Schedule ([pscustomobject]@{ startTime = '03:00'; dayOfMonth = 31 }) } | Should Throw
        { New-TaskXmlFor -Tier Daily -Schedule ([pscustomobject]@{ startTime = '99:99' }) } | Should Throw
    }

    It 'las rutas con espacios y caracteres XML especiales se escapan correctamente' {
        $xml = New-TaskXmlFor -Tier Daily -ConfigPath 'C:\Datos & Config\<x>\config.json'
        $doc = Get-XmlDoc $xml
        $ns = New-XmlNs $doc
        $doc.SelectSingleNode('//t:Exec/t:Arguments', $ns).InnerText | Should Match 'Datos & Config\\<x>'
    }

    It 'es determinista: mismos datos -> mismo XML; distinto schedule -> distinto hash' {
        (New-TaskXmlFor -Tier Daily) | Should Be (New-TaskXmlFor -Tier Daily)
        $a = [regex]::Match((New-TaskXmlFor -Tier Daily), 'def=([0-9a-f]{16})').Groups[1].Value
        $b = [regex]::Match((New-TaskXmlFor -Tier Daily -Schedule ([pscustomobject]@{ startTime = '05:00' })), 'def=([0-9a-f]{16})').Groups[1].Value
        $a | Should Not Be $b
    }

    It 'LogonType configurable: S4U por defecto e Interactive' {
        $ns1 = New-XmlNs (Get-XmlDoc (New-TaskXmlFor -Tier Daily))
        (Get-XmlDoc (New-TaskXmlFor -Tier Daily)).SelectSingleNode('//t:Principal/t:LogonType', $ns1).InnerText | Should Be 'S4U'
        (Get-XmlDoc (New-TaskXmlFor -Tier Daily -LogonType Interactive)).SelectSingleNode('//t:Principal/t:LogonType', $ns1).InnerText | Should Be 'Interactive'
    }
}

Describe 'BackupTasks - plan, registro y desregistro (todo mockeado)' {

    BeforeEach {
        $global:TaskState = @{}
        Mock Get-BackupScheduledTaskDefinition { if ($global:TaskState.ContainsKey($TaskName)) { [pscustomobject]@{ TaskName = $TaskName; Xml = $global:TaskState[$TaskName] } } else { $null } } -ModuleName BackupTasks
        Mock Register-BackupScheduledTaskXml { $global:TaskState[$TaskName] = $Xml } -ModuleName BackupTasks
        Mock Unregister-BackupScheduledTaskByName { $global:TaskState.Remove($TaskName) } -ModuleName BackupTasks
        $script:cfg = [pscustomobject]@{ schedules = [pscustomobject]@{ Daily = [pscustomobject]@{ startTime = '05:15' } } }
    }

    function Get-Plan {
        Get-BackupTaskPlan -LocalConfig $script:cfg -ScriptPath $global:TestScript -ConfigPath $global:TestConfig -PowerShellPath $global:TestPs -UserId $global:TestUser
    }

    It 'sin tareas previas: el plan es Create para las 3' {
        $plan = Get-Plan
        $plan.Count | Should Be 3
        (($plan | Where-Object { $_.Action -eq 'Create' }) | Measure-Object).Count | Should Be 3
    }

    It 'el plan usa los schedules de config (Daily 05:15)' {
        $daily = (Get-Plan) | Where-Object { $_.Tier -eq 'Daily' }
        $daily.Xml | Should Match 'T05:15:00'
    }

    It 'Register-BackupTasks registra exactamente las 3 tareas con nombres administrados' {
        Register-BackupTasks -Plan (Get-Plan) | Out-Null
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 3 -Exactly -Scope It
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 0 -Exactly -Scope It -ParameterFilter { $TaskName -notlike 'Daubert - PostgreSQL *' }
        $global:TaskState.Count | Should Be 3
    }

    It 'es idempotente: un segundo registro no vuelve a registrar nada (Unchanged)' {
        Register-BackupTasks -Plan (Get-Plan) | Out-Null
        $second = Register-BackupTasks -Plan (Get-Plan)
        (($second | Where-Object { $_.Result -eq 'Unchanged' }) | Measure-Object).Count | Should Be 3
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 3 -Exactly -Scope It
    }

    It 'si cambia la definición (schedule) el plan indica Update solo para esa tarea' {
        Register-BackupTasks -Plan (Get-Plan) | Out-Null
        $script:cfg = [pscustomobject]@{ schedules = [pscustomobject]@{ Daily = [pscustomobject]@{ startTime = '06:45' } } }
        $plan = Get-Plan
        ($plan | Where-Object { $_.Tier -eq 'Daily' }).Action | Should Be 'Update'
        ($plan | Where-Object { $_.Tier -eq 'Frequent' }).Action | Should Be 'Unchanged'
        ($plan | Where-Object { $_.Tier -eq 'Monthly' }).Action | Should Be 'Unchanged'
    }

    It '-WhatIf: muestra el plan pero no registra nada' {
        $res = Register-BackupTasks -Plan (Get-Plan) -WhatIf
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 0 -Exactly -Scope It
        (($res | Where-Object { $_.Result -eq 'WhatIf' }) | Measure-Object).Count | Should Be 3
        $global:TaskState.Count | Should Be 0
    }

    It 'protección frente a nombres ajenos: una tarea con el mismo nombre SIN marca queda Blocked y no se toca' {
        $global:TaskState['Daubert - PostgreSQL Daily'] = '<Task><RegistrationInfo><Description>Tarea de otra persona</Description></RegistrationInfo></Task>'
        $plan = Get-Plan
        ($plan | Where-Object { $_.Tier -eq 'Daily' }).Action | Should Be 'Blocked'
        $res = Register-BackupTasks -Plan $plan
        ($res | Where-Object { $_.Tier -eq 'Daily' }).Result | Should Be 'Blocked'
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 0 -Exactly -Scope It -ParameterFilter { $TaskName -eq 'Daubert - PostgreSQL Daily' }
        $global:TaskState['Daubert - PostgreSQL Daily'] | Should Match 'otra persona'
    }

    It 'desregistrar: elimina solo tareas con marca y solo por nombre exacto' {
        Register-BackupTasks -Plan (Get-Plan) | Out-Null
        $global:TaskState['Otra tarea cualquiera'] = '<Task>ajena</Task>'
        $res = Unregister-BackupTasks
        (($res | Where-Object { $_.Result -eq 'Removed' }) | Measure-Object).Count | Should Be 3
        Assert-MockCalled Unregister-BackupScheduledTaskByName -ModuleName BackupTasks -Times 3 -Exactly -Scope It
        Assert-MockCalled Unregister-BackupScheduledTaskByName -ModuleName BackupTasks -Times 0 -Exactly -Scope It -ParameterFilter { $TaskName -eq 'Otra tarea cualquiera' }
        $global:TaskState.ContainsKey('Otra tarea cualquiera') | Should Be $true
    }

    It 'desregistrar: una tarea ajena con nombre igual se omite (Skipped-Foreign)' {
        $global:TaskState['Daubert - PostgreSQL Monthly'] = '<Task>ajena sin marca</Task>'
        $res = Unregister-BackupTasks -Tier Monthly
        $res.Result | Should Be 'Skipped-Foreign'
        Assert-MockCalled Unregister-BackupScheduledTaskByName -ModuleName BackupTasks -Times 0 -Exactly -Scope It
    }

    It 'desregistrar: tarea inexistente -> NotFound; -WhatIf no elimina' {
        (Unregister-BackupTasks -Tier Daily).Result | Should Be 'NotFound'
        Register-BackupTasks -Plan (Get-Plan) | Out-Null
        (Unregister-BackupTasks -Tier Daily -WhatIf).Result | Should Be 'WhatIf'
        Assert-MockCalled Unregister-BackupScheduledTaskByName -ModuleName BackupTasks -Times 0 -Exactly -Scope It
    }

    It 'desregistrar un tier concreto no afecta a los demás' {
        Register-BackupTasks -Plan (Get-Plan) | Out-Null
        Unregister-BackupTasks -Tier Frequent | Out-Null
        $global:TaskState.ContainsKey('Daubert - PostgreSQL Frequent') | Should Be $false
        $global:TaskState.ContainsKey('Daubert - PostgreSQL Daily') | Should Be $true
        $global:TaskState.ContainsKey('Daubert - PostgreSQL Monthly') | Should Be $true
    }
}

Describe 'BackupTasks - scripts de registro' {

    $registerScript = Join-Path $moduleRoot 'commands\Register-DaubertBackupTasks.ps1'
    $unregisterScript = Join-Path $moduleRoot 'commands\Unregister-DaubertBackupTasks.ps1'

    It 'Register-DaubertBackupTasks.ps1 y Unregister-DaubertBackupTasks.ps1 soportan -WhatIf' {
        (Get-Command $registerScript).Parameters.Keys -contains 'WhatIf' | Should Be $true
        (Get-Command $unregisterScript).Parameters.Keys -contains 'WhatIf' | Should Be $true
    }

    It 'Register-DaubertBackupTasks.ps1 apunta al entrypoint canónico y no acepta secretos como parámetro' {
        $src = Get-Content -LiteralPath $registerScript -Raw
        $src | Should Match 'Start-DaubertPostgresBackup\.ps1'
        ((Get-Command $registerScript).Parameters.Keys | Where-Object { $_ -match '(?i)pass|secret|token|key' }) | Should BeNullOrEmpty
    }

    It 'el módulo de tareas solo usa los tres cmdlets del sistema dentro de los wrappers' {
        $src = Get-Content -LiteralPath (Join-Path $moduleRoot 'lib\BackupTasks.psm1') -Raw
        ([regex]::Matches($src, '(?m)^\s*Register-ScheduledTask ')).Count | Should Be 1
        ([regex]::Matches($src, '(?m)^\s*Unregister-ScheduledTask ')).Count | Should Be 1
    }
}

Describe 'Task Scheduler - política exacta de las tres tareas y detalle de -WhatIf' {

    BeforeEach {
        Mock Get-BackupScheduledTaskDefinition { $null } -ModuleName BackupTasks
        $script:entry = 'C:\Repos con espacios\daubert-hub\scripts\backup\commands\Start-DaubertPostgresBackup.ps1'
        $script:cfgPath = 'C:\ProgramData\DaubertHub\Backup\config.json'
        $script:plan = (Get-BackupTaskPlan -LocalConfig ([pscustomobject]@{}) -ScriptPath $script:entry -ConfigPath $script:cfgPath -PowerShellPath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -UserId 'PC\operador' -LogonType S4U)
    }

    function Get-D { param([string]$Tier) Get-BackupTaskPlanDetail -Xml (($script:plan | Where-Object { $_.Tier -eq $Tier }).Xml) }

    It 'las tres tareas tienen exactamente los nombres permitidos' {
        ($script:plan | ForEach-Object { $_.TaskName }) | Should Be @('Daubert - PostgreSQL Frequent', 'Daubert - PostgreSQL Daily', 'Daubert - PostgreSQL Monthly')
    }

    It 'horarios: FREQUENT cada 4 h desde 00:30; DAILY y MONTHLY cada 1 h desde 02:00 / 03:00 con -OnlyIfDue' {
        (Get-D 'Frequent').Schedule | Should Be 'cada 4 h, todos los días, empezando a las 00:30'
        (Get-D 'Daily').Schedule | Should Be 'cada 1 h, todos los días, empezando a las 02:00 (solo hace backup si falta el del periodo: -OnlyIfDue)'
        (Get-D 'Monthly').Schedule | Should Be 'cada 1 h, todos los días, empezando a las 03:00 (solo hace backup si falta el del periodo: -OnlyIfDue)'
    }

    It 'todas ejecutan el entrypoint canónico commands\Start-DaubertPostgresBackup.ps1 con su -Tier y SIEMPRE -ConfigPath del config instalado' {
        foreach ($t in 'Frequent', 'Daily', 'Monthly') {
            $d = Get-D $t
            $d.Script | Should Be $script:entry
            $d.Tier | Should Be $t
            $d.ConfigPath | Should Be $script:cfgPath
            $base = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $script:entry + '" -Tier ' + $t + ' -ConfigPath "' + $script:cfgPath + '"'
            # Frequent conserva exactamente sus argumentos de siempre; Daily/Monthly añaden -OnlyIfDue y la espera del lock.
            $expected = if ($t -eq 'Frequent') { $base } else { $base + ' -OnlyIfDue -LockTimeoutSeconds 900' }
            $d.Arguments | Should Be $expected
        }
    }

    It 'PowerShell 5.1 con ruta completa, -NoProfile y -NonInteractive; sin flags innecesarios (ni -Command, ni -WindowStyle, ni -Version)' {
        $d = Get-D 'Daily'
        $d.Executable | Should Match 'WindowsPowerShell\\v1\.0\\powershell\.exe$'
        $d.Arguments | Should Match '^-NoProfile -NonInteractive '
        $d.Arguments | Should Not Match '-Command|-WindowStyle|-Version|-Sta|-Mta'
    }

    It 'no depende del directorio actual: script y config con rutas absolutas y WorkingDirectory = carpeta del script' {
        foreach ($t in 'Frequent', 'Daily', 'Monthly') {
            $d = Get-D $t
            $d.Script | Should Match '^[A-Za-z]:\\'
            $d.ConfigPath | Should Match '^[A-Za-z]:\\'
            $d.WorkingDirectory | Should Be (Split-Path -Parent $script:entry)
        }
    }

    It 'concurrencia y robustez: IgnoreNew, StartWhenAvailable, límite de ejecución, sin restricciones de batería' {
        foreach ($t in 'Frequent', 'Daily', 'Monthly') {
            $d = Get-D $t
            $d.MultipleInstances | Should Be 'IgnoreNew'
            $d.StartWhenAvailable | Should Be 'true'
            $d.ExecutionTimeLimit | Should Be 'PT4H'
            $d.AllowOnBatteries | Should Be $true
            $d.RunLevel | Should Be 'LeastPrivilege'
        }
    }

    It 'la ruta con espacios y caracteres especiales queda correctamente escapada y recuperable' {
        $xml = New-BackupTaskXml -Tier Daily -Schedule (Get-DefaultSchedule -Tier Daily) -ScriptPath 'C:\Mi Repo & Co\commands\Start-DaubertPostgresBackup.ps1' -ConfigPath $script:cfgPath -PowerShellPath 'powershell.exe' -UserId 'PC\operador'
        (Get-BackupTaskPlanDetail -Xml $xml).Script | Should Be 'C:\Mi Repo & Co\commands\Start-DaubertPostgresBackup.ps1'
    }

    It 'Format-BackupTaskPlan muestra nombre, horario, ejecutable, script, tier, ConfigPath, logon y concurrencia de las 3 tareas' {
        $text = (Format-BackupTaskPlan -Plan $script:plan) -join "`n"
        foreach ($needle in 'Daubert - PostgreSQL Frequent', 'Daubert - PostgreSQL Daily', 'Daubert - PostgreSQL Monthly', 'cada 4 h', 'cada 1 h, todos los días, empezando a las 03:00', '-OnlyIfDue', 'powershell.exe', 'commands\Start-DaubertPostgresBackup.ps1', 'C:\ProgramData\DaubertHub\Backup\config.json', 'S4U', 'PC\operador', 'MultipleInstances=IgnoreNew', '[CREATE]') {
            $text.Contains($needle) | Should Be $true
        }
    }

    It 'el detalle incluye el tier de cada tarea' {
        $text = (Format-BackupTaskPlan -Plan $script:plan) -join "`n"
        foreach ($t in 'Frequent', 'Daily', 'Monthly') { $text | Should Match ('Tier\s+: ' + $t) }
    }

    It 'el detalle mostrado no contiene secretos' {
        $text = (Format-BackupTaskPlan -Plan $script:plan) -join "`n"
        $text | Should Not Match '(?i)password|passwd|secret|token|PGPASSWORD|AGE-SECRET|pgpass'
    }
}

Describe 'Task Scheduler - los scripts Register/Unregister con -WhatIf (in-process, wrappers del sistema mockeados)' {

    BeforeAll {
        Import-Module (Join-Path $moduleRoot 'lib\BackupConfig.psm1') -Force
        Import-Module (Join-Path $moduleRoot 'lib\BackupLocalConfig.psm1') -Force
        Import-Module (Join-Path $moduleRoot 'lib\BackupTasks.psm1') -Force
    }

    BeforeEach {
        $global:TaskState = @{}
        Mock Get-BackupScheduledTaskDefinition { if ($global:TaskState.ContainsKey($TaskName)) { [pscustomobject]@{ TaskName = $TaskName; Xml = $global:TaskState[$TaskName] } } else { $null } } -ModuleName BackupTasks
        Mock Register-BackupScheduledTaskXml { $global:TaskState[$TaskName] = $Xml } -ModuleName BackupTasks
        Mock Unregister-BackupScheduledTaskByName { $global:TaskState.Remove($TaskName) } -ModuleName BackupTasks

        Mock Test-IsAdministrator { $true } -ModuleName BackupElevation
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-tasks-whatif-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:cfg = Join-Path $script:root 'cfg\config.json'
        $c = New-LocalBackupConfigObject -PostgresBin (Join-Path $script:root 'pg') -SevenZipPath (Join-Path $script:root 'sz') -AgePath (Join-Path $script:root 'ag') -RecipientsFilePath (Join-Path $script:root 'cfg\r.txt') `
            -PgPassFile (Join-Path $script:root 's\pgpass-backup.conf') -BackupRoot (Join-Path $script:root 'bk') -StagingRoot (Join-Path $script:root 'st') -LogRoot (Join-Path $script:root 'lg') -LockRoot (Join-Path $script:root 'lk')
        Write-LocalBackupConfig -Path $script:cfg -Config $c | Out-Null
        $script:savedNoReload = $env:DAUBERT_BACKUP_NO_RELOAD
        $env:DAUBERT_BACKUP_NO_RELOAD = '1'
        $script:reg = Join-Path $moduleRoot 'commands\Register-DaubertBackupTasks.ps1'
        $script:unreg = Join-Path $moduleRoot 'commands\Unregister-DaubertBackupTasks.ps1'
    }
    AfterEach {
        $env:DAUBERT_BACKUP_NO_RELOAD = $script:savedNoReload
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'Register -WhatIf: muestra todo lo necesario y NO crea, modifica ni borra tareas ni ejecuta backups' {
        $out = (& $script:reg -ConfigPath $script:cfg -WhatIf 6>&1 5>&1 4>&1 3>&1 2>&1 | Out-String)
        $LASTEXITCODE | Should Be 0
        foreach ($needle in 'Daubert - PostgreSQL Frequent', 'Daubert - PostgreSQL Daily', 'Daubert - PostgreSQL Monthly', 'Horario', 'Ejecutable', 'Script', 'commands\Start-DaubertPostgresBackup.ps1', 'Tier', 'ConfigPath', $script:cfg, 'Cuenta/logon', 'S4U', 'MultipleInstances=IgnoreNew') {
            $out.Contains($needle) | Should Be $true
        }
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 0 -Exactly -Scope It
        Assert-MockCalled Unregister-BackupScheduledTaskByName -ModuleName BackupTasks -Times 0 -Exactly -Scope It
        $global:TaskState.Count | Should Be 0
        $out | Should Not Match '(?i)password|secret|token|pgpass'
    }

    It 'Register real (mock) es idempotente: dos ejecuciones dejan exactamente 3 tareas, sin duplicados' {
        & $script:reg -ConfigPath $script:cfg 6>&1 | Out-Null
        & $script:reg -ConfigPath $script:cfg 6>&1 | Out-Null
        $global:TaskState.Count | Should Be 3
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 3 -Exactly -Scope It
    }

    It 'Register sin -ConfigPath usa el config canónico %ProgramData%\DaubertHub\Backup\config.json' {
        (Get-Content -LiteralPath $script:reg -Raw) | Should Match 'Get-DefaultBackupPaths\)\.ConfigPath'
        (Get-DefaultBackupPaths).ConfigPath | Should Be (Join-Path $env:ProgramData 'DaubertHub\Backup\config.json')
    }

    It 'Unregister -WhatIf: lista las tres tareas propias y no elimina nada' {
        & $script:reg -ConfigPath $script:cfg 6>&1 | Out-Null
        $out = (& $script:unreg -WhatIf 6>&1 5>&1 4>&1 3>&1 2>&1 | Out-String)
        Assert-MockCalled Unregister-BackupScheduledTaskByName -ModuleName BackupTasks -Times 0 -Exactly -Scope It
        $global:TaskState.Count | Should Be 3
        $out | Should Match 'WhatIf'
    }

    It 'Unregister real (mock): elimina solo las 3 tareas Daubert; una ajena y otra "Daubert - Futura" no se tocan; repetirlo es seguro' {
        & $script:reg -ConfigPath $script:cfg 6>&1 | Out-Null
        $global:TaskState['Tarea de terceros'] = '<Task>ajena</Task>'
        $global:TaskState['Daubert - Otra tarea futura'] = '<Task>DaubertHub-Managed-Backup otra</Task>'
        & $script:unreg 6>&1 | Out-Null
        & $script:unreg 6>&1 | Out-Null
        @($global:TaskState.Keys | Sort-Object) | Should Be @('Daubert - Otra tarea futura', 'Tarea de terceros')
        Assert-MockCalled Unregister-BackupScheduledTaskByName -ModuleName BackupTasks -Times 3 -Exactly -Scope It
    }

    It 'el código de BackupTasks nunca usa comodines para consultar o eliminar tareas' {
        $src = Get-Content -LiteralPath (Join-Path $moduleRoot 'lib\BackupTasks.psm1') -Raw
        $src | Should Not Match "TaskName\s+['""][^'""]*\*"
        $src | Should Not Match 'Get-ScheduledTask\s*(\||$|\r)'
        ([regex]::Matches($src, 'Unregister-ScheduledTask ')).Count | Should BeGreaterThan 0
    }
}

Describe 'Task Scheduler - Daily/Monthly con oportunidades periódicas de reintento (Frequent intacta)' {

    BeforeEach {
        $global:TaskState = @{}
        Mock Get-BackupScheduledTaskDefinition { if ($global:TaskState.ContainsKey($TaskName)) { [pscustomobject]@{ TaskName = $TaskName; Xml = $global:TaskState[$TaskName] } } else { $null } } -ModuleName BackupTasks
        Mock Register-BackupScheduledTaskXml { $global:TaskState[$TaskName] = $Xml } -ModuleName BackupTasks
    }

    function Get-LegacyHash {
        # Hash v1 EXACTO de antes del cambio (mismo canónico): lo que ya llevan registradas las tareas reales.
        param([string]$Tier, $Schedule, [string]$Arguments)
        $canonical = @('v1', $Tier, "start=$($Schedule.startTime)", "interval=$($Schedule.intervalHours)", "dom=$($Schedule.dayOfMonth)", $global:TestPs, $Arguments, 'S4U', $global:TestUser) -join '|'
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical)) } finally { $sha.Dispose() }
        (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 16)
    }
    function Get-LegacyArgs { param([string]$Tier) ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Tier {1} -ConfigPath "{2}"' -f $global:TestScript, $Tier, $global:TestConfig) }
    function Get-Hash { param([string]$Xml) [regex]::Match($Xml, 'def=([0-9a-f]{16})').Groups[1].Value }
    function Get-PlanFor { param($Cfg) Get-BackupTaskPlan -LocalConfig $Cfg -ScriptPath $global:TestScript -ConfigPath $global:TestConfig -PowerShellPath $global:TestPs -UserId $global:TestUser }
    function Get-ArgsFor { param($Cfg, [string]$Tier) $plan = Get-PlanFor $Cfg; $p = $plan | Where-Object { $_.Tier -eq $Tier }; (Get-BackupTaskPlanDetail -Xml $p.Xml).Arguments }

    It 'Frequent: XML, argumentos y hash IDÉNTICOS a los de antes (no se toca)' {
        $xml = New-TaskXmlFor -Tier Frequent
        $doc = Get-XmlDoc $xml
        $ns = New-XmlNs $doc
        $doc.SelectSingleNode('//t:Exec/t:Arguments', $ns).InnerText | Should Be (Get-LegacyArgs 'Frequent')
        $doc.SelectSingleNode('//t:Repetition/t:Interval', $ns).InnerText | Should Be 'PT4H'
        Get-Hash $xml | Should Be (Get-LegacyHash -Tier Frequent -Schedule (Get-DefaultSchedule -Tier Frequent) -Arguments (Get-LegacyArgs 'Frequent'))
    }

    It 'Daily y Monthly: el hash cambia respecto al anterior (v2), así que re-registrar las ACTUALIZA; Frequent queda Unchanged' {
        # Estado "real" actual: las tres tareas registradas con la definición anterior (v1).
        foreach ($t in 'Frequent', 'Daily', 'Monthly') {
            $sched = Get-DefaultSchedule -Tier $t
            $global:TaskState[(Get-BackupTaskName -Tier $t)] = "<Task><RegistrationInfo><Description>DaubertHub-Managed-Backup tier=$t def=$(Get-LegacyHash -Tier $t -Schedule $sched -Arguments (Get-LegacyArgs $t))</Description></RegistrationInfo></Task>"
        }
        $plan = Get-PlanFor ([pscustomobject]@{})
        ($plan | Where-Object { $_.Tier -eq 'Frequent' }).Action | Should Be 'Unchanged'
        ($plan | Where-Object { $_.Tier -eq 'Daily' }).Action | Should Be 'Update'
        ($plan | Where-Object { $_.Tier -eq 'Monthly' }).Action | Should Be 'Update'
    }

    It 'tras registrar la nueva definición, un segundo plan es Unchanged para las tres (idempotente)' {
        Register-BackupTasks -Plan (Get-PlanFor ([pscustomobject]@{})) | Out-Null
        $again = Get-PlanFor ([pscustomobject]@{})
        (($again | Where-Object { $_.Action -eq 'Unchanged' }) | Measure-Object).Count | Should Be 3
    }

    It 'espera del lock: Daily/Monthly 900 s por defecto, Frequent sin espera; configurable por tier en config.json' {
        (Get-ArgsFor ([pscustomobject]@{}) 'Frequent') | Should Not Match 'LockTimeoutSeconds'
        (Get-ArgsFor ([pscustomobject]@{}) 'Daily') | Should Match ' -OnlyIfDue -LockTimeoutSeconds 900$'
        (Get-ArgsFor ([pscustomobject]@{}) 'Monthly') | Should Match ' -OnlyIfDue -LockTimeoutSeconds 900$'

        $custom = [pscustomobject]@{ schedules = [pscustomobject]@{ Daily = [pscustomobject]@{ startTime = '02:00'; lockTimeoutSeconds = 300 }; Monthly = [pscustomobject]@{ startTime = '03:00'; dayOfMonth = 1; lockTimeoutSeconds = 0 } } }
        (Get-ArgsFor $custom 'Daily') | Should Match ' -OnlyIfDue -LockTimeoutSeconds 300$'
        (Get-ArgsFor $custom 'Monthly') | Should Not Match 'LockTimeoutSeconds'
        (Get-ArgsFor $custom 'Monthly') | Should Match ' -OnlyIfDue$'
    }

    It 'cambiar lockTimeoutSeconds en config.json cambia la definición (Update) solo de esa tarea' {
        Register-BackupTasks -Plan (Get-PlanFor ([pscustomobject]@{})) | Out-Null
        $custom = [pscustomobject]@{ schedules = [pscustomobject]@{ Daily = [pscustomobject]@{ startTime = '02:00'; lockTimeoutSeconds = 300 } } }
        $plan = Get-PlanFor $custom
        ($plan | Where-Object { $_.Tier -eq 'Daily' }).Action | Should Be 'Update'
        ($plan | Where-Object { $_.Tier -eq 'Monthly' }).Action | Should Be 'Unchanged'
        ($plan | Where-Object { $_.Tier -eq 'Frequent' }).Action | Should Be 'Unchanged'
    }

    It 'las propiedades que garantizan la recuperación siguen presentes: StartWhenAvailable, IgnoreNew y límite de 4 h (sin RestartOnFailure)' {
        foreach ($t in 'Daily', 'Monthly') {
            $doc = Get-XmlDoc (New-TaskXmlFor -Tier $t)
            $ns = New-XmlNs $doc
            $doc.SelectSingleNode('//t:Settings/t:StartWhenAvailable', $ns).InnerText | Should Be 'true'
            $doc.SelectSingleNode('//t:Settings/t:MultipleInstancesPolicy', $ns).InnerText | Should Be 'IgnoreNew'
            $doc.SelectSingleNode('//t:Settings/t:ExecutionTimeLimit', $ns).InnerText | Should Be 'PT4H'
            $doc.SelectSingleNode('//t:Settings/t:RestartOnFailure', $ns) | Should BeNullOrEmpty
        }
    }

    It 'estructura del trigger: un solo CalendarTrigger con StartBoundary, Repetition y ScheduleByDay' {
        foreach ($t in 'Daily', 'Monthly') {
            $doc = Get-XmlDoc (New-TaskXmlFor -Tier $t)
            $ns = New-XmlNs $doc
            $doc.SelectNodes('//t:Triggers/t:CalendarTrigger', $ns).Count | Should Be 1
            $doc.SelectNodes('//t:CalendarTrigger/t:StartBoundary', $ns).Count | Should Be 1
            $doc.SelectNodes('//t:CalendarTrigger/t:Repetition', $ns).Count | Should Be 1
            $doc.SelectNodes('//t:CalendarTrigger/t:ScheduleByDay', $ns).Count | Should Be 1
        }
    }
}
