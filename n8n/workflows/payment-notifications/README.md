# Notificaciones de pago — exports

**No hay JSON versionado.** Los dos exports (PROD y TEST) están clasificados **DO_NOT_VERSION** hasta que el responsable decida qué hacer con las direcciones de correo reales de personal y la firma corporativa embebidas en la lógica ([security-notes](../../security-notes.md#clasificación-por-export)).

| Workflow n8n | Entorno | Activo al exportar | Archivo fuente (no modificado) |
| --- | --- | :-: | --- |
| `Produccion Notificacion de pagos a Proveedores` | PROD | sí | `C:\Users\<WINDOWS_USER>\Documents\Dropbox\HERRAMIENTAS AUTOMATIZACION\NOTIFICACIONES DE PAGO\` |
| `Test Notificacion de pagos a Proveedores` | TEST | no | `C:\Users\<WINDOWS_USER>\Documents\Dropbox\PRUEBAS\NOTIFICACIONES DE PAGO\` |

Para versionarlos: aprobar su publicación tal cual (repositorio privado) y aplicar el mismo procedimiento de sanitización de [../../README.md](../../README.md#cómo-actualizar-un-workflow-versionado). La documentación derivada de su lectura está en [docs/automations/payment-notifications/](../../../docs/automations/payment-notifications/README.md).
