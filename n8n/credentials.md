# Credenciales n8n referenciadas

Fuente: los 12 exports n8n (Fase D2). Sólo **nombre**, **tipo**, **entorno inferido** y **workflows que las usan**. Ningún valor, token, contraseña ni ID interno se documenta. Los IDs de credencial se eliminan de las copias versionadas ([security-notes](security-notes.md)).

| Credencial (nombre) | Tipo n8n | Entorno | Workflows que la usan |
| --- | --- | --- | --- |
| `Postgres produccion` | `postgres` | PROD (`daubert_global`, según el nombre; el JSON no incluye la conexión) | Caterpillar PROD · Audi PROD · Notificaciones PROD · Caterpillar candidato PG (histórico, almacenado en la carpeta de PRUEBAS) |
| `Postgres pruebas` | `postgres` | TEST | Audi TEST · Notificaciones TEST |
| `cat_test` | `postgres` | TEST (rol de mínimo privilegio para Caterpillar, según D1; el JSON no lo demuestra) | Caterpillar TEST |
| `Daubert Hub - n8n PROD` | `httpHeaderAuth` (Header Auth de los webhooks) | PROD | Caterpillar PROD (webhook `cat-reprocess`) · Notificaciones PROD (webhook `daubert-hub/notificaciones-pago/reprocesar`) |
| `Daubert Hub - n8n TEST` | `httpHeaderAuth` | TEST | Caterpillar TEST (`cat-test-reprocess`) · Notificaciones TEST |
| `Outlook LOGIN OAUT2` | `microsoftOutlookOAuth2Api` | **Compartida TEST y PROD** (mismo nombre en ambos exports) | Notificaciones PROD · Notificaciones TEST |

Los workflows de Audi (subworkflows y manejador de errores), y los históricos con contadores JSON, no referencian credenciales.

## Observaciones

- **No hay credencial SMTP**: el correo sale por Microsoft Outlook (Graph/OAuth2), no por SMTP.
- **Credencial de Outlook compartida** entre TEST y PROD: el workflow TEST usa el mismo buzón/OAuth que PROD, y sólo cambian el filtro de remitente, la carpeta y `MODO` ([n8n-test-prod-drift](../docs/automations/n8n-test-prod-drift.md#notificaciones-de-pago)).
- Un workflow histórico (candidato PG de Caterpillar) ubicado en la carpeta de pruebas referencia `Postgres produccion`: si se activara por error operaría contra PROD.
- **Riesgo de drift de credenciales**: al importar cualquier export hay que reasignar la credencial por nombre; una asignación equivocada (p. ej. `Postgres produccion` en un workflow de prueba) no se detecta por estructura.
- Roles PostgreSQL detrás de cada credencial: ver [database/roles-permissions](../docs/database/roles-permissions.md). Confirmar (fuera del JSON) qué rol usa cada credencial es tarea de la Fase D3.
