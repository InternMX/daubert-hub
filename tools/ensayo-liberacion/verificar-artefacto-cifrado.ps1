<#
.SYNOPSIS
    Comprobacion del ARTEFACTO FINAL de un respaldo de PostgreSQL (el .age publicado), no solo del pg_dump: sidecar SHA-256 -> estructura age -> descifrado ->
    desempaquetado -> integridad del volcado con restauracion en una instancia Docker SIN RED -> borrado del texto plano. Windows PowerShell 5.1.

.DESCRIPTION
    Lo ejecuta EL CUSTODIO AUTORIZADO de la clave privada, en una ESTACION DE RECUPERACION (no en el host productor de respaldos), durante la liberacion.
    Este script no busca claves: usa unicamente el archivo de identidad que el custodio le indica (-IdentityFile) y nunca muestra su contenido.
    Solo lee el artefacto; no modifica el respaldo publicado ni ninguna base real. El texto plano solo existe en -WorkDir y se borra al terminar (tambien si falla).

    Controles (cualquier FAIL => ARTEFACTO_CIFRADO_RECHAZADO, exit 1; un exit 0 del trabajo de respaldo NO basta):
      1. Existe <artefacto>.sha256 y coincide con el SHA-256 del .age (deteccion de corrupcion/alteracion en transito o en el destino).
      2. Cabecera age-encryption.org/v1 y tamano plausible.
      3. age -d con la identidad indicada termina bien (age autentica el contenido: un .age alterado o cifrado para otra clave no descifra).
      4. El contenido es un .dump (Frequent) o un .7z sin cifrar con .dump + schema-only (+ globals en Monthly); se extrae.
      5. El volcado principal pasa verificar-respaldo-manufactura.cjs --restaurar (catalogo, 9 tablas y 9+33 politicas de manufactura, restauracion, bytes y SHA-256 de PDF y firmas,
         conteos). Con -Previo (respaldo anterior a las migraciones) se omiten los controles propios de Manufactura.
      6. Si hay globals (Monthly): no contiene contrasenas de roles.

.EXAMPLE
    powershell -File verificar-artefacto-cifrado.ps1 -Artifact D:\recuperacion\daubert_global_FREQUENT_20261201_203000.age -IdentityFile E:\custodia\age-identity.txt `
        -WorkDir D:\recuperacion\trabajo -RolesFile D:\recuperacion\globals.sql -FilasOrigen D:\recuperacion\filas_origen.txt
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Artifact,
    [Parameter(Mandatory = $true)][string]$IdentityFile,
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [string]$AgePath = 'age.exe',
    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe',
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
    [string]$RolesFile = '',
    [string]$FilasOrigen = '',
    [switch]$Previo,
    [switch]$KeepPlaintext
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:fails = 0
function Check([bool]$Ok, [string]$Name, [string]$Detail = '') { Write-Host ($(if ($Ok) { 'PASS ' } else { 'FAIL ' }) + $Name + $(if (-not $Ok -and $Detail) { ' :: ' + $Detail } else { '' })); if (-not $Ok) { $script:fails++ }; return $Ok }
function Finish { Write-Host ('RESULTADO: ' + $(if ($script:fails) { "ARTEFACTO_CIFRADO_RECHAZADO ($($script:fails) fallo(s)): NO dar por bueno este respaldo" } else { 'ARTEFACTO_CIFRADO_INTEGRO (todos los controles PASS)' })); exit $(if ($script:fails) { 1 } else { 0 }) }
function Native([string]$Exe, [string[]]$A) { $p = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $o = & $Exe @A 2>&1; $c = $LASTEXITCODE } finally { $ErrorActionPreference = $p }; return [pscustomobject]@{ Code = $c; Out = @($o | ForEach-Object { [string]$_ }) } }

$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\') + '\'
$work = [System.IO.Path]::GetFullPath($WorkDir)
if (($work + '\').StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) { throw '-WorkDir must be OUTSIDE the repository (plaintext of a backup is written there).' }
if (-not (Test-Path -LiteralPath $Artifact)) { throw "Artifact not found: $Artifact" }
if (-not (Test-Path -LiteralPath $IdentityFile)) { throw 'Identity file not found (the custodian provides it; this script never searches for keys).' }
if ((Test-Path -LiteralPath $work) -and @(Get-ChildItem -LiteralPath $work -Force).Count -gt 0) { throw '-WorkDir must be empty or not exist.' }
if (([System.IO.Path]::GetFullPath($IdentityFile)).StartsWith($work + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'The identity file must not be inside -WorkDir.' }
New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
    Write-Host ('Artefacto: ' + (Split-Path -Leaf $Artifact) + '  (' + (Get-Item -LiteralPath $Artifact).Length + ' bytes)')
    # 1. sidecar
    $sidecar = $Artifact + '.sha256'
    $actual = (Get-FileHash -LiteralPath $Artifact -Algorithm SHA256).Hash.ToLower()
    if (-not (Check (Test-Path -LiteralPath $sidecar) 'existe el sidecar .sha256' $sidecar)) { Finish }
    $expected = ([string](Get-Content -LiteralPath $sidecar -Raw)).Trim().Split(' ')[0].ToLower()
    if (-not (Check ($expected -eq $actual) 'el SHA-256 del .age coincide con su sidecar' ("sidecar=$expected real=$actual"))) { Finish }
    # 2. estructura
    $fs = [System.IO.File]::OpenRead($Artifact); try { $buf = New-Object byte[] 64; $n = $fs.Read($buf, 0, 64) } finally { $fs.Dispose() }
    $head = [System.Text.Encoding]::ASCII.GetString($buf, 0, $n)
    if (-not (Check ($head.StartsWith('age-encryption.org/v1') -and (Get-Item -LiteralPath $Artifact).Length -gt 1000) 'cabecera age-encryption.org/v1 y tamano plausible')) { Finish }
    # 3. descifrado
    $plain = Join-Path $work 'contenido.bin'
    $d = Native $AgePath @('-d', '-i', $IdentityFile, '-o', $plain, $Artifact)
    if (-not (Check ($d.Code -eq 0 -and (Test-Path -LiteralPath $plain) -and (Get-Item -LiteralPath $plain).Length -gt 0) 'age descifra el artefacto con la identidad indicada' ('exit ' + $d.Code + ' ' + (($d.Out | Select-Object -First 1) -join '')))) { Finish }
    # 4. contenido
    $fs = [System.IO.File]::OpenRead($plain); try { $m = New-Object byte[] 6; $null = $fs.Read($m, 0, 6) } finally { $fs.Dispose() }
    $is7z = ($m[0] -eq 0x37 -and $m[1] -eq 0x7A -and $m[2] -eq 0xBC -and $m[3] -eq 0xAF -and $m[4] -eq 0x27 -and $m[5] -eq 0x1C)
    $isDump = ([System.Text.Encoding]::ASCII.GetString($m, 0, 5) -eq 'PGDMP')
    $dir = Join-Path $work 'extraido'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
    if ($is7z) {
        $x = Native $SevenZipPath @('x', '-y', ('-o' + $dir), $plain)
        if (-not (Check ($x.Code -eq 0) 'el paquete 7z (sin cifrar) se extrae' ('exit ' + $x.Code))) { Finish }
    }
    elseif ($isDump) { Move-Item -LiteralPath $plain -Destination (Join-Path $dir 'respaldo.dump') }
    else { $null = Check $false 'el contenido descifrado es un volcado de PostgreSQL o un paquete 7z' 'formato no reconocido'; Finish }
    $files = @(Get-ChildItem -LiteralPath $dir -Recurse -File)
    Write-Host ('Contenido: ' + (($files | ForEach-Object { $_.Name + ' (' + $_.Length + ')' }) -join ', '))
    $dumps = @($files | Where-Object { $_.Extension -eq '.dump' })
    $main = @($dumps | Where-Object { $_.Name -notmatch '(?i)schema' } | Sort-Object Length -Descending | Select-Object -First 1)
    if (-not (Check ($main.Count -eq 1) 'el artefacto contiene el volcado completo (.dump)')) { Finish }
    $schema = @($dumps | Where-Object { $_.Name -match '(?i)schema' })
    if ($is7z) { $null = Check ($schema.Count -ge 1) 'el paquete incluye el volcado schema-only' }
    # 5. integridad + restauracion aislada
    $a = @((Join-Path $PSScriptRoot 'verificar-respaldo-manufactura.cjs'), '--dump', $main[0].FullName, '--pg-bin', $PgBin, '--restaurar')
    if ($RolesFile) { $a += @('--roles', $RolesFile) }
    if ($FilasOrigen) { $a += @('--filas-origen', $FilasOrigen) }
    if ($Previo) { $a += '--previo' }
    $v = Native 'node' $a
    $vf = @($v.Out | Where-Object { $_ -like 'FAIL *' })
    foreach ($l in $vf) { Write-Host ('   ' + $(if ($l.Length -gt 200) { $l.Substring(0, 200) } else { $l })) }
    $null = Check ($v.Code -eq 0) ('el volcado pasa la comprobacion de integridad con restauracion aislada (' + @($v.Out | Where-Object { $_ -like 'PASS *' }).Count + ' PASS / ' + $vf.Count + ' FAIL)') ('exit ' + $v.Code)
    # 6. globals
    foreach ($g in @($files | Where-Object { $_.Name -match '(?i)^globals.*\.sql$' })) {
        $txt = Get-Content -LiteralPath $g.FullName -Raw
        $null = Check ($txt -match 'CREATE ROLE' -and $txt -notmatch '(?i)\bPASSWORD\s+''') 'globals: contiene roles y ninguna contrasena'
    }
}
finally {
    if (-not $KeepPlaintext -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue; Write-Host ('Texto plano eliminado: ' + (-not (Test-Path -LiteralPath $work))) }
}
Finish
