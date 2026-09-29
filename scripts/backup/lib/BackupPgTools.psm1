#Requires -Version 5.1
<#
    BackupPgTools.psm1
    Wrappers de pg_dump / pg_restore / pg_dumpall. La contraseña NUNCA se pasa
    por línea de comandos: se propaga únicamente vía la variable de entorno
    PGPASSFILE del proceso hijo (nunca en $env:* de la sesión actual, y nunca
    escrita a un log). Invoke-ExternalProcess es el único punto que lanza
    procesos, para que las pruebas puedan mockearlo sin tocar PostgreSQL real.
#>

Set-StrictMode -Version Latest

function ConvertTo-ProcessArgumentString {
    <#
        Construye la cadena de argumentos con el escapado que espera
        CreateProcess en Windows. No se usa ProcessStartInfo.ArgumentList
        porque en Windows PowerShell 5.1 (.NET Framework) esa propiedad no
        se inicializa y falla con NullReferenceException.
    #>
    [CmdletBinding()]
    param(
        [string[]]$ArgumentList = @()
    )

    $parts = foreach ($arg in $ArgumentList) {
        $value = [string]$arg
        if ($value -match '[\s"]' -or $value.Length -eq 0) {
            '"' + ($value -replace '"', '\"') + '"'
        }
        else {
            $value
        }
    }
    return ($parts -join ' ')
}

function Invoke-ExternalProcess {
    <#
        Lanza un proceso externo y captura stdout/stderr en memoria.
        Único punto de spawn real: las pruebas mockean esta función.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [string[]]$ArgumentList = @(),

        [hashtable]$EnvironmentVariables = @{}
    )

    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        throw "No se encontró el ejecutable: $FilePath"
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = ConvertTo-ProcessArgumentString -ArgumentList $ArgumentList
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    foreach ($key in $EnvironmentVariables.Keys) {
        $psi.Environment[$key] = [string]$EnvironmentVariables[$key]
    }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        StdOut   = $stdout
        StdErr   = $stderr
    }
}

function Invoke-PgDump {
    <#
        Ejecuta pg_dump -Fc (o --schema-only) hacia $OutputPath (staging).
        Nunca imprime la contraseña; PGPASSFILE se pasa solo al proceso hijo.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config,

        [Parameter(Mandatory = $true)]
        [string]$OutputPath,

        [switch]$SchemaOnly
    )

    $exe = Join-Path $Config.PgBinPath 'pg_dump.exe'
    $arguments = @(
        '-h', $Config.PgHost,
        '-p', [string]$Config.PgPort,
        '-U', $Config.PgUser,
        '-d', $Config.PgDatabase,
        '-Fc',
        '-f', $OutputPath,
        '--no-password'
    )
    if ($SchemaOnly) { $arguments += '--schema-only' }

    $result = Invoke-ExternalProcess -FilePath $exe -ArgumentList $arguments -EnvironmentVariables @{ PGPASSFILE = $Config.PgPassFile }

    [pscustomobject]@{
        ExitCode    = $result.ExitCode
        OutputPath  = $OutputPath
        Success     = ($result.ExitCode -eq 0)
        StdErrTail  = $result.StdErr
    }
}

function Invoke-PgDumpAllGlobals {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config,

        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    $exe = Join-Path $Config.PgBinPath 'pg_dumpall.exe'
    # Globals SANITIZADOS (política MONTHLY):
    #   -l <PgDatabase>       la conexión inicial de pg_dumpall usa la misma base para la que
    #                         existe entrada en PGPASSFILE (por defecto intentaría la base
    #                         "postgres", sin entrada, y fallaría).
    #   --no-role-passwords   sin hashes de contraseña: el rol de backup NO necesita ser
    #                         superusuario ni leer pg_authid.
    #   --no-password         nunca pide contraseña (se usa PGPASSFILE).
    $arguments = @(
        '-h', $Config.PgHost,
        '-p', [string]$Config.PgPort,
        '-U', $Config.PgUser,
        '-l', $Config.PgDatabase,
        '--globals-only',
        '--no-role-passwords',
        '-f', $OutputPath,
        '--no-password'
    )

    $result = Invoke-ExternalProcess -FilePath $exe -ArgumentList $arguments -EnvironmentVariables @{ PGPASSFILE = $Config.PgPassFile }

    [pscustomobject]@{
        ExitCode   = $result.ExitCode
        OutputPath = $OutputPath
        Success    = ($result.ExitCode -eq 0)
        StdErrTail = $result.StdErr
    }
}

function Invoke-PgRestoreList {
    <#
        Valida un dump -Fc con `pg_restore -l`. Un dump solo se considera
        válido si el proceso termina en 0 Y el listado contiene al menos una
        entrada real (no solo comentarios ";"). Esto cubre el caso de un
        archivo que existe pero está vacío o corrupto.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Config,

        [Parameter(Mandatory = $true)]
        [string]$DumpPath
    )

    $exe = Join-Path $Config.PgBinPath 'pg_restore.exe'
    $result = Invoke-ExternalProcess -FilePath $exe -ArgumentList @('-l', $DumpPath)

    $lines = @()
    if ($result.StdOut) {
        $lines = @($result.StdOut -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 -and -not $_.TrimStart().StartsWith(';') })
    }

    [pscustomobject]@{
        ExitCode   = $result.ExitCode
        EntryCount = $lines.Count
        IsValid    = ($result.ExitCode -eq 0 -and $lines.Count -gt 0)
        StdErrTail = $result.StdErr
    }
}

function Test-GlobalsDumpContent {
    <#
        Validación mínima de un dump de globals (SQL plano, no admite
        pg_restore -l): debe existir, no estar vacío, y contener al menos una
        sentencia reconocible. No se imprime su contenido.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    $content = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $false
    }

    return ($content -match '(?im)^\s*CREATE ROLE|^\s*ALTER ROLE|^\s*CREATE GROUP')
}

Export-ModuleMember -Function ConvertTo-ProcessArgumentString, Invoke-ExternalProcess, Invoke-PgDump, Invoke-PgDumpAllGlobals, Invoke-PgRestoreList, Test-GlobalsDumpContent
