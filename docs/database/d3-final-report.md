# Reporte final de la Fase D3 (PostgreSQL)

Cierre documental de la auditoría de PostgreSQL. Los 67 puntos están numerados para poder comprobar que ninguno falta. **No se modificó la base, n8n, Docker, `.env` ni `apps/`; no hay commit ni push.** Volver a [database](README.md).

Etiquetas: **CONFIRMED** (demostrado por catálogo o archivo), **INFERRED** (deducido), **UNKNOWN** / **PENDIENTE** (no demostrable o sin decisión).

## Alcance y acceso (puntos 1–5)

1. **Versión**: PostgreSQL 18.4.
2. **Bases auditadas**: PROD `daubert_global` y TEST `daubert_hub_test` (mismo clúster).
3. **Rol utilizado**: `daubert_docs_ro` (catálogo; sin `SELECT` en tablas de negocio). Ver [roles](roles.md).
4. **READ ONLY**: `transaction_read_only = on` en ambas; solo consultas de catálogo.
5. **Schemas PROD**: `audit`, `core`, `operacion`, `ops`, `security`, `staging` (+ `public`). Ver [schemas](schemas/README.md).

## Inventario (puntos 6–18)

6. **Schemas TEST**: los mismos que PROD.
7. **Tablas**: 31 en PROD y 31 en TEST. [tables](tables/README.md).
8. **Vistas**: 10 / 10. [views](views/README.md).
9. **Funciones**: 13 / 13. [functions](functions/README.md).
10. **Triggers**: 25 / 25. [triggers](triggers.md).
11. **Sequences**: 26 / 26. [sequences](sequences.md).
12. **Índices**: 89 / 89. [indexes](indexes.md).
13. **Constraints**: 342 / 342. [integrity-rules](integrity-rules.md).
14. **Roles relevantes** (6, de clúster): `postgres`, `daubert_hub_app`, `daubert_hub_test_user`, `n8n_app`, `n8n_cat_test`, `daubert_docs_ro`. [roles](roles.md).
15. **Catálogo de schemas**: [schemas/](schemas/README.md).
16. **Catálogo de tablas**: 31 fichas en [tables/](tables/README.md).
17. **Catálogo de vistas**: 10 fichas en [views/](views/README.md).
18. **Catálogo de funciones**: 13 fichas en [functions/](functions/README.md).

## Seguridad y permisos (puntos 19–24)

19. **SECURITY DEFINER**: 10 funciones, todas propiedad de `postgres`; 0 HIGH_RISK, 1 REVIEW (`ops.fn_crear_ejecucion_automatizacion`, por no validar el padre de un reproceso, sin escalamiento de privilegios), 9 OK. [security-definer](security-definer.md#por-qué-opsfn_crear_ejecucion_automatizacion-es-review-y-no-high_risk).
20. **`daubert_hub_app` (PROD)**: DML sobre tablas del Hub, `SELECT` en lectura de automatizaciones, sin `EXECUTE` de negocio; **sin grants en `core.direcciones`** (DB-01). [permissions-matrix](permissions-matrix.md), [hub-contract](hub-contract.md).
21. **`n8n_app`**: 12 tablas/vistas y 9 funciones de negocio en PROD; sin `DELETE`, `TRUNCATE` ni `CREATE`. [n8n-app-audit](n8n-app-audit.md), [n8n-contract](n8n-contract.md).
22. **Permisos TEST**: `daubert_hub_test_user` con DML más amplio (incluye `DELETE` sobre `audit.cambios` y sobre vistas); `n8n_cat_test` solo `EXECUTE` de 8 funciones definer. [test-prod-drift](test-prod-drift.md).
23. **`daubert_docs_ro`**: `USAGE` de schemas y lectura de catálogo; 0 tablas y 0 vistas con `SELECT`.
24. **Posibles excesos**: `n8n_app` con `UPDATE` en `operacion.series_documentales`, `INSERT/UPDATE` en `ops.ejecuciones_automatizacion`, `UPDATE` en `operacion.remisiones` y `SELECT` completo de `core.empresas`. Son **posibles** (Audi y Notificaciones pueden depender de SQL directo); no se propone retirarlos sin migrar antes. También `PUBLIC` con `CONNECT` a PROD.

## Modelos (puntos 25–32)

25. **Arquitectura de folios**: [folios](folios.md), [document-series](document-series.md).
26. **Allocator Audi vs Caterpillar**: Audi usa `operacion.reservar_folios` (`INVOKER`, requiere `UPDATE` directo en series); Caterpillar usa `reservar_folios_para_ejecucion` (definer, con `reservas_folios`). [audi-legacy-allocator](audi-legacy-allocator.md).
27. **Modelo Caterpillar**: [caterpillar/database-contract](../automations/caterpillar/database-contract.md).
28. **Modelo Audi**: [audi/database-contract](../automations/audi/database-contract.md).
29. **Modelo Notificaciones**: [payment-notifications/database-contract](../automations/payment-notifications/database-contract.md).
30. **Security/auth**: `security.users`, `security.sessions` (solo hash de token; sin purga automática). [security.users](tables/security.users.md), [security.sessions](tables/security.sessions.md).
31. **Audit**: `audit.cambios` escrita por triggers definer; sin retención definida. [audit.cambios](tables/audit.cambios.md).
32. **Staging**: `staging.*` sin grants de aplicación ni consumidores demostrables; ciclo de vida PENDIENTE. [staging.cargas_fuente](tables/staging.cargas_fuente.md).

## Integridad y migraciones (puntos 33–37)

33. **Índices críticos**: únicos parciales de `ops.ejecuciones_automatizacion` (una `PROCESANDO`, una `COMPLETADA` original, un hijo por reproceso). [indexes](indexes.md).
34. **Reglas de integridad**: [integrity-rules](integrity-rules.md).
35. **Triggers funcionales**: auditoría (`audit.fn_registrar_cambio*`), `updated_at`, dueño único de serie/proceso. [triggers](triggers.md).
36. **Migraciones identificadas**: la 009 (CONFIRMED en PROD) y las externas `20260827…`–`20260922…` (INFERRED). [migrations](migrations.md).
37. **Objetos sin migración versionada**: todos salvo la 009 (31 tablas, 10 vistas, 25 triggers, etc.). No hay tabla de migration history (MIG-01) y solo la 009 está en Git (MIG-02); eso no implica que sea la única aplicada.

## TEST vs PROD (puntos 38–43)

38. **Drift**: SCHEMA equivalente; FUNCTIONAL STRUCTURE equivalente; FUNCTION TEXT con 6 diferencias no funcionales; PERMISSIONS con drift real. [test-prod-drift](test-prod-drift.md).
39. **Permission drift**: real (ver punto 22); excepción inversa `operacion.remision_detalle` (`SELECT` del Hub solo en PROD).
40. **Function drift**: ninguno funcional; 6 funciones difieren solo en comentarios/CRLF.
41. **View drift**: ninguno (10 definiciones idénticas).
42. **ONLY_TEST**: ninguno.
43. **ONLY_PROD**: ninguno.

## Método y entregables (puntos 44–52)

44. **Por qué no hubo `pg_dump`**: `daubert_docs_ro` no puede; `pg_dump` solicita locks `ACCESS SHARE` que requieren privilegios sobre las tablas. No se ampliaron permisos. Snapshot **PENDIENTE — generación manual controlada**. [schema-snapshots](schema-snapshots.md).
45. **Diagramas**: 6 ER Mermaid en [relationships](relationships.md). Validación **estática**, no con el renderer oficial de Mermaid.
46. **Fichas de tablas**: 31.
47. **Fichas de funciones**: 13.
48. **Data dictionary**: [data-dictionary](data-dictionary.md).
49. **Backup/restore**: [database-backup-restore](../operations/database-backup-restore.md); ubicación, retención, cifrado y periodicidad PENDIENTES.
50. **Troubleshooting**: [troubleshooting](troubleshooting.md).
51. **Archivos creados**: 83 archivos nuevos (82 previos + este reporte), todos bajo `docs/`.
52. **Archivos modificados**: 10 (README de docs y de operations, `backup-restore`, `database/README`, `architecture`, `migrations`, `roles-permissions` y 3 `database-contract`), más ediciones de cierre en `migrations`, `test-prod-drift`, `n8n-app-audit`, `security-definer`, `schema-snapshots` y fichas de tabla.

## Validación (puntos 53–57)

53. **`git diff --stat`**: incluido en la respuesta de cierre.
54. **`git status --short`**: incluido en la respuesta de cierre.
55. **`git diff --check`**: solo avisos LF/CRLF; sin errores de espacios.
56. **Validación de enlaces**: enlaces y anclas internas, archivos vacíos, headings duplicados y `schema.objeto` (resultado en la respuesta de cierre).
57. **Secretos/privacidad**: escaneo de secretos y correos reales sin valores sensibles.

## Riesgos y recomendaciones (puntos 58–61)

58. **Riesgos** (registrados, **no corregidos**):

| id | riesgo | severidad |
| --- | --- | --- |
| DB-01 | `daubert_hub_app` sin permiso sobre `core.direcciones` en PROD, aunque el Hub la usa; contradice D1 y la migración `20260902_002`. Causa UNKNOWN. | ALTO |
| DB-02 | `n8n_app` con grants posiblemente más amplios de lo necesario. | MEDIO |
| AUDI-DB-01 | Sin recuperación de ejecuciones `PROCESANDO` (ni en DB ni en workflows versionados); no se sabe si hay ejecuciones colgadas. | ALTO |
| MIG-01 | Sin migration history formal. | MEDIO |
| MIG-02 | Solo la 009 versionada en Git. | MEDIO |
| SEC-DB-01 | Funciones definer propiedad de `postgres`; evaluar propietario `NOLOGIN`. | MEDIO |
| TEST-DB-01 | Roles TEST y PROD no representan el mismo modelo de permisos. | MEDIO |
| OPS-DB-01 | Backup/restore sin política organizacional cerrada. | ALTO |

59. **Deuda técnica**: Audi con SQL directo; allocator legado `INVOKER`; sin purga de `security.sessions`; sin retención de `audit.cambios`; `staging.*` y tablas de carga inicial sin consumidores; `pg_temp` ausente de los `search_path` definer; `ops.fn_resolver_ruta_automatizacion` sin uso demostrable.
60. **Recomendaciones futuras** (no implementadas), priorizadas:
    - **ALTO**: corregir/decidir el permiso de `core.direcciones`; decidir backup/retención/cifrado; recuperación segura de `PROCESANDO` en Audi.
    - **MEDIO**: revisar least privilege de `n8n_app` y separar roles por automatización; migrar Audi a funciones; introducir migration history y versionar migraciones históricas; propietario `NOLOGIN` para las definer; alinear roles TEST con PROD.
    - **BAJO**: `REVOKE CONNECT … FROM PUBLIC` en PROD; añadir `pg_temp` a los `search_path`; definir ciclo de vida de `staging.*`; retención de `audit.cambios` y purga de `security.sessions`.
61. **Para D4**: inspeccionar (con acceso autorizado) valores de series, `siguiente_folio`, rutas, `folio_minimo_ajustable`, ejecuciones y reservas `PROCESANDO`; generar el snapshot `pg_dump --schema-only` con un rol administrativo; cerrar las decisiones pendientes de abajo.

**Decisiones pendientes (humanas)**: ubicación, retención y cifrado de backups; retención de `audit.cambios`; purga de `security.sessions`; causa de DB-01; política de cancelación de remisiones; mapping credencial n8n → rol PostgreSQL; futuro de `staging.*`; futuro de tablas/vistas de carga inicial.

## Confirmaciones (puntos 62–67)

62. **DB solo lectura**: confirmado; no se modificó ninguna base.
63. **Ninguna función de negocio ejecutada**: confirmado; sin lectura de datos empresariales ni hashes.
64. **n8n no modificado**: confirmado.
65. **Docker y `.env` no modificados**: confirmado (tampoco `apps/`).
66. **NO commit**: confirmado.
67. **NO push**: confirmado.
