#Requires -Version 5.1
<#
    Pruebas del preflight (BackupPreflight.psm1 + Test-DaubertBackupEnvironment.ps1).
    Los procesos (pg_isready, psql, --version), Task Scheduler y el espacio
    libre se inyectan/simulan. No se toca PostgreSQL, age, Task Scheduler,
    Dropbox ni secretos reales; todo ocurre en directorios temporales.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupPreflight.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupConfig.psm1') -Force
Import-Module (Join-Path $moduleRoot 'lib\BackupLocalConfig.psm1') -Force
Import-Module (Join-Path $moduleRoot 'lib\BackupPreflight.psm1') -Force
. (Join-Path $PSScriptRoot 'helpers\TestDoubles.ps1')

$global:ValidRecipient = 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123'
$global:FakePrivateKey = 'AGE-SECRET-' + 'KEY-1' + ('Q' * 58)
$global:Now = [datetime]'2026-09-29T12:00:00'
$global:PwCanary = 'Canario-Pw-9f3a'

function New-PreflightWorld {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-preflight-' + [guid]::NewGuid().ToString('N'))
    $pgBin = Join-Path $root 'tools\PostgreSQL\18\bin'
    New-Item -ItemType Directory -Path $pgBin -Force | Out-Null
    $sz = Join-Path $root 'tools\packer-7z'; $age = Join-Path $root 'tools\encryptor-age'
    # Las herramientas solo existen en memoria (Test-BackupToolPath mockeado); no hay archivos con nombres de herramientas reales.
    Clear-FakeTools
    Add-FakePgToolset -BinDir $pgBin | Out-Null
    Add-FakeTool -Path $sz, $age
    $cfgDir = Join-Path $root 'ProgramData\Backup'
    $secrets = Join-Path $root 'Local\secrets'
    $ext = Join-Path $root 'externo con espacios'
    New-Item -ItemType Directory -Path $cfgDir, $secrets, $ext, (Join-Path $root 'logs'), (Join-Path $root 'locks'), (Join-Path $root 'staging') -Force | Out-Null

    $recipients = Join-Path $cfgDir 'age-recipients.txt'
    Set-Content -LiteralPath $recipients -Value $global:ValidRecipient -Encoding ASCII
    $pgpass = Join-Path $secrets 'pgpass-backup.conf'
    New-PgPassFile -Path $pgpass -HostName localhost -Port 5432 -Database daubert_global -User daubert_backup -Password (ConvertTo-SecureString $global:PwCanary -AsPlainText -Force) | Out-Null

    $cfg = New-LocalBackupConfigObject -PostgresBin $pgBin -SevenZipPath $sz -AgePath $age -RecipientsFilePath $recipients -PgPassFile $pgpass `
        -BackupRoot $ext -StagingRoot (Join-Path $root 'staging') -LogRoot (Join-Path $root 'logs') -LockRoot (Join-Path $root 'locks')
    $cfgPath = Join-Path $cfgDir 'config.json'
    Write-LocalBackupConfig -Path $cfgPath -Config $cfg | Out-Null

    [pscustomobject]@{ Root = $root; ConfigPath = $cfgPath; CfgDir = $cfgDir; PgBin = $pgBin; SevenZip = $sz; Age = $age; Recipients = $recipients; PgPass = $pgpass; Ext = $ext; Staging = (Join-Path $root 'staging') }
}

function Set-BackupFile {
    param($World, [string]$Tier, [datetime]$Timestamp, [switch]$NoSidecar, [switch]$BadSidecar)
    $dir = Join-Path $World.Ext $Tier.ToUpperInvariant()
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $name = 'daubert_global_{0}_{1}.age' -f $Tier.ToUpperInvariant(), $Timestamp.ToString('yyyyMMdd_HHmmss')
    $f = Join-Path $dir $name
    Set-Content -LiteralPath $f -Value ('age-encryption.org/v1 ' + ('X' * 200)) -Encoding ASCII
    if (-not $NoSidecar) {
        $h = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($BadSidecar) { $h = ('0' * 64) }
        Set-Content -LiteralPath "$f.sha256" -Value "$h  $name" -Encoding ASCII
    }
    $f
}

function Reset-Sim {
    $global:Sim = @{ IsReadyExit = 0; PsqlExit = 0; PsqlOut = "1`n"; PsqlErr = ''; Calls = (New-Object System.Collections.Generic.List[object]) }
    $global:Tasks = @(
        'Daubert - PostgreSQL Frequent', 'Daubert - PostgreSQL Daily', 'Daubert - PostgreSQL Monthly' | ForEach-Object {
            [pscustomobject]@{ TaskName = $_; Exists = $true; State = 'Ready'; LastTaskResult = 0; LastRunTime = $global:Now; NextRunTime = $global:Now }
        })
    $global:FreeBytes = 100GB
}

function Invoke-Pf {
    param($World, [hashtable]$Extra = @{})
    $runner = {
        param($FilePath, $ArgumentList, $Environment)
        $global:Sim.Calls.Add([pscustomobject]@{ File = (Split-Path -Leaf $FilePath); Args = @($ArgumentList); Env = $Environment })
        switch -Wildcard (Split-Path -Leaf $FilePath) {
            'pg_isready.exe' { return [pscustomobject]@{ ExitCode = $global:Sim.IsReadyExit; StdOut = 'no response'; StdErr = '' } }
            'psql.exe' { return [pscustomobject]@{ ExitCode = $global:Sim.PsqlExit; StdOut = $global:Sim.PsqlOut; StdErr = $global:Sim.PsqlErr } }
            default { return [pscustomobject]@{ ExitCode = 0; StdOut = "$FilePath 18.0`n"; StdErr = '' } }
        }
    }
    $params = @{
        ConfigPath = $World.ConfigPath; Now = $global:Now; ProcessRunner = $runner
        TaskQuery = { param($Names) $global:Tasks }
        FreeSpaceProvider = { param($Path) $global:FreeBytes }
    }
    foreach ($k in $Extra.Keys) { $params[$k] = $Extra[$k] }
    Invoke-BackupPreflight @params
}

function Get-Check { param($Result, [string]$Name) $Result.Checks | Where-Object { $_.Name -eq $Name } | Select-Object -First 1 }

Describe 'Preflight - resultado global y códigos de salida' {

    BeforeEach { $script:w = New-PreflightWorld; Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupPreflight; Reset-Sim; Set-BackupFile -World $script:w -Tier Frequent -Timestamp $global:Now.AddHours(-1) | Out-Null }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'PASS: entorno completo y sano -> OVERALL PASS, exit code 0' {
        $r = Invoke-Pf -World $script:w
        $r.Overall | Should Be 'PASS'
        $r.ExitCode | Should Be 0
        foreach ($n in 'PostgreSQL tools', 'Database reachable', 'Backup user auth', 'pg_dump', 'pg_restore', '7-Zip', 'age', 'Public recipient', 'Backup root', 'Staging', 'Scheduled Tasks', 'Last valid backup') {
            (Get-Check $r $n).Status | Should Be 'PASS'
        }
    }

    It 'WARN: sin tareas programadas -> OVERALL WARN, exit code 1' {
        $global:Tasks = @($global:Tasks | ForEach-Object { [pscustomobject]@{ TaskName = $_.TaskName; Exists = $false; State = $null; LastTaskResult = $null; LastRunTime = $null; NextRunTime = $null } })
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Scheduled Tasks').Status | Should Be 'WARN'
        $r.Overall | Should Be 'WARN'
        $r.ExitCode | Should Be 1
    }

    It 'FAIL: un fallo domina a los WARN -> OVERALL FAIL, exit code 2' {
        Remove-FakeTool -Path $script:w.Age
        $global:Tasks = @()
        $r = Invoke-Pf -World $script:w
        $r.Overall | Should Be 'FAIL'
        $r.ExitCode | Should Be 2
    }

    It 'Format-PreflightReport lista cada comprobación y la línea OVERALL' {
        $lines = Format-PreflightReport -Result (Invoke-Pf -World $script:w)
        ($lines -join "`n") | Should Match 'PostgreSQL tools\s+PASS'
        ($lines -join "`n") | Should Match 'OVERALL: PASS'
    }

    It 'no imprime la ruta del pgpass ni la contraseña en ningún sitio del informe' {
        $r = Invoke-Pf -World $script:w
        $text = (Format-PreflightReport -Result $r) -join "`n"
        $text | Should Not Match ([regex]::Escape($script:w.PgPass))
        $text | Should Not Match 'pgpass-backup\.conf'
        $text | Should Not Match $global:PwCanary
    }

    It 'la autenticación usa PGPASSFILE en el entorno del proceso; ningún argumento contiene la contraseña ni la ruta del pgpass' {
        Invoke-Pf -World $script:w | Out-Null
        $psql = @($global:Sim.Calls | Where-Object { $_.File -eq 'psql.exe' })
        $psql.Count | Should Be 1
        $psql[0].Env['PGPASSFILE'] | Should Be $script:w.PgPass
        ($psql[0].Args -join ' ') | Should Not Match $global:PwCanary
        ($psql[0].Args -join ' ') | Should Not Match ([regex]::Escape($script:w.PgPass))
        ($psql[0].Args -contains '-w') | Should Be $true
    }

    It 'es NO destructivo: solo ejecuta --version, pg_isready y psql SELECT 1; nunca pg_dump/pg_dumpall/pg_restore reales' {
        Invoke-Pf -World $script:w | Out-Null
        foreach ($c in $global:Sim.Calls) {
            switch ($c.File) {
                'psql.exe' { ($c.Args -join ' ') | Should Match 'SELECT 1' }
                'pg_isready.exe' { }
                default { ($c.Args -join ' ') | Should Be '--version' }
            }
        }
        ($global:Sim.Calls | Where-Object { $_.Args -contains '-Fc' -or $_.Args -contains '--globals-only' -or $_.Args -contains '-f' }) | Should BeNullOrEmpty
    }

    It 'no deja archivos nuevos en el sistema (los sondeos de escritura se borran)' {
        $before = @(Get-ChildItem -LiteralPath $script:w.Root -Recurse -Force | ForEach-Object { $_.FullName } | Sort-Object)
        Invoke-Pf -World $script:w | Out-Null
        $after = @(Get-ChildItem -LiteralPath $script:w.Root -Recurse -Force | ForEach-Object { $_.FullName } | Sort-Object)
        ($after -join "`n") | Should Be ($before -join "`n")
    }

    It '-SkipDatabase omite la conectividad y la autenticación (WARN) sin ejecutar psql/pg_isready' {
        $r = Invoke-Pf -World $script:w -Extra @{ SkipDatabase = $true }
        (Get-Check $r 'Database reachable').Status | Should Be 'WARN'
        (Get-Check $r 'Backup user auth').Status | Should Be 'WARN'
        ($global:Sim.Calls | Where-Object { $_.File -in 'psql.exe', 'pg_isready.exe' }) | Should BeNullOrEmpty
    }
}

Describe 'Preflight - configuración' {

    BeforeEach { $script:w = New-PreflightWorld; Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupPreflight; Reset-Sim }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'config.json inexistente -> FAIL inmediato' {
        Remove-Item -LiteralPath $script:w.ConfigPath -Force
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Config file').Status | Should Be 'FAIL'
        $r.ExitCode | Should Be 2
    }

    It 'JSON no parseable -> FAIL' {
        Set-Content -LiteralPath $script:w.ConfigPath -Value '{ roto' -Encoding UTF8
        (Get-Check (Invoke-Pf -World $script:w) 'Config JSON').Status | Should Be 'FAIL'
    }

    It 'campos obligatorios ausentes -> FAIL' {
        Set-Content -LiteralPath $script:w.ConfigPath -Value '{"database":"x"}' -Encoding UTF8
        (Get-Check (Invoke-Pf -World $script:w) 'Config fields').Status | Should Be 'FAIL'
    }

    It 'config con un secreto -> FAIL y el valor no se imprime' {
        $obj = Get-Content -LiteralPath $script:w.ConfigPath -Raw | ConvertFrom-Json
        $obj | Add-Member -NotePropertyName password -NotePropertyValue 'valor-secreto-xyz'
        [System.IO.File]::WriteAllText($script:w.ConfigPath, ($obj | ConvertTo-Json -Depth 8))
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Config fields').Status | Should Be 'FAIL'
        ((Format-PreflightReport -Result $r) -join "`n") | Should Not Match 'valor-secreto-xyz'
    }
}

Describe 'Preflight - PostgreSQL, base de datos y autenticación' {

    BeforeEach { $script:w = New-PreflightWorld; Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupPreflight; Reset-Sim }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'PostgreSQL ausente (carpeta bin inexistente) -> FAIL en tools, pg_dump y pg_restore' {
        Remove-Item -LiteralPath (Join-Path $script:w.Root 'tools\PostgreSQL') -Recurse -Force
        Clear-FakeTools
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'PostgreSQL tools').Status | Should Be 'FAIL'
        (Get-Check $r 'pg_dump').Status | Should Be 'FAIL'
        (Get-Check $r 'pg_restore').Status | Should Be 'FAIL'
        $r.Overall | Should Be 'FAIL'
    }

    It 'falta solo pg_restore.exe -> FAIL únicamente en pg_restore' {
        Remove-FakeTool -Path (Join-Path $script:w.PgBin 'pg_restore.exe')
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'pg_restore').Status | Should Be 'FAIL'
        (Get-Check $r 'pg_dump').Status | Should Be 'PASS'
    }

    It 'base de datos inaccesible (pg_isready falla) -> FAIL y la autenticación queda sin comprobar (FAIL)' {
        $global:Sim.IsReadyExit = 2
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Database reachable').Status | Should Be 'FAIL'
        (Get-Check $r 'Backup user auth').Status | Should Be 'FAIL'
        ($global:Sim.Calls | Where-Object { $_.File -eq 'psql.exe' }) | Should BeNullOrEmpty
    }

    It 'autenticación fallida -> FAIL; el detalle nunca contiene la ruta del pgpass' {
        $global:Sim.PsqlExit = 2
        $global:Sim.PsqlOut = ''
        $global:Sim.PsqlErr = "psql: error: FATAL:  password authentication failed for user ""daubert_backup"" (archivo $($script:w.PgPass))"
        $r = Invoke-Pf -World $script:w
        $auth = Get-Check $r 'Backup user auth'
        $auth.Status | Should Be 'FAIL'
        $auth.Detail | Should Match 'password authentication failed'
        $auth.Detail | Should Not Match ([regex]::Escape($script:w.PgPass))
    }

    It 'sin pgpass -> FAIL y no se intenta autenticar' {
        Remove-Item -LiteralPath $script:w.PgPass -Force
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'PGPASS file').Status | Should Be 'FAIL'
        (Get-Check $r 'Backup user auth').Status | Should Be 'FAIL'
        ($global:Sim.Calls | Where-Object { $_.File -eq 'psql.exe' }) | Should BeNullOrEmpty
    }

    It 'pgpass con ACL permisiva (p. ej. Everyone) -> WARN' {
        $item = New-Object System.IO.FileInfo($script:w.PgPass)
        $acl = $item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
        $everyone = New-Object System.Security.Principal.SecurityIdentifier([System.Security.Principal.WellKnownSidType]::WorldSid, $null)
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, 'Read', 'Allow')))
        $item.SetAccessControl($acl)
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'PGPASS file').Status | Should Be 'WARN'
    }

    It 'sin psql.exe la autenticación es WARN (no se puede probar), no PASS' {
        Remove-FakeTool -Path (Join-Path $script:w.PgBin 'psql.exe')
        (Get-Check (Invoke-Pf -World $script:w) 'Backup user auth').Status | Should Be 'WARN'
    }
}

Describe 'Preflight - 7-Zip, age, destinatarios y clave privada' {

    BeforeEach { $script:w = New-PreflightWorld; Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupPreflight; Reset-Sim }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    It '7-Zip ausente -> FAIL' {
        Remove-FakeTool -Path $script:w.SevenZip
        (Get-Check (Invoke-Pf -World $script:w) '7-Zip').Status | Should Be 'FAIL'
    }

    It 'age ausente -> FAIL' {
        Remove-FakeTool -Path $script:w.Age
        (Get-Check (Invoke-Pf -World $script:w) 'age').Status | Should Be 'FAIL'
    }

    It 'archivo de destinatarios ausente -> FAIL' {
        Remove-Item -LiteralPath $script:w.Recipients -Force
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Recipients file').Status | Should Be 'FAIL'
        (Get-Check $r 'Public recipient').Status | Should Be 'FAIL'
    }

    It 'destinatario inválido -> FAIL' {
        Set-Content -LiteralPath $script:w.Recipients -Value 'esto-no-es-age' -Encoding ASCII
        (Get-Check (Invoke-Pf -World $script:w) 'Public recipient').Status | Should Be 'FAIL'
    }

    It 'clave privada dentro del archivo de destinatarios -> FAIL (y no se imprime)' {
        Set-Content -LiteralPath $script:w.Recipients -Value @($global:ValidRecipient, $global:FakePrivateKey) -Encoding ASCII
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Public recipient').Status | Should Be 'FAIL'
        (Get-Check $r 'No age private key').Status | Should Be 'FAIL'
        ((Format-PreflightReport -Result $r) -join "`n") | Should Not Match 'QQQQQQQQ'
    }

    It 'clave privada detectada en una ruta administrada (config dir) -> FAIL' {
        Set-Content -LiteralPath (Join-Path $script:w.CfgDir 'age-identity.txt') -Value 'x' -Encoding ASCII
        (Get-Check (Invoke-Pf -World $script:w) 'No age private key').Status | Should Be 'FAIL'
    }

    It 'clave privada detectada por contenido en staging -> FAIL' {
        Set-Content -LiteralPath (Join-Path $script:w.Staging 'notas.txt') -Value $global:FakePrivateKey -Encoding ASCII
        (Get-Check (Invoke-Pf -World $script:w) 'No age private key').Status | Should Be 'FAIL'
    }

    It 'sin claves privadas -> PASS' {
        (Get-Check (Invoke-Pf -World $script:w) 'No age private key').Status | Should Be 'PASS'
    }
}

Describe 'Preflight - rutas y espacio' {

    BeforeEach { $script:w = New-PreflightWorld; Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupPreflight; Reset-Sim }
    AfterEach {
        # Por si algún test dejó una regla Deny en el backup root.
        try {
            $d = New-Object System.IO.DirectoryInfo($script:w.Ext)
            $acl = $d.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
            foreach ($rule in @($acl.Access | Where-Object { $_.AccessControlType -eq 'Deny' })) { [void]$acl.RemoveAccessRule($rule) }
            $d.SetAccessControl($acl)
        } catch { }
        Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'backup root inexistente -> FAIL' {
        Remove-Item -LiteralPath $script:w.Ext -Recurse -Force
        (Get-Check (Invoke-Pf -World $script:w) 'Backup root').Status | Should Be 'FAIL'
    }

    It 'backup root no escribible -> FAIL en "Backup root writable"' {
        $d = New-Object System.IO.DirectoryInfo($script:w.Ext)
        $acl = $d.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
        $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($me, 'CreateFiles,WriteData', 'ContainerInherit,ObjectInherit', 'None', 'Deny')))
        $d.SetAccessControl($acl)
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Backup root').Status | Should Be 'PASS'
        (Get-Check $r 'Backup root writable').Status | Should Be 'FAIL'
        $r.Overall | Should Be 'FAIL'
    }

    It 'staging inexistente pero ubicable -> WARN; logs/locks existentes -> PASS' {
        Remove-Item -LiteralPath $script:w.Staging -Recurse -Force
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Staging').Status | Should Be 'WARN'
        (Get-Check $r 'Log root').Status | Should Be 'PASS'
        (Get-Check $r 'Lock root').Status | Should Be 'PASS'
    }

    It 'espacio libre: PASS con 100 GB; WARN con 2 GB; FAIL con 0.5 GB (mínimo 5 GB)' {
        $global:FreeBytes = 100GB
        (Get-Check (Invoke-Pf -World $script:w) 'Free space (backup root)').Status | Should Be 'PASS'
        $global:FreeBytes = 2GB
        (Get-Check (Invoke-Pf -World $script:w) 'Free space (backup root)').Status | Should Be 'WARN'
        $global:FreeBytes = 0.5GB
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Free space (backup root)').Status | Should Be 'FAIL'
        (Get-Check $r 'Free space (staging)').Status | Should Be 'FAIL'
    }

    It 'espacio libre indeterminable -> WARN' {
        $global:FreeBytes = $null
        (Get-Check (Invoke-Pf -World $script:w) 'Free space (backup root)').Status | Should Be 'WARN'
    }
}

Describe 'Preflight - tareas programadas y último backup' {

    BeforeEach { $script:w = New-PreflightWorld; Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupPreflight; Reset-Sim }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'tareas faltantes (una) -> WARN indicando cuál' {
        $global:Tasks[1] = [pscustomobject]@{ TaskName = 'Daubert - PostgreSQL Daily'; Exists = $false; State = $null; LastTaskResult = $null; LastRunTime = $null; NextRunTime = $null }
        $c = Get-Check (Invoke-Pf -World $script:w) 'Scheduled Tasks'
        $c.Status | Should Be 'WARN'
        $c.Detail | Should Match 'Daily'
    }

    It 'tarea deshabilitada -> WARN' {
        $global:Tasks[0].State = 'Disabled'
        (Get-Check (Invoke-Pf -World $script:w) 'Scheduled Tasks').Status | Should Be 'WARN'
    }

    It 'última ejecución con error -> WARN' {
        $global:Tasks[2].LastTaskResult = 2
        (Get-Check (Invoke-Pf -World $script:w) 'Scheduled Tasks').Status | Should Be 'WARN'
    }

    It 'tarea que aún no ha corrido (267011) no es error' {
        $global:Tasks | ForEach-Object { $_.LastTaskResult = 267011 }
        (Get-Check (Invoke-Pf -World $script:w) 'Scheduled Tasks').Status | Should Be 'PASS'
    }

    It 'si Task Scheduler no se puede consultar -> WARN, no excepción' {
        $params = @{ ConfigPath = $script:w.ConfigPath; Now = $global:Now; TaskQuery = { throw 'sin acceso' }; FreeSpaceProvider = { 100GB } }
        $params.ProcessRunner = { param($FilePath, $ArgumentList, $Environment) [pscustomobject]@{ ExitCode = 0; StdOut = "1`n"; StdErr = '' } }
        (Get-Check (Invoke-BackupPreflight @params) 'Scheduled Tasks').Status | Should Be 'WARN'
    }

    It 'sin ningún backup -> WARN (instalación nueva)' {
        (Get-Check (Invoke-Pf -World $script:w) 'Last valid backup').Status | Should Be 'WARN'
    }

    It 'backup reciente con sidecar correcto -> PASS y SHA-256 PASS' {
        Set-BackupFile -World $script:w -Tier Frequent -Timestamp $global:Now.AddHours(-2) | Out-Null
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Last valid backup').Status | Should Be 'PASS'
        (Get-Check $r 'Last backup SHA-256').Status | Should Be 'PASS'
    }

    It 'backup demasiado antiguo (> 2x el intervalo Frequent = 8 h) -> WARN' {
        Set-BackupFile -World $script:w -Tier Frequent -Timestamp $global:Now.AddHours(-30) | Out-Null
        $c = Get-Check (Invoke-Pf -World $script:w) 'Last valid backup'
        $c.Status | Should Be 'WARN'
        $c.Detail | Should Match '30'
    }

    It 'MaxBackupAgeHours personalizado se respeta' {
        Set-BackupFile -World $script:w -Tier Daily -Timestamp $global:Now.AddHours(-20) | Out-Null
        (Get-Check (Invoke-Pf -World $script:w -Extra @{ MaxBackupAgeHours = 48 }) 'Last valid backup').Status | Should Be 'PASS'
    }

    It 'toma el backup MÁS reciente entre todos los tiers' {
        Set-BackupFile -World $script:w -Tier Frequent -Timestamp $global:Now.AddHours(-40) | Out-Null
        Set-BackupFile -World $script:w -Tier Daily -Timestamp $global:Now.AddHours(-3) | Out-Null
        (Get-Check (Invoke-Pf -World $script:w) 'Last valid backup').Status | Should Be 'PASS'
    }

    It 'sidecar SHA-256 que no coincide -> FAIL' {
        Set-BackupFile -World $script:w -Tier Frequent -Timestamp $global:Now.AddHours(-1) -BadSidecar | Out-Null
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Last backup SHA-256').Status | Should Be 'FAIL'
        $r.Overall | Should Be 'FAIL'
    }

    It 'backup sin sidecar -> WARN' {
        Set-BackupFile -World $script:w -Tier Frequent -Timestamp $global:Now.AddHours(-1) -NoSidecar | Out-Null
        (Get-Check (Invoke-Pf -World $script:w) 'Last valid backup').Status | Should Be 'WARN'
    }

    It '-SkipHashVerify omite la verificación del hash (WARN explícito)' {
        Set-BackupFile -World $script:w -Tier Frequent -Timestamp $global:Now.AddHours(-1) -BadSidecar | Out-Null
        $r = Invoke-Pf -World $script:w -Extra @{ SkipHashVerify = $true }
        (Get-Check $r 'Last backup SHA-256').Status | Should Be 'WARN'
    }
}

Describe 'Test-DaubertBackupEnvironment.ps1 (script)' {

    It 'con un config inexistente termina con exit code 2 y OVERALL: FAIL, sin lanzar nada más' {
        $missing = Join-Path ([System.IO.Path]::GetTempPath()) ('no-existe-' + [guid]::NewGuid().ToString('N') + '\config.json')
        $script = Join-Path $moduleRoot 'commands\Test-DaubertBackupEnvironment.ps1'
        $out = & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -ConfigPath $missing 2>&1 | Out-String
        $LASTEXITCODE | Should Be 2
        $out | Should Match 'OVERALL: FAIL'
    }
}

Describe 'Preflight - dependencias declaradas en dependencies.json (verificador inyectado)' {

    BeforeEach {
        $script:w = New-PreflightWorld
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupPreflight
        Reset-Sim
        Set-BackupFile -World $script:w -Tier Frequent -Timestamp $global:Now.AddHours(-1) | Out-Null
    }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'sin verificador el preflight no evalúa el manifest (compatibilidad)' {
        (Get-Check (Invoke-Pf -World $script:w) 'Dependencies (manifest)') | Should BeNullOrEmpty
    }

    It 'todas las dependencias de producción presentes -> PASS' {
        $r = Invoke-Pf -World $script:w -Extra @{ DependencyChecker = { @([pscustomobject]@{ Id = 'age'; Status = 'Present'; Version = '1.3.1'; ValidatedVersion = '1.3.1'; MatchesValidated = $true }) } }
        (Get-Check $r 'Dependencies (manifest)').Status | Should Be 'PASS'
        $r.Overall | Should Be 'PASS'
    }

    It 'una dependencia ausente -> FAIL indicando el instalador de prerequisitos' {
        $r = Invoke-Pf -World $script:w -Extra @{ DependencyChecker = { @([pscustomobject]@{ Id = 'age'; Status = 'Missing'; Version = $null; ValidatedVersion = '1.3.1'; MatchesValidated = $null }) } }
        $c = Get-Check $r 'Dependencies (manifest)'
        $c.Status | Should Be 'FAIL'
        $c.Detail | Should Match 'Install-DaubertBackupPrerequisites'
        $c.Detail | Should Match 'age'
        $r.ExitCode | Should Be 2
    }

    It 'una dependencia incompatible (versión baja) -> FAIL' {
        $r = Invoke-Pf -World $script:w -Extra @{ DependencyChecker = { @([pscustomobject]@{ Id = 'postgresql-client'; Status = 'Incompatible'; Version = '12.1'; ValidatedVersion = '18'; MatchesValidated = $false }) } }
        (Get-Check $r 'Dependencies (manifest)').Status | Should Be 'FAIL'
    }

    It 'versión distinta de la validada pero compatible -> PASS con nota (no es un pin rígido)' {
        $r = Invoke-Pf -World $script:w -Extra @{ DependencyChecker = { @([pscustomobject]@{ Id = 'postgresql-client'; Status = 'Present'; Version = '16.4'; ValidatedVersion = '18'; MatchesValidated = $false }) } }
        $c = Get-Check $r 'Dependencies (manifest)'
        $c.Status | Should Be 'PASS'
        $c.Detail | Should Match '16\.4'
    }

    It 'si el verificador falla (p. ej. manifest ilegible) -> WARN, sin excepción' {
        $r = Invoke-Pf -World $script:w -Extra @{ DependencyChecker = { throw 'manifest invalido' } }
        (Get-Check $r 'Dependencies (manifest)').Status | Should Be 'WARN'
    }

    It 'el script de preflight cablea el manifest (BackupPrerequisites) y solo evalúa producción' {
        $src = Get-Content -LiteralPath (Join-Path $moduleRoot 'commands\Test-DaubertBackupEnvironment.ps1') -Raw
        $src | Should Match ([regex]::Escape("$DaubertBackupModules = @('Preflight', 'Prerequisites')"))
        $src | Should Match 'Get-PrerequisiteReport -Manifest \$m\.Manifest -Scope Production'
    }
}

Describe 'Preflight - tareas: antes de registrar es WARN, después confirma las tres tareas correctas' {

    BeforeEach {
        Import-Module (Join-Path $moduleRoot 'lib\BackupTasks.psm1') -Force
        $script:w = New-PreflightWorld
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupPreflight
        Reset-Sim
        Set-BackupFile -World $script:w -Tier Frequent -Timestamp $global:Now.AddHours(-1) | Out-Null
        $script:entry = Join-Path $moduleRoot 'commands\Start-DaubertPostgresBackup.ps1'
    }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    function New-RegisteredTasks {
        param([string]$ConfigPath = $script:w.ConfigPath, [string]$Script = $script:entry, [scriptblock]$Mutate = $null)
        foreach ($t in 'Frequent', 'Daily', 'Monthly') {
            $xml = New-BackupTaskXml -Tier $t -Schedule (Get-DefaultSchedule -Tier $t) -ScriptPath $Script -ConfigPath $ConfigPath -PowerShellPath 'powershell-simulado.exe' -LogonType S4U -UserId 'PC\operador'
            if ($Mutate) { $xml = & $Mutate $xml $t }
            [pscustomobject]@{ TaskName = "Daubert - PostgreSQL $t"; Exists = $true; State = 'Ready'; LastTaskResult = 0; LastRunTime = $global:Now; NextRunTime = $global:Now; Xml = $xml }
        }
    }

    It 'antes de registrar: la ausencia de tareas es WARN (no FAIL) y el resto del entorno queda PASS' {
        $global:Tasks = @($global:Tasks | ForEach-Object { [pscustomobject]@{ TaskName = $_.TaskName; Exists = $false; State = $null; LastTaskResult = $null; LastRunTime = $null; NextRunTime = $null; Xml = $null } })
        $r = Invoke-Pf -World $script:w
        (Get-Check $r 'Scheduled Tasks').Status | Should Be 'WARN'
        $r.Overall | Should Be 'WARN'
        $r.ExitCode | Should Be 1
        @($r.Checks | Where-Object { $_.Status -eq 'FAIL' }).Count | Should Be 0
    }

    It 'después de registrarlas correctamente: PASS confirmando entrypoint canónico, ConfigPath e IgnoreNew' {
        $global:Tasks = @(New-RegisteredTasks)
        $r = Invoke-Pf -World $script:w
        $c = Get-Check $r 'Scheduled Tasks'
        $c.Status | Should Be 'PASS'
        $c.Detail | Should Match 'entrypoint canónico'
        $r.Overall | Should Be 'PASS'
    }

    It 'una tarea que apunta a OTRO ConfigPath -> WARN indicando cuál' {
        $global:Tasks = @(New-RegisteredTasks -ConfigPath (Join-Path $script:w.Root 'otro\config.json'))
        $c = Get-Check (Invoke-Pf -World $script:w) 'Scheduled Tasks'
        $c.Status | Should Be 'WARN'
        $c.Detail | Should Match 'ConfigPath'
    }

    It 'una tarea que no ejecuta el entrypoint canónico (ruta antigua) -> WARN' {
        $global:Tasks = @(New-RegisteredTasks -Script (Join-Path $moduleRoot 'Start-DaubertPostgresBackup.ps1'))
        (Get-Check (Invoke-Pf -World $script:w) 'Scheduled Tasks').Status | Should Be 'WARN'
    }

    It 'una tarea que permite instancias solapadas (sin IgnoreNew) -> WARN' {
        $global:Tasks = @(New-RegisteredTasks -Mutate { param($xml, $t) $xml.Replace('IgnoreNew', 'Parallel') })
        $c = Get-Check (Invoke-Pf -World $script:w) 'Scheduled Tasks'
        $c.Status | Should Be 'WARN'
        $c.Detail | Should Match 'IgnoreNew'
    }

    It 'una tarea con el nombre correcto pero NO creada por Daubert (sin marca) -> WARN' {
        $global:Tasks = @(New-RegisteredTasks -Mutate { param($xml, $t) $xml.Replace('DaubertHub-Managed-Backup', 'otra-cosa') })
        (Get-Check (Invoke-Pf -World $script:w) 'Scheduled Tasks').Detail | Should Match 'no fue creada por Daubert'
    }

    It 'una tarea con el -Tier de otro nombre -> WARN' {
        $global:Tasks = @(New-RegisteredTasks -Mutate { param($xml, $t) $xml.Replace("-Tier $t", '-Tier Monthly') })
        (Get-Check (Invoke-Pf -World $script:w) 'Scheduled Tasks').Status | Should Be 'WARN'
    }

    It 'el informe no imprime secretos ni la ruta del pgpass al validar las tareas' {
        $global:Tasks = @(New-RegisteredTasks)
        $text = (Format-PreflightReport -Result (Invoke-Pf -World $script:w)) -join "`n"
        $text | Should Not Match $global:PwCanary
        $text | Should Not Match 'pgpass-backup'
    }

    It 'staging con directorios de una ejecución interrumpida -> WARN informativo (se limpian solos en la próxima ejecución)' {
        New-Item -ItemType Directory -Path (Join-Path $script:w.Staging ([guid]::NewGuid().ToString('N'))) -Force | Out-Null
        $c = Get-Check (Invoke-Pf -World $script:w) 'Staging residue'
        $c.Status | Should Be 'WARN'
        $c.Detail | Should Match 'próxima ejecución'
    }

    It 'sin residuos no aparece la fila "Staging residue"' {
        (Get-Check (Invoke-Pf -World $script:w) 'Staging residue') | Should BeNullOrEmpty
    }
}
