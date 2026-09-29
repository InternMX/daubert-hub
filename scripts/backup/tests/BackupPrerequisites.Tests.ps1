#Requires -Version 5.1
<#
    Pruebas de la gestión declarativa de dependencias (dependencies.json +
    BackupPrerequisites.psm1 + Install-DaubertBackupPrerequisites.ps1).

    Todo mockeado con los seams del módulo: no se ejecuta winget, no se instala
    nada, no se crean ejecutables falsos ni se compila código. Los procesos de
    consulta de versión y de winget son simulaciones (Invoke-PrerequisiteProcess
    / Invoke-WingetInstall / Get-WingetCommandPath / Get-InstalledModuleVersion)
    y la existencia de herramientas usa Test-BackupToolPath mockeado.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupPrerequisites.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'helpers\TestDoubles.ps1')
foreach ($m in 'BackupConfig', 'BackupPrerequisites') { Import-Module (Join-Path $moduleRoot "lib\$m.psm1") -Force }
$global:RealManifestPath = Join-Path $moduleRoot 'config\dependencies.json'

function Reset-PreSim {
    Clear-FakeTools
    $global:PreSim = @{
        AgePath = $null; AgeOut = 'v1.3.1'
        SevenZipPath = $null; SevenZipOut = '7-Zip 24.08 (x64) : Copyright (c) 1999-2024 Igor Pavlov'
        PgBin = $null; PgVersion = '18.1'; PgExes = @('pg_dump.exe', 'pg_restore.exe', 'pg_dumpall.exe')
        Winget = $null; WingetExit = 0; OnInstall = @{}
        Modules = @('3.4.0')
        PgInstalls = $null; Calls = (New-Object 'System.Collections.Generic.List[object]')
    }
}

function Set-PreSimHealthy {
    $root = Join-Path $env:SystemDrive 'herramientas-simuladas'   # solo cadenas: nada se crea en disco
    $global:PreSim.AgePath = Join-Path $root 'age\age.exe'; Add-FakeTool -Path $global:PreSim.AgePath
    $global:PreSim.SevenZipPath = Join-Path $root 'zip\7z.exe'; Add-FakeTool -Path $global:PreSim.SevenZipPath
    $global:PreSim.PgBin = Join-Path $root 'pg\bin'
    foreach ($e in $global:PreSim.PgExes) { Add-FakeTool -Path (Join-Path $global:PreSim.PgBin $e) }
}

function Get-Manifest { (Read-DependencyManifest -Path $global:RealManifestPath).Manifest }
function Get-Status { param([string]$Id) Get-DependencyStatus -Dependency (@((Get-Manifest).dependencies) | Where-Object { $_.id -eq $Id }) -PowerShellVersion ([version]'5.1.26100.0') }

function Register-PreMocks {
    Mock Find-AgePath { $global:PreSim.AgePath } -ModuleName BackupPrerequisites
    Mock Find-SevenZipPath { $global:PreSim.SevenZipPath } -ModuleName BackupPrerequisites
    Mock Get-PostgresInstallations {
        if ($global:PreSim.PgInstalls) { return @($global:PreSim.PgInstalls) }
        if (-not $global:PreSim.PgBin) { return @() }
        $req = @($RequiredExecutables)
        $present = @($req | Where-Object { Test-FakeToolPath -Path (Join-Path $global:PreSim.PgBin $_) })
        $missing = @($req | Where-Object { $present -notcontains $_ })
        return @([pscustomobject]@{ Label = 'sim'; Version = $null; Bin = $global:PreSim.PgBin; Present = $present; Missing = $missing; IsComplete = ($missing.Count -eq 0) })
    } -ModuleName BackupPrerequisites
    Mock Test-BackupToolPath { Test-FakeToolPath -Path $Path } -ModuleName BackupPrerequisites
    Mock Get-InstalledModuleVersion { $global:PreSim.Modules } -ModuleName BackupPrerequisites
    Mock Get-WingetCommandPath { $global:PreSim.Winget } -ModuleName BackupPrerequisites
    Mock Invoke-PrerequisiteProcess {
        $global:PreSim.Calls.Add([pscustomobject]@{ File = $FilePath; Args = @($ArgumentList) })
        $leaf = (Split-Path -Leaf $FilePath).ToLowerInvariant()
        switch ($leaf) {
            'age.exe' { return [pscustomobject]@{ ExitCode = 0; StdOut = $global:PreSim.AgeOut; StdErr = '' } }
            '7z.exe' { return [pscustomobject]@{ ExitCode = 0; StdOut = $global:PreSim.SevenZipOut; StdErr = '' } }
            'pg_dump.exe' { return [pscustomobject]@{ ExitCode = 0; StdOut = "pg_dump (PostgreSQL) $($global:PreSim.PgVersion)"; StdErr = '' } }
            default { return [pscustomobject]@{ ExitCode = 0; StdOut = ''; StdErr = '' } }
        }
    } -ModuleName BackupPrerequisites
    Mock Invoke-WingetInstall {
        $global:PreSim.Calls.Add([pscustomobject]@{ File = 'winget'; Args = @('install', $PackageId) })
        if ($global:PreSim.WingetExit -eq 0 -and $global:PreSim.OnInstall.ContainsKey($PackageId)) { & $global:PreSim.OnInstall[$PackageId] }
        [pscustomobject]@{ ExitCode = $global:PreSim.WingetExit; StdOut = ''; StdErr = '' }
    } -ModuleName BackupPrerequisites
}

function Get-CodeOnly {
    # Código sin comentarios (bloques <# #> y líneas #), para comprobar que no hay usos reales.
    param([string]$Path)
    $s = [System.IO.File]::ReadAllText($Path)
    $s = [regex]::Replace($s, '(?s)<#.*?#>', '')
    (($s -split "
?
") | Where-Object { $_ -notmatch '^\s*#' }) -join "
"
}

function Get-WingetCalls { @($global:PreSim.Calls | Where-Object { $_.File -eq 'winget' }) }

Describe 'dependencies.json - manifest declarativo' {

    It 'el manifest real existe, es JSON válido y pasa la validación de esquema' {
        $r = Read-DependencyManifest -Path $global:RealManifestPath
        $r.Errors | Should BeNullOrEmpty
        $r.IsValid | Should Be $true
    }

    It 'declara las dependencias mínimas: age, 7-Zip, PostgreSQL client tools (3 ejecutables), PowerShell y Pester (solo desarrollo)' {
        $deps = @((Get-Manifest).dependencies)
        (@($deps | Where-Object { $_.scope -eq 'production' } | ForEach-Object { $_.id }) | Sort-Object) | Should Be @('7zip', 'age', 'postgresql-client', 'windows-powershell')
        (@($deps | Where-Object { $_.scope -eq 'development' } | ForEach-Object { $_.id })) | Should Be @('pester')
        $pg = $deps | Where-Object { $_.id -eq 'postgresql-client' }
        ($pg.detect.requiredExecutables | Sort-Object) | Should Be @('pg_dump.exe', 'pg_dumpall.exe', 'pg_restore.exe')
    }

    It 'age: winget FiloSottile.age, versión validada 1.3.1 registrada como informativa (sin pin rígido)' {
        $age = @((Get-Manifest).dependencies) | Where-Object { $_.id -eq 'age' }
        $age.install.method | Should Be 'winget'
        $age.install.packageId | Should Be 'FiloSottile.age'
        $age.validatedVersion | Should Be '1.3.1'
        $age.PSObject.Properties['requiredVersion'] | Should BeNullOrEmpty
        [version]$age.minimumVersion | Should BeLessThan ([version]'1.3.1')
    }

    It 'PostgreSQL client tools no tiene instalación automática inventada (manual con instrucciones) y Pester es exacto 3.4.0' {
        $deps = @((Get-Manifest).dependencies)
        ($deps | Where-Object { $_.id -eq 'postgresql-client' }).install.method | Should Be 'manual'
        ($deps | Where-Object { $_.id -eq 'pester' }).requiredVersion | Should Be '3.4.0'
    }

    It 'el manifest no contiene rutas personales, unidades, versiones de PostgreSQL fijas en rutas ni secretos' {
        $raw = Get-Content -LiteralPath $global:RealManifestPath -Raw
        $raw | Should Not Match ('Users' + '[\\/]0' + '6')
        $raw | Should Not Match '[A-Za-z]:\\'
        $raw | Should Not Match '(?i)WinGet\\(Packages|Links)'
        $raw | Should Not Match '(?i)"[^"]*(password|secret|token|apikey)[^"]*"\s*:'
        $raw | Should Not Match '(?i)Program Files'
    }

    It 'los package IDs de winget declarados tienen formato Publisher.Package' {
        foreach ($d in @((Get-Manifest).dependencies)) { if ($d.install.method -eq 'winget') { $d.install.packageId | Should Match '^[A-Za-z0-9]+(\.[A-Za-z0-9_\-]+)+$' } }
    }

    Context 'manifest inválido' {
        BeforeEach { $script:tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-manifest-' + [guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $script:tmp | Out-Null }
        AfterEach { Remove-Item -LiteralPath $script:tmp -Recurse -Force -ErrorAction SilentlyContinue }

        function Test-Mutation { param([scriptblock]$Change)
            $m = Get-Content -LiteralPath $global:RealManifestPath -Raw | ConvertFrom-Json
            & $Change $m
            $p = Join-Path $script:tmp 'm.json'
            [System.IO.File]::WriteAllText($p, ($m | ConvertTo-Json -Depth 10))
            Read-DependencyManifest -Path $p
        }

        It 'archivo inexistente' { (Read-DependencyManifest -Path (Join-Path $script:tmp 'no.json')).IsValid | Should Be $false }
        It 'JSON roto' {
            $p = Join-Path $script:tmp 'roto.json'; Set-Content -LiteralPath $p -Value '{ no es json' -Encoding UTF8
            $r = Read-DependencyManifest -Path $p; $r.IsValid | Should Be $false; ($r.Errors -join ' ') | Should Match 'JSON'
        }
        It 'schemaVersion incorrecto' { (Test-Mutation { param($m) $m.schemaVersion = 2 }).IsValid | Should Be $false }
        It 'lista de dependencias vacía' { (Test-Mutation { param($m) $m.dependencies = @() }).IsValid | Should Be $false }
        It 'id duplicado' { (Test-Mutation { param($m) $m.dependencies[1].id = 'age'; $m.dependencies[2].id = 'age' }).IsValid | Should Be $false }
        It 'packageId de winget con formato inválido (no se inventan IDs)' {
            $r = Test-Mutation { param($m) ($m.dependencies | Where-Object { $_.id -eq 'age' }).install.packageId = 'sinpunto' }
            $r.IsValid | Should Be $false
        }
        It 'método winget sin packageId' {
            $r = Test-Mutation { param($m) ($m.dependencies | Where-Object { $_.id -eq 'age' }).install.PSObject.Properties.Remove('packageId') }
            $r.IsValid | Should Be $false
        }
        It 'método manual sin instrucciones' {
            $r = Test-Mutation { param($m) ($m.dependencies | Where-Object { $_.id -eq 'postgresql-client' }).install.PSObject.Properties.Remove('instructions') }
            $r.IsValid | Should Be $false
        }
        It 'método de instalación desconocido' {
            (Test-Mutation { param($m) ($m.dependencies | Where-Object { $_.id -eq 'age' }).install.method = 'curl-bash' }).IsValid | Should Be $false
        }
        It 'scope desconocido' { (Test-Mutation { param($m) $m.dependencies[1].scope = 'staging' }).IsValid | Should Be $false }
        It 'versión mínima inválida' { (Test-Mutation { param($m) ($m.dependencies | Where-Object { $_.id -eq 'age' }).minimumVersion = 'abc' }).IsValid | Should Be $false }
        It 'ruta absoluta dentro del manifest' {
            $r = Test-Mutation { param($m) ($m.dependencies | Where-Object { $_.id -eq 'age' }).description = ('ver ' + 'C:' + '\\herramientas\\age.exe') }
            $r.IsValid | Should Be $false
        }
        It 'clave con aspecto de secreto' {
            $r = Test-Mutation { param($m) $m | Add-Member -NotePropertyName apiToken -NotePropertyValue 'x' }
            $r.IsValid | Should Be $false
        }
    }
}

Describe 'Estado de dependencias (detección; sin instalar)' {

    BeforeEach { Reset-PreSim; Register-PreMocks }
    AfterEach { Clear-FakeTools }

    It 'age instalado en la versión validada -> Present y coincide con la validada' {
        Set-PreSimHealthy
        $s = Get-Status 'age'
        $s.Status | Should Be 'Present'
        $s.Version | Should Be '1.3.1'
        $s.MatchesValidated | Should Be $true
    }

    It 'age en otra versión compatible (1.1.5) -> Present, no coincide con la validada (sin pin rígido)' {
        Set-PreSimHealthy; $global:PreSim.AgeOut = 'v1.1.5'
        $s = Get-Status 'age'
        $s.Status | Should Be 'Present'
        $s.MatchesValidated | Should Be $false
    }

    It 'age por debajo de la mínima -> Incompatible' {
        Set-PreSimHealthy; $global:PreSim.AgeOut = 'v1.0.0'
        (Get-Status 'age').Status | Should Be 'Incompatible'
    }

    It 'age ausente -> Missing' {
        (Get-Status 'age').Status | Should Be 'Missing'
    }

    It '7-Zip presente y ausente' {
        (Get-Status '7zip').Status | Should Be 'Missing'
        Set-PreSimHealthy
        $s = Get-Status '7zip'
        $s.Status | Should Be 'Present'
        $s.Version | Should Be '24.08'
    }

    It 'PostgreSQL tools detectados en una versión distinta (16 vs 18 validada) -> Present y se reutilizan' {
        Set-PreSimHealthy; $global:PreSim.PgVersion = '16.4'
        $s = Get-Status 'postgresql-client'
        $s.Status | Should Be 'Present'
        $s.Version | Should Be '16.4'
        $s.MatchesValidated | Should Be $false
    }

    It 'PostgreSQL tools con los tres ejecutables en la versión validada -> coincide' {
        Set-PreSimHealthy
        (Get-Status 'postgresql-client').MatchesValidated | Should Be $true
    }

    It 'PostgreSQL tools por debajo de la mínima (12) -> Incompatible' {
        Set-PreSimHealthy; $global:PreSim.PgVersion = '12.9'
        (Get-Status 'postgresql-client').Status | Should Be 'Incompatible'
    }

    It 'PostgreSQL con pg_dump pero sin pg_dumpall -> Incompatible, indicando qué falta' {
        Set-PreSimHealthy
        Remove-FakeTool -Path (Join-Path $global:PreSim.PgBin 'pg_dumpall.exe')
        $s = Get-Status 'postgresql-client'
        $s.Status | Should Be 'Incompatible'
        $s.Detail | Should Match 'pg_dumpall'
    }

    It 'PostgreSQL ausente -> Missing' {
        (Get-Status 'postgresql-client').Status | Should Be 'Missing'
    }

    It 'Windows PowerShell: 5.1 cumple; 4.0 es Incompatible' {
        (Get-DependencyStatus -Dependency (@((Get-Manifest).dependencies) | Where-Object { $_.id -eq 'windows-powershell' }) -PowerShellVersion ([version]'5.1.19041.0')).Status | Should Be 'Present'
        (Get-DependencyStatus -Dependency (@((Get-Manifest).dependencies) | Where-Object { $_.id -eq 'windows-powershell' }) -PowerShellVersion ([version]'4.0')).Status | Should Be 'Incompatible'
    }

    It 'Pester: 3.4.0 instalado -> Present; solo 5.x -> Incompatible; ninguno -> Missing' {
        (Get-Status 'pester').Status | Should Be 'Present'
        $global:PreSim.Modules = @('5.5.0'); (Get-Status 'pester').Status | Should Be 'Incompatible'
        $global:PreSim.Modules = @(); (Get-Status 'pester').Status | Should Be 'Missing'
    }

    It 'si no se puede determinar la versión de una herramienta presente, se acepta (Present) indicándolo' {
        Set-PreSimHealthy; $global:PreSim.AgeOut = 'salida sin version'
        $s = Get-Status 'age'
        $s.Status | Should Be 'Present'
        $s.Detail | Should Match 'no determinada'
    }
}

Describe 'Install-BackupPrerequisites (idempotente; winget mockeado)' {

    BeforeEach { Reset-PreSim; Register-PreMocks; $script:m = Get-Manifest; $script:ps = [version]'5.1.26100.0' }
    AfterEach { Clear-FakeTools }

    function Get-Result { param($Results, [string]$Id) @($Results) | Where-Object { $_.Id -eq $Id } }

    It 'dependencia ya instalada: Satisfied, sin llamar a winget (no reinstala) y repetir no cambia nada (idempotente)' {
        Set-PreSimHealthy; $global:PreSim.Winget = 'winget-simulado'
        1..2 | ForEach-Object {
            $r = @(Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps)
            (@($r | Where-Object { $_.Result -eq 'Satisfied' })).Count | Should Be 4
        }
        @(Get-WingetCalls).Count | Should Be 0
    }

    It 'dependencia ausente + winget disponible: instala con el packageId del manifest y verifica' {
        Set-PreSimHealthy
        Remove-FakeTool -Path $global:PreSim.AgePath; $agePath = $global:PreSim.AgePath; $global:PreSim.AgePath = $null
        $global:PreSim.Winget = 'winget-simulado'
        $global:PreSim.OnInstall['FiloSottile.age'] = { $global:PreSim.AgePath = $agePath; Add-FakeTool -Path $agePath }.GetNewClosure()
        $r = Get-Result (Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps) 'age'
        $r.Result | Should Be 'Installed'
        $r.Before | Should Be 'Missing'
        @(Get-WingetCalls).Count | Should Be 1
        @(Get-WingetCalls)[0].Args[1] | Should Be 'FiloSottile.age'
    }

    It 'dependencia ausente + winget AUSENTE: ManualRequired con instrucción clara, sin intentar instalar' {
        Set-PreSimHealthy; $global:PreSim.AgePath = $null
        $r = Get-Result (Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps) 'age'
        $r.Result | Should Be 'ManualRequired'
        $r.Detail | Should Match 'winget'
        $r.Instructions | Should Match 'FiloSottile\.age'
        @(Get-WingetCalls).Count | Should Be 0
    }

    It 'instalación fallida (winget devuelve error): Failed con instrucción de reintento' {
        Set-PreSimHealthy; $global:PreSim.AgePath = $null; $global:PreSim.Winget = 'winget-simulado'; $global:PreSim.WingetExit = 1
        $r = Get-Result (Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps) 'age'
        $r.Result | Should Be 'Failed'
        $r.Instructions | Should Match 'winget install --id FiloSottile\.age'
    }

    It 'winget termina bien pero la herramienta aún no se detecta: Failed pidiendo nueva sesión' {
        Set-PreSimHealthy; $global:PreSim.AgePath = $null; $global:PreSim.Winget = 'winget-simulado'
        $r = Get-Result (Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps) 'age'
        $r.Result | Should Be 'Failed'
        $r.Instructions | Should Match 'nueva sesión'
    }

    It '-WhatIf: informa lo que instalaría (Planned) y NO llama a winget' {
        Set-PreSimHealthy; $global:PreSim.AgePath = $null; $global:PreSim.SevenZipPath = $null; $global:PreSim.Winget = 'winget-simulado'
        $r = @(Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps -WhatIf)
        (Get-Result $r 'age').Result | Should Be 'Planned'
        (Get-Result $r '7zip').Result | Should Be 'Planned'
        @(Get-WingetCalls).Count | Should Be 0
    }

    It '-CheckOnly nunca instala (ManualRequired con el comando sugerido)' {
        Set-PreSimHealthy; $global:PreSim.AgePath = $null; $global:PreSim.Winget = 'winget-simulado'
        $r = Get-Result (Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps -CheckOnly) 'age'
        $r.Result | Should Be 'ManualRequired'
        @(Get-WingetCalls).Count | Should Be 0
    }

    It 'PostgreSQL client ausente: NUNCA se instala con winget (no hay ID confiable); instrucción manual' {
        Set-PreSimHealthy; $global:PreSim.PgBin = $null; $global:PreSim.Winget = 'winget-simulado'
        $r = Get-Result (Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps) 'postgresql-client'
        $r.Result | Should Be 'ManualRequired'
        $r.Instructions | Should Match 'postgresql\.org'
        @(Get-WingetCalls).Count | Should Be 0
    }

    It 'PostgreSQL client existente (versión distinta a la validada) se reutiliza: Satisfied' {
        Set-PreSimHealthy; $global:PreSim.PgVersion = '15.8'; $global:PreSim.Winget = 'winget-simulado'
        $r = Get-Result (Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps) 'postgresql-client'
        $r.Result | Should Be 'Satisfied'
        @(Get-WingetCalls).Count | Should Be 0
    }

    It 'ámbitos: Production no incluye Pester; Development solo Pester; All incluye las 5' {
        Set-PreSimHealthy
        (@(Install-BackupPrerequisites -Manifest $script:m -Scope Production -PowerShellVersion $script:ps | ForEach-Object { $_.Id }) -contains 'pester') | Should Be $false
        @(Install-BackupPrerequisites -Manifest $script:m -Scope Development -PowerShellVersion $script:ps | ForEach-Object { $_.Id }) | Should Be @('pester')
        @(Install-BackupPrerequisites -Manifest $script:m -Scope All -PowerShellVersion $script:ps).Count | Should Be 5
    }

    It 'Pester ausente (desarrollo): ManualRequired con el comando de Install-Module, sin winget' {
        Set-PreSimHealthy; $global:PreSim.Modules = @(); $global:PreSim.Winget = 'winget-simulado'
        $r = Get-Result (Install-BackupPrerequisites -Manifest $script:m -Scope Development -PowerShellVersion $script:ps) 'pester'
        $r.Result | Should Be 'ManualRequired'
        $r.Instructions | Should Match 'Install-Module Pester -RequiredVersion 3\.4\.0'
    }

    It 'ningún comando ni resultado contiene secretos ni rutas personales; winget se invoca solo con el ID' {
        Set-PreSimHealthy; $global:PreSim.AgePath = $null; $global:PreSim.Winget = 'winget-simulado'
        $r = @(Install-BackupPrerequisites -Manifest $script:m -Scope All -PowerShellVersion $script:ps)
        $text = ($global:PreSim.Calls | ForEach-Object { ($_.File + ' ' + ($_.Args -join ' ')) }) -join "`n"
        $text += "`n" + (($r | ConvertTo-Json -Depth 5))
        $text | Should Not Match '(?i)password|passwd|secret|token|PGPASSWORD|AGE-SECRET'
        $text | Should Not Match ('Users' + '[\\/]0' + '6')
    }

    It 'el módulo no pide ni maneja secretos (sin Read-Host, SecureString, PGPASS)' {
        $src = Get-CodeOnly (Join-Path $moduleRoot 'lib\BackupPrerequisites.psm1')
        $src | Should Not Match 'Read-Host|SecureString|PGPASS|Get-Credential'
        $src | Should Not Match '(?i)Register-ScheduledTask|Unregister-ScheduledTask|psql|n8n|Dropbox'
    }
}

Describe 'Install-DaubertBackupPrerequisites.ps1 (script)' {

    $script:cmd = Join-Path $moduleRoot 'commands\Install-DaubertBackupPrerequisites.ps1'

    It 'existe en commands/, soporta -WhatIf, -CheckOnly y -Scope; sin parámetros de secretos' {
        $keys = (Get-Command $script:cmd).Parameters.Keys
        foreach ($k in 'WhatIf', 'CheckOnly', 'Scope', 'ManifestPath') { ($keys -contains $k) | Should Be $true }
        ($keys | Where-Object { $_ -match '(?i)password|secret|token' }) | Should BeNullOrEmpty
    }

    It 'manifest inexistente -> exit 2' {
        $p = Join-Path ([System.IO.Path]::GetTempPath()) ('no-existe-' + [guid]::NewGuid().ToString('N') + '.json')
        & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script:cmd -ManifestPath $p -CheckOnly 2>&1 | Out-Null
        $LASTEXITCODE | Should Be 2
    }

    It 'manifest inválido -> exit 2 y explica el error' {
        $p = Join-Path ([System.IO.Path]::GetTempPath()) ('manifest-roto-' + [guid]::NewGuid().ToString('N') + '.json')
        Set-Content -LiteralPath $p -Value '{"schemaVersion":1,"dependencies":[{"id":"x","scope":"production","kind":"tool","detect":{"type":"age"},"install":{"method":"winget","packageId":"inventado"}}]}' -Encoding UTF8
        try {
            $out = & (Get-Command powershell.exe).Source -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script:cmd -ManifestPath $p -CheckOnly 2>&1 | Out-String
            $LASTEXITCODE | Should Be 2
            $out | Should Match 'packageId'
        }
        finally { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }
    }

    It 'el script solo depende del manifest y del módulo: sin rutas fijas ni tocar Task Scheduler/PostgreSQL' {
        $src = Get-CodeOnly $script:cmd
        $src | Should Not Match '[A-Za-z]:\\[A-Za-z]'
        $src | Should Not Match '(?i)ScheduledTask|psql|Dropbox|n8n'
    }
}

Describe 'PostgreSQL client tools: se usa la versión más alta COMPLETA y COMPATIBLE (no la más alta detectada)' {

    BeforeEach { Reset-PreSim; Register-PreMocks; $script:base = Join-Path $env:SystemDrive 'instalaciones-simuladas' }
    AfterEach { Clear-FakeTools }

    function New-Inst {
        param([string]$Label, [string]$Version, [string[]]$Missing = @())
        $all = @('pg_dump.exe', 'pg_restore.exe', 'pg_dumpall.exe')
        [pscustomobject]@{ Label = $Label; Version = [version]"$Version.0"; Bin = (Join-Path $script:base "pg$Label\bin"); Present = @($all | Where-Object { $Missing -notcontains $_ }); Missing = $Missing; IsComplete = ($Missing.Count -eq 0) }
    }

    It '18 incompleto (sin pg_dumpall) + 17 completo -> Present y se usa la carpeta de 17' {
        $global:PreSim.PgInstalls = @((New-Inst '18' '18' @('pg_dumpall.exe')), (New-Inst '17' '17'))
        $global:PreSim.PgVersion = '17.4'
        $s = Get-Status 'postgresql-client'
        $s.Status | Should Be 'Present'
        $s.Path | Should Match 'pg17'
        $s.Version | Should Be '17.4'
    }

    It '18 completo + 17 completo -> se usa 18' {
        $global:PreSim.PgInstalls = @((New-Inst '18' '18'), (New-Inst '17' '17'))
        (Get-Status 'postgresql-client').Path | Should Match 'pg18'
    }

    It '18 incompleto + 16 incompleto -> Incompatible con diagnóstico por instalación (versión y herramienta faltante, sin rutas)' {
        $global:PreSim.PgInstalls = @((New-Inst '18' '18' @('pg_dumpall.exe')), (New-Inst '16' '16' @('pg_restore.exe')))
        $s = Get-Status 'postgresql-client'
        $s.Status | Should Be 'Incompatible'
        $s.Detail | Should Match 'PostgreSQL 18 \(falta pg_dumpall'
        $s.Detail | Should Match 'PostgreSQL 16 \(falta pg_restore'
        $s.Detail | Should Not Match 'instalaciones-simuladas'
        $s.Path | Should BeNullOrEmpty
    }

    It '18 incompleto + 13 completo -> Incompatible (13 está por debajo del mínimo 14)' {
        $global:PreSim.PgInstalls = @((New-Inst '18' '18' @('pg_dumpall.exe')), (New-Inst '13' '13'))
        $s = Get-Status 'postgresql-client'
        $s.Status | Should Be 'Incompatible'
        $s.Detail | Should Match 'PostgreSQL 13 \(versión inferior a la mínima'
    }

    It 'sin ninguna instalación -> Missing (comportamiento previo)' {
        $global:PreSim.PgInstalls = $null; $global:PreSim.PgBin = $null
        $s = Get-Status 'postgresql-client'
        $s.Status | Should Be 'Missing'
        $s.Detail | Should Match 'no detectado'
    }

    It 'el instalador de prerequisitos, con 18 incompleto y ninguna otra válida, no usa winget y explica el diagnóstico' {
        Set-PreSimHealthy
        $global:PreSim.PgInstalls = @((New-Inst '18' '18' @('pg_dumpall.exe')))
        $global:PreSim.Winget = 'winget-simulado'
        $r = @(Install-BackupPrerequisites -Manifest (Get-Manifest) -Scope Production -PowerShellVersion ([version]'5.1.26100.0')) | Where-Object { $_.Id -eq 'postgresql-client' }
        $r.Result | Should Be 'ManualRequired'
        $r.Detail | Should Match 'falta pg_dumpall'
        @(Get-WingetCalls).Count | Should Be 0
    }
}
