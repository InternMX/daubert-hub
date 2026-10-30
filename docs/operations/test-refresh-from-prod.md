# Refresco de `daubert_hub_test` desde un respaldo de `daubert_global` (procedimiento FUTURO)

**Estado: DOCUMENTADO, NO AUTORIZADO, NO EJECUTADO.** Este procedimiento no forma parte de la migración del Gestor Documental. Sirve para reconstruir TEST cuando se decida (por ejemplo, tras un daño irreparable de TEST o para probar con datos recientes). No se restaura producción, no se modifica `daubert_global` ni sus respaldos, y no se toca la infraestructura productiva. Sin secretos en este documento.

## Principios

1. **Producción es solo origen de lectura.** Se usa un respaldo **ya existente** (tareas `Daubert - PostgreSQL Daily`/`Monthly`, cifrados con age en `…\BACKUPS\DAUBERT HUB\POSTGRESQL`) y nunca se escribe en `daubert_global`. No se mueve, renombra ni borra ningún respaldo.
2. **Nunca se restaura sobre `daubert_global`** ni se deja que un script elija el destino: el nombre de la base destino se escribe explícitamente y se verifica (`current_database()`) antes de cada paso.
3. **Se valida primero en una base temporal** y solo después se decide si se reemplaza TEST.
4. **TEST no debe poder producir efectos reales** (correos, Dropbox, webhooks, folios de producción) con datos reales de producción.
5. **Datos sensibles:** lo que no se necesita para probar se anonimiza o se elimina **antes** de exponer la base a la aplicación o a n8n.

## Prerrequisitos y límites conocidos

- **Descifrado:** los respaldos están cifrados con age y la llave privada está fuera de línea. **El descifrado y la restauración completa nunca se han demostrado**; esta es la primera vez que se probarían. Se hace en una estación autorizada, el archivo descifrado vive solo en una carpeta protegida de trabajo y su eliminación posterior requiere autorización expresa.
- **Compatibilidad:** el servidor y el contenedor de ensayo deben usar la misma versión mayor de PostgreSQL que generó el respaldo (hoy 18).
- **Roles:** un respaldo de una sola base no contiene los roles. Se restaura con `--no-owner --no-acl` y se vuelven a conceder los privilegios de los roles de TEST (`daubert_hub_test_user`, roles de n8n de TEST) conforme a las migraciones TEST.
- **Credenciales de n8n** están en el SQLite de n8n, no en la base: este procedimiento no las toca. Pero **la credencial de Outlook se comparte entre TEST y PROD**, por lo que los controles de la fase B son críticos.

## Fase A · Ensayo en una base temporal y desechable

1. Elegir el respaldo reciente (Daily más nuevo con SHA-256 coincidente) y copiarlo a una carpeta de trabajo **nueva** (el original no se toca).
2. Descifrar con age en la estación autorizada (llave privada fuera de línea; no se imprime ni se guarda en el repositorio). Registrar hash y tamaño.
3. Levantar un PostgreSQL **desechable** (contenedor temporal ligado a `127.0.0.1`, sin volúmenes, como el arnés `apps/api/test/desechable`) o una base temporal con nombre explícito (por ejemplo `ensayo_refresh_YYYYMMDD`). Para poder ejecutar después las migraciones TEST, cuyos guardas exigen el nombre `daubert_hub_test`, el ensayo en contenedor debe llamar `daubert_hub_test` a su base (dentro del contenedor desechable no es TEST real).
4. `pg_restore --list` del dump y luego `pg_restore --no-owner --no-acl -d <base_temporal>`. Registrar errores y objetos faltantes (extensiones, roles).
5. Verificar conteos de tablas clave contra el origen documentado y que no haya conexiones a bases reales.

## Fase B · Saneamiento (en la base temporal, antes de cualquier uso)

Lista de verificación **a confirmar tabla por tabla con el esquema real** antes de ejecutar (las columnas exactas no se asumen aquí):

| Categoría | Tablas / elementos | Tratamiento propuesto |
| --- | --- | --- |
| Cuentas del Hub | `security.users`, `security.sessions` | Eliminar todas las sesiones; sustituir los hashes de contraseña por un valor inutilizable y crear cuentas de prueba controladas (1 ADMIN + 2 GENERAL) con cambio de contraseña obligatorio; correos reales reemplazados por `*@example.invalid` salvo las cuentas de prueba |
| Datos personales y fiscales | `core.contactos`, `core.medios_contacto`, `core.direcciones`, `core.empresas_fiscales`, `core.snapshot_carga_empresas_inicial`, `core.stg_contactos_notificacion_pago` | Anonimizar (nombres, teléfonos, correos, domicilios, identificadores fiscales) o eliminar lo que no se necesite; conservar solo la estructura del catálogo de empresas |
| Notificaciones de pago | `core.empresas_notificacion_pago`, `core.correos_notificacion_pago`, `core.resultados_notificacion_pago`, `core.borradores_notificacion_pago` | **Destinatarios PARA/CC/CCO → `@example.invalid`; «Procesa comprobantes» y «Generar borradores» en falso; rutas Dropbox de producción → rutas de TEST (`Pruebas\NOTIFICACIONES DE PAGO\…`)**; eliminar correos, resultados y borradores históricos |
| Automatizaciones | `ops.automation_trigger_requests`, `ops.ejecuciones_automatizacion`, `ops.automation_review_acknowledgements` | Eliminar solicitudes de disparo pendientes (podrían activar webhooks); revisar ejecuciones en curso (`PROCESANDO`) para que no se retomen |
| Folios y remisiones | `operacion.series_documentales`, `operacion.reservas_folios`, `operacion.remisiones`, `operacion.remision_detalle`, `operacion.ajustes_series` | Decidir: conservar el historial solo para consulta o reiniciar contadores en rangos de TEST; en ningún caso reutilizar una serie productiva activa sin marcarla como TEST |
| Auditoría | `audit.cambios` | Truncar o anonimizar (contiene correos de usuarios y copias de filas) |
| Datos de integración | `staging.*` (BIND), cualquier URL, ruta o token en tablas de configuración | Eliminar o reemplazar por valores de TEST |
| Efectos programados | Extensiones o tareas dentro de la base (p. ej. `pg_cron`: revisar `pg_extension` y sus tablas de tareas), disparadores que llamen a servicios externos | Deshabilitar/eliminar dentro de la base saneada |

Criterios de aceptación de la fase B (consultas de solo lectura): ninguna sesión; ningún correo que no termine en `.invalid` o pertenezca a las cuentas de prueba; todos los indicadores de envío en falso; sin solicitudes de disparo ni ejecuciones en curso; sin rutas de producción.

## Fase C · Migraciones exclusivas de TEST

En la base saneada (llamada `daubert_hub_test`, en el contenedor desechable) reaplicar, **en orden numérico y con precheck → UP → postcheck**, las migraciones que existen solo para TEST: las marcadas `_test` en `database/migrations/daubert_global/` (verificar su estado con [database/migrations](../database/migrations.md)) y las de `database/migrations/daubert_hub_test/`, empezando por la del Gestor Documental (`20261030_101_manufactura_gestor_documental_test`, con su [procedimiento](../manufacturing-document-manager-migration-runbook.md)). Ninguna migración exclusiva de producción se vuelve a aplicar. Ejecutar además los smoke disponibles.

## Fase D · Verificación previa al reemplazo

1. Los postcheck de todas las migraciones y el smoke del Gestor Documental en `true`.
2. Arranque del Hub de TEST contra la base saneada (solo en la máquina de ensayo): login con una cuenta de prueba, Proveedores, Contactos, Notificaciones de pago y Caterpillar en solo lectura.
3. Confirmar que n8n de TEST **sigue inactivo** y apunta a `daubert_hub_test`; que los destinos de webhooks del Hub de TEST son los de TEST; que ningún workflow de producción apunta a TEST.
4. Registro firmado de resultados (sin credenciales ni datos personales).

## Fase E · Reemplazo de TEST (solo con autorización expresa)

1. Ventana sin uso de TEST; detener el Hub de TEST y confirmar sin conexiones a `daubert_hub_test`.
2. **Renombrar** (no borrar) la base actual a `daubert_hub_test_prev_<fecha>` y crear `daubert_hub_test` nueva a partir del volcado de la base saneada y validada; reconceder privilegios a los roles de TEST.
3. Reaplicar/verificar las migraciones TEST y los postcheck en la base definitiva.
4. Arrancar el Hub de TEST y repetir la fase D.
5. Conservar `daubert_hub_test_prev_<fecha>` el tiempo que el responsable decida; revertir = detener el Hub y renombrar de vuelta.

## Qué NO hace este procedimiento

No restaura ni modifica producción; no ejecuta `pg_dump` contra `daubert_global`; no mueve ni borra respaldos; no activa workflows ni envía correos; no contiene ni solicita contraseñas o la llave privada de age.

## Decisiones pendientes del responsable

- Autorización para ejecutar el ensayo (fase A) y quién custodia la llave age.
- Qué datos se conservan (historial de remisiones, catálogo de empresas) y cuáles se anonimizan o eliminan.
- Si se reinician los contadores de folios en TEST.
- Cada cuánto se refrescará TEST y quién puede autorizarlo.
