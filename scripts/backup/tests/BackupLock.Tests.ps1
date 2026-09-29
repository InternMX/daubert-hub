#Requires -Version 5.1
<#
    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupLock.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupLock.psm1') -Force

Describe 'BackupLock' {

    BeforeEach {
        $script:testLockDir = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-lock-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:testLockDir -Force | Out-Null
        $script:lockPath = Join-Path $script:testLockDir 'backup.lock'
    }

    AfterEach {
        Remove-Item -LiteralPath $script:testLockDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'adquiere el lock cuando no existe ninguna ejecución en curso' {
        $handle = Enter-BackupLock -LockFilePath $script:lockPath
        Test-Path -LiteralPath $script:lockPath | Should Be $true
        Exit-BackupLock -LockHandle $handle
    }

    It 'libera el lock y borra el archivo al salir' {
        $handle = Enter-BackupLock -LockFilePath $script:lockPath
        Exit-BackupLock -LockHandle $handle
        Test-Path -LiteralPath $script:lockPath | Should Be $false
    }

    It 'una segunda adquisición concurrente falla mientras el lock esté tomado (ejecución simultánea)' {
        $handle1 = Enter-BackupLock -LockFilePath $script:lockPath
        try {
            { Enter-BackupLock -LockFilePath $script:lockPath -TimeoutSeconds 0 } | Should Throw
        }
        finally {
            Exit-BackupLock -LockHandle $handle1
        }
    }

    It 'tras liberar el lock, una nueva adquisición vuelve a funcionar' {
        $handle1 = Enter-BackupLock -LockFilePath $script:lockPath
        Exit-BackupLock -LockHandle $handle1

        $handle2 = Enter-BackupLock -LockFilePath $script:lockPath
        Test-Path -LiteralPath $script:lockPath | Should Be $true
        Exit-BackupLock -LockHandle $handle2
    }

    It 'con TimeoutSeconds > 0 espera y adquiere el lock apenas se libera' {
        $handle1 = Enter-BackupLock -LockFilePath $script:lockPath

        $job = Start-Job -ScriptBlock {
            param($modulePath, $lockPath)
            Import-Module $modulePath -Force
            $h = Enter-BackupLock -LockFilePath $lockPath -TimeoutSeconds 10 -PollIntervalSeconds 1
            Exit-BackupLock -LockHandle $h
            'acquired'
        } -ArgumentList (Join-Path $moduleRoot 'lib\BackupLock.psm1'), $script:lockPath

        Start-Sleep -Seconds 2
        Exit-BackupLock -LockHandle $handle1

        $result = Wait-Job $job -Timeout 15 | Receive-Job
        Remove-Job $job -Force -ErrorAction SilentlyContinue
        $result | Should Be 'acquired'
    }

    It 'Exit-BackupLock no falla si se le pasa $null' {
        { Exit-BackupLock -LockHandle $null } | Should Not Throw
    }
}

Describe 'BackupLock - un lock huérfano (proceso muerto) nunca bloquea ejecuciones futuras' {

    BeforeEach {
        $script:dir = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-lock-orphan-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:dir -Force | Out-Null
        $script:lockPath = Join-Path $script:dir 'backup.lock'
    }
    AfterEach { Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue }

    It 'un archivo de lock que quedó en disco SIN dueño (kill anterior) no bloquea: se adquiere normalmente' {
        Set-Content -LiteralPath $script:lockPath -Value "pid=99999`r`nstarted_utc=2020-01-01T00:00:00.0000000Z" -Encoding ASCII
        $h = Enter-BackupLock -LockFilePath $script:lockPath -TimeoutSeconds 0
        try { $h | Should Not BeNullOrEmpty }
        finally { Exit-BackupLock -LockHandle $h }
        Test-Path -LiteralPath $script:lockPath | Should Be $false
    }

    It 'si el proceso termina SIN liberar el lock, el sistema operativo lo elimina (DeleteOnClose) y el siguiente run corre' {
        $mod = Join-Path $moduleRoot 'lib\BackupLock.psm1'
        $cmd = "Import-Module '$mod' -Force; Enter-BackupLock -LockFilePath '$($script:lockPath)' | Out-Null; exit 0"
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd | Out-Null
        Test-Path -LiteralPath $script:lockPath | Should Be $false
        $h = Enter-BackupLock -LockFilePath $script:lockPath -TimeoutSeconds 0
        Exit-BackupLock -LockHandle $h
    }

    It 'mientras un dueño VIVO lo tiene abierto, sigue bloqueando (exclusión mutua intacta)' {
        $h = Enter-BackupLock -LockFilePath $script:lockPath
        try { { Enter-BackupLock -LockFilePath $script:lockPath -TimeoutSeconds 0 } | Should Throw }
        finally { Exit-BackupLock -LockHandle $h }
    }

    It 'el mensaje de bloqueo ya no sugiere un "lock huérfano" (ese caso ahora se resuelve solo)' {
        $h = Enter-BackupLock -LockFilePath $script:lockPath
        try {
            $msg = try { Enter-BackupLock -LockFilePath $script:lockPath -TimeoutSeconds 0; '' } catch { $_.Exception.Message }
            $msg | Should Match 'ejecución en curso'
            $msg | Should Not Match 'huérfano'
        }
        finally { Exit-BackupLock -LockHandle $h }
    }
}
