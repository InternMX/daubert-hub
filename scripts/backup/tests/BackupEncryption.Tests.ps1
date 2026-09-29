#Requires -Version 5.1
<#
    Pruebas de BackupEncryption.psm1 (cifrado asimétrico con age).

    age NO está instalado en este entorno de pruebas (por instrucción
    explícita: "No instales age/GPG todavía") y NO se crea ningún ejecutable
    falso: el seam Invoke-AgeProcess se mockea con Pester para simular exit
    codes, stdout/stderr y el archivo de salida, y el propio seam se prueba
    con binarios reales del sistema (cmd.exe / ping.exe). NINGUNA prueba usa
    ni necesita una clave privada: el diseño entero de este módulo es que el
    job jamás la tiene.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupEncryption.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupEncryption.psm1') -Force

$script:fakeAgePath = 'age-simulado-no-existe-en-disco'

# Contenido que imita la FORMA estructural de un archivo age real (cabecera
# + al menos una línea de destinatario + payload), sin ser cifrado de
# verdad: suficiente para probar Test-AgeArtifactStructure de forma
# determinista sin age.exe real. Repetido para superar el tamaño mínimo.
$script:fakeValidAgeContent = "age-encryption.org/v1`n-> X25519 abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHI`nsomeMacLineBase64Encoded1234567890==`n" + ('X' * 200)

Describe 'BackupEncryption - Test-BackupRecipientsFile (claves PÚBLICAS, nunca secretas)' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-recipients-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
    }

    AfterEach {
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'es válido con al menos una clave pública age (age1...)' {
        $path = Join-Path $script:root 'recipients.txt'
        Set-Content -LiteralPath $path -Value 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123' -Encoding ASCII
        $result = Test-BackupRecipientsFile -RecipientsFilePath $path
        $result.IsValid | Should Be $true
        $result.RecipientCount | Should Be 1
    }

    It 'admite múltiples destinatarios (varias claves públicas, una por línea)' {
        $path = Join-Path $script:root 'recipients.txt'
        @(
            'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123'
            'age1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
        ) | Set-Content -LiteralPath $path -Encoding ASCII
        $result = Test-BackupRecipientsFile -RecipientsFilePath $path
        $result.IsValid | Should Be $true
        $result.RecipientCount | Should Be 2
    }

    It 'ignora comentarios ("#") y líneas vacías' {
        $path = Join-Path $script:root 'recipients.txt'
        @('# comentario', '', 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123', '# otro comentario') | Set-Content -LiteralPath $path -Encoding ASCII
        $result = Test-BackupRecipientsFile -RecipientsFilePath $path
        $result.IsValid | Should Be $true
    }

    It 'NO es válido si el archivo no existe' {
        $result = Test-BackupRecipientsFile -RecipientsFilePath (Join-Path $script:root 'no-existe.txt')
        $result.IsValid | Should Be $false
    }

    It 'NO es válido si no hay ninguna clave con forma de clave pública age' {
        $path = Join-Path $script:root 'recipients.txt'
        Set-Content -LiteralPath $path -Value 'esto-no-es-una-clave-age' -Encoding ASCII
        $result = Test-BackupRecipientsFile -RecipientsFilePath $path
        $result.IsValid | Should Be $false
    }

    It 'NO es válido si el archivo está vacío' {
        $path = Join-Path $script:root 'recipients.txt'
        Set-Content -LiteralPath $path -Value '' -Encoding ASCII
        $result = Test-BackupRecipientsFile -RecipientsFilePath $path
        $result.IsValid | Should Be $false
    }
}

Describe 'BackupEncryption - New-AgeEncryptedArtifact / Test-AgeArtifactStructure (Invoke-AgeProcess mockeado)' {

    BeforeEach {
        $global:AgeSim = @{ ExitCode = 0; Mode = 'SUCCESS'; Content = $script:fakeValidAgeContent; StdErr = ''; Args = $null }
        Mock Invoke-AgeProcess {
            $global:AgeSim.Args = $ArgumentList
            $o = $null; for ($i = 0; $i -lt $ArgumentList.Count - 1; $i++) { if ($ArgumentList[$i] -eq '-o') { $o = $ArgumentList[$i + 1] } }
            if ($o -and $global:AgeSim.Mode -ne 'NO_FILE') { [System.IO.File]::WriteAllText($o, $global:AgeSim.Content) }
            [pscustomobject]@{ ExitCode = $global:AgeSim.ExitCode; StdOut = ''; StdErr = $global:AgeSim.StdErr }
        } -ModuleName BackupEncryption
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-age-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:inputPath = Join-Path $script:root 'plaintext.dump'
        Set-Content -LiteralPath $script:inputPath -Value 'contenido de prueba, no sensible' -Encoding UTF8
        $script:recipientsPath = Join-Path $script:root 'recipients.txt'
        Set-Content -LiteralPath $script:recipientsPath -Value 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123' -Encoding ASCII
        $script:outputPath = Join-Path $script:root 'output.age'
    }

    AfterEach {
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'reporta éxito cuando age.exe termina en 0 y crea el archivo de salida' {
        $result = New-AgeEncryptedArtifact -AgePath $script:fakeAgePath -RecipientsFilePath $script:recipientsPath -InputPath $script:inputPath -OutputPath $script:outputPath -TimeoutSeconds 30
        $result.Success | Should Be $true
        Test-Path -LiteralPath $script:outputPath | Should Be $true
    }

    It 'reporta fallo (fallo de cifrado) si age.exe termina con código distinto de 0' {
        $global:AgeSim.Mode = 'NO_FILE'; $global:AgeSim.ExitCode = 1; $global:AgeSim.StdErr = 'age: error'
        $result = New-AgeEncryptedArtifact -AgePath $script:fakeAgePath -RecipientsFilePath $script:recipientsPath -InputPath $script:inputPath -OutputPath $script:outputPath -TimeoutSeconds 30
        $result.Success | Should Be $false
    }

    It 'invoca age solo con -R <destinatarios> -o <salida> <entrada> (cifrar; sin -d ni -i)' {
        New-AgeEncryptedArtifact -AgePath $script:fakeAgePath -RecipientsFilePath $script:recipientsPath -InputPath $script:inputPath -OutputPath $script:outputPath -TimeoutSeconds 30 | Out-Null
        $global:AgeSim.Args | Should Be @('-R', $script:recipientsPath, '-o', $script:outputPath, $script:inputPath)
    }

    It 'expone stderr de age en StdErrTail cuando falla' {
        $global:AgeSim.ExitCode = 1; $global:AgeSim.Mode = 'NO_FILE'; $global:AgeSim.StdErr = 'age: error: recipient inválido'
        (New-AgeEncryptedArtifact -AgePath $script:fakeAgePath -RecipientsFilePath $script:recipientsPath -InputPath $script:inputPath -OutputPath $script:outputPath).StdErrTail | Should Match 'recipient'
    }

    It 'el exit code 0 sin archivo de salida sigue reportando Success=true (lo detecta el pipeline con Test-Path)' {
        $global:AgeSim.Mode = 'NO_FILE'
        $r = New-AgeEncryptedArtifact -AgePath $script:fakeAgePath -RecipientsFilePath $script:recipientsPath -InputPath $script:inputPath -OutputPath $script:outputPath
        $r.Success | Should Be $true
        Test-Path -LiteralPath $script:outputPath | Should Be $false
    }

    It 'nunca incluye ninguna clave PRIVADA en los argumentos: New-AgeEncryptedArtifact no tiene parámetro para ella' {
        $cmd = Get-Command New-AgeEncryptedArtifact
        $cmd.Parameters.Keys | Where-Object { $_ -match 'Private|Identity|SecretKey' } | Should BeNullOrEmpty
    }

    Context 'Test-AgeArtifactStructure' {

        It 'es válida con un artefacto que tiene la cabecera age y una línea de destinatario' {
            Set-Content -LiteralPath $script:outputPath -Value $script:fakeValidAgeContent -Encoding ASCII -NoNewline
            $result = Test-AgeArtifactStructure -Path $script:outputPath
            $result.IsValid | Should Be $true
        }

        It 'NO es válida (fallo de validación estructural) si falta la cabecera age-encryption.org/v1' {
            Set-Content -LiteralPath $script:outputPath -Value ('no es un archivo age' + ('X' * 200)) -Encoding ASCII -NoNewline
            $result = Test-AgeArtifactStructure -Path $script:outputPath
            $result.IsValid | Should Be $false
        }

        It 'NO es válida si el archivo es demasiado pequeño (dump vacío que se "cifró")' {
            Set-Content -LiteralPath $script:outputPath -Value 'age-encryption.org/v1' -Encoding ASCII -NoNewline
            $result = Test-AgeArtifactStructure -Path $script:outputPath -MinimumSizeBytes 100
            $result.IsValid | Should Be $false
        }

        It 'NO es válida si el archivo no existe' {
            $result = Test-AgeArtifactStructure -Path (Join-Path $script:root 'no-existe.age')
            $result.IsValid | Should Be $false
        }

        It 'nunca requiere una clave privada: Test-AgeArtifactStructure no tiene parámetro para ella (validación sin descifrar)' {
            $cmd = Get-Command Test-AgeArtifactStructure
            $cmd.Parameters.Keys | Where-Object { $_ -match 'Private|Identity|SecretKey' } | Should BeNullOrEmpty
        }
    }
}

Describe 'BackupEncryption - Invoke-AgeProcess (seam real, probado con binarios del sistema; sin ejecutables falsos)' {

    BeforeAll { $script:cmd = $env:ComSpec; $script:ping = Join-Path $env:SystemRoot 'System32\PING.EXE' }

    It 'devuelve exit code, stdout y stderr del proceso' {
        $r = Invoke-AgeProcess -AgePath $script:cmd -ArgumentList @('/c', 'echo hola& echo problema 1>&2& exit 7')
        $r.ExitCode | Should Be 7
        $r.StdOut | Should Match 'hola'
        $r.StdErr | Should Match 'problema'
    }

    It 'termina el proceso y lanza si excede el timeout' {
        { Invoke-AgeProcess -AgePath $script:ping -ArgumentList @('-n', '30', '127.0.0.1') -TimeoutSeconds 1 } | Should Throw
    }

    It 'lanza si el ejecutable no existe en la ruta indicada' {
        { New-AgeEncryptedArtifact -AgePath (Join-Path ([System.IO.Path]::GetTempPath()) 'no-existe-cifrador.bin') -RecipientsFilePath 'r.txt' -InputPath 'i' -OutputPath 'o' -TimeoutSeconds 10 } | Should Throw
    }
}
