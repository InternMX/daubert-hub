# Cancelación individual Caterpillar (fase 2)

Estado: código implementado; migración **preparada, NO aplicada a Daubert TEST/PROD**.
No habilita recuperación de folios, sustitución ni generación de PDF.

Revisión 2B, seguridad residual, checks estrictos y procedimiento ejecutable:
[test-cancellation-e2e](test-cancellation-e2e.md). No ejecutar el runner TEST sin autorización.

## Contrato

`POST /api/automations/remissions/caterpillar/executions/:executionId/remittances/:remissionId/cancel`

- Autenticación y `RolesGuard` existente; solo ADMIN. CSRF y política de contraseña globales no cambian.
- IDs como cadenas int8 positivas (sin conversión por Number).
- Body exclusivo: `{ reason, expectedRevision }`. Motivo trim, 1–500 caracteres.
- `expectedRevision`: texto UTC exacto de `remisiones.updated_at`, seis dígitos de microsegundos:
  `2026-10-20T12:00:00.123456Z`. Se compara como texto en PostgreSQL; no pasa por Date de JS.
- La fecha es una revisión, no una prueba de que el documento no se haya enviado.
- 200: `{ data: { status: 'CANCELLED' | 'ALREADY_CANCELLED', remissionId, cancellationReason, cancellation } }`.
- `cancellation`: ID, usuario (nullable si fue borrado), nombre/email históricos, fecha y request ID.
- 400: IDs/body inválidos; 401: sin sesión; 403: sin rol o actor DB no elegible;
  404: ejecución/remisión desconocida, ajena o de otra automatización; 409: estado/revisión;
  503: función no instalada o resultado no confirmado. 5xx saneados por el filtro global.
- Si se pierde la respuesta, consultar/reintentar. Error de red NO significa que la cancelación no ocurrió.

## Transacción y permisos propuestos

Archivos `database/migrations/daubert_global/20261020_013_caterpillar_cancellation.{up,down,precheck,postcheck}.sql`.
013 es el siguiente número **local** después de 012; confirmar numeración global antes de promover.
Patrón tomado de migraciones 009–012 y fichas de `operacion.remisiones`, `security.users`.

`operacion.fn_cancelar_remision_caterpillar(bigint,bigint,text,text,bigint,text)`:

1. Valida argumentos y actor ADMIN/ACTIVE/sin cambio de contraseña pendiente. El usuario viene de la sesión,
   nunca del body; nombre/email se resuelven en `security.users` sin leer credenciales.
2. Bloquea ejecución con `FOR UPDATE OF e`, filtrando `REMISIONES_CATERPILLAR`.
3. Bloquea remisión exacta y verifica pertenencia. Orden ejecución→remisión coherente con finalización.
4. Solo permite ejecuciones terminales (`COMPLETADA`, `ERROR`, `CANCELADA`).
5. Si ya está CANCELADA, devuelve la evidencia original: no comprueba revisión obsoleta, no sobrescribe
   motivo y no crea otra auditoría. Esta precedencia permite reintentar la petición original.
6. En otro caso exige GENERADA y revisión vigente; cambia solo `estatus` y `motivo_cancelacion`.
7. Inserta `operacion.cancelaciones_remisiones` en la misma sentencia/transacción. Un error revierte todo.

El ledger tiene identity PK, UNIQUE remision_id/FK RESTRICT, motivo, usuario/FK SET NULL, snapshots de
nombre/email, fecha `clock_timestamp()` y request ID. No hay backfill ni actor inventado para cancelaciones
históricas. El trigger existente actualiza `remisiones.updated_at`; no se cambia su definición.

La función es SECURITY DEFINER, propietario postgres, search_path fijo y tablas calificadas.
Solo se concede EXECUTE y SELECT del ledger al rol del entorno:

- `daubert_global`: `daubert_hub_app`.
- `daubert_hub_test`: `daubert_hub_test_user`.

No se concede UPDATE general de remisiones, escritura directa del ledger ni uso de su secuencia.
Se eliminan ACLs por defecto de los objetos nuevos antes de otorgar los permisos mínimos; PUBLIC/n8n
no reciben EXECUTE. No se alteran roles ni grants de objetos históricos. El Hub es un llamador técnico
confiable: la autenticación de la persona sigue siendo responsabilidad del backend, no de un user ID SQL.

La migración solo admite esas dos bases bajo postgres, falla si ya existen los objetos y no modifica filas
operativas. El rollback rechaza ledger con historia. Pre/postcheck quedan como código para un operador
autorizado futuro; se deben comparar líneas base de series/reservas y ACLs. No ejecutarlos por defecto.

## Lectura y frontend

El detalle expone revisión exacta, motivo y auditoría. Antes de instalar 013, el repositorio consulta
`to_regclass` y omite solo la nueva consulta de auditoría; el detalle y reproceso siguen disponibles.
Un intento de cancelar antes de instalar la función falla cerrado con 503.

La pantalla existente contiene la acción por remisión GENERADA para ADMIN, oculta en PROCESSING.
El proceso se resuelve solo si la serie tiene una ruta inequívoca en el catálogo: Torreón compartido
queda como «Proceso no determinado». Es configuración actual, no prueba de una planta histórica.
El diálogo confirma ejecución, ID de remisión, serie, folio y proceso; exige motivo y advierte:
no recupera folios, no borra PDF, no verifica envío al cliente. No hay actualización optimista.
Al confirmar se refrescan detalle/lista. Al conflicto se exige cerrar/refrescar; al volver se relee detalle.

No cambia otra remisión, detalle, PDF, ejecución histórica, reserva, consecutivo ni piso.
Una COMPLETADA puede contener cancelaciones posteriores sin reescribir su estado histórico.
El contador de remisiones GENERADA refleja las que permanecen vigentes, no una reejecución.

## Pruebas y límites de evidencia

- `caterpillar-cancellation.http.spec.ts`: HTTP simulado con autenticación fake, RolesGuard/DTO/controlador/
  servicio reales, persistencia mock. No es E2E con Daubert.
- `caterpillar-cancellation.sql.spec.ts`: PostgreSQL WASM PGlite en memoria, sin URL/env/Pools/sockets.
  Usa un esquema mínimo derivado del contrato versionado. Ejecuta el SQL propuesto en esa base efímera;
  adapta **solo en memoria** la allowlist de nombre de base, porque PGlite se llama postgres.
  Comprueba ACL, microsegundos, estados, preservación, auditoría/idempotencia y rollback con trigger fallido.
  Promise.all prueba peticiones concurrentemente enviadas, pero PGlite las serializa en un backend.
- Frontend: diálogo, cliente HTTP y flujo real de página con mocks, incluidos permisos y refresco.
- PGlite es dependencia dev, no una base de ejecución de la aplicación. Justifica package-lock actualizado.

Se verificó contención con dos backends PostgreSQL nativos en un clúster local propio, creado y eliminado
por el runner efímero (no Docker ni Daubert). Antes de habilitar: contrastar esquema/grants/triggers y
driver reales TEST y ejecutar el E2E preparado con autorización. No se ejecutó contra Daubert.
No correr los runners históricos de integración con fixtures reales para validar esta funcionalidad.

## Regeneración posterior (no implementada)

1. Sustitución: seleccionar IDs, validar programación corregida/manifest, registrar solicitud durable e
   idempotente, cancelar originales con esta función y producir sustitutos mediante el pipeline existente.
   Registrar relación original→sustituta (puede requerir división/agrupación), sin reutilizar reproceso
   de COMPLETADA como atajo. Conservar motivos, PDFs y resultado de cada etapa; fallo posterior no reactiva
   originales. Los nuevos folios pasan por el mecanismo de reservas existente.
2. PDF exclusivo: snapshot versionado del payload/plantilla y nueva versión de archivo auditada;
   no crear ejecución operativa/remisión ni reservar folios. El modelo actual pierde OC/unidad estructurada,
   empaque y otros datos de renderizado: documentos históricos necesitan evidencia verificable antes de habilitar.
3. Recuperación excepcional: operación separada, evidencia de emisión/distribución, autorización acotada a
   IDs/folios vigentes, bloqueos y auditoría. No bajar contador al cancelar, no borrar reservas ni ignorar
   APLICADA/ABANDONADA. No se diseña aquí un segundo allocator ni se implementa bypass alguno de 12B;
   su integración con la reserva existente necesita una fase y aprobación propias.

Incidente P5 20/10/2026: ejecuciones 14/22, folios históricos 128–137 según usuario. Los fixtures no son
una copia de la base real ni afirman disponibilidad. Faltan archivos/versiones, fechas F4, OC, catálogos,
manifests, trazas n8n y evidencia de cancelación/recuperación/emisión posterior para cerrar causa y alcance.
