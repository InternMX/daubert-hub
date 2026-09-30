# Dobles de prueba del backup de n8n (se cargan con dot-sourcing desde los tests).
# Extienden TestDoubles.ps1 SIN modificarlo. No se crea, compila ni copia ningún
# ejecutable: el seam Invoke-NodeProcess (BackupN8nSqlite) se mockea con
# Invoke-FakeNodeProcess; 7z y age usan los dobles existentes.

. (Join-Path $PSScriptRoot 'TestDoubles.ps1')

$global:N8nMarker = 'N8N_CONFIG_SECRET_MARKER_8f3a91c2'

function global:Reset-N8nSim {
    Reset-ProcessSim
    $global:N8nSim = @{
        Snapshot    = @{ ExitCode = 0; Mode = 'SUCCESS'; StdOut = '{"ok":true,"quickCheck":"ok","tableCount":42,"sizeBytes":20}' }
        NodeVersion = 'v24.19.0'
        Calls       = (New-Object 'System.Collections.Generic.List[object]')
    }
    $global:BundleTree = $null
    $global:CapturedManifest = $null
    $global:CapturedConfig = $null
}

function global:Invoke-FakeNodeProcess {
    # Doble de Invoke-NodeProcess: --version o el helper de snapshot (escribe el snapshot falso en --dest).
    param([string]$NodePath, [string[]]$ArgumentList = @())
    if ($ArgumentList -contains '--version') {
        return [pscustomobject]@{ ExitCode = 0; StdOut = "$($global:N8nSim.NodeVersion)`n"; StdErr = '' }
    }
    $global:N8nSim.Calls.Add([pscustomobject]@{ Node = $NodePath; Args = @($ArgumentList) })
    $s = $global:N8nSim.Snapshot
    Write-FakeOutputFile -Path (Get-ArgumentAfter $ArgumentList '--dest') -Mode $s.Mode -Content 'FAKE SQLITE SNAPSHOT'
    return [pscustomobject]@{ ExitCode = $s.ExitCode; StdOut = $s.StdOut; StdErr = '' }
}

function global:Invoke-FakeSevenZipCapture {
    # Como Invoke-FakeSevenZipProcess, pero antes fotografía el plaintext que entraría al bundle.
    param([string]$SevenZipPath, [string[]]$ArgumentList = @(), [string]$WorkingDirectory)
    $base = [System.IO.Path]::GetFullPath($WorkingDirectory).TrimEnd('\') + '\'
    $global:BundleTree = @(Get-ChildItem -LiteralPath $WorkingDirectory -Recurse -Force | ForEach-Object { $_.FullName.Substring($base.Length) })
    $mp = Join-Path $WorkingDirectory 'manifest.json'
    if (Test-Path -LiteralPath $mp) { $global:CapturedManifest = [System.IO.File]::ReadAllText($mp) }
    $cp = Join-Path $WorkingDirectory 'config'
    if (Test-Path -LiteralPath $cp) { $global:CapturedConfig = [System.IO.File]::ReadAllText($cp) }
    Invoke-FakeSevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory
}

function global:Get-N8nTreeFingerprint {
    # Huella (ruta relativa, tamaño, LastWriteTime, hash) de un árbol: prueba de que no se tocó.
    param([string]$Path)
    $base = [System.IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    $items = Get-ChildItem -LiteralPath $Path -Recurse -Force | Sort-Object FullName | ForEach-Object {
        $h = if ($_.PSIsContainer) { 'DIR' } else { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
        # Los LastWriteTime de DIRECTORIOS se omiten: NTFS los actualiza de forma perezosa y no indican cambios en el contenido.
        if ($_.PSIsContainer) { '{0}|DIR' -f $_.FullName.Substring($base.Length) } else { '{0}|{1}|{2}|{3}' -f $_.FullName.Substring($base.Length), $_.Length, $_.LastWriteTimeUtc.Ticks, $h }
    }
    return ($items -join "`n")
}

function global:New-N8nTestEnv {
    param([switch]$NoStorage, [switch]$NoNodes, [switch]$NoConfig)

    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-n8n-e2e-' + [guid]::NewGuid().ToString('N'))
    $n8n = Join-Path $root 'n8n-data'
    $backup = Join-Path $root 'backup-root'
    $staging = Join-Path $root 'staging-root'
    New-Item -ItemType Directory -Path $n8n, $backup, $staging, (Join-Path $n8n 'logs') -Force | Out-Null

    # Instalación n8n FALSA (archivos de texto minúsculos).
    [System.IO.File]::WriteAllText((Join-Path $n8n 'database.sqlite'), 'FAKE ORIGINAL DATABASE')
    [System.IO.File]::WriteAllText((Join-Path $n8n 'database.sqlite-wal'), 'FAKE WAL')
    [System.IO.File]::WriteAllText((Join-Path $n8n 'database.sqlite-shm'), 'FAKE SHM')
    [System.IO.File]::WriteAllText((Join-Path $n8n 'logs\n8n.log'), 'log line')
    [System.IO.File]::WriteAllText((Join-Path $n8n 'n8nEventLog.log'), 'event')
    [System.IO.File]::WriteAllText((Join-Path $n8n 'n8nEventLog-1.log'), 'event1')
    if (-not $NoConfig) { [System.IO.File]::WriteAllText((Join-Path $n8n 'config'), ('{"encryptionKey":"' + $global:N8nMarker + '"}')) }
    if (-not $NoStorage) {
        New-Item -ItemType Directory -Path (Join-Path $n8n 'storage\workflows\w1') -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $n8n 'storage\a.bin'), 'aaaa')
        [System.IO.File]::WriteAllText((Join-Path $n8n 'storage\workflows\w1\b.bin'), 'bbbbbb')
        [System.IO.File]::WriteAllText((Join-Path $n8n 'storage\workflows\c.bin'), 'c')
    }
    if (-not $NoNodes) {
        $nodes = Join-Path $n8n 'nodes'
        New-Item -ItemType Directory -Path (Join-Path $nodes 'node_modules\n8n-nodes-htmlcsstopdf'), (Join-Path $nodes 'node_modules\n8n-nodes-pdfbolt') -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $nodes 'package.json'), '{"name":"installed-nodes","private":true,"dependencies":{"n8n-nodes-htmlcsstopdf":"3.2.5","n8n-nodes-pdfbolt":"^0.1.5"}}')
        [System.IO.File]::WriteAllText((Join-Path $nodes 'node_modules\n8n-nodes-htmlcsstopdf\package.json'), '{"name":"n8n-nodes-htmlcsstopdf","version":"3.2.5"}')
        [System.IO.File]::WriteAllText((Join-Path $nodes 'node_modules\n8n-nodes-pdfbolt\package.json'), '{"name":"n8n-nodes-pdfbolt","version":"0.1.5"}')
    }

    $pkg = Join-Path $root 'n8n-package'
    New-Item -ItemType Directory -Path $pkg -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $pkg 'package.json'), '{"name":"n8n","version":"2.27.4"}')

    $recipients = Join-Path $root 'recipients.txt'
    [System.IO.File]::WriteAllText($recipients, 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123')

    # Herramientas: SOLO cadenas registradas en memoria (Test-BackupToolPath mockeado).
    $node = Join-Path $root 'tools\runtime-node'
    $sevenZip = Join-Path $root 'tools\packer-7z'
    $age = Join-Path $root 'tools\encryptor-age'
    Clear-FakeTools
    Add-FakeTool -Path $node, $sevenZip, $age

    [pscustomobject]@{
        Root = $root; N8nRoot = $n8n; BackupRoot = $backup; StagingRoot = $staging; LogRoot = (Join-Path $root 'logs'); LockRoot = (Join-Path $root 'locks')
        RecipientsFilePath = $recipients; NodePath = $node; SevenZipPath = $sevenZip; AgePath = $age; N8nPackagePath = $pkg
        LockFilePath = (Join-Path $root 'locks\n8n-backup.lock')
        N8nStaging = (Join-Path $staging 'n8n')
    }
}

function global:Get-N8nCli {
    param($Env)
    @{
        N8nRoot = $Env.N8nRoot; NodePath = $Env.NodePath; SevenZipPath = $Env.SevenZipPath; AgePath = $Env.AgePath; RecipientsFilePath = $Env.RecipientsFilePath
        BackupRoot = $Env.BackupRoot; StagingRoot = $Env.StagingRoot; LogRoot = $Env.LogRoot; LockRoot = $Env.LockRoot; N8nPackagePath = $Env.N8nPackagePath
    }
}

function global:Invoke-N8nBackup {
    # Devuelve { ExitCode; Text } (Text = TODOS los streams de salida, para comprobar que no se filtra nada).
    param($Env, [string]$Tier = 'Weekly', [switch]$DryRun, [string]$Now = '2026-09-28T14:00:07', [hashtable]$Override = @{}, [int]$LockTimeoutSeconds = 0)
    $cli = Get-N8nCli -Env $Env
    foreach ($k in $Override.Keys) { $cli[$k] = $Override[$k] }
    $params = @{ Tier = $Tier; CliParameters = $cli; LockTimeoutSeconds = $LockTimeoutSeconds; Now = [datetime]$Now }
    if ($DryRun) { $params.DryRun = $true }
    $out = @(Invoke-DaubertN8nBackupRun @params *>&1)
    $ints = @($out | Where-Object { $_ -is [int] })
    $text = ($out | Where-Object { $_ -isnot [int] } | Out-String)
    [pscustomobject]@{ ExitCode = [int]$ints[-1]; Text = $text }
}

function global:Get-N8nPublished {
    param($Env, [string]$SubDir = 'WEEKLY')
    $dir = Join-Path $Env.BackupRoot ('N8N\' + $SubDir)
    @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue)
}

function global:Get-N8nLogText {
    param($Env)
    $dir = Join-Path $Env.LogRoot 'N8N'
    $files = @(Get-ChildItem -LiteralPath $dir -Recurse -Filter '*.log.jsonl' -ErrorAction SilentlyContinue)
    ($files | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
}
