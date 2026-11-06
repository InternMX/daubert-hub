-- 015 PRODUCCION: reversa administrativa. Solo procede si NO hay archivos ni asignaciones registrados.
-- Tras el primer uso real, la recuperacion es: desactivar el Hub + revertir el workflow; las tablas se conservan.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'daubert_global' THEN RAISE EXCEPTION '015 down solo para daubert_global'; END IF;
  IF EXISTS (SELECT 1 FROM core.archivos_notificacion_pago)
     OR EXISTS (SELECT 1 FROM core.asignaciones_archivo_notificacion_pago) THEN
    RAISE EXCEPTION 'Refusing rollback: registered files or assignment history exist';
  END IF;
END $guard$;
DROP FUNCTION core.fn_bloquear_archivos_reproceso_pago(bigint);
DROP FUNCTION core.fn_archivo_notificacion_asignable(bigint,bigint,boolean);
DROP FUNCTION core.fn_resolver_archivo_notificacion_pago(bigint,bigint,text,text,integer,text,boolean);
DROP FUNCTION core.fn_registrar_archivo_notificacion_pago(bigint,text,text,integer,text,text,text,text,boolean,boolean);
DROP TABLE core.asignaciones_archivo_notificacion_pago;
DROP TABLE core.archivos_notificacion_pago;
COMMIT;
