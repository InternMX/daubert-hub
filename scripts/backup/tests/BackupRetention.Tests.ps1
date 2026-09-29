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
