# Catálogo de schemas

Schemas propios en PROD y TEST: `audit`, `core`, `operacion`, `ops`, `security`, `staging` (+ `public`, sin objetos propios; `USAGE` para `PUBLIC`, sin `CREATE`). No hay más schemas de usuario. Volver a [database](../README.md).

| schema | tablas | vistas | funciones | propósito |
| --- | --- | --- | --- | --- |
| [`audit`](audit.md) | 1 | 0 | 2 | Bitácora genérica de cambios. |
| [`core`](core.md) | 14 | 10 | 2 | Datos maestros: empresas (proveedores/clientes/servicios/fletes), razones sociales y RFC, alias, contactos y medios de contacto, direcciones, documentos origen y el modelo de notificaciones de pago. |
| [`operacion`](operacion.md) | 5 | 0 | 3 | Documentos operativos y folios: series documentales (contadores), reservas de folios, remisiones y sus renglones, historial de ajustes manuales de folio. |
| [`ops`](ops.md) | 5 | 0 | 6 | Orquestación de automatizaciones: catálogo, ejecuciones, rutas proceso→serie→cliente, auditoría de disparos manuales desde el Hub y acuses de revisión. |
| [`security`](security.md) | 2 | 0 | 0 | Autenticación del Hub: usuarios (rol `ADMIN`/`GENERAL`) y sesiones (hash de token, expiración, revocación). |
| [`staging`](staging.md) | 4 | 0 | 0 | Áreas de aterrizaje para cargas históricas (catálogo de productos exportado de BIND y documentos de manufactura). |
