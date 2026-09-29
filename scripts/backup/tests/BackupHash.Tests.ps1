#Requires -Version 5.1
<#
    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupHash.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupHash.psm1') -Force

Describe 'BackupHash' {

    BeforeEach {
        $script:testDir = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-hash-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:testDir -Force | Out-Null
        $script:filePath = Join-Path $script:testDir 'sample.dump'
        Set-Content -LiteralPath $script:filePath -Value 'contenido-de-prueba' -Encoding UTF8
    }

    AfterEach {
        Remove-Item -LiteralPath $script:testDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'calcula el hash SHA-256 y escribe el sidecar' {
        $result = New-BackupFileHash -Path $script:filePath
        $result.Hash | Should Match '^[0-9a-f]{64}$'
        Test-Path -LiteralPath $result.SidecarPath | Should Be $true
    }

    It 'el sidecar contiene el hash y el nombre de archivo, nunca el contenido' {
        $result = New-BackupFileHash -Path $script:filePath
        $sidecarContent = Get-Content -LiteralPath $result.SidecarPath -Raw
        $sidecarContent | Should Match ([regex]::Escape($result.Hash))
        $sidecarContent | Should Match 'sample\.dump'
        $sidecarContent | Should Not Match 'contenido-de-prueba'
    }

    It 'Test-BackupFileHash devuelve $true cuando el archivo no cambió' {
        New-BackupFileHash -Path $script:filePath | Out-Null
        Test-BackupFileHash -Path $script:filePath | Should Be $true
    }

    It 'Test-BackupFileHash devuelve $false si el archivo fue alterado tras el hash (falla de integridad)' {
        New-BackupFileHash -Path $script:filePath | Out-Null
        Add-Content -LiteralPath $script:filePath -Value 'dato-adicional-no-esperado'
        Test-BackupFileHash -Path $script:filePath | Should Be $false
    }

    It 'Test-BackupFileHash devuelve $false si no existe sidecar ni ExpectedHash' {
        Test-BackupFileHash -Path $script:filePath | Should Be $false
    }

    It 'New-BackupFileHash lanza error si el archivo no existe (fallo de hash)' {
        $missing = Join-Path $script:testDir 'no-existe.dump'
        { New-BackupFileHash -Path $missing } | Should Throw
    }
}
