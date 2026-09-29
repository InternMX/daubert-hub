#Requires -Version 5.1
<#
    Pruebas de portabilidad y de higiene del repositorio: el sistema de
    backups debe poder instalarse en otra máquina sin editar código.
    Inspeccionan el código fuente (no ejecutan PostgreSQL, age, Task
    Scheduler ni tocan secretos).

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\Portability.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot                    # scripts\backup
$repoRoot = Split-Path -Parent (Split-Path -Parent $moduleRoot)   # raíz del repo
Import-Module (Join-Path $moduleRoot 'lib\BackupConfig.psm1') -Force
Import-Module (Join-Path $moduleRoot 'lib\BackupLocalConfig.psm1') -Force

# Los patrones "prohibidos" se construyen por partes para que este archivo no se detecte a sí mismo.
$script:userProfilePattern = 'C:\\U' + 'sers\\'
$script:personalUserPattern = 'Users' + '[\\/]0' + '6\b'

function Get-CodeFiles {
    param([switch]$IncludeTests)
    $files = Get-ChildItem -LiteralPath $moduleRoot -Recurse -File -Include '*.ps1', '*.psm1', '*.cs' | Where-Object { $_.FullName -notmatch '\\fixtures\\' -or $IncludeTests }
    if (-not $IncludeTests) { $files = $files | Where-Object { $_.FullName -notmatch '\\tests\\' } }
    $files
}

function Get-DocFiles {
    $docs = @()
    foreach ($d in 'docs\operations', 'docs\database') {
        $p = Join-Path $repoRoot $d
        if (Test-Path -LiteralPath $p) { $docs += Get-ChildItem -LiteralPath $p -Recurse -File -Include '*.md' }
    }
    $docs
}

Describe 'Portabilidad - sin dependencias de la máquina o el usuario original' {

    It 'ningún código operativo (lib/scripts) depende de C:\Users\<usuario>' {
        $offenders = @(Get-CodeFiles | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match $script:userProfilePattern } | ForEach-Object { $_.Name })
        $offenders | Should BeNullOrEmpty
    }

    It 'ninguna prueba ni fixture depende de C:\Users\<usuario>' {
        $offenders = @(Get-CodeFiles -IncludeTests | Where-Object { $_.Name -ne 'Portability.Tests.ps1' } | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match $script:userProfilePattern } | ForEach-Object { $_.Name })
        $offenders | Should BeNullOrEmpty
    }

    It 'ni el código ni la documentación operativa del backup mencionan el usuario personal original' {
        $offenders = @((Get-CodeFiles -IncludeTests) + (Get-DocFiles | Where-Object { $_.Name -match 'backup' }) |
            Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match $script:personalUserPattern } | ForEach-Object { $_.Name })
        $offenders | Should BeNullOrEmpty
    }

    It 'no hay rutas de Dropbox, PostgreSQL 18, 7-Zip o age hardcodeadas en el código operativo' {
        $bad = @(
            'HERRAMIENTAS AUTOMATIZACION',
            'C:\\Program Files\\PostgreSQL',
            'PostgreSQL\\\d+\\bin',
            'C:\\Program Files\\7-Zip',
            'C:\\Program Files\\age'
        )
        foreach ($f in (Get-CodeFiles)) {
            $text = Get-Content -LiteralPath $f.FullName -Raw
            foreach ($b in $bad) { ($text -match $b) | Should Be $false }
        }
    }

    It 'no hay ninguna unidad/ruta absoluta fija en el código operativo (solo variables del sistema, config o detección)' {
        foreach ($f in (Get-CodeFiles)) {
            foreach ($line in (Get-Content -LiteralPath $f.FullName)) {
                if ($line -match '^\s*#') { continue }
                # Literales tipo 'C:\algo' dentro de comillas (excluye patrones regex como [A-Za-z]:\\)
                if ($line -match "['""][A-Za-z]:\\[A-Za-z0-9 _]") { ($line.Trim()) | Should BeNullOrEmpty }
            }
        }
    }

    It 'el layout por defecto se deriva solo de variables estándar (ProgramData/LOCALAPPDATA)' {
        $p = Get-DefaultBackupPaths
        $p.ConfigPath.StartsWith($env:ProgramData, [System.StringComparison]::OrdinalIgnoreCase) | Should Be $true
        $p.PgPassFile.StartsWith($env:LOCALAPPDATA, [System.StringComparison]::OrdinalIgnoreCase) | Should Be $true
    }

    It 'el entrypoint canónico es commands\Start-DaubertPostgresBackup.ps1, sin copias, alias ni wrappers en otra ruta' {
        Test-Path -LiteralPath (Join-Path $moduleRoot 'commands\Start-DaubertPostgresBackup.ps1') -PathType Leaf | Should Be $true
        Test-Path -LiteralPath (Join-Path $moduleRoot 'Start-DaubertPostgresBackup.ps1') | Should Be $false
        @(Get-ChildItem -LiteralPath $moduleRoot -Recurse -File | Where-Object { $_.Name -like 'Start-DaubertPostgresBackup*.ps1' }).Count | Should Be 1
        @(Get-ChildItem -LiteralPath $moduleRoot -File | Where-Object { $_.Extension -eq '.ps1' }).Count | Should Be 0
    }

    It 'los cinco comandos operativos viven en scripts/backup/commands' {
        foreach ($n in 'Start-DaubertPostgresBackup', 'Install-DaubertBackup', 'Test-DaubertBackupEnvironment', 'Register-DaubertBackupTasks', 'Unregister-DaubertBackupTasks') {
            Test-Path -LiteralPath (Join-Path $moduleRoot "commands\$n.ps1") -PathType Leaf | Should Be $true
        }
    }

    It 'ninguna referencia (código, tests, docs) apunta a scripts/backup/<comando>.ps1 sin commands/' {
        $rx = '(scripts[\\/]backup[\\/]|\.[\\/])(Start-DaubertPostgresBackup|Install-DaubertBackup|Test-DaubertBackupEnvironment|Register-DaubertBackupTasks|Unregister-DaubertBackupTasks)\.ps1'
        $files = @(Get-CodeFiles -IncludeTests | Where-Object { $_.Name -ne 'Portability.Tests.ps1' }) + @(Get-DocFiles)
        $bad = New-Object System.Collections.Generic.List[string]
        foreach ($f in $files) {
            $n = 0
            foreach ($line in (Get-Content -LiteralPath $f.FullName)) {
                $n++
                if ($line -match $rx -and $line -notmatch 'commands') { $bad.Add("$($f.Name):$n $($line.Trim())") }
            }
        }
        $bad | Should BeNullOrEmpty
    }

    It 'no quedan referencias operativas a los nombres anteriores del entrypoint (código, tests, docs)' {
        $old = '(Backup-PostgreSQL|Invoke-PostgreSQLBackup)\.ps1'
        $files = @(Get-CodeFiles -IncludeTests | Where-Object { $_.Name -ne 'Portability.Tests.ps1' }) + @(Get-DocFiles)
        $offenders = @($files | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match $old } | ForEach-Object { $_.Name })
        $offenders | Should BeNullOrEmpty
    }

    It 'los scripts de backup no tocan .env.prod-temp, n8n ni compose de producción' {
        foreach ($f in (Get-CodeFiles)) {
            $text = Get-Content -LiteralPath $f.FullName -Raw
            ($text -match '\.env\.prod') | Should Be $false
            ($text -match '(?i)\bn8n\b') | Should Be $false
            ($text -match 'compose\.prod') | Should Be $false
        }
    }

    It 'no hay archivos temporales de desarrollo en scripts/backup' {
        $junk = @(Get-ChildItem -LiteralPath $moduleRoot -Recurse -Force -File | Where-Object { $_.Name -match '\.(tmp|bak|orig|rej|log)$' -or $_.Name -match '^\.daubert-preflight-' -or $_.Name -match '~$' } | ForEach-Object { $_.FullName })
        $junk | Should BeNullOrEmpty
    }
}

Describe 'Portabilidad - separación código / configuración / secretos / datos' {

    It 'una config generada no contiene secretos ni claves con aspecto de secreto' {
        $c = New-LocalBackupConfigObject -PostgresBin 'C:\pg\bin' -SevenZipPath 'C:\t\7z.exe' -AgePath 'C:\t\age.exe' -RecipientsFilePath 'C:\c\r.txt' -PgPassFile 'C:\s\pgpass-backup.conf' -BackupRoot 'D:\bk' -StagingRoot 'C:\st' -LogRoot 'C:\lg' -LockRoot 'C:\lk'
        $json = $c | ConvertTo-Json -Depth 8
        $json | Should Not Match '(?i)"(password|secret|token|apikey|privateKey|credential)'
        $json | Should Not Match 'AGE-SECRET-KEY'
        (Test-LocalConfigObject -Config ($json | ConvertFrom-Json)).IsValid | Should Be $true
    }

    It 'el repositorio (scripts y docs de backup/base de datos) no contiene claves privadas age, PGPASSWORD asignado ni URLs con credenciales' {
        $files = @(Get-CodeFiles -IncludeTests) + @(Get-DocFiles)
        foreach ($f in $files) {
            $text = Get-Content -LiteralPath $f.FullName -Raw
            ($text -match 'AGE-SECRET-KEY-1[A-Z0-9]{20,}') | Should Be $false
            ($text -match '(?i)PGPASSWORD\s*=\s*[^\s<''"$]') | Should Be $false
            ($text -match 'postgres(ql)?://[^/\s:@<]+:[^@\s<]+@') | Should Be $false
        }
    }

    It 'ningún script ni función del sistema de backups admite una clave privada / identidad age como parámetro' {
        $scripts = Get-ChildItem -LiteralPath (Join-Path $moduleRoot 'commands') -File -Filter '*.ps1'
        foreach ($s in $scripts) {
            ((Get-Command $s.FullName).Parameters.Keys | Where-Object { $_ -match '(?i)Private|Identity|SecretKey' }) | Should BeNullOrEmpty
        }
        foreach ($m in 'BackupConfig', 'BackupLocalConfig', 'BackupEncryption', 'BackupTasks', 'BackupPreflight', 'BackupInstall') {
            Import-Module (Join-Path $moduleRoot "lib\$m.psm1") -Force
            foreach ($cmd in (Get-Command -Module $m)) {
                ($cmd.Parameters.Keys | Where-Object { $_ -match '(?i)Private|Identity|SecretKey' }) | Should BeNullOrEmpty
            }
        }
    }

    It 'age solo se invoca para CIFRAR (-R): el código nunca ejecuta age -d ni -i' {
        foreach ($f in (Get-CodeFiles)) {
            $text = Get-Content -LiteralPath $f.FullName -Raw
            ($text -match "@\('-[di]'") | Should Be $false
        }
        (Get-Content -LiteralPath (Join-Path $moduleRoot 'lib\BackupEncryption.psm1') -Raw) | Should Match "'-R'"
    }

    It 'las tareas programadas y el instalador no reciben contraseñas: ningún parámetro tipo password/secret/token' {
        foreach ($n in 'Install-DaubertBackup.ps1', 'Register-DaubertBackupTasks.ps1', 'Unregister-DaubertBackupTasks.ps1', 'Test-DaubertBackupEnvironment.ps1', 'Start-DaubertPostgresBackup.ps1') {
            ((Get-Command (Join-Path $moduleRoot "commands\$n")).Parameters.Keys | Where-Object { $_ -match '(?i)password|secret|token' }) | Should BeNullOrEmpty
        }
    }

    It 'el instalador pide la contraseña con Read-Host -AsSecureString y nunca la convierte a texto' {
        $src = Get-Content -LiteralPath (Join-Path $moduleRoot 'commands\Install-DaubertBackup.ps1') -Raw
        $src | Should Match 'Read-Host \$prompt -AsSecureString'
        $src | Should Not Match 'ConvertFrom-SecureString'
        $src | Should Not Match '-AsPlainText'
    }

    It 'los .gitignore del repo no ignoran los scripts de backup (deben versionarse)' {
        $ignored = & git -C $repoRoot check-ignore -q -- 'scripts/backup/lib/BackupConfig.psm1'
        $LASTEXITCODE | Should Not Be 0
    }
}

Describe 'Infraestructura de pruebas - sin ejecutables sintéticos (antivirus-friendly)' {

    function Get-TestFiles { Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File | Where-Object { $_.Name -ne 'Portability.Tests.ps1' } }

    It 'no existen fixtures que compilen o generen ejecutables (StubPg.cs / Build-PgStub.ps1)' {
        Test-Path -LiteralPath (Join-Path $PSScriptRoot 'fixtures\StubPg.cs') | Should Be $false
        Test-Path -LiteralPath (Join-Path $PSScriptRoot 'fixtures\Build-PgStub.ps1') | Should Be $false
        @(Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.cs' }) | Should BeNullOrEmpty
    }

    It 'ninguna prueba compila código ni referencia los stubs (Add-Type, csc, Build-PgStub, StubPg)' {
        $offenders = @(Get-TestFiles | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match '(?i)\bAdd-Type\b|csc\.exe|Build-PgStub|StubPg|DAUBERT_STUB_' } | ForEach-Object { $_.Name })
        $offenders | Should BeNullOrEmpty
    }

    It 'ninguna prueba crea, copia ni renombra archivos con nombres de herramientas reales (pg_dump, pg_restore, pg_dumpall, pg_isready, psql, 7z, age)' {
        $tool = '(pg_dump|pg_restore|pg_dumpall|pg_isready|psql|7z|age)\.exe'
        $offenders = New-Object System.Collections.Generic.List[string]
        foreach ($f in (Get-TestFiles)) {
            foreach ($line in (Get-Content -LiteralPath $f.FullName)) {
                if ($line -match '^\s*#') { continue }
                if ($line -match '(New-Item|Set-Content|Add-Content|Out-File|Copy-Item|Rename-Item|Move-Item|WriteAll(Text|Bytes)|File\]::Create)' -and $line -match $tool) { $offenders.Add("$($f.Name): $($line.Trim())") }
            }
        }
        $offenders | Should BeNullOrEmpty
    }

    It 'ninguna prueba copia ni renombra ningún .exe' {
        $offenders = New-Object System.Collections.Generic.List[string]
        foreach ($f in (Get-TestFiles)) {
            foreach ($line in (Get-Content -LiteralPath $f.FullName)) {
                if ($line -notmatch '^\s*#' -and $line -match '(Copy-Item|Rename-Item|Move-Item)' -and $line -match '\.exe') { $offenders.Add("$($f.Name): $($line.Trim())") }
            }
        }
        $offenders | Should BeNullOrEmpty
    }

    It 'en producción solo los seams lanzan procesos externos (pg tools, 7z, age); los tests los mockean' {
        foreach ($m in 'BackupPgTools', 'BackupPackaging', 'BackupEncryption') {
            (Get-Content -LiteralPath (Join-Path $moduleRoot "lib\$m.psm1") -Raw) | Should Match 'System\.Diagnostics\.Process'
        }
        $seams = @{ BackupPgTools = 'function Invoke-ExternalProcess'; BackupPackaging = 'function Invoke-SevenZipProcess'; BackupEncryption = 'function Invoke-AgeProcess' }
        foreach ($k in $seams.Keys) { (Get-Content -LiteralPath (Join-Path $moduleRoot "lib\$k.psm1") -Raw) | Should Match ([regex]::Escape($seams[$k])) }
        foreach ($m in 'BackupPipeline', 'BackupInstall', 'BackupTasks', 'BackupLocalConfig', 'BackupRetention', 'BackupPublish') {
            (Get-Content -LiteralPath (Join-Path $moduleRoot "lib\$m.psm1") -Raw) | Should Not Match 'System\.Diagnostics\.Process|Start-Process'
        }
    }

    It 'el código productivo sigue ejecutando los binarios reales: los seams lanzan el proceso sin depender de mocks' {
        $src = Get-Content -LiteralPath (Join-Path $moduleRoot 'lib\BackupPgTools.psm1') -Raw
        $src | Should Match '\$proc\.Start\(\)'
        $src | Should Match 'RedirectStandardOutput'
    }
}
