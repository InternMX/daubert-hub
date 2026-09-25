# Notificaciones de pago — Configuración por empresa desde el Hub

Estado: **implementado, desplegado y validado en PROD (2026-09-25)**. Este documento describe la implementación real (commits `c7e3991`, `c4a9cf3`/`36de43f` y `815507e` del repo principal), no una propuesta.

Una empresa ya puede prepararse para participar en Notificaciones de pago **desde Daubert Hub, sin SQL manual**. El workflow de n8n no cambió: [README](README.md) · [database-contract](database-contract.md) · [troubleshooting](troubleshooting.md).

## Principios

- **PostgreSQL sigue siendo la fuente de verdad.** El Hub solo administra los datos que alimentan el catálogo; **n8n consume `core.vw_catalogo_notificacion_pago_n8n`** tal como antes.
- El Hub **no reconstruye** la lógica del workflow (CAT/pagos, clasificación de PDFs, borradores). No hay integración directa Hub → Dropbox.
- El backend decide (readiness, invariante de PARA, `ruta_destino`); el navegador solo muestra lo que el API devuelve.
- Sin backfill masivo: las empresas históricas no se modifican automáticamente.

## Flujo conceptual

```
Empresa → Ruta Dropbox → Alias(es) → Contacto → Correo
        → "Recibe notificaciones de pago" → PARA / CC / CCO
        → "Procesa comprobantes" → "Generar borradores" (Notificaciones activas)
        → empresa lista para n8n
```

## Objetos implicados

Descripción de responsabilidades; la estructura completa está en las fichas de [database/tables](../../database/tables/README.md).

| Objeto | Responsabilidad en esta feature |
| --- | --- |
| `core.empresas.ruta_dropbox` | Ruta Dropbox **relativa** de la empresa. Se edita desde el alta/edición del proveedor (`rutaDropbox`). |
| `core.empresas_notificacion_pago` | Configuración 1:1: `notificaciones_activas` ("Generar borradores"), `procesa_comprobantes_pago` ("Procesa comprobantes") y `ruta_destino` (derivada por el backend). La columna `observaciones` existe pero el Hub no la escribe. |
| `core.contactos` | Persona/área de la empresa; debe estar `ACTIVO` para contar como destinatario. |
| `core.medios_contacto` | El correo: `tipo_medio` (`CORREO`), `valor`, `es_principal`, `recibe_notificacion_pago`, `tipo_destinatario_pago` (`PARA`/`CC`/`CCO`), `estatus`. |
| `core.alias_empresa` | Alias con los que n8n reconoce a la empresa en los PDFs. Ya se gestionaban desde el Hub (`/companies/:companyId/aliases`); no cambian. |

Al **crear** un proveedor, el Hub inserta su fila en `core.empresas_notificacion_pago` en la misma transacción con `procesa_comprobantes_pago=false` y `notificaciones_activas=false` (nunca se activa solo). Nota: los *defaults de columna* del esquema son `true`/`true`; el Hub siempre inserta valores explícitos.

## Ruta Dropbox

- `ruta_dropbox` es **relativa a la raíz de Dropbox**. No se guarda `C:\Users\...\Dropbox` ni una letra de unidad, UNC o ruta rooteada (se rechazan, igual que `..`, segmentos vacíos y caracteres no válidos). Ejemplo: `FLETES/TRANSPORTES KARINA`.
- Forma canónica persistida: separador `/` (el Hub acepta `\` al capturar y lo normaliza). Máximo 200 caracteres. En blanco = sin ruta.
- **Carpeta raíz por tipo de empresa** (usada solo para la sugerencia):

| Tipo | Carpeta |
| --- | --- |
| `PROVEEDOR` | `PROVEEDORES` |
| `SERVICIO` | `PROVEEDOR DE SERVICIOS` |
| `FLETE` | `FLETES` |
| `CLIENTE` | `CLIENTES` |

### Sugerencia de ruta

El Hub puede proponer `<CARPETA>/<NOMBRE COMERCIAL>` a partir de tipo + nombre comercial (`GET /api/companies/dropbox-path-suggestion`). Los caracteres inválidos del nombre se sustituyen por espacio; acentos, Ñ y dígitos se conservan.

La sugerencia:

- **no consulta Dropbox** ni comprueba que la carpeta exista;
- **no crea carpetas**;
- **no se guarda automáticamente** ni sobrescribe una ruta existente;
- solo se vuelve ruta confirmada cuando el usuario elige **"Usar sugerencia"** y **guarda** el formulario.

Si después cambia el nombre o el tipo de la empresa, la ruta ya guardada **no cambia** sola.

### Quitar o cambiar la ruta

- Cambiar `ruta_dropbox` recalcula `ruta_destino` en la misma transacción (ver abajo).
- **No se puede vaciar** la ruta mientras `notificaciones_activas=true` (409 `PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE`): hay que desactivar primero las notificaciones.

## Ruta destino (`ruta_destino`)

La deriva el backend a partir de la ruta Dropbox confirmada; el frontend **nunca** la captura ni la envía (se muestra como "Destino calculado", solo lectura). Patrón actual:

```
<ruta_dropbox>\PAGOS\NOTIFICACIONES DE PAGO\{ANIO}\{MES_NUM}.- {MES_NOMBRE_TITULO}
```

- Los `{PLACEHOLDER}` permanecen **literales**: n8n los sustituye por mes. Las rutas no pueden contener llaves.
- Una sugerencia **no** genera `ruta_destino`; solo la genera una ruta confirmada y guardada.
- Se recalcula al crear la empresa y cuando cambia `ruta_dropbox`. Guardar solo los flags (`PATCH …/payment-notification-settings`) **no** la modifica en filas existentes.
- Sin ruta Dropbox, el API no expone destino (`destinationPath: null`); la columna conserva el default del esquema porque es `NOT NULL`.
- Los registros históricos no se reescriben de forma masiva.

## Destinatarios de pago

`es_principal` **no** es lo mismo que ser destinatario de pagos:

| Concepto | Dónde vive | Significado |
| --- | --- | --- |
| "Correo principal" | `es_principal` | Propiedad del contacto. **No** implica ser PARA de Notificaciones de pago. |
| Destinatario de pagos | `recibe_notificacion_pago` + `tipo_destinatario_pago` | Participa en los avisos de pago. Independiente de `es_principal` en ambos sentidos. |

Tipos: **PARA** = destinatario principal del correo · **CC** = copia visible · **CCO** = copia oculta.

Para que un correo reciba Notificaciones de pago:

1. el medio es `CORREO`;
2. el medio está `ACTIVO`;
3. el contacto está `ACTIVO`;
4. `recibe_notificacion_pago = true`;
5. `tipo_destinatario_pago` ∈ `PARA` / `CC` / `CCO`.

Reglas de captura: solo un `CORREO` puede recibir pagos (`PAYMENT_NOTIFICATION_REQUIRES_EMAIL`); si recibe, el tipo es obligatorio (`PAYMENT_RECIPIENT_TYPE_REQUIRED`); si `receivesPaymentNotifications=false`, el tipo se normaliza a `null`. Un medio editado de correo a teléfono deja de recibir pagos.

## Preparación (readiness)

Para activar Notificaciones de pago (`notificationsActive=true`) el backend exige tres requisitos. Los códigos son parte del contrato técnico del API (409 `PAYMENT_NOTIFICATIONS_NOT_READY` con `missingRequirements`); el Hub los traduce a mensajes.

| Requisito (lenguaje de negocio) | Código técnico |
| --- | --- |
| 1. Ruta Dropbox configurada | `DROPBOX_PATH_REQUIRED` |
| 2. Procesamiento de comprobantes habilitado | `PAYMENT_PROCESSING_REQUIRED` |
| 3. Al menos un destinatario PARA operable | `PAYMENT_RECIPIENT_PARA_REQUIRED` |

**PARA operable** = contacto `ACTIVO` + medio `ACTIVO` + `CORREO` + `recibe_notificacion_pago` + `PARA`. Desactivar siempre es posible. La comprobación y el upsert corren en una transacción con la fila de la empresa bloqueada (`FOR UPDATE`), la misma que toman los cambios de destinatarios.

## Invariante del último PARA

Mientras `notificaciones_activas=true`, la empresa **no puede quedar sin al menos un PARA operable**. El backend rechaza (409 `PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA`, con `missingRequirements: ['PAYMENT_RECIPIENT_PARA_REQUIRED']`) cualquier cambio que quite el último PARA:

- `recibe_notificacion_pago` de `true` a `false` sobre el último PARA;
- cambiar el último PARA a `CC` o `CCO`;
- cambiar el medio de `CORREO` a otro tipo;
- desactivar el medio que contiene el último PARA;
- desactivar el contacto que contiene el último PARA.

Detalles:

- El Hub muestra un mensaje claro y **no realiza la mutación**. **No** se desactivan automáticamente las notificaciones.
- Con **dos** PARA operables se puede retirar uno.
- Con notificaciones **desactivadas** se puede retirar el último PARA.
- `es_principal` **no participa** en la regla.
- La regla mira el estado resultante: si el elemento afectado no contiene un PARA operable, no se bloquea nada (incluye empresas históricas que ya estaban sin PARA).

## Empresas históricas / sin configuración

- `GET …/payment-notification-settings` de una empresa sin fila devuelve el estado seguro `processesPaymentReceipts=false`, `notificationsActive=false`; **consultar no crea filas**.
- Guardar configuración usa **upsert** (`INSERT … ON CONFLICT (empresa_id) DO UPDATE`).
- **No se hizo backfill masivo.**
- Una empresa histórica activa en estado inconsistente (p. ej. sin PARA) puede seguir recibiendo operaciones que no empeoran su readiness, pero **no es un estado deseado**: corregirla desde el Hub.

## Endpoints del Hub

Nombres en camelCase, tal como los expone el API. Los IDs `BIGINT` viajan como **strings** en API y web. Requieren sesión (ADMIN o GENERAL). Referencia; el detalle está en el código (`apps/api/src/payment-notification-settings/`, `apps/api/src/companies/`).

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/companies/:companyId/payment-notification-settings` | `{ data: { companyId, dropboxPath, processesPaymentReceipts, notificationsActive, destinationPath, readiness: { ready, missingRequirements } } }` |
| PATCH | `/api/companies/:companyId/payment-notification-settings` | Body con al menos uno de `processesPaymentReceipts`, `notificationsActive`. 409 `PAYMENT_NOTIFICATIONS_NOT_READY` si no cumple los requisitos. |
| GET | `/api/companies/dropbox-path-suggestion?companyType=…&commercialName=…` | `{ data: { suggestedDropboxPath: string \| null } }`. Solo cálculo; no escribe. `companyType` ∈ `PROVEEDOR`/`SERVICIO`/`FLETE`/`CLIENTE`. |

Endpoints existentes que ahora también aceptan/devuelven campos de esta feature:

| Endpoints | Campos |
| --- | --- |
| Proveedores (`POST /api/providers`, `PATCH /api/providers/:id`, lectura) | `rutaDropbox` |
| Medios de contacto (`POST /api/contacts/:id/methods`, `PATCH /api/contact-methods/:id`, y `…/deactivate`) | `isPrimary`, `receivesPaymentNotifications`, `paymentRecipientType` (`PARA`/`CC`/`CCO`) |

Errores estructurados adicionales: `DROPBOX_PATH_*` (ruta inválida, 400), `PAYMENT_NOTIFICATIONS_DROPBOX_PATH_IN_USE`, `PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA` (409). El filtro global solo deja pasar códigos y `missingRequirements` en mayúsculas; nunca SQL ni detalles internos.

## n8n

- **n8n no fue modificado** por esta feature.
- n8n consume `core.vw_catalogo_notificacion_pago_n8n` ([ficha](../../database/views/core.vw_catalogo_notificacion_pago_n8n.md)); el Hub administra los datos que la alimentan.
- No se duplicó lógica CAT/pagos en React.
- El contrato de reproceso por `correo_id`/hash **no** cambió.
- `n8n_app` no recibió permisos nuevos.

## Ayudas contextuales en el Hub

Las pantallas muestran ayudas (ícono de información, accesible por teclado) sobre: **Correo principal**, **Notificaciones de Pago**, **PARA/CC/CCO**, **Ruta Dropbox**, **Sugerencia de ruta**, **Procesa comprobantes**, **Generar borradores** y **Destino calculado**. Aclaran sobre todo que **Correo principal ≠ destinatario PARA**. Los textos viven en `apps/web/src/components/paymentNotificationHelp.ts`.

## Procedimiento de alta/configuración (sin SQL manual)

1. Crear o abrir la empresa.
2. Confirmar **tipo** y **nombre comercial**.
3. Capturar la **Ruta Dropbox**, o usar **"Usar sugerencia"** y guardar.
4. Registrar los **alias** necesarios (los que aparecen en los PDFs).
5. Crear el **contacto**.
6. Agregar el **correo**.
7. Marcar **"Recibe notificaciones de pago"**.
8. Seleccionar **PARA / CC / CCO**.
9. Confirmar **al menos un PARA** activo.
10. Habilitar **"Procesa comprobantes"**.
11. Activar **"Generar borradores"**.
12. Confirmar el **estado de preparación** (sin requisitos faltantes).

Verificar que la carpeta exista en Dropbox sigue siendo responsabilidad del operador: el Hub no lo comprueba.

## Troubleshooting breve

| Síntoma | Causa / acción |
| --- | --- |
| No permite activar "Generar borradores" | Revisar los tres requisitos: ruta Dropbox, "Procesa comprobantes" y al menos un PARA operable (contacto y correo activos, "Recibe notificaciones de pago", tipo PARA). |
| No permite quitar/cambiar un destinatario | Probablemente es el **último PARA** de una empresa activa. Agregar otro PARA, o desactivar antes las Notificaciones de Pago. |
| No permite vaciar la ruta Dropbox | La empresa tiene notificaciones activas. Desactivarlas primero. |
| La sugerencia no corresponde a una carpeta real | Esperado: la sugerencia no consulta Dropbox (no hay integración directa todavía). Crear/verificar la carpeta manualmente. |
| El correo principal no recibe pagos | "Correo principal" y "destinatario de pagos" son configuraciones independientes: marcar "Recibe notificaciones de pago" y elegir PARA/CC/CCO. |
| Cambié nombre/tipo y la ruta no se movió | Esperado: la ruta guardada no cambia sola. Editarla o usar la nueva sugerencia y guardar. |

Diagnóstico del workflow: [troubleshooting](troubleshooting.md).

## Permisos de base de datos: migración 011

Migración **`20260925_011_hub_payment_notification_settings_permissions_prod`** (`database/migrations/daubert_global/`, con `up`, `down`, `precheck` y `postcheck`). El Hub necesitaba escribir `core.empresas_notificacion_pago` (alta de proveedor, upsert de históricas, sincronización de `ruta_destino`).

Resultado en **PROD** (`daubert_global`):

| Rol | Sobre `core.empresas_notificacion_pago` |
| --- | --- |
| `daubert_hub_app` | `SELECT`, `INSERT`, `UPDATE`. **Sin** `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` |
| `n8n_app`, `daubert_docs_ro`, roles TEST | **Sin cambios** (no se otorgaron permisos adicionales) |

- No se requirieron privilegios de secuencia (la PK es `empresa_id`, sin identidad).
- PRECHECK pasó → UP aplicado → POSTCHECK pasó; el baseline del resto de privilegios (ACL, propietarios, default privileges) permaneció sin cambios.
- La migración se ejecuta solo con un rol administrativo, únicamente en `daubert_global`, y aborta si detecta drift de ACL. Ver [migrations](../../database/migrations.md) y la nota [2026-09-25-payment-notification-config-prod](../../deployments/2026-09-25-payment-notification-config-prod.md).

## Estado actual (2026-09-25)

- Configuración de Notificaciones de pago desde el Hub: **disponible**.
- Migración 011: **aplicada y validada** en PROD.
- API + Web: **desplegados**. n8n: **sin cambios**.
- La configuración por SQL manual **ya no es necesaria** para una empresa normal.
- Validación funcional en PROD: **realizada**.
