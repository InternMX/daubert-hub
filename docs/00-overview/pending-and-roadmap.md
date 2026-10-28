# Pendientes, riesgos y hoja de ruta (estado al 2026-10-28, Hub 1.1.0)

Resumen mantenible de la **auditoría funcional y técnica del 2026-10-28** (referencia de código `6909dc8`, v1.1.0, solo lectura). Es la lista única de pendientes: los demás documentos enlazan aquí en lugar de repetirla. Las propuestas de §5 y §6 son **candidatas, no requisitos aprobados**: cada una exige decisión del responsable.

Convenciones: **TEST** = `daubert_hub_test` + pruebas en n8n; **PROD** = `daubert_global` + n8n `:5678`. «Verificado» distingue: **A** pruebas automatizadas, **T** validado en TEST, **P** validado en PRODUCCIÓN. Sin secretos ni datos de clientes.

## 1. Límites de esta auditoría

- Se leyó el código, las pruebas y la documentación, y una **copia** de la base de n8n PRODUCCIÓN (workflows activos, nodos, triggers, conteos de ejecuciones). No se consultó `daubert_global`, Dropbox ni Outlook: todo lo que depende de datos de negocio reales figura como **no verificado**.
- «Ejecución exitosa» de un ciclo programado **no** prueba que se haya procesado un documento.
- **TEST y PRODUCCIÓN no son funcionalmente idénticos y no se afirma lo contrario.** Los nodos que difieren (unos 34 de Caterpillar y 15 de Pagos) se atribuyeron a rutas, credenciales y entorno, pero **no se compararon uno a uno**: la paridad funcional está **sin verificar** ([n8n-test-prod-drift](../automations/n8n-test-prod-drift.md)).
- No se ha probado el descifrado de los respaldos `.age` ni una restauración completa.

## 2. Funcionalidades verificadas (sin pendiente)

| Área | Qué está verificado | Evidencia principal |
| --- | --- | --- |
| Hub general | Autenticación y sesiones, CSRF por Origin, roles `ADMIN`/`GENERAL`, usuarios, Proveedores, Clientes, Contactos, direcciones, alias, directorio, búsquedas y paginación, Auditoría (ADMIN), estado de n8n | A + uso en PROD; código en `apps/api/src/security`, `app.module.ts` |
| Actividad reciente | Integra Audi, **Caterpillar**, Notificaciones de pago y ajustes de series; verificada visualmente en PROD tras 1.1.0 | A + T + P; [hub/automations](../hub/automations.md) |
| Caterpillar (Hub) | Series, historial, detalle, errores, ajuste seguro de folios (ADMIN, con bitácora) | A + T + P ([production-runbook](../automations/caterpillar/production-runbook.md)) |
| Caterpillar (folios) | Reservas contiguas e idempotencia sin duplicados | A + T + P (2026-09-24) |
| Pagos (flujo anterior) | Sondeo de Outlook, ZIP, extracción de fecha, catálogo y alias, destinatarios y ruta desde el Hub, borradores de Outlook (no envía), errores por archivo | A + T + P con el flujo v1 |
| Audi | Remisiones y hojas de identificación cada 15 min; historial, detalle y ajuste de folio en el Hub | A + T + P (ciclos «success» continuos) |
| Infraestructura | Aislamiento de red (solo Nginx :8082 → Caddy/Tailscale), cierre de entradas para ventanas, despliegue y rollback con anclas, respaldos programados con hash | Scripts Pester; ventanas del 27 y 28 de octubre |

## 3. Implementado pero pendiente de validación real en PRODUCCIÓN

| ID | Funcionalidad | Estado | Qué falta | Prioridad |
| --- | --- | --- | --- | --- |
| P-01 | Pagos: primer ZIP real con el workflow de 111 nodos (ingesta con registro de archivos, asignación puntual) | Implementado, validado en TEST (18/18 E2E aislado); **no validado en PROD** | Procesar de punta a punta un correo real de Contabilidad y registrar el resultado | P1 |
| P-02 | Pagos: recuperación individual (migración 019 + hijo `pagosProdRecuperacion01`, 106 nodos) | Publicado y activo; ensayos en TEST; **0 ejecuciones en PROD** | Primera recuperación real o ensayo controlado autorizado | P1 |
| P-03 | Caterpillar 016: primera emisión real (admisión atómica, snapshot, folios, PDF) | Publicado; validado en TEST (015/017, B1); ciclos «success» sin evidencia de emisión | Procesar una Programación real nueva y verificar con `apps/api/scripts/caterpillar-015-verify.cjs` (solo lectura) | P1 |
| P-03b | Caterpillar: reproceso, regeneración comercial y cancelación individual en PROD | Validados en TEST; sin uso real en PROD | Primera operación real autorizada | P2 |

## 4. Riesgos operativos pendientes

| ID | Riesgo | Estado | Prioridad |
| --- | --- | --- | --- |
| P-04 | El workflow Caterpillar de PROD (`catProd016Remisiones01`) **no tiene Error Workflow**; Audi y Pagos sí. Un fallo solo se ve en la ejecución de n8n o en el Hub | Abierto | P1 |
| P-05 | **Restore drill** de PostgreSQL y n8n con la llave privada age en otra estación: sin hacer. Los respaldos de las ventanas (incluida la de 1.1.0) solo se verificaron por SHA-256; **su descifrado y restauración completa no están demostrados**. Existen drills históricos documentados (n8n/PostgreSQL 2026-09-28, PostgreSQL 2026-10-01) que no cubren las copias actuales | Abierto | P1 |
| P-06 | n8n depende de la sesión de Windows (se detienen las automatizaciones si se cierra o suspende; ya ocurrió un hueco de unas 20 h el 21-22 de octubre) y no hay alerta por ausencia de ejecuciones | Abierto | P1 |
| P-07 | Sin auditoría de cambios en `core.empresas_notificacion_pago` (ruta Dropbox, destinatarios) ni en `operacion.*`; cambiar un destinatario no deja rastro ([triggers](../database/triggers.md)) | Abierto | P2 |
| P-08 | La cookie de sesión no lleva `Secure` (`AUTH_COOKIE_SECURE=false`) aunque ya existe HTTPS por Caddy/Tailscale | Decisión pendiente | P2 |
| P-09 | Reproceso y asignación de Pagos, configuración de Pagos y CRUD de maestros están abiertos a cualquier usuario `GENERAL`; en Caterpillar reprocesar, regenerar y cancelar son solo `ADMIN` | Decisión pendiente | P2 |
| P-10 | CI sin `npm audit`, escaneo de secretos, Dependabot ni pruebas de integración | Abierto | P2 |
| P-14 | Instancia de n8n compartida TEST/PROD con una sola credencial de Outlook | Abierto | P2 |
| P-21 | Falta verificar desde un cliente de la LAN el bloqueo de 3000/5432/5678 y el arranque tras un reinicio completo | No verificado | P2 |
| P-16 | Observabilidad: sin log de peticiones, métricas ni alertas; `compose.pilot.yaml` no define rotación de logs; `/api/health` público expone `environment`, `version` y `commit` | Abierto | P3 |
| P-17 | Límite de intentos de login en memoria (se pierde al reiniciar la API) y sin MFA | Aceptado para uso interno | P3 |

No hay elementos P0. Las cinco ejecuciones `waiting` de Caterpillar (672, 681, 685, 686, 689) y los correos de Pagos 44, 38 y 45 están **protegidos**: no se reanudan, reintentan ni tocan.

## 5. Limitaciones funcionales conocidas

| ID | Módulo | Limitación |
| --- | --- | --- |
| P-11 | Pagos | El inicio es **por sondeo programado** (intervalo por defecto del Schedule), no por evento de Outlook; una ejecución procesa **un correo**. El retraso máximo es el intervalo |
| P-12 | Audi | Lee como máximo **6 artículos por archivo**; idempotencia por **ruta** (un archivo sobrescrito no se reprocesa); si falla tras reservar quedan folios consumidos sin remisión; **no hay reproceso desde el Hub** ([workflow](../automations/audi/workflow.md)) |
| P-13 | Caterpillar | El último estado verificado de rutas habilitadas (2026-09-24) es P2, P5 y P6; P3, P4, NL FINSA 1/3 y Torreón/Planta 2 figuraban como no habilitadas. **No se ha reconfirmado**: depende de `PROCESOS_HABILITADOS_PROD` (duplicado en dos nodos) y del estado de `ops.automatizacion_series_proceso` |
| P-15 | n8n | El export del Error Workflow de Pagos y los de Pagos v2 no están versionados ([n8n/security-notes](../../n8n/security-notes.md)) |
| P-20 | Hub | Proveedores, Clientes, Contactos, Alias y Direcciones solo tienen catálogo de endpoints, no documento funcional |
| P-22 | Hub | La rama `feat/manufacturing-sheets-coex-baseline` (hojas de manufactura, prototipo fuera de `main`) conserva commits locales sin copia remota; sus datos de ejemplo requieren anonimización antes de publicarse |

## 6. Hoja de ruta candidata

**Inmediatamente tras 1.1.0 (operación, esfuerzo bajo)**: validar P-01, P-02 y P-03 y registrar el resultado en [deployments](../deployments/README.md); asignar Error Workflow a Caterpillar (P-04, con respaldo n8n `OnChange` previo); ejecutar el restore drill (P-05); decidir `AUTH_COOKIE_SECURE` y la política de roles (P-08, P-09).

**Candidatas a Hub 1.2.0 (no aprobadas)**: (1) auditoría de configuración y de operaciones (P-07); (2) endurecimiento de autorización según la decisión de P-09; (3) observabilidad mínima y continuidad de n8n sin sesión (P-06, P-16); (4) CI reforzado: `npm audit --omit=dev`, Dependabot, integración contra base efímera (P-10).

**Pueden esperar**: reproceso de Audi desde el Hub y límite de 6 artículos (P-12); más rutas de Caterpillar (P-13); instancia de n8n de TEST separada (P-14); exports saneados de Pagos (P-15); documentación funcional de maestros (P-20); disparo de Pagos por evento (P-11).

## 7. Decisiones funcionales pendientes de aprobación

1. ¿Qué acciones deben ser solo `ADMIN`: reproceso y asignación de Pagos, configuración por empresa, acuses de revisión, alta y edición de proveedores/clientes? (P-09)
2. ¿Se exige HTTPS (cookie `Secure`) y se retira el acceso HTTP por `:8082` en la LAN? (P-08)
3. ¿Qué retraso es aceptable entre el correo de Contabilidad y su procesamiento? ¿Hace falta disparo por evento? (P-11)
4. ¿Hay programaciones de Audi con más de 6 artículos o sobrescrituras en la misma ruta? ¿Se quiere reproceso desde el Hub? (P-12)
5. ¿Qué rutas de Caterpillar se habilitan y en qué orden? (P-13)
6. ¿Quién recibe las alertas si un workflow falla o n8n deja de ejecutar? (P-04, P-06)
7. ¿Qué se hace con las cinco ejecuciones `waiting` de Caterpillar y con los correos de Pagos 44, 38 y 45?
8. ¿Se publica la rama de manufactura (tras anonimizar) y en qué plazo? (P-22)
9. ¿Se versionan (saneados) el Error Workflow de Pagos y los exports de Pagos v2? (P-15)
10. ¿Se requiere auditoría de cambios también para folios y remisiones (`operacion.*`)? (P-07)

## 8. Mantenimiento de esta página

Después de cada release o validación real: (1) mover el ítem resuelto de §3/§4 a §2 con su evidencia; (2) añadir la nota en [deployments](../deployments/README.md); (3) actualizar [project-status](project-status.md); (4) revisar la tabla de [seguridad y operación](../operations/security-and-operations-status.md). El procedimiento completo está en [project-status §8](project-status.md#8-regla-de-mantenimiento).
