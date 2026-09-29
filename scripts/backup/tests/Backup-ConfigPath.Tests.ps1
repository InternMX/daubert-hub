#Requires -Version 5.1
<#
    Pruebas de configuración externa del pipeline (-ConfigPath / config.json):
    precedencia CLI > config.json > detección, aislamiento (sin -ConfigPath NO
    se lee %ProgramData%), logs/locks/retención desde config y rutas con
    espacios. Se ejercita Invoke-DaubertBackupRun / Resolve-BackupRunConfig,
    el mismo código que usa el entrypoint canónico.

    Sin ejecutables falsos: los seams de procesos externos se mockean
    (ver tests\helpers\TestDoubles.ps1). Nunca se toca PostgreSQL, age real
    ni Dropbox.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\Backup-ConfigPath.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'helpers\TestDoubles.ps1')
foreach ($m in 'BackupConfig', 'BackupLocalConfig', 'BackupPipeline') { Import-Module (Join-Path $moduleRoot "lib\$m.psm1") -Force }

$global:ValidRecipient = 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123'

function New-CfgWorld {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-cfgpath-' + [guid]::NewGuid().ToString('N'))
    $w = [ordered]@{
        Root = $root
        Backup = (Join-Path $root 'destino de backups')
        Other = (Join-Path $root 'otro destino')
        Staging = (Join-Path $root 'staging')
        Logs = (Join-Path $root 'logs config')
        Locks = (Join-Path $root 'locks config')
        Recipients = (Join-Path $root 'cfg\age-recipients.txt')
        PgPass = (Join-Path $root 'secrets\pgpass-backup.conf')
        ConfigPath = (Join-Path $root 'cfg\config.json')
        PgBin = (Join-Path $root 'herramientas\pg')
        SevenZip = (Join-Path $root 'herramientas\empaquetador')
        Age = (Join-Path $root 'herramientas\cifrador')
    }
    New-Item -ItemType Directory -Path $w.Backup, $w.Other, (Split-Path -Parent $w.Recipients), (Split-Path -Parent $w.PgPass) -Force | Out-Null
    Set-Content -LiteralPath $w.Recipients -Value $global:ValidRecipient -Encoding ASCII
    Set-Content -LiteralPath $w.PgPass -Value 'placeholder-no-secret' -Encoding UTF8
    Clear-FakeTools
    Add-FakePgToolset -BinDir $w.PgBin | Out-Null
    Add-FakeTool -Path $w.SevenZip, $w.Age
    $cfg = New-LocalBackupConfigObject -PostgresBin $w.PgBin -SevenZipPath $w.SevenZip -AgePath $w.Age `
        -RecipientsFilePath $w.Recipients -PgPassFile $w.PgPass -BackupRoot $w.Backup -StagingRoot $w.Staging -LogRoot $w.Logs -LockRoot $w.Locks
    Write-LocalBackupConfig -Path $w.ConfigPath -Config $cfg | Out-Null
    [pscustomobject]$w
}

function Invoke-Run {
    param($World, [string]$Tier = 'Frequent', [string]$ConfigPath = $World.ConfigPath, [hashtable]$Cli = @{}, [string]$Now, [switch]$NoConfig)
    $params = @{ Tier = $Tier; CliParameters = $Cli }
    if (-not $NoConfig) { $params.ConfigPath = $ConfigPath }
    if ($Now) { $params.Now = [datetime]$Now }
    $out = @(Invoke-DaubertBackupRun @params 2>$null)
    return [int]$out[-1]
}

function Update-ConfigFile {
    param($World, [scriptblock]$Change)
    $cfg = (Read-LocalBackupConfig -Path $World.ConfigPath).Config
    & $Change $cfg
    [System.IO.File]::WriteAllText($World.ConfigPath, ($cfg | ConvertTo-Json -Depth 8))
}

Describe 'Pipeline con config.json externo (-ConfigPath), procesos mockeados' {

    BeforeEach {
        $script:w = New-CfgWorld
        Reset-ProcessSim
        Mock Invoke-ExternalProcess { Invoke-FakePgProcess -FilePath $FilePath -ArgumentList $ArgumentList -EnvironmentVariables $EnvironmentVariables } -ModuleName BackupPgTools
        Mock Invoke-AgeProcess { Invoke-FakeAgeProcess -AgePath $AgePath -ArgumentList $ArgumentList } -ModuleName BackupEncryption
        Mock Invoke-SevenZipProcess { Invoke-FakeSevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory } -ModuleName BackupPackaging
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig
    }
    AfterEach {
        Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue
        Clear-FakeTools
    }

    It 'el entrypoint canónico (si está presente) expone -ConfigPath, -LogRoot y -LockRoot' -Skip:(-not (Test-Path -LiteralPath (Join-Path $moduleRoot 'commands\Start-DaubertPostgresBackup.ps1'))) {
        $keys = (Get-Command (Join-Path $moduleRoot 'commands\Start-DaubertPostgresBackup.ps1')).Parameters.Keys
        foreach ($k in 'ConfigPath', 'LogRoot', 'LockRoot', 'Tier', 'DryRun') { ($keys -contains $k) | Should Be $true }
    }

    It 'Invoke-DaubertBackupRun admite ConfigPath y CliParameters' {
        $keys = (Get-Command Invoke-DaubertBackupRun).Parameters.Keys
        ($keys -contains 'ConfigPath') | Should Be $true
        ($keys -contains 'CliParameters') | Should Be $true
    }

    It 'sólo con -ConfigPath y -Tier: exit 0, publica bajo el backupRoot de config (ruta con espacios)' {
        (Invoke-Run -World $script:w -Now '2026-09-28T14:00:07') | Should Be 0
        (Get-ChildItem (Join-Path $script:w.Backup 'FREQUENT') -File).Name | Sort-Object | Should Be @('daubert_global_FREQUENT_20260928_140007.age', 'daubert_global_FREQUENT_20260928_140007.age.sha256')
    }

    It 'los binarios usados son los del config.json (postgresBin, agePath)' {
        Invoke-Run -World $script:w | Out-Null
        (@(Get-SimCalls 'pg_dump')[0].File) | Should Be (Join-Path $script:w.PgBin 'pg_dump.exe')
        (@(Get-SimCalls 'age')[0].File) | Should Be $script:w.Age
    }

    It 'los logs van a logRoot de config (no a <backupRoot>\LOGS) y el lock a lockRoot' {
        Invoke-Run -World $script:w | Out-Null
        (Get-ChildItem (Join-Path $script:w.Logs 'FREQUENT') -Filter '*.log.jsonl' | Measure-Object).Count | Should Be 1
        Test-Path -LiteralPath (Join-Path $script:w.Backup 'LOGS') | Should Be $false
        Test-Path -LiteralPath $script:w.Locks -PathType Container | Should Be $true
        Test-Path -LiteralPath (Join-Path $script:w.Locks 'backup.lock') | Should Be $false
    }

    It 'el log no contiene la ruta del pgpass ni nada parecido a una clave privada' {
        Invoke-Run -World $script:w | Out-Null
        $log = Get-ChildItem (Join-Path $script:w.Logs 'FREQUENT') -Filter '*.log.jsonl' | Select-Object -First 1 | Get-Content -Raw
        $log | Should Not Match 'pgpass-backup'
        $log | Should Not Match 'placeholder-no-secret'
        $log | Should Not Match 'AGE-SECRET-KEY'
    }

    It 'precedencia: BackupRoot del CLI prevalece sobre config.json' {
        (Invoke-Run -World $script:w -Cli @{ BackupRoot = $script:w.Other }) | Should Be 0
        (Get-ChildItem (Join-Path $script:w.Other 'FREQUENT') -File -Filter '*.age' | Measure-Object).Count | Should Be 1
        Test-Path -LiteralPath (Join-Path $script:w.Backup 'FREQUENT') | Should Be $false
    }

    It 'precedencia: PgDatabase del CLI prevalece sobre config.json (cambia el nombre del artefacto y el -d de pg_dump)' {
        Invoke-Run -World $script:w -Cli @{ PgDatabase = 'otra_bd' } -Now '2026-09-28T14:00:07' | Out-Null
        Test-Path -LiteralPath (Join-Path $script:w.Backup 'FREQUENT\otra_bd_FREQUENT_20260928_140007.age') | Should Be $true
        (Get-ArgumentAfter @(Get-SimCalls 'pg_dump')[0].Args '-d') | Should Be 'otra_bd'
    }

    It 'precedencia: LogRoot del CLI prevalece sobre config.json' {
        $alt = Join-Path $script:w.Root 'logs alternos'
        Invoke-Run -World $script:w -Cli @{ LogRoot = $alt } | Out-Null
        (Get-ChildItem (Join-Path $alt 'FREQUENT') -Filter '*.log.jsonl' | Measure-Object).Count | Should Be 1
        Test-Path -LiteralPath (Join-Path $script:w.Logs 'FREQUENT') | Should Be $false
    }

    It 'precedencia: sin parámetro CLI se usa lo de config.json (host, puerto y usuario llegan a pg_dump)' {
        Update-ConfigFile $script:w { param($c) $c.host = 'db.interna'; $c.port = 6543; $c.backupUser = 'usuario_backup' }
        Invoke-Run -World $script:w | Out-Null
        $a = @(Get-SimCalls 'pg_dump')[0].Args
        (Get-ArgumentAfter $a '-h') | Should Be 'db.interna'
        (Get-ArgumentAfter $a '-p') | Should Be '6543'
        (Get-ArgumentAfter $a '-U') | Should Be 'usuario_backup'
    }

    It 'precedencia: el CLI (PgPort) gana a config.json (port)' {
        Update-ConfigFile $script:w { param($c) $c.port = 6543 }
        Invoke-Run -World $script:w -Cli @{ PgPort = 7000 } | Out-Null
        (Get-ArgumentAfter @(Get-SimCalls 'pg_dump')[0].Args '-p') | Should Be '7000'
    }

    It 'la retención se toma de config.json (Frequent: 1 día borra un backup de 3 días; el default de 7 lo conservaría)' {
        $tierDir = Join-Path $script:w.Backup 'FREQUENT'
        New-Item -ItemType Directory -Path $tierDir -Force | Out-Null
        $old = Join-Path $tierDir 'daubert_global_FREQUENT_20260925_120000.age'
        Set-Content -LiteralPath $old -Value 'viejo' -Encoding ASCII
        Set-Content -LiteralPath "$old.sha256" -Value 'abc  x' -Encoding ASCII

        Invoke-Run -World $script:w -Now '2026-09-28T14:00:07' | Out-Null
        Test-Path -LiteralPath $old | Should Be $true

        Update-ConfigFile $script:w { param($c) $c.retention.Frequent.value = 1 }
        Invoke-Run -World $script:w -Now '2026-09-28T15:00:07' | Out-Null
        Test-Path -LiteralPath $old | Should Be $false
        Test-Path -LiteralPath "$old.sha256" | Should Be $false
    }

    It 'config.json inválido -> exit 3, no se publica nada y no se ejecuta ningún proceso' {
        Set-Content -LiteralPath $script:w.ConfigPath -Value '{"database":"x"}' -Encoding UTF8
        (Invoke-Run -World $script:w) | Should Be 3
        Test-Path -LiteralPath (Join-Path $script:w.Backup 'FREQUENT') | Should Be $false
        $global:ProcSim.Calls.Count | Should Be 0
    }

    It 'config.json con un secreto -> exit 3 y el valor no aparece en ninguna salida' {
        Update-ConfigFile $script:w { param($c) $c | Add-Member -NotePropertyName password -NotePropertyValue 'valor-secreto-abc' }
        $out = (Invoke-DaubertBackupRun -Tier Frequent -ConfigPath $script:w.ConfigPath -CliParameters @{} 2>&1 | Out-String)
        $out | Should Not Match 'valor-secreto-abc'
        (Invoke-Run -World $script:w) | Should Be 3
        $global:ProcSim.Calls.Count | Should Be 0
    }

    It '-ConfigPath inexistente -> exit 3' {
        (Invoke-Run -World $script:w -ConfigPath (Join-Path $script:w.Root 'nada.json')) | Should Be 3
    }

    It 'AISLAMIENTO: sin -ConfigPath NO se lee %ProgramData% aunque exista un config.json allí, y no se escribe nada allí' {
        $fakePd = Join-Path $script:w.Root 'FakeProgramData'
        $fakeCfgDir = Join-Path $fakePd 'DaubertHub\Backup'
        New-Item -ItemType Directory -Path $fakeCfgDir -Force | Out-Null
        Copy-Item -LiteralPath $script:w.ConfigPath -Destination (Join-Path $fakeCfgDir 'config.json')
        $before = @(Get-ChildItem -LiteralPath $fakePd -Recurse -Force | ForEach-Object { $_.FullName })

        $saved = $env:ProgramData
        try {
            $env:ProgramData = $fakePd
            $code = Invoke-Run -World $script:w -NoConfig -Cli @{ PgBinPath = $script:w.PgBin; PgPassFile = $script:w.PgPass; SevenZipPath = $script:w.SevenZip; AgePath = $script:w.Age; RecipientsFilePath = $script:w.Recipients; StagingRoot = $script:w.Staging }
        }
        finally { $env:ProgramData = $saved }

        $code | Should Be 3   # falta BackupRoot: nada se completó desde el config de ProgramData
        @(Get-ChildItem -LiteralPath $fakePd -Recurse -Force | ForEach-Object { $_.FullName }) | Should Be $before
        Test-Path -LiteralPath (Join-Path $script:w.Backup 'FREQUENT') | Should Be $false
        $global:ProcSim.Calls.Count | Should Be 0
    }

    It 'Resolve-BackupRunConfig: sin -ConfigPath y sin CLI la configuración queda sin resolver (BackupRoot vacío)' {
        $r = Resolve-BackupRunConfig -Tier Frequent
        $r.Errors.Count | Should Be 0
        $r.Config.BackupRoot | Should BeNullOrEmpty
    }

    It 'Resolve-BackupRunConfig: config.json rellena los valores y el CLI los sobre-escribe campo a campo' {
        $r = Resolve-BackupRunConfig -Tier Daily -ConfigPath $script:w.ConfigPath -CliParameters @{ PgHost = 'otro-host' }
        $r.Config.PgHost | Should Be 'otro-host'
        $r.Config.PgUser | Should Be 'daubert_backup'
        $r.Config.BackupRoot | Should Be $script:w.Backup
        $r.Config.RetentionValue | Should Be 30
        $r.Config.LogDir | Should Be (Join-Path $script:w.Logs 'DAILY')
    }

    It 'detección portable como último recurso solo cuando la ruta no viene ni del CLI ni de config' {
        Mock Find-AgePath { 'age-detectado' } -ModuleName BackupPipeline
        Mock Find-SevenZipPath { '7z-detectado' } -ModuleName BackupPipeline
        Mock Find-PostgresBinPath { 'pg-detectado' } -ModuleName BackupPipeline
        $r = Resolve-BackupRunConfig -Tier Frequent -CliParameters @{ AgePath = 'age-explicito' }
        $r.Config.AgePath | Should Be 'age-explicito'
        $r.Config.SevenZipPath | Should Be '7z-detectado'
        $r.Config.PgBinPath | Should Be 'pg-detectado'
        Assert-MockCalled Find-AgePath -ModuleName BackupPipeline -Times 0 -Exactly -Scope It
    }
}
