#Requires -Version 5.1
<#
    Pruebas de la capa central de elevación (BackupElevation.psm1) y de su uso en
    Register/Unregister de Task Scheduler.

    Reproducen el bug real: Register-ScheduledTask devolvía "Acceso denegado" como error NO
    terminante, el wrapper informaba "Created" y el exit code era 0.

    NUNCA se abre un UAC real, no se eleva nada y no se toca el Task Scheduler real: se mockean
    Test-IsAdministrator, Start-ElevatedProcess (y Start-Process para el caso de UAC cancelado)
    y los wrappers de Task Scheduler. Sin ejecutables falsos ni compilación de código.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\Elevation.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
$libDir = Join-Path $moduleRoot 'lib'
$commandsDir = Join-Path $moduleRoot 'commands'
foreach ($m in 'BackupConfig', 'BackupLocalConfig', 'BackupElevation', 'BackupTasks') { Import-Module (Join-Path $libDir "$m.psm1") -Force }

function Get-CodeOnlyText {
    param([string]$Path)
    $s = [System.IO.File]::ReadAllText($Path)
    $s = [regex]::Replace($s, '(?s)<#.*?#>', '')
    (($s -split "\r?\n") | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
}

# ---------------------------------------------------------------------------
Describe 'BUG REAL: Register-ScheduledTask con "Acceso denegado" no puede reportarse como éxito' {

    BeforeEach {
        $global:TaskState = @{}
        Mock Get-BackupScheduledTaskDefinition { $null } -ModuleName BackupTasks
        $script:plan = Get-BackupTaskPlan -LocalConfig ([pscustomobject]@{}) -ScriptPath 'C:\repo\scripts\backup\commands\Start-DaubertPostgresBackup.ps1' -ConfigPath 'C:\ProgramData\DaubertHub\Backup\config.json' -PowerShellPath 'powershell.exe' -UserId 'PC\operador'
    }

    It 'el cmdlet real escribe un error NO terminante (como Acceso denegado 0x80070005): el wrapper lo convierte en fallo y nunca imprime Created' {
        Mock Register-ScheduledTask { Write-Error 'Acceso denegado. (Excepción de HRESULT: 0x80070005)' } -ModuleName BackupTasks
        $res = @(Register-BackupTasks -Plan $script:plan)
        (@($res | Where-Object { $_.Result -eq 'Created' -or $_.Result -eq 'Updated' }).Count) | Should Be 0
        $res[0].Result | Should Be 'Failed'
        $res[0].Error | Should Match '0x80070005|Acceso denegado'
    }

    It 'tras el primer fallo NO se intenta la segunda ni la tercera tarea (NotAttempted)' {
        Mock Register-ScheduledTask { Write-Error 'Acceso denegado' } -ModuleName BackupTasks
        $res = @(Register-BackupTasks -Plan $script:plan)
        @($res | ForEach-Object { $_.Result }) | Should Be @('Failed', 'NotAttempted', 'NotAttempted')
        Assert-MockCalled Register-ScheduledTask -ModuleName BackupTasks -Times 1 -Exactly -Scope It
    }

    It 'un fallo en la SEGUNDA tarea nunca se convierte en éxito: Created, Failed (con detalle), NotAttempted' {
        Mock Register-BackupScheduledTaskXml { if ($TaskName -like '*Daily') { throw 'El servicio de tareas rechazó la definición' } else { $global:TaskState[$TaskName] = $Xml } } -ModuleName BackupTasks
        $res = @(Register-BackupTasks -Plan $script:plan)
        @($res | ForEach-Object { $_.Result }) | Should Be @('Created', 'Failed', 'NotAttempted')
        $res[1].TaskName | Should Be 'Daubert - PostgreSQL Daily'
        $res[1].Error | Should Match 'rechazó'
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 2 -Exactly -Scope It
    }

    It 'Unregister aplica el mismo principio: un error no terminante NO es Removed y detiene el resto' {
        Mock Get-BackupScheduledTaskDefinition { [pscustomobject]@{ TaskName = $TaskName; Xml = '<Task>DaubertHub-Managed-Backup</Task>' } } -ModuleName BackupTasks
        Mock Unregister-ScheduledTask { Write-Error 'Acceso denegado' } -ModuleName BackupTasks
        $res = @(Unregister-BackupTasks)
        @($res | ForEach-Object { $_.Result }) | Should Be @('Failed', 'NotAttempted', 'NotAttempted')
        Assert-MockCalled Unregister-ScheduledTask -ModuleName BackupTasks -Times 1 -Exactly -Scope It
        $res[0].Error | Should Match 'Acceso denegado'
    }

    It 'los wrappers del sistema usan -ErrorAction Stop (causa raíz del bug)' {
        $src = Get-Content -LiteralPath (Join-Path $libDir 'BackupTasks.psm1') -Raw
        $src | Should Match 'Register-ScheduledTask -TaskName \$TaskName -Xml \$Xml -Force -ErrorAction Stop'
        $src | Should Match 'Unregister-ScheduledTask -TaskName \$TaskName -Confirm:\$false -ErrorAction Stop'
    }
}


Describe 'Registro correcto: Created solo cuando Register-ScheduledTask terminó bien' {
    It 'con el cmdlet sin errores las tres tareas quedan Created' {
        Mock Get-BackupScheduledTaskDefinition { $null } -ModuleName BackupTasks
        Mock Register-ScheduledTask { } -ModuleName BackupTasks
        $plan = Get-BackupTaskPlan -LocalConfig ([pscustomobject]@{}) -ScriptPath 'C:\repo\scripts\backup\commands\Start-DaubertPostgresBackup.ps1' -ConfigPath 'C:\ProgramData\DaubertHub\Backup\config.json' -PowerShellPath 'powershell.exe' -UserId 'PC\operador'
        (@(Register-BackupTasks -Plan $plan) | ForEach-Object { $_.Result }) | Should Be @('Created', 'Created', 'Created')
    }
}
# ---------------------------------------------------------------------------
Describe 'Register/Unregister (scripts, in-process): privilegios, exit codes y salida' {

    BeforeAll {
        # El proceso de pruebas puede o no estar elevado: se fuerza por mock en cada caso.
    }

    BeforeEach {
        $global:TaskState = @{}
        $global:ElevCalls = New-Object System.Collections.Generic.List[object]
        $global:AdminNow = $true
        Mock Test-IsAdministrator { $global:AdminNow } -ModuleName BackupElevation
        Mock Start-ElevatedProcess { $global:ElevCalls.Add([pscustomobject]@{ File = $FilePath; Args = $ArgumentList }); [pscustomobject]@{ Started = $global:ElevStarted; Cancelled = $global:ElevCancelled; ExitCode = $global:ElevExit; Error = $global:ElevError } } -ModuleName BackupElevation
        $global:ElevStarted = $true; $global:ElevCancelled = $false; $global:ElevExit = 0; $global:ElevError = $null
        Mock Get-BackupScheduledTaskDefinition { if ($global:TaskState.ContainsKey($TaskName)) { [pscustomobject]@{ TaskName = $TaskName; Xml = $global:TaskState[$TaskName] } } else { $null } } -ModuleName BackupTasks
        Mock Register-BackupScheduledTaskXml { if ($global:FailTask -and $TaskName -like $global:FailTask) { throw 'Acceso denegado. (HRESULT 0x80070005)' }; $global:TaskState[$TaskName] = $Xml } -ModuleName BackupTasks
        Mock Unregister-BackupScheduledTaskByName { if ($global:FailTask -and $TaskName -like $global:FailTask) { throw 'Acceso denegado' }; $global:TaskState.Remove($TaskName) } -ModuleName BackupTasks
        $global:FailTask = $null

        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-elev-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:cfg = Join-Path $script:root 'cfg\config.json'
        $c = New-LocalBackupConfigObject -PostgresBin (Join-Path $script:root 'pg') -SevenZipPath (Join-Path $script:root 'sz') -AgePath (Join-Path $script:root 'ag') -RecipientsFilePath (Join-Path $script:root 'cfg\r.txt') `
            -PgPassFile (Join-Path $script:root 's\pgpass-backup.conf') -BackupRoot (Join-Path $script:root 'bk') -StagingRoot (Join-Path $script:root 'st') -LogRoot (Join-Path $script:root 'lg') -LockRoot (Join-Path $script:root 'lk')
        Write-LocalBackupConfig -Path $script:cfg -Config $c | Out-Null
        $script:savedNoReload = $env:DAUBERT_BACKUP_NO_RELOAD
        $env:DAUBERT_BACKUP_NO_RELOAD = '1'
        $script:reg = Join-Path $commandsDir 'Register-DaubertBackupTasks.ps1'
        $script:unreg = Join-Path $commandsDir 'Unregister-DaubertBackupTasks.ps1'
    }
    AfterEach {
        $env:DAUBERT_BACKUP_NO_RELOAD = $script:savedNoReload
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    function Invoke-Cmd {
        param([string]$Script, [hashtable]$Params = @{})
        $global:LASTEXITCODE = $null
        $out = (& $Script @Params 6>&1 5>&1 4>&1 3>&1 2>&1 | Out-String)
        [pscustomobject]@{ Exit = $LASTEXITCODE; Out = $out }
    }

    It 'shell NO elevada + ejecución real: fail fast (exit 5) ANTES de tocar nada, sin "Created" y sin abrir UAC' {
        $global:AdminNow = $false
        $r = Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg }
        $r.Exit | Should Be 5
        $r.Out | Should Match 'ELEVADA'
        $r.Out | Should Not Match 'Created|Updated'
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 0 -Exactly -Scope It
        $global:ElevCalls.Count | Should Be 0
        $global:TaskState.Count | Should Be 0
    }

    It 'shell NO elevada + -WhatIf: funciona (exit 0), muestra el plan y no pide elevación' {
        $global:AdminNow = $false
        $r = Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg; WhatIf = $true }
        $r.Exit | Should Be 0
        $r.Out | Should Match 'Daubert - PostgreSQL Frequent'
        $r.Out | Should Match 'MultipleInstances=IgnoreNew'
        Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 0 -Exactly -Scope It
        $global:ElevCalls.Count | Should Be 0
    }

    It 'Unregister: shell no elevada + -WhatIf funciona; sin -WhatIf y con tareas Daubert existentes -> fail fast (exit 5) sin eliminar nada' {
        & $script:reg -ConfigPath $script:cfg 6>&1 | Out-Null
        $global:AdminNow = $false
        (Invoke-Cmd $script:unreg @{ WhatIf = $true }).Exit | Should Be 0
        $r = Invoke-Cmd $script:unreg
        $r.Exit | Should Be 5
        $r.Out | Should Not Match 'Removed'
        $global:TaskState.Count | Should Be 3
        Assert-MockCalled Unregister-BackupScheduledTaskByName -ModuleName BackupTasks -Times 0 -Exactly -Scope It
    }

    It 'sin cambios pendientes (todo Unchanged) o sin tareas que eliminar, un usuario estándar no necesita elevación' {
        & $script:reg -ConfigPath $script:cfg 6>&1 | Out-Null
        $global:AdminNow = $false
        (Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg }).Exit | Should Be 0
        $global:TaskState.Clear()
        (Invoke-Cmd $script:unreg).Exit | Should Be 0
    }

    It 'shell elevada + registro correcto: exit 0, Created x3 y NINGÚN segundo UAC' {
        $r = Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg }
        $r.Exit | Should Be 0
        ([regex]::Matches($r.Out, 'Created')).Count | Should Be 3
        $global:ElevCalls.Count | Should Be 0
        $global:TaskState.Count | Should Be 3
    }

    It 'shell elevada + fallo REAL en la segunda tarea: exit 6, Failed con el error técnico, la tercera no se intenta y nunca se imprime éxito para la fallida' {
        $global:FailTask = '*Daily'
        $r = Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg }
        $r.Exit | Should Be 6
        $r.Out | Should Match 'Daubert - PostgreSQL Daily\s+Failed'
        $r.Out | Should Match '0x80070005'
        $r.Out | Should Match 'Daubert - PostgreSQL Monthly\s+NotAttempted'
        $r.Out | Should Not Match 'Daily\s+(Created|Updated)'
        $global:TaskState.ContainsKey('Daubert - PostgreSQL Monthly') | Should Be $false
    }

    It 'fallo total (acceso denegado en la primera): exit 6 y ninguna tarea reportada como creada' {
        $global:FailTask = '*'
        $r = Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg }
        $r.Exit | Should Be 6
        $r.Out | Should Not Match 'Created|Updated'
    }

    It 'Unregister: fallo real -> exit 6 y nunca imprime Removed para la tarea fallida' {
        & $script:reg -ConfigPath $script:cfg 6>&1 | Out-Null
        $global:FailTask = '*Daily'
        $r = Invoke-Cmd $script:unreg
        $r.Exit | Should Be 6
        $r.Out | Should Match 'Daily\s+Failed'
        $r.Out | Should Not Match 'Daily\s+Removed'
        $r.Out | Should Match 'Monthly\s+NotAttempted'
    }

    It 'idempotencia: registrar dos veces deja 3 tareas; la segunda vez todo Unchanged' {
        & $script:reg -ConfigPath $script:cfg 6>&1 | Out-Null
        $r = Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg }
        $r.Exit | Should Be 0
        ([regex]::Matches($r.Out, 'Unchanged')).Count | Should BeGreaterThan 2
        $global:TaskState.Count | Should Be 3
    }

    It 'no modifica tareas ajenas: una tarea con el nombre pero sin marca queda Blocked (exit 4) y las demás no se ven afectadas' {
        $global:TaskState['Daubert - PostgreSQL Daily'] = '<Task>de otra persona</Task>'
        $global:TaskState['Tarea de terceros'] = '<Task>ajena</Task>'
        $r = Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg }
        $r.Exit | Should Be 4
        $global:TaskState['Daubert - PostgreSQL Daily'] | Should Match 'otra persona'
        $global:TaskState['Tarea de terceros'] | Should Be '<Task>ajena</Task>'
        Invoke-Cmd $script:unreg | Out-Null
        $global:TaskState['Daubert - PostgreSQL Daily'] | Should Match 'otra persona'
        $global:TaskState['Tarea de terceros'] | Should Be '<Task>ajena</Task>'
    }

    Context 'con -RequestElevation (consentimiento explícito; el wizard lo usa)' {

        It 'no elevado: pide UAC UNA sola vez, relanza el mismo script con parámetros no sensibles y propaga el código del proceso elevado' {
            $global:AdminNow = $false; $global:ElevExit = 0
            $r = Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg; RequestElevation = $true }
            $r.Exit | Should Be 0
            $global:ElevCalls.Count | Should Be 1
            $call = $global:ElevCalls[0]
            $call.File | Should Match 'WindowsPowerShell\\v1\.0\\powershell\.exe$'
            $call.Args | Should Match ([regex]::Escape('-File "' + $script:reg + '"'))
            $call.Args | Should Match ([regex]::Escape('-ConfigPath "' + $script:cfg + '"'))
            $call.Args | Should Match '-TaskUser "'
            $call.Args | Should Not Match 'RequestElevation'
            Assert-MockCalled Register-BackupScheduledTaskXml -ModuleName BackupTasks -Times 0 -Exactly -Scope It
        }

        It 'los argumentos del proceso elevado NO contienen secretos ni rutas de pgpass' {
            $global:AdminNow = $false
            Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg; RequestElevation = $true } | Out-Null
            $global:ElevCalls[0].Args | Should Not Match '(?i)password|passwd|secret|token|PGPASSWORD|AGE-SECRET|pgpass'
        }

        It 'el código de salida del proceso elevado se propaga (p. ej. 6 = Task Scheduler rechazó el registro)' {
            $global:AdminNow = $false; $global:ElevExit = 6
            (Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg; RequestElevation = $true }).Exit | Should Be 6
        }

        It 'UAC CANCELADO: exit 7, mensaje claro de cancelación, sin éxito ni estado parcial, reintentable' {
            $global:AdminNow = $false; $global:ElevStarted = $false; $global:ElevCancelled = $true; $global:ElevExit = $null
            $r = Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg; RequestElevation = $true }
            $r.Exit | Should Be 7
            $r.Out | Should Match 'CANCELADO'
            $r.Out | Should Match 'reintentar'
            $r.Out | Should Not Match 'Created|Updated'
            $global:TaskState.Count | Should Be 0
            # reintento: ahora sí
            $global:AdminNow = $true
            (Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg; RequestElevation = $true }).Exit | Should Be 0
            $global:TaskState.Count | Should Be 3
        }

        It 'ya elevado: -RequestElevation no vuelve a pedir UAC' {
            $global:AdminNow = $true
            (Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg; RequestElevation = $true }).Exit | Should Be 0
            $global:ElevCalls.Count | Should Be 0
        }

        It '-WhatIf con -RequestElevation nunca pide UAC' {
            $global:AdminNow = $false
            (Invoke-Cmd $script:reg @{ ConfigPath = $script:cfg; RequestElevation = $true; WhatIf = $true }).Exit | Should Be 0
            $global:ElevCalls.Count | Should Be 0
        }

        It 'Unregister con -RequestElevation: pide UAC una vez; cancelado -> exit 7 sin eliminar nada' {
            & $script:reg -ConfigPath $script:cfg 6>&1 | Out-Null
            $global:AdminNow = $false; $global:ElevStarted = $false; $global:ElevCancelled = $true; $global:ElevExit = $null
            $r = Invoke-Cmd $script:unreg @{ RequestElevation = $true }
            $r.Exit | Should Be 7
            $global:TaskState.Count | Should Be 3
            $global:ElevCalls.Count | Should Be 1
        }
    }
}

# ---------------------------------------------------------------------------
Describe 'Capa de elevación (BackupElevation.psm1)' {

    BeforeEach {
        $global:AdminNow = $false
        $global:ElevCalls = New-Object System.Collections.Generic.List[object]
        $global:ElevResult = [pscustomobject]@{ Started = $true; Cancelled = $false; ExitCode = 0; Error = $null }
        Mock Test-IsAdministrator { $global:AdminNow } -ModuleName BackupElevation
        Mock Start-ElevatedProcess { $global:ElevCalls.Add([pscustomobject]@{ File = $FilePath; Args = $ArgumentList }); $global:ElevResult } -ModuleName BackupElevation
    }

    Context 'requisitos por operación (no se asume que todo requiere admin)' {
        It 'registrar y eliminar tareas requieren elevación' {
            (Get-ElevationRequirement -Operation RegisterTasks).Required | Should Be $true
            (Get-ElevationRequirement -Operation UnregisterTasks).Required | Should Be $true
        }
        It 'diagnóstico, preflight, lectura de config, ejecución de backups y estado NO la requieren' {
            foreach ($op in 'Diagnose', 'Preflight', 'ReadConfig', 'RunBackup', 'Status', 'InstallPrerequisites') { (Get-ElevationRequirement -Operation $op).Required | Should Be $false }
        }
        It '-WhatIf nunca requiere elevación, ni siquiera para las operaciones privilegiadas' {
            (Get-ElevationRequirement -Operation RegisterTasks -WhatIf).Required | Should Be $false
            (Get-ElevationRequirement -Operation UnregisterTasks -WhatIf).Required | Should Be $false
        }
        It 'escribir en ProgramData depende de un sondeo real: carpeta escribible -> no requiere; no escribible -> requiere' {
            $d = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-elev-w-' + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $d -Force | Out-Null
            try { (Get-ElevationRequirement -Operation WriteProgramData -Path (Join-Path $d 'nueva\subcarpeta')).Required | Should Be $false }
            finally { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
            Mock Test-PathWritableByCurrentUser { $false } -ModuleName BackupElevation
            (Get-ElevationRequirement -Operation WriteProgramData -Path 'C:\Protegida\x').Required | Should Be $true
        }
        It 'una operación desconocida falla con mensaje claro' {
            { Get-ElevationRequirement -Operation Inventada } | Should Throw
        }
    }

    Context 'Invoke-ElevationGate (usuario estándar / admin / UAC)' {
        function Gate { param([bool]$Required = $true, [bool]$Consent = $false) Invoke-ElevationGate -Required $Required -OperationName 'Operación de prueba' -ScriptPath 'C:\repo\cmd.ps1' -Parameters ([ordered]@{ ConfigPath = 'C:\x\config.json' }) -RequestElevation $Consent }

        It 'usuario estándar + operación SIN admin -> continúa, sin UAC' {
            $g = Gate -Required $false
            $g.Action | Should Be 'Proceed'
            $global:ElevCalls.Count | Should Be 0
        }
        It 'usuario estándar + operación privilegiada sin consentimiento -> FailFast (5) y sin UAC' {
            $g = Gate -Required $true -Consent $false
            $g.Action | Should Be 'FailFast'
            $g.ExitCode | Should Be 5
            $g.Message | Should Match 'ELEVADA'
            $global:ElevCalls.Count | Should Be 0
        }
        It 'usuario estándar + operación privilegiada + consentimiento -> solicita UAC UNA vez' {
            $g = Gate -Required $true -Consent $true
            $g.Action | Should Be 'Relaunched'
            $global:ElevCalls.Count | Should Be 1
        }
        It 'admin + operación privilegiada -> continúa SIN segundo UAC (aunque haya consentimiento)' {
            $global:AdminNow = $true
            (Gate -Required $true -Consent $true).Action | Should Be 'Proceed'
            (Gate -Required $true -Consent $false).Action | Should Be 'Proceed'
            $global:ElevCalls.Count | Should Be 0
        }
        It 'UAC cancelado -> Cancelled (7): no es éxito y el mensaje lo dice' {
            $global:ElevResult = [pscustomobject]@{ Started = $false; Cancelled = $true; ExitCode = $null; Error = 'cancelada' }
            $g = Gate -Required $true -Consent $true
            $g.Action | Should Be 'Cancelled'
            $g.ExitCode | Should Be 7
            $g.Message | Should Match 'CANCELADO'
        }
        It 'si el proceso elevado no pudo iniciarse (sin cancelación) tampoco es éxito' {
            $global:ElevResult = [pscustomobject]@{ Started = $false; Cancelled = $false; ExitCode = $null; Error = 'fallo' }
            (Gate -Required $true -Consent $true).ExitCode | Should Be 7
        }
        It 'propaga el código de salida del proceso elevado' {
            $global:ElevResult = [pscustomobject]@{ Started = $true; Cancelled = $false; ExitCode = 6; Error = $null }
            (Gate -Required $true -Consent $true).ExitCode | Should Be 6
        }
    }

    Context 'argumentos del proceso elevado: nunca secretos' {
        It 'serializa switches, arrays y textos con comillas y espacios' {
            $s = ConvertTo-ElevationArgumentString -Parameters ([ordered]@{ ConfigPath = 'C:\Mis Datos\config.json'; Tier = @('Frequent', 'Daily'); WhatIf = $true; Omitido = $false; Nulo = $null })
            $s | Should Be '-ConfigPath "C:\Mis Datos\config.json" -Tier "Frequent,Daily" -WhatIf'
        }
        It 'rechaza parámetros con nombre de secreto' {
            foreach ($n in 'Password', 'PgPassword', 'ApiToken', 'PrivateKey', 'Secret', 'Credential', 'PgPassFile') {
                { ConvertTo-ElevationArgumentString -Parameters @{ $n = 'x' } } | Should Throw
            }
        }
        It 'los interruptores booleanos (p. ej. -SkipPgPass) se pasan: un true/false no puede transportar un secreto' {
            ConvertTo-ElevationArgumentString -Parameters ([ordered]@{ SkipPgPass = $true; InstallPrerequisites = $false }) | Should Be '-SkipPgPass'
            ConvertTo-ElevationArgumentString -Parameters ([ordered]@{ SkipPgPass = [System.Management.Automation.SwitchParameter]$true }) | Should Be '-SkipPgPass'
        }
        It 'un parámetro con nombre de secreto y valor de texto sigue rechazado aunque el valor parezca inocente' {
            { ConvertTo-ElevationArgumentString -Parameters @{ Password = 'hola' } } | Should Throw
        }
        It 'rechaza SecureString y PSCredential' {
            $sec = ConvertTo-SecureString 'x' -AsPlainText -Force
            { ConvertTo-ElevationArgumentString -Parameters @{ Valor = $sec } } | Should Throw
        }
        It 'rechaza valores con forma de secreto (clave privada age, PGPASSWORD asignado, URL con credenciales) sin repetirlos en el error' {
            $fakeKey = 'AGE-SECRET-' + 'KEY-1' + ('Q' * 20)
            $msg = try { ConvertTo-ElevationArgumentString -Parameters @{ Nota = $fakeKey }; '' } catch { $_.Exception.Message }
            $msg | Should Not BeNullOrEmpty
            $msg | Should Not Match 'QQQQ'
            { ConvertTo-ElevationArgumentString -Parameters @{ Nota = ('PGPASSWORD' + '=abc') } } | Should Throw
            { ConvertTo-ElevationArgumentString -Parameters @{ Nota = ('postgres:' + '//u:p@h/db') } } | Should Throw
        }
        It 'Request-AdministrativeElevation lanza Windows PowerShell 5.1 con -File y solo parámetros no sensibles' {
            Request-AdministrativeElevation -ScriptPath 'C:\repo\scripts\backup\commands\Register-DaubertBackupTasks.ps1' -Parameters ([ordered]@{ ConfigPath = 'C:\ProgramData\DaubertHub\Backup\config.json' }) | Out-Null
            $c = $global:ElevCalls[0]
            $c.File | Should Match 'WindowsPowerShell\\v1\.0\\powershell\.exe$'
            $c.Args | Should Be '-NoProfile -ExecutionPolicy Bypass -File "C:\repo\scripts\backup\commands\Register-DaubertBackupTasks.ps1" -ConfigPath "C:\ProgramData\DaubertHub\Backup\config.json"'
        }
        It 'si ya es administrador, Request-AdministrativeElevation NO lanza nada (sin segundo UAC)' {
            $global:AdminNow = $true
            (Request-AdministrativeElevation -ScriptPath 'C:\x.ps1').AlreadyElevated | Should Be $true
            $global:ElevCalls.Count | Should Be 0
        }
        It 'con un secreto en los parámetros, Request-AdministrativeElevation falla ANTES de lanzar el proceso' {
            { Request-AdministrativeElevation -ScriptPath 'C:\x.ps1' -Parameters @{ Password = 'x' } } | Should Throw
            $global:ElevCalls.Count | Should Be 0
        }
    }

    Context 'Test-IsAdministrator' {
        It 'devuelve un booleano sin tocar Task Scheduler (usa solo System.Security.Principal)' {
            $real = Get-Content -LiteralPath (Join-Path $libDir 'BackupElevation.psm1') -Raw
            [bool]([regex]::IsMatch($real, 'WindowsPrincipal')) | Should Be $true
            (Get-CodeOnlyText (Join-Path $libDir 'BackupElevation.psm1')) | Should Not Match ('(?i)(Get|Register|Unregister)-ScheduledTask\s+-|Add' + '-Type|schtasks')
        }
    }
}


Describe 'Start-ElevatedProcess (UAC simulado: nunca se abre uno real)' {

    It 'UAC cancelado por el usuario (Win32 1223) -> Cancelled, sin excepción' {
        Mock Start-Process { throw (New-Object System.ComponentModel.Win32Exception(1223)) } -ModuleName BackupElevation
        $r = Start-ElevatedProcess -FilePath 'powershell.exe' -ArgumentList '-File x.ps1'
        $r.Cancelled | Should Be $true
        $r.Started | Should Be $false
    }
    It 'otro error de arranque -> Started=false, Cancelled=false, con el error' {
        Mock Start-Process { throw 'no se pudo iniciar' } -ModuleName BackupElevation
        $r = Start-ElevatedProcess -FilePath 'powershell.exe' -ArgumentList '-File x.ps1'
        $r.Started | Should Be $false
        $r.Cancelled | Should Be $false
        $r.Error | Should Match 'no se pudo iniciar'
    }
    It 'arranque correcto -> Started=true con el código de salida del proceso elevado' {
        Mock Start-Process { [pscustomobject]@{ ExitCode = 6 } } -ModuleName BackupElevation
        $r = Start-ElevatedProcess -FilePath 'powershell.exe' -ArgumentList '-File x.ps1'
        $r.Started | Should Be $true
        $r.ExitCode | Should Be 6
    }
    It 'usa el UAC estándar (-Verb RunAs) y espera el resultado' {
        $src = Get-Content -LiteralPath (Join-Path $libDir 'BackupElevation.psm1') -Raw
        $src | Should Match '-Verb RunAs -Wait -PassThru -ErrorAction Stop'
    }
}
# ---------------------------------------------------------------------------
Describe 'La lógica de elevación está CENTRALIZADA y no se eleva nada por defecto' {

    It 'solo BackupElevation.psm1 usa RunAs / Start-Process / WindowsPrincipal' {
        foreach ($f in @(Get-ChildItem -LiteralPath $libDir -Filter '*.psm1') + @(Get-ChildItem -LiteralPath $commandsDir -Filter '*.ps1')) {
            if ($f.Name -eq 'BackupElevation.psm1') { continue }
            (Get-CodeOnlyText $f.FullName) | Should Not Match 'RunAs|Start-Process|WindowsPrincipal|IsInRole'
        }
    }

    It 'Test-IsAdministrator se define una sola vez en todo el repo de backup' {
        $defs = @(Get-ChildItem -LiteralPath $moduleRoot -Recurse -File -Include *.psm1, *.ps1 | Where-Object { $_.FullName -notmatch '\\tests\\' } | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'function\s+Test-IsAdministrator\b' })
        $defs.Count | Should Be 1
        $defs[0].Name | Should Be 'BackupElevation.psm1'
    }

    It 'Register/Unregister/Install usan el gate central (Invoke-ElevationGate) y exponen -RequestElevation' {
        foreach ($n in 'Register-DaubertBackupTasks.ps1', 'Unregister-DaubertBackupTasks.ps1', 'Install-DaubertBackup.ps1') {
            $p = Join-Path $commandsDir $n
            (Get-CodeOnlyText $p) | Should Match 'Invoke-ElevationGate'
            ((Get-Command $p).Parameters.Keys -contains 'RequestElevation') | Should Be $true
        }
    }

    It 'los comandos no elevan por sí solos: sin -RequestElevation solo fail fast (el valor por defecto es NO pedir UAC)' {
        foreach ($n in 'Register-DaubertBackupTasks.ps1', 'Unregister-DaubertBackupTasks.ps1', 'Install-DaubertBackup.ps1') {
            $p = Join-Path $commandsDir $n
            $param = (Get-Command $p).Parameters['RequestElevation']
            $param.ParameterType.Name | Should Be 'SwitchParameter'
        }
    }

    It 'el preflight y el resto de comandos de solo lectura NO dependen de privilegios de administrador' {
        (Get-CodeOnlyText (Join-Path $libDir 'BackupPreflight.psm1')) | Should Not Match 'Test-IsAdministrator|Invoke-ElevationGate|IsInRole'
        foreach ($n in 'Test-DaubertBackupEnvironment.ps1', 'Start-DaubertPostgresBackup.ps1', 'Install-DaubertBackupPrerequisites.ps1') {
            (Get-CodeOnlyText (Join-Path $commandsDir $n)) | Should Not Match 'Invoke-ElevationGate|Test-IsAdministrator'
        }
    }

    It 'el cargador central conoce el módulo de elevación y Tasks depende de él' {
        $graph = & { . (Join-Path $libDir 'Import-DaubertBackupModules.ps1'); $DaubertBackupModuleGraph }
        ($graph.Keys -contains 'Elevation') | Should Be $true
        ($graph['Tasks'] -contains 'Elevation') | Should Be $true
    }

    It 'sin compilar código ni ejecutables auxiliares en la capa de elevación' {
        (Get-CodeOnlyText (Join-Path $libDir 'BackupElevation.psm1')) | Should Not Match ('Add' + '-Type')
    }
}
