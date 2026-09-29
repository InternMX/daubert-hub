#Requires -Version 5.1
<#
    Pruebas del instalador (BackupInstall.psm1) con un Prompter simulado.
    Todo en directorios temporales: no se instala nada, no se toca PostgreSQL,
    Task Scheduler, Dropbox real, secretos reales ni age real. Las
    herramientas son archivos vacíos.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupInstall.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupConfig.psm1') -Force
Import-Module (Join-Path $moduleRoot 'lib\BackupLocalConfig.psm1') -Force
Import-Module (Join-Path $moduleRoot 'lib\BackupInstall.psm1') -Force
. (Join-Path $PSScriptRoot 'helpers\TestDoubles.ps1')

$global:ValidRecipient = 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123'
$global:FakePrivateKey = 'AGE-SECRET-' + 'KEY-1' + ('Q' * 58)

function New-TestPrompter {
    param([hashtable[]]$Ask = @(), [hashtable[]]$Confirm = @(), [string]$Choice = 'Cancelar', [string]$Secret = 'Canario-Secreto-123')
    $state = [pscustomobject]@{
        Messages = New-Object System.Collections.Generic.List[string]
        Prompts  = New-Object System.Collections.Generic.List[string]
        Secrets  = 0
    }
    $askRules = $Ask; $confirmRules = $Confirm; $choice = $Choice; $secretText = $Secret
    $prompter = [pscustomobject]@{
        Write     = { param($m) $state.Messages.Add([string]$m) }.GetNewClosure()
        Ask       = { param($prompt, $default) $state.Prompts.Add("ASK:$prompt"); foreach ($r in $askRules) { if ($prompt -match $r.Match) { return $r.Value } }; return $default }.GetNewClosure()
        AskSecret = { param($prompt) $state.Prompts.Add("SECRET:$prompt"); $state.Secrets++; ConvertTo-SecureString $secretText -AsPlainText -Force }.GetNewClosure()
        Confirm   = { param($prompt, $defaultYes) $state.Prompts.Add("CONFIRM:$prompt"); foreach ($r in $confirmRules) { if ($prompt -match $r.Match) { return [bool]$r.Value } }; return [bool]$defaultYes }.GetNewClosure()
        Choose    = { param($prompt, $options) $state.Prompts.Add("CHOOSE:$prompt"); return $choice }.GetNewClosure()
    }
    [pscustomobject]@{ Prompter = $prompter; State = $state }
}

function New-InstallWorld {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-install-' + [guid]::NewGuid().ToString('N'))
    $tools = Join-Path $root 'Program Files (fake)'
    $pgBin = Join-Path $tools 'PostgreSQL\18\bin'
    # Carpetas reales (vacías); las herramientas solo "existen" en memoria (Test-BackupToolPath mockeado).
    New-Item -ItemType Directory -Path $pgBin, (Join-Path $tools '7-Zip'), (Join-Path $tools 'age') -Force | Out-Null
    Clear-FakeTools
    Add-FakePgToolset -BinDir $pgBin -Names @('pg_dump.exe', 'pg_restore.exe', 'pg_dumpall.exe') | Out-Null
    Add-FakeTool -Path (Join-Path $tools '7-Zip\7z.exe'), (Join-Path $tools 'age\age.exe')
    $ext = Join-Path $root 'almacenamiento externo'
    New-Item -ItemType Directory -Path $ext -Force | Out-Null

    $paths = Get-DefaultBackupPaths -ProgramDataRoot (Join-Path $root 'ProgramData') -LocalAppDataRoot (Join-Path $root 'LocalAppData')
    [pscustomobject]@{
        Root = $root; PgBin = $pgBin; SevenZip = (Join-Path $tools '7-Zip\7z.exe'); Age = (Join-Path $tools 'age\age.exe')
        Ext = $ext; Paths = $paths; ConfigPath = $paths.ConfigPath
    }
}

function New-Detector {
    param($World, [switch]$NoAge, [string[]]$Dropbox = @())
    $pg = $World.PgBin; $sz = $World.SevenZip; $ag = if ($NoAge) { $null } else { $World.Age }; $dbx = $Dropbox
    { @{ PgBin = $pg; SevenZip = $sz; Age = $ag; Dropbox = $dbx } }.GetNewClosure()
}

$acceptDefaults = @(
    @{ Match = 'datos de conexi'; Value = $true }
    @{ Match = 'rutas locales'; Value = $true }
)

Describe 'Install-DaubertBackup - instalación nueva' {

    BeforeEach {
        $script:w = New-InstallWorld
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupInstall
    }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'instalación nueva completa: config válido, recipient, pgpass restringido, layout; tareas NO registradas' {
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(
            @{ Match = 'destino de backups'; Value = $script:w.Ext }
            @{ Match = 'Clave P'; Value = $global:ValidRecipient }
        )
        $script:registered = 0
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) -RegisterTasks { $script:registered++ }

        $r.Action | Should Be 'Installed'
        $cfg = Read-LocalBackupConfig -Path $script:w.ConfigPath
        $cfg.IsValid | Should Be $true
        $cfg.Config.postgresBin | Should Be $script:w.PgBin
        $cfg.Config.sevenZipPath | Should Be $script:w.SevenZip
        $cfg.Config.agePath | Should Be $script:w.Age
        $cfg.Config.backupRoot | Should Be $script:w.Ext
        (Get-AgeRecipientInfo -Path $script:w.Paths.RecipientsFilePath).IsValid | Should Be $true
        Test-Path -LiteralPath $script:w.Paths.PgPassFile | Should Be $true
        (Test-SecretFileAcl -Path $script:w.Paths.PgPassFile).IsRestricted | Should Be $true
        Test-Path -LiteralPath $script:w.Paths.LogRoot | Should Be $true
        Test-Path -LiteralPath $script:w.Paths.LockRoot | Should Be $true
        Test-Path -LiteralPath $script:w.Paths.StagingRoot | Should Be $true
        $script:registered | Should Be 0
        $r.TasksRegistered | Should Be $false
    }

    It 'la contraseña no aparece en config.json, mensajes, prompts ni en ningún archivo salvo el pgpass' {
        $canary = 'Canario-' + [guid]::NewGuid().ToString('N')
        $t = New-TestPrompter -Confirm $acceptDefaults -Secret $canary -Ask @(
            @{ Match = 'destino de backups'; Value = $script:w.Ext }
            @{ Match = 'Clave P'; Value = $global:ValidRecipient }
        )
        Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) | Out-Null

        (($t.State.Messages -join "`n") + ($t.State.Prompts -join "`n")) | Should Not Match $canary
        [System.IO.File]::ReadAllText($script:w.ConfigPath) | Should Not Match $canary
        $others = Get-ChildItem -LiteralPath $script:w.Root -Recurse -File -Force | Where-Object { $_.FullName -ne $script:w.Paths.PgPassFile }
        foreach ($f in $others) { [System.IO.File]::ReadAllText($f.FullName) | Should Not Match $canary }
        [System.IO.File]::ReadAllText($script:w.Paths.PgPassFile) | Should Match $canary
    }

    It 'la contraseña se pide exactamente una vez, de forma oculta (AskSecret)' {
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) | Out-Null
        $t.State.Secrets | Should Be 1
    }

    It 'herramienta ausente: se informa el prerequisito y NO se escribe nada' {
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(
            @{ Match = 'age\.exe'; Value = '' }
            @{ Match = 'destino de backups'; Value = $script:w.Ext }
            @{ Match = 'Clave P'; Value = $global:ValidRecipient }
        )
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w -NoAge)
        $r.Action | Should Be 'MissingPrerequisites'
        ($r.Missing -join ' ') | Should Match 'age'
        Test-Path -LiteralPath $script:w.ConfigPath | Should Be $false
        Test-Path -LiteralPath $script:w.Paths.PgPassFile | Should Be $false
        Test-Path -LiteralPath $script:w.Paths.RecipientsFilePath | Should Be $false
        Test-Path -LiteralPath (Join-Path $script:w.Root 'ProgramData') | Should Be $false
        ($t.State.Messages -join "`n") | Should Match 'github.com/FiloSottile/age'
    }

    It 'herramienta no detectada pero indicada manualmente: se acepta' {
        $manualAge = Join-Path $script:w.Root 'otra carpeta\age.exe'
        Add-FakeTool -Path $manualAge
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(
            @{ Match = 'age\.exe'; Value = $manualAge }
            @{ Match = 'destino de backups'; Value = $script:w.Ext }
            @{ Match = 'Clave P'; Value = $global:ValidRecipient }
        )
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w -NoAge)
        $r.Action | Should Be 'Installed'
        (Read-LocalBackupConfig -Path $script:w.ConfigPath).Config.agePath | Should Be $manualAge
    }

    It 'Dropbox detectado: propone <Dropbox>\DaubertHub\Backups\PostgreSQL y la crea tras confirmar' {
        $dbx = Join-Path $script:w.Root 'Dropbox (Empresa)'
        New-Item -ItemType Directory -Path $dbx -Force | Out-Null
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w -Dropbox @($dbx))
        $r.Action | Should Be 'Installed'
        $expected = Join-Path $dbx 'DaubertHub\Backups\PostgreSQL'
        (Read-LocalBackupConfig -Path $script:w.ConfigPath).Config.backupRoot | Should Be $expected
        Test-Path -LiteralPath $expected | Should Be $true
    }

    It 'Dropbox NO detectado y sin ruta indicada: prerequisito faltante, nada se escribe' {
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = '' }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'MissingPrerequisites'
        ($r.Missing -join ' ') | Should Match 'destino'
        Test-Path -LiteralPath $script:w.ConfigPath | Should Be $false
    }

    It 'Dropbox NO detectado pero ruta indicada manualmente (con espacios): funciona' {
        $manual = Join-Path $script:w.Root 'mi disco externo\backups daubert'
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $manual }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'Installed'
        Test-Path -LiteralPath $manual | Should Be $true
    }

    It 'una clave PRIVADA pegada como destinatario se rechaza sin repetirla ni guardarla' {
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:FakePrivateKey })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'MissingPrerequisites'
        (($t.State.Messages -join "`n") + ($t.State.Prompts -join "`n")) | Should Not Match 'QQQQQQQQ'
        Test-Path -LiteralPath $script:w.Paths.RecipientsFilePath | Should Be $false
        Test-Path -LiteralPath $script:w.ConfigPath | Should Be $false
    }

    It 'un archivo de destinatarios preexistente con clave privada aborta sin escribir config' {
        New-Item -ItemType Directory -Path (Split-Path -Parent $script:w.Paths.RecipientsFilePath) -Force | Out-Null
        Set-Content -LiteralPath $script:w.Paths.RecipientsFilePath -Value $global:FakePrivateKey -Encoding ASCII
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'Failed'
        Test-Path -LiteralPath $script:w.ConfigPath | Should Be $false
        ($t.State.Messages -join "`n") | Should Not Match 'QQQQQQQQ'
    }

    It 'registro de tareas: solo con confirmación explícita (por defecto NO)' {
        $script:registered = 0
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) -RegisterTasks { $script:registered++ } | Out-Null
        $script:registered | Should Be 0
        (($t.State.Prompts | Where-Object { $_ -match 'tareas programadas' }) | Measure-Object).Count | Should Be 1
    }

    It 'registro de tareas: se invoca una vez si el usuario confirma' {
        $script:registered = 0
        $confirms = $acceptDefaults + @(@{ Match = 'tareas programadas'; Value = $true })
        $t = New-TestPrompter -Confirm $confirms -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) -RegisterTasks { $script:registered++ }
        $script:registered | Should Be 1
        $r.TasksRegistered | Should Be $true
    }

    It '-SkipPgPass: no se pide contraseña ni se crea pgpass' {
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) -SkipPgPass | Out-Null
        $t.State.Secrets | Should Be 0
        Test-Path -LiteralPath $script:w.Paths.PgPassFile | Should Be $false
    }

    It 'fallo al crear el pgpass: Failed, sin filtrar la contraseña' {
        $canary = 'Canario-' + [guid]::NewGuid().ToString('N')
        Mock New-PgPassFile { throw ('boom ' + 'sin-datos') } -ModuleName BackupInstall
        $t = New-TestPrompter -Confirm $acceptDefaults -Secret $canary -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'Failed'
        (($t.State.Messages -join "`n") + ($r.Errors -join "`n")) | Should Not Match $canary
        Test-Path -LiteralPath $script:w.Paths.PgPassFile | Should Be $false
    }

    It 'el instalador no ejecuta ningún proceso externo ni toca PostgreSQL (no usa Start-Process/pg_*/psql)' {
        $src = Get-Content -LiteralPath (Join-Path $moduleRoot 'lib\BackupInstall.psm1') -Raw
        $src | Should Not Match 'Start-Process'
        $src | Should Not Match 'Invoke-ExternalProcess'
        $src | Should Not Match '(?i)psql'
        $src | Should Not Match '(?i)CREATE\s+ROLE'
    }
}

Describe 'Install-DaubertBackup - instalación existente' {

    BeforeEach {
        $script:w = New-InstallWorld
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupInstall
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) | Out-Null
        $script:cfgBefore = [System.IO.File]::ReadAllText($script:w.ConfigPath)
        $script:cfgTime = (Get-Item -LiteralPath $script:w.ConfigPath).LastWriteTimeUtc
    }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'Cancelar: no cambia nada' {
        $t = New-TestPrompter -Choice 'Cancelar'
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'Cancelled'
        [System.IO.File]::ReadAllText($script:w.ConfigPath) | Should Be $script:cfgBefore
    }

    It 'Validar: solo lectura, informa el estado' {
        $t = New-TestPrompter -Choice 'Validar'
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'Validated'
        ($t.State.Messages -join "`n") | Should Match 'config.json: V.{0,3}LIDO'
        (Get-Item -LiteralPath $script:w.ConfigPath).LastWriteTimeUtc | Should Be $script:cfgTime
    }

    It 'Validar detecta una configuración inválida y la reporta' {
        Set-Content -LiteralPath $script:w.ConfigPath -Value '{"database":"x"}' -Encoding UTF8
        $t = New-TestPrompter -Choice 'Validar'
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'Validated'
        $r.Errors.Count | Should BeGreaterThan 0
    }

    It 'Reparar con todo en orden: NoChange, sin preguntas, sin reescribir config ni pgpass (idempotencia)' {
        $pgTime = (Get-Item -LiteralPath $script:w.Paths.PgPassFile).LastWriteTimeUtc
        $t = New-TestPrompter -Choice 'Reparar'
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'NoChange'
        $t.State.Secrets | Should Be 0
        (($t.State.Prompts | Where-Object { $_ -notmatch '^CHOOSE' }) | Measure-Object).Count | Should Be 0
        [System.IO.File]::ReadAllText($script:w.ConfigPath) | Should Be $script:cfgBefore
        (Get-Item -LiteralPath $script:w.ConfigPath).LastWriteTimeUtc | Should Be $script:cfgTime
        (Get-Item -LiteralPath $script:w.Paths.PgPassFile).LastWriteTimeUtc | Should Be $pgTime
    }

    It 'Reparar dos veces seguidas sigue siendo NoChange' {
        1..2 | ForEach-Object {
            $t = New-TestPrompter
            (Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) -Mode Repair).Action | Should Be 'NoChange'
        }
    }

    It 'Reparar: recrea pgpass y destinatarios que faltan, sin tocar la config válida' {
        Remove-Item -LiteralPath $script:w.Paths.PgPassFile -Force
        Remove-Item -LiteralPath $script:w.Paths.RecipientsFilePath -Force
        $t = New-TestPrompter -Choice 'Reparar' -Ask @(@{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'Repaired'
        $r.PgPassCreated | Should Be $true
        $r.RecipientsWritten | Should Be $true
        Test-Path -LiteralPath $script:w.Paths.PgPassFile | Should Be $true
        (Get-AgeRecipientInfo -Path $script:w.Paths.RecipientsFilePath).IsValid | Should Be $true
        [System.IO.File]::ReadAllText($script:w.ConfigPath) | Should Be $script:cfgBefore
    }

    It 'Reparar: ruta de herramienta obsoleta (otra máquina) se sustituye por la detectada localmente' {
        $obj = Get-Content -LiteralPath $script:w.ConfigPath -Raw | ConvertFrom-Json
        $obj.agePath = Join-Path $script:w.Root 'ruta-vieja-inexistente\age.exe'
        [System.IO.File]::WriteAllText($script:w.ConfigPath, ($obj | ConvertTo-Json -Depth 8))
        $t = New-TestPrompter -Choice 'Reparar'
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'Repaired'
        (Read-LocalBackupConfig -Path $script:w.ConfigPath).Config.agePath | Should Be $script:w.Age
    }

    It 'Reparar: una config con JSON roto se reconstruye desde detección/defaults' {
        Set-Content -LiteralPath $script:w.ConfigPath -Value '{ roto' -Encoding UTF8
        $t = New-TestPrompter -Choice 'Reparar' -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.ConfigChanged | Should Be $true
        (Read-LocalBackupConfig -Path $script:w.ConfigPath).IsValid | Should Be $true
    }

    It 'Reconfigurar: cambia el puerto; el pgpass existente NO se sobrescribe en silencio' {
        $pgBefore = [System.IO.File]::ReadAllText($script:w.Paths.PgPassFile)
        $t = New-TestPrompter -Choice 'Reconfigurar' -Confirm @(
            @{ Match = 'datos de conexi'; Value = $false }
            @{ Match = 'rutas locales'; Value = $true }
            @{ Match = 'pgpass'; Value = $false }
        ) -Ask @(@{ Match = 'Puerto'; Value = '5433' })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.Action | Should Be 'Reconfigured'
        (Read-LocalBackupConfig -Path $script:w.ConfigPath).Config.port | Should Be 5433
        $t.State.Secrets | Should Be 0
        [System.IO.File]::ReadAllText($script:w.Paths.PgPassFile) | Should Be $pgBefore
        ($t.State.Messages -join "`n") | Should Not Match 'Canario'
    }

    It 'Reconfigurar: con confirmación explícita se reemplaza el pgpass y refleja el nuevo puerto' {
        $t = New-TestPrompter -Choice 'Reconfigurar' -Secret 'NuevaClave' -Confirm @(
            @{ Match = 'pgpass'; Value = $true }
            @{ Match = 'datos de conexi'; Value = $false }
            @{ Match = 'rutas locales'; Value = $true }
        ) -Ask @(@{ Match = 'Puerto'; Value = '5433' })
        Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) | Out-Null
        $t.State.Secrets | Should Be 1
        [System.IO.File]::ReadAllText($script:w.Paths.PgPassFile) | Should Be "localhost:5433:daubert_global:daubert_backup:NuevaClave`n"
    }

    It 'Reconfigurar aceptando todo igual: la config no cambia (Changed=false, idempotente)' {
        $t = New-TestPrompter -Choice 'Reconfigurar' -Confirm $acceptDefaults
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w)
        $r.ConfigChanged | Should Be $false
        $r.PgPassCreated | Should Be $false
        [System.IO.File]::ReadAllText($script:w.ConfigPath) | Should Be $script:cfgBefore
    }

    It 'nunca elimina backups existentes' {
        $tier = Join-Path $script:w.Ext 'DAILY'
        New-Item -ItemType Directory -Path $tier -Force | Out-Null
        $keep = Join-Path $tier 'daubert_global_DAILY_20260101_000000.age'
        Set-Content -LiteralPath $keep -Value 'x' -Encoding ASCII
        foreach ($mode in 'Repair', 'Reconfigure', 'Validate') {
            $t = New-TestPrompter -Confirm $acceptDefaults
            Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) -Mode $mode | Out-Null
        }
        Test-Path -LiteralPath $keep | Should Be $true
    }
}

Describe 'Install-DaubertBackup - integración con los prerequisitos declarados' {

    BeforeEach {
        $script:w = New-InstallWorld
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupInstall
        $script:ran = 0
    }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    It 'prerequisito faltante: el mensaje indica explícitamente ejecutar Install-DaubertBackupPrerequisites.ps1 y no instala nada' {
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'age\.exe'; Value = '' }; @{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w -NoAge)
        $r.Action | Should Be 'MissingPrerequisites'
        ($t.State.Messages -join "`n") | Should Match 'Install-DaubertBackupPrerequisites\.ps1'
    }

    It 'sin consentimiento explícito el instalador de prerequisitos NO se ejecuta (la pregunta es No por defecto)' {
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) -InstallPrerequisites { $script:ran++ }
        $script:ran | Should Be 0
        $r.PrerequisitesRun | Should Be $false
        (($t.State.Prompts | Where-Object { $_ -match 'prerequisitos' }) | Measure-Object).Count | Should Be 1
    }

    It 'con confirmación explícita se ejecuta una vez' {
        $confirms = @(@{ Match = 'prerequisitos'; Value = $true }) + $acceptDefaults
        $t = New-TestPrompter -Confirm $confirms -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) -InstallPrerequisites { $script:ran++ }
        $script:ran | Should Be 1
        $r.PrerequisitesRun | Should Be $true
    }

    It 'sin la opción -InstallPrerequisites ni siquiera se pregunta (nada de software en silencio)' {
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) | Out-Null
        (($t.State.Prompts | Where-Object { $_ -match 'prerequisitos' }) | Measure-Object).Count | Should Be 0
    }

    It 'el script Install-DaubertBackup.ps1 expone -InstallPrerequisites y llama al instalador de prerequisitos de commands/' {
        $p = Join-Path $moduleRoot 'commands\Install-DaubertBackup.ps1'
        ((Get-Command $p).Parameters.Keys -contains 'InstallPrerequisites') | Should Be $true
        (Get-Content -LiteralPath $p -Raw) | Should Match 'Install-DaubertBackupPrerequisites\.ps1'
    }
}

Describe 'Install-DaubertBackup - registro de tareas con elevación: el resultado real manda' {

    BeforeEach {
        $script:w = New-InstallWorld
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupInstall
    }
    AfterEach { Remove-Item -LiteralPath $script:w.Root -Recurse -Force -ErrorAction SilentlyContinue }

    function Invoke-InstallWith {
        param([scriptblock]$Register)
        $confirms = @(@{ Match = 'tareas programadas'; Value = $true }) + $acceptDefaults
        $t = New-TestPrompter -Confirm $confirms -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $r = Invoke-BackupInstall -ConfigPath $script:w.ConfigPath -Paths $script:w.Paths -Prompter $t.Prompter -Detector (New-Detector -World $script:w) -RegisterTasks $Register
        [pscustomobject]@{ Result = $r; Prompter = $t }
    }

    It 'la pregunta de registro avisa de que puede solicitar el UAC y sigue siendo "No" por defecto' {
        $x = Invoke-InstallWith { $true }
        (($x.Prompter.State.Prompts | Where-Object { $_ -match 'UAC' }) | Measure-Object).Count | Should Be 1
        $t = New-TestPrompter -Confirm $acceptDefaults -Ask @(@{ Match = 'destino de backups'; Value = $script:w.Ext }; @{ Match = 'Clave P'; Value = $global:ValidRecipient })
        $w2 = New-InstallWorld
        try {
            Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupInstall
            $script:ranNoConsent = 0
            Invoke-BackupInstall -ConfigPath $w2.ConfigPath -Paths $w2.Paths -Prompter $t.Prompter -Detector (New-Detector -World $w2) -RegisterTasks { $script:ranNoConsent++ } | Out-Null
            $script:ranNoConsent | Should Be 0
        }
        finally { Remove-Item -LiteralPath $w2.Root -Recurse -Force -ErrorAction SilentlyContinue }
    }

    It 'registro correcto (sin salida o $true) -> TasksRegistered = true' {
        (Invoke-InstallWith { }).Result.TasksRegistered | Should Be $true
        # un segundo mundo para el caso explícito $true
    }

    It 'UAC cancelado / registro fallido (el registro devuelve $false) -> NO se informa éxito y se dice que puede reintentarse' {
        $x = Invoke-InstallWith { $false }
        $x.Result.TasksRegistered | Should Be $false
        ($x.Prompter.State.Messages -join "`n") | Should Match 'NO quedaron registradas'
        ($x.Prompter.State.Messages -join "`n") | Should Match 'reintentar'
    }

    It 'el wizard llama a Register con -RequestElevation solo tras la confirmación y trata 7 (UAC cancelado) como no-éxito' {
        $src = Get-Content -LiteralPath (Join-Path $moduleRoot 'commands\Install-DaubertBackup.ps1') -Raw
        $src | Should Match 'Register-DaubertBackupTasks\.ps1''\) -ConfigPath \$ConfigPath -RequestElevation'
        $src | Should Match '7 \{ Write-Host ''Registro de tareas CANCELADO'
        $src | Should Match 'return \$false'
    }

    It 'el wizard solo se relanza elevado si escribir en ProgramData realmente lo requiere (sondeo) y sin secretos en los argumentos' {
        $src = Get-Content -LiteralPath (Join-Path $moduleRoot 'commands\Install-DaubertBackup.ps1') -Raw
        $src | Should Match "Get-ElevationRequirement -Operation 'WriteProgramData'"
        $src | Should Match 'Invoke-ElevationGate'
        $src | Should Not Match '(?i)-Parameters[^\r\n]*(password|secret|token|SecureString|Credential)'
    }
}
