-- SOLO LECTURA. Huella MD5 del contenido de cada tabla de usuario (todas las filas, ordenadas por su texto), fuera del esquema `manufactura`.
-- Sirve para demostrar que una migracion no altero datos preexistentes: la salida ANTES y DESPUES debe ser identica.
--   psql -X -At -F '|' -v ON_ERROR_STOP=1 -f huellas-datos.readonly.sql -d <base>
SET default_transaction_read_only = on;
SELECT table_schema || '.' || table_name AS tabla,
       (xpath('/row/h/text()', query_to_xml(format('SELECT md5(coalesce(string_agg(t::text, E''\n'' ORDER BY t::text), '''')) AS h FROM %I.%I t', table_schema, table_name), false, true, '')))[1]::text AS md5_filas
FROM information_schema.tables
WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'manufactura')
ORDER BY 1;
