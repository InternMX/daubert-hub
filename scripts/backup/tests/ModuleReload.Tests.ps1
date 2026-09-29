#Requires -Version 5.1
<#
    Pruebas de la política de recarga de módulos de los comandos operativos
    (lib\Import-DaubertBackupModules.ps1).

    Problema reproducido: tras editar un módulo (p. ej. BackupPgTools.psm1), una
    sesión de PowerShell que ya lo tenía cargado seguía ejecutando la versión
    anterior porque `Import-Module BackupPipeline -Force` solo recarga el
    pipeline, no los módulos que este importa de forma anidada.

    La reproducción usa una COPIA de lib\ en un directorio temporal y un
    proceso PowerShell hijo (la "sesión"): nunca se modifican archivos reales
    del repo ni se contaminan los módulos de esta sesión de pruebas. No hay
    ejecutables falsos ni compilación de código.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\ModuleReload.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
$libDir = Join-Path $moduleRoot 'lib'
$loader = Join-Path $libDir 'Import-DaubertBackupModules.ps1'
$commandsDir = Join-Path $moduleRoot 'commands'
. (Join-Path $PSScriptRoot 'helpers\TestDoubles.ps1')

$global:ReloadDriver = @'
param($Fx)
$ErrorActionPreference = 'Stop'
$lib = Join-Path $Fx 'lib'
function Get-PgDefinition { & (Get-Module BackupPipeline) { (Get-Command Invoke-PgDumpAllGlobals).Definition } }

# "Sesion previa": el pipeline y sus dependencias quedan cacheados (version 1).
Import-Module (Join-Path $lib 'BackupPipeline.psm1') -DisableNameChecking
$before = Get-PgDefinition

# Modulo ajeno con estado: NO debe tocarse.
$foreign = Join-Path $Fx 'ForeignFixture.psm1'
Set-Content -LiteralPath $foreign -Value '$script:Counter = 0; function Step-Foreign { $script:Counter++; $script:Counter }; Export-ModuleMember -Function Step-Foreign'
Import-Module $foreign
Step-Foreign | Out-Null; Step-Foreign | Out-Null

# Se edita la dependencia en disco (version 2).
$pg = Join-Path $lib 'BackupPgTools.psm1'
$text = [System.IO.File]::ReadAllText($pg)
[System.IO.File]::WriteAllText($pg, $text.Replace("'--no-role-passwords',", "'--no-role-passwords', '--marcador-v2',"))

# CONTROL: comportamiento anterior (solo el pipeline con -Force).
Import-Module (Join-Path $lib 'BackupPipeline.psm1') -Force -DisableNameChecking
$control = Get-PgDefinition

# SOLUCION: el cargador central.
$DaubertBackupModules = @('Pipeline')
. (Join-Path $lib 'Import-DaubertBackupModules.ps1')
$after = Get-PgDefinition

# Una segunda recarga sigue funcionando (clase del pipeline incluida) y no duplica modulos.
. (Join-Path $lib 'Import-DaubertBackupModules.ps1')
$cls = & (Get-Module BackupPipeline) { [BackupStageError]::new('x', 5).ExitCode }
$afterTwice = Get-PgDefinition

@{
    before = [bool]($before -match 'marcador-v2'); control = [bool]($control -match 'marcador-v2'); after = [bool]($after -match 'marcador-v2')
    afterTwice = [bool]($afterTwice -match 'marcador-v2'); cls = $cls; foreign = (Step-Foreign)
    pgCount = @(Get-Module BackupPgTools).Count; pipeCount = @(Get-Module BackupPipeline).Count
} | ConvertTo-Json -Compress
'@

function Invoke-ReloadScenario {
    $fx = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-reload-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $fx -Force | Out-Null
    try {
        Copy-Item -LiteralPath $libDir -Destination (Join-Path $fx 'lib') -Recurse
        $driver = Join-Path $fx 'driver.ps1'
        [System.IO.File]::WriteAllText($driver, $global:ReloadDriver, (New-Object System.Text.UTF8Encoding($true)))
        $out = & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $driver -Fx $fx 2>&1 | Out-String
        $json = ($out -split "`r?`n" | Where-Object { $_ -match '^\{.*\}$' } | Select-Object -Last 1)
        if (-not $json) { throw "El escenario no devolvió resultado: $out" }
        return ($json | ConvertFrom-Json)
    }
    finally { Remove-Item -LiteralPath $fx -Recurse -Force -ErrorAction SilentlyContinue }
}

Describe 'Recarga de módulos: la sesión no puede servir código obsoleto' {

    BeforeAll { $script:res = Invoke-ReloadScenario }

    It 'REPRODUCCIÓN: forzar solo el pipeline (comportamiento anterior) deja la dependencia obsoleta en la sesión' {
        $script:res.before | Should Be $false
        $script:res.control | Should Be $false
    }

    It 'con el cargador central el pipeline usa la versión ACTUAL de BackupPgTools editada en disco' {
        $script:res.after | Should Be $true
    }

    It 'recargar dos veces seguidas sigue dando la versión actual, sin módulos duplicados' {
        $script:res.afterTwice | Should Be $true
        $script:res.pgCount | Should Be 1
        $script:res.pipeCount | Should Be 1
    }

    It 'la clase del pipeline (BackupStageError) sigue funcionando tras recargar' {
        $script:res.cls | Should Be 5
    }

    It 'no toca módulos ajenos: un módulo fuera de Daubert conserva su instancia y su estado' {
        $script:res.foreign | Should Be 3
    }
}

Describe 'Cargador central (Import-DaubertBackupModules.ps1)' {

    It 'el grafo declara todas las dependencias anidadas reales de cada módulo de lib/' {
        $graph = & { . $loader; $DaubertBackupModuleGraph }
        foreach ($f in (Get-ChildItem -LiteralPath $libDir -Filter 'Backup*.psm1')) {
            $name = $f.BaseName.Substring('Backup'.Length)
            ($graph.Keys -contains $name) | Should Be $true
            $deps = [regex]::Matches([System.IO.File]::ReadAllText($f.FullName), "Import-Module \(Join-Path \`$PSScriptRoot 'Backup(\w+)\.psm1'\)") | ForEach-Object { $_.Groups[1].Value }
            foreach ($d in $deps) { ($graph[$name] -contains $d) | Should Be $true }
        }
    }

    It 'el orden del grafo es topológico (cada módulo aparece después de sus dependencias)' {
        $graph = & { . $loader; $DaubertBackupModuleGraph }
        $keys = @($graph.Keys)
        foreach ($k in $keys) { foreach ($d in $graph[$k]) { [array]::IndexOf($keys, $d) | Should BeLessThan ([array]::IndexOf($keys, $k)) } }
    }

    It 'la clausura de Pipeline incluye todas sus dependencias (transitivas) y ningún módulo de más' {
        $c = & { . $loader; Resolve-DaubertBackupModuleClosure -Name @('Pipeline') }
        $c | Should Be @('Config', 'LocalConfig', 'Naming', 'Logging', 'Lock', 'Hash', 'PgTools', 'Packaging', 'Encryption', 'Retention', 'Publish', 'Pipeline')
        (& { . $loader; Resolve-DaubertBackupModuleClosure -Name @('Tasks') }) | Should Be @('Elevation', 'Config', 'LocalConfig', 'Tasks')
    }

    It 'un módulo desconocido falla con un mensaje claro (no importa nada raro)' {
        { & { . $loader; Resolve-DaubertBackupModuleClosure -Name @('Inventado') } } | Should Throw
    }

    It 'importa solo por ruta explícita de lib/ y solo módulos Backup*.psm1 (nunca módulos ajenos)' {
        $src = Get-Content -LiteralPath $loader -Raw
        $src | Should Match 'Join-Path \$PSScriptRoot "Backup\$daubertModule\.psm1"'
        $src | Should Not Match 'Remove-Module|Get-Module -All|Stop-Process|Restart-'
    }

    It 'los módulos se importan en el ámbito del comando, no en el global' {
        (Get-Content -LiteralPath $loader -Raw) | Should Not Match '-Global'
        foreach ($f in (Get-ChildItem -LiteralPath $libDir -Filter '*.psm1')) { (Get-Content -LiteralPath $f.FullName -Raw) | Should Not Match 'Import-Module[^\r\n]*-Global' }
    }

    It 'ningún módulo de lib/ fuerza la recarga de otros (-Force lo decide únicamente el cargador)' {
        foreach ($f in (Get-ChildItem -LiteralPath $libDir -Filter '*.psm1')) { (Get-Content -LiteralPath $f.FullName -Raw) | Should Not Match 'Import-Module[^\r\n]*-Force' }
    }
}

Describe 'Los cinco comandos operativos (más el instalador de prerequisitos) usan el cargador y tienen sus imports correctos' {

    $expected = [ordered]@{
        'Start-DaubertPostgresBackup.ps1'        = @('Pipeline')
        'Install-DaubertBackup.ps1'              = @('Install', 'Tasks')
        'Test-DaubertBackupEnvironment.ps1'      = @('Preflight', 'Prerequisites')
        'Register-DaubertBackupTasks.ps1'        = @('Tasks')
        'Unregister-DaubertBackupTasks.ps1'      = @('Tasks')
        'Install-DaubertBackupPrerequisites.ps1' = @('Prerequisites')
    }

    foreach ($name in $expected.Keys) {
        It "$name : declara sus módulos, usa el cargador y no importa módulos de lib a mano" {
            $src = Get-Content -LiteralPath (Join-Path $commandsDir $name) -Raw
            $list = ($expected[$name] | ForEach-Object { "'$_'" }) -join ', '
            $src | Should Match ([regex]::Escape("`$DaubertBackupModules = @($list)"))
            $src | Should Match ([regex]::Escape("Import-DaubertBackupModules.ps1"))
            $src | Should Not Match 'Import-Module'
            $src | Should Not Match ('(?i)Add' + '-Type')
        }

        It "$name : todas las funciones Daubert que invoca están exportadas por la clausura de sus módulos" {
            $graph = & { . $loader; $DaubertBackupModuleGraph }
            $closure = & { . $loader; Resolve-DaubertBackupModuleClosure -Name $expected[$name] }
            $allExports = @{}
            foreach ($k in $graph.Keys) {
                Import-Module (Join-Path $libDir "Backup$k.psm1") -DisableNameChecking
                foreach ($fn in (Get-Module ("Backup$k") | Select-Object -First 1).ExportedFunctions.Keys) { $allExports[$fn] = $k }
            }
            $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $commandsDir $name), [ref]$null, [ref]$null)
            $used = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ } | Select-Object -Unique
            $missing = @($used | Where-Object { $allExports.ContainsKey($_) -and ($closure -notcontains $allExports[$_]) })
            $missing | Should BeNullOrEmpty
        }
    }

    It 'sin -ConfigPath válido el entrypoint (proceso nuevo, con recarga real) termina con exit 3' {
        $missingCfg = Join-Path ([System.IO.Path]::GetTempPath()) ('no-existe-' + [guid]::NewGuid().ToString('N') + '\config.json')
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $commandsDir 'Start-DaubertPostgresBackup.ps1') -Tier Frequent -ConfigPath $missingCfg 2>&1 | Out-Null
        $LASTEXITCODE | Should Be 3
    }

    It 'Register/Install-Prerequisites/Test-Environment cargan sus módulos en un proceso nuevo (rutas de import correctas)' {
        $bad = Join-Path ([System.IO.Path]::GetTempPath()) ('no-existe-' + [guid]::NewGuid().ToString('N') + '.json')
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $commandsDir 'Register-DaubertBackupTasks.ps1') -ConfigPath $bad 2>&1 | Out-Null
        $LASTEXITCODE | Should Be 3
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $commandsDir 'Install-DaubertBackupPrerequisites.ps1') -ManifestPath $bad -CheckOnly 2>&1 | Out-Null
        $LASTEXITCODE | Should Be 2
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $commandsDir 'Test-DaubertBackupEnvironment.ps1') -ConfigPath $bad 2>&1 | Out-Null
        $LASTEXITCODE | Should Be 2
    }
}

Describe 'El entrypoint sigue ejecutando FREQUENT, DAILY y MONTHLY (in-process, procesos externos mockeados)' {

    BeforeAll {
        # Se cargan UNA vez (recargar entre pruebas invalidaria los mocks de Pester).
        Import-Module (Join-Path $libDir 'BackupConfig.psm1') -Force
        Import-Module (Join-Path $libDir 'BackupLocalConfig.psm1') -Force
        Import-Module (Join-Path $libDir 'BackupPipeline.psm1') -Force
    }

    BeforeEach {
        Reset-ProcessSim
        Mock Invoke-ExternalProcess { Invoke-FakePgProcess -FilePath $FilePath -ArgumentList $ArgumentList -EnvironmentVariables $EnvironmentVariables } -ModuleName BackupPgTools
        Mock Invoke-AgeProcess { Invoke-FakeAgeProcess -AgePath $AgePath -ArgumentList $ArgumentList } -ModuleName BackupEncryption
        Mock Invoke-SevenZipProcess { Invoke-FakeSevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory } -ModuleName BackupPackaging
        Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig

        $script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-reload-e2e-' + [guid]::NewGuid().ToString('N'))
        $script:w = @{
            Backup = (Join-Path $script:root 'backups'); Staging = (Join-Path $script:root 'staging'); Logs = (Join-Path $script:root 'logs'); Locks = (Join-Path $script:root 'locks')
            Rec = (Join-Path $script:root 'cfg\age-recipients.txt'); Pgpass = (Join-Path $script:root 'secrets\pgpass-backup.conf'); Cfg = (Join-Path $script:root 'cfg\config.json')
            PgBin = (Join-Path $script:root 'herramientas\pg'); Sz = (Join-Path $script:root 'herramientas\empaquetador'); Age = (Join-Path $script:root 'herramientas\cifrador')
        }
        New-Item -ItemType Directory -Path $script:w.Backup, (Split-Path -Parent $script:w.Rec), (Split-Path -Parent $script:w.Pgpass) -Force | Out-Null
        Set-Content -LiteralPath $script:w.Rec -Value 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqxyz123' -Encoding ASCII
        Set-Content -LiteralPath $script:w.Pgpass -Value 'placeholder-no-secret' -Encoding UTF8
        Clear-FakeTools
        Add-FakePgToolset -BinDir $script:w.PgBin | Out-Null
        Add-FakeTool -Path $script:w.Sz, $script:w.Age
        $cfg = New-LocalBackupConfigObject -PostgresBin $script:w.PgBin -SevenZipPath $script:w.Sz -AgePath $script:w.Age -RecipientsFilePath $script:w.Rec -PgPassFile $script:w.Pgpass `
            -BackupRoot $script:w.Backup -StagingRoot $script:w.Staging -LogRoot $script:w.Logs -LockRoot $script:w.Locks
        Write-LocalBackupConfig -Path $script:w.Cfg -Config $cfg | Out-Null
        $script:savedNoReload = $env:DAUBERT_BACKUP_NO_RELOAD
        $env:DAUBERT_BACKUP_NO_RELOAD = '1'   # solo pruebas: conserva los módulos con mocks (por defecto SIEMPRE se recarga)
    }
    AfterEach {
        $env:DAUBERT_BACKUP_NO_RELOAD = $script:savedNoReload
        Remove-Item -LiteralPath $script:root -Recurse -Force -ErrorAction SilentlyContinue
        Clear-FakeTools
    }

    function Invoke-Start {
        param([string]$Tier)
        $global:LASTEXITCODE = $null
        & (Join-Path $commandsDir 'Start-DaubertPostgresBackup.ps1') -Tier $Tier -ConfigPath $script:w.Cfg -DryRun -Now ([datetime]'2026-09-28T14:00:07') 2>$null | Out-Null
        return $LASTEXITCODE
    }

    It 'FREQUENT: exit 0, solo pg_dump' {
        (Invoke-Start 'Frequent') | Should Be 0
        @(Get-SimCalls 'pg_dump').Count | Should Be 1
        @(Get-SimCalls 'pg_dumpall').Count | Should Be 0
    }

    It 'DAILY: exit 0, dump + schema-only y bundle, sin pg_dumpall' {
        (Invoke-Start 'Daily') | Should Be 0
        @(Get-SimCalls 'pg_dump').Count | Should Be 2
        @(Get-SimCalls '7z').Count | Should Be 1
        @(Get-SimCalls 'pg_dumpall').Count | Should Be 0
    }

    It 'MONTHLY: exit 0, con pg_dumpall sanitizado (-l, --no-role-passwords) y bundle de tres artefactos' {
        (Invoke-Start 'Monthly') | Should Be 0
        $a = @(Get-SimCalls 'pg_dumpall')[0].Args
        ($a -contains '--no-role-passwords') | Should Be $true
        (Get-ArgumentAfter $a '-l') | Should Be 'daubert_global'
        $z = @(Get-SimCalls '7z')[0].Args
        @($z[5..($z.Count - 1)]).Count | Should Be 3
    }

    It 'no se generan ejecutables ni se compila código en el cargador ni en los comandos' {
        foreach ($f in @(Get-Item -LiteralPath $loader) + @(Get-ChildItem -LiteralPath $commandsDir -Filter '*.ps1')) {
            (Get-Content -LiteralPath $f.FullName -Raw) | Should Not Match ('(?i)Add' + '-Type|csc' + '\.exe')
        }
        @(Get-ChildItem -LiteralPath $moduleRoot -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.cs' }).Count | Should Be 0
    }
}
