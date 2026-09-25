# Relaciones (ER por dominio)

Fuente: 342 constraints leídas de `pg_constraint` (incluye las 29 PK y las FK), idénticas en PROD y TEST. Los diagramas muestran solo columnas PK/FK, y se dividen en 6 dominios para mantenerlos legibles. Cardinalidad: `||--o{` = uno a muchos; `||--o|` = uno a cero/uno (FK con índice único). Volver a [database](README.md).

## 1. Empresas y contactos

```mermaid
erDiagram
    CORE_EMPRESAS {
        bigint empresa_id PK
    }
    CORE_EMPRESAS_FISCALES {
        bigint empresa_fiscal_id PK
        bigint empresa_id FK
    }
    CORE_ALIAS_EMPRESA {
        bigint alias_id PK
        bigint empresa_id FK
    }
    CORE_CONTACTOS {
        bigint contacto_id PK
        bigint empresa_id FK
    }
    CORE_MEDIOS_CONTACTO {
        bigint medio_id PK
        bigint contacto_id FK
    }
    CORE_DIRECCIONES {
        bigint direccion_id PK
        bigint empresa_id FK
        bigint empresa_fiscal_id FK
    }
    CORE_DOCUMENTOS {
        bigint documento_id PK
        bigint empresa_id FK
        bigint empresa_fiscal_id FK
    }
    CORE_EMPRESA_ROLES {
        bigint empresa_id PK,FK
        text rol PK
    }
    CORE_EMPRESAS_NOTIFICACION_PAGO {
        bigint empresa_id PK,FK
    }
    CORE_EMPRESAS ||--o{ CORE_EMPRESAS_FISCALES : "empresa_id"
    CORE_EMPRESAS ||--o{ CORE_ALIAS_EMPRESA : "empresa_id"
    CORE_EMPRESAS ||--o{ CORE_CONTACTOS : "empresa_id"
    CORE_CONTACTOS ||--o{ CORE_MEDIOS_CONTACTO : "contacto_id"
    CORE_EMPRESAS_FISCALES ||--o{ CORE_DIRECCIONES : "empresa_fiscal_id (nullable)"
    CORE_EMPRESAS ||--o{ CORE_DIRECCIONES : "empresa_id (nullable)"
    CORE_EMPRESAS_FISCALES ||--o{ CORE_DOCUMENTOS : "empresa_fiscal_id (nullable)"
    CORE_EMPRESAS ||--o{ CORE_DOCUMENTOS : "empresa_id (nullable)"
    CORE_EMPRESAS ||--o{ CORE_EMPRESA_ROLES : "empresa_id"
    CORE_EMPRESAS ||--o| CORE_EMPRESAS_NOTIFICACION_PAGO : "empresa_id"
```

`core.documentos` y `core.direcciones` pertenecen a **una** empresa **o** a **una** empresa fiscal (CHECK XOR). `core.empresas_notificacion_pago` es 1:1 con `core.empresas`. `ON DELETE CASCADE` desde `empresas` hacia alias, contactos (y sus medios), roles, direcciones, documentos y config de notificaciones; `RESTRICT` hacia `empresas_fiscales`.

## 2. Automatizaciones

```mermaid
erDiagram
    OPS_AUTOMATIZACIONES {
        bigint automatizacion_id PK
    }
    OPS_EJECUCIONES_AUTOMATIZACION {
        bigint ejecucion_id PK
        bigint automatizacion_id FK
        bigint documento_origen_id FK
        bigint reproceso_de_id FK
    }
    OPS_AUTOMATIZACION_SERIES_PROCESO {
        bigint ruta_id PK
        bigint automatizacion_id FK
        bigint serie_id FK
        bigint empresa_cliente_id FK
    }
    OPS_AUTOMATION_TRIGGER_REQUESTS {
        bigint trigger_request_id PK
        bigint requested_by_user_id FK
    }
    OPS_AUTOMATION_REVIEW_ACKNOWLEDGEMENTS {
        bigint acknowledgement_id PK
        bigint reviewed_by_user_id FK
    }
    CORE_DOCUMENTOS {
        bigint documento_id PK
        bigint empresa_id FK
        bigint empresa_fiscal_id FK
    }
    CORE_EMPRESAS {
        bigint empresa_id PK
    }
    OPERACION_SERIES_DOCUMENTALES {
        bigint serie_id PK
    }
    SECURITY_USERS {
        bigint user_id PK
    }
    OPS_AUTOMATIZACIONES ||--o{ OPS_EJECUCIONES_AUTOMATIZACION : "automatizacion_id"
    CORE_DOCUMENTOS ||--o{ OPS_EJECUCIONES_AUTOMATIZACION : "documento_origen_id"
    OPS_EJECUCIONES_AUTOMATIZACION ||--o{ OPS_EJECUCIONES_AUTOMATIZACION : "reproceso_de_id (nullable)"
    OPS_AUTOMATIZACIONES ||--o{ OPS_AUTOMATIZACION_SERIES_PROCESO : "automatizacion_id"
    CORE_EMPRESAS ||--o{ OPS_AUTOMATIZACION_SERIES_PROCESO : "empresa_cliente_id"
    OPERACION_SERIES_DOCUMENTALES ||--o{ OPS_AUTOMATIZACION_SERIES_PROCESO : "serie_id"
    SECURITY_USERS ||--o{ OPS_AUTOMATION_TRIGGER_REQUESTS : "requested_by_user_id (nullable)"
    SECURITY_USERS ||--o{ OPS_AUTOMATION_REVIEW_ACKNOWLEDGEMENTS : "reviewed_by_user_id (nullable)"
    CORE_EMPRESAS ||--o{ CORE_DOCUMENTOS : "empresa_id (nullable)"
```

`ejecuciones_automatizacion.reproceso_de_id` es una FK a la misma tabla (con índice único parcial: un solo hijo por padre; el diagrama la muestra como relación reflexiva implícita en la tabla). Las tablas de disparo/acuse apuntan a `security.users` con `SET NULL`.

## 3. Folios y remisiones

```mermaid
erDiagram
    OPERACION_SERIES_DOCUMENTALES {
        bigint serie_id PK
    }
    OPERACION_RESERVAS_FOLIOS {
        bigint reserva_id PK
        bigint ejecucion_id FK
        bigint serie_id FK
    }
    OPERACION_AJUSTES_SERIES {
        bigint ajuste_id PK
        bigint serie_id FK
    }
    OPERACION_REMISIONES {
        bigint remision_id PK
        bigint serie_id FK
        bigint empresa_cliente_id FK
        bigint ejecucion_id FK
    }
    OPERACION_REMISION_DETALLE {
        bigint detalle_id PK
        bigint remision_id FK
    }
    OPS_EJECUCIONES_AUTOMATIZACION {
        bigint ejecucion_id PK
        bigint automatizacion_id FK
        bigint documento_origen_id FK
        bigint reproceso_de_id FK
    }
    OPS_AUTOMATIZACION_SERIES_PROCESO {
        bigint ruta_id PK
        bigint automatizacion_id FK
        bigint serie_id FK
        bigint empresa_cliente_id FK
    }
    CORE_EMPRESAS {
        bigint empresa_id PK
    }
    OPS_EJECUCIONES_AUTOMATIZACION ||--o{ OPERACION_RESERVAS_FOLIOS : "ejecucion_id"
    OPERACION_SERIES_DOCUMENTALES ||--o{ OPERACION_RESERVAS_FOLIOS : "serie_id"
    OPERACION_SERIES_DOCUMENTALES ||--o{ OPERACION_AJUSTES_SERIES : "serie_id"
    OPS_EJECUCIONES_AUTOMATIZACION ||--o{ OPERACION_REMISIONES : "ejecucion_id"
    CORE_EMPRESAS ||--o{ OPERACION_REMISIONES : "empresa_cliente_id"
    OPERACION_SERIES_DOCUMENTALES ||--o{ OPERACION_REMISIONES : "serie_id"
    OPERACION_REMISIONES ||--o{ OPERACION_REMISION_DETALLE : "remision_id"
    OPS_EJECUCIONES_AUTOMATIZACION ||--o{ OPS_EJECUCIONES_AUTOMATIZACION : "reproceso_de_id (nullable)"
    CORE_EMPRESAS ||--o{ OPS_AUTOMATIZACION_SERIES_PROCESO : "empresa_cliente_id"
    OPERACION_SERIES_DOCUMENTALES ||--o{ OPS_AUTOMATIZACION_SERIES_PROCESO : "serie_id"
```

Todas las FK de este dominio son `ON DELETE RESTRICT`: ni series, ni ejecuciones, ni empresas con folios/remisiones se pueden borrar. Ruta ejecución → reserva → remisión: ver [folios](folios.md).

## 4. Seguridad y autenticación

```mermaid
erDiagram
    SECURITY_USERS {
        bigint user_id PK
    }
    SECURITY_SESSIONS {
        bigint session_id PK
        bigint user_id FK
    }
    OPS_AUTOMATION_TRIGGER_REQUESTS {
        bigint trigger_request_id PK
        bigint requested_by_user_id FK
    }
    OPS_AUTOMATION_REVIEW_ACKNOWLEDGEMENTS {
        bigint acknowledgement_id PK
        bigint reviewed_by_user_id FK
    }
    SECURITY_USERS ||--o{ SECURITY_SESSIONS : "user_id"
    SECURITY_USERS ||--o{ OPS_AUTOMATION_TRIGGER_REQUESTS : "requested_by_user_id (nullable)"
    SECURITY_USERS ||--o{ OPS_AUTOMATION_REVIEW_ACKNOWLEDGEMENTS : "reviewed_by_user_id (nullable)"
```

`audit.cambios` **no tiene FK** (referencia lógica por `esquema`/`tabla`/`registro_id` textual y `usuario_id` textual): por eso no aparece como entidad relacionada. `sessions` se borra en cascada con el usuario.

## 5. Notificaciones de pago

```mermaid
erDiagram
    CORE_CORREOS_NOTIFICACION_PAGO {
        bigint correo_id PK
    }
    CORE_RESULTADOS_NOTIFICACION_PAGO {
        bigint correo_id PK,FK
        bigint empresa_id PK,FK
    }
    CORE_BORRADORES_NOTIFICACION_PAGO {
        bigint borrador_id PK
        bigint correo_id FK
        bigint empresa_id FK
    }
    CORE_EMPRESAS {
        bigint empresa_id PK
    }
    CORE_EMPRESAS_NOTIFICACION_PAGO {
        bigint empresa_id PK,FK
    }
    CORE_CONTACTOS {
        bigint contacto_id PK
        bigint empresa_id FK
    }
    CORE_MEDIOS_CONTACTO {
        bigint medio_id PK
        bigint contacto_id FK
    }
    CORE_ALIAS_EMPRESA {
        bigint alias_id PK
        bigint empresa_id FK
    }
    CORE_CORREOS_NOTIFICACION_PAGO ||--o{ CORE_RESULTADOS_NOTIFICACION_PAGO : "correo_id"
    CORE_EMPRESAS ||--o{ CORE_RESULTADOS_NOTIFICACION_PAGO : "empresa_id"
    CORE_CORREOS_NOTIFICACION_PAGO ||--o{ CORE_BORRADORES_NOTIFICACION_PAGO : "correo_id"
    CORE_EMPRESAS ||--o{ CORE_BORRADORES_NOTIFICACION_PAGO : "empresa_id"
    CORE_EMPRESAS ||--o| CORE_EMPRESAS_NOTIFICACION_PAGO : "empresa_id"
    CORE_EMPRESAS ||--o{ CORE_CONTACTOS : "empresa_id"
    CORE_CONTACTOS ||--o{ CORE_MEDIOS_CONTACTO : "contacto_id"
    CORE_EMPRESAS ||--o{ CORE_ALIAS_EMPRESA : "empresa_id"
```

Las tablas `*_notificacion_pago` de correos/resultados/borradores usan `NO ACTION` hacia `empresas`. El catálogo que ve n8n se construye con las vistas `core.vw_contactos_notificacion_pago_n8n` y `core.vw_catalogo_notificacion_pago_n8n` sobre `empresas`, `empresas_notificacion_pago`, `contactos`, `medios_contacto` y `alias_empresa` ([vistas](views/README.md)).

## 6. Staging / manufactura

```mermaid
erDiagram
    STAGING_CARGAS_FUENTE {
        bigint carga_id PK
    }
    STAGING_BIND_PRODUCTOS_RAW {
        bigint registro_id PK
        bigint carga_id FK
    }
    STAGING_MANUFACTURA_DOCUMENTOS {
        bigint documento_id PK
        bigint carga_id FK
    }
    STAGING_MANUFACTURA_PRODUCTOS_EXTRAIDOS {
        bigint extraccion_id PK
        bigint documento_id FK
    }
    STAGING_CARGAS_FUENTE ||--o{ STAGING_BIND_PRODUCTOS_RAW : "carga_id"
    STAGING_CARGAS_FUENTE ||--o{ STAGING_MANUFACTURA_DOCUMENTOS : "carga_id"
    STAGING_MANUFACTURA_DOCUMENTOS ||--o{ STAGING_MANUFACTURA_PRODUCTOS_EXTRAIDOS : "documento_id"
```

Dominio coherente y **aislado**: sus 3 FK son internas al esquema `staging`; no hay FK hacia `core`/`ops`/`operacion`.

## Inventario completo de foreign keys (33)

| tabla | columna(s) | referencia | ON DELETE | constraint |
| --- | --- | --- | --- | --- |
| `core.alias_empresa` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE | `alias_empresa_empresa_id_fkey` |
| `core.borradores_notificacion_pago` | `correo_id` | `core.correos_notificacion_pago(correo_id)` | NO ACTION | `borradores_notificacion_pago_correo_id_fkey` |
| `core.borradores_notificacion_pago` | `empresa_id` | `core.empresas(empresa_id)` | NO ACTION | `borradores_notificacion_pago_empresa_id_fkey` |
| `core.contactos` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE | `contactos_empresa_id_fkey` |
| `core.direcciones` | `empresa_fiscal_id` | `core.empresas_fiscales(empresa_fiscal_id)` | CASCADE | `direcciones_empresa_fiscal_id_fkey` |
| `core.direcciones` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE | `direcciones_empresa_id_fkey` |
| `core.documentos` | `empresa_fiscal_id` | `core.empresas_fiscales(empresa_fiscal_id)` | CASCADE | `documentos_empresa_fiscal_id_fkey` |
| `core.documentos` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE | `documentos_empresa_id_fkey` |
| `core.empresa_roles` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE | `empresa_roles_empresa_id_fkey` |
| `core.empresas_fiscales` | `empresa_id` | `core.empresas(empresa_id)` | RESTRICT | `empresas_fiscales_empresa_id_fkey` |
| `core.empresas_notificacion_pago` | `empresa_id` | `core.empresas(empresa_id)` | CASCADE | `empresas_notificacion_pago_empresa_id_fkey` |
| `core.medios_contacto` | `contacto_id` | `core.contactos(contacto_id)` | CASCADE | `medios_contacto_contacto_id_fkey` |
| `core.resultados_notificacion_pago` | `correo_id` | `core.correos_notificacion_pago(correo_id)` | CASCADE | `fk_resultado_correo` |
| `core.resultados_notificacion_pago` | `empresa_id` | `core.empresas(empresa_id)` | NO ACTION | `fk_resultado_empresa` |
| `operacion.ajustes_series` | `serie_id` | `operacion.series_documentales(serie_id)` | RESTRICT | `fk_ajustes_series_serie` |
| `operacion.remision_detalle` | `remision_id` | `operacion.remisiones(remision_id)` | RESTRICT | `fk_remision_detalle_remision` |
| `operacion.remisiones` | `ejecucion_id` | `ops.ejecuciones_automatizacion(ejecucion_id)` | RESTRICT | `fk_remisiones_ejecucion` |
| `operacion.remisiones` | `empresa_cliente_id` | `core.empresas(empresa_id)` | RESTRICT | `fk_remisiones_empresa_cliente` |
| `operacion.remisiones` | `serie_id` | `operacion.series_documentales(serie_id)` | RESTRICT | `fk_remisiones_serie` |
| `operacion.reservas_folios` | `ejecucion_id` | `ops.ejecuciones_automatizacion(ejecucion_id)` | RESTRICT | `fk_reservas_folios_ejecucion` |
| `operacion.reservas_folios` | `serie_id` | `operacion.series_documentales(serie_id)` | RESTRICT | `fk_reservas_folios_serie` |
| `ops.automation_review_acknowledgements` | `reviewed_by_user_id` | `security.users(user_id)` | SET NULL | `fk_automation_review_acknowledgements_user` |
| `ops.automation_trigger_requests` | `requested_by_user_id` | `security.users(user_id)` | SET NULL | `fk_automation_trigger_requests_user` |
| `ops.automatizacion_series_proceso` | `automatizacion_id` | `ops.automatizaciones(automatizacion_id)` | RESTRICT | `fk_automatizacion_series_proceso_automatizacion` |
| `ops.automatizacion_series_proceso` | `empresa_cliente_id` | `core.empresas(empresa_id)` | RESTRICT | `fk_automatizacion_series_proceso_empresa_cliente` |
| `ops.automatizacion_series_proceso` | `serie_id` | `operacion.series_documentales(serie_id)` | RESTRICT | `fk_automatizacion_series_proceso_serie` |
| `ops.ejecuciones_automatizacion` | `automatizacion_id` | `ops.automatizaciones(automatizacion_id)` | RESTRICT | `fk_ejecuciones_automatizacion_automatizacion` |
| `ops.ejecuciones_automatizacion` | `documento_origen_id` | `core.documentos(documento_id)` | RESTRICT | `fk_ejecuciones_automatizacion_documento` |
| `ops.ejecuciones_automatizacion` | `reproceso_de_id` | `ops.ejecuciones_automatizacion(ejecucion_id)` | RESTRICT | `fk_ejecuciones_automatizacion_reproceso` |
| `security.sessions` | `user_id` | `security.users(user_id)` | CASCADE | `fk_sessions_user` |
| `staging.bind_productos_raw` | `carga_id` | `staging.cargas_fuente(carga_id)` | NO ACTION | `bind_productos_raw_carga_id_fkey` |
| `staging.manufactura_documentos` | `carga_id` | `staging.cargas_fuente(carga_id)` | NO ACTION | `manufactura_documentos_carga_id_fkey` |
| `staging.manufactura_productos_extraidos` | `documento_id` | `staging.manufactura_documentos(documento_id)` | NO ACTION | `manufactura_productos_extraidos_documento_id_fkey` |

## Tablas sin relaciones FK

`audit.cambios`, `core.snapshot_carga_empresas_inicial`, `core.stg_contactos_notificacion_pago` (`audit.cambios`, `core.snapshot_carga_empresas_inicial`, `core.stg_contactos_notificacion_pago`).
