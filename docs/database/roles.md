# Roles de PostgreSQL

Fuente: `pg_roles` (vista pública; **no** `pg_authid`, no se leyó ningún hash), `pg_auth_members`, `pg_default_acl`, ACL de bases/schemas/objetos. Roles de usuario en el clúster: 6 (+ roles internos `pg_*`, omitidos). Atributos idénticos en PROD y TEST: **sí**. Volver a [database](README.md). Complementa a [roles-permissions](roles-permissions.md) (D1).

## Atributos

| rol | LOGIN | SUPERUSER | CREATEDB | CREATEROLE | REPLICATION | BYPASSRLS | INHERIT | CONNLIMIT | ajustes de rol |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `daubert_docs_ro` | sí | no | no | no | no | no | sí | -1 | `{default_transaction_read_only=on,statement_timeout=30s,lock_timeout=5s}` |
| `daubert_hub_app` | sí | no | no | no | no | no | sí | -1 |  |
| `daubert_hub_test_user` | sí | no | no | no | no | no | sí | -1 |  |
| `n8n_app` | sí | no | no | no | no | no | sí | -1 |  |
| `n8n_cat_test` | sí | no | no | no | no | no | sí | 5 |  |
| `postgres` | sí | sí | sí | sí | sí | sí | sí | -1 |  |

- **Membresías** (`pg_auth_members`) entre roles de usuario: **ninguna** (0 filas). No hay herencia de privilegios entre roles del proyecto.
- **Default privileges**: ninguno (0 filas).
- **Row level security**: ninguna tabla tiene RLS habilitado (`relrowsecurity = false` en todas).
- `VALID UNTIL`: ninguno configurado.

## Uso previsto y evidencia

| rol | entorno | uso | evidencia de privilegios |
| --- | --- | --- | --- |
| `postgres` | PROD/TEST | Superusuario: DDL y administración; propietario de todos los objetos y de las 10 funciones `SECURITY DEFINER`. | Propietario de todo. Ver [security-definer](security-definer.md). |
| `daubert_hub_app` | PROD | Runtime de la API del Hub. | DML acotado sobre 22 tablas; sin `EXECUTE` de negocio; sin `DELETE` salvo `core.alias_empresa`. En TEST solo tiene `CONNECT`/`USAGE public` (no se usa). |
| `daubert_hub_test_user` | TEST | Runtime de la API en TEST y fixtures de integración. | `SELECT/INSERT/UPDATE/DELETE` sobre casi todo `audit/core/operacion/ops/security` y sus vistas. En PROD: solo `CONNECT` (PUBLIC) y `USAGE public`. |
| `n8n_app` | PROD (y TEST) | Runtime de n8n; **compartido** por Audi, Caterpillar y Notificaciones ([ADR-002](../decisions/ADR-002-n8n-app-rol-compartido-prod.md)). | 12 tablas/vistas + 9 funciones en PROD. Auditoría: [n8n-app-audit](n8n-app-audit.md). |
| `n8n_cat_test` | TEST | Runtime de n8n para Caterpillar en TEST. | Solo `USAGE` de `core/operacion/ops` + `EXECUTE` de 8 funciones definer; **0 grants de tabla**. En PROD: sin privilegios más allá de `PUBLIC`. |
| `daubert_docs_ro` | PROD/TEST | Documentación/auditoría de solo lectura (D3). | Ver [permissions-matrix](permissions-matrix.md#daubert_docs_ro). Verificado: `transaction_read_only = on` en ambas bases. |

## Privilegios a nivel de base de datos

- ACL PROD: `=Tc/postgres, postgres=CTc/postgres, daubert_docs_ro=c/postgres`.
- ACL TEST: `=Tc/postgres, postgres=CTc/postgres, daubert_hub_test_user=c/postgres, daubert_docs_ro=c/postgres`.
- `=Tc` = `PUBLIC` tiene `CONNECT` + `TEMPORARY`. **Consecuencia**: `n8n_cat_test` y `daubert_hub_test_user` pueden conectarse a `daubert_global`; su contención descansa en que no tienen grants de objeto allí (verificado: sin privilegios de tabla/función en PROD). Riesgo residual: cualquiera puede crear tablas temporales.

## Schemas, tablas, sequences y funciones

Detalle completo en [permissions-matrix](permissions-matrix.md). Resumen de principios observados:

1. Ningún rol de aplicación tiene `CREATE` en ningún schema ni `TRUNCATE`/`REFERENCES`/`TRIGGER`.
2. `SECURITY DEFINER` + `REVOKE … FROM PUBLIC` en las 8 funciones de negocio definer: solo `n8n_app` (PROD) o `n8n_cat_test` (TEST) pueden ejecutarlas. Las 4 funciones trigger conservan el `EXECUTE` por defecto de `PUBLIC`.
3. `daubert_hub_app` **no** puede ejecutar ninguna función de negocio (ni `reservar_folios`, ni las `fn_*`).
4. `staging` no tiene grants para roles de aplicación en ninguna base.

## Hallazgos de roles

- **PERMISSION_DRIFT** Hub: PROD `daubert_hub_app` ≠ TEST `daubert_hub_test_user` (TEST es más ancho). Ver [test-prod-drift](test-prod-drift.md#permisos).
- **Brecha PROD**: `daubert_hub_app` sin grants en `core.direcciones` (el código los necesita).
- **Sin RLS, sin BYPASSRLS** en roles de aplicación: el aislamiento depende solo de grants.
- `daubert_hub_test_user` y `n8n_cat_test` tienen `CONNECT` a PROD por `PUBLIC`: considerar `REVOKE CONNECT ON DATABASE daubert_global FROM PUBLIC` como mejora futura (**no aplicado**).
