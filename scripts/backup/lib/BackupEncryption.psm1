#Requires -Version 5.1
<#
    BackupEncryption.psm1
    Cifrado ASIMÉTRICO con age (https://age-encryption.org): el job de
    backup solo necesita la(s) clave(s) PÚBLICA(S) de destinatario
    ("recipients"), nunca la clave privada de recuperación.

    DISEÑO (ver docs/operations/postgresql-backup-automation.md):
      - El job cifra con `age -R <recipients-file> -o <salida> <entrada>`.
        Un "recipient" de age es una clave pública (cadena "age1...", NO
        secreta): puede vivir en un archivo de texto plano sin ACL
        especial, en logs, en control de versiones si se quisiera — nada
        de esto compromete la confidencialidad del backup.
      - age, al cifrar para uno o más destinatarios públicos, NUNCA pide
        una contraseña ni abre ningún prompt interactivo: no hay agente,
        no hay keyring, no hay pinentry. Esto evita por diseño la clase de
        problema (prompt/consola condicionado por el entorno de ejecución)
        encontrada previamente con el mecanismo de contraseña por stdin de
        7-Zip — motivo del cambio de diseño pedido explícitamente.
      - La clave PRIVADA de recuperación (`AGE-SECRET-KEY-1...`) NUNCA es
        leída, referenciada, ni necesaria en ningún punto de este módulo
        ni del pipeline de backup. Ninguna función aquí acepta un
        parámetro de clave privada / archivo de identidad. Debe generarse
        una sola vez (`age-keygen`, fuera de este repo, manualmente) y
        conservarse fuera de esta máquina para recuperación bare-metal.
      - Como el job nunca tiene la clave privada, NO puede descifrar para
        "validar" el contenido. La validación (paso 8 del pipeline) es
        ESTRUCTURAL: se comprueba que el archivo tiene la cabecera age
        esperada ("age-encryption.org/v1"), al menos una línea de
        destinatario ("-> ") y un tamaño mínimo plausible — sin descifrar
        nada. Esto NO prueba que el contenido sea recuperable con la clave
        privada real; solo que el artefacto tiene la forma de un archivo
        age bien formado. La única prueba definitiva de recuperabilidad es
        un restore drill real con la clave privada, fuera de esta máquina.
#>

Set-StrictMode -Version Latest

function ConvertTo-AgeArgumentString {
    <#
        Copia interna de ConvertTo-ProcessArgumentString (ver la nota
        equivalente en BackupPgTools.psm1 / BackupPackaging.psm1).
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

function Test-BackupRecipientsFile {
    <#
        Valida el archivo de destinatarios (claves PÚBLICAS de age, una
        por línea; líneas vacías o que empiecen con "#" se ignoran) sin
        involucrar ningún secreto: solo comprueba que existe y que
        contiene al menos una línea con forma de clave pública age
        ("age1" + caracteres bech32). No se conecta a age.exe ni descifra
        nada.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$RecipientsFilePath
    )

    if (-not (Test-Path -LiteralPath $RecipientsFilePath -PathType Leaf)) {
        return [pscustomobject]@{ IsValid = $false; Reason = "No existe el archivo de destinatarios: $RecipientsFilePath" }
    }

    $lines = Get-Content -LiteralPath $RecipientsFilePath -ErrorAction SilentlyContinue
    $recipientLines = @($lines | Where-Object { $_ -and -not $_.TrimStart().StartsWith('#') -and $_.Trim().Length -gt 0 })
    $validRecipients = @($recipientLines | Where-Object { $_.Trim() -match '^age1[a-z0-9]{20,}$' })

    if ($validRecipients.Count -eq 0) {
        return [pscustomobject]@{ IsValid = $false; Reason = 'El archivo de destinatarios no contiene ninguna clave pública age (age1...) reconocible.' }
    }

    return [pscustomobject]@{ IsValid = $true; Reason = $null; RecipientCount = $validRecipients.Count }
}

function Invoke-AgeProcess {
    <#
        Lanza age.exe con stdout/stderr redirigidos y timeout. NUNCA recibe
        ni maneja ningún secreto: los argumentos son siempre rutas y, como
        mucho, el propio archivo de destinatarios (público). No hay
        interacción por stdin en absoluto: cifrar con destinatarios
        públicos no dispara ningún prompt en age.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$AgePath,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,

        [int]$TimeoutSeconds = 300
    )

    if (-not (Test-Path -LiteralPath $AgePath -PathType Leaf)) {
        throw "No se encontró age.exe en: $AgePath"
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $AgePath
    $psi.Arguments = ConvertTo-AgeArgumentString -ArgumentList $ArgumentList
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
            throw "age.exe no respondió dentro de $TimeoutSeconds segundos; el proceso fue terminado."
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

function New-AgeEncryptedArtifact {
    <#
        Cifra $InputPath para los destinatarios listados en
        $RecipientsFilePath, produciendo $OutputPath. Nunca requiere ni
        acepta una clave privada.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$AgePath,

        [Parameter(Mandatory = $true)]
        [string]$RecipientsFilePath,

        [Parameter(Mandatory = $true)]
        [string]$InputPath,

        [Parameter(Mandatory = $true)]
        [string]$OutputPath,

        [int]$TimeoutSeconds = 300
    )

    $arguments = @('-R', $RecipientsFilePath, '-o', $OutputPath, $InputPath)
    $result = Invoke-AgeProcess -AgePath $AgePath -ArgumentList $arguments -TimeoutSeconds $TimeoutSeconds

    [pscustomobject]@{
        ExitCode   = $result.ExitCode
        Success    = ($result.ExitCode -eq 0)
        OutputPath = $OutputPath
        StdErrTail = $result.StdErr
    }
}

function Test-AgeArtifactStructure {
    <#
        Validación ESTRUCTURAL (sin descifrar, sin clave privada) de un
        artefacto cifrado con age: comprueba la cabecera estándar
        "age-encryption.org/v1", al menos una línea de destinatario
        ("-> "), y un tamaño mínimo plausible. Un archivo que existe pero
        está vacío, truncado, o no es age en absoluto, falla aquí.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [int]$MinimumSizeBytes = 100
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ IsValid = $false; Reason = 'El archivo no existe.' }
    }

    $length = (Get-Item -LiteralPath $Path).Length
    if ($length -lt $MinimumSizeBytes) {
        return [pscustomobject]@{ IsValid = $false; Reason = "El archivo es demasiado pequeño ($length bytes) para ser un artefacto age válido." }
    }

    # Leemos solo un fragmento inicial (nunca el archivo completo: no hace
    # falta, y evita cargar en memoria un backup potencialmente grande).
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        $buffer = New-Object byte[] 4096
        $bytesRead = $stream.Read($buffer, 0, $buffer.Length)
        $head = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $bytesRead)
    }
    finally {
        $stream.Dispose()
    }

    $lines = $head -split "`n"
    if ($lines.Count -eq 0 -or $lines[0].TrimEnd("`r") -ne 'age-encryption.org/v1') {
        return [pscustomobject]@{ IsValid = $false; Reason = 'Falta la cabecera age-encryption.org/v1 esperada.' }
    }

    $hasRecipientStanza = $false
    foreach ($line in $lines) {
        if ($line.TrimEnd("`r").StartsWith('-> ')) { $hasRecipientStanza = $true; break }
    }
    if (-not $hasRecipientStanza) {
        return [pscustomobject]@{ IsValid = $false; Reason = 'No se encontró ninguna línea de destinatario ("-> ") en la cabecera.' }
    }

    return [pscustomobject]@{ IsValid = $true; Reason = $null }
}

Export-ModuleMember -Function Test-BackupRecipientsFile, Invoke-AgeProcess, New-AgeEncryptedArtifact, Test-AgeArtifactStructure
