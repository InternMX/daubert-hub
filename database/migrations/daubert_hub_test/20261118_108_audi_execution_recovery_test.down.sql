BEGIN;
SET LOCAL lock_timeout = '10s';
DO $guard$
BEGIN
  IF current_database() <> 'daubert_hub_test' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '108 down requires postgres exclusively in daubert_hub_test';
  END IF;
END;
$guard$;

LOCK TABLE ops.acciones_recuperacion_ejecucion, operacion.artefactos_ejecucion,
  operacion.reservas_admitidas_audi_test IN ACCESS EXCLUSIVE MODE;

DO $history$
BEGIN
  IF EXISTS (SELECT 1 FROM ops.acciones_recuperacion_ejecucion)
    OR EXISTS (SELECT 1 FROM operacion.artefactos_ejecucion)
    OR EXISTS (SELECT 1 FROM operacion.reservas_admitidas_audi_test) THEN
    RAISE EXCEPTION '108 rollback blocked by Audi recovery history';
  END IF;
END;
$history$;

DROP FUNCTION ops.fn_detalle_recuperacion_audi_test(bigint);
DROP FUNCTION ops.fn_autorizar_accion_audi_test(bigint,text,text,text,bigint,text);
DROP FUNCTION ops.fn_expirar_acciones_audi_test(integer);
DROP FUNCTION ops.fn_fallar_despacho_accion_audi_test(bigint,text);
DROP FUNCTION ops.fn_admitir_reservar_audi_test(bigint,text,integer,jsonb,bigint,bigint,uuid);
DROP FUNCTION operacion.fn_registrar_artefacto_audi_test(bigint,text,bigint,uuid,text,bigint,text,bigint,text,text);
DROP FUNCTION ops.fn_finalizar_audi_test(bigint,text,bigint,uuid);
DROP FUNCTION ops.fn_completar_cancelacion_audi_test(bigint,text,uuid,boolean,jsonb);
DROP FUNCTION ops.fn_cerrar_accion_audi_test(bigint,text,uuid,text,text);
DROP FUNCTION ops.fn_reclamar_accion_audi_test(bigint,text);
DROP FUNCTION ops.fn_latido_accion_audi_test(bigint,text,uuid);
DROP FUNCTION ops.fn_elegibilidad_audi_test(bigint,text);
DROP FUNCTION ops.fn_validar_intento_audi_test(bigint,text,uuid,boolean);
DROP FUNCTION ops.fn_renovar_intento_audi_test(bigint);
DROP FUNCTION operacion.fn_insertar_version_audi_test(bigint,text,bigint,text,bigint,text,bigint,text,text,boolean);
DROP TABLE operacion.artefactos_ejecucion, operacion.reservas_admitidas_audi_test, ops.acciones_recuperacion_ejecucion;
DROP FUNCTION ops.fn_proteger_historial_audi_test();
COMMIT;
