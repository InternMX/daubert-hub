#Requires -Version 5.1
<#
    BackupNaming.psm1
    Genera nombres de archivo inequívocos (timestamp con segundos) para cada
    artefacto de backup, y expone las expresiones regulares usadas por
    retención para reconocer con certeza qué archivos le pertenecen a un tier.
#>

Set-StrictMode -Version Latest

function New-BackupTimestamp {
    <#
        Timestamp local inequívoco con segundos: yyyyMMdd_HHmmss.
        Acepta -Now para pruebas deterministas.
    #>
    [CmdletBinding()]
    param(
        [datetime]$Now = (Get-Date)
    )
    return $Now.ToString('yyyyMMdd_HHmmss')
}

function New-BackupFileName {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Dump', 'Globals', 'SchemaOnly', 'Bundle', 'Archive')]
        [string]$Kind,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Frequent', 'Daily', 'Monthly')]
        [string]$Tier,

        [Parameter(Mandatory = $true)]
        [string]$Database,

        [Parameter(Mandatory = $true)]
        [string]$Timestamp
    )

    $tierUpper = $Tier.ToUpperInvariant()

    switch ($Kind) {
        'Dump' { return "${Database}_${tierUpper}_${Timestamp}.dump" }
        'Globals' { return "globals_${tierUpper}_${Timestamp}.sql" }
        'SchemaOnly' { return "${Database}_schema_${tierUpper}_${Timestamp}.dump" }
        # Bundle: empaquetado intermedio SIN cifrar (solo staging, nunca se
        # publica ni se retiene) usado para tiers con más de un artefacto
        # plano (Daily/Monthly) antes del cifrado asimétrico.
        'Bundle' { return "${Database}_${tierUpper}_${Timestamp}.bundle.7z" }
        # Archive: artefacto FINAL publicado, cifrado con age (asimétrico,
        # solo clave pública). Nunca contiene texto plano.
        'Archive' { return "${Database}_${tierUpper}_${Timestamp}.age" }
    }
}

function Get-BackupFileNamePattern {
    <#
        Expresión regular que reconoce nombres de archivo generados por
        New-BackupFileName para un tier y kind dados. Usada por retención
        para no tocar jamás un archivo que no coincida exactamente.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Dump', 'Globals', 'SchemaOnly', 'Bundle', 'Archive')]
        [string]$Kind,

        [Parameter(Mandatory = $true)]
        [ValidateSet('Frequent', 'Daily', 'Monthly')]
        [string]$Tier,

        [Parameter(Mandatory = $true)]
        [string]$Database
    )

    $tierUpper = [regex]::Escape($Tier.ToUpperInvariant())
    $db = [regex]::Escape($Database)
    $ts = '(?<timestamp>\d{8}_\d{6})'

    switch ($Kind) {
        'Dump' { return "^${db}_${tierUpper}_${ts}\.dump$" }
        'Globals' { return "^globals_${tierUpper}_${ts}\.sql$" }
        'SchemaOnly' { return "^${db}_schema_${tierUpper}_${ts}\.dump$" }
        'Bundle' { return "^${db}_${tierUpper}_${ts}\.bundle\.7z$" }
        'Archive' { return "^${db}_${tierUpper}_${ts}\.age$" }
    }
}

function ConvertFrom-BackupTimestamp {
    <#
        Parsea el timestamp embebido en un nombre de archivo (yyyyMMdd_HHmmss)
        a [datetime]. Devuelve $null si no coincide con el formato esperado,
        para que el llamador nunca asuma una fecha inventada.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Timestamp
    )

    $parsed = [datetime]::MinValue
    $ok = [datetime]::TryParseExact(
        $Timestamp,
        'yyyyMMdd_HHmmss',
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::None,
        [ref]$parsed
    )

    if ($ok) { return $parsed }
    return $null
}

Export-ModuleMember -Function New-BackupTimestamp, New-BackupFileName, Get-BackupFileNamePattern, ConvertFrom-BackupTimestamp
