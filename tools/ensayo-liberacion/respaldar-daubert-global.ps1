# Respaldo COMPLETO y de SOLO LECTURA de daubert_global (Fase 6B.1). Lo ejecuta una persona con su propia contrasena; el script nunca la guarda, imprime ni escribe en disco.
#   powershell -ExecutionPolicy Bypass -File tools\ensayo-liberacion\respaldar-daubert-global.ps1
# Opciones: -Usuario postgres  -Servidor localhost  -Puerto 5432  -Destino C:\Users\06\Documents\Daubert\Respaldos_PostgreSQL
# Solo ejecuta SELECT (comprobaciones previas), pg_dump y pg_dumpall --globals-only. No escribe nada en PostgreSQL. No sobrescribe respaldos existentes.
param(
  [string]$Usuario = 'postgres', [string]$Servidor = 'localhost', [int]$Puerto = 5432,
  [string]$Destino = 'C:\Users\06\Documents\Daubert\Respaldos_PostgreSQL',
  [string]$PG = 'C:\Program Files\PostgreSQL\18\bin',
  [int]$MaxConsultaActivaSegundos = 300
)
$ErrorActionPreference = 'Stop'
$Base = 'daubert_global'
$sello = Get-Date -Format 'yyyyMMdd_HHmmss'
$dump = Join-Path $Destino "${Base}_completo_$sello.dump"
$roles = Join-Path $Destino "${Base}_roles_$sello.sql"
$toc = Join-Path $Destino "${Base}_completo_$sello.toc.txt"
$manifiesto = Join-Path $Destino "${Base}_completo_$sello.manifiesto.txt"
$filas = Join-Path $Destino "${Base}_filas_origen_$sello.txt"
$huellasSql = Join-Path $PSScriptRoot '..\..\database\migrations\daubert_global\20261108_000_manufactura_prod_verificar_fuera_de_manufactura.readonly.sql'

foreach ($f in $dump, $roles, $toc, $manifiesto, $filas) { if (Test-Path $f) { throw "Ya existe $f; no se sobrescribe." } }
if (-not (Test-Path $Destino)) { throw "No existe el destino $Destino" }
$libre = (Get-PSDrive -Name ($Destino.Substring(0, 1))).Free
if ($libre -lt 20GB) { throw "Espacio libre insuficiente en el destino: $([math]::Round($libre/1GB,1)) GB" }

$seg = Read-Host -Prompt "Contrasena de PostgreSQL para el usuario '$Usuario' (no se muestra)" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
$env:PGCONNECT_TIMEOUT = '10'
try {
  $conn = @('-h', $Servidor, '-p', $Puerto, '-U', $Usuario)
  function Psql($sql, $db = $Base) { & "$PG\psql" @conn -d $db -X -At -F '|' -v ON_ERROR_STOP=1 -c "SET default_transaction_read_only = on; $sql" 2>&1 | Where-Object { $_ -ne 'SET' } }

  Write-Host '== Comprobaciones previas (solo lectura) =='
  $ident = Psql 'SELECT current_database(), current_user, current_setting(''server_version''), current_setting(''default_transaction_read_only''), pg_is_in_recovery()'
  Write-Host "Conexion: $ident"
  if (($ident -split '\|')[0] -ne $Base) { throw "La conexion no es a $Base." }
  $tam = Psql "SELECT pg_size_pretty(pg_database_size('$Base'))"
  Write-Host "Tamano de la base: $tam"
  # Actividad: consultas largas, transacciones abiertas o mantenimiento que el respaldo pudiera interferir.
  $act = Psql "SELECT pid, usename, application_name, state, round(extract(epoch FROM now() - GREATEST(query_start, xact_start)))::int AS seg, left(regexp_replace(query, '\s+', ' ', 'g'), 60) FROM pg_stat_activity WHERE datname = '$Base' AND pid <> pg_backend_pid() AND (state <> 'idle' OR xact_start IS NOT NULL) ORDER BY seg DESC NULLS LAST"
  Write-Host 'Sesiones activas o en transaccion (pid|usuario|aplicacion|estado|seg|consulta[0..60]):'; if ($act) { $act | ForEach-Object { Write-Host "  $_" } } else { Write-Host '  ninguna' }
  $largas = @($act | Where-Object { $_ -and ([int](($_ -split '\|')[4])) -gt $MaxConsultaActivaSegundos })
  if ($largas.Count -gt 0) { throw "Hay $($largas.Count) sesion(es) con mas de $MaxConsultaActivaSegundos s activas: el respaldo podria interferir. Detenido; reporta antes de continuar." }
  $mant = Psql "SELECT count(*) FROM pg_stat_activity WHERE query ~* '^(vacuum full|reindex|cluster|alter table|create index|lock table)' AND pid <> pg_backend_pid()"
  if ([int]$mant -gt 0) { throw 'Hay una operacion de mantenimiento/DDL en curso. Detenido.' }
  $ya = Psql "SELECT to_regnamespace('manufactura') IS NULL"
  Write-Host "El esquema manufactura aun no existe en el origen: $ya"

  Write-Host '== Linea base de solo lectura =='
  Psql "SELECT table_schema || '.' || table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY 1" | Out-File -Encoding utf8 $filas
  Write-Host "Conteos por tabla: $filas"

  Write-Host '== pg_dump (formato custom, lectura) =='
  # --lock-wait-timeout evita esperar indefinidamente un bloqueo; pg_dump solo toma ACCESS SHARE y usa una transaccion REPEATABLE READ de solo lectura.
  & "$PG\pg_dump" @conn -d $Base -F c -Z 6 --lock-wait-timeout=10000 -f $dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump termino con codigo $LASTEXITCODE" }
  & "$PG\pg_dumpall" @conn --globals-only --no-role-passwords -f $roles
  if ($LASTEXITCODE -ne 0) { throw "pg_dumpall termino con codigo $LASTEXITCODE" }
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

& "$PG\pg_restore" -l $dump | Out-File -Encoding utf8 $toc
if ($LASTEXITCODE -ne 0) { throw 'pg_restore -l no pudo leer el catalogo del respaldo.' }
$h = Get-FileHash -Algorithm SHA256 $dump, $roles
$lineas = @("Respaldo $Base - $sello", "Servidor: ${Servidor}:$Puerto  Usuario: $Usuario", "Version pg_dump: $(& "$PG\pg_dump" --version)", '')
foreach ($x in $h) { $lineas += "{0}  {1}  {2} bytes" -f $x.Hash, (Split-Path $x.Path -Leaf), (Get-Item $x.Path).Length }
$lineas += "Entradas del catalogo (TOC): $((Get-Content $toc | Where-Object { $_ -and -not $_.StartsWith(';') }).Count)"
$lineas | Out-File -Encoding utf8 $manifiesto
$lineas | ForEach-Object { Write-Host $_ }
Write-Host "Listo. Manifiesto: $manifiesto"

