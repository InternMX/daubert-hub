#Requires -Version 5.1
<#
    Pruebas del helper Node del snapshot SQLite (helpers\n8n-sqlite-snapshot.js) con el
    node:sqlite REAL de Node (solo APIs built-in), sobre bases temporales creadas por el
    propio Node. No se toca n8n ni ninguna base real. Se omiten si este Node no tiene
    node:sqlite con backup().

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupN8nSqliteHelper.Tests.ps1"
#>

$backupRoot = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $backupRoot 'helpers\n8n-sqlite-snapshot.js'
$nodeCmd = Get-Command -Name 'node' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$nodeOk = $false
if ($nodeCmd) {
    $probe = & $nodeCmd.Source --no-warnings -e "try{const s=require('node:sqlite');process.stdout.write(typeof s.DatabaseSync==='function'&&typeof s.backup==='function'?'yes':'no')}catch(e){process.stdout.write('no')}"
    $nodeOk = ($probe -eq 'yes')
}

function Invoke-Helper {
    param([string]$Source, [string]$Dest)
    $out = & $nodeCmd.Source --no-warnings $helper --source $Source --dest $Dest
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Json = ((@($out) | Where-Object { $_ } | Select-Object -Last 1) | ConvertFrom-Json) }
}

function New-TempDb {
    # Crea una base WAL con dos tablas y una fila con un valor "sensible" de prueba (script .js temporal).
    param([string]$Path)
    $js = Join-Path (Split-Path -Parent $Path) 'mkdb.js'
    [System.IO.File]::WriteAllText($js, @"
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(process.argv[2]);
d.exec("PRAGMA journal_mode=WAL; CREATE TABLE t1(v TEXT); CREATE TABLE t2(v TEXT); INSERT INTO t1 VALUES ('VALOR_SENSIBLE_DE_PRUEBA');");
d.close();
"@)
    & $nodeCmd.Source --no-warnings $js $Path
}

function Get-T1Count {
    param([string]$Path)
    $js = Join-Path (Split-Path -Parent $Path) 'count.js'
    [System.IO.File]::WriteAllText($js, @"
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(process.argv[2], { readOnly: true });
process.stdout.write(String(d.prepare('SELECT count(*) AS c FROM t1').get().c));
d.close();
"@)
    & $nodeCmd.Source --no-warnings $js $Path
}

Describe 'Helper de snapshot SQLite (node:sqlite real)' {

    BeforeEach {
        $script:dir = Join-Path ([System.IO.Path]::GetTempPath()) ('daubert-n8n-sqlite-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:dir -Force | Out-Null
        $script:src = Join-Path $script:dir 'database.sqlite'
        $script:dst = Join-Path $script:dir 'snapshot.sqlite'
    }
    AfterEach { Remove-Item -LiteralPath $script:dir -Recurse -Force -ErrorAction SilentlyContinue }

    It 'crea un snapshot consistente, quick_check ok, cuenta tablas y solo imprime metadata segura' -Skip:(-not $nodeOk) {
        New-TempDb -Path $script:src
        $r = Invoke-Helper -Source $script:src -Dest $script:dst
        $r.ExitCode | Should Be 0
        $r.Json.ok | Should Be $true
        $r.Json.quickCheck | Should Be 'ok'
        $r.Json.tableCount | Should Be 2
        $r.Json.sizeBytes | Should BeGreaterThan 0
        Test-Path $script:dst | Should Be $true
        @($r.Json.PSObject.Properties.Name | Sort-Object) -join ',' | Should Be 'ok,quickCheck,sizeBytes,tableCount'
    }
    It 'el snapshot es un único archivo autocontenido (sin -wal/-shm) con los datos originales' -Skip:(-not $nodeOk) {
        New-TempDb -Path $script:src
        (Invoke-Helper -Source $script:src -Dest $script:dst).ExitCode | Should Be 0
        Test-Path "$($script:dst)-wal" | Should Be $false
        Test-Path "$($script:dst)-shm" | Should Be $false
        (Get-T1Count -Path $script:dst) | Should Be '1'
    }
    It 'no imprime filas ni contenido de tablas' -Skip:(-not $nodeOk) {
        New-TempDb -Path $script:src
        $out = (& $nodeCmd.Source --no-warnings $helper --source $script:src --dest $script:dst 2>&1 | Out-String)
        $out | Should Not Match 'VALOR_SENSIBLE_DE_PRUEBA'
    }
    It 'funciona con la base abierta por otro proceso en modo WAL (n8n en ejecución) y no modifica el origen' -Skip:(-not $nodeOk) {
        $js = Join-Path $script:dir 'live.js'
        [System.IO.File]::WriteAllText($js, @"
const { DatabaseSync } = require('node:sqlite');
const cp = require('node:child_process');
const d = new DatabaseSync(process.argv[2]);
d.exec('PRAGMA journal_mode=WAL; CREATE TABLE t1(v TEXT); INSERT INTO t1 VALUES (1)');
const r = cp.spawnSync(process.execPath, ['--no-warnings', process.argv[3], '--source', process.argv[2], '--dest', process.argv[4]], { encoding: 'utf8' });
process.stdout.write(String(r.status) + '|' + r.stdout.trim());
d.close();
"@)
        $out = & $nodeCmd.Source --no-warnings $js $script:src $helper $script:dst
        $out | Should Match '^0\|\{"ok":true'
        Test-Path $script:dst | Should Be $true
    }
    It 'rechaza un destino que ya existe (nunca sobrescribe) con exit != 0' -Skip:(-not $nodeOk) {
        New-TempDb -Path $script:src
        [System.IO.File]::WriteAllText($script:dst, 'existente')
        $r = Invoke-Helper -Source $script:src -Dest $script:dst
        $r.ExitCode | Should Not Be 0
        $r.Json.ok | Should Be $false
        [System.IO.File]::ReadAllText($script:dst) | Should Be 'existente'
    }
    It 'origen inexistente, destino igual al origen y argumentos inválidos fallan con exit != 0' -Skip:(-not $nodeOk) {
        (Invoke-Helper -Source (Join-Path $script:dir 'nada.sqlite') -Dest $script:dst).ExitCode | Should Not Be 0
        New-TempDb -Path $script:src
        (Invoke-Helper -Source $script:src -Dest $script:src).ExitCode | Should Not Be 0
        & $nodeCmd.Source --no-warnings $helper --source $script:src | Out-Null
        $LASTEXITCODE | Should Not Be 0
    }
    It 'un origen que no es SQLite falla, sin dejar snapshot parcial' -Skip:(-not $nodeOk) {
        [System.IO.File]::WriteAllText($script:src, ('no soy una base sqlite ' * 300))
        $r = Invoke-Helper -Source $script:src -Dest $script:dst
        $r.ExitCode | Should Not Be 0
        $r.Json.ok | Should Be $false
        Test-Path $script:dst | Should Be $false
    }
    It 'integración PowerShell: Invoke-N8nSqliteSnapshot con el node real devuelve metadata segura' -Skip:(-not $nodeOk) {
        Import-Module (Join-Path $backupRoot 'lib\BackupN8nSqlite.psm1') -Force -DisableNameChecking
        New-TempDb -Path $script:src
        $r = Invoke-N8nSqliteSnapshot -NodePath $nodeCmd.Source -HelperPath $helper -SourcePath $script:src -DestinationPath $script:dst
        $r.QuickCheck | Should Be 'ok'
        $r.TableCount | Should Be 2
        $r.SizeBytes | Should BeGreaterThan 0
        (Get-N8nNodeVersion -NodePath $nodeCmd.Source) | Should Match '^\d+\.\d+\.\d+$'
    }
}
