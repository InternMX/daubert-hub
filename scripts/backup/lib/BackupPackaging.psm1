#Requires -Version 5.1
<#
    BackupPackaging.psm1
    Empaquetado intermedio (paso 6 del pipeline) SIN cifrar: junta los
    artefactos de texto plano de un run (dump + schema-only y/o globals)
    en un único archivo .7z, usando SOLO compresión (sin -p, sin
    contraseña, sin -mhe). Este bundle es un paso intermedio de staging:
    nunca se publica ni se retiene; el cifrado real ocurre después, con
    age (BackupEncryption.psm1), sobre este bundle.

    Al no usar contraseña, 7z nunca pide nada de forma interactiva aquí:
    es una operación de compresión pura, completamente no interactiva,
    sin ninguna dependencia de consola.
#>

Set-StrictMode -Version Latest

function ConvertTo-PackagingArgumentString {
    <#
        Copia interna de ConvertTo-ProcessArgumentString (ver la nota en
        BackupPgTools.psm1/BackupEncryption.psm1 sobre por qué cada módulo
        mantiene su propia copia en vez de importar entre sí).
    #>
    param([string[]]$ArgumentList = @())
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

function Invoke-SevenZipProcess {
    <#
        Único punto que lanza 7z.exe (seam mockeable: las pruebas lo
        sustituyen y no necesitan ningún 7z falso). Captura stdout/stderr y
        aplica un timeout. Nunca recibe secretos: 7z solo comprime aquí.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$SevenZipPath,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,

        [string]$WorkingDirectory,

        [int]$TimeoutSeconds = 300
    )

    if (-not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) {
        throw "No se encontró 7z.exe en: $SevenZipPath"
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $SevenZipPath
    $psi.Arguments = ConvertTo-PackagingArgumentString -ArgumentList $ArgumentList
    if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    try {
        [void]$proc.Start()
        $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
        $stderrTask = $proc.StandardError.ReadToEndAsync()

        if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
            try { $proc.Kill() } catch { }
            throw "7z.exe (empaquetado) no respondió dentro de $TimeoutSeconds segundos; el proceso fue terminado."
        }
        $proc.WaitForExit()

        [pscustomobject]@{
            ExitCode = $proc.ExitCode
            StdOut   = $stdoutTask.GetAwaiter().GetResult()
            StdErr   = $stderrTask.GetAwaiter().GetResult()
        }
    }
    finally {
        $proc.Dispose()
    }
}

function New-PlainBundle {
    <#
        Crea un .7z SIN cifrar (solo compresión) a partir de
        $SourceFileNames, rutas RELATIVAS a $WorkingDirectory. Nunca usa
        -p ni -mhe: no hay ningún secreto ni prompt involucrado en este
        paso.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$SevenZipPath,

        [Parameter(Mandatory = $true)]
        [string]$BundlePath,

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,

        [Parameter(Mandatory = $true)]
        [string[]]$SourceFileNames,

        [int]$CompressionLevel = 5,

        [int]$TimeoutSeconds = 300
    )

    $arguments = @('a', '-t7z', "-mx=$CompressionLevel", '-y', $BundlePath) + $SourceFileNames
    $result = Invoke-SevenZipProcess -SevenZipPath $SevenZipPath -ArgumentList $arguments -WorkingDirectory $WorkingDirectory -TimeoutSeconds $TimeoutSeconds

    [pscustomobject]@{
        ExitCode   = $result.ExitCode
        Success    = ($result.ExitCode -eq 0)
        BundlePath = $BundlePath
        StdErrTail = $result.StdErr
    }
}

Export-ModuleMember -Function Invoke-SevenZipProcess, New-PlainBundle
