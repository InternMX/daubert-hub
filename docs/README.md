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
| Desplegar el Hub (Docker) | [operations/deployment.md](operations/deployment.md) |
| Saber por qué algo se diseñó así | [decisions/README.md](decisions/README.md) |
| Ver qué se promovió a PROD y cuándo | [deployments/](deployments/) |

## Mapa documental

```text
docs/
├── README.md                     ← este portal
├── 00-overview/                  visión general del sistema
│   ├── README.md
│   ├── architecture.md           diagrama de arquitectura general (Mermaid)
│   ├── environments.md           TEST vs PROD
│   └── system-map.md             módulos, rutas, tablas, roles
├── hub/                          aplicación Hub (API NestJS + Web React)
│   ├── README.md · architecture.md · api.md
│   └── authentication.md · authorization.md · automations.md
├── database/                     PostgreSQL
│   ├── README.md · architecture.md · migrations.md
│   └── roles-permissions.md · document-series.md
├── automations/                  automatizaciones n8n
│   ├── README.md
│   ├── caterpillar/              módulo piloto (documentado de extremo a extremo)
│   ├── audi/README.md            esqueleto (pendiente)
│   └── payment-notifications/README.md   esqueleto (pendiente)
├── operations/                   runbooks generales
│   └── README.md · deployment.md · backup-restore.md · troubleshooting.md
├── decisions/                    ADRs
│   └── README.md · ADR-001 … ADR-005
└── deployments/                  notas de despliegue puntuales (existentes)
```

## Estado de cobertura

Leyenda de fuentes usada en todo el árbol:

- **Código/SQL** — verificado contra el repositorio (`apps/`, `database/`, `deploy/`, `compose*.yaml`, `docker/`).
- **Nota de despliegue** — respaldado por [`deployments/2026-09-24-caterpillar-12c-prod.md`](deployments/2026-09-24-caterpillar-12c-prod.md).
- **Paquetes de migración externos** — respaldado por los `.sql` del directorio de migraciones externo al repositorio (ver [database/migrations.md](database/migrations.md)); no verificable desde el repo.
- **Descripción de proyecto** — información aportada por el responsable del proyecto que **no** puede comprobarse en el repositorio (principalmente la lógica interna de los workflows n8n, que no están versionados aquí). Se marca explícitamente en cada punto.
- **PENDIENTE** — no puede documentarse con calidad todavía.

| Área | Estado | Notas |
| --- | --- | --- |
| Visión general y entornos | Completo (Fase D1) | Ver inconsistencias abiertas en [00-overview/environments.md](00-overview/environments.md) |
| Hub (API/Web/auth/roles) | Completo a nivel general | Módulos de negocio (proveedores, clientes, contactos, direcciones) sólo listados, no detallados |
| Base de datos | Completo a nivel de arquitectura, roles y series | Catálogo completo de tablas y DDL: PENDIENTE (los DDL viven fuera del repo) |
| Caterpillar | Completo (módulo piloto) | Lógica interna de n8n: **Descripción de proyecto**, pendiente verificar contra el export del workflow |
| Audi | Esqueleto | PENDIENTE — ver [automations/audi/README.md](automations/audi/README.md) |
| Notificaciones de pago | Esqueleto | PENDIENTE — ver [automations/payment-notifications/README.md](automations/payment-notifications/README.md) |
| Operaciones | Parcial | Deploy Docker documentado; backup/restore exacto: PENDIENTE |
| ADRs | 5 creados | Sólo con evidencia en código/documentos |

## Pendientes transversales (candidatos a Fase D2)

- Versionar (o referenciar formalmente) los exports de los workflows n8n y documentar su verificación.
- Versionar en el repo el resto de migraciones de `daubert_global` (hoy sólo la 009 está en `database/migrations/daubert_global/`).
- Procedimiento exacto de backup/restore de PostgreSQL: [operations/backup-restore.md](operations/backup-restore.md).
- Documentar en profundidad Audi y Notificaciones de pago usando la plantilla de Caterpillar.
- Resolver las inconsistencias listadas en [00-overview/environments.md](00-overview/environments.md#inconsistencias-detectadas-deuda-documental-y-de-configuración).

## Regla de mantenimiento

Una feature no está terminada hasta que se actualiza su documentación relevante. Al cambiar comportamiento, actualiza en el mismo PR: el documento del módulo, [system-map.md](00-overview/system-map.md) si cambian rutas/tablas, y crea un ADR si la decisión es arquitectónica.
