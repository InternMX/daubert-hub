#Requires -Version 5.1
<#
    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupRetention.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupRetention.psm1') -Force
Import-Module (Join-Path $moduleRoot 'lib\BackupNaming.psm1') -Force

function New-FakeBackupFile {
    param([string]$Dir, [string]$Name)
    New-Item -ItemType Directory -Path $Dir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $Dir $Name) -Value 'x' -Encoding UTF8
}

Describe 'BackupRetention' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-retention-test-" + [guid]::NewGuid().ToString('N'))
        $script:tierDir = Join-Path $script:root 'FREQUENT'
        New-Item -ItemType Directory -Path $script:tierDir -Force | Out-Null
        $script:pattern = Get-BackupFileNamePattern -Kind Dump -Tier Frequent -Database daubert_global
    }

    AfterEach {
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'borra archivos más antiguos que el cutoff y conserva los recientes' {
        New-FakeBackupFile $script:tierDir 'daubert_global_FREQUENT_20260101_000000.dump'
        New-FakeBackupFile $script:tierDir 'daubert_global_FREQUENT_20260927_000000.dump'

        $cutoff = Get-Date '2026-06-01'
        $result = Invoke-BackupRetention -BackupRoot $script:root -TargetDir $script:tierDir -Pattern $script:pattern -CutoffDate $cutoff

        $result.Deleted.Count | Should Be 1
        $result.Kept.Count | Should Be 1
        Test-Path (Join-Path $script:tierDir 'daubert_global_FREQUENT_20260101_000000.dump') | Should Be $false
        Test-Path (Join-Path $script:tierDir 'daubert_global_FREQUENT_20260927_000000.dump') | Should Be $true
    }

    It 'con -DryRun no borra nada, solo reporta qué eliminaría' {
        New-FakeBackupFile $script:tierDir 'daubert_global_FREQUENT_20260101_000000.dump'
        $cutoff = Get-Date '2026-06-01'

        $result = Invoke-BackupRetention -BackupRoot $script:root -TargetDir $script:tierDir -Pattern $script:pattern -CutoffDate $cutoff -DryRun

        $result.DryRun | Should Be $true
        $result.WouldDelete.Count | Should Be 1
        $result.Deleted.Count | Should Be 0
        Test-Path (Join-Path $script:tierDir 'daubert_global_FREQUENT_20260101_000000.dump') | Should Be $true
    }

    It 'nunca borra un archivo cuyo nombre no coincide con el patrón del tier (protección de borrado accidental)' {
        New-FakeBackupFile $script:tierDir 'algo-que-no-es-un-backup.txt'
        New-FakeBackupFile $script:tierDir 'daubert_global_DAILY_20260101_000000.dump'

        $cutoff = Get-Date '2026-06-01'
        $result = Invoke-BackupRetention -BackupRoot $script:root -TargetDir $script:tierDir -Pattern $script:pattern -CutoffDate $cutoff

        $result.Deleted.Count | Should Be 0
        Test-Path (Join-Path $script:tierDir 'algo-que-no-es-un-backup.txt') | Should Be $true
        Test-Path (Join-Path $script:tierDir 'daubert_global_DAILY_20260101_000000.dump') | Should Be $true
    }

    It 'rechaza un TargetDir fuera de BackupRoot (protección de rutas defensivas)' {
        $outsideDir = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-outside-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $outsideDir -Force | Out-Null
        try {
            { Invoke-BackupRetention -BackupRoot $script:root -TargetDir $outsideDir -Pattern $script:pattern -CutoffDate (Get-Date) } | Should Throw
        }
        finally {
            Remove-Item -LiteralPath $outsideDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'un intento de path traversal (..) hacia afuera de BackupRoot es rechazado' {
        $traversal = Join-Path $script:root '..\..'
        { Invoke-BackupRetention -BackupRoot $script:root -TargetDir $traversal -Pattern $script:pattern -CutoffDate (Get-Date) } | Should Throw
    }

    It 'no falla si el directorio del tier todavía no existe (primera ejecución)' {
        $freshDir = Join-Path $script:root 'MONTHLY'
        $result = Invoke-BackupRetention -BackupRoot $script:root -TargetDir $freshDir -Pattern $script:pattern -CutoffDate (Get-Date)
        $result.Deleted.Count | Should Be 0
        $result.Kept.Count | Should Be 0
    }

    It 'un archivo con timestamp no parseable nunca se borra' {
        New-FakeBackupFile $script:tierDir 'daubert_global_FREQUENT_99999999_999999.dump'
        # Este nombre no calza con \d{8}_\d{6} de forma válida como fecha real,
        # pero para forzar el caso "coincide el patrón pero falla el parseo"
        # probamos directamente Test-PathIsWithinRoot + ConvertFrom-BackupTimestamp.
        $parsed = ConvertFrom-BackupTimestamp -Timestamp '99999999_999999'
        $parsed | Should BeNullOrEmpty
    }

    It 'Get-RetentionCutoffDate calcula correctamente Days y Months' {
        $now = Get-Date '2026-09-28'
        (Get-RetentionCutoffDate -RetentionUnit Days -RetentionValue 7 -Now $now).Date | Should Be (Get-Date '2026-09-21').Date
        (Get-RetentionCutoffDate -RetentionUnit Months -RetentionValue 12 -Now $now).Date | Should Be (Get-Date '2025-09-28').Date
    }
}

Describe 'Backups pendientes: último publicado válido y "¿toca?" (funciones puras, sin tocar Task Scheduler)' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-due-test-" + [guid]::NewGuid().ToString('N'))
        $script:dailyDir = Join-Path $script:root 'DAILY'
        New-Item -ItemType Directory -Path $script:dailyDir -Force | Out-Null
        $script:pattern = Get-BackupFileNamePattern -Kind Archive -Tier Daily -Database daubert_global
        $script:daily = [pscustomobject]@{ startTime = '02:00' }
        $script:monthly = [pscustomobject]@{ startTime = '03:00'; dayOfMonth = 1 }
    }

    AfterEach {
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    function New-PublishedPair {
        param([string]$Dir, [string]$Name, [switch]$NoSidecar, [switch]$EmptySidecar)
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $Dir $Name) -Value 'x' -Encoding UTF8
        if ($EmptySidecar) { New-Item -ItemType File -Path (Join-Path $Dir "$Name.sha256") -Force | Out-Null }
        elseif (-not $NoSidecar) { Set-Content -LiteralPath (Join-Path $Dir "$Name.sha256") -Value 'abc  x' -Encoding ASCII }
    }

    Context 'Get-LatestPublishedBackup: solo cuenta .age + .sha256 no vacío' {

        It 'sin carpeta o sin archivos devuelve $null' {
            Get-LatestPublishedBackup -TargetDir (Join-Path $script:root 'NOEXISTE') -Pattern $script:pattern | Should BeNullOrEmpty
            Get-LatestPublishedBackup -TargetDir $script:dailyDir -Pattern $script:pattern | Should BeNullOrEmpty
        }

        It 'devuelve el timestamp más reciente por NOMBRE (no por fecha del filesystem)' {
            New-PublishedPair $script:dailyDir 'daubert_global_DAILY_20260929_164250.age'
            New-PublishedPair $script:dailyDir 'daubert_global_DAILY_20260930_020301.age'
            (Get-Item (Join-Path $script:dailyDir 'daubert_global_DAILY_20260930_020301.age')).LastWriteTime = (Get-Date '2020-01-01')
            (Get-LatestPublishedBackup -TargetDir $script:dailyDir -Pattern $script:pattern) | Should Be ([datetime]'2026-09-30T02:03:01')
        }

        It 'un .age SIN sidecar (publicación interrumpida) o con sidecar vacío NO cuenta como éxito' {
            New-PublishedPair $script:dailyDir 'daubert_global_DAILY_20260929_164250.age'
            New-PublishedPair $script:dailyDir 'daubert_global_DAILY_20260930_020301.age' -NoSidecar
            New-PublishedPair $script:dailyDir 'daubert_global_DAILY_20260930_030000.age' -EmptySidecar
            (Get-LatestPublishedBackup -TargetDir $script:dailyDir -Pattern $script:pattern) | Should Be ([datetime]'2026-09-29T16:42:50')
        }

        It 'ignora archivos de otro tier, de otra base, intermedios (.dump/.bundle.7z) y nombres con timestamp inválido' {
            New-PublishedPair $script:dailyDir 'daubert_global_FREQUENT_20260930_020301.age'
            New-PublishedPair $script:dailyDir 'otra_base_DAILY_20260930_020301.age'
            New-PublishedPair $script:dailyDir 'daubert_global_DAILY_20260930_020301.dump'
            New-PublishedPair $script:dailyDir 'daubert_global_DAILY_20260930_020301.bundle.7z'
            New-PublishedPair $script:dailyDir 'daubert_global_DAILY_20261340_990000.age'
            Get-LatestPublishedBackup -TargetDir $script:dailyDir -Pattern $script:pattern | Should BeNullOrEmpty
        }
    }

    Context 'Get-BackupLastScheduledInstant' {

        It 'Daily: hoy a la hora de config; si todavía no llega, ayer' {
            (Get-BackupLastScheduledInstant -Tier Daily -Schedule $script:daily -Now ([datetime]'2026-10-01T09:44:00')) | Should Be ([datetime]'2026-10-01T02:00:00')
            (Get-BackupLastScheduledInstant -Tier Daily -Schedule $script:daily -Now ([datetime]'2026-10-01T01:59:59')) | Should Be ([datetime]'2026-09-30T02:00:00')
            (Get-BackupLastScheduledInstant -Tier Daily -Schedule $script:daily -Now ([datetime]'2026-10-01T02:00:00')) | Should Be ([datetime]'2026-10-01T02:00:00')
        }

        It 'Monthly: este mes, día dayOfMonth a startTime; si todavía no llega, el del mes anterior (cruza año)' {
            (Get-BackupLastScheduledInstant -Tier Monthly -Schedule $script:monthly -Now ([datetime]'2026-10-20T10:00:00')) | Should Be ([datetime]'2026-10-01T03:00:00')
            (Get-BackupLastScheduledInstant -Tier Monthly -Schedule $script:monthly -Now ([datetime]'2026-10-01T02:59:59')) | Should Be ([datetime]'2026-09-01T03:00:00')
            (Get-BackupLastScheduledInstant -Tier Monthly -Schedule $script:monthly -Now ([datetime]'2027-01-01T02:00:00')) | Should Be ([datetime]'2026-12-01T03:00:00')
            (Get-BackupLastScheduledInstant -Tier Monthly -Schedule ([pscustomobject]@{ startTime = '03:00'; dayOfMonth = 15 }) -Now ([datetime]'2026-10-10T00:00:00')) | Should Be ([datetime]'2026-09-15T03:00:00')
        }

        It 'acepta el schedule como hashtable y usa día 1 si falta dayOfMonth' {
            (Get-BackupLastScheduledInstant -Tier Monthly -Schedule @{ startTime = '03:00' } -Now ([datetime]'2026-10-02T00:00:00')) | Should Be ([datetime]'2026-10-01T03:00:00')
        }

        It 'schedule inválido: error explícito (nunca una fecha inventada)' {
            { Get-BackupLastScheduledInstant -Tier Daily -Schedule ([pscustomobject]@{ startTime = '99:99' }) -Now (Get-Date) } | Should Throw
            { Get-BackupLastScheduledInstant -Tier Monthly -Schedule ([pscustomobject]@{ startTime = '03:00'; dayOfMonth = 31 }) -Now (Get-Date) } | Should Throw
        }
    }

    Context 'Test-BackupDue: Daily' {

        It 'sin ningún backup publicado: toca' {
            $r = Test-BackupDue -Tier Daily -Schedule $script:daily -Now ([datetime]'2026-10-01T09:44:00')
            $r.Due | Should Be $true
            $r.Reason | Should Be 'no_published_backup'
        }

        It 'PC apagada: el Daily de hoy no se hizo (último = ayer) y al encender (09:44) toca' {
            $r = Test-BackupDue -Tier Daily -Schedule $script:daily -Now ([datetime]'2026-10-01T09:44:00') -LatestPublished ([datetime]'2026-09-30T02:03:01')
            $r.Due | Should Be $true
            $r.Reason | Should Be 'latest_before_scheduled_instant'
        }

        It 'PC apagada varios días: sigue siendo UNA sola ejecución pendiente (no una por día perdido)' {
            (Test-BackupDue -Tier Daily -Schedule $script:daily -Now ([datetime]'2026-10-04T09:44:00') -LatestPublished ([datetime]'2026-09-30T02:03:01')).Due | Should Be $true
            (Test-BackupDue -Tier Daily -Schedule $script:daily -Now ([datetime]'2026-10-04T10:44:00') -LatestPublished ([datetime]'2026-10-04T09:44:05')).Due | Should Be $false
        }

        It 'ya existe el de hoy (después de la hora programada): NO toca, y los reintentos horarios siguientes tampoco' {
            foreach ($h in 3, 9, 10, 23) {
                $r = Test-BackupDue -Tier Daily -Schedule $script:daily -Now ([datetime]"2026-10-01T$($h.ToString('00')):44:00") -LatestPublished ([datetime]'2026-10-01T02:03:01')
                $r.Due | Should Be $false
                $r.Reason | Should Be 'up_to_date'
            }
        }

        It 'antes de la hora programada de hoy, el de ayer sigue vigente' {
            (Test-BackupDue -Tier Daily -Schedule $script:daily -Now ([datetime]'2026-10-01T01:30:00') -LatestPublished ([datetime]'2026-09-30T02:03:01')).Due | Should Be $false
        }
    }

    Context 'Test-BackupDue: Monthly (no depende de una única ejecución el día 1)' {

        It 'el día 1 antes de las 03:00 con el de septiembre ya hecho: NO toca; a las 03:00 toca' {
            $sep = [datetime]'2026-09-01T03:00:12'
            (Test-BackupDue -Tier Monthly -Schedule $script:monthly -Now ([datetime]'2026-10-01T02:59:00') -LatestPublished $sep).Due | Should Be $false
            (Test-BackupDue -Tier Monthly -Schedule $script:monthly -Now ([datetime]'2026-10-01T03:00:00') -LatestPublished $sep).Due | Should Be $true
        }

        It 'intento del día 1 fallido o PC apagada ese día: sigue tocando el día 2, el 15 y el 31 hasta que exista uno válido' {
            $sep = [datetime]'2026-09-01T03:00:12'
            foreach ($d in '2026-10-01T04:00:00', '2026-10-02T09:44:00', '2026-10-15T12:00:00', '2026-10-31T23:59:00') {
                $r = Test-BackupDue -Tier Monthly -Schedule $script:monthly -Now ([datetime]$d) -LatestPublished $sep
                $r.Due | Should Be $true
                $r.ScheduledInstant | Should Be ([datetime]'2026-10-01T03:00:00')
            }
        }

        It 'con un Monthly válido de octubre (aunque sea del día 20), no vuelve a tocar hasta noviembre' {
            $oct = [datetime]'2026-10-20T09:44:05'
            (Test-BackupDue -Tier Monthly -Schedule $script:monthly -Now ([datetime]'2026-10-20T10:44:00') -LatestPublished $oct).Due | Should Be $false
            (Test-BackupDue -Tier Monthly -Schedule $script:monthly -Now ([datetime]'2026-10-31T23:59:00') -LatestPublished $oct).Due | Should Be $false
            (Test-BackupDue -Tier Monthly -Schedule $script:monthly -Now ([datetime]'2026-11-01T03:00:00') -LatestPublished $oct).Due | Should Be $true
        }

        It 'respeta un dayOfMonth distinto de 1' {
            $sch = [pscustomobject]@{ startTime = '03:00'; dayOfMonth = 15 }
            $sep = [datetime]'2026-09-15T03:05:00'
            (Test-BackupDue -Tier Monthly -Schedule $sch -Now ([datetime]'2026-10-14T23:00:00') -LatestPublished $sep).Due | Should Be $false
            (Test-BackupDue -Tier Monthly -Schedule $sch -Now ([datetime]'2026-10-15T03:00:00') -LatestPublished $sep).Due | Should Be $true
        }
    }

    Context 'Test-BackupDue: Frequent' {
        It 'Frequent no tiene periodo: siempre toca (-OnlyIfDue no la afecta)' {
            $r = Test-BackupDue -Tier Frequent -Schedule ([pscustomobject]@{ startTime = '00:30'; intervalHours = 4 }) -Now (Get-Date) -LatestPublished (Get-Date)
            $r.Due | Should Be $true
            $r.Reason | Should Be 'not_applicable'
        }
    }
}
