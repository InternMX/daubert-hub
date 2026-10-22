# Portal documental de Daubert Hub

Este directorio es la **fuente de verdad documental** de Daubert Hub y de las automatizaciones n8n que se integran con él. Es modular: cada documento cubre un tema y enlaza a los demás en lugar de duplicarlos.

> Los workflows JSON de n8n son artefactos técnicos, **no** sustituyen esta documentación.
> Ningún documento de este árbol contiene secretos: sólo nombres lógicos de credenciales, nombres de variables de entorno, rutas de endpoints, roles y contratos.

## Cómo leer esta documentación

| Si necesitas… | Empieza por |
| --- | --- |
| Entender qué es el sistema y cómo encaja todo | [00-overview/README.md](00-overview/README.md) → [architecture.md](00-overview/architecture.md) |
| Saber qué es TEST y qué es PROD | [00-overview/environments.md](00-overview/environments.md) |
| Localizar un módulo, tabla o ruta | [00-overview/system-map.md](00-overview/system-map.md) |
| Operar o depurar Caterpillar | [automations/caterpillar/README.md](automations/caterpillar/README.md) → [troubleshooting](automations/caterpillar/troubleshooting.md) |
| Aplicar una migración | [database/migrations.md](database/migrations.md) |
| Entender la base de datos (catálogo D3) | [database/README.md](database/README.md) → [data-dictionary](database/data-dictionary.md) |
| Diagnosticar un problema de base de datos | [database/troubleshooting.md](database/troubleshooting.md) |
| Backup/restore de PostgreSQL | [operations/database-backup-restore.md](operations/database-backup-restore.md) |
| Ver la arquitectura self-hosted V1 (LAN, puertos, servidor) | [architecture/README.md](architecture/README.md) |
| Desplegar el Hub (Docker) | [operations/deployment.md](operations/deployment.md) → [deployment-checklist.md](operations/deployment-checklist.md) (PROD) |
| Diagnosticar o configurar el servidor (incluye el supervisor de n8n) | [diagnose-daubert-server](operations/diagnose-daubert-server.md) · [configure-daubert-server](operations/configure-daubert-server.md) |
| Saber por qué algo se diseñó así | [decisions/README.md](decisions/README.md) |
| Ver qué se promovió a PROD y cuándo | [deployments/](deployments/) |
| Ver el estado actual del proyecto, módulos, riesgos y qué no tocar a mano | [00-overview/project-status.md](00-overview/project-status.md) |

## Mapa documental

```text
docs/
├── README.md                     ← este portal
├── 00-overview/                  visión general del sistema
│   ├── README.md
│   ├── architecture.md           diagrama de arquitectura general (Mermaid)
│   ├── environments.md           TEST vs PROD
│   ├── project-status.md         estado actual, módulos, pendientes, riesgos y guía de mantenimiento
│   └── system-map.md             módulos, rutas, tablas, roles
├── hub/                          aplicación Hub (API NestJS + Web React)
│   ├── README.md · architecture.md · api.md
│   └── authentication.md · authorization.md · automations.md
├── database/                     PostgreSQL
│   ├── README.md · architecture.md · migrations.md · data-dictionary.md
│   ├── schemas/ · tables/ · views/ · functions/          catálogo D3 (fichas por objeto)
│   ├── relationships.md · roles.md · permissions-matrix.md · security-definer.md · n8n-app-audit.md
│   ├── folios.md · audi-legacy-allocator.md · indexes.md · integrity-rules.md · triggers.md · sequences.md
│   ├── test-prod-drift.md · hub-contract.md · n8n-contract.md · troubleshooting.md · schema-snapshots.md
│   └── roles-permissions.md · document-series.md
├── automations/                  automatizaciones n8n
│   ├── README.md
│   ├── caterpillar/              módulo piloto (documentado de extremo a extremo)
│   ├── audi/README.md            documentado (D2)
│   └── payment-notifications/         documentado (incluye company-configuration.md: configuración por empresa desde el Hub)
├── architecture/                 arquitectura self-hosted V1 (LAN, servidor Windows, diagramas)
├── operations/                   runbooks generales
│   └── README.md · deployment.md · deployment-checklist.md · diagnose/configure-daubert-server.md
│       · backup-restore.md · database-backup-restore.md · postgresql-backup-automation.md
│       · n8n-backup-automation.md · troubleshooting.md
├── decisions/                    ADRs
│   └── README.md · ADR-001 … ADR-005
└── deployments/                  notas de despliegue puntuales (existentes)
```

## Estado de cobertura

Leyenda de fuentes usada en todo el árbol:

- **Código/SQL** — verificado contra el repositorio (`apps/`, `database/`, `deploy/`, `compose*.yaml`, `docker/`).
- **Nota de despliegue** — respaldado por [`deployments/2026-09-24-caterpillar-12c-prod.md`](deployments/2026-09-24-caterpillar-12c-prod.md).
- **Paquetes de migración externos** — respaldado por los `.sql` del directorio de migraciones externo al repositorio (ver [database/migrations.md](database/migrations.md)); no verificable desde el repo.
- **Export n8n** — verificado contra los JSON reales de los workflows (Fase D2). Los exports sanitizados están en [`../n8n/`](../n8n/README.md), salvo Notificaciones de pago (no versionado, ver [n8n/security-notes](../n8n/security-notes.md)). **Si el export y un documento discrepan, manda el export.**
- **Descripción de proyecto** — información aportada por el responsable del proyecto que no puede comprobarse en ninguna fuente. Tras la Fase D2 sólo queda en puntos aislados.
- **PENDIENTE** — no puede documentarse con calidad todavía.

| Área | Estado | Notas |
| --- | --- | --- |
| Visión general y entornos | Completo (Fase D1) | Ver inconsistencias abiertas en [00-overview/environments.md](00-overview/environments.md) |
| Hub (API/Web/auth/roles) | Completo a nivel general | Módulos de negocio (proveedores, clientes, contactos, direcciones) sólo listados, no detallados |
| Base de datos | Completo (Fase D3): catálogo real de PROD/TEST (31 tablas, 10 vistas, 13 funciones), permisos, drift, folios | Snapshots `pg_dump`: PENDIENTE ([schema-snapshots](database/schema-snapshots.md)); datos y valores de configuración no leídos por diseño |
| n8n (inventario, seguridad, drift, dependencias, rutas) | Completo (Fase D2) | [../n8n/](../n8n/README.md) · [n8n-test-prod-drift](automations/n8n-test-prod-drift.md) · [n8n-dependencies](automations/n8n-dependencies.md) · [n8n-paths](automations/n8n-paths.md) |
| Caterpillar | Completo, **verificado contra el export** (D2) | [automations/caterpillar/](automations/caterpillar/README.md) |
| Audi | Completo (D2) | [automations/audi/README.md](automations/audi/README.md) |
| Notificaciones de pago | Completo (D2); export **no versionado**. Configuración por empresa desde el Hub: implementada y en PROD (2026-09-25), ver [company-configuration](automations/payment-notifications/company-configuration.md). Evolución futura: integración directa con Dropbox | [automations/payment-notifications/README.md](automations/payment-notifications/README.md) |
| Operaciones | Parcial | Deploy Docker, diagnóstico/configuración del servidor (incluido el supervisor de n8n) y backups automatizados documentados; ver [operations/README.md](operations/README.md) |
| ADRs | 5 creados | Sólo con evidencia en código/documentos |

## Pendientes transversales (candidatos a Fase D3 y posteriores)

- ~~**D3:** documentar PostgreSQL objeto por objeto~~ — hecho en la Fase D3 ([database/README.md](database/README.md)); quedan los pendientes listados allí (snapshots, datos de configuración, políticas de backup/retención).
- Decidir el versionado de los exports de Notificaciones de pago ([n8n/security-notes](../n8n/security-notes.md)) y versionar la exportación del workflow `ERROR - NOTIFICACIONES DE PAGO` (activo en PROD; hoy solo su ID está referenciado por el workflow de Pagos y su export no está en el repositorio).
- Versionado parcial de las migraciones de `daubert_global`: **versionadas en el repo** la 009–011 (PROD), las 012–014 (TEST-only) y las 015–017 (PROD, asignación puntual de Pagos); **siguen fuera del repositorio** (directorio externo de Dropbox) los paquetes históricos anteriores (`20260827`, `20260910`, `20260911`, `20260921`, `20260922` y los scripts `20260918`), de los que depende gran parte del esquema actual: PENDIENTE versionarlos o fijar formalmente su referencia ([database/migrations](database/migrations.md)).
- Backup/restore: automatizados y con restore drill validado ([postgresql-backup-automation](operations/postgresql-backup-automation.md), [n8n-backup-automation](operations/n8n-backup-automation.md), índice en [backup-restore](operations/backup-restore.md)); siguen PENDIENTES el restore drill con la clave privada en otra estación y PITR/WAL.
- Corregir las discrepancias Hub ↔ n8n y el drift detectados en D2 ([n8n-test-prod-drift](automations/n8n-test-prod-drift.md), [caterpillar/reprocessing](automations/caterpillar/reprocessing.md#discrepancias-hub--n8n-verificadas-en-d2)).
- Resolver las inconsistencias listadas en [00-overview/environments.md](00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración).

> Estado vigente del proyecto, pendientes y riesgos: [00-overview/project-status.md](00-overview/project-status.md).

## Regla de mantenimiento

Una feature no está terminada hasta que se actualiza su documentación relevante. Al cambiar comportamiento, actualiza en el mismo PR: el documento del módulo, [system-map.md](00-overview/system-map.md) si cambian rutas/tablas, y crea un ADR si la decisión es arquitectónica.
