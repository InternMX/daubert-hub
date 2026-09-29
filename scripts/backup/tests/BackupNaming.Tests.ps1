#Requires -Version 5.1
<#
    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupNaming.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupNaming.psm1') -Force

Describe 'BackupNaming' {

    It 'genera un timestamp inequívoco con segundos' {
        $ts = New-BackupTimestamp -Now (Get-Date '2026-09-28 14:03:07')
        $ts | Should Be '20260928_140307'
    }

    It 'genera nombres de archivo distintos para Frequent/Daily/Monthly' {
        $ts = '20260928_140307'
        $frequent = New-BackupFileName -Kind Dump -Tier Frequent -Database daubert_global -Timestamp $ts
        $daily = New-BackupFileName -Kind Dump -Tier Daily -Database daubert_global -Timestamp $ts
        $monthly = New-BackupFileName -Kind Dump -Tier Monthly -Database daubert_global -Timestamp $ts

        $frequent | Should Be 'daubert_global_FREQUENT_20260928_140307.dump'
        $daily | Should Be 'daubert_global_DAILY_20260928_140307.dump'
        $monthly | Should Be 'daubert_global_MONTHLY_20260928_140307.dump'
    }

    It 'genera nombres distintos para Dump/Globals/SchemaOnly' {
        $ts = '20260928_140307'
        (New-BackupFileName -Kind Globals -Tier Daily -Database daubert_global -Timestamp $ts) | Should Be 'globals_DAILY_20260928_140307.sql'
        (New-BackupFileName -Kind SchemaOnly -Tier Daily -Database daubert_global -Timestamp $ts) | Should Be 'daubert_global_schema_DAILY_20260928_140307.dump'
    }

    It 'genera el nombre del artefacto cifrado con age (Archive, .age) y difiere del .dump sin cifrar' {
        $ts = '20260928_140307'
        $archive = New-BackupFileName -Kind Archive -Tier Frequent -Database daubert_global -Timestamp $ts
        $dump = New-BackupFileName -Kind Dump -Tier Frequent -Database daubert_global -Timestamp $ts

        $archive | Should Be 'daubert_global_FREQUENT_20260928_140307.age'
        $archive | Should Not Be $dump
    }

    It 'genera el nombre del bundle intermedio sin cifrar (Bundle, .bundle.7z)' {
        $ts = '20260928_140307'
        $bundle = New-BackupFileName -Kind Bundle -Tier Daily -Database daubert_global -Timestamp $ts
        $bundle | Should Be 'daubert_global_DAILY_20260928_140307.bundle.7z'
    }

    It 'el patrón Archive reconoce el .age y no el .dump del mismo tier/timestamp' {
        $ts = '20260928_140307'
        $archiveName = New-BackupFileName -Kind Archive -Tier Monthly -Database daubert_global -Timestamp $ts
        $dumpName = New-BackupFileName -Kind Dump -Tier Monthly -Database daubert_global -Timestamp $ts
        $archivePattern = Get-BackupFileNamePattern -Kind Archive -Tier Monthly -Database daubert_global

        $archiveName -match $archivePattern | Should Be $true
        $Matches['timestamp'] | Should Be $ts
        $dumpName -match $archivePattern | Should Be $false
    }

    It 'el patrón de retención reconoce el nombre generado' {
        $ts = New-BackupTimestamp -Now (Get-Date '2026-09-28 14:03:07')
        $name = New-BackupFileName -Kind Dump -Tier Frequent -Database daubert_global -Timestamp $ts
        $pattern = Get-BackupFileNamePattern -Kind Dump -Tier Frequent -Database daubert_global
        $name -match $pattern | Should Be $true
        $Matches['timestamp'] | Should Be $ts
    }

    It 'el patrón de un tier NO reconoce el nombre de otro tier' {
        $ts = New-BackupTimestamp -Now (Get-Date '2026-09-28 14:03:07')
        $dailyName = New-BackupFileName -Kind Dump -Tier Daily -Database daubert_global -Timestamp $ts
        $frequentPattern = Get-BackupFileNamePattern -Kind Dump -Tier Frequent -Database daubert_global
        $dailyName -match $frequentPattern | Should Be $false
    }

    It 'ConvertFrom-BackupTimestamp parsea correctamente un timestamp válido' {
        $result = ConvertFrom-BackupTimestamp -Timestamp '20260928_140307'
        $result | Should Not BeNullOrEmpty
        $result.Year | Should Be 2026
        $result.Hour | Should Be 14
    }

    It 'ConvertFrom-BackupTimestamp devuelve $null ante un timestamp inválido' {
        $result = ConvertFrom-BackupTimestamp -Timestamp 'no-es-un-timestamp'
        $result | Should BeNullOrEmpty
    }
}
