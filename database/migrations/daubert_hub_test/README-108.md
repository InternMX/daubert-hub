# Migración 108 · Recuperación de ejecuciones Audi

**Estado: PROPUESTA, NO APLICADA a `daubert_hub_test`.** Solo TEST. Requiere autorización expresa y el rol administrativo `postgres` en una sesión interactiva de psql con `-W`.

Archivos de la migración: `20261118_108_audi_execution_recovery_test.{precheck,up,postcheck,down}.sql` y `20261118_108_audi_worker_role_test.template.sql`. Las pruebas en `apps/api/test/audi-recovery.sql.spec.ts` usan PGlite con un esquema sintético y ejercitan la admisión, los intentos, la evidencia y la restricción de reversa.

## Qué crea

- `ops.acciones_recuperacion_ejecucion` registra los intentos y su vigencia.
- `operacion.reservas_admitidas_audi_test` identifica las reservas creadas por la admisión de Audi. `operacion.artefactos_ejecucion` registra la evidencia versionada.
- Las funciones `*_audi_test` de `ops` y `operacion` implementan el detalle, la elegibilidad, la autorización, la gestión y expiración de intentos, la admisión con reserva, el registro de evidencia, la finalización y la cancelación.
- `trg_audi_accion_terminal` y `trg_audi_evidencia_inmutable` usan `ops.fn_proteger_historial_audi_test` para impedir cambios o borrados de intentos terminales y evidencia.
- El UP revoca los permisos de otros roles y de `PUBLIC` sobre los objetos nuevos y concede a `daubert_hub_test_user` únicamente `EXECUTE` sobre `ops.fn_detalle_recuperacion_audi_test`, `ops.fn_autorizar_accion_audi_test`, `ops.fn_expirar_acciones_audi_test` y `ops.fn_fallar_despacho_accion_audi_test`.

## Lo que NO hace

La instalación no toca Caterpillar, `daubert_global`, n8n ni los datos existentes. La ejecución 30 y los folios 983–987 quedan intactos. Los permisos del worker se tramitan por separado con la plantilla.

## Procedimiento (operador autorizado)

1. Verificar los SHA-256 y contar con un respaldo verificable de TEST.
2. Ejecutar `precheck` en `daubert_hub_test` y guardar `series_md5` y `cat_functions_md5` como línea base. Revisar los avisos `BLOCKER:` y verificar que el flujo de ERROR conserve la reserva de Audi.
3. Confirmar con evidencia las condiciones R2–R4 y obtener autorización expresa antes de ejecutar `up`.
4. En la sesión del `postcheck`, establecer `audi_recovery.series_md5` y `audi_recovery.cat_functions_md5` con los valores del precheck. Ejecutar `postcheck` y exigir `ALL_CHECKS_PASS` y ambas huellas intactas.
5. Solo tras confirmar R3, ejecutar la plantilla con `worker_role` y comprobar los permisos efectivos del worker.

## Condiciones bloqueantes R2–R4

- **R2.** Verificar el bloqueo de la fila de serie por el asignador legado y aprobar un corte con una sola versión activa del workflow. Ambos asignadores avanzan el contador `REMISION_AUDI`.
- **R3.** Confirmar el rol efectivo de la credencial Audi en n8n TEST, revisar los permisos heredados y aprobar el acceso mínimo del worker.
- **R4.** Confirmar exactamente una ruta activa de `REMISION_AUDI` a `REMISIONES_AUDI`.

## Reversa y su restricción

`down` elimina los objetos de la 108 solo cuando las tablas de intentos, evidencia y reservas admitidas están vacías. Si existe historial en cualquiera de ellas, aborta. En ese caso se conserva el historial y se corrige hacia adelante.

## SHA-256 (contenido en git, LF)

```
c4c97ef4c329d0d111f4a0950a6d5647d807ea667a765fd49d6bbed72b08e718  20261118_108_audi_execution_recovery_test.precheck.sql
1a42070c9db244556d7fe4a6efccdd280e79a8d5d614e669d76db35469d44e21  20261118_108_audi_execution_recovery_test.up.sql
04fa675a410568530dc983452100bc695235d60e126058928d2ffb7fc342c008  20261118_108_audi_execution_recovery_test.postcheck.sql
145f9c7592697017be7cfb4ca934db6b93bbebefbfebd546e64dce22e1ca180f  20261118_108_audi_execution_recovery_test.down.sql
f25f57b0274eb5d82a4cce7b47deb14c980c1f3ea2bee93950fea278759fd206  20261118_108_audi_worker_role_test.template.sql
```
