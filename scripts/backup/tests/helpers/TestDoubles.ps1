# Dobles de prueba compartidos (se cargan con dot-sourcing desde los tests).
#
# Sustituyen a los antiguos ejecutables sintéticos (un binario compilado en
# tiempo de ejecución y copiado con nombres de herramientas reales), que los
# antivirus ponían en cuarentena. Ahora NO se crea, compila ni copia ningún
# ejecutable: las pruebas mockean los tres seams de procesos externos del
# código productivo, que en producción lanzan los binarios reales:
#     Invoke-ExternalProcess  (BackupPgTools)    pg_dump / pg_restore / pg_dumpall
#     Invoke-SevenZipProcess  (BackupPackaging)  7z
#     Invoke-AgeProcess       (BackupEncryption) age
# y el seam de existencia de herramientas Test-BackupToolPath (BackupConfig).
#
# Uso típico dentro de un Describe:
#     BeforeEach {
#         Reset-ProcessSim
#         Mock Invoke-ExternalProcess { Invoke-FakePgProcess -FilePath $FilePath -ArgumentList $ArgumentList -EnvironmentVariables $EnvironmentVariables } -ModuleName BackupPgTools
#         Mock Invoke-AgeProcess      { Invoke-FakeAgeProcess -AgePath $AgePath -ArgumentList $ArgumentList } -ModuleName BackupEncryption
#         Mock Invoke-SevenZipProcess { Invoke-FakeSevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory } -ModuleName BackupPackaging
#         Mock Test-BackupToolPath    { Test-FakeToolPath -Path $Path } -ModuleName BackupConfig
#     }

$global:FakeAgeContent = "age-encryption.org/v1`n-> X25519 abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHI`nsomeMacLineBase64Encoded1234567890==`n" + ('X' * 200)
$global:FakeToolSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

function global:Clear-FakeTools { $global:FakeToolSet.Clear() }
function global:Add-FakeTool { param([string[]]$Path) foreach ($p in $Path) { [void]$global:FakeToolSet.Add($p) } }
function global:Remove-FakeTool { param([string[]]$Path) foreach ($p in $Path) { [void]$global:FakeToolSet.Remove($p) } }
function global:Test-FakeToolPath { param([string]$Path) return $global:FakeToolSet.Contains($Path) }

function global:Add-FakePgToolset {
    <# Registra (solo en memoria) las herramientas de una carpeta bin de PostgreSQL. Devuelve las rutas. #>
    param([string]$BinDir, [string[]]$Names = @('pg_dump.exe', 'pg_restore.exe', 'pg_dumpall.exe', 'pg_isready.exe', 'psql.exe'))
    $paths = $Names | ForEach-Object { Join-Path $BinDir $_ }
    Add-FakeTool -Path $paths
    return $paths
}

function global:Reset-ProcessSim {
    $global:ProcSim = @{
        PgDump    = @{ ExitCode = 0; Mode = 'SUCCESS'; Content = 'FAKE DUMP CONTENT'; StdErr = '' }
        PgRestore = @{ ExitCode = 0; StdOut = "3; 2615 2200 SCHEMA - public postgres`n"; StdErr = '' }
        PgDumpAll = @{ ExitCode = 0; Mode = 'SUCCESS'; Content = 'CREATE ROLE daubert_backup;'; StdErr = '' }
        SevenZip  = @{ ExitCode = 0; Mode = 'SUCCESS'; StdErr = '' }
        Age       = @{ ExitCode = 0; Mode = 'SUCCESS'; Content = $global:FakeAgeContent; StdErr = '' }
        Calls     = (New-Object 'System.Collections.Generic.List[object]')
        # Acción opcional que se ejecuta al inicio de cada llamada a pg_dump (p. ej. para simular concurrencia).
        OnPgDump  = $null
        OnAge     = $null
    }
}

function global:Write-FakeOutputFile {
    # SUCCESS: escribe el contenido; EMPTY_FILE: archivo de 0 bytes; NO_FILE: no crea nada.
    param([string]$Path, [string]$Mode, [string]$Content)
    if (-not $Path -or $Mode -eq 'NO_FILE') { return }
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if ($Mode -eq 'EMPTY_FILE') { [System.IO.File]::WriteAllText($Path, '') } else { [System.IO.File]::WriteAllText($Path, $Content) }
}

function global:Get-ArgumentAfter {
    param([object[]]$ArgumentList, [string]$Flag)
    for ($i = 0; $i -lt $ArgumentList.Count - 1; $i++) { if ($ArgumentList[$i] -eq $Flag) { return [string]$ArgumentList[$i + 1] } }
    return $null
}

function global:Invoke-FakePgProcess {
    # Doble de Invoke-ExternalProcess para pg_dump / pg_restore / pg_dumpall.
    param([string]$FilePath, [string[]]$ArgumentList = @(), [hashtable]$EnvironmentVariables = @{})
    $tool = [System.IO.Path]::GetFileNameWithoutExtension($FilePath).ToLowerInvariant()
    $global:ProcSim.Calls.Add([pscustomobject]@{ Tool = $tool; File = $FilePath; Args = @($ArgumentList); Env = $EnvironmentVariables })

    switch ($tool) {
        'pg_dump' {
            if ($global:ProcSim.OnPgDump) { & $global:ProcSim.OnPgDump }
            $s = $global:ProcSim.PgDump
            Write-FakeOutputFile -Path (Get-ArgumentAfter $ArgumentList '-f') -Mode $s.Mode -Content $s.Content
            return [pscustomobject]@{ ExitCode = $s.ExitCode; StdOut = ''; StdErr = $s.StdErr }
        }
        'pg_dumpall' {
            $s = $global:ProcSim.PgDumpAll
            Write-FakeOutputFile -Path (Get-ArgumentAfter $ArgumentList '-f') -Mode $s.Mode -Content $s.Content
            return [pscustomobject]@{ ExitCode = $s.ExitCode; StdOut = ''; StdErr = $s.StdErr }
        }
        'pg_restore' {
            $s = $global:ProcSim.PgRestore
            return [pscustomobject]@{ ExitCode = $s.ExitCode; StdOut = $s.StdOut; StdErr = $s.StdErr }
        }
        default { throw "Herramienta PostgreSQL no simulada: $tool" }
    }
}

function global:Invoke-FakeAgeProcess {
    param([string]$AgePath, [string[]]$ArgumentList = @())
    $global:ProcSim.Calls.Add([pscustomobject]@{ Tool = 'age'; File = $AgePath; Args = @($ArgumentList); Env = @{} })
    if ($global:ProcSim.OnAge) { & $global:ProcSim.OnAge }
    $s = $global:ProcSim.Age
    Write-FakeOutputFile -Path (Get-ArgumentAfter $ArgumentList '-o') -Mode $s.Mode -Content $s.Content
    return [pscustomobject]@{ ExitCode = $s.ExitCode; StdOut = ''; StdErr = $s.StdErr }
}

function global:Invoke-FakeSevenZipProcess {
    param([string]$SevenZipPath, [string[]]$ArgumentList = @(), [string]$WorkingDirectory)
    $global:ProcSim.Calls.Add([pscustomobject]@{ Tool = '7z'; File = $SevenZipPath; Args = @($ArgumentList); Env = @{} })
    $s = $global:ProcSim.SevenZip
    # "7z a -t7z -mx=5 -y <bundle> <archivos...>": la salida es el primer argumento posicional tras el subcomando.
    $out = $null
    for ($i = 1; $i -lt $ArgumentList.Count; $i++) { if (-not ([string]$ArgumentList[$i]).StartsWith('-')) { $out = [string]$ArgumentList[$i]; break } }
    Write-FakeOutputFile -Path $out -Mode $s.Mode -Content 'FAKE 7Z BUNDLE'
    return [pscustomobject]@{ ExitCode = $s.ExitCode; StdOut = ''; StdErr = $s.StdErr }
}

function global:Get-SimCalls {
    param([string]$Tool)
    @($global:ProcSim.Calls | Where-Object { $_.Tool -eq $Tool })
}
