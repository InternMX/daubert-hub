-- 015 PRODUCCION - PRECHECK. SOLO LECTURA (BEGIN READ ONLY ... ROLLBACK). Ejecutar con un administrador conectado a daubert_global ANTES del up.
-- Esperado: las guardas pasan, la seccion 3 devuelve 0 filas y se REGISTRAN los valores de la seccion 4 (linea base).
\set ON_ERROR_STOP on
\pset pager off
BEGIN READ ONLY;
\echo '== 1. Base destino y privilegios =='
SELECT current_database() AS db, current_user AS usuario, current_database() = 'daubert_global' AS ok_base,
       has_schema_privilege(current_user, 'core', 'CREATE') AS puede_crear_en_core;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '015 es solo para daubert_global; conectado a %', current_database(); END IF;
  -- El precheck es de solo lectura y puede ejecutarse con un usuario de lectura (p. ej. el de respaldos). El privilegio CREATE sobre core se exige en el UP.
  IF NOT has_schema_privilege(current_user, 'core', 'CREATE') THEN RAISE NOTICE 'Aviso: este usuario no tiene CREATE en core; el UP exigira una conexion administrativa'; END IF;
  IF to_regclass('core.correos_notificacion_pago') IS NULL OR to_regclass('core.empresas') IS NULL
     OR to_regclass('core.resultados_notificacion_pago') IS NULL OR to_regclass('core.borradores_notificacion_pago') IS NULL
     OR to_regprocedure('audit.fn_registrar_cambio()') IS NULL THEN
    RAISE EXCEPTION 'Falta infraestructura existente de Pagos/auditoria';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'n8n_app') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'daubert_hub_app') THEN
    RAISE EXCEPTION 'Faltan los roles n8n_app y/o daubert_hub_app';
  END IF;
  IF NOT has_schema_privilege('n8n_app', 'core', 'USAGE') OR NOT has_schema_privilege('daubert_hub_app', 'core', 'USAGE') THEN
    RAISE EXCEPTION 'n8n_app y daubert_hub_app necesitan USAGE sobre el esquema core (hoy ya lo usan para Pagos)';
  END IF;
  IF to_regclass('core.archivos_notificacion_pago') IS NOT NULL OR to_regclass('core.asignaciones_archivo_notificacion_pago') IS NOT NULL
     OR to_regprocedure('core.fn_registrar_archivo_notificacion_pago(bigint,text,text,integer,text,text,text,text,boolean,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '015 ya aplicada parcial o totalmente: inspeccionar, no sobrescribir';
  END IF;
END $guard$;

\echo '== 2. Auditoria: el Hub escribira asignaciones con el trigger de auditoria (informativo: SECURITY DEFINER o permiso directo) =='
SELECT p.oid::regprocedure AS funcion, p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS propietario
FROM pg_proc p WHERE p.oid = 'audit.fn_registrar_cambio()'::regprocedure;

\echo '== 3. Catalogo: plantillas de ruta que la politica de zona rechazaria (esperado: 0 filas) =='
SELECT empresa_id, nombre_comercial, ruta_destino FROM core.vw_catalogo_notificacion_pago_n8n
WHERE ruta_destino ~ '(^|[\\/])\.\.([\\/]|$)' OR ruta_destino ~ '^[A-Za-z]:' OR ruta_destino ~ '^[\\/]' LIMIT 20;

\echo '== 4. Linea base (registrar; el postcheck NO exige igualdad porque Pagos sigue operando) =='
SELECT (SELECT count(*) FROM core.correos_notificacion_pago) AS correos,
       (SELECT count(*) FROM core.resultados_notificacion_pago) AS resultados,
       (SELECT count(*) FROM core.borradores_notificacion_pago) AS borradores,
       (SELECT count(*) FROM core.vw_catalogo_notificacion_pago_n8n) AS filas_catalogo,
       (SELECT count(*) FROM core.alias_empresa) AS alias,
       (SELECT count(*) FROM core.correos_notificacion_pago WHERE estado = 'PENDIENTE') AS correos_pendientes;

\echo '== 5. Privilegios por defecto sobre core (informativo; la 015 revoca explicitamente) =='
SELECT pg_get_userbyid(defaclrole) AS definidor, defaclobjtype AS tipo, defaclacl::text AS acl
FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE n.nspname = 'core';
ROLLBACK;
