#Requires -Version 5.1
<#
    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupConfig.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupConfig.psm1') -Force
. (Join-Path $PSScriptRoot 'helpers\TestDoubles.ps1')

Describe 'BackupConfig' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-config-test-" + [guid]::NewGuid().ToString('N'))
    }

    AfterEach {
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'Frequent: retiene 7 días, solo el dump (sin globals ni schema-only)' {
        $cfg = Get-BackupConfig -Tier Frequent -BackupRoot $script:root
        $cfg.RetentionUnit | Should Be 'Days'
        $cfg.RetentionValue | Should Be 7
        $cfg.IncludeGlobals | Should Be $false
        $cfg.SchemaOnlySnapshot | Should Be $false
        $cfg.TierDir | Should Be (Join-Path $script:root 'FREQUENT')
    }

    It 'Daily: retiene 30 días, dump + schema-only, SIN globals' {
        $cfg = Get-BackupConfig -Tier Daily -BackupRoot $script:root
        $cfg.RetentionUnit | Should Be 'Days'
        $cfg.RetentionValue | Should Be 30
        $cfg.IncludeGlobals | Should Be $false
        $cfg.SchemaOnlySnapshot | Should Be $true
        $cfg.TierDir | Should Be (Join-Path $script:root 'DAILY')
    }

    It 'Monthly: retiene 12 meses, dump + schema-only + globals' {
        $cfg = Get-BackupConfig -Tier Monthly -BackupRoot $script:root
        $cfg.RetentionUnit | Should Be 'Months'
        $cfg.RetentionValue | Should Be 12
        $cfg.IncludeGlobals | Should Be $true
        $cfg.SchemaOnlySnapshot | Should Be $true
        $cfg.TierDir | Should Be (Join-Path $script:root 'MONTHLY')
    }

    It 'permite sobre-escribir IncludeGlobals/SchemaOnlySnapshot explícitamente' {
        $cfg = Get-BackupConfig -Tier Frequent -BackupRoot $script:root -IncludeGlobals $true -SchemaOnlySnapshot $true
        $cfg.IncludeGlobals | Should Be $true
        $cfg.SchemaOnlySnapshot | Should Be $true
    }

    It 'rechaza un Tier inválido' {
        { Get-BackupConfig -Tier 'Weekly' -BackupRoot $script:root } | Should Throw
    }

    Context 'Test-BackupPrerequisite (cifrado asimétrico: solo clave pública)' {

        BeforeEach {
            New-Item -ItemType Directory -Path $script:root -Force | Out-Null
            # Las herramientas NO existen en disco: Test-BackupToolPath está mockeado y
            # solo "existen" las rutas registradas en memoria (sin archivos con nombres de herramientas reales).
            Clear-FakeTools
            Add-FakeTool -Path (Join-Path $script:root 'pg_dump.exe'), (Join-Path $script:root 'pg_restore.exe'), (Join-Path $script:root 'pg_dumpall.exe'), (Join-Path $script:root '7z.exe'), (Join-Path $script:root 'age.exe')
            Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig
            $script:pgpass = Join-Path $script:root 'pgpass.conf'
            Set-Content -LiteralPath $script:pgpass -Value 'placeholder' -Encoding UTF8

            # Archivo de destinatarios VÁLIDO: solo claves PÚBLICAS de age
            # (nunca secretas). Formato bech32 realista de 62 caracteres;
            # el valor concreto es inventado para pruebas, no una clave real.
            $script:validRecipients = Join-Path $script:root 'recipients.txt'
            Set-Content -LiteralPath $script:validRecipients -Value 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123' -Encoding ASCII
        }

        function New-TestConfig {
            param([hashtable]$Overrides = @{})
            $params = @{
                Tier               = 'Frequent'
                BackupRoot         = $script:root
                PgBinPath          = $script:root
                PgPassFile         = $script:pgpass
                SevenZipPath       = (Join-Path $script:root '7z.exe')
                AgePath            = (Join-Path $script:root 'age.exe')
                RecipientsFilePath = $script:validRecipients
            }
            foreach ($k in $Overrides.Keys) { $params[$k] = $Overrides[$k] }
            return Get-BackupConfig @params
        }

        It 'es válido cuando binarios, PgPassFile y el archivo de destinatarios están todos en orden' {
            $cfg = New-TestConfig
            $result = Test-BackupPrerequisite -Config $cfg
            $result.IsValid | Should Be $true
        }

        It 'falla si falta un binario de PostgreSQL requerido' {
            Remove-FakeTool -Path (Join-Path $script:root 'pg_restore.exe')
            $result = Test-BackupPrerequisite -Config (New-TestConfig)
            $result.IsValid | Should Be $false
        }

        It 'falla si PgPassFile no está configurado' {
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ PgPassFile = $null })
            $result.IsValid | Should Be $false
        }

        It 'falla si PgPassFile apunta a un archivo que no existe' {
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ PgPassFile = (Join-Path $script:root 'no-existe.conf') })
            $result.IsValid | Should Be $false
        }

        It 'Test-BackupPrerequisite nunca lee el contenido de PgPassFile' {
            # Si leyera el contenido y este no fuera texto válido, fallaría;
            # usamos bytes binarios para comprobar que solo se usa Test-Path.
            $binPgpass = Join-Path $script:root 'pgpass-binario.conf'
            [System.IO.File]::WriteAllBytes($binPgpass, (1..10 | ForEach-Object { [byte]$_ }))
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ PgPassFile = $binPgpass })
            $result.IsValid | Should Be $true
        }

        It 'falla si no existe 7z.exe (empaquetado) en la ruta configurada' {
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ SevenZipPath = (Join-Path $script:root 'no-existe-7z.exe') })
            $result.IsValid | Should Be $false
        }

        It 'falla si no existe age.exe (cifrado) en la ruta configurada' {
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ AgePath = (Join-Path $script:root 'no-existe-age.exe') })
            $result.IsValid | Should Be $false
        }

        It 'falla si el archivo de destinatarios no existe' {
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ RecipientsFilePath = (Join-Path $script:root 'no-existe-recipients.txt') })
            $result.IsValid | Should Be $false
        }

        It 'falla si el archivo de destinatarios existe pero está vacío' {
            $empty = Join-Path $script:root 'recipients-vacio.txt'
            Set-Content -LiteralPath $empty -Value '' -Encoding ASCII
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ RecipientsFilePath = $empty })
            $result.IsValid | Should Be $false
        }

        It 'falla si el archivo de destinatarios no contiene ninguna clave pública age reconocible' {
            $garbage = Join-Path $script:root 'recipients-basura.txt'
            Set-Content -LiteralPath $garbage -Value 'esto no es una clave age' -Encoding ASCII
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ RecipientsFilePath = $garbage })
            $result.IsValid | Should Be $false
        }

        It 'ignora líneas de comentario ("#") y vacías en el archivo de destinatarios' {
            $withComments = Join-Path $script:root 'recipients-con-comentarios.txt'
            @(
                '# Destinatario principal (Task Scheduler)'
                ''
                'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123'
                '# Destinatario de respaldo'
            ) | Set-Content -LiteralPath $withComments -Encoding ASCII
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ RecipientsFilePath = $withComments })
            $result.IsValid | Should Be $true
        }

        It 'la clave privada NUNCA se menciona ni se requiere: Test-BackupPrerequisite no tiene ningún parámetro relacionado con ella' {
            $cmd = Get-Command Test-BackupPrerequisite
            $cmd.Parameters.Keys | Where-Object { $_ -match 'Private|Identity|SecretKey' } | Should BeNullOrEmpty
        }

        It 'los mensajes de error nunca contienen nada parecido a una clave privada age (AGE-SECRET-KEY)' {
            $garbage = Join-Path $script:root 'recipients-basura2.txt'
            Set-Content -LiteralPath $garbage -Value 'no-es-una-clave' -Encoding ASCII
            $result = Test-BackupPrerequisite -Config (New-TestConfig -Overrides @{ RecipientsFilePath = $garbage })
            ($result.Errors -join ' ') | Should Not Match 'AGE-SECRET-KEY'
        }
    }
}
