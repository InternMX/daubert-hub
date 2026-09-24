# Decisiones de arquitectura (ADR)

Registro de decisiones **respaldadas por la evidencia del sistema actual** (código, SQL, comentarios de migración, documentos de despliegue). Los ADR se redactaron **retroactivamente** en la Fase D1 (2026-09-24): documentan lo que el sistema ya hace y por qué lo declara, no reconstruyen historia. No se listan alternativas históricas salvo que haya evidencia.

| ADR | Título | Estado |
| --- | --- | --- |
| [ADR-001](ADR-001-postgresql-fuente-de-verdad-operativa.md) | PostgreSQL como fuente de verdad operativa | Aceptado (implementado) |
| [ADR-002](ADR-002-n8n-app-rol-compartido-prod.md) | `n8n_app` como rol n8n de PROD compartido | Aceptado (implementado; con riesgo conocido) |
| [ADR-003](ADR-003-reserva-de-folios-en-postgresql.md) | Reserva de folios en PostgreSQL | Aceptado (implementado) |
| [ADR-004](ADR-004-reproceso-ejecucion-hija-inmutable.md) | Reproceso mediante ejecución hija inmutable | Aceptado (implementado, en PROD) |
| [ADR-005](ADR-005-hub-consume-estado-automatizaciones.md) | El Hub consume estado de automatizaciones y no reconstruye lógica de negocio | Aceptado (implementado) |

## Candidatos a futuros ADR (con evidencia en el código, no redactados)

- Sesiones server-side con hash SHA-256 del token y vida absoluta de 12 h.
- Protección CSRF por Origin/Fetch-Metadata además de `SameSite=Strict`.
- "TEST es la fuente de verdad funcional; PROD recibe el estado final".
- Autorización aditiva: `@Roles` sólo donde se declara.
- Ajuste de folios con piso histórico explícito (`folio_minimo_ajustable`) en vez de inferirlo.

## Plantilla

```markdown
# ADR-NNN Título

- **Status:** Propuesto | Aceptado | Sustituido por ADR-XXX
- **Fecha:** AAAA-MM-DD

## Context
Qué situación o restricción motiva la decisión (con enlaces a evidencia).

## Decision
Qué se decide.

## Consequences
Efectos positivos, costos y riesgos.

## Alternatives Considered
Sólo si hay evidencia (commits, documentos, comentarios). Si no, omitir la sección.
```

Convención: un ADR aceptado no se edita para cambiar su sentido; se crea otro que lo sustituya.
