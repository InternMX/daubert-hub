#Requires -Version 5.1
<#
    Pruebas del backup de n8n V1 (BackupN8nPipeline.psm1 + Start-DaubertN8nBackup.ps1).

    IMPORTANTE:
      - No se toca n8n real, Task Scheduler, PostgreSQL ni se hace ningún backup real.
      - No se crea, compila ni copia ningún ejecutable. Los seams de procesos externos
        están mockeados con Pester:
            Invoke-NodeProcess     (BackupN8nSqlite)  helper de snapshot SQLite / node --version
            Invoke-SevenZipProcess (BackupPackaging)  7z
            Invoke-AgeProcess      (BackupEncryption) age
        y Test-BackupToolPath simula que las herramientas existen.
      - La instalación de n8n es una carpeta temporal con archivos de texto minúsculos.
      - Ninguna prueba usa ni necesita una clave privada age.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\Backup-N8n.Tests.ps1"
#>

$backupRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'helpers\N8nTestDoubles.ps1')
foreach ($m in 'BackupConfig', 'BackupLock', 'BackupHash', 'BackupN8nConfig', 'BackupN8nSqlite', 'BackupN8nStaging', 'BackupN8nPipeline') { Import-Module (Join-Path $backupRoot "lib\$m.psm1") -Force -DisableNameChecking }

function Set-N8nMocks {
    Reset-N8nSim
    Mock Invoke-NodeProcess { Invoke-FakeNodeProcess -NodePath $NodePath -ArgumentList $ArgumentList } -ModuleName BackupN8nSqlite
    Mock Invoke-AgeProcess { Invoke-FakeAgeProcess -AgePath $AgePath -ArgumentList $ArgumentList } -ModuleName BackupEncryption
    Mock Invoke-SevenZipProcess { Invoke-FakeSevenZipCapture -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory } -ModuleName BackupPackaging
    Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupN8nConfig
}

Describe 'n8n backup - tiers, nombres y retención por defecto' {

    It 'Weekly: 56 días, carpeta WEEKLY' {
        $d = Get-N8nTierDefinition -Tier Weekly
        $d.RetentionUnit | Should Be 'Days'
        $d.RetentionValue | Should Be 56
        $d.SubDir | Should Be 'WEEKLY'
    }
    It 'OnChange: 90 días, carpeta ON_CHANGE' {
        $d = Get-N8nTierDefinition -Tier OnChange
        $d.RetentionUnit | Should Be 'Days'
        $d.RetentionValue | Should Be 90
        $d.SubDir | Should Be 'ON_CHANGE'
    }
    It 'solo existen los tiers Weekly y OnChange' {
        { Get-N8nTierDefinition -Tier Daily } | Should Throw
        (Get-Command Get-N8nTierDefinition).Parameters['Tier'].Attributes.ValidValues -join ',' | Should Be 'Weekly,OnChange'
    }
    It 'nombres de artefacto n8n_WEEKLY_ y n8n_ON_CHANGE_ con timestamp' {
        New-N8nArchiveFileName -Tier Weekly -Timestamp '20260928_140007' | Should Be 'n8n_WEEKLY_20260928_140007.age'
        New-N8nArchiveFileName -Tier OnChange -Timestamp '20260928_140007' | Should Be 'n8n_ON_CHANGE_20260928_140007.age'
        'n8n_WEEKLY_20260928_140007.age' -match (Get-N8nArchiveFileNamePattern -Tier Weekly) | Should Be $true
        'n8n_ON_CHANGE_20260928_140007.age' -match (Get-N8nArchiveFileNamePattern -Tier Weekly) | Should Be $false
        'daubert_global_MONTHLY_20260928_140007.age' -match (Get-N8nArchiveFileNamePattern -Tier OnChange) | Should Be $false
    }
}

Describe 'n8n backup - config.json (-ConfigPath): sin secretos, rutas absolutas' {

    BeforeEach { $script:e = New-N8nTestEnv; Set-N8nMocks }
    AfterEach { Remove-Item -LiteralPath $script:e.Root -Recurse -Force -ErrorAction SilentlyContinue; Clear-FakeTools }

    function Write-N8nCfg { param($Env, [hashtable]$Extra = @{}, [string[]]$Drop = @())
        $c = [ordered]@{ schemaVersion = 1; n8nRoot = $Env.N8nRoot; nodePath = $Env.NodePath; sevenZipPath = $Env.SevenZipPath; agePath = $Env.AgePath
            recipientsFilePath = $Env.RecipientsFilePath; backupRoot = $Env.BackupRoot; stagingRoot = $Env.StagingRoot; logRoot = $Env.LogRoot; lockRoot = $Env.LockRoot; n8nPackagePath = $Env.N8nPackagePath }
        foreach ($k in $Extra.Keys) { $c[$k] = $Extra[$k] }
        foreach ($k in $Drop) { $c.Remove($k) }
        $p = Join-Path $Env.Root 'n8n-backup.json'
        [System.IO.File]::WriteAllText($p, ($c | ConvertTo-Json -Depth 5))
        return $p
    }

    It 'una config válida se resuelve y aplica retención personalizada' {
        $p = Write-N8nCfg -Env $script:e -Extra @{ retention = @{ Weekly = @{ unit = 'Days'; value = 10 } } }
        $r = Resolve-N8nBackupRunConfig -Tier Weekly -ConfigPath $p
        @($r.Errors).Count | Should Be 0
        $r.Config.RetentionValue | Should Be 10
        (Resolve-N8nBackupRunConfig -Tier OnChange -ConfigPath $p).Config.RetentionValue | Should Be 90
    }
    It 'los parámetros explícitos del CLI prevalecen sobre config.json' {
        $p = Write-N8nCfg -Env $script:e
        $r = Resolve-N8nBackupRunConfig -Tier Weekly -ConfigPath $p -CliParameters @{ BackupRoot = (Join-Path $script:e.Root 'otro') }
        $r.Config.BackupRoot | Should Be (Join-Path $script:e.Root 'otro')
    }
    It 'rechaza una config con secretos (nombre de clave o clave privada age) sin imprimir el valor' {
        $p = Write-N8nCfg -Env $script:e -Extra @{ encryptionKey = 'VALOR_SECRETO_XYZ'; apiToken = 'abc' }
        $r = Resolve-N8nBackupRunConfig -Tier Weekly -ConfigPath $p
        $r.Config | Should BeNullOrEmpty
        ($r.Errors -join "`n") | Should Match 'SECRETO RECHAZADO'
        ($r.Errors -join "`n") | Should Not Match 'VALOR_SECRETO_XYZ'
    }
    It 'rechaza campos obligatorios ausentes y rutas relativas' {
        $p = Write-N8nCfg -Env $script:e -Drop @('n8nRoot') -Extra @{ backupRoot = 'relativa\ruta' }
        $r = Resolve-N8nBackupRunConfig -Tier Weekly -ConfigPath $p
        ($r.Errors -join "`n") | Should Match "n8nRoot"
        ($r.Errors -join "`n") | Should Match 'ABSOLUTA'
    }
    It 'rechaza un tier inválido en retention' {
        $p = Write-N8nCfg -Env $script:e -Extra @{ retention = @{ Daily = @{ unit = 'Days'; value = 3 } } }
        (Resolve-N8nBackupRunConfig -Tier Weekly -ConfigPath $p).Errors.Count | Should BeGreaterThan 0
    }
    It 'un ConfigPath inexistente da exit 3' {
        $r = Invoke-N8nBackup -Env $script:e -Override @{}
        $r.ExitCode | Should Be 0
        $x = @(Invoke-DaubertN8nBackupRun -Tier Weekly -ConfigPath (Join-Path $script:e.Root 'no-existe.json') *>&1 | Where-Object { $_ -is [int] })
        $x[-1] | Should Be 3
    }
    It 'backupRoot/stagingRoot dentro de n8nRoot se rechazan (nunca se escribe en la instalación de n8n)' {
        (Invoke-N8nBackup -Env $script:e -Override @{ StagingRoot = (Join-Path $script:e.N8nRoot 'tmp') }).ExitCode | Should Be 3
        (Invoke-N8nBackup -Env $script:e -Override @{ BackupRoot = (Join-Path $script:e.N8nRoot 'bk') }).ExitCode | Should Be 3
        Test-Path -LiteralPath (Join-Path $script:e.N8nRoot 'tmp') | Should Be $false
        Test-Path -LiteralPath (Join-Path $script:e.N8nRoot 'bk') | Should Be $false
    }
}

Describe 'n8n backup - pipeline completo (procesos externos mockeados)' {

    BeforeEach { $script:e = New-N8nTestEnv; Set-N8nMocks }
    AfterEach { Remove-Item -LiteralPath $script:e.Root -Recurse -Force -ErrorAction SilentlyContinue; Clear-FakeTools }

    Context 'Happy path por tier' {
        It 'Weekly: exit 0 y publica SOLO n8n_WEEKLY_*.age + .age.sha256' {
            $r = Invoke-N8nBackup -Env $script:e -Tier Weekly
            $r.ExitCode | Should Be 0
            $f = @(Get-N8nPublished -Env $script:e -SubDir 'WEEKLY' | Sort-Object Name)
            $f.Count | Should Be 2
            $f[0].Name | Should Be 'n8n_WEEKLY_20260928_140007.age'
            $f[1].Name | Should Be 'n8n_WEEKLY_20260928_140007.age.sha256'
            @(Get-N8nPublished -Env $script:e -SubDir 'ON_CHANGE').Count | Should Be 0
        }
        It 'OnChange: exit 0 y publica SOLO n8n_ON_CHANGE_*.age + .age.sha256' {
            $r = Invoke-N8nBackup -Env $script:e -Tier OnChange
            $r.ExitCode | Should Be 0
            $f = @(Get-N8nPublished -Env $script:e -SubDir 'ON_CHANGE' | Sort-Object Name)
            $f.Count | Should Be 2
            $f[0].Name | Should Be 'n8n_ON_CHANGE_20260928_140007.age'
            $f[1].Name | Should Be 'n8n_ON_CHANGE_20260928_140007.age.sha256'
        }
        It 'nunca se publica un .7z ni plaintext: en destino final solo .age y .age.sha256' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $all = @(Get-ChildItem -LiteralPath $script:e.BackupRoot -Recurse -File | Where-Object { $_.FullName -notmatch '\\LOGS\\' })
            foreach ($x in $all) { ($x.Name -match '\.age$' -or $x.Name -match '\.age\.sha256$') | Should Be $true }
        }
    }

    Context 'Snapshot SQLite por node:sqlite (nunca Copy-Item sobre database.sqlite)' {
        It 'el snapshot se pide al helper Node con --source = database.sqlite y --dest en staging' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $calls = $global:N8nSim.Calls.ToArray()
            $calls.Count | Should Be 1
            $a = $calls[0].Args
            (Get-ArgumentAfter $a '--source') | Should Be (Join-Path $script:e.N8nRoot 'database.sqlite')
            $dest = Get-ArgumentAfter $a '--dest'
            $dest | Should Not Be (Join-Path $script:e.N8nRoot 'database.sqlite')
            $dest.StartsWith($script:e.N8nStaging, [System.StringComparison]::OrdinalIgnoreCase) | Should Be $true
            ($a | Where-Object { $_ -like '*n8n-sqlite-snapshot.js' }) | Should Not BeNullOrEmpty
        }
        It 'el código de los módulos n8n nunca usa Copy-Item/Move-Item/robocopy sobre database.sqlite' {
            foreach ($m in 'BackupN8nPipeline', 'BackupN8nSqlite', 'BackupN8nStaging', 'BackupN8nConfig') {
                foreach ($line in (Get-Content -LiteralPath (Join-Path $backupRoot "lib\$m.psm1"))) {
                    if ($line -match '^\s*#') { continue }
                    ($line -match '(Copy-Item|Move-Item|robocopy|\.CopyTo|File\]::Copy)' -and $line -match 'database|sqlite') | Should Be $false
                }
            }
        }
        It 'el helper usa solo node:sqlite (DatabaseSync + backup) y ningún paquete externo' {
            $js = Get-Content -LiteralPath (Join-Path $backupRoot 'helpers\n8n-sqlite-snapshot.js') -Raw
            $js | Should Match "require\('node:sqlite'\)"
            $js | Should Match 'DatabaseSync'
            $js | Should Match 'await backup\('
            $js | Should Match 'PRAGMA quick_check'
            $js | Should Match 'sqlite_schema'
            @([regex]::Matches($js, "require\('([^']+)'\)") | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ -notlike 'node:*' }).Count | Should Be 0
        }
        It 'WAL, SHM, logs y n8nEventLog NUNCA se incluyen en el bundle plaintext' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $tree = @($global:BundleTree)
            $tree.Count | Should BeGreaterThan 0
            ($tree | Where-Object { $_ -match '(?i)-wal|-shm|^logs|n8nEventLog|\.log$' }) | Should BeNullOrEmpty
            # el único database.* es el snapshot (contenido del doble), no el original
            $tree -contains 'database.sqlite' | Should Be $true
        }
        It 'quick_check distinto de ok aborta (exit 5) y no publica' {
            $global:N8nSim.Snapshot.ExitCode = 4
            $global:N8nSim.Snapshot.StdOut = '{"ok":false,"error":"quick_check_failed"}'
            $r = Invoke-N8nBackup -Env $script:e
            $r.ExitCode | Should Be 5
            @(Get-N8nPublished -Env $script:e).Count | Should Be 0
            @(Get-SimCalls '7z').Count | Should Be 0
            @(Get-SimCalls 'age').Count | Should Be 0
        }
        It 'exit 0 pero quickCheck != ok también aborta' {
            $global:N8nSim.Snapshot.StdOut = '{"ok":true,"quickCheck":"failed","tableCount":3}'
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 5
            @(Get-N8nPublished -Env $script:e).Count | Should Be 0
        }
        It 'el helper Node devuelve error (exit != 0) -> aborta (exit 4) y no publica' {
            $global:N8nSim.Snapshot.ExitCode = 3
            $global:N8nSim.Snapshot.StdOut = '{"ok":false,"error":"backup_failed","detail":"ERR_SQLITE_ERROR"}'
            $r = Invoke-N8nBackup -Env $script:e
            $r.ExitCode | Should Be 4
            $r.Text | Should Match 'exit code 3'
            @(Get-N8nPublished -Env $script:e).Count | Should Be 0
            @(Get-SimCalls '7z').Count | Should Be 0
        }
        It 'cualquier exit code != 0 es fallo aunque el JSON diga ok' {
            $global:N8nSim.Snapshot.ExitCode = 1
            $global:N8nSim.Snapshot.StdOut = '{"ok":true,"quickCheck":"ok","tableCount":9}'
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 4
            @(Get-N8nPublished -Env $script:e).Count | Should Be 0
        }
        It 'salida del helper que no es JSON (o sin tableCount) -> aborta' {
            $global:N8nSim.Snapshot.StdOut = 'no es json'
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 4
            $global:N8nSim.Snapshot.StdOut = '{"ok":true,"quickCheck":"ok"}'
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 4
        }
        It 'si el helper no crea el snapshot -> aborta' {
            $global:N8nSim.Snapshot.Mode = 'NO_FILE'
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 4
        }
    }

    Context 'config obligatorio y nunca expuesto' {
        It 'config inexistente -> aborta (exit 3) sin ejecutar nada ni publicar' {
            Remove-Item -LiteralPath (Join-Path $script:e.N8nRoot 'config') -Force
            $r = Invoke-N8nBackup -Env $script:e
            $r.ExitCode | Should Be 3
            $global:N8nSim.Calls.Count | Should Be 0
            @(Get-N8nPublished -Env $script:e).Count | Should Be 0
        }
        It 'config se incluye en el bundle y su contenido NUNCA aparece en logs, salida ni manifest' {
            $r = Invoke-N8nBackup -Env $script:e
            $r.ExitCode | Should Be 0
            $global:BundleTree -contains 'config' | Should Be $true
            $global:CapturedConfig | Should Match $global:N8nMarker   # prueba de que se copió tal cual
            $r.Text | Should Not Match $global:N8nMarker
            (Get-N8nLogText -Env $script:e) | Should Not Match $global:N8nMarker
            $global:CapturedManifest | Should Not Match $global:N8nMarker
            $global:CapturedManifest | Should Not Match '(?i)encryptionKey'
        }
        It 'tampoco se filtra en un fallo posterior (logs y salida de un run fallido)' {
            $global:ProcSim.Age.ExitCode = 1
            $r = Invoke-N8nBackup -Env $script:e
            $r.ExitCode | Should Be 10
            $r.Text | Should Not Match $global:N8nMarker
            (Get-N8nLogText -Env $script:e) | Should Not Match $global:N8nMarker
        }
        It 'los módulos n8n nunca leen el contenido de config (sin Get-Content/ReadAllText sobre config)' {
            foreach ($m in 'BackupN8nPipeline', 'BackupN8nStaging', 'BackupN8nConfig', 'BackupN8nSqlite') {
                foreach ($line in (Get-Content -LiteralPath (Join-Path $backupRoot "lib\$m.psm1"))) {
                    if ($line -match '^\s*#') { continue }
                    ($line -match '(Get-Content|ReadAllText|ReadAllBytes|Select-String)' -and $line -match "'config'|configSource") | Should Be $false
                }
            }
        }
    }

    Context 'storage y nodes opcionales' {
        It 'storage inexistente -> backup válido y manifest con storage.included=false' {
            Remove-Item -LiteralPath $script:e.Root -Recurse -Force
            $script:e = New-N8nTestEnv -NoStorage; Set-N8nMocks
            $r = Invoke-N8nBackup -Env $script:e
            $r.ExitCode | Should Be 0
            @(Get-N8nPublished -Env $script:e).Count | Should Be 2
            $m = $global:CapturedManifest | ConvertFrom-Json
            $m.storage.included | Should Be $false
            $m.storage.fileCount | Should Be 0
            ($global:BundleTree | Where-Object { $_ -match '^storage' }) | Should BeNullOrEmpty
            (Get-SimCalls '7z')[0].Args -contains 'storage' | Should Be $false
        }
        It 'nodes inexistente -> backup válido, sin communityNodes' {
            Remove-Item -LiteralPath $script:e.Root -Recurse -Force
            $script:e = New-N8nTestEnv -NoNodes; Set-N8nMocks
            $r = Invoke-N8nBackup -Env $script:e
            $r.ExitCode | Should Be 0
            @(Get-N8nPublished -Env $script:e).Count | Should Be 2
            $m = $global:CapturedManifest | ConvertFrom-Json
            $m.nodes.included | Should Be $false
            @($m.communityNodes).Count | Should Be 0
            (Get-SimCalls '7z')[0].Args -contains 'nodes' | Should Be $false
        }
        It 'storage y nodes existentes se incluyen preservando la estructura' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $global:BundleTree -contains 'storage\workflows\w1\b.bin' | Should Be $true
            $global:BundleTree -contains 'storage\a.bin' | Should Be $true
            $global:BundleTree -contains 'nodes\package.json' | Should Be $true
            $global:BundleTree -contains 'nodes\node_modules\n8n-nodes-pdfbolt\package.json' | Should Be $true
        }
    }

    Context 'Copia estable de storage dentro del pipeline' {
        It 'storage sigue cambiando en los 3 intentos -> exit 13, nada publicado, staging limpio' {
            $global:InvN = 0
            Mock Get-N8nDirectoryInventory { $global:InvN++; @([pscustomobject]@{ Path = 'a.bin'; Length = [long]$global:InvN; LastWriteTicks = [long]1 }) } -ModuleName BackupN8nStaging
            $r = Invoke-N8nBackup -Env $script:e
            $r.ExitCode | Should Be 13
            @(Get-N8nPublished -Env $script:e).Count | Should Be 0
            @(Get-SimCalls '7z').Count | Should Be 0
            @(Get-SimCalls 'age').Count | Should Be 0
            $global:InvN | Should Be 6
            @(Get-ChildItem -LiteralPath $script:e.N8nStaging -ErrorAction SilentlyContinue).Count | Should Be 0
        }
        It 'storage cambia una vez -> reintenta y termina con éxito (stableCopy=true)' {
            $global:InvN = 0
            Mock Get-N8nDirectoryInventory {
                $global:InvN++
                $len = if ($global:InvN -eq 2) { 99 } else { 5 }   # 1ª pasada: antes=5, después=99 (cambió); luego estable
                @([pscustomobject]@{ Path = 'a.bin'; Length = [long]$len; LastWriteTicks = [long]1 })
            } -ModuleName BackupN8nStaging
            $r = Invoke-N8nBackup -Env $script:e
            $r.ExitCode | Should Be 0
            $global:InvN | Should Be 4
            (($global:CapturedManifest | ConvertFrom-Json).storage.stableCopy) | Should Be $true
            @(Get-N8nPublished -Env $script:e).Count | Should Be 2
        }
    }

    Context 'manifest.json' {
        It 'incluye los campos requeridos con los valores esperados' {
            (Invoke-N8nBackup -Env $script:e -Tier OnChange).ExitCode | Should Be 0
            $m = $global:CapturedManifest | ConvertFrom-Json
            $m.schemaVersion | Should Be 1
            $m.backupType | Should Be 'n8n'
            $m.tier | Should Be 'OnChange'
            $m.createdAtUtc | Should Match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
            $m.n8nVersion | Should Be '2.27.4'
            $m.nodeVersion | Should Be '24.19.0'
            $m.database.quickCheck | Should Be 'ok'
            $m.database.tableCount | Should Be 42
            $m.database.sizeBytes | Should BeGreaterThan 0
            $m.config.included | Should Be $true
            $m.storage.included | Should Be $true
            $m.storage.fileCount | Should Be 3
            $m.storage.sizeBytes | Should Be 11
            $m.storage.stableCopy | Should Be $true
        }
        It 'no contiene rutas absolutas, usuario de Windows, secretos ni contenido de config' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $t = $global:CapturedManifest
            $t | Should Not Match '[A-Za-z]:\\'
            $t | Should Not Match '\\\\'
            $t | Should Not Match ([regex]::Escape($script:e.Root))
            if ($env:USERNAME) { $t | Should Not Match ([regex]::Escape($env:USERNAME)) }
            $t | Should Not Match '(?i)encryption|password|secret|token|credential|apikey|AGE-SECRET-KEY'
            $t | Should Not Match $global:N8nMarker
        }
        It 'registra los community packages por nombre y versión' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $m = $global:CapturedManifest | ConvertFrom-Json
            $p = @($m.communityNodes)
            $p.Count | Should Be 2
            ($p | Where-Object { $_.name -eq 'n8n-nodes-htmlcsstopdf' }).version | Should Be '3.2.5'
            ($p | Where-Object { $_.name -eq 'n8n-nodes-pdfbolt' }).version | Should Be '0.1.5'
            @($p | Get-Member -MemberType NoteProperty | ForEach-Object Name | Sort-Object) -join ',' | Should Be 'name,version'
        }
        It 'Get-N8nCommunityPackage usa la versión instalada y cae a la declarada sin rutas' {
            $n = Join-Path $script:e.N8nRoot 'nodes'
            [System.IO.File]::WriteAllText((Join-Path $n 'node_modules\n8n-nodes-pdfbolt\package.json'), '{"name":"n8n-nodes-pdfbolt","version":"0.1.9"}')
            Remove-Item -LiteralPath (Join-Path $n 'node_modules\n8n-nodes-htmlcsstopdf') -Recurse -Force
            $p = @(Get-N8nCommunityPackage -NodesPath $n)
            ($p | Where-Object { $_.name -eq 'n8n-nodes-pdfbolt' }).version | Should Be '0.1.9'
            ($p | Where-Object { $_.name -eq 'n8n-nodes-htmlcsstopdf' }).version | Should Be '3.2.5'
        }
        It 'sin versión de n8n detectable el manifest registra unknown (no aborta)' {
            $r = Invoke-N8nBackup -Env $script:e -Override @{ N8nPackagePath = (Join-Path $script:e.Root 'no-hay') }
            $r.ExitCode | Should Be 0
            ($global:CapturedManifest | ConvertFrom-Json).n8nVersion | Should Match '^(unknown|\d+\.\d+\.\d+)'
        }
    }

    Context 'Bundle y cifrado' {
        It 'el bundle plaintext contiene exactamente database.sqlite, config, storage, nodes y manifest.json' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $top = @($global:BundleTree | Where-Object { $_ -notmatch '\\' } | Sort-Object)
            ($top -join ',') | Should Be 'config,database.sqlite,manifest.json,nodes,storage'
            $z = @(Get-SimCalls '7z')
            $z.Count | Should Be 1
            $srcs = @($z[0].Args | Select-Object -Skip 5 | Sort-Object)
            ($srcs -join ',') | Should Be 'config,database.sqlite,manifest.json,nodes,storage'
        }
        It '7z se invoca sin contraseña ni cifrado de cabeceras (-p / -mhe)' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $args7 = @((Get-SimCalls '7z')[0].Args)
            ($args7 | Where-Object { $_ -match '^-p|^-mhe' }) | Should BeNullOrEmpty
            $args7[0] | Should Be 'a'
            ($args7 -contains '-t7z') | Should Be $true
            # el bundle .7z es intermedio: nunca llega al destino final
            @(Get-ChildItem -LiteralPath $script:e.BackupRoot -Recurse -File -Filter '*.7z').Count | Should Be 0
        }
        It 'age solo cifra para el recipient público (-R archivo, -o salida), sin identidad ni clave privada' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $calls = @(Get-SimCalls 'age')
            $calls.Count | Should Be 1
            $a = @($calls[0].Args)
            (Get-ArgumentAfter $a '-R') | Should Be $script:e.RecipientsFilePath
            ($a -contains '-i') | Should Be $false
            ($a -contains '-d') | Should Be $false
            ($a -contains '-p') | Should Be $false
            ($a -join ' ') | Should Not Match 'AGE-SECRET-KEY'
        }
        It 'ni el entrypoint ni las funciones n8n admiten clave privada / identidad / contraseña / secreto / token como parámetro' {
            $ps = (Get-Command (Join-Path $backupRoot 'commands\Start-DaubertN8nBackup.ps1')).Parameters.Keys
            ($ps | Where-Object { $_ -match '(?i)Private|Identity|SecretKey|password|secret|token' }) | Should BeNullOrEmpty
            foreach ($m in 'BackupN8nConfig', 'BackupN8nSqlite', 'BackupN8nStaging', 'BackupN8nPipeline') {
                foreach ($cmd in (Get-Command -Module $m)) {
                    ($cmd.Parameters.Keys | Where-Object { $_ -match '(?i)Private|Identity|SecretKey|password|secret|token' }) | Should BeNullOrEmpty
                }
            }
        }
        It 'el hash del .age publicado coincide con su sidecar .sha256' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            $age = @(Get-N8nPublished -Env $script:e | Where-Object { $_.Name -like '*.age' })[0]
            Test-BackupFileHash -Path $age.FullName | Should Be $true
            $side = (Get-Content -LiteralPath "$($age.FullName).sha256" -Raw)
            $side | Should Be ('{0}  {1}' -f (Get-FileHash -LiteralPath $age.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $age.Name)
        }
    }

    Context 'Retención por tier' {
        function New-OldArtifact { param($Env, [string]$SubDir, [string]$Name)
            $d = Join-Path $Env.BackupRoot ('N8N\' + $SubDir); New-Item -ItemType Directory -Path $d -Force | Out-Null
            [System.IO.File]::WriteAllText((Join-Path $d $Name), 'x'); [System.IO.File]::WriteAllText((Join-Path $d "$Name.sha256"), 'h  x')
        }
        It 'Weekly: borra > 56 días (con su sidecar), conserva <= 56 y archivos ajenos' {
            New-OldArtifact $script:e 'WEEKLY' 'n8n_WEEKLY_20260730_120000.age'   # 60 días antes de 2026-09-28
            New-OldArtifact $script:e 'WEEKLY' 'n8n_WEEKLY_20260804_140007.age'   # 55 días
            [System.IO.File]::WriteAllText((Join-Path $script:e.BackupRoot 'N8N\WEEKLY\nota.txt'), 'x')
            New-OldArtifact $script:e 'ON_CHANGE' 'n8n_ON_CHANGE_20260101_000000.age'
            (Invoke-N8nBackup -Env $script:e -Tier Weekly).ExitCode | Should Be 0
            $w = Join-Path $script:e.BackupRoot 'N8N\WEEKLY'
            Test-Path (Join-Path $w 'n8n_WEEKLY_20260730_120000.age') | Should Be $false
            Test-Path (Join-Path $w 'n8n_WEEKLY_20260730_120000.age.sha256') | Should Be $false
            Test-Path (Join-Path $w 'n8n_WEEKLY_20260804_140007.age') | Should Be $true
            Test-Path (Join-Path $w 'nota.txt') | Should Be $true
            Test-Path (Join-Path $script:e.BackupRoot 'N8N\ON_CHANGE\n8n_ON_CHANGE_20260101_000000.age') | Should Be $true
        }
        It 'OnChange: borra > 90 días, conserva <= 90 y no toca Weekly' {
            New-OldArtifact $script:e 'ON_CHANGE' 'n8n_ON_CHANGE_20260625_000000.age'   # 95 días
            New-OldArtifact $script:e 'ON_CHANGE' 'n8n_ON_CHANGE_20260705_000000.age'   # 85 días
            New-OldArtifact $script:e 'WEEKLY' 'n8n_WEEKLY_20260101_000000.age'
            (Invoke-N8nBackup -Env $script:e -Tier OnChange).ExitCode | Should Be 0
            $o = Join-Path $script:e.BackupRoot 'N8N\ON_CHANGE'
            Test-Path (Join-Path $o 'n8n_ON_CHANGE_20260625_000000.age') | Should Be $false
            Test-Path (Join-Path $o 'n8n_ON_CHANGE_20260705_000000.age') | Should Be $true
            Test-Path (Join-Path $script:e.BackupRoot 'N8N\WEEKLY\n8n_WEEKLY_20260101_000000.age') | Should Be $true
        }
        It 'la retención no borra nada fuera de los artefactos n8n (p. ej. backups de PostgreSQL en BackupRoot)' {
            $pg = Join-Path $script:e.BackupRoot 'MONTHLY'; New-Item -ItemType Directory -Path $pg -Force | Out-Null
            [System.IO.File]::WriteAllText((Join-Path $pg 'daubert_global_MONTHLY_20200101_000000.age'), 'x')
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            Test-Path (Join-Path $pg 'daubert_global_MONTHLY_20200101_000000.age') | Should Be $true
        }
        It 'DryRun no publica ni aplica retención' {
            New-OldArtifact $script:e 'WEEKLY' 'n8n_WEEKLY_20260101_000000.age'
            $r = Invoke-N8nBackup -Env $script:e -DryRun
            $r.ExitCode | Should Be 0
            Test-Path (Join-Path $script:e.BackupRoot 'N8N\WEEKLY\n8n_WEEKLY_20260101_000000.age') | Should Be $true
            Test-Path (Join-Path $script:e.BackupRoot 'N8N\WEEKLY\n8n_WEEKLY_20260928_140007.age') | Should Be $false
            @(Get-N8nPublished -Env $script:e | Where-Object { $_.Name -like 'n8n_WEEKLY_2026092*' }).Count | Should Be 0
            @(Get-ChildItem -LiteralPath $script:e.N8nStaging -ErrorAction SilentlyContinue).Count | Should Be 0
        }
    }

    Context 'Fallos: limpieza de staging antes/durante/después del cifrado' {
        function Assert-Clean {
            param($Env)
            @(Get-ChildItem -LiteralPath $Env.N8nStaging -Force -ErrorAction SilentlyContinue).Count | Should Be 0
            @(Get-ChildItem -LiteralPath $Env.StagingRoot -Recurse -Force -File -ErrorAction SilentlyContinue).Count | Should Be 0
            @(Get-N8nPublished -Env $Env).Count | Should Be 0
            # el lock se libera: se puede volver a adquirir
            $h = Enter-BackupLock -LockFilePath $Env.LockFilePath -TimeoutSeconds 0
            Exit-BackupLock -LockHandle $h
        }
        It 'fallo ANTES de cifrar (snapshot) limpia staging y libera el lock' {
            $global:N8nSim.Snapshot.ExitCode = 2
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 4
            Assert-Clean $script:e
        }
        It 'fallo DURANTE el empaquetado (7z) limpia staging' {
            $global:ProcSim.SevenZip.ExitCode = 2
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 9
            Assert-Clean $script:e
        }
        It 'fallo DURANTE el cifrado (age exit != 0) limpia el snapshot, config, storage, nodes, manifest y bundle' {
            $global:ProcSim.Age.ExitCode = 1
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 10
            Assert-Clean $script:e
        }
        It 'fallo DURANTE el cifrado (age no produce archivo) limpia staging' {
            $global:ProcSim.Age.Mode = 'NO_FILE'
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 10
            Assert-Clean $script:e
        }
        It 'fallo DESPUÉS del cifrado (validación estructural) limpia staging' {
            $global:ProcSim.Age.Mode = 'EMPTY_FILE'
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 11
            Assert-Clean $script:e
        }
        It 'fallo DESPUÉS del cifrado (publicación: destino ya existe) limpia staging y no pisa el existente' {
            $d = Join-Path $script:e.BackupRoot 'N8N\WEEKLY'; New-Item -ItemType Directory -Path $d -Force | Out-Null
            [System.IO.File]::WriteAllText((Join-Path $d 'n8n_WEEKLY_20260928_140007.age'), 'EXISTENTE')
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 7
            (Get-Content -LiteralPath (Join-Path $d 'n8n_WEEKLY_20260928_140007.age') -Raw) | Should Be 'EXISTENTE'
            @(Get-ChildItem -LiteralPath $script:e.N8nStaging -Force -ErrorAction SilentlyContinue).Count | Should Be 0
        }
        It 'en éxito también queda el staging vacío (sin plaintext residual)' {
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            @(Get-ChildItem -LiteralPath $script:e.N8nStaging -Force -ErrorAction SilentlyContinue).Count | Should Be 0
        }
        It 'staging huérfano de n8n se elimina, pero nunca el staging de PostgreSQL ni otros nombres' {
            $orph = Join-Path $script:e.N8nStaging ([guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $orph -Force | Out-Null
            [System.IO.File]::WriteAllText((Join-Path $orph 'plaintext.bin'), 'residuo')
            $other = Join-Path $script:e.N8nStaging 'no-es-un-runid'; New-Item -ItemType Directory -Path $other -Force | Out-Null
            $pgStage = Join-Path $script:e.StagingRoot ([guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $pgStage -Force | Out-Null
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            Test-Path -LiteralPath $orph | Should Be $false
            Test-Path -LiteralPath $other | Should Be $true
            Test-Path -LiteralPath $pgStage | Should Be $true
        }
    }

    Context 'Fallo de storage inestable (mock del inventario)' {
        It 'fallo ANTES de cifrar (storage inestable) limpia staging y libera el lock' {
            $global:InvN = 0
            Mock Get-N8nDirectoryInventory { $global:InvN++; @([pscustomobject]@{ Path = 'x'; Length = [long]$global:InvN; LastWriteTicks = [long]1 }) } -ModuleName BackupN8nStaging
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 13
            @(Get-ChildItem -LiteralPath $script:e.N8nStaging -Force -ErrorAction SilentlyContinue).Count | Should Be 0
            @(Get-N8nPublished -Env $script:e).Count | Should Be 0
            $h = Enter-BackupLock -LockFilePath $script:e.LockFilePath -TimeoutSeconds 0
            Exit-BackupLock -LockHandle $h
        }
    }

    Context 'Fallo de hash (mock del hash)' {
        It 'fallo DESPUÉS del cifrado (hash) limpia staging' {
            Mock New-BackupFileHash { throw 'hash roto' } -ModuleName BackupN8nPipeline
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 6
            @(Get-ChildItem -LiteralPath $script:e.N8nStaging -Force -ErrorAction SilentlyContinue).Count | Should Be 0
            @(Get-N8nPublished -Env $script:e).Count | Should Be 0
        }
    }
    Context 'Lock y concurrencia' {
        It 'con el lock tomado por otra ejecución aborta (exit 2) sin tocar nada' {
            $h = Enter-BackupLock -LockFilePath $script:e.LockFilePath -TimeoutSeconds 0
            try {
                $r = Invoke-N8nBackup -Env $script:e
                $r.ExitCode | Should Be 2
                $global:N8nSim.Calls.Count | Should Be 0
                @(Get-N8nPublished -Env $script:e).Count | Should Be 0
            }
            finally { Exit-BackupLock -LockHandle $h }
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
        }
        It 'el lock de n8n es independiente del de PostgreSQL (archivo distinto)' {
            $script:e.LockFilePath | Should Match 'n8n-backup\.lock$'
            $pgLock = Join-Path $script:e.LockRoot 'backup.lock'
            $h = Enter-BackupLock -LockFilePath $pgLock -TimeoutSeconds 0
            try { (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0 }
            finally { Exit-BackupLock -LockHandle $h }
        }
    }

    Context 'No toca la instalación original de n8n' {
        It 'tras un backup exitoso database.sqlite/-wal/-shm/config/storage/nodes/logs quedan idénticos' {
            $before = Get-N8nTreeFingerprint -Path $script:e.N8nRoot
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 0
            (Get-N8nTreeFingerprint -Path $script:e.N8nRoot) | Should Be $before
        }
        It 'tras un backup FALLIDO tampoco se modifica nada' {
            $before = Get-N8nTreeFingerprint -Path $script:e.N8nRoot
            $global:ProcSim.Age.ExitCode = 1
            (Invoke-N8nBackup -Env $script:e).ExitCode | Should Be 10
            (Get-N8nTreeFingerprint -Path $script:e.N8nRoot) | Should Be $before
        }
        It 'el código n8n no contiene Remove-Item/Set-Content sobre n8nRoot (solo staging, destino y logs)' {
            foreach ($m in 'BackupN8nPipeline', 'BackupN8nStaging', 'BackupN8nSqlite') {
                foreach ($line in (Get-Content -LiteralPath (Join-Path $backupRoot "lib\$m.psm1"))) {
                    if ($line -match '^\s*#') { continue }
                    ($line -match '(Remove-Item|Set-Content|Out-File|Add-Content|Move-Item|Rename-Item)' -and $line -match 'N8nRoot|n8nRoot|configSource|sourceDb|storageSource|nodesSource') | Should Be $false
                }
            }
        }
    }
}

Describe 'n8n backup - Copy-N8nStorageStable (seams, sin archivos pesados)' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-n8n-stable-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:root -Force | Out-Null
        $script:dest = Join-Path $script:root 'copy'
        $global:InvN = 0
        $global:CopyN = 0
        $inv = { param($len) @([pscustomobject]@{ Path = 'a'; Length = [long]$len; LastWriteTicks = [long]1 }) }
        Mock Copy-N8nDirectoryTree { $global:CopyN++; New-Item -ItemType Directory -Path $Destination -Force | Out-Null } -ModuleName BackupN8nStaging
    }
    AfterEach { Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'estable al primer intento: 1 copia, 2 inventarios' {
        Mock Get-N8nDirectoryInventory { $global:InvN++; @([pscustomobject]@{ Path = 'a'; Length = [long]10; LastWriteTicks = [long]1 }) } -ModuleName BackupN8nStaging
        $r = Copy-N8nStorageStable -Source $script:root -Destination $script:dest
        $r.StableCopy | Should Be $true
        $r.Attempts | Should Be 1
        $r.FileCount | Should Be 1
        $r.SizeBytes | Should Be 10
        $global:CopyN | Should Be 1
        $global:InvN | Should Be 2
    }
    It 'cambia una vez: elimina la copia, reintenta y tiene éxito en el intento 2' {
        Mock Get-N8nDirectoryInventory { $global:InvN++; $l = if ($global:InvN -eq 2) { 77 } else { 10 }; @([pscustomobject]@{ Path = 'a'; Length = [long]$l; LastWriteTicks = [long]1 }) } -ModuleName BackupN8nStaging
        $r = Copy-N8nStorageStable -Source $script:root -Destination $script:dest
        $r.Attempts | Should Be 2
        $global:CopyN | Should Be 2
    }
    It 'cambia LastWriteTime (mismo tamaño): se detecta como inestable' {
        Mock Get-N8nDirectoryInventory { $global:InvN++; @([pscustomobject]@{ Path = 'a'; Length = [long]10; LastWriteTicks = [long]$global:InvN }) } -ModuleName BackupN8nStaging
        { Copy-N8nStorageStable -Source $script:root -Destination $script:dest } | Should Throw 'inestable'
    }
    It 'aparece un archivo nuevo durante la copia: inestable' {
        Mock Get-N8nDirectoryInventory {
            $global:InvN++
            $items = @([pscustomobject]@{ Path = 'a'; Length = [long]10; LastWriteTicks = [long]1 })
            if ($global:InvN % 2 -eq 0) { $items += [pscustomobject]@{ Path = 'b'; Length = [long]1; LastWriteTicks = [long]1 } }
            $items
        } -ModuleName BackupN8nStaging
        { Copy-N8nStorageStable -Source $script:root -Destination $script:dest } | Should Throw
    }
    It '3 intentos inestables: lanza, deja Destination sin copia y hace exactamente 3 copias' {
        Mock Get-N8nDirectoryInventory { $global:InvN++; @([pscustomobject]@{ Path = 'a'; Length = [long]$global:InvN; LastWriteTicks = [long]1 }) } -ModuleName BackupN8nStaging
        $err = $null
        try { Copy-N8nStorageStable -Source $script:root -Destination $script:dest } catch { $err = $_.Exception }
        $err | Should Not BeNullOrEmpty
        $err.Data['Kind'] | Should Be 'StorageUnstable'
        $global:CopyN | Should Be 3
        Test-Path -LiteralPath $script:dest | Should Be $false
    }
    It 'una copia que falla por un archivo que cambió también se reintenta' {
        $global:CopyN = 0
        Mock Copy-N8nDirectoryTree { $global:CopyN++; New-Item -ItemType Directory -Path $Destination -Force | Out-Null; if ($global:CopyN -eq 1) { throw 'archivo en uso' } } -ModuleName BackupN8nStaging
        Mock Get-N8nDirectoryInventory { @([pscustomobject]@{ Path = 'a'; Length = [long]10; LastWriteTicks = [long]1 }) } -ModuleName BackupN8nStaging
        (Copy-N8nStorageStable -Source $script:root -Destination $script:dest).Attempts | Should Be 2
    }
    It 'MaxAttempts se respeta' {
        Mock Get-N8nDirectoryInventory { $global:InvN++; @([pscustomobject]@{ Path = 'a'; Length = [long]$global:InvN; LastWriteTicks = [long]1 }) } -ModuleName BackupN8nStaging
        { Copy-N8nStorageStable -Source $script:root -Destination $script:dest -MaxAttempts 2 } | Should Throw
        $global:CopyN | Should Be 2
    }
}

Describe 'n8n backup - inventario y copia reales sobre archivos temporales minúsculos' {

    BeforeEach {
        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-n8n-tree-' + [guid]::NewGuid().ToString('N'))
        $script:src = Join-Path $script:root 'src'
        New-Item -ItemType Directory -Path (Join-Path $script:src 'x\y') -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $script:src 'a.txt'), 'aaa')
        [System.IO.File]::WriteAllText((Join-Path $script:src 'x\y\b.txt'), 'bb')
        [System.IO.File]::WriteAllText((Join-Path $script:src '.oculto'), 'h')
    }
    AfterEach { Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'el inventario usa rutas relativas ordenadas, tamaño y LastWriteTime' {
        $i = @(Get-N8nDirectoryInventory -Path $script:src)
        $i.Count | Should Be 3
        ($i | ForEach-Object Path) -join '|' | Should Be '.oculto|a.txt|x\y\b.txt'
        ($i | Where-Object Path -eq 'a.txt').Length | Should Be 3
    }
    It 'Compare-N8nInventory detecta cambio de tamaño, de fecha, de ruta y de cantidad' {
        $a = @(Get-N8nDirectoryInventory -Path $script:src)
        Compare-N8nInventory -Before $a -After @(Get-N8nDirectoryInventory -Path $script:src) | Should Be $true
        [System.IO.File]::WriteAllText((Join-Path $script:src 'a.txt'), 'aaaa')
        Compare-N8nInventory -Before $a -After @(Get-N8nDirectoryInventory -Path $script:src) | Should Be $false
        [System.IO.File]::WriteAllText((Join-Path $script:src 'a.txt'), 'aaa')
        (Get-Item (Join-Path $script:src 'a.txt')).LastWriteTimeUtc = (Get-Date).AddDays(-3).ToUniversalTime()
        Compare-N8nInventory -Before $a -After @(Get-N8nDirectoryInventory -Path $script:src) | Should Be $false
        Compare-N8nInventory -Before $a -After @($a | Select-Object -First 2) | Should Be $false
    }
    It 'Copy-N8nStorageStable real copia todo preservando estructura y no modifica el origen' {
        $before = Get-N8nTreeFingerprint -Path $script:src
        $dest = Join-Path $script:root 'dst'
        $r = Copy-N8nStorageStable -Source $script:src -Destination $dest
        $r.StableCopy | Should Be $true
        $r.FileCount | Should Be 3
        $r.SizeBytes | Should Be 6
        Test-Path (Join-Path $dest 'x\y\b.txt') | Should Be $true
        Test-Path (Join-Path $dest '.oculto') | Should Be $true
        (Get-N8nTreeFingerprint -Path $script:src) | Should Be $before
    }
}

Describe 'n8n backup - entrypoint canónico Start-DaubertN8nBackup.ps1' {

    BeforeEach {
        $script:e = New-N8nTestEnv; Set-N8nMocks
        $cfg = [ordered]@{ schemaVersion = 1; n8nRoot = $script:e.N8nRoot; nodePath = $script:e.NodePath; sevenZipPath = $script:e.SevenZipPath; agePath = $script:e.AgePath
            recipientsFilePath = $script:e.RecipientsFilePath; backupRoot = $script:e.BackupRoot; stagingRoot = $script:e.StagingRoot; logRoot = $script:e.LogRoot; lockRoot = $script:e.LockRoot; n8nPackagePath = $script:e.N8nPackagePath }
        $script:cfgPath = Join-Path $script:e.Root 'n8n-backup.json'
        [System.IO.File]::WriteAllText($script:cfgPath, ($cfg | ConvertTo-Json))
        $script:savedNoReload = $env:DAUBERT_BACKUP_NO_RELOAD
        $env:DAUBERT_BACKUP_NO_RELOAD = '1'   # solo pruebas: conserva los módulos con mocks
    }
    AfterEach {
        $env:DAUBERT_BACKUP_NO_RELOAD = $script:savedNoReload
        Remove-Item -LiteralPath $script:e.Root -Recurse -Force -ErrorAction SilentlyContinue; Clear-FakeTools
    }

    $entry = Join-Path (Split-Path -Parent $PSScriptRoot) 'commands\Start-DaubertN8nBackup.ps1'

    It 'existe una única copia del entrypoint en commands\ y usa el cargador central (sin Import-Module manual)' {
        Test-Path -LiteralPath $entry | Should Be $true
        @(Get-ChildItem -LiteralPath $backupRoot -Recurse -File -Filter 'Start-DaubertN8nBackup*.ps1').Count | Should Be 1
        $src = Get-Content -LiteralPath $entry -Raw
        $src | Should Match ([regex]::Escape("`$DaubertBackupModules = @('N8nPipeline')"))
        $src | Should Match 'Import-DaubertBackupModules\.ps1'
        $src | Should Not Match 'Import-Module'
        $src | Should Not Match ('(?i)Add' + '-Type')
    }
    It 'Tier solo admite Weekly y OnChange' {
        (Get-Command $entry).Parameters['Tier'].Attributes.ValidValues -join ',' | Should Be 'Weekly,OnChange'
    }
    It 'Weekly -ConfigPath -DryRun: exit 0, nada publicado' {
        $global:LASTEXITCODE = $null
        & $entry -Tier Weekly -ConfigPath $script:cfgPath -DryRun -Now ([datetime]'2026-09-28T14:00:07') 2>$null | Out-Null
        $LASTEXITCODE | Should Be 0
        @(Get-N8nPublished -Env $script:e).Count | Should Be 0
        @(Get-SimCalls 'age').Count | Should Be 1
    }
    It 'OnChange -ConfigPath: exit 0 y publica n8n_ON_CHANGE_' {
        $global:LASTEXITCODE = $null
        & $entry -Tier OnChange -ConfigPath $script:cfgPath -Now ([datetime]'2026-09-28T14:00:07') 2>$null | Out-Null
        $LASTEXITCODE | Should Be 0
        @(Get-N8nPublished -Env $script:e -SubDir 'ON_CHANGE').Count | Should Be 2
    }
    It 'sin un -ConfigPath válido el entrypoint (proceso nuevo, recarga real) termina con exit 3' {
        $bad = Join-Path ([System.IO.Path]::GetTempPath()) ('no-existe-' + [guid]::NewGuid().ToString('N') + '\n8n.json')
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $entry -Tier Weekly -ConfigPath $bad 2>&1 | Out-Null
        $LASTEXITCODE | Should Be 3
    }
}
