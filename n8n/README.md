# n8n — exports versionados de workflows

Esta carpeta contiene **copias sanitizadas de los exports reales** de los workflows n8n de Daubert (Fase D2, 2026-09-24) y su inventario. La documentación explicativa vive en [`docs/automations/`](../docs/automations/README.md).

| Documento | Contenido |
| --- | --- |
| [inventory.md](inventory.md) | Los 12 exports n8n encontrados: clasificación, entorno, triggers, credenciales, estado de versionado |
| [security-notes.md](security-notes.md) | Revisión de seguridad previa al versionado y campos sanitizados |
| [credentials.md](credentials.md) | Credenciales referenciadas (sólo nombre y tipo) |
| `workflows/` | JSON versionados por automatización |

## Export ejecutable ≠ documentación

- El **JSON** es un artefacto técnico: sirve para restaurar/importar un workflow. No explica el porqué ni el contrato.
- La **documentación** ([docs/automations/](../docs/automations/README.md)) explica flujo, contratos, riesgos y operación. Cuando el JSON y la documentación discrepan, **manda el JSON** y hay que corregir la documentación.

## Estructura

```text
n8n/
├── README.md · inventory.md · security-notes.md · credentials.md
└── workflows/
    ├── remisiones-caterpillar/   README.md · prod/ · test/ · historical/
    ├── remisiones-audi/          README.md · prod/ · test/ · shared/ (subworkflows y manejador de errores)
    └── payment-notifications/    README.md   (SIN JSON: pendiente de decisión, ver security-notes.md)
```

Los nombres son **estables** (`workflow.json`); el historial lo lleva Git. No se usan sufijos tipo FINAL/nuevo/v2.

## Qué NO se almacena aquí

- Credenciales, tokens, contraseñas, valores de variables secretas.
- Datos de ejecución (`pinData`, `staticData`, execution data), binarios, base64, PDFs/ZIP embebidos.
- IDs internos de credenciales ni el `instanceId` de la instancia n8n (se eliminan al sanitizar).
- Los originales de Dropbox **no se modifican** nunca; las copias se generan sólo dentro de este repositorio.

## Cómo actualizar un workflow versionado

1. Exporta el workflow desde n8n (o toma el export de Dropbox). **No edites el original.**
2. Revisa secretos ([security-notes.md](security-notes.md)): claves con valores literales, `Authorization`/Bearer, cadenas de conexión con contraseña, `pinData`, `staticData`, binarios, correos/PII innecesarios.
3. Sanitiza sólo metadata no funcional: elimina `meta.instanceId` y `credentials.*.id` (los nombres de credencial se conservan). **No** cambies nodos, conexiones, queries, expresiones, paths ni nombres.
4. Guarda con formato JSON de 2 espacios y verifica que el JSON parseado equivalga al original salvo esos campos.
5. Sobrescribe el `workflow.json` correspondiente (Git guarda el historial) y actualiza [inventory.md](inventory.md) y la documentación afectada en `docs/automations/`.
6. Si el cambio es de comportamiento, actualiza también el contrato con el Hub y la base de datos si aplica.

## Política TEST → PROD

1. El cambio se construye y prueba en el workflow **TEST**; TEST es la fuente de verdad funcional.
2. Se promueve a PROD con sus diferencias **esperadas por entorno** (rutas, credenciales, base, flags, webhooks, ámbito). Toda otra diferencia es *drift* ([n8n-test-prod-drift](../docs/automations/n8n-test-prod-drift.md)).
3. Antes de activar el nuevo PROD: desactivar el anterior (nunca dos PROD activos con el mismo schedule/webhook).
4. Versionar aquí el nuevo export de TEST y de PROD en el mismo cambio y registrar la promoción en `docs/deployments/`.

## Importar un export versionado

Al importar, n8n no tiene los IDs de credencial: **vuelve a asignar las credenciales por nombre** ([credentials.md](credentials.md)) antes de activar. Verifica el `errorWorkflow` de la configuración del workflow (referencia por ID de instancia; ver [n8n-dependencies](../docs/automations/n8n-dependencies.md)).
