-- SOLO LECTURA. Filas por tabla (conteo exacto) de todos los esquemas de usuario. Se ejecuta en la base de origen (con una sesion de solo lectura) y en la replica
-- restaurada; las dos salidas deben ser IDENTICAS (diff) salvo el esquema `manufactura`, que en el origen aun no existe.
--   psql -X -At -F '|' -v ON_ERROR_STOP=1 -f contar-filas.readonly.sql -d <base>   > filas_<origen|replica>.txt
SET default_transaction_read_only = on;
SELECT table_schema || '.' || table_name AS tabla,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS filas
FROM information_schema.tables
WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY 1;
