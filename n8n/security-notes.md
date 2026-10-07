# Revisión de seguridad previa al versionado (Fase D2)

Alcance: los 12 exports n8n hallados bajo Dropbox (`HERRAMIENTAS AUTOMATIZACION` = PROD, `PRUEBAS` = TEST). Los originales no se modificaron. **No se muestran valores sensibles**; sólo ubicaciones y tipos.

## Método

Para cada export se recorrió el JSON completo (nodos, parámetros, código, metadata) buscando: claves con nombre tipo *password/secret/token/api key/authorization/bearer/private key* con valor literal; Bearer/JWT literales; cadenas de conexión con contraseña; `PGPASSWORD`; llaves privadas; cadenas base64 largas; `pinData`; `staticData`; binarios; y direcciones de correo. Se distinguió: *nombre/tipo de credencial* (permitido), *ID interno de credencial* (evaluado), *secreto real* (prohibido), *datos de negocio* (evaluados).

## Hallazgos comunes a los 12 exports

| Hallazgo | Detalle | Decisión |
| --- | --- | --- |
| Secretos literales | **Ninguno** en ningún export (0 claves sensibles con valor literal; 0 Bearer/JWT; 0 cadenas con contraseña; 0 llaves privadas) | — |
| Autenticación de webhooks | Se referencia por **nombre** de credencial `httpHeaderAuth` (`Daubert Hub - n8n PROD` / `… TEST`); el valor no está en el JSON | Permitido |
| `pinData` / `staticData` / binarios / base64 | Ninguno (`pinData` vacío; sin `staticData`) | — |
| `meta.instanceId` | Presente en los 12 (idéntico en todos: **TEST y PROD viven en la misma instancia n8n**) | Se elimina en las copias |
| IDs internos de credencial (`credentials.*.id`) | Presentes en los exports con credenciales | Se eliminan en las copias (se conserva el nombre) |
| Rutas locales | Rutas Dropbox de Windows del equipo servidor, con el usuario de Windows en la ruta | Las rutas son configuración funcional, no secreto. En las copias versionadas solo el segmento de usuario se sustituyó por `<WINDOWS_USER>` (sin otro cambio): **al importar, hay que restituir el usuario real del servidor en esas rutas** |
| IDs de carpetas de buzón Outlook (Graph) | Sólo en Notificaciones de pago | Identificadores de carpeta, no credenciales; se conservan si el export se versiona |

## Clasificación por export

| Export | Clasificación | Motivo (sin valores) |
| --- | --- | --- |
| Caterpillar PROD (`Remisiones CAT Produccion PG`) | **NEEDS_SANITIZATION** → versionado | Sólo `meta.instanceId` e IDs de credencial |
| Caterpillar TEST (`MANUAL TEST REMISIONES CAT`) | **NEEDS_SANITIZATION** → versionado | ídem |
| Caterpillar candidato PG (pre-reproceso) | **NEEDS_SANITIZATION** → versionado (histórico) | ídem |
| Caterpillar legado (`Remisiones CAT Produccion`, contadores JSON) | **NEEDS_SANITIZATION** (sólo `meta.instanceId`; sin credenciales) → **no versionado** por criterio de relevancia | Superado por el mismo workflow (mismo ID) en su versión PG; permanece en Dropbox |
| Audi PROD | **NEEDS_SANITIZATION** → versionado | `meta.instanceId` e IDs de credencial |
| Audi TEST | **NEEDS_SANITIZATION** → versionado | ídem |
| Audi subworkflows (Generación PDFs, Hojas de Identificación) y Manejador de errores | **NEEDS_SANITIZATION** → versionados (compartidos) | Sólo `meta.instanceId` (no usan credenciales) |
| Audi legado (`Instalacion/Remisiones AUDI PRODUCCION`, contadores JSON) | **NEEDS_SANITIZATION** (sólo `meta.instanceId`) → **no versionado** | Versión anterior del mismo workflow (mismo ID) |
| **Notificaciones de pago PROD** | **DO_NOT_VERSION** (pendiente de decisión) | Contiene **direcciones de correo reales de personal** (destinatario y CC del resumen, y firma corporativa con contacto en la plantilla del correo) y un dominio de correo de tercero usado como filtro de remitente. Son parte funcional de la lógica: sanitizarlas cambiaría el comportamiento, por lo que no se alteró ni se versionó |
| **Notificaciones de pago TEST** | **DO_NOT_VERSION** (pendiente de decisión) | ídem (correos internos de prueba y firma) |

> **Cómo desbloquear Notificaciones de pago:** el responsable decide (a) versionar tal cual (repositorio privado; los correos son datos internos corporativos), o (b) parametrizar destinatarios/firma fuera del JSON (cambio de lógica, requiere fase de código). Hasta entonces sólo existe la documentación derivada del export ([docs/automations/payment-notifications/](../docs/automations/payment-notifications/README.md)).

## Campos sanitizados (copias versionadas)

Aplicado **exactamente** a los 8 exports versionados, sin otro cambio:

| Campo | Acción | Cantidad |
| --- | --- | --- |
| `meta.instanceId` | Eliminado | 1 por export (8) |
| `nodes[].credentials.<tipo>.id` | Eliminado (se conserva `.name`) | Caterpillar PROD 8 · Caterpillar TEST 9 · Caterpillar candidato 6 · Audi PROD 10 · Audi TEST 9 · subworkflows/manejador 0 |

No se tocó ningún nodo, conexión, parámetro, query, expresión, path ni nombre. Se verificó por comparación profunda que el JSON versionado equivale al original salvo esos campos, que `connections` es idéntico y que el número de nodos coincide. Formato: JSON con 2 espacios y salto de línea final.

## Verificación posterior sobre lo versionado

Búsqueda insensible a mayúsculas en `n8n/workflows/` de: `password`, `passwd`, `secret`, `api_key`, `apikey`, `authorization`, `bearer`, `PGPASSWORD`, `SMTP_PASSWORD`, `CATERPILLAR_REPROCESS_WEBHOOK_TOKEN`, `PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN`, `instanceId` y patrones de correo: **0 coincidencias**.

## Riesgos de seguridad observados en los workflows (informativo; no se corrigió nada)

1. **Audi** construye SQL por interpolación de texto en nodos Code (`sqlText` con escape de comillas) y en queries con `{{ }}`; el origen son nombres de archivo y datos de Excel. Riesgo de inyección acotado por el escape, pero es un patrón frágil frente a las llamadas parametrizadas de Caterpillar.
2. **Audi** identifica al cliente con `to_jsonb(e)::text ILIKE '%AUDI%'` sobre `core.empresas` (con `LIMIT 2` y validación de un solo resultado): búsqueda difusa.
3. **TEST y PROD comparten instancia n8n**, y el TEST de Audi usa el **manejador de errores de PROD** (escribe en la carpeta de errores de PROD) y los **mismos subworkflows**: un error de TEST puede contaminar logs de PROD.
4. **Notificaciones de pago**: el webhook de reproceso sólo confía en *Header Auth*; no recibe identidad de usuario y el Hub no restringe el rol ([payment-notifications/reprocessing](../docs/automations/payment-notifications/reprocessing.md)).
5. El webhook de Notificaciones de pago tiene el **mismo `path`** en TEST y en PROD; sólo uno puede estar activo a la vez en la URL de producción de n8n.
6. `n8n_app` (PROD) mantiene grants directos que Audi usa (INSERT/UPDATE directos): ver [database/roles-permissions](../docs/database/roles-permissions.md).
