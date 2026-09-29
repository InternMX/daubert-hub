#Requires -Version 5.1
<#
    Pruebas unitarias de los wrappers de pg_dump/pg_restore/pg_dumpall.
    Mockean Invoke-ExternalProcess: NO se conecta a PostgreSQL ni se
    ejecutan binarios reales.

    Ejecutar con: powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 3.4.0; Invoke-Pester scripts\backup\tests\BackupPgTools.Tests.ps1"
#>

$moduleRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $moduleRoot 'lib\BackupPgTools.psm1') -Force

Describe 'BackupPgTools' {

    BeforeEach {
        $global:testDir = Join-Path ([System.IO.Path]::GetTempPath()) ("daubert-backup-pgtools-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $global:testDir -Force | Out-Null

        # Los wrappers no comprueban el ejecutable (eso lo hace el seam
        # Invoke-ExternalProcess, mockeado aquí): no se crea ningún archivo
        # con nombre de herramienta real.
        $global:config = [pscustomobject]@{
            PgBinPath  = $global:testDir
            PgHost     = 'localhost'
            PgPort     = 5432
            PgUser     = 'daubert_backup'
            PgDatabase = 'daubert_global'
            PgPassFile = Join-Path $global:testDir 'pgpass.conf'
        }
    }

    AfterEach {
        Remove-Item -LiteralPath $global:testDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Context 'Invoke-PgDump' {

        It 'reporta éxito cuando el proceso termina en 0' {
            InModuleScope BackupPgTools {
                Mock Invoke-ExternalProcess { [pscustomobject]@{ ExitCode = 0; StdOut = ''; StdErr = '' } }

                $outPath = Join-Path $global:testDir 'out.dump'
                $result = Invoke-PgDump -Config $global:config -OutputPath $outPath

                $result.Success | Should Be $true
                $result.ExitCode | Should Be 0
                Assert-MockCalled Invoke-ExternalProcess -Times 1 -Exactly
            }
        }

        It 'reporta fallo (falla de pg_dump) cuando el proceso termina distinto de 0' {
            InModuleScope BackupPgTools {
                Mock Invoke-ExternalProcess { [pscustomobject]@{ ExitCode = 1; StdOut = ''; StdErr = 'connection refused' } }

                $result = Invoke-PgDump -Config $global:config -OutputPath (Join-Path $global:testDir 'out.dump')

                $result.Success | Should Be $false
                $result.ExitCode | Should Be 1
            }
        }

        It 'nunca incluye la contraseña en los argumentos del proceso (--no-password sí puede aparecer)' {
            InModuleScope BackupPgTools {
                $global:capturedArgs = $null
                Mock Invoke-ExternalProcess {
                    param($FilePath, $ArgumentList, $EnvironmentVariables)
                    $global:capturedArgs = $ArgumentList
                    [pscustomobject]@{ ExitCode = 0; StdOut = ''; StdErr = '' }
                }

                Invoke-PgDump -Config $global:config -OutputPath (Join-Path $global:testDir 'out.dump') | Out-Null
            }
            ($global:capturedArgs -contains '--no-password') | Should Be $true
            ($global:capturedArgs -join ' ') | Should Not Match 'PGPASSWORD'
        }

        It 'propaga PGPASSFILE solo como variable de entorno del proceso hijo' {
            InModuleScope BackupPgTools {
                $global:capturedEnv = $null
                Mock Invoke-ExternalProcess {
                    param($FilePath, $ArgumentList, $EnvironmentVariables)
                    $global:capturedEnv = $EnvironmentVariables
                    [pscustomobject]@{ ExitCode = 0; StdOut = ''; StdErr = '' }
                }

                Invoke-PgDump -Config $global:config -OutputPath (Join-Path $global:testDir 'out.dump') | Out-Null
            }
            $global:capturedEnv['PGPASSFILE'] | Should Be $global:config.PgPassFile
        }

        It 'agrega --schema-only cuando se pide -SchemaOnly' {
            InModuleScope BackupPgTools {
                $global:capturedArgs2 = $null
                Mock Invoke-ExternalProcess {
                    param($FilePath, $ArgumentList, $EnvironmentVariables)
                    $global:capturedArgs2 = $ArgumentList
                    [pscustomobject]@{ ExitCode = 0; StdOut = ''; StdErr = '' }
                }

                Invoke-PgDump -Config $global:config -OutputPath (Join-Path $global:testDir 'out.dump') -SchemaOnly | Out-Null
            }
            ($global:capturedArgs2 -contains '--schema-only') | Should Be $true
        }
    }

    Context 'Invoke-PgRestoreList (validación obligatoria del dump)' {

        It 'es válido cuando hay entradas TOC reales' {
            InModuleScope BackupPgTools {
                Mock Invoke-ExternalProcess {
                    [pscustomobject]@{
                        ExitCode = 0
                        StdOut   = ";`n; Archive created at 2026-09-28`n3; 2615 2200 SCHEMA - public postgres`n4; 1259 20000 TABLE core clientes daubert_backup"
                        StdErr   = ''
                    }
                }
                $result = Invoke-PgRestoreList -Config $global:config -DumpPath (Join-Path $global:testDir 'out.dump')
                $result.IsValid | Should Be $true
                $result.EntryCount | Should Be 2
            }
        }

        It 'NO es válido si pg_restore -l termina con código distinto de 0 (fallo de pg_restore -l)' {
            InModuleScope BackupPgTools {
                Mock Invoke-ExternalProcess { [pscustomobject]@{ ExitCode = 1; StdOut = ''; StdErr = 'could not read symbol table' } }
                $result = Invoke-PgRestoreList -Config $global:config -DumpPath (Join-Path $global:testDir 'out.dump')
                $result.IsValid | Should Be $false
            }
        }

        It 'NO es válido si solo hay líneas de comentario (dump vacío)' {
            InModuleScope BackupPgTools {
                Mock Invoke-ExternalProcess { [pscustomobject]@{ ExitCode = 0; StdOut = ";`n; Archive created at 2026-09-28`n; No entries`n"; StdErr = '' } }
                $result = Invoke-PgRestoreList -Config $global:config -DumpPath (Join-Path $global:testDir 'out.dump')
                $result.IsValid | Should Be $false
                $result.EntryCount | Should Be 0
            }
        }
    }

    Context 'ConvertTo-ProcessArgumentString' {

        It 'entre-comilla argumentos con espacios (rutas con espacios, p.ej. Program Files)' {
            $result = ConvertTo-ProcessArgumentString -ArgumentList @('-f', 'C:\Program Files\PostgreSQL\18\bin\out.dump')
            $result | Should Be '-f "C:\Program Files\PostgreSQL\18\bin\out.dump"'
        }

        It 'no entre-comilla argumentos simples sin espacios' {
            $result = ConvertTo-ProcessArgumentString -ArgumentList @('-h', 'localhost', '-p', '5432')
            $result | Should Be '-h localhost -p 5432'
        }
    }

    Context 'Test-GlobalsDumpContent' {

        It 'es válido si contiene sentencias CREATE ROLE' {
            $path = Join-Path $global:testDir 'globals.sql'
            Set-Content -LiteralPath $path -Value "CREATE ROLE daubert_backup;" -Encoding UTF8
            Test-GlobalsDumpContent -Path $path | Should Be $true
        }

        It 'NO es válido si el archivo está vacío' {
            $path = Join-Path $global:testDir 'globals.sql'
            Set-Content -LiteralPath $path -Value '' -Encoding UTF8
            Test-GlobalsDumpContent -Path $path | Should Be $false
        }

        It 'NO es válido si el archivo no existe' {
            Test-GlobalsDumpContent -Path (Join-Path $global:testDir 'no-existe.sql') | Should Be $false
        }
    }
}

Describe 'BackupPgTools - Invoke-ExternalProcess (seam real, probado con cmd.exe del sistema; sin ejecutables falsos)' {

    BeforeAll { $script:cmd = $env:ComSpec }

    It 'devuelve el exit code del proceso' {
        (Invoke-ExternalProcess -FilePath $script:cmd -ArgumentList @('/c', 'exit 3')).ExitCode | Should Be 3
        (Invoke-ExternalProcess -FilePath $script:cmd -ArgumentList @('/c', 'exit 0')).ExitCode | Should Be 0
    }

    It 'captura stdout y stderr por separado' {
        $r = Invoke-ExternalProcess -FilePath $script:cmd -ArgumentList @('/c', 'echo salida-ok& echo error-ok 1>&2')
        $r.StdOut | Should Match 'salida-ok'
        $r.StdErr | Should Match 'error-ok'
        $r.StdOut | Should Not Match 'error-ok'
    }

    It 'propaga las variables de entorno solo al proceso hijo (PGPASSFILE)' {
        $r = Invoke-ExternalProcess -FilePath $script:cmd -ArgumentList @('/c', 'echo %PGPASSFILE%') -EnvironmentVariables @{ PGPASSFILE = 'valor-de-prueba' }
        $r.StdOut | Should Match 'valor-de-prueba'
        [Environment]::GetEnvironmentVariable('PGPASSFILE') | Should Not Be 'valor-de-prueba'
    }

    It 'lanza si el ejecutable no existe' {
        { Invoke-ExternalProcess -FilePath (Join-Path ([System.IO.Path]::GetTempPath()) 'no-existe-herramienta.bin') -ArgumentList @() } | Should Throw
    }
}

Describe 'BackupPgTools - Invoke-PgDumpAllGlobals (globals sanitizados; Invoke-ExternalProcess mockeado)' {

    BeforeEach {
        $global:dumpAllConfig = [pscustomobject]@{
            PgBinPath = (Join-Path ([System.IO.Path]::GetTempPath()) 'pg-simulado'); PgHost = 'localhost'; PgPort = 5432
            PgUser = 'daubert_backup'; PgDatabase = 'base_resuelta'; PgPassFile = (Join-Path ([System.IO.Path]::GetTempPath()) 'pgpass-simulado.conf')
        }
        $global:dumpAllCall = $null
        Mock Invoke-ExternalProcess {
            $global:dumpAllCall = @{ File = $FilePath; Args = @($ArgumentList); Env = $EnvironmentVariables }
            [pscustomobject]@{ ExitCode = $global:dumpAllExit; StdOut = ''; StdErr = 'mensaje' }
        } -ModuleName BackupPgTools
        $global:dumpAllExit = 0
    }

    It 'usa -l <PgDatabase resuelto> --globals-only --no-role-passwords --no-password, sin secretos' {
        $r = Invoke-PgDumpAllGlobals -Config $global:dumpAllConfig -OutputPath 'salida.sql'
        $r.Success | Should Be $true
        $global:dumpAllCall.Args | Should Be @('-h', 'localhost', '-p', '5432', '-U', 'daubert_backup', '-l', 'base_resuelta', '--globals-only', '--no-role-passwords', '-f', 'salida.sql', '--no-password')
        (Split-Path -Leaf $global:dumpAllCall.File) | Should Be 'pg_dumpall.exe'
    }

    It 'el nombre de la base sale de la configuración (no está hardcodeado)' {
        $global:dumpAllConfig.PgDatabase = 'otra_base'
        Invoke-PgDumpAllGlobals -Config $global:dumpAllConfig -OutputPath 'x.sql' | Out-Null
        $i = [array]::IndexOf($global:dumpAllCall.Args, '-l')
        $global:dumpAllCall.Args[$i + 1] | Should Be 'otra_base'
    }

    It 'PGPASSFILE es la única variable de entorno y ningún argumento la contiene' {
        Invoke-PgDumpAllGlobals -Config $global:dumpAllConfig -OutputPath 'x.sql' | Out-Null
        $global:dumpAllCall.Env['PGPASSFILE'] | Should Be $global:dumpAllConfig.PgPassFile
        @($global:dumpAllCall.Env.Keys).Count | Should Be 1
        ($global:dumpAllCall.Args -contains $global:dumpAllConfig.PgPassFile) | Should Be $false
    }

    It 'reporta fallo cuando pg_dumpall termina con código distinto de 0' {
        $global:dumpAllExit = 1
        $r = Invoke-PgDumpAllGlobals -Config $global:dumpAllConfig -OutputPath 'x.sql'
        $r.Success | Should Be $false
        $r.ExitCode | Should Be 1
    }
}
