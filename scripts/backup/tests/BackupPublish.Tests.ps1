#Requires -Version 5.1
<#
    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupPublish.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupPublish.psm1') -Force

Describe 'BackupPublish' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-publish-test-" + [guid]::NewGuid().ToString('N'))
        $script:stagingDir = Join-Path $script:root 'staging'
        $script:destDir = Join-Path $script:root 'FREQUENT'
        New-Item -ItemType Directory -Path $script:stagingDir -Force | Out-Null
        $script:stagingFile = Join-Path $script:stagingDir 'daubert_global_FREQUENT_20260928_140000.dump'
        Set-Content -LiteralPath $script:stagingFile -Value 'contenido' -Encoding UTF8
        Set-Content -LiteralPath "$script:stagingFile.sha256" -Value 'hash  daubert_global_FREQUENT_20260928_140000.dump' -Encoding ASCII
    }

    AfterEach {
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'mueve el dump y su sidecar .sha256 al destino final (publicación solo tras validar)' {
        $dest = Publish-BackupArtifact -StagingPath $script:stagingFile -DestinationDir $script:destDir -BackupRoot $script:root -FileName 'daubert_global_FREQUENT_20260928_140000.dump'

        Test-Path -LiteralPath $dest | Should Be $true
        Test-Path -LiteralPath "$dest.sha256" | Should Be $true
        Test-Path -LiteralPath $script:stagingFile | Should Be $false
    }

    It 'falla (fallo de copia final) si el staging no existe' {
        { Publish-BackupArtifact -StagingPath (Join-Path $script:stagingDir 'no-existe.dump') -DestinationDir $script:destDir -BackupRoot $script:root -FileName 'no-existe.dump' } | Should Throw
    }

    It 'nunca sobreescribe un archivo ya publicado con el mismo nombre' {
        New-Item -ItemType Directory -Path $script:destDir -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $script:destDir 'daubert_global_FREQUENT_20260928_140000.dump') -Value 'ya existente' -Encoding UTF8

        { Publish-BackupArtifact -StagingPath $script:stagingFile -DestinationDir $script:destDir -BackupRoot $script:root -FileName 'daubert_global_FREQUENT_20260928_140000.dump' } | Should Throw

        # el backup previamente válido no se toca
        (Get-Content -LiteralPath (Join-Path $script:destDir 'daubert_global_FREQUENT_20260928_140000.dump') -Raw) | Should Match 'ya existente'
    }

    It 'rechaza publicar fuera de BackupRoot (protección de rutas defensivas)' {
        $outsideDest = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-outside-" + [guid]::NewGuid().ToString('N'))
        try {
            { Publish-BackupArtifact -StagingPath $script:stagingFile -DestinationDir $outsideDest -BackupRoot $script:root -FileName 'x.dump' } | Should Throw
        }
        finally {
            Remove-Item -LiteralPath $outsideDest -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'crea el directorio de destino si todavía no existe' {
        Test-Path -LiteralPath $script:destDir | Should Be $false
        Publish-BackupArtifact -StagingPath $script:stagingFile -DestinationDir $script:destDir -BackupRoot $script:root -FileName 'daubert_global_FREQUENT_20260928_140000.dump' | Out-Null
        Test-Path -LiteralPath $script:destDir | Should Be $true
    }

    It 'nunca publica un artefacto sin su sidecar .sha256 en staging' {
        Remove-Item -LiteralPath "$script:stagingFile.sha256" -Force
        { Publish-BackupArtifact -StagingPath $script:stagingFile -DestinationDir $script:destDir -BackupRoot $script:root -FileName 'daubert_global_FREQUENT_20260928_140000.dump' } | Should Throw
        Test-Path -LiteralPath (Join-Path $script:destDir 'daubert_global_FREQUENT_20260928_140000.dump') | Should Be $false
    }

    It 'rechaza publicar si ya hay un sidecar .sha256 huérfano en el destino (nunca deja pares inconsistentes)' {
        New-Item -ItemType Directory -Path $script:destDir -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $script:destDir 'daubert_global_FREQUENT_20260928_140000.dump.sha256') -Value 'hash-huerfano  archivo' -Encoding ASCII

        { Publish-BackupArtifact -StagingPath $script:stagingFile -DestinationDir $script:destDir -BackupRoot $script:root -FileName 'daubert_global_FREQUENT_20260928_140000.dump' } | Should Throw
        Test-Path -LiteralPath (Join-Path $script:destDir 'daubert_global_FREQUENT_20260928_140000.dump') | Should Be $false
    }

    It 'si falla mover el sidecar tras mover el artefacto principal, revierte (no deja el artefacto sin su .sha256)' {
        New-Item -ItemType Directory -Path $script:destDir -Force | Out-Null
        # Forzamos el fallo del segundo Move-Item: bloqueamos el archivo de
        # sidecar en staging con un handle exclusivo (sin FileShare), de modo
        # que cuando Publish-BackupArtifact intente moverlo (después de haber
        # movido ya el artefacto principal), Move-Item falle con IOException.
        $lockedStream = [System.IO.File]::Open("$script:stagingFile.sha256", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
        try {
            { Publish-BackupArtifact -StagingPath $script:stagingFile -DestinationDir $script:destDir -BackupRoot $script:root -FileName 'daubert_global_FREQUENT_20260928_140000.dump' } | Should Throw
        }
        finally {
            $lockedStream.Dispose()
        }

        # El artefacto principal NO debe quedar publicado sin su sidecar.
        Test-Path -LiteralPath (Join-Path $script:destDir 'daubert_global_FREQUENT_20260928_140000.dump') | Should Be $false
    }
}
