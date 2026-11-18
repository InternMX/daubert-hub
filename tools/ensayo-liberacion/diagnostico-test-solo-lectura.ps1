# Diagnostico de SOLO LECTURA de daubert_hub_test (Fase posterior a 6E): catalogo de manufactura (101-105), cuentas y clientes. Sesion forzada a solo lectura
# (default_transaction_read_only=on, statement_timeout 15 s). Contrasena: deploy/pilot.test.env, solo al proceso hijo (PGPASSWORD); nunca se imprime. Se niega si DB_NAME no es daubert_hub_test.
param([string]$EnvFile = (Join-Path $PSScriptRoot '..\..\deploy\pilot.test.env'))
$ErrorActionPreference = 'Stop'
$envFile = $EnvFile
$v = @{}
foreach ($l in Get-Content -LiteralPath $envFile) { if ($l -match '^\s*(DB_NAME|DB_USER|DB_PASSWORD|DB_PORT)\s*=\s*(.*?)\s*$') { $v[$Matches[1]] = $Matches[2].Trim('"').Trim("'") } }
if ($v['DB_NAME'] -ne 'daubert_hub_test') { throw 'DB_NAME no es daubert_hub_test: no se consulta nada.' }
$env:PGHOST = '127.0.0.1'; $env:PGPORT = $v['DB_PORT']; $env:PGUSER = $v['DB_USER']; $env:PGDATABASE = 'daubert_hub_test'; $env:PGPASSWORD = $v['DB_PASSWORD']
$env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=15000'
$env:PGAPPNAME = 'diagnostico-6E-solo-lectura'
$sql = @"
select 'base=' || current_database() || ' usuario=' || current_user || ' solo_lectura=' || current_setting('transaction_read_only') || ' version=' || split_part(version(), ' ', 2);
select 'esquema_manufactura=' || count(*) from pg_namespace where nspname='manufactura';
select 'tablas=' || coalesce(string_agg(tablename, ',' order by tablename), '(ninguna)') from pg_tables where schemaname='manufactura';
select 'politicas=' || count(*) || ' respaldo=' || count(*) filter (where policyname='pol_respaldo_sel') from pg_policies where schemaname='manufactura';
select 'm103_fn_firmas_inventario=' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='manufactura' and p.proname='fn_firmas_inventario';
select 'm105_consulta_compartida=' || count(*) from pg_policies where schemaname='manufactura' and policyname='pol_revisiones_sel' and qual like '%BORRADOR%' and qual like '%fn_actor_id() IS NOT NULL%';
select 'sin_rls=' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='manufactura' and c.relkind='r' and not c.relrowsecurity;
select 'usuarios_activos=' || count(*) filter (where status='ACTIVE') || ' admin=' || count(*) filter (where role='ADMIN' and status='ACTIVE') || ' general=' || count(*) filter (where role='GENERAL' and status='ACTIVE') from security.users;
select 'clientes_rol_CLIENTE=' || count(*) from core.empresa_roles where rol='CLIENTE';
"@
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
& $psql -X -q -At -v ON_ERROR_STOP=1 -c $sql 2>&1 | ForEach-Object { [string]$_ }
"psql_exit=$LASTEXITCODE"
# Conteos de manufactura solo si existe el esquema (la cuenta de la aplicacion ve lo que RLS le permite: puede ser menor que el total).
$hay = (& $psql -X -q -At -c "select count(*) from pg_namespace where nspname='manufactura'")
if ([string]$hay -eq '1') {
    & $psql -X -q -At -c "select 'filas_visibles_para_la_app: documentos=' || (select count(*) from manufactura.documentos) || ' revisiones=' || (select count(*) from manufactura.revisiones) || ' finalizadas=' || (select count(*) from manufactura.revisiones where estado='FINALIZADA') || ' entorno=' || coalesce((select string_agg(distinct entorno_emision, ',') from manufactura.revisiones), '-')" 2>&1
    foreach ($t in 'firmas', 'cliente_abreviaturas') { & $psql -X -q -At -c "select '$t=' || count(*) from manufactura.$t" 2>&1 }
}
Remove-Item Env:PGPASSWORD
