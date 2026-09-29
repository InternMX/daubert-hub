#Requires -Version 5.1
<#
    Pruebas de BackupLocalConfig.psm1 + partes portables de BackupConfig.psm1.
    Todo ocurre en directorios temporales: no se toca %ProgramData%, secretos
    reales, Dropbox real, PostgreSQL, age ni Task Scheduler.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupLocalConfig.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupConfig.psm1') -Force
Import-Module (Join-Path $moduleRoot 'lib\BackupLocalConfig.psm1') -Force
. (Join-Path $PSScriptRoot 'helpers\TestDoubles.ps1')

$global:ValidRecipient = 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123'
# Clave privada FALSA construida en tiempo de ejecución (el repo nunca contiene un literal con esta forma).
$global:FakePrivateKey = 'AGE-SECRET-' + 'KEY-1' + ('Q' * 58)

function New-TestConfigObject {
    param([string]$Root, [hashtable]$Override = @{})
    $c = New-LocalBackupConfigObject `
        -PostgresBin (Join-Path $Root 'pg\bin') -SevenZipPath (Join-Path $Root 'tools\7z.exe') -AgePath (Join-Path $Root 'tools\age.exe') `
        -RecipientsFilePath (Join-Path $Root 'cfg\age-recipients.txt') -PgPassFile (Join-Path $Root 'secrets\pgpass-backup.conf') `
        -BackupRoot (Join-Path $Root 'ext backups') -StagingRoot (Join-Path $Root 'staging') -LogRoot (Join-Path $Root 'logs') -LockRoot (Join-Path $Root 'locks')
    foreach ($k in $Override.Keys) { $c[$k] = $Override[$k] }
    return $c
}

function Get-ErrorMessage {
    param([scriptblock]$Script)
    try { & $Script; return $null } catch { return $_.Exception.Message }
}

Describe 'BackupLocalConfig - lectura y escritura de config.json' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-localcfg-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:cfgPath = Join-Path $script:root 'cfg dir\config.json'
    }
    AfterEach { Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'escribe y vuelve a leer una configuración válida (ida y vuelta)' {
        $c = New-TestConfigObject -Root $script:root
        $w = Write-LocalBackupConfig -Path $script:cfgPath -Config $c
        $w.Changed | Should Be $true
        $r = Read-LocalBackupConfig -Path $script:cfgPath
        $r.Exists | Should Be $true
        $r.ParseOk | Should Be $true
        $r.IsValid | Should Be $true
        $r.Config.database | Should Be 'daubert_global'
        $r.Config.port | Should Be 5432
        $r.Config.backupUser | Should Be 'daubert_backup'
    }

    It 'es idempotente: reescribir la misma configuración no cambia el archivo (Changed=false)' {
        $c = New-TestConfigObject -Root $script:root
        Write-LocalBackupConfig -Path $script:cfgPath -Config $c | Out-Null
        $before = (Get-Item -LiteralPath $script:cfgPath).LastWriteTimeUtc
        Start-Sleep -Milliseconds 50
        $w2 = Write-LocalBackupConfig -Path $script:cfgPath -Config $c
        $w2.Changed | Should Be $false
        (Get-Item -LiteralPath $script:cfgPath).LastWriteTimeUtc | Should Be $before
    }

    It 'escribe UTF-8 SIN BOM' {
        Write-LocalBackupConfig -Path $script:cfgPath -Config (New-TestConfigObject -Root $script:root) | Out-Null
        $bytes = [System.IO.File]::ReadAllBytes($script:cfgPath)
        ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) | Should Be $false
    }

    It 'admite rutas con espacios' {
        $c = New-TestConfigObject -Root $script:root
        Write-LocalBackupConfig -Path $script:cfgPath -Config $c | Out-Null
        $r = Read-LocalBackupConfig -Path $script:cfgPath
        $r.Config.backupRoot | Should Be (Join-Path $script:root 'ext backups')
        $r.Config.backupRoot | Should Match ' '
        $r.IsValid | Should Be $true
    }

    It 'escritura atómica: una configuración inválida NO toca el config.json existente ni deja temporales' {
        $good = New-TestConfigObject -Root $script:root
        Write-LocalBackupConfig -Path $script:cfgPath -Config $good | Out-Null
        $before = [System.IO.File]::ReadAllText($script:cfgPath)

        $bad = New-TestConfigObject -Root $script:root
        $bad.Remove('agePath')
        { Write-LocalBackupConfig -Path $script:cfgPath -Config $bad } | Should Throw

        [System.IO.File]::ReadAllText($script:cfgPath) | Should Be $before
        (Get-ChildItem -LiteralPath (Split-Path -Parent $script:cfgPath) -Filter '*.tmp' | Measure-Object).Count | Should Be 0
    }

    It 'escritura atómica: si falla el reemplazo final no quedan temporales' {
        $dirAsTarget = Join-Path $script:root 'target-is-a-dir'
        New-Item -ItemType Directory -Path $dirAsTarget -Force | Out-Null
        { Write-LocalBackupConfig -Path $dirAsTarget -Config (New-TestConfigObject -Root $script:root) } | Should Throw
        (Get-ChildItem -LiteralPath $script:root -Filter '*.tmp' -Recurse | Measure-Object).Count | Should Be 0
    }

    It 'JSON inválido: ParseOk=false, IsValid=false, sin excepción' {
        New-Item -ItemType Directory -Path (Split-Path -Parent $script:cfgPath) -Force | Out-Null
        Set-Content -LiteralPath $script:cfgPath -Value '{ esto no es json' -Encoding UTF8
        $r = Read-LocalBackupConfig -Path $script:cfgPath
        $r.Exists | Should Be $true
        $r.ParseOk | Should Be $false
        $r.IsValid | Should Be $false
        $r.Config | Should BeNullOrEmpty
        ($r.Errors -join ' ') | Should Match 'JSON'
    }

    It 'archivo inexistente: Exists=false' {
        $r = Read-LocalBackupConfig -Path (Join-Path $script:root 'no-existe.json')
        $r.Exists | Should Be $false
        $r.IsValid | Should Be $false
    }

    It 'archivo vacío: ParseOk=false' {
        New-Item -ItemType Directory -Path (Split-Path -Parent $script:cfgPath) -Force | Out-Null
        Set-Content -LiteralPath $script:cfgPath -Value '' -Encoding UTF8
        (Read-LocalBackupConfig -Path $script:cfgPath).ParseOk | Should Be $false
    }

    foreach ($field in 'database', 'host', 'port', 'backupUser', 'postgresBin', 'sevenZipPath', 'agePath', 'recipientsFilePath', 'pgPassFile', 'backupRoot', 'stagingRoot', 'logRoot', 'lockRoot') {
        It "campo obligatorio ausente: '$field' invalida la configuración" {
            $c = New-TestConfigObject -Root $script:root
            $c.Remove($field)
            $v = Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
            $v.IsValid | Should Be $false
            ($v.Errors -join ' ') | Should Match $field
        }
    }

    It 'valores de puerto inválidos se rechazan (0, 70000, texto)' {
        foreach ($p in 0, 70000, 'abc') {
            $c = New-TestConfigObject -Root $script:root -Override @{ port = $p }
            (Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)).IsValid | Should Be $false
        }
    }

    It 'rutas relativas se rechazan (portabilidad: nada dependiente del directorio actual)' {
        $c = New-TestConfigObject -Root $script:root -Override @{ backupRoot = 'relativa\backups' }
        (Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)).IsValid | Should Be $false
    }

    It 'pgPassFile dentro de backupRoot se rechaza (backupRoot suele sincronizarse a la nube)' {
        $c = New-TestConfigObject -Root $script:root
        $c['pgPassFile'] = Join-Path $c['backupRoot'] 'pgpass.conf'
        $v = Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
        $v.IsValid | Should Be $false
        ($v.Errors -join ' ') | Should Match 'pgPassFile'
    }

    It 'la clave pgPassFile (una RUTA) está permitida y no se toma por un secreto' {
        $v = Test-LocalConfigObject -Config ((New-TestConfigObject -Root $script:root) | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
        $v.IsValid | Should Be $true
    }

    It 'claves desconocidas generan advertencia, no error' {
        $c = New-TestConfigObject -Root $script:root -Override @{ nota = 'x' }
        $v = Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
        $v.IsValid | Should Be $true
        ($v.Warnings -join ' ') | Should Match 'nota'
    }

    Context 'rechazo de secretos' {
        foreach ($key in 'password', 'pgPassword', 'token', 'apiKey', 'secret', 'privateKey', 'credential', 'passphrase', 'ageIdentity') {
            It "rechaza la clave '$key' y NO imprime su valor" {
                $canary = 'valor-secreto-' + [guid]::NewGuid().ToString('N')
                $c = New-TestConfigObject -Root $script:root -Override @{ $key = $canary }
                $v = Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
                $v.IsValid | Should Be $false
                ($v.Errors -join ' ') | Should Not Match $canary
            }
        }

        It 'rechaza un secreto anidado' {
            $c = New-TestConfigObject -Root $script:root -Override @{ extra = @{ nested = @{ apiKey = 'zzz' } } }
            (Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)).IsValid | Should Be $false
        }

        It 'rechaza un valor con forma de clave privada age (aunque la clave tenga un nombre inocente)' {
            $c = New-TestConfigObject -Root $script:root -Override @{ comentario = $global:FakePrivateKey }
            $v = Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
            $v.IsValid | Should Be $false
            ($v.Errors -join ' ') | Should Not Match 'QQQQQQQQ'
        }

        It 'rechaza una URL con credenciales embebidas' {
            $c = New-TestConfigObject -Root $script:root -Override @{ url = ('postgres:' + '//user:hunter2@host/db') }
            $v = Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
            $v.IsValid | Should Be $false
            ($v.Errors -join ' ') | Should Not Match 'hunter2'
        }

        It 'Write-LocalBackupConfig rechaza secretos, deja intacto el config previo y no filtra el valor' {
            $good = New-TestConfigObject -Root $script:root
            Write-LocalBackupConfig -Path $script:cfgPath -Config $good | Out-Null
            $before = [System.IO.File]::ReadAllText($script:cfgPath)
            $canary = 'canario-' + [guid]::NewGuid().ToString('N')
            $bad = New-TestConfigObject -Root $script:root -Override @{ password = $canary }
            $msg = Get-ErrorMessage { Write-LocalBackupConfig -Path $script:cfgPath -Config $bad }
            $msg | Should Not BeNullOrEmpty
            $msg | Should Not Match $canary
            [System.IO.File]::ReadAllText($script:cfgPath) | Should Be $before
        }
    }

    Context 'retención y schedules' {
        It 'unidad de retención inválida se rechaza' {
            $c = New-TestConfigObject -Root $script:root
            $c['retention']['Daily']['unit'] = 'Years'
            (Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)).IsValid | Should Be $false
        }
        It 'valor de retención fuera de rango se rechaza' {
            $c = New-TestConfigObject -Root $script:root
            $c['retention']['Daily']['value'] = 0
            (Test-LocalConfigObject -Config ($c | ConvertTo-Json -Depth 8 | ConvertFrom-Json)).IsValid | Should Be $false
        }
        It 'schedule: hora inválida, día 31 e intervalo 0 se rechazan' {
            (Test-ScheduleDefinition -Tier Daily -Schedule ([pscustomobject]@{ startTime = '25:00' })).Count | Should Not Be 0
            (Test-ScheduleDefinition -Tier Monthly -Schedule ([pscustomobject]@{ startTime = '03:00'; dayOfMonth = 31 })).Count | Should Not Be 0
            (Test-ScheduleDefinition -Tier Frequent -Schedule ([pscustomobject]@{ startTime = '00:30'; intervalHours = 0 })).Count | Should Not Be 0
        }
        It 'schedule: campo ajeno al tier se rechaza' {
            (Test-ScheduleDefinition -Tier Daily -Schedule ([pscustomobject]@{ startTime = '02:00'; dayOfMonth = 1 })).Count | Should Not Be 0
        }
        It 'schedule y retención efectivos = config.json sobre los defaults centralizados' {
            $cfg = [pscustomobject]@{ schedules = [pscustomobject]@{ Daily = [pscustomobject]@{ startTime = '05:15' } }; retention = [pscustomobject]@{ Frequent = [pscustomobject]@{ unit = 'Days'; value = 3 } } }
            (Get-LocalConfigSchedule -Config $cfg -Tier Daily).startTime | Should Be '05:15'
            (Get-LocalConfigSchedule -Config $cfg -Tier Frequent).intervalHours | Should Be (Get-DefaultSchedule -Tier Frequent).intervalHours
            (Get-LocalConfigRetention -Config $cfg -Tier Frequent).Value | Should Be 3
            (Get-LocalConfigRetention -Config $cfg -Tier Monthly).Value | Should Be 12
        }
        It 'config.json generado incluye retención y schedules explícitos por tier' {
            Write-LocalBackupConfig -Path $script:cfgPath -Config (New-TestConfigObject -Root $script:root) | Out-Null
            $r = Read-LocalBackupConfig -Path $script:cfgPath
            $r.Config.retention.Frequent.value | Should Be 7
            $r.Config.retention.Daily.value | Should Be 30
            $r.Config.retention.Monthly.unit | Should Be 'Months'
            $r.Config.schedules.Monthly.dayOfMonth | Should Be 1
        }
    }

    It 'ConvertTo-BackupConfigParameters traduce config.json a parámetros de Get-BackupConfig' {
        Write-LocalBackupConfig -Path $script:cfgPath -Config (New-TestConfigObject -Root $script:root) | Out-Null
        $r = Read-LocalBackupConfig -Path $script:cfgPath
        $p = ConvertTo-BackupConfigParameters -LocalConfig $r.Config -Tier Monthly
        $p.PgDatabase | Should Be 'daubert_global'
        $p.PgPort | Should Be 5432
        $p.BackupRoot | Should Be (Join-Path $script:root 'ext backups')
        $p.RetentionUnit | Should Be 'Months'
        $p.RetentionValue | Should Be 12
        $p.Keys -contains 'PgPassFile' | Should Be $true
    }

    It 'Initialize-BackupLayout crea logs/locks/staging y carpetas de secretos; no crea backupRoot sin pedirlo' {
        $c = (New-TestConfigObject -Root $script:root) | ConvertTo-Json -Depth 8 | ConvertFrom-Json
        $created = Initialize-BackupLayout -Config $c
        Test-Path -LiteralPath $c.logRoot | Should Be $true
        Test-Path -LiteralPath $c.lockRoot | Should Be $true
        Test-Path -LiteralPath $c.stagingRoot | Should Be $true
        Test-Path -LiteralPath (Split-Path -Parent $c.pgPassFile) | Should Be $true
        Test-Path -LiteralPath $c.backupRoot | Should Be $false
        (Initialize-BackupLayout -Config $c).Count | Should Be 0
        Initialize-BackupLayout -Config $c -CreateBackupRoot | Out-Null
        Test-Path -LiteralPath $c.backupRoot | Should Be $true
    }
}

Describe 'BackupConfig portable (sin rutas personales ni versiones fijas)' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-portcfg-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
    }
    AfterEach { Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'Get-BackupConfig sin BackupRoot/PgBinPath no lanza y los deja vacíos hasta que config/detección los resuelvan' {
        $cfg = Get-BackupConfig -Tier Daily
        $cfg.BackupRoot | Should BeNullOrEmpty
        $cfg.PgBinPath | Should BeNullOrEmpty
        $cfg.SevenZipPath | Should BeNullOrEmpty
        $cfg.AgePath | Should BeNullOrEmpty
    }

    It 'Test-BackupPrerequisite informa BackupRoot/PgBinPath vacíos sin lanzar' {
        $r = Test-BackupPrerequisite -Config (Get-BackupConfig -Tier Daily)
        $r.IsValid | Should Be $false
        ($r.Errors -join ' ') | Should Match 'BackupRoot'
        ($r.Errors -join ' ') | Should Match 'PgBinPath'
    }

    It 'LogRoot separa los logs del destino de backups' {
        $cfg = Get-BackupConfig -Tier Daily -BackupRoot (Join-Path $script:root 'b') -LogRoot (Join-Path $script:root 'logs')
        $cfg.LogDir | Should Be (Join-Path (Join-Path $script:root 'logs') 'DAILY')
    }

    It 'sin LogRoot se conserva el comportamiento previo: <BackupRoot>\LOGS\<TIER>' {
        $cfg = Get-BackupConfig -Tier Daily -BackupRoot (Join-Path $script:root 'b')
        $cfg.LogDir | Should Be (Join-Path (Join-Path $script:root 'b') 'LOGS\DAILY')
    }

    It 'LockRoot define el archivo de lock; LockFilePath explícito prevalece' {
        (Get-BackupConfig -Tier Daily -BackupRoot $script:root -LockRoot (Join-Path $script:root 'locks')).LockFilePath | Should Be (Join-Path (Join-Path $script:root 'locks') 'backup.lock')
        (Get-BackupConfig -Tier Daily -BackupRoot $script:root -LockRoot (Join-Path $script:root 'locks') -LockFilePath (Join-Path $script:root 'x.lock')).LockFilePath | Should Be (Join-Path $script:root 'x.lock')
    }

    It 'la retención por defecto está centralizada y puede sobre-escribirse' {
        (Get-BackupConfig -Tier Frequent -BackupRoot $script:root).RetentionValue | Should Be 7
        $c = Get-BackupConfig -Tier Frequent -BackupRoot $script:root -RetentionUnit Days -RetentionValue 3
        $c.RetentionValue | Should Be 3
        (Get-DefaultRetention -Tier Monthly).Unit | Should Be 'Months'
    }

    It 'schedules por defecto centralizados: Frequent cada 4h, Daily 02:00, Monthly día 1 03:00' {
        (Get-DefaultSchedule -Tier Frequent).intervalHours | Should Be 4
        (Get-DefaultSchedule -Tier Daily).startTime | Should Be '02:00'
        (Get-DefaultSchedule -Tier Monthly).dayOfMonth | Should Be 1
    }

    It 'Get-DefaultBackupPaths: layout código/config/secretos/datos derivado solo de las raíces recibidas' {
        $pd = Join-Path $script:root 'ProgramData'
        $la = Join-Path $script:root 'Local'
        $p = Get-DefaultBackupPaths -ProgramDataRoot $pd -LocalAppDataRoot $la
        $p.ConfigPath | Should Be (Join-Path $pd 'DaubertHub\Backup\config.json')
        $p.RecipientsFilePath | Should Be (Join-Path $pd 'DaubertHub\Backup\age-recipients.txt')
        $p.LogRoot | Should Be (Join-Path $pd 'DaubertHub\Backup\logs')
        $p.LockRoot | Should Be (Join-Path $pd 'DaubertHub\Backup\locks')
        $p.PgPassFile | Should Be (Join-Path $la 'DaubertHub\secrets\pgpass-backup.conf')
        $p.StagingRoot | Should Be (Join-Path $la 'DaubertHub\staging')
    }

    It 'Get-DefaultBackupPaths sin argumentos usa las variables estándar del sistema' {
        $p = Get-DefaultBackupPaths
        $p.ConfigPath | Should Be (Join-Path $env:ProgramData 'DaubertHub\Backup\config.json')
        $p.PgPassFile | Should Be (Join-Path $env:LOCALAPPDATA 'DaubertHub\secrets\pgpass-backup.conf')
    }

    Context 'detección de herramientas (Test-BackupToolPath mockeado: sin archivos con nombres de herramientas)' {
        BeforeEach {
            Clear-FakeTools
            Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig
        }
        # Crea <root>\<versión>\bin (carpeta real vacía) y registra EN MEMORIA solo los ejecutables indicados.
        function New-PgInstall {
            param([string]$Root, [string]$Version, [string[]]$Exes = @('pg_dump.exe', 'pg_restore.exe', 'pg_dumpall.exe'))
            $bin = Join-Path $Root "$Version\bin"
            New-Item -ItemType Directory -Path $bin -Force | Out-Null
            foreach ($e in $Exes) { Add-FakeTool -Path (Join-Path $bin $e) }
            return $bin
        }

        It 'PostgreSQL: 18 completo + 17 completo -> usa 18' {
            $r = Join-Path $script:root 'PostgreSQL'
            $b18 = New-PgInstall $r '18'; New-PgInstall $r '17' | Out-Null
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath -MinimumVersion ([version]'14.0') | Should Be $b18
        }
        It 'PostgreSQL: 18 incompleto (sin pg_dumpall) + 17 completo -> usa 17' {
            $r = Join-Path $script:root 'PostgreSQL'
            New-PgInstall $r '18' @('pg_dump.exe', 'pg_restore.exe') | Out-Null
            $b17 = New-PgInstall $r '17'
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath -MinimumVersion ([version]'14.0') | Should Be $b17
        }
        It 'PostgreSQL: 18 incompleto + 16 incompleto -> no hay instalación válida y el diagnóstico explica qué falta en cada una' {
            $r = Join-Path $script:root 'PostgreSQL'
            New-PgInstall $r '18' @('pg_dump.exe', 'pg_restore.exe') | Out-Null
            New-PgInstall $r '16' @('pg_dump.exe', 'pg_dumpall.exe') | Out-Null
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath -MinimumVersion ([version]'14.0') | Should BeNullOrEmpty
            $inst = @(Get-PostgresInstallations -SearchRoots @($r) -SkipPath)
            $diag = Get-PostgresInstallationDiagnostic -Installations $inst -MinimumVersion ([version]'14.0')
            $diag | Should Match 'PostgreSQL 18 \(falta pg_dumpall'
            $diag | Should Match 'PostgreSQL 16 \(falta pg_restore'
            $diag | Should Not Match ([regex]::Escape($script:root))
        }
        It 'PostgreSQL: 18 compatible pero incompleto + 13 completo -> falla (13 está por debajo del mínimo 14)' {
            $r = Join-Path $script:root 'PostgreSQL'
            New-PgInstall $r '18' @('pg_dump.exe', 'pg_restore.exe') | Out-Null
            New-PgInstall $r '13' | Out-Null
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath -MinimumVersion ([version]'14.0') | Should BeNullOrEmpty
            $diag = Get-PostgresInstallationDiagnostic -Installations @(Get-PostgresInstallations -SearchRoots @($r) -SkipPath) -MinimumVersion ([version]'14.0')
            $diag | Should Match 'PostgreSQL 13 \(versión inferior a la mínima'
        }
        It 'PostgreSQL: varias instalaciones completas -> selecciona la más alta (sin límite fijo de versiones)' {
            $r = Join-Path $script:root 'PostgreSQL'
            foreach ($v in '14', '15', '16', '17', '19', '9.6') { New-PgInstall $r $v | Out-Null }
            $b = New-PgInstall $r '20'
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath -MinimumVersion ([version]'14.0') | Should Be $b
        }
        It 'PostgreSQL: solo una instalación completa y compatible -> la usa' {
            $r = Join-Path $script:root 'PostgreSQL'
            New-PgInstall $r '18' @('pg_dump.exe') | Out-Null
            New-PgInstall $r '13' | Out-Null
            $b15 = New-PgInstall $r '15'
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath -MinimumVersion ([version]'14.0') | Should Be $b15
        }
        It 'PostgreSQL: con pg_dump y pg_restore pero sin pg_dumpall se descarta' {
            $r = Join-Path $script:root 'PostgreSQL'
            New-PgInstall $r '17' @('pg_dump.exe', 'pg_restore.exe') | Out-Null
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath | Should BeNullOrEmpty
            $i = @(Get-PostgresInstallations -SearchRoots @($r) -SkipPath)
            $i[0].IsComplete | Should Be $false
            $i[0].Missing | Should Be @('pg_dumpall.exe')
        }
        It 'PostgreSQL: sin instalaciones -> $null y diagnóstico "no se detectó ninguna" (comportamiento previo)' {
            $r = Join-Path $script:root 'nada'
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath | Should BeNullOrEmpty
            @(Get-PostgresInstallations -SearchRoots @($r) -SkipPath).Count | Should Be 0
            Get-PostgresInstallationDiagnostic -Installations @() | Should Match 'ninguna instalación'
        }
        It 'PostgreSQL: sin -MinimumVersion no se filtra por versión; con él, una completa inferior se descarta' {
            $r = Join-Path $script:root 'PostgreSQL'
            $b12 = New-PgInstall $r '12'
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath | Should Be $b12
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath -MinimumVersion ([version]'14.0') | Should BeNullOrEmpty
        }
        It 'PostgreSQL: los nombres de carpeta con versión menor (9.6) se ordenan numéricamente, no como texto' {
            $r = Join-Path $script:root 'PostgreSQL'
            New-PgInstall $r '9.6' | Out-Null
            $b10 = New-PgInstall $r '10'
            Find-PostgresBinPath -SearchRoots @($r) -SkipPath | Should Be $b10
        }
        It '7-Zip: detecta 7z.exe en la raíz indicada; $null si falta' {
            $d = Join-Path $script:root 'Program Files\7-Zip'
            New-Item -ItemType Directory -Path $d -Force | Out-Null
            Find-SevenZipPath -SearchRoots @($d) -SkipPath | Should BeNullOrEmpty
            Add-FakeTool -Path (Join-Path $d '7z.exe')
            Find-SevenZipPath -SearchRoots @($d) -SkipPath | Should Be (Join-Path $d '7z.exe')
        }
        It 'age: detecta age.exe en la raíz indicada; $null si falta' {
            $d = Join-Path $script:root 'Program Files\age'
            New-Item -ItemType Directory -Path $d -Force | Out-Null
            Find-AgePath -SearchRoots @($d) -SkipPath | Should BeNullOrEmpty
            Add-FakeTool -Path (Join-Path $d 'age.exe')
            Find-AgePath -SearchRoots @($d) -SkipPath | Should Be (Join-Path $d 'age.exe')
        }
    }
}

Describe 'BackupLocalConfig - age: destinatarios públicos y claves privadas' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-agecfg-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
    }
    AfterEach { Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'Test-AgePublicRecipient acepta age1... y rechaza basura o claves privadas' {
        Test-AgePublicRecipient -Value $global:ValidRecipient | Should Be $true
        Test-AgePublicRecipient -Value 'no-es-age' | Should Be $false
        Test-AgePublicRecipient -Value $global:FakePrivateKey | Should Be $false
        Test-AgePublicRecipient -Value '' | Should Be $false
    }

    It 'Get-AgeRecipientInfo: archivo válido con comentarios' {
        $f = Join-Path $script:root 'r.txt'
        @('# comentario', '', $global:ValidRecipient) | Set-Content -LiteralPath $f -Encoding ASCII
        $i = Get-AgeRecipientInfo -Path $f
        $i.IsValid | Should Be $true
        $i.RecipientCount | Should Be 1
    }

    It 'Get-AgeRecipientInfo: inexistente, vacío y basura son inválidos' {
        (Get-AgeRecipientInfo -Path (Join-Path $script:root 'x.txt')).Exists | Should Be $false
        $e = Join-Path $script:root 'e.txt'; Set-Content -LiteralPath $e -Value '' -Encoding ASCII
        (Get-AgeRecipientInfo -Path $e).IsValid | Should Be $false
        $g = Join-Path $script:root 'g.txt'; Set-Content -LiteralPath $g -Value 'basura' -Encoding ASCII
        (Get-AgeRecipientInfo -Path $g).IsValid | Should Be $false
    }

    It 'Get-AgeRecipientInfo: un archivo con clave PRIVADA es inválido y no la devuelve' {
        $f = Join-Path $script:root 'r.txt'
        @($global:ValidRecipient, $global:FakePrivateKey) | Set-Content -LiteralPath $f -Encoding ASCII
        $i = Get-AgeRecipientInfo -Path $f
        $i.IsValid | Should Be $false
        $i.HasPrivateKey | Should Be $true
        ($i | ConvertTo-Json -Depth 4) | Should Not Match 'QQQQQQQQ'
    }

    It 'Write-AgeRecipientsFile escribe solo claves públicas y el resultado es válido' {
        $f = Join-Path $script:root 'sub\r.txt'
        Write-AgeRecipientsFile -Path $f -Recipients @($global:ValidRecipient)
        (Get-AgeRecipientInfo -Path $f).IsValid | Should Be $true
    }

    It 'Write-AgeRecipientsFile rechaza una clave privada sin escribir el archivo ni repetirla en el error' {
        $f = Join-Path $script:root 'r.txt'
        $msg = Get-ErrorMessage { Write-AgeRecipientsFile -Path $f -Recipients @($global:FakePrivateKey) }
        $msg | Should Not BeNullOrEmpty
        $msg | Should Not Match 'QQQQQQQQ'
        Test-Path -LiteralPath $f | Should Be $false
    }

    It 'Write-AgeRecipientsFile rechaza texto que no es un recipient' {
        { Write-AgeRecipientsFile -Path (Join-Path $script:root 'r.txt') -Recipients @('hola') } | Should Throw
    }

    It 'Find-AgePrivateKeyInPath detecta por contenido y por nombre, sin devolver el contenido' {
        $d = Join-Path $script:root 'managed'
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $d 'notas.txt') -Value $global:FakePrivateKey -Encoding ASCII
        Set-Content -LiteralPath (Join-Path $d 'age-identity.txt') -Value 'x' -Encoding ASCII
        $hits = @(Find-AgePrivateKeyInPath -Paths @($d))
        $hits.Count | Should Be 2
        ($hits | ConvertTo-Json -Depth 4) | Should Not Match 'QQQQQQQQ'
    }

    It 'Find-AgePrivateKeyInPath: un directorio limpio (con artefactos .age) no genera hallazgos' {
        $d = Join-Path $script:root 'clean'
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $d 'x.age') -Value 'age-encryption.org/v1' -Encoding ASCII
        Set-Content -LiteralPath (Join-Path $d 'x.age.sha256') -Value 'abc' -Encoding ASCII
        Set-Content -LiteralPath (Join-Path $d 'age-recipients.txt') -Value $global:ValidRecipient -Encoding ASCII
        @(Find-AgePrivateKeyInPath -Paths @($d)).Count | Should Be 0
    }
}

Describe 'BackupLocalConfig - detección de Dropbox' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-dropbox-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
    }
    AfterEach { Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'detectado: lee info.json (personal y business) y devuelve solo rutas existentes' {
        $personal = Join-Path $script:root 'Dropbox personal'
        $business = Join-Path $script:root 'Dropbox (Empresa)'
        New-Item -ItemType Directory -Path $personal, $business -Force | Out-Null
        $info = Join-Path $script:root 'info.json'
        (@{ personal = @{ path = $personal }; business = @{ path = $business }; ghost = @{ path = (Join-Path $script:root 'no-existe') } } | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $info -Encoding UTF8
        $found = @(Find-DropboxPath -InfoJsonPath @($info) -FallbackRoot @())
        $found.Count | Should Be 2
        ($found -contains $personal) | Should Be $true
        ($found -contains $business) | Should Be $true
    }

    It 'detectado por carpeta de respaldo cuando no hay info.json' {
        $fb = Join-Path $script:root 'Dropbox'
        New-Item -ItemType Directory -Path $fb -Force | Out-Null
        $found = @(Find-DropboxPath -InfoJsonPath @() -FallbackRoot @($fb))
        $found | Should Be @($fb)
    }

    It 'no detectado: lista vacía (el sistema no depende de Dropbox)' {
        @(Find-DropboxPath -InfoJsonPath @((Join-Path $script:root 'x.json')) -FallbackRoot @((Join-Path $script:root 'nada'))).Count | Should Be 0
    }

    It 'info.json corrupto se ignora sin lanzar' {
        $info = Join-Path $script:root 'info.json'
        Set-Content -LiteralPath $info -Value '{roto' -Encoding UTF8
        @(Find-DropboxPath -InfoJsonPath @($info) -FallbackRoot @()).Count | Should Be 0
    }
}

Describe 'BackupLocalConfig - pgpass seguro' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-pgpass-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:pgpass = Join-Path $script:root 'secrets dir\pgpass-backup.conf'
    }
    AfterEach { Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue }

    function New-Secure { param([string]$Plain) ConvertTo-SecureString $Plain -AsPlainText -Force }

    It 'ConvertTo-PgPassField escapa ":" y "\" (en el orden correcto)' {
        ConvertTo-PgPassField 'a:b' | Should Be 'a\:b'
        ConvertTo-PgPassField 'a\b' | Should Be 'a\\b'
        ConvertTo-PgPassField 'a\:b' | Should Be 'a\\\:b'
        ConvertTo-PgPassField 'simple' | Should Be 'simple'
    }

    It 'crea el pgpass con el formato host:port:db:user:password (UTF-8 sin BOM, LF final)' {
        New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database daubert_global -User daubert_backup -Password (New-Secure 'S3cret!') | Out-Null
        $bytes = [System.IO.File]::ReadAllBytes($script:pgpass)
        ($bytes[0] -eq 0xEF) | Should Be $false
        [System.Text.Encoding]::UTF8.GetString($bytes) | Should Be "localhost:5432:daubert_global:daubert_backup:S3cret!`n"
    }

    It 'escapa ":" y "\" de la contraseña' {
        New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure 'a:b\c') | Out-Null
        [System.IO.File]::ReadAllText($script:pgpass) | Should Be "localhost:5432:d:u:a\:b\\c`n"
    }

    It 'aplica ACL restrictiva: solo usuario actual y SYSTEM, herencia deshabilitada' {
        New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure 'x') | Out-Null
        (Test-SecretFileAcl -Path $script:pgpass).IsRestricted | Should Be $true
        (Get-Acl -LiteralPath $script:pgpass).AreAccessRulesProtected | Should Be $true
        (Get-Acl -LiteralPath $script:pgpass).Access.Count | Should Be 2
    }

    It 'la contraseña nunca aparece en ninguna salida (éxito, verbose, warning, información)' {
        $canary = 'Canario' + [guid]::NewGuid().ToString('N')
        $out = (New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure $canary) -Verbose *>&1 | Out-String)
        $out | Should Not Match $canary
    }

    It 'el objeto devuelto no incluye la contraseña ni la ruta completa' {
        $canary = 'Canario' + [guid]::NewGuid().ToString('N')
        $r = New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure $canary)
        ($r | ConvertTo-Json) | Should Not Match $canary
        $r.FileName | Should Be 'pgpass-backup.conf'
    }

    It 'la contraseña solo se acepta como SecureString (nunca como texto/argumento)' {
        $p = (Get-Command New-PgPassFile).Parameters['Password']
        $p.ParameterType.FullName | Should Be 'System.Security.SecureString'
        ((Get-Command New-PgPassFile).Parameters.Keys | Where-Object { $_ -match 'Plain|Text' }) | Should BeNullOrEmpty
    }

    It 'el código usa BSTR y lo libera con ZeroFreeBSTR' {
        $src = Get-Content -LiteralPath (Join-Path $moduleRoot 'lib\BackupLocalConfig.psm1') -Raw
        $src | Should Match 'SecureStringToBSTR'
        $src | Should Match 'ZeroFreeBSTR'
    }

    It 'fallo seguro: contraseña con salto de línea -> error sin la contraseña, sin archivo parcial, pgpass previo intacto' {
        New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure 'original') | Out-Null
        $before = [System.IO.File]::ReadAllText($script:pgpass)
        $bad = "mala`nlinea" + [guid]::NewGuid().ToString('N')
        $msg = Get-ErrorMessage { New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure $bad) }
        $msg | Should Not BeNullOrEmpty
        $msg | Should Not Match 'mala'
        [System.IO.File]::ReadAllText($script:pgpass) | Should Be $before
        (Get-ChildItem -LiteralPath (Split-Path -Parent $script:pgpass) | Measure-Object).Count | Should Be 1
    }

    It 'contraseña vacía se rechaza' {
        $empty = New-Object System.Security.SecureString
        { New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password $empty } | Should Throw
        Test-Path -LiteralPath $script:pgpass | Should Be $false
    }

    It 'reemplazar un pgpass existente deja exactamente un archivo con el contenido nuevo' {
        New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure 'uno') | Out-Null
        New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure 'dos') | Out-Null
        [System.IO.File]::ReadAllText($script:pgpass) | Should Be "localhost:5432:d:u:dos`n"
        (Get-ChildItem -LiteralPath (Split-Path -Parent $script:pgpass) | Measure-Object).Count | Should Be 1
        (Test-SecretFileAcl -Path $script:pgpass).IsRestricted | Should Be $true
    }
}

Describe 'BackupLocalConfig - pgpass: orden de la ACL (mock)' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-pgpass-mock-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:pgpass = Join-Path $script:root 'secrets dir\pgpass-backup.conf'
    }
    AfterEach { Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue }

    function New-Secure { param([string]$Plain) ConvertTo-SecureString $Plain -AsPlainText -Force }

    It 'la ACL se aplica ANTES de escribir el secreto (el temporal está vacío cuando se protege)' {
        $global:aclLengths = @()
        Mock Set-RestrictiveFileAcl { $global:aclLengths += (Get-Item -LiteralPath $Path).Length } -ModuleName BackupLocalConfig
        New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure 'x') | Out-Null
        $global:aclLengths[0] | Should Be 0
        $global:aclLengths.Count | Should Be 2
    }
}

Describe 'BackupLocalConfig - pgpass: fallo seguro al aplicar la ACL (mock)' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-pgpass-mock-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:pgpass = Join-Path $script:root 'secrets dir\pgpass-backup.conf'
    }
    AfterEach { Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue }

    function New-Secure { param([string]$Plain) ConvertTo-SecureString $Plain -AsPlainText -Force }

    It 'fallo seguro: si no se puede aplicar la ACL no se escribe ningún secreto ni queda el temporal' {
        Mock Set-RestrictiveFileAcl { throw 'ACL no aplicable' } -ModuleName BackupLocalConfig
        $canary = 'Canario' + [guid]::NewGuid().ToString('N')
        $msg = Get-ErrorMessage { New-PgPassFile -Path $script:pgpass -HostName localhost -Port 5432 -Database d -User u -Password (New-Secure $canary) }
        $msg | Should Not Match $canary
        Test-Path -LiteralPath $script:pgpass | Should Be $false
        (Get-ChildItem -LiteralPath (Split-Path -Parent $script:pgpass) -Force | Measure-Object).Count | Should Be 0
    }
}
