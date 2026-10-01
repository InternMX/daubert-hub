#Requires -Version 5.1
<#
    Pruebas de integración del pipeline completo (BackupPipeline.psm1, el
    mismo código que ejecuta Start-DaubertPostgresBackup.ps1) con cifrado
    ASIMÉTRICO vía age.

    IMPORTANTE:
      - No se crea, compila ni copia NINGÚN ejecutable (ni pg_dump.exe, ni
        7z.exe, ni age.exe, ni stubs compilados). Los tres seams de procesos
        externos de producción están mockeados con Pester:
            Invoke-ExternalProcess (BackupPgTools)   pg_dump/pg_restore/pg_dumpall
            Invoke-SevenZipProcess (BackupPackaging) 7z
            Invoke-AgeProcess      (BackupEncryption) age
        y Test-BackupToolPath (BackupConfig) simula que las herramientas
        existen. Los dobles (tests\helpers\TestDoubles.ps1) simulan exit
        codes, stdout/stderr y la generación de archivos de salida.
      - NUNCA se conectan a PostgreSQL ni a daubert_global. Ninguna prueba
        usa ni necesita una clave privada age.
      - Lo demás (staging, hash, publicación, retención, lock, logs) es
        código real sobre directorios temporales.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\Backup-PostgreSQL.Tests.ps1"
#>

$backupRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'helpers\TestDoubles.ps1')
foreach ($m in 'BackupConfig', 'BackupLock', 'BackupPipeline') { Import-Module (Join-Path $backupRoot "lib\$m.psm1") -Force }

$global:ValidRecipient = 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123'

function New-IsolatedTestRoot {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-e2e-" + [guid]::NewGuid().ToString('N'))
    $backup = Join-Path $root 'backup-root'
    $staging = Join-Path $root 'staging-root'
    New-Item -ItemType Directory -Path $backup, $staging -Force | Out-Null
    $pgpass = Join-Path $root 'pgpass.conf'
    Set-Content -LiteralPath $pgpass -Value 'placeholder-no-secret' -Encoding UTF8
    $recipients = Join-Path $root 'recipients.txt'
    Set-Content -LiteralPath $recipients -Value $global:ValidRecipient -Encoding ASCII

    # Rutas de herramientas: SOLO cadenas registradas en memoria (Test-BackupToolPath mockeado).
    $pgBin = Join-Path $root 'pg-tools'
    $sevenZip = Join-Path $root 'tools\packer-7z'
    $age = Join-Path $root 'tools\encryptor-age'
    Clear-FakeTools
    Add-FakePgToolset -BinDir $pgBin | Out-Null
    Add-FakeTool -Path $sevenZip, $age

    [pscustomobject]@{
        Root = $root; BackupRoot = $backup; StagingRoot = $staging; PgPassFile = $pgpass; RecipientsFilePath = $recipients
        LockFilePath = (Join-Path $root 'locks\backup.lock'); PgBinPath = $pgBin; SevenZipPath = $sevenZip; AgePath = $age
    }
}

function Invoke-Backup {
    param(
        $Env, [Parameter(Mandatory = $true)][string]$Tier, [switch]$DryRun, [string]$Now, [int]$LockTimeoutSeconds = 0,
        [hashtable]$Override = @{}, [switch]$OnlyIfDue
    )
    $cli = @{
        BackupRoot = $Env.BackupRoot; StagingRoot = $Env.StagingRoot; PgBinPath = $Env.PgBinPath; PgPassFile = $Env.PgPassFile
        SevenZipPath = $Env.SevenZipPath; AgePath = $Env.AgePath; RecipientsFilePath = $Env.RecipientsFilePath; LockFilePath = $Env.LockFilePath
    }
    foreach ($k in $Override.Keys) { $cli[$k] = $Override[$k] }
    $params = @{ Tier = $Tier; CliParameters = $cli; LockTimeoutSeconds = $LockTimeoutSeconds }
    if ($DryRun) { $params.DryRun = $true }
    if ($OnlyIfDue) { $params.OnlyIfDue = $true }
    if ($Now) { $params.Now = [datetime]$Now }
    $out = @(Invoke-DaubertBackupRun @params 2>$null)
    return [int]$out[-1]
}

function Get-LogText {
    param($Env, [string]$Tier)
    $dir = Join-Path $Env.BackupRoot ('LOGS\' + $Tier.ToUpperInvariant())
    $f = Get-ChildItem -LiteralPath $dir -Filter '*.log.jsonl' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { Get-Content -LiteralPath $f.FullName -Raw } else { $null }
}

function Get-Published {
    param($Env, [string]$Tier)
    $dir = Join-Path $Env.BackupRoot $Tier.ToUpperInvariant()
    if (Test-Path -LiteralPath $dir) { @((Get-ChildItem -LiteralPath $dir -File).Name | Sort-Object) } else { @() }
}

Describe 'Pipeline de backup (integración, procesos externos mockeados, cifrado asimétrico con age)' {

    BeforeEach {
        $script:env = New-IsolatedTestRoot
        Reset-ProcessSim
        Mock Invoke-ExternalProcess { Invoke-FakePgProcess -FilePath $FilePath -ArgumentList $ArgumentList -EnvironmentVariables $EnvironmentVariables } -ModuleName BackupPgTools
        Mock Invoke-AgeProcess { Invoke-FakeAgeProcess -AgePath $AgePath -ArgumentList $ArgumentList } -ModuleName BackupEncryption
        Mock Invoke-SevenZipProcess { Invoke-FakeSevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory } -ModuleName BackupPackaging
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig
    }

    AfterEach {
        Remove-Item -LiteralPath $script:env.Root -Recurse -Force -ErrorAction SilentlyContinue
        Clear-FakeTools
    }

    Context 'Selección de tier y artefactos publicados' {

        It 'Frequent: exit 0, publica solo <db>_FREQUENT_<ts>.age + .sha256 (sin bundle: un solo archivo se cifra directo)' {
            (Invoke-Backup -Env $script:env -Tier Frequent -Now '2026-09-28T14:00:07') | Should Be 0
            Get-Published $script:env Frequent | Should Be @('daubert_global_FREQUENT_20260928_140007.age', 'daubert_global_FREQUENT_20260928_140007.age.sha256')
            (Get-LogText $script:env Frequent) | Should Match '"stage":"package_bundle","result":"skipped"'
            @(Get-SimCalls '7z').Count | Should Be 0
        }

        It 'Daily: empaqueta (bundle) dump+schema-only y publica un único .age' {
            (Invoke-Backup -Env $script:env -Tier Daily -Now '2026-09-28T14:00:07') | Should Be 0
            Get-Published $script:env Daily | Should Be @('daubert_global_DAILY_20260928_140007.age', 'daubert_global_DAILY_20260928_140007.age.sha256')
            (Get-LogText $script:env Daily) | Should Match '"stage":"package_bundle","result":"success"'
            @(Get-SimCalls 'pg_dump').Count | Should Be 2
            @(Get-SimCalls 'pg_dumpall').Count | Should Be 0
            @(Get-SimCalls '7z').Count | Should Be 1
        }

        It 'Monthly: empaqueta dump+schema-only+globals y publica un único .age; los globals nunca se publican sueltos' {
            (Invoke-Backup -Env $script:env -Tier Monthly -Now '2026-09-28T14:00:07') | Should Be 0
            Get-Published $script:env Monthly | Should Be @('daubert_global_MONTHLY_20260928_140007.age', 'daubert_global_MONTHLY_20260928_140007.age.sha256')
            @(Get-SimCalls 'pg_dumpall').Count | Should Be 1
            (Get-ChildItem $script:env.BackupRoot -Recurse -Filter '*.sql' -ErrorAction SilentlyContinue).Count | Should Be 0
            (Get-ChildItem $script:env.BackupRoot -Recurse -Filter '*.dump' -ErrorAction SilentlyContinue).Count | Should Be 0
            (Get-ChildItem $script:env.BackupRoot -Recurse -Filter '*.7z' -ErrorAction SilentlyContinue).Count | Should Be 0
        }

        It 'el 7z del bundle nunca lleva contraseña (-p) ni cifrado de cabeceras (-mhe)' {
            Invoke-Backup -Env $script:env -Tier Daily | Out-Null
            $args7z = @(Get-SimCalls '7z')[0].Args
            ($args7z -join ' ') | Should Not Match '(^|\s)-p'
            ($args7z -join ' ') | Should Not Match '-mhe'
            $args7z[0] | Should Be 'a'
        }

        It 'age solo se invoca para CIFRAR con destinatarios públicos (-R) y nunca con -d/-i (sin clave privada)' {
            Invoke-Backup -Env $script:env -Tier Frequent | Out-Null
            $ageArgs = @(Get-SimCalls 'age')[0].Args
            ($ageArgs -contains '-R') | Should Be $true
            ($ageArgs -contains '-d') | Should Be $false
            ($ageArgs -contains '-i') | Should Be $false
            (Get-ArgumentAfter $ageArgs '-R') | Should Be $script:env.RecipientsFilePath
        }
    }

    Context 'Contraseña de PostgreSQL: solo por PGPASSFILE' {

        It 'los procesos de PostgreSQL reciben PGPASSFILE en el entorno y ningún argumento con contraseña' {
            Invoke-Backup -Env $script:env -Tier Monthly | Out-Null
            foreach ($c in @(Get-SimCalls 'pg_dump') + @(Get-SimCalls 'pg_dumpall')) {
                $c.Env['PGPASSFILE'] | Should Be $script:env.PgPassFile
                ($c.Args -contains '--no-password') | Should Be $true
                ($c.Args -join ' ') | Should Not Match '(?i)password=|PGPASSWORD|placeholder-no-secret'
            }
        }
    }

    Context 'Fallos de pg_dump y validación (antes de empaquetar/cifrar)' {

        It 'exit code = 4 (PgDumpFailed) si pg_dump termina con código distinto de 0' {
            $global:ProcSim.PgDump.Mode = 'NO_FILE'; $global:ProcSim.PgDump.ExitCode = 1
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 4
            (Get-Published $script:env Frequent | Where-Object { $_ -like '*.age' }).Count | Should Be 0
        }

        It 'exit code = 5 (ValidationFailed) si pg_restore -l falla (dump corrupto/vacío en TOC)' {
            $global:ProcSim.PgRestore.StdOut = "; Archive created at 2026-09-28`n; No entries`n"
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 5
            (Get-Published $script:env Frequent | Where-Object { $_ -like '*.age' }).Count | Should Be 0
        }

        It 'exit code = 5 si pg_restore -l termina con código distinto de 0' {
            $global:ProcSim.PgRestore.ExitCode = 1; $global:ProcSim.PgRestore.StdErr = 'could not read symbol table'
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 5
        }

        It 'exit code = 4 si el dump queda vacío (0 bytes; nunca se empaqueta/cifra/publica un backup vacío)' {
            $global:ProcSim.PgDump.Mode = 'EMPTY_FILE'
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 4
            @(Get-SimCalls 'age').Count | Should Be 0
        }

        It 'exit code = 4 si falla el schema-only de Daily (pg_dump --schema-only)' {
            # Primer pg_dump OK; el segundo (schema-only) sin archivo.
            $global:ProcSim.OnPgDump = { if ((@($global:ProcSim.Calls | Where-Object { $_.Tool -eq 'pg_dump' })).Count -ge 2) { $global:ProcSim.PgDump.Mode = 'NO_FILE'; $global:ProcSim.PgDump.ExitCode = 1 } }
            (Invoke-Backup -Env $script:env -Tier Daily) | Should Be 4
            @(Get-SimCalls '7z').Count | Should Be 0
        }

        It 'exit code = 4 si pg_dumpall --globals-only falla (Monthly)' {
            $global:ProcSim.PgDumpAll.ExitCode = 1; $global:ProcSim.PgDumpAll.Mode = 'NO_FILE'
            (Invoke-Backup -Env $script:env -Tier Monthly) | Should Be 4
        }

        It 'exit code = 5 si el dump de globals no contiene sentencias reconocibles (Monthly)' {
            $global:ProcSim.PgDumpAll.Content = 'nada reconocible'
            (Invoke-Backup -Env $script:env -Tier Monthly) | Should Be 5
        }
    }

    Context 'Empaquetado (bundle)' {

        It 'exit code = 9 (PackagingFailed) si el empaquetado (7z sin cifrar) falla en un tier con más de un artefacto' {
            $global:ProcSim.SevenZip.ExitCode = 2; $global:ProcSim.SevenZip.Mode = 'NO_FILE'
            (Invoke-Backup -Env $script:env -Tier Daily) | Should Be 9
            (Get-Published $script:env Daily | Where-Object { $_ -like '*.age' }).Count | Should Be 0
            @(Get-SimCalls 'age').Count | Should Be 0
        }
    }

    Context 'Cifrado asimétrico (age): fallos y validación obligatoria' {

        It 'exit code = 10 (EncryptionFailed) si age falla al cifrar (pg_dump/pg_restore tienen éxito)' {
            $global:ProcSim.Age.Mode = 'NO_FILE'; $global:ProcSim.Age.ExitCode = 1
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 10
            (Get-Published $script:env Frequent | Where-Object { $_ -like '*.age' }).Count | Should Be 0
        }

        It 'exit code = 11 (EncryptionValidationFailed) si el artefacto cifrado no pasa la validación estructural; NO publica' {
            $global:ProcSim.Age.Content = 'esto no tiene forma de archivo age valido, le falta la cabecera esperada y demas'
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 11
            (Get-Published $script:env Frequent | Where-Object { $_ -like '*.age' }).Count | Should Be 0
        }

        It 'fallo durante el cifrado NO dispara retención (un backup .age válido anterior sobrevive)' {
            $tierDir = Join-Path $script:env.BackupRoot 'FREQUENT'
            New-Item -ItemType Directory -Path $tierDir -Force | Out-Null
            $oldName = 'daubert_global_FREQUENT_20250101_000000.age'
            Set-Content -LiteralPath (Join-Path $tierDir $oldName) -Value 'artefacto-cifrado-viejo-pero-valido' -Encoding UTF8
            Set-Content -LiteralPath (Join-Path $tierDir "$oldName.sha256") -Value 'hash  archivo' -Encoding ASCII
            $global:ProcSim.Age.Mode = 'NO_FILE'; $global:ProcSim.Age.ExitCode = 1

            (Invoke-Backup -Env $script:env -Tier Frequent -Now '2026-09-28T14:00:07') | Should Be 10
            Test-Path -LiteralPath (Join-Path $tierDir $oldName) | Should Be $true
            Test-Path -LiteralPath (Join-Path $tierDir "$oldName.sha256") | Should Be $true
        }

        It 'el hash SHA-256 publicado corresponde al contenido real del artefacto cifrado' {
            (Invoke-Backup -Env $script:env -Tier Frequent -Now '2026-09-28T14:00:07') | Should Be 0
            $archivePath = Join-Path $script:env.BackupRoot 'FREQUENT\daubert_global_FREQUENT_20260928_140007.age'
            $recomputed = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
            $recorded = ((Get-Content -LiteralPath "$archivePath.sha256" -Raw) -split '\s+')[0].ToLowerInvariant()
            $recomputed | Should Be $recorded
        }
    }

    Context 'Publicación y protección de backups existentes' {

        It 'exit code = 7 (PublishFailed) si ya existe un .age con el mismo nombre en el destino (nunca sobreescribe)' {
            $tierDir = Join-Path $script:env.BackupRoot 'FREQUENT'
            New-Item -ItemType Directory -Path $tierDir -Force | Out-Null
            $existingName = 'daubert_global_FREQUENT_20260928_140007.age'
            Set-Content -LiteralPath (Join-Path $tierDir $existingName) -Value 'backup-cifrado-valido-previo' -Encoding UTF8

            (Invoke-Backup -Env $script:env -Tier Frequent -Now '2026-09-28T14:00:07') | Should Be 7
            (Get-Content -LiteralPath (Join-Path $tierDir $existingName) -Raw) | Should Match 'backup-cifrado-valido-previo'
        }

        It 'con -DryRun ejecuta empaquetado+cifrado+validación pero nunca publica al destino final' {
            (Invoke-Backup -Env $script:env -Tier Frequent -DryRun) | Should Be 0
            Test-Path (Join-Path $script:env.BackupRoot 'FREQUENT') | Should Be $false
            @(Get-SimCalls 'age').Count | Should Be 1
        }
    }

    Context 'Retención sobre pares .age/.age.sha256' {

        It 'borra pares .age + .age.sha256 más antiguos que la retención tras un run exitoso' {
            $tierDir = Join-Path $script:env.BackupRoot 'FREQUENT'
            New-Item -ItemType Directory -Path $tierDir -Force | Out-Null
            $oldName = 'daubert_global_FREQUENT_20250101_000000.age'
            Set-Content -LiteralPath (Join-Path $tierDir $oldName) -Value 'viejo' -Encoding UTF8
            Set-Content -LiteralPath (Join-Path $tierDir "$oldName.sha256") -Value 'hash  archivo' -Encoding ASCII

            (Invoke-Backup -Env $script:env -Tier Frequent -Now '2026-09-28T14:00:07') | Should Be 0
            Test-Path (Join-Path $tierDir $oldName) | Should Be $false
            Test-Path (Join-Path $tierDir "$oldName.sha256") | Should Be $false
            Test-Path (Join-Path $tierDir 'daubert_global_FREQUENT_20260928_140007.age') | Should Be $true
        }

        It 'con -DryRun la retención NO borra ningún par, solo reporta en el log qué eliminaría' {
            $tierDir = Join-Path $script:env.BackupRoot 'FREQUENT'
            New-Item -ItemType Directory -Path $tierDir -Force | Out-Null
            $oldName = 'daubert_global_FREQUENT_20250101_000000.age'
            Set-Content -LiteralPath (Join-Path $tierDir $oldName) -Value 'viejo' -Encoding UTF8
            Set-Content -LiteralPath (Join-Path $tierDir "$oldName.sha256") -Value 'hash  archivo' -Encoding ASCII

            (Invoke-Backup -Env $script:env -Tier Frequent -DryRun -Now '2026-09-28T14:00:07') | Should Be 0
            Test-Path (Join-Path $tierDir $oldName) | Should Be $true
            (Get-LogText $script:env Frequent) | Should Match 'would_delete=1'
        }

        It 'nunca borra un backup .age válido si el run actual falla' {
            $tierDir = Join-Path $script:env.BackupRoot 'FREQUENT'
            New-Item -ItemType Directory -Path $tierDir -Force | Out-Null
            $oldName = 'daubert_global_FREQUENT_20250101_000000.age'
            Set-Content -LiteralPath (Join-Path $tierDir $oldName) -Value 'viejo-pero-valido' -Encoding UTF8
            Set-Content -LiteralPath (Join-Path $tierDir "$oldName.sha256") -Value 'hash  archivo' -Encoding ASCII
            $global:ProcSim.PgDump.Mode = 'NO_FILE'; $global:ProcSim.PgDump.ExitCode = 1

            (Invoke-Backup -Env $script:env -Tier Frequent -Now '2026-09-28T14:00:07') | Should Be 4
            Test-Path -LiteralPath (Join-Path $tierDir $oldName) | Should Be $true
            Test-Path -LiteralPath (Join-Path $tierDir "$oldName.sha256") | Should Be $true
        }
    }

    Context 'Limpieza de staging (plaintext, bundle y artefacto cifrado)' {

        It 'el staging se limpia tras un run exitoso (sin dump/.sql/.7z/.age remanentes)' {
            Invoke-Backup -Env $script:env -Tier Daily | Out-Null
            (Get-ChildItem $script:env.StagingRoot -ErrorAction SilentlyContinue | Measure-Object).Count | Should Be 0
        }

        It 'el staging se limpia también cuando el run falla antes de empaquetar' {
            $global:ProcSim.PgDump.Mode = 'NO_FILE'; $global:ProcSim.PgDump.ExitCode = 1
            Invoke-Backup -Env $script:env -Tier Frequent | Out-Null
            (Get-ChildItem $script:env.StagingRoot -ErrorAction SilentlyContinue | Measure-Object).Count | Should Be 0
        }

        It 'el staging se limpia también cuando falla la validación estructural del cifrado' {
            $global:ProcSim.Age.Content = 'no tiene forma de archivo age valido'
            Invoke-Backup -Env $script:env -Tier Frequent | Out-Null
            (Get-ChildItem $script:env.StagingRoot -ErrorAction SilentlyContinue | Measure-Object).Count | Should Be 0
        }

        It 'el texto plano se elimina de staging ANTES de publicar (ya cifrado y validado)' {
            Invoke-Backup -Env $script:env -Tier Frequent -DryRun | Out-Null
            (Get-ChildItem $script:env.StagingRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count | Should Be 0
            (Get-LogText $script:env Frequent) | Should Match '"stage":"cleanup_plaintext","result":"success"'
        }
    }

    Context 'Prerrequisitos y exit codes' {

        It 'exit code = 3 (PrerequisiteError) si PgPassFile no existe' {
            (Invoke-Backup -Env $script:env -Tier Frequent -Override @{ PgPassFile = (Join-Path $script:env.Root 'no-existe.conf') }) | Should Be 3
            @(Get-SimCalls 'pg_dump').Count | Should Be 0
        }

        It 'exit code = 3 (PrerequisiteError) si age no existe en la ruta configurada' {
            Remove-FakeTool -Path $script:env.AgePath
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 3
            @(Get-SimCalls 'pg_dump').Count | Should Be 0
        }

        It 'exit code = 3 si falta pg_restore en la carpeta de PostgreSQL' {
            Remove-FakeTool -Path (Join-Path $script:env.PgBinPath 'pg_restore.exe')
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 3
        }

        It 'exit code = 3 si no hay 7-Zip configurado' {
            Remove-FakeTool -Path $script:env.SevenZipPath
            (Invoke-Backup -Env $script:env -Tier Daily) | Should Be 3
        }

        It 'exit code = 0 en el camino feliz completo (Monthly: dump + schema-only + globals, empaquetado y cifrado)' {
            (Invoke-Backup -Env $script:env -Tier Monthly) | Should Be 0
        }

        It 'exit code = 1 (UnexpectedError) ante una excepción no clasificada en un proceso externo' {
            Mock Invoke-ExternalProcess { throw 'fallo inesperado del proceso' } -ModuleName BackupPgTools
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 1
            (Get-ChildItem $script:env.StagingRoot -ErrorAction SilentlyContinue | Measure-Object).Count | Should Be 0
        }
    }

    Context 'Destinatarios de cifrado (solo clave pública) y ausencia de clave privada' {

        It 'exit code = 3 (PrerequisiteError) si el archivo de destinatarios no existe' {
            (Invoke-Backup -Env $script:env -Tier Frequent -Override @{ RecipientsFilePath = (Join-Path $script:env.Root 'no-existe.txt') }) | Should Be 3
        }

        It 'exit code = 3 (PrerequisiteError) si el archivo de destinatarios no contiene ninguna clave pública reconocible' {
            $bogus = Join-Path $script:env.Root 'recipients-basura.txt'
            Set-Content -LiteralPath $bogus -Value 'esto no es una clave age' -Encoding ASCII
            (Invoke-Backup -Env $script:env -Tier Frequent -Override @{ RecipientsFilePath = $bogus }) | Should Be 3
        }

        It 'la clave privada NUNCA es requerida: un backup completo (exit 0) se logra con SOLO la clave pública en todo el entorno de pruebas' {
            (Invoke-Backup -Env $script:env -Tier Monthly) | Should Be 0
            Get-ChildItem $script:env.Root -Recurse -File | ForEach-Object {
                $_.Name | Should Not Match 'AGE-SECRET-KEY'
                $_.Name | Should Not Match 'identity'
            }
        }
    }

    Context 'Lock y ejecución concurrente' {

        It 'con el lock ya tomado por otra ejecución, termina con exit code 2 (LockHeld) sin tocar nada' {
            $held = Enter-BackupLock -LockFilePath $script:env.LockFilePath -TimeoutSeconds 0
            try {
                (Invoke-Backup -Env $script:env -Tier Frequent -LockTimeoutSeconds 0) | Should Be 2
                @(Get-SimCalls 'pg_dump').Count | Should Be 0
            }
            finally { Exit-BackupLock -LockHandle $held }
            # Liberado el lock, la siguiente ejecución sí corre.
            (Invoke-Backup -Env $script:env -Tier Frequent) | Should Be 0
        }

        It 'el lock está tomado durante el pg_dump y se libera al terminar' {
            $global:LockSeenDuringDump = $false
            $lockPath = $script:env.LockFilePath
            $global:ProcSim.OnPgDump = { $global:LockSeenDuringDump = (Test-Path -LiteralPath $lockPath) }.GetNewClosure()
            Invoke-Backup -Env $script:env -Tier Frequent | Out-Null
            $global:LockSeenDuringDump | Should Be $true
            Test-Path -LiteralPath $script:env.LockFilePath | Should Be $false
        }

        It 'el lock se libera también cuando el run falla' {
            $global:ProcSim.PgDump.Mode = 'NO_FILE'; $global:ProcSim.PgDump.ExitCode = 1
            Invoke-Backup -Env $script:env -Tier Frequent | Out-Null
            Test-Path -LiteralPath $script:env.LockFilePath | Should Be $false
        }
    }

    Context 'Logs estructurados y no-filtración de secretos' {

        It 'genera un log JSONL con las etapas de empaquetado/cifrado/validación' {
            Invoke-Backup -Env $script:env -Tier Daily | Out-Null
            $logDir = Join-Path $script:env.BackupRoot 'LOGS\DAILY'
            $logFile = Get-ChildItem $logDir -Filter '*.log.jsonl' | Select-Object -First 1
            $logFile | Should Not BeNullOrEmpty
            $entries = (Get-Content -LiteralPath $logFile.FullName) | ConvertFrom-Json
            foreach ($stage in 'pg_dump', 'package_bundle', 'encrypt_age', 'validate_age_structure', 'hash', 'publish_archive', 'verify_published_hash') {
                ($entries | Where-Object { $_.stage -eq $stage -and $_.result -eq 'success' }) | Should Not BeNullOrEmpty
            }
        }

        It 'el log NUNCA contiene el contenido del dump, de PGPASSFILE, ni nada parecido a una clave privada' {
            Invoke-Backup -Env $script:env -Tier Frequent | Out-Null
            $log = Get-LogText $script:env Frequent
            $log | Should Not Match 'placeholder-no-secret'
            $log | Should Not Match 'FAKE DUMP CONTENT'
            $log | Should Not Match 'AGE-SECRET-KEY'
        }

        It 'en un fallo el log registra el error sin volcar contenido sensible' {
            $global:ProcSim.PgDump.Mode = 'NO_FILE'; $global:ProcSim.PgDump.ExitCode = 1; $global:ProcSim.PgDump.StdErr = 'connection refused'
            Invoke-Backup -Env $script:env -Tier Frequent | Out-Null
            $log = Get-LogText $script:env Frequent
            $log | Should Match '"stage":"run","result":"failure"'
            $log | Should Not Match 'placeholder-no-secret'
        }

        It 'ni el comando ni los parámetros admiten una clave privada (Invoke-DaubertBackupRun / Invoke-DaubertBackup)' {
            foreach ($n in 'Invoke-DaubertBackupRun', 'Invoke-DaubertBackup', 'Resolve-BackupRunConfig') {
                ((Get-Command $n).Parameters.Keys | Where-Object { $_ -match 'Private|Identity|SecretKey' }) | Should BeNullOrEmpty
            }
        }
    }
}

Describe 'MONTHLY: globals SANITIZADOS (pg_dumpall -l <db> --globals-only --no-role-passwords --no-password), sin superusuario' {

    BeforeEach {
        $script:env = New-IsolatedTestRoot
        Reset-ProcessSim
        Mock Invoke-ExternalProcess { Invoke-FakePgProcess -FilePath $FilePath -ArgumentList $ArgumentList -EnvironmentVariables $EnvironmentVariables } -ModuleName BackupPgTools
        Mock Invoke-AgeProcess { Invoke-FakeAgeProcess -AgePath $AgePath -ArgumentList $ArgumentList } -ModuleName BackupEncryption
        Mock Invoke-SevenZipProcess { Invoke-FakeSevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory } -ModuleName BackupPackaging
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig
    }
    AfterEach {
        Remove-Item -LiteralPath $script:env.Root -Recurse -Force -ErrorAction SilentlyContinue
        Clear-FakeTools
    }

    function Get-DumpAllArgs { @(Get-SimCalls 'pg_dumpall')[0].Args }

    It 'pg_dumpall recibe -l con el PgDatabase RESUELTO (no hardcodeado)' {
        Invoke-Backup -Env $script:env -Tier Monthly -Override @{ PgDatabase = 'otra_bd' } | Should Be 0
        (Get-ArgumentAfter (Get-DumpAllArgs) '-l') | Should Be 'otra_bd'
    }

    It 'con la base por defecto usa daubert_global resuelto por la configuración' {
        Invoke-Backup -Env $script:env -Tier Monthly | Should Be 0
        (Get-ArgumentAfter (Get-DumpAllArgs) '-l') | Should Be 'daubert_global'
    }

    It 'recibe --globals-only, --no-role-passwords y --no-password' {
        Invoke-Backup -Env $script:env -Tier Monthly | Out-Null
        $a = Get-DumpAllArgs
        foreach ($f in '--globals-only', '--no-role-passwords', '--no-password') { ($a -contains $f) | Should Be $true }
    }

    It 'argumentos finales exactos: host, puerto, usuario, -l, flags y -f (sin secretos)' {
        Invoke-Backup -Env $script:env -Tier Monthly -Override @{ PgHost = 'db.local'; PgPort = 5544; PgUser = 'usuario_backup'; PgDatabase = 'mi_base' } | Should Be 0
        $a = Get-DumpAllArgs
        $out = Get-ArgumentAfter $a '-f'
        $out | Should Match 'globals_MONTHLY_\d{8}_\d{6}\.sql$'
        $a | Should Be @('-h', 'db.local', '-p', '5544', '-U', 'usuario_backup', '-l', 'mi_base', '--globals-only', '--no-role-passwords', '-f', $out, '--no-password')
    }

    It 'ningún argumento contiene contraseñas, la ruta del pgpass ni opciones que pidan contraseña (-W/--password)' {
        Invoke-Backup -Env $script:env -Tier Monthly | Out-Null
        $a = Get-DumpAllArgs
        ($a -join ' ') | Should Not Match 'PGPASSWORD|placeholder-no-secret'
        ($a -contains $script:env.PgPassFile) | Should Be $false
        ($a -contains '-W') | Should Be $false
        ($a -contains '--password') | Should Be $false
        @($a | Where-Object { $_ -match '=' }).Count | Should Be 0
    }

    It 'respeta PGPASSFILE: es la única variable de entorno pasada a pg_dumpall' {
        Invoke-Backup -Env $script:env -Tier Monthly | Out-Null
        $env1 = @(Get-SimCalls 'pg_dumpall')[0].Env
        $env1['PGPASSFILE'] | Should Be $script:env.PgPassFile
        @($env1.Keys).Count | Should Be 1
    }

    It 'no requiere superusuario: usa el mismo usuario de backup configurado, sin -U postgres, --role ni SET ROLE' {
        Invoke-Backup -Env $script:env -Tier Monthly | Out-Null
        $a = Get-DumpAllArgs
        (Get-ArgumentAfter $a '-U') | Should Be 'daubert_backup'
        ($a -join ' ') | Should Not Match '(?i)--role|superuser|postgres\b'
        $dumpCalls = @(Get-SimCalls 'pg_dump') + @(Get-SimCalls 'pg_dumpall')
        foreach ($c in $dumpCalls) { (Get-ArgumentAfter $c.Args '-U') | Should Be 'daubert_backup' }
        $src = [System.IO.File]::ReadAllText((Join-Path $backupRoot 'lib\BackupPgTools.psm1'))
        $src | Should Not Match '(?i)SET ROLE|--role=|GRANT |ALTER ROLE.*SUPERUSER'
    }

    It 'un fallo de pg_dumpall aborta MONTHLY (exit 4): nada se cifra ni se publica' {
        $global:ProcSim.PgDumpAll.ExitCode = 1; $global:ProcSim.PgDumpAll.Mode = 'NO_FILE'
        $global:ProcSim.PgDumpAll.StdErr = 'connection to server failed'
        Invoke-Backup -Env $script:env -Tier Monthly | Should Be 4
        @(Get-SimCalls '7z').Count | Should Be 0
        @(Get-SimCalls 'age').Count | Should Be 0
        @(Get-Published $script:env Monthly).Count | Should Be 0
    }

    It 'globals inexistente (exit 0 pero sin archivo) se considera fallo (exit 5) y no se publica' {
        $global:ProcSim.PgDumpAll.Mode = 'NO_FILE'
        Invoke-Backup -Env $script:env -Tier Monthly | Should Be 5
        @(Get-SimCalls 'age').Count | Should Be 0
        @(Get-Published $script:env Monthly).Count | Should Be 0
    }

    It 'globals vacío o sin sentencias reconocibles se considera fallo (exit 5)' {
        $global:ProcSim.PgDumpAll.Mode = 'EMPTY_FILE'
        Invoke-Backup -Env $script:env -Tier Monthly | Should Be 5
        $global:ProcSim.PgDumpAll.Mode = 'SUCCESS'; $global:ProcSim.PgDumpAll.Content = '-- solo comentarios'
        Invoke-Backup -Env $script:env -Tier Monthly | Should Be 5
    }

    It 'FREQUENT y DAILY nunca invocan pg_dumpall' {
        Invoke-Backup -Env $script:env -Tier Frequent | Should Be 0
        Invoke-Backup -Env $script:env -Tier Daily | Should Be 0
        @(Get-SimCalls 'pg_dumpall').Count | Should Be 0
    }

    It 'el bundle MONTHLY contiene exactamente: full dump + schema-only + globals sanitizados' {
        Invoke-Backup -Env $script:env -Tier Monthly -Now '2026-09-28T14:00:07' | Should Be 0
        $a = @(Get-SimCalls '7z')[0].Args
        $files = @($a[5..($a.Count - 1)])
        ($files | Sort-Object) | Should Be @('daubert_global_MONTHLY_20260928_140007.dump', 'daubert_global_schema_MONTHLY_20260928_140007.dump', 'globals_MONTHLY_20260928_140007.sql')
    }

    It 'el bundle DAILY contiene full dump + schema-only (sin globals) y FREQUENT no se empaqueta' {
        Invoke-Backup -Env $script:env -Tier Daily -Now '2026-09-28T14:00:07' | Should Be 0
        $a = @(Get-SimCalls '7z')[0].Args
        (@($a[5..($a.Count - 1)]) | Sort-Object) | Should Be @('daubert_global_DAILY_20260928_140007.dump', 'daubert_global_schema_DAILY_20260928_140007.dump')
        $global:ProcSim.Calls.Clear()
        Invoke-Backup -Env $script:env -Tier Frequent | Should Be 0
        @(Get-SimCalls '7z').Count | Should Be 0
    }

    It 'el plaintext de globals existe en staging solo mientras hace falta y se elimina ANTES de publicar (éxito)' {
        $stagingRoot = $script:env.StagingRoot
        $global:SeenAtAge = @()
        $global:ProcSim.OnAge = { $global:SeenAtAge = @(Get-ChildItem -LiteralPath $stagingRoot -Recurse -File | ForEach-Object { $_.Name }) }.GetNewClosure()
        Invoke-Backup -Env $script:env -Tier Monthly | Should Be 0
        (@($global:SeenAtAge | Where-Object { $_ -like 'globals_MONTHLY_*.sql' })).Count | Should Be 1
        (Get-ChildItem $script:env.StagingRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count | Should Be 0
        (Get-ChildItem $script:env.BackupRoot -Recurse -File | Where-Object { $_.Extension -in '.sql', '.dump', '.7z' } | Measure-Object).Count | Should Be 0
    }

    It 'el plaintext de globals se elimina (finally) aunque falle una etapa posterior (age)' {
        $stagingRoot = $script:env.StagingRoot
        $global:SeenAtAge = @()
        $global:ProcSim.OnAge = { $global:SeenAtAge = @(Get-ChildItem -LiteralPath $stagingRoot -Recurse -File | ForEach-Object { $_.Name }) }.GetNewClosure()
        $global:ProcSim.Age.Mode = 'NO_FILE'; $global:ProcSim.Age.ExitCode = 1
        Invoke-Backup -Env $script:env -Tier Monthly | Should Be 10
        (@($global:SeenAtAge | Where-Object { $_ -like 'globals_MONTHLY_*.sql' })).Count | Should Be 1
        (Get-ChildItem $script:env.StagingRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count | Should Be 0
    }

    It 'el plaintext de globals se elimina también si falla el empaquetado (7z)' {
        $global:ProcSim.SevenZip.ExitCode = 2; $global:ProcSim.SevenZip.Mode = 'NO_FILE'
        Invoke-Backup -Env $script:env -Tier Monthly | Should Be 9
        (Get-ChildItem $script:env.StagingRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count | Should Be 0
    }

    It 'el plaintext de globals se elimina también en -DryRun' {
        Invoke-Backup -Env $script:env -Tier Monthly -DryRun | Should Be 0
        (Get-ChildItem $script:env.StagingRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count | Should Be 0
        Test-Path (Join-Path $script:env.BackupRoot 'MONTHLY') | Should Be $false
    }

    It 'el artefacto final MONTHLY es solo el .age cifrado (+ sidecar) y el log no contiene el contenido de los globals' {
        Invoke-Backup -Env $script:env -Tier Monthly -Now '2026-09-28T14:00:07' | Should Be 0
        Get-Published $script:env Monthly | Should Be @('daubert_global_MONTHLY_20260928_140007.age', 'daubert_global_MONTHLY_20260928_140007.age.sha256')
        (Get-LogText $script:env Monthly) | Should Not Match 'CREATE ROLE'
    }
}

Describe 'Limpieza de staging huérfano (plaintext de una ejecución que murió), solo con el lock adquirido' {

    BeforeEach {
        $script:env = New-IsolatedTestRoot
        Reset-ProcessSim
        Mock Invoke-ExternalProcess { Invoke-FakePgProcess -FilePath $FilePath -ArgumentList $ArgumentList -EnvironmentVariables $EnvironmentVariables } -ModuleName BackupPgTools
        Mock Invoke-AgeProcess { Invoke-FakeAgeProcess -AgePath $AgePath -ArgumentList $ArgumentList } -ModuleName BackupEncryption
        Mock Invoke-SevenZipProcess { Invoke-FakeSevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory } -ModuleName BackupPackaging
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig
        $script:orphanA = Join-Path $script:env.StagingRoot ([guid]::NewGuid().ToString('N'))
        $script:orphanB = Join-Path $script:env.StagingRoot ([guid]::NewGuid().ToString('N'))
        foreach ($o in $script:orphanA, $script:orphanB) {
            New-Item -ItemType Directory -Path $o -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $o 'daubert_global_FREQUENT_20200101_000000.dump') -Value 'PLAINTEXT RESIDUAL' -Encoding ASCII
        }
        $script:foreignDir = Join-Path $script:env.StagingRoot 'carpeta-ajena-de-otro-uso'
        New-Item -ItemType Directory -Path $script:foreignDir -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $script:env.StagingRoot 'archivo-suelto.txt') -Value 'no tocar' -Encoding ASCII
    }
    AfterEach { Remove-Item -LiteralPath $script:env.Root -Recurse -Force -ErrorAction SilentlyContinue; Clear-FakeTools }

    It 'al iniciar una ejecución (lock adquirido) elimina los directorios <RunId> huérfanos y lo registra en el log' {
        Invoke-Backup -Env $script:env -Tier Frequent | Should Be 0
        Test-Path -LiteralPath $script:orphanA | Should Be $false
        Test-Path -LiteralPath $script:orphanB | Should Be $false
        (Get-LogText $script:env Frequent) | Should Match 'cleanup_orphan_staging'
    }

    It 'solo borra directorios con forma de RunId: carpetas y archivos ajenos en staging se respetan' {
        Invoke-Backup -Env $script:env -Tier Frequent | Out-Null
        Test-Path -LiteralPath $script:foreignDir | Should Be $true
        Test-Path -LiteralPath (Join-Path $script:env.StagingRoot 'archivo-suelto.txt') | Should Be $true
    }

    It 'nunca toca backups publicados (ni destino, ni sidecars, ni logs)' {
        $tierDir = Join-Path $script:env.BackupRoot 'FREQUENT'
        New-Item -ItemType Directory -Path $tierDir -Force | Out-Null
        $keep = Join-Path $tierDir 'daubert_global_FREQUENT_20260927_120000.age'
        Set-Content -LiteralPath $keep -Value 'publicado valido' -Encoding ASCII
        Set-Content -LiteralPath "$keep.sha256" -Value 'abc  x' -Encoding ASCII
        Invoke-Backup -Env $script:env -Tier Frequent -Now '2026-09-28T14:00:07' | Should Be 0
        Test-Path -LiteralPath $keep | Should Be $true
        Test-Path -LiteralPath "$keep.sha256" | Should Be $true
    }

    It 'respeta el lock: si otra ejecución lo tiene, NO se borra nada (podría ser su staging en uso)' {
        $held = Enter-BackupLock -LockFilePath $script:env.LockFilePath -TimeoutSeconds 0
        try { Invoke-Backup -Env $script:env -Tier Frequent | Should Be 2 } finally { Exit-BackupLock -LockHandle $held }
        Test-Path -LiteralPath $script:orphanA | Should Be $true
        Test-Path -LiteralPath $script:orphanB | Should Be $true
    }

    It 'es idempotente: la segunda ejecución no encuentra huérfanos y no registra limpieza' {
        Invoke-Backup -Env $script:env -Tier Frequent -Now '2026-09-28T14:00:07' | Out-Null
        Remove-Item -LiteralPath (Join-Path $script:env.BackupRoot 'LOGS') -Recurse -Force
        Invoke-Backup -Env $script:env -Tier Frequent -Now '2026-09-28T15:00:07' | Should Be 0
        (Get-LogText $script:env Frequent) | Should Not Match 'cleanup_orphan_staging'
    }

    It 'también limpia en -DryRun (solo staging)' {
        Invoke-Backup -Env $script:env -Tier Daily -DryRun | Should Be 0
        Test-Path -LiteralPath $script:orphanA | Should Be $false
        Test-Path (Join-Path $script:env.BackupRoot 'DAILY') | Should Be $false
    }

    It 'Remove-OrphanedStagingDirectory: respeta KeepPath, ignora raíces inexistentes y devuelve solo lo eliminado' {
        @(Remove-OrphanedStagingDirectory -StagingRoot (Join-Path $script:env.Root 'no-existe')).Count | Should Be 0
        $removed = @(Remove-OrphanedStagingDirectory -StagingRoot $script:env.StagingRoot -KeepPath $script:orphanA)
        $removed.Count | Should Be 1
        Test-Path -LiteralPath $script:orphanA | Should Be $true
        Test-Path -LiteralPath $script:orphanB | Should Be $false
    }

    It 'la limpieza no aparece en FREQUENT/DAILY/MONTHLY como etapa de pg_dump: no ejecuta procesos externos' {
        $global:ProcSim.Calls.Clear()
        Remove-OrphanedStagingDirectory -StagingRoot $script:env.StagingRoot | Out-Null
        $global:ProcSim.Calls.Count | Should Be 0
    }
}

# Dobles de la comprobación "¿toca?": los Mock de Pester 3.4 con -ModuleName pueden filtrarse entre pruebas, así que
# se registran UNA vez por prueba (BeforeEach) y su comportamiento lo decide $global:DueMode / $global:LatestMode.
$global:RealDueState = Get-Command Get-BackupDueState -Module BackupPipeline
$global:RealLatest = & (Get-Module BackupPipeline) { Get-Command Get-LatestPublishedBackup }
function global:Initialize-DueDoubles { $global:DueMode = 'real'; $global:LatestMode = 'real'; $global:DueCalls = 0 }
function global:Invoke-LatestPublishedDouble {
    param($TargetDir, $Pattern)
    if ($global:LatestMode -eq 'throw') { throw 'carpeta del tier ilegible (simulado)' }
    & $global:RealLatest -TargetDir $TargetDir -Pattern $Pattern
}
function global:Invoke-DueStateDouble {
    param($Config, $Schedule, $Now)
    $global:DueCalls++
    switch ($global:DueMode) {
        'throw' { throw 'fallo simulado de la comprobación' }
        'throw-from-second' { if ($global:DueCalls -ge 2) { throw 'fallo simulado dentro del lock' } }
        'race' {
            # Otra ejecución publicó el backup entre la comprobación previa y la toma del lock.
            if ($global:DueCalls -eq 1) { return [pscustomobject]@{ Due = $true; Reason = 'latest_before_scheduled_instant'; ScheduledInstant = [datetime]'2026-10-01T02:00:00'; LatestPublished = [datetime]'2026-09-30T02:03:01' } }
            return [pscustomobject]@{ Due = $false; Reason = 'up_to_date'; ScheduledInstant = [datetime]'2026-10-01T02:00:00'; LatestPublished = [datetime]'2026-10-01T09:44:00' }
        }
    }
    & $global:RealDueState -Config $Config -Schedule $Schedule -Now $Now
}

function New-SeededBackup {
    # Backup ya publicado (.age + .sha256) con el timestamp indicado (yyyyMMdd_HHmmss), sin ejecutar nada.
    param($Env, [string]$Tier, [string]$Stamp, [switch]$NoSidecar)
    $dir = Join-Path $Env.BackupRoot $Tier.ToUpperInvariant()
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $name = "daubert_global_$($Tier.ToUpperInvariant())_$Stamp.age"
    Set-Content -LiteralPath (Join-Path $dir $name) -Value 'x' -Encoding UTF8
    if (-not $NoSidecar) { Set-Content -LiteralPath (Join-Path $dir "$name.sha256") -Value 'abc  x' -Encoding ASCII }
}

function Get-PublishedArchives {
    param($Env, [string]$Tier)
    @(Get-Published $Env $Tier | Where-Object { $_ -match '\.age$' })
}

function Get-LogFileCount {
    param($Env, [string]$Tier)
    $dir = Join-Path $Env.BackupRoot ('LOGS\' + $Tier.ToUpperInvariant())
    if (Test-Path -LiteralPath $dir) { @(Get-ChildItem -LiteralPath $dir -Filter '*.log.jsonl').Count } else { 0 }
}

Describe 'Pipeline con -OnlyIfDue: un backup pendiente se recupera y uno ya exitoso no se duplica' {

    BeforeEach {
        $script:env = New-IsolatedTestRoot
        Reset-ProcessSim
        Mock Invoke-ExternalProcess { Invoke-FakePgProcess -FilePath $FilePath -ArgumentList $ArgumentList -EnvironmentVariables $EnvironmentVariables } -ModuleName BackupPgTools
        Mock Invoke-AgeProcess { Invoke-FakeAgeProcess -AgePath $AgePath -ArgumentList $ArgumentList } -ModuleName BackupEncryption
        Mock Invoke-SevenZipProcess { Invoke-FakeSevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory } -ModuleName BackupPackaging
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig
        Initialize-DueDoubles
        Mock Get-BackupDueState { Invoke-DueStateDouble -Config $Config -Schedule $Schedule -Now $Now } -ModuleName BackupPipeline
        Mock Get-LatestPublishedBackup { Invoke-LatestPublishedDouble -TargetDir $TargetDir -Pattern $Pattern } -ModuleName BackupPipeline
    }

    AfterEach {
        Remove-Item -LiteralPath $script:env.Root -Recurse -Force -ErrorAction SilentlyContinue
        Clear-FakeTools
    }

    Context 'Daily' {

        It 'sin backups previos: hace el Daily; la repetición horaria siguiente termina en 0 sin hacer nada (ni pg_dump, ni log, ni archivos nuevos)' {
            (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 0
            Get-PublishedArchives $script:env Daily | Should Be @('daubert_global_DAILY_20261001_094400.age')
            $dumps = @(Get-SimCalls 'pg_dump').Count
            $logs = Get-LogFileCount $script:env Daily
            $dumps | Should BeGreaterThan 0

            (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T10:44:00') | Should Be 0
            (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-02T01:44:00') | Should Be 0
            Get-PublishedArchives $script:env Daily | Should Be @('daubert_global_DAILY_20261001_094400.age')
            @(Get-SimCalls 'pg_dump').Count | Should Be $dumps
            Get-LogFileCount $script:env Daily | Should Be $logs
        }

        It 'PC apagada: el último es de hace 3 días; al encender hace UN solo backup nuevo y luego ya no' {
            New-SeededBackup -Env $script:env -Tier Daily -Stamp '20260930_020301'
            (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-04T09:44:00') | Should Be 0
            Get-PublishedArchives $script:env Daily | Should Be @('daubert_global_DAILY_20260930_020301.age', 'daubert_global_DAILY_20261004_094400.age')
            (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-04T10:44:00') | Should Be 0
            @(Get-PublishedArchives $script:env Daily).Count | Should Be 2
        }

        It 'ya existe el Daily de hoy: exit 0 sin hacer nada' {
            New-SeededBackup -Env $script:env -Tier Daily -Stamp '20261001_020301'
            (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 0
            Get-PublishedArchives $script:env Daily | Should Be @('daubert_global_DAILY_20261001_020301.age')
            @(Get-SimCalls 'pg_dump').Count | Should Be 0
        }

        It 'un .age SIN sidecar (publicación interrumpida) no cuenta: se vuelve a hacer' {
            New-SeededBackup -Env $script:env -Tier Daily -Stamp '20261001_020301' -NoSidecar
            (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 0
            (Get-Published $script:env Daily) -contains 'daubert_global_DAILY_20261001_094400.age.sha256' | Should Be $true
        }

        It 'SIN -OnlyIfDue el comportamiento no cambia: una ejecución manual siempre hace backup' {
            New-SeededBackup -Env $script:env -Tier Daily -Stamp '20261001_020301'
            (Invoke-Backup -Env $script:env -Tier Daily -Now '2026-10-01T09:44:00') | Should Be 0
            @(Get-PublishedArchives $script:env Daily).Count | Should Be 2
        }
    }

    Context 'Monthly (no depende de una única ejecución el día 1)' {

        It 'ciclo completo: septiembre hecho -> no toca hasta el 1 a las 03:00 -> intento fallido -> reintento horario -> hecho -> no toca hasta noviembre' {
            New-SeededBackup -Env $script:env -Tier Monthly -Stamp '20260901_030012'

            # Día 1 antes de las 03:00: nada que hacer.
            (Invoke-Backup -Env $script:env -Tier Monthly -OnlyIfDue -Now '2026-10-01T02:59:00') | Should Be 0
            @(Get-PublishedArchives $script:env Monthly).Count | Should Be 1
            @(Get-SimCalls 'pg_dump').Count | Should Be 0

            # 03:00: toca, pero el intento FALLA (pg_dump) -> no hay artefacto y NO cuenta como éxito.
            $global:ProcSim.PgDump.Mode = 'NO_FILE'; $global:ProcSim.PgDump.ExitCode = 1
            (Invoke-Backup -Env $script:env -Tier Monthly -OnlyIfDue -Now '2026-10-01T03:00:00') | Should Be 4
            @(Get-PublishedArchives $script:env Monthly).Count | Should Be 1

            # El siguiente disparo horario lo reintenta y esta vez funciona.
            Reset-ProcessSim
            (Invoke-Backup -Env $script:env -Tier Monthly -OnlyIfDue -Now '2026-10-01T04:00:00') | Should Be 0
            Get-PublishedArchives $script:env Monthly | Should Be @('daubert_global_MONTHLY_20260901_030012.age', 'daubert_global_MONTHLY_20261001_040000.age')

            # Ya existe el del mes: los disparos horarios de todos los días siguientes terminan en 0 sin hacer nada.
            $dumps = @(Get-SimCalls 'pg_dump').Count
            foreach ($d in '2026-10-01T05:00:00', '2026-10-02T09:44:00', '2026-10-20T12:00:00', '2026-10-31T23:00:00') {
                (Invoke-Backup -Env $script:env -Tier Monthly -OnlyIfDue -Now $d) | Should Be 0
            }
            @(Get-PublishedArchives $script:env Monthly).Count | Should Be 2
            @(Get-SimCalls 'pg_dump').Count | Should Be $dumps

            # Noviembre: vuelve a tocar.
            (Invoke-Backup -Env $script:env -Tier Monthly -OnlyIfDue -Now '2026-11-01T03:00:00') | Should Be 0
            @(Get-PublishedArchives $script:env Monthly).Count | Should Be 3
        }

        It 'PC apagada el día 1: al encender el día 2 (o el 15) hace el Monthly del mes UNA vez' {
            New-SeededBackup -Env $script:env -Tier Monthly -Stamp '20260901_030012'
            (Invoke-Backup -Env $script:env -Tier Monthly -OnlyIfDue -Now '2026-10-15T09:44:00') | Should Be 0
            Get-PublishedArchives $script:env Monthly | Should Be @('daubert_global_MONTHLY_20260901_030012.age', 'daubert_global_MONTHLY_20261015_094400.age')
            (Invoke-Backup -Env $script:env -Tier Monthly -OnlyIfDue -Now '2026-10-15T10:44:00') | Should Be 0
            @(Get-PublishedArchives $script:env Monthly).Count | Should Be 2
        }
    }

    Context 'Frequent' {
        It 'Frequent ignora -OnlyIfDue: siempre hace backup' {
            (Invoke-Backup -Env $script:env -Tier Frequent -OnlyIfDue -Now '2026-10-01T08:30:00') | Should Be 0
            (Invoke-Backup -Env $script:env -Tier Frequent -OnlyIfDue -Now '2026-10-01T08:30:05') | Should Be 0
            @(Get-PublishedArchives $script:env Frequent).Count | Should Be 2
        }
    }

    Context 'Lock ocupado: un fallo temporal no es una pérdida definitiva' {

        It 'con el lock tomado y LockTimeoutSeconds 0: exit 2 sin artefacto; liberado el lock, el siguiente disparo horario lo recupera' {
            $held = Enter-BackupLock -LockFilePath $script:env.LockFilePath -TimeoutSeconds 0
            try {
                (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 2
                @(Get-PublishedArchives $script:env Daily).Count | Should Be 0
                @(Get-SimCalls 'pg_dump').Count | Should Be 0
            }
            finally { Exit-BackupLock -LockHandle $held }

            (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T10:44:00') | Should Be 0
            Get-PublishedArchives $script:env Daily | Should Be @('daubert_global_DAILY_20261001_104400.age')
        }

        It 'si el backup del periodo ya existe, un lock ocupado NO es un error (exit 0 sin esperar ni tocar nada)' {
            New-SeededBackup -Env $script:env -Tier Daily -Stamp '20261001_020301'
            $held = Enter-BackupLock -LockFilePath $script:env.LockFilePath -TimeoutSeconds 0
            try {
                (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 0
            }
            finally { Exit-BackupLock -LockHandle $held }
        }

        It 'LockTimeoutSeconds > 0: espera a que otra ejecución suelte el lock y luego hace el backup (sin exit 2)' {
            $lockPath = $script:env.LockFilePath
            $lockModule = Join-Path $backupRoot 'lib\BackupLock.psm1'
            $job = Start-Job -ScriptBlock {
                param($Module, $Path)
                Import-Module $Module -Force
                $h = Enter-BackupLock -LockFilePath $Path -TimeoutSeconds 0
                Start-Sleep -Seconds 3
                Exit-BackupLock -LockHandle $h
            } -ArgumentList $lockModule, $lockPath
            try {
                $deadline = (Get-Date).AddSeconds(30)
                while (-not (Test-Path -LiteralPath $lockPath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
                Test-Path -LiteralPath $lockPath | Should Be $true

                (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -LockTimeoutSeconds 60 -Now '2026-10-01T09:44:00') | Should Be 0
                Get-PublishedArchives $script:env Daily | Should Be @('daubert_global_DAILY_20261001_094400.age')
            }
            finally { Wait-Job $job -Timeout 30 | Out-Null; Remove-Job $job -Force -ErrorAction SilentlyContinue }
        }

        It 'LockTimeoutSeconds agotado (lock que no se suelta): exit 2 limpio, sin staging huérfano ni artefacto' {
            $held = Enter-BackupLock -LockFilePath $script:env.LockFilePath -TimeoutSeconds 0
            try {
                (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -LockTimeoutSeconds 2 -Now '2026-10-01T09:44:00') | Should Be 2
                @(Get-PublishedArchives $script:env Daily).Count | Should Be 0
                @(Get-ChildItem -LiteralPath $script:env.StagingRoot -Force -ErrorAction SilentlyContinue).Count | Should Be 0
            }
            finally { Exit-BackupLock -LockHandle $held }
        }
    }

    Context 'Sin duplicados: segunda comprobación DENTRO del lock' {

        It 'si otra ejecución publicó el backup entre la comprobación previa y la toma del lock, no genera otro (exit 0, log due_check skipped, lock liberado)' {
            $global:DueMode = 'race'

            (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:30') | Should Be 0
            $global:DueCalls | Should Be 2
            @(Get-PublishedArchives $script:env Daily).Count | Should Be 0
            @(Get-SimCalls 'pg_dump').Count | Should Be 0
            (Get-LogText $script:env Daily) | Should Match '"stage":"due_check","result":"skipped"'
            Test-Path -LiteralPath $script:env.LockFilePath | Should Be $false
        }
    }

    Context 'Resolución de configuración y entrypoint' {

        It 'Resolve-BackupRunConfig devuelve el schedule efectivo del tier (defaults sin config.json)' {
            $m = (Resolve-BackupRunConfig -Tier Monthly).Schedule
            $m.startTime | Should Be '03:00'
            $m.dayOfMonth | Should Be 1
            (Resolve-BackupRunConfig -Tier Daily).Schedule.startTime | Should Be '02:00'
        }

        It 'Start-DaubertPostgresBackup.ps1 expone -OnlyIfDue y lo pasa al pipeline' {
            $script = Get-Content -LiteralPath (Join-Path $backupRoot 'commands\Start-DaubertPostgresBackup.ps1') -Raw
            $script | Should Match '\[switch\]\$OnlyIfDue'
            $script | Should Match 'OnlyIfDue\s+=\s+\$OnlyIfDue'
        }
    }
}

Describe 'Pipeline con -OnlyIfDue: si la comprobación "¿toca?" falla, se continúa con el pipeline normal (no exit 1 sin log)' {

    BeforeEach {
        $script:env = New-IsolatedTestRoot
        Reset-ProcessSim
        Initialize-DueDoubles
        Mock Invoke-ExternalProcess { Invoke-FakePgProcess -FilePath $FilePath -ArgumentList $ArgumentList -EnvironmentVariables $EnvironmentVariables } -ModuleName BackupPgTools
        Mock Invoke-AgeProcess { Invoke-FakeAgeProcess -AgePath $AgePath -ArgumentList $ArgumentList } -ModuleName BackupEncryption
        Mock Invoke-SevenZipProcess { Invoke-FakeSevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory } -ModuleName BackupPackaging
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig
        Mock Get-BackupDueState { Invoke-DueStateDouble -Config $Config -Schedule $Schedule -Now $Now } -ModuleName BackupPipeline
        Mock Get-LatestPublishedBackup { Invoke-LatestPublishedDouble -TargetDir $TargetDir -Pattern $Pattern } -ModuleName BackupPipeline
    }

    AfterEach {
        $global:DueMode = 'real'; $global:LatestMode = 'real'
        Remove-Item -LiteralPath $script:env.Root -Recurse -Force -ErrorAction SilentlyContinue
        Clear-FakeTools
    }

    It 'lectura de la carpeta del tier fallida (Get-LatestPublishedBackup lanza): hace el backup, exit 0, y deja un warning due_check en el log' {
        $global:LatestMode = 'throw'
        (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 0
        Get-PublishedArchives $script:env Daily | Should Be @('daubert_global_DAILY_20261001_094400.age')
        $log = Get-LogText $script:env Daily
        $log | Should Match '"stage":"due_check","result":"warning"'
        $log | Should Match 'carpeta del tier ilegible \(simulado\)'
        $log | Should Match '"stage":"run","result":"success"'
        Test-Path -LiteralPath $script:env.LockFilePath | Should Be $false
    }

    It 'Get-BackupDueState lanza siempre (antes y dentro del lock): exit 0, backup hecho y un warning en cada comprobación' {
        $global:DueMode = 'throw'
        (Invoke-Backup -Env $script:env -Tier Monthly -OnlyIfDue -Now '2026-10-01T03:00:00') | Should Be 0
        Get-PublishedArchives $script:env Monthly | Should Be @('daubert_global_MONTHLY_20261001_030000.age')
        $log = Get-LogText $script:env Monthly
        ([regex]::Matches($log, '"stage":"due_check","result":"warning"')).Count | Should Be 2
        $log | Should Match 'No se pudo determinar si ya existe el backup'
        $log | Should Match 'No se pudo repetir la comprobación dentro del lock'
    }

    It 'si además el pipeline falla (pg_dump), el error queda registrado por el mecanismo existente: exit 4 (no 1), log con warning y failure' {
        $global:DueMode = 'throw'
        $global:ProcSim.PgDump.Mode = 'NO_FILE'; $global:ProcSim.PgDump.ExitCode = 1
        (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 4
        @(Get-PublishedArchives $script:env Daily).Count | Should Be 0
        $log = Get-LogText $script:env Daily
        $log | Should Match '"stage":"due_check","result":"warning"'
        $log | Should Match '"stage":"run","result":"failure"'
        Test-Path -LiteralPath $script:env.LockFilePath | Should Be $false
    }

    It 'solo falla la segunda comprobación (dentro del lock): continúa y lo registra' {
        $global:DueMode = 'throw-from-second'
        (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 0
        $global:DueCalls | Should Be 2
        @(Get-PublishedArchives $script:env Daily).Count | Should Be 1
        $log = Get-LogText $script:env Daily
        ([regex]::Matches($log, '"stage":"due_check","result":"warning"')).Count | Should Be 1
        $log | Should Match 'No se pudo repetir la comprobación dentro del lock'
    }

    It 'ante la duda no se OMITE: si no se puede comprobar, hace el backup aunque ya exista uno del periodo' {
        New-SeededBackup -Env $script:env -Tier Daily -Stamp '20261001_020301'
        $global:LatestMode = 'throw'
        (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 0
        @(Get-PublishedArchives $script:env Daily).Count | Should Be 2
    }

    It 'sin errores en la comprobación no aparece ningún warning due_check (comportamiento normal intacto)' {
        (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 0
        $global:DueCalls | Should Be 2
        (Get-LogText $script:env Daily) | Should Not Match '"stage":"due_check"'
    }

    It 'sin errores y con el backup del periodo ya hecho: sigue omitiendo con exit 0 (la protección contra duplicados no cambió)' {
        New-SeededBackup -Env $script:env -Tier Daily -Stamp '20261001_020301'
        (Invoke-Backup -Env $script:env -Tier Daily -OnlyIfDue -Now '2026-10-01T09:44:00') | Should Be 0
        @(Get-PublishedArchives $script:env Daily).Count | Should Be 1
        @(Get-SimCalls 'pg_dump').Count | Should Be 0
    }

    It 'Get-BackupDueStateSafe nunca lanza y siempre devuelve la propiedad Error' {
        $cfg = [pscustomobject]@{ Tier = 'Daily'; TierDir = (Join-Path $script:env.BackupRoot 'DAILY'); PgDatabase = 'daubert_global' }
        $ok = Get-BackupDueStateSafe -Config $cfg -Schedule ([pscustomobject]@{ startTime = '02:00' }) -Now ([datetime]'2026-10-01T09:44:00')
        $ok.Error | Should BeNullOrEmpty
        $ok.Due | Should Be $true
        $bad = Get-BackupDueStateSafe -Config $cfg -Schedule ([pscustomobject]@{ startTime = '99:99' }) -Now ([datetime]'2026-10-01T09:44:00')
        $bad.Due | Should Be $true
        $bad.Reason | Should Be 'due_check_error'
        $bad.Error | Should Match 'startTime'
    }
}
