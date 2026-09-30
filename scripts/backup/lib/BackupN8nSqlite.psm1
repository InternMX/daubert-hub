#Requires -Version 5.1
<#
    BackupN8nSqlite.psm1
    Snapshot consistente de la SQLite de n8n mientras n8n sigue ejecutándose.

    NUNCA se copia database.sqlite (ni su WAL/SHM): el snapshot lo crea el helper
    versionado helpers\n8n-sqlite-snapshot.js con node:sqlite (DatabaseSync +
    backup()), solo APIs built-in de Node. Este módulo solo lanza ese helper (a
    través del seam mockeable Invoke-NodeProcess) e interpreta su JSON de
    metadata segura. Cualquier exit code distinto de cero es un fallo.
#>

Set-StrictMode -Version Latest

function ConvertTo-N8nNodeArgumentString {
    <# Copia interna (cada módulo de procesos mantiene la suya; ver BackupPackaging.psm1). #>
    param([string[]]$ArgumentList = @())
    $parts = foreach ($arg in $ArgumentList) {
        $value = [string]$arg
        if ($value -match '[\s"]' -or $value.Length -eq 0) { '"' + ($value -replace '"', '\"') + '"' } else { $value }
    }
    return ($parts -join ' ')
}

function Invoke-NodeProcess {
    <#
        Único punto que lanza node.exe (seam mockeable: las pruebas lo sustituyen
        y no necesitan ningún node falso). Captura stdout/stderr con timeout.
        Nunca recibe secretos: solo rutas de archivos.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [int]$TimeoutSeconds = 600
    )

    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'No se encontró node.exe en la ruta configurada.' }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $NodePath
    $psi.Arguments = ConvertTo-N8nNodeArgumentString -ArgumentList $ArgumentList
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
            throw "node.exe no respondió dentro de $TimeoutSeconds segundos; el proceso fue terminado."
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

function Get-N8nNodeVersion {
    <# Versión de Node ("24.x.y") o $null si no se pudo determinar. #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$NodePath, [int]$TimeoutSeconds = 30)
    try { $r = Invoke-NodeProcess -NodePath $NodePath -ArgumentList @('--version') -TimeoutSeconds $TimeoutSeconds } catch { return $null }
    if ($r.ExitCode -ne 0) { return $null }
    $m = [regex]::Match([string]$r.StdOut, '^\s*v?(\d+\.\d+\.\d+)')
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

function New-N8nSnapshotError {
    param([string]$Message, [string]$Kind)
    $ex = New-Object System.Exception($Message)
    $ex.Data['Kind'] = $Kind
    return $ex
}

function Invoke-N8nSqliteSnapshot {
    <#
        Ejecuta el helper Node y devuelve SOLO metadata segura:
          { QuickCheck = 'ok'; TableCount; SizeBytes }
        Lanza (con Data['Kind'] = 'QuickCheck' | 'Helper') si el exit code no es 0,
        la salida no es el JSON esperado, quick_check != ok o el snapshot no existe.
        Los mensajes solo incluyen exit code y un código corto del helper: jamás
        stdout/stderr en bruto.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string]$HelperPath,
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [int]$TimeoutSeconds = 600
    )

    $arguments = @('--no-warnings', $HelperPath, '--source', $SourcePath, '--dest', $DestinationPath)
    $result = Invoke-NodeProcess -NodePath $NodePath -ArgumentList $arguments -TimeoutSeconds $TimeoutSeconds

    $json = $null
    $lastLine = @(([string]$result.StdOut -split "`r?`n") | Where-Object { $_.Trim() })
    if ($lastLine.Count -gt 0) { try { $json = $lastLine[-1] | ConvertFrom-Json -ErrorAction Stop } catch { $json = $null } }

    $tag = $null
    if ($json -and $json.PSObject.Properties['error'] -and ([string]$json.error) -match '^[a-z_]{1,40}$') { $tag = [string]$json.error }

    if ($result.ExitCode -ne 0) {
        $kind = if ($tag -eq 'quick_check_failed') { 'QuickCheck' } else { 'Helper' }
        $detail = if ($tag) { ", error=$tag" } else { '' }
        throw (New-N8nSnapshotError -Message "El helper de snapshot SQLite falló (exit code $($result.ExitCode)$detail)." -Kind $kind)
    }
    if ($null -eq $json -or -not $json.PSObject.Properties['ok'] -or $json.ok -ne $true) {
        throw (New-N8nSnapshotError -Message 'El helper de snapshot SQLite no devolvió el JSON de éxito esperado.' -Kind 'Helper')
    }
    if ($json.PSObject.Properties['quickCheck'] -eq $null -or [string]$json.quickCheck -ne 'ok') {
        throw (New-N8nSnapshotError -Message 'PRAGMA quick_check del snapshot SQLite no devolvió ok.' -Kind 'QuickCheck')
    }
    $tables = 0
    if (-not $json.PSObject.Properties['tableCount'] -or -not [int]::TryParse([string]$json.tableCount, [ref]$tables) -or $tables -lt 0) {
        throw (New-N8nSnapshotError -Message 'El helper de snapshot SQLite no informó un tableCount válido.' -Kind 'Helper')
    }
    if (-not (Test-Path -LiteralPath $DestinationPath -PathType Leaf)) {
        throw (New-N8nSnapshotError -Message 'El helper de snapshot SQLite terminó sin crear el snapshot.' -Kind 'Helper')
    }
    $size = (Get-Item -LiteralPath $DestinationPath).Length
    if ($size -le 0) { throw (New-N8nSnapshotError -Message 'El snapshot SQLite está vacío.' -Kind 'Helper') }

    [pscustomobject]@{ QuickCheck = 'ok'; TableCount = $tables; SizeBytes = [long]$size }
}


function Test-N8nNodeSqliteSupport {
    <#
        Comprueba (sin tocar ninguna base de datos) que este Node ofrece node:sqlite con DatabaseSync y
        backup(). Es un sondeo por detección de funciones, no por número de versión (la versión solo
        se informa y se exige >= $MinimumVersion). Devuelve
          { Supported; Version; HasSqlite; HasDatabaseSync; HasBackup; VersionOk; Reason }
        Usa el seam Invoke-NodeProcess (mockeable).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$NodePath,
        [version]$MinimumVersion = [version]'22.16.0',
        [int]$TimeoutSeconds = 30
    )

    $probeJs = "let r={sqlite:false,databaseSync:false,backup:false};try{const s=require('node:sqlite');r.sqlite=true;r.databaseSync=typeof s.DatabaseSync==='function';r.backup=typeof s.backup==='function'}catch(e){}process.stdout.write(JSON.stringify(r))"
    $result = [ordered]@{ Supported = $false; Version = $null; HasSqlite = $false; HasDatabaseSync = $false; HasBackup = $false; VersionOk = $false; Reason = '' }

    $ver = Get-N8nNodeVersion -NodePath $NodePath -TimeoutSeconds $TimeoutSeconds
    if (-not $ver) { $result.Reason = 'No se pudo ejecutar node --version.'; return [pscustomobject]$result }
    $result.Version = $ver
    $result.VersionOk = ([version]$ver -ge $MinimumVersion)

    try { $r = Invoke-NodeProcess -NodePath $NodePath -ArgumentList @('--no-warnings', '-e', $probeJs) -TimeoutSeconds $TimeoutSeconds } catch { $result.Reason = 'No se pudo ejecutar el sondeo de node:sqlite.'; return [pscustomobject]$result }
    $json = $null
    if ($r.ExitCode -eq 0) { try { $json = ([string]$r.StdOut).Trim() | ConvertFrom-Json -ErrorAction Stop } catch { $json = $null } }
    if ($null -eq $json) { $result.Reason = 'El sondeo de node:sqlite no devolvió un resultado válido.'; return [pscustomobject]$result }

    $result.HasSqlite = ($json.PSObject.Properties['sqlite'] -and $json.sqlite -eq $true)
    $result.HasDatabaseSync = ($json.PSObject.Properties['databaseSync'] -and $json.databaseSync -eq $true)
    $result.HasBackup = ($json.PSObject.Properties['backup'] -and $json.backup -eq $true)

    if (-not $result.HasSqlite) { $result.Reason = "Este Node ($ver) no ofrece el módulo node:sqlite." }
    elseif (-not $result.HasDatabaseSync) { $result.Reason = "node:sqlite de este Node ($ver) no expone DatabaseSync." }
    elseif (-not $result.HasBackup) { $result.Reason = "node:sqlite de este Node ($ver) no expone backup() (se requiere Node >= $MinimumVersion)." }
    elseif (-not $result.VersionOk) { $result.Reason = "Node $ver es anterior a la versión mínima $MinimumVersion." }
    else { $result.Supported = $true }
    [pscustomobject]$result
}
Export-ModuleMember -Function Test-N8nNodeSqliteSupport, Invoke-NodeProcess, Get-N8nNodeVersion, Invoke-N8nSqliteSnapshot
