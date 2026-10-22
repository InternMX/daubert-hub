# Notificaciones de pago

Documentado en la Fase D2 **a partir de los exports reales**. Los JSON **no están versionados** (DO_NOT_VERSION por contener correos y firma corporativa: [n8n/security-notes](../../../n8n/security-notes.md)); la lectura se hizo directamente sobre los originales de Dropbox (sin modificarlos): `HERRAMIENTAS AUTOMATIZACION\NOTIFICACIONES DE PAGO\Produccion Notificacion de pagos a Proveedores.json` (PROD) y `PRUEBAS\NOTIFICACIONES DE PAGO\Test Notificacion de pagos a Proveedores.json` (TEST). **Manda el export.**

| | |
| --- | --- |
| Código de automatización | `PAYMENT_NOTIFICATIONS` |
| Workflow PROD | **`pagosProdAsignaciones01`** (v2, 108 nodos) — activo desde 2026-10-22; el anterior `3Dh72JJYROHtaw1X` (`Produccion Notificacion de pagos a Proveedores`, 100 nodos, versión `887c122b`) queda inactivo como rollback. El resto de este documento describe el export original de 100 nodos; el delta v2 está en [production-rollout](production-rollout.md) |
| Workflow TEST | `Test Notificacion de pagos a Proveedores` — inactivo al exportar, 100 nodos |
| Disparos | **Automático:** `Schedule Trigger` → `Obtener correos Outlook` (sondeo del buzón; intervalo sin valor explícito en el export) · **Manual:** `Reprocesar correo manual` · **Hub:** webhook `POST daubert-hub/notificaciones-pago/reprocesar` |
| Credenciales | `Postgres produccion` / `Postgres pruebas`; `Outlook LOGIN OAUT2` (**la misma en TEST y PROD**); `Daubert Hub - n8n PROD` / `… TEST` (Header Auth del webhook) |
| Error Workflow | PROD: referencia un workflow **sin export** (dependencia ausente). TEST: ninguno |
| Hub | Dashboard, detalle, **reproceso** (`POST /api/automations/payment-notifications/:executionId/reprocess`, sin restricción de rol), acuses de revisión y **configuración por empresa** ([company-configuration](company-configuration.md)) |

## Propósito

Lee correos de Outlook que traen **comprobantes de pago en un ZIP** (del administrador de pagos), extrae cada PDF, lo **clasifica por proveedor** con un catálogo en PostgreSQL, guarda el PDF en la **carpeta del proveedor** en Dropbox, cruza con la **programación semanal de CXP** y **crea en Outlook un borrador** de notificación por proveedor (con comprobantes y facturas adjuntos y la firma corporativa). Al terminar envía un **correo resumen** interno. **No envía nada a los proveedores automáticamente**: sólo crea borradores; sólo el resumen se envía.

## Trigger actual (verificado)

- **Sí existe** un disparador automático: el `Schedule Trigger` sondea la carpeta configurada del buzón de Outlook (`getAll`, límite 10 en PROD y 4 en TEST) — **no** es un trigger por evento de correo de n8n. El valor del intervalo no está explícito en el export (`{"field":"minutes"}`); el catálogo del Hub indica 5 min. **Sin verificar en n8n.**
- Procesa **un correo por ejecución** (`Tomar un correo por ejecución`).
- Existe además el disparo manual y el webhook del Hub para **reprocesar**.

## Mapa de documentos

| Documento | Contenido |
| --- | --- |
| [architecture.md](architecture.md) | Componentes y responsabilidades |
| [workflow.md](workflow.md) | Flujo principal, reproceso y errores (Mermaid); reglas verificadas |
| [nodes-reference.md](nodes-reference.md) | Referencia de nodos |
| [company-configuration.md](company-configuration.md) | **Configuración por empresa desde el Hub** (ruta Dropbox, destinatarios PARA/CC/CCO, readiness, migración 011) |
| [database-contract.md](database-contract.md) | Contrato PostgreSQL |
| [reprocessing.md](reprocessing.md) | Reproceso, contrato con el Hub, **seguridad** |
| [testing.md](testing.md) | Pruebas y promoción |
| [file-assignment-contract.md](file-assignment-contract.md) | **Asignación puntual de archivos**: identidad individual, contrato PostgreSQL/n8n, API e interfaz |
| [production-rollout.md](production-rollout.md) | **Puesta en producción de la asignación puntual** (resumen, implementación, despliegue/rollback, validación y pendientes) |
| [production-runbook.md](production-runbook.md) | Operación en PROD |
| [troubleshooting.md](troubleshooting.md) | Guía de fallos |
| Comparación TEST/PROD | [n8n-test-prod-drift](../n8n-test-prod-drift.md#notificaciones-de-pago) |

## Categorías de proveedor

Las categorías **FLETES**, **PROVEEDORES** y **PROVEEDOR DE SERVICIOS** **no están escritas en el workflow**: llegan del catálogo de PostgreSQL (vista `core.vw_catalogo_notificacion_pago_n8n`, campo `tipo_empresa`) junto con alias del PDF, plantilla de ruta destino, destinatarios PARA/CC/CCO y el indicador `notificaciones_activas`. En TEST existen carpetas `FLETES`, `PROVEEDORES` y `PROVEEDOR DE SERVICIOS` bajo `Pruebas\NOTIFICACIONES DE PAGO`. Tratamiento especial visible en el workflow: importes de **DHL** (`IMPORTES_DHL`, `SIN_IMPORTES_DHL`).

## Configuración de empresas desde el Hub

Desde 2026-09-25 la configuración necesaria para que una empresa participe (ruta Dropbox, destinatarios PARA/CC/CCO, "Procesa comprobantes" y "Generar borradores") se hace **desde el Hub, sin SQL manual**. PostgreSQL sigue siendo la fuente de verdad y n8n (sin cambios) consume el catálogo `core.vw_catalogo_notificacion_pago_n8n`. Detalle, reglas, endpoints y procedimiento: [company-configuration](company-configuration.md).

## Errores de archivo vs resultados por empresa

El Hub separa dos universos:

- **Resultados por empresa** (`core.resultados_notificacion_pago`: `LISTO`/`MANUAL`/`ERROR`/`OMITIDO`). `totalResults` y los contadores por estado cuentan **solo** estos.
- **Errores de archivo**: PDFs que n8n no pudo asociar a ninguna empresa (no tienen `empresa_id`). n8n los registra en `core.correos_notificacion_pago.detalle_error` con el formato `<archivo>: <CODIGO> - <detalle> | HASH=<sha256>`.

Comportamiento del Hub:

- El API los parsea y los expone como `fileErrors` (conteo, en el listado y el detalle) y `fileErrorDetails` (`fileName`, `errorCode`, `detail`, `fileHash`, solo en el detalle). **No** suman a `totalResults` ni se convierten en filas por empresa.
- Se muestran por separado: columna **"Errores archivo"** en el listado y sección **"Archivos que requieren atención"** en el detalle. El hash es un dato técnico y no se muestra.
- Si `detalle_error` trae varios registros (por salto de línea o inline separados por `" | "`), cada uno con un `HASH=` válido se parsea individualmente; lo que no cumple el formato se omite.
- n8n sigue siendo dueño del reproceso selectivo por `correo_id`/hash; este contrato no cambió.

### Asignar un alias permanente desde un error

La gestión está en **Archivos que requieren atención**, dentro del detalle existente de una notificación. El listado general mantiene conteos y un enlace **Ver archivos en el detalle**. En el detalle, una fila compacta por PDF muestra archivo, alias detectado, empresa actual, estado y una sola acción: **Asignar alias** si no hay asociación activa, o **Gestionar alias** si existe. El modal reutiliza el formulario MUI y el buscador `GET /api/companies/search`. Al asignar utiliza el módulo existente de aliases:

- `POST /api/companies/:companyId/aliases/payment-notifications`, cuerpo `{ alias, confirmPermanent?: boolean }`.
- Requiere sesión válida; admite `GENERAL` y `ADMIN`, como el CRUD actual. Aplica las protecciones globales de sesión, cambio obligatorio de contraseña y origen CSRF.
- Inserta exclusivamente en `core.alias_empresa`, con `tipo_alias = NOMBRE_ARCHIVO`, `estatus = ACTIVO`, conservando otros aliases y el contexto de auditoría.
- NestJS calcula `alias_normalizado` con la misma función de `Clasificar con catalogo`: trim → NFD → eliminar diacríticos → mayúsculas → sustituir grupos no alfanuméricos por espacio → compactar espacios → trim. No vuelve a interpretar el nombre del PDF.
- Compara esa clave con todos los aliases activos y nombres comerciales. Una coincidencia en otra empresa devuelve `409 ALIAS_ALREADY_ASSOCIATED`; un alias equivalente ya activo en la misma empresa devuelve éxito con `alreadyAssigned = true`, sin otra inserción.
- Un identificador numérico, una secuencia larga de dígitos, UUID o términos de documento/temporal requiere `confirmPermanent = true`; de otro modo devuelve `400 PERMANENT_ALIAS_CONFIRMATION_REQUIRED` y el modal solicita confirmación adicional. Editar el alias o cambiar la empresa reinicia la confirmación.
- La comprobación y el alta son una transacción auditada corta con bloqueos `SHARE ROW EXCLUSIVE` sobre `core.empresas` y `core.alias_empresa`, en ese orden, para evitar escrituras concurrentes durante la evaluación del catálogo. No hay llamadas externas dentro de la transacción.

El endpoint existente `GET /api/automations/payment-notifications/:executionId` enriquece cada `fileErrorDetails[]` con `aliasResolution` en **cada consulta**. El servicio reutiliza `AliasesService` y la normalización de n8n para resolver `core.alias_empresa` y los nombres comerciales actuales; no depende de confirmaciones temporales del navegador. No se agregó un endpoint de consulta de aliases ni una asignación puntual por archivo/hash.

`aliasResolution` incluye `state`, `company` y, cuando existe un registro independiente, `assignment` con `aliasId`, empresa, estatus, tipo y `updatedAt`. Los estados internos son `UNASSIGNED`, `ACTIVE`, `INACTIVE`, `CONFLICT` y `NAME_ONLY`. `NAME_ONLY` distingue una coincidencia con el nombre comercial, que no se puede desactivar como si fuese un alias independiente.

La fila muestra **Sin asignar** o **Asignado**; una asignación activa lleva **Pendiente de reproceso**, y una desactivación conserva la indicación **Alias desactivado**. `ALIAS_NO_CATALOGADO` permanece en los datos y en el modal como **error histórico**, separado del estado actual. Si no se pudo consultar el estado, la UI muestra estado no disponible y no habilita mutaciones basadas en suposiciones. Después de guardar, se vuelve a consultar el mismo detalle sin desmontar la página; al recargar o volver a abrir se obtiene de nuevo el estado persistido.

Guardar no cambia el estado del correo, los resultados, su `detalle_error`, los destinatarios ni la configuración de la empresa. La vista `core.vw_catalogo_notificacion_pago_n8n` sigue exponiendo el alias según sus filtros existentes (incluido `procesa_comprobantes_pago`); el alta no activa esa configuración. No requiere migraciones ni modificaciones del workflow o webhook.

Verificación: `npm run test:integration:aliases --workspace=@daubert/api` cubre sesión requerida, alta con usuario GENERAL, persistencia, idempotencia, colisiones canónicas y con nombres comerciales, concurrencia y visibilidad en el catálogo. Pruebas unitarias: `payment-alias.spec.ts`, `aliases.repository.spec.ts`; formulario: `AssignPaymentAliasDialog.test.tsx`.

### Cambiar empresa y desactivar

El modal **Gestionar alias** ofrece **Cambiar empresa** y **Desactivar alias** cuando hay un registro activo inequívoco. Ambas acciones exigen confirmación y utilizan un único endpoint especializado del módulo existente:

```text
PATCH /api/aliases/:aliasId/payment-notifications
{
  action: "REASSIGN" | "DEACTIVATE",
  companyId?: "empresa destino, solo para REASSIGN",
  expectedCompanyId: "empresa mostrada al confirmar",
  expectedUpdatedAt: "versión exacta recibida del servidor",
  confirmed: true
}
```

- **Cambiar empresa:** actualiza `empresa_id` de la misma fila, manteniendo `alias_id`, texto, tipo y estatus. Rechaza coincidencias canónicas con otros aliases activos (también duplicados en la empresa destino) o nombres comerciales que harían ambiguo el catálogo.
- **Desactivar:** actualiza `estatus = INACTIVO`, sin DELETE ni reinserción. Los filtros existentes de la vista de n8n excluyen esa fila; no se desactiva la empresa ni sus otros aliases o nombres comerciales.
- La versión y empresa esperadas se comprueban bajo los mismos bloqueos transaccionales de catálogo que usa el alta. Una pantalla obsoleta devuelve `409 ALIAS_STATE_CHANGED`, actualiza el detalle y exige una nueva confirmación; no reintenta la mutación automáticamente.
- Se conserva el contexto de auditoría y el trigger existente registra la operación UPDATE, actor y valores anteriores/nuevos. Se mantienen autenticación, roles permitidos del CRUD actual y CSRF globales. No cambian correos, resultados históricos, configuración de pagos ni n8n; no se ejecutan reprocesos.
- No requiere migraciones ni cambios de esquema/vistas. Usa los permisos existentes de lectura/actualización sobre empresas y aliases.

La integración usa exclusivamente fixtures sintéticos en `daubert_hub_test`, incluidos equivalentes **prefijados con un marcador único** de `MINERVA ALVAREZ → MINERVA`, `MINTT SOLUTIONS → Bind ERP` y `CTRO DE ABSTECIMEINT → CADIS`. Verifica nuevas peticiones GET del mismo detalle, estado correcto tras asignar/cambiar/desactivar, historial de error intacto, catálogo n8n, conflictos, CSRF y auditoría antes/después. Las empresas, aliases y notificaciones sintéticos se limpian al terminar; la limpieza de usuarios de prueba sigue el procedimiento existente y requiere conexión administrativa TEST para automatizarse.
