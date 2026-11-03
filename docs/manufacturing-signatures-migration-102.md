# Responsables y firmas · migración TEST 102 y guía de prueba

**Estado:** desarrollado y probado contra instancias PostgreSQL **desechables**. La migración **no está aplicada** a `daubert_hub_test`: requiere revisión y autorización expresa. Mientras no se aplique, la aplicación funciona con un solo responsable («Generó», que corresponde al campo documental `Elaboró`) y sin catálogo de firmas.

## Qué incluye
- **Un solo responsable obligatorio, hasta tres:** el primero es siempre «Generó» (nombre sugerido desde la cuenta autenticada, editable); el segundo y el tercero son opcionales, con función a elegir (Generó, Revisó o Aprobó, repetibles), nombre editable y quitar.
- **Sin casilla de confirmación:** pulsar «Finalizar y generar PDF» confirma el nombre de «Generó» visible. El servidor lo registra con la sesión autenticada y la versión vigente **dentro de la misma transacción** que valida la hoja e inicia la finalización: si falta cualquier requisito (cliente, datos, firma no disponible…) se revierte todo y no queda nada confirmado a medias.
- **Catálogo de firmas:** miniaturas con propietario, «Sin firma», «+ Nueva firma» (JPG/PNG con vista previa antes de guardar). Solo se listan las firmas propias y las de personas que autorizaron su uso; un ADMIN puede incorporar la firma de otra persona o de alguien sin cuenta (queda como custodio y registrado).
- **Imágenes:** el servidor no confía en la extensión: identifica el formato por su contenido, **decodifica** la imagen, limita bytes (2 MB de entrada) y píxeles (16 MP), rechaza SVG/archivos dañados/vacíos/minúsculos, la reduce a un máximo de 600 × 240 px, descarta metadatos y la **re-codifica como PNG** (≤ 256 KB). Los binarios viven en PostgreSQL (`manufactura.firmas`), nunca en el JSON de la especificación ni en el navegador.
- **Propiedad y autorización:** el nombre de la propietaria sale de su cuenta; con imagen, el nombre impreso es el de su propietaria (no se puede atribuir la imagen a otra persona). La autorización de uso es un permiso de acceso al recurso, no una aprobación documental.
- **Historial:** los responsables se congelan al iniciar la finalización. REV01 conserva sus responsables y la huella de cada imagen aunque la firma se retire o cambie su autorización; REV02 recupera nombres y funciones como referencia editable y **no hereda imágenes**.
- **PDF:** los PDF **finalizados** con responsables imprimen en cada recuadro de firma la imagen (o «SIN FIRMA»), el nombre y la función; con tres responsables se reparte la zona de firmas en tres columnas. No se modificó ninguna plantilla aprobada (se reutilizan los recuadros `firma_elaboro` y `firma_aprobo` y solo el tercero se añade en la composición). Los borradores y las hojas sin responsables conservan exactamente el marcador «SIN FIRMA» y la leyenda de borrador; los PDF ya finalizados no se tocan.

## Base de datos (migración 102, solo TEST)
Archivos en `database/migrations/daubert_hub_test/`: `20261103_102_manufactura_responsables_firmas_test.{precheck,up,postcheck,smoke,down}.sql` (+ README y `tools/validar-102-en-instancia-desechable.cjs`).

- 3 tablas nuevas en `manufactura` (`firmas`, `firma_autorizaciones`, `revision_responsables`); **ninguna tabla, función ni trigger existente se modifica** (el postcheck lo demuestra con una huella de las 5 tablas de la 101).
- 8 funciones, 11 triggers (3 de auditoría con la función redactora existente: el contenido de la imagen no se copia a `audit.cambios`), 10 políticas RLS, privilegios mínimos (sin DDL ni TRUNCATE; `DELETE` solo en `revision_responsables`, y su trigger exige BORRADOR).
- Sin dependencias fuera de `manufactura` salvo claves foráneas a `security.users` (igual que la 101).

### Validación realizada (instancia desechable, nunca TEST ni producción)
Precheck → UP → postcheck (todo `t`, huella de la 101 sin cambios) → smoke con el rol de la app (12/12, sin residuos de auditoría) → DOWN → DOWN idempotente → UP → postcheck. Más 6 pruebas de base (propiedad, autorización, congelamiento, retiro, auditoría) y 7 de servicio con Chrome real.

### SHA-256 de los scripts (archivos tal como están en el árbol de trabajo; verifique antes de aplicar)
```
1a583903369d755d1d09bf76bb6d3aac99bdfe6a043721f653deb656f58c5529  …102…test.up.sql
6007289544aba172861f2856aa53a25a3833ad1d93f5040796f1aa5745d530ae  …102…test.precheck.sql
a359b7b1e4b08d688354fb9bc099d77c180850e993a213c8956a5357016ec8db  …102…test.postcheck.sql
bb547951de97d2236eafdc1b2eb3066bc9919f55a44597110eb34c90a0cbdcf6  …102…test.smoke.sql
82434b163693084228d89a1eaa56d13162ffa7cc9f6ea81e4aa8606e09be63d9  …102…test.down.sql
```
(`Get-FileHash <archivo> -Algorithm SHA256`.) Si cambian los finales de línea al clonar, vuelva a calcular y registre el valor.

### Procedimiento para aplicarla en TEST (cuando se autorice)
Igual que la 101 (README de la carpeta): respaldo verificable de `manufactura` → precheck (anote `huella_101`) → UP → postcheck `-v huella_101=…` → smoke con `daubert_hub_test_user` → verificar desde la aplicación. Deshacer: `…down.sql` (idempotente; con datos exige `-v confirmar_borrado=SI_BORRAR_FIRMAS_Y_RESPONSABLES`).

## Cómo probar el módulo desde `localhost:5173`
**Sin aplicar la migración** (ya posible): preparar una hoja → «Responsables y firmas» muestra solo «Generó» con tu nombre sugerido; editarlo se guarda solo; **no hay casilla de confirmación**; «Finalizar y generar PDF» abre la confirmación que nombra a «Generó» y finaliza. Los responsables adicionales y las firmas muestran el aviso «se activarán cuando el entorno tenga habilitado el catálogo de firmas».

**Con la migración aplicada** (tras su autorización):
1. «Agregar segundo responsable» / «tercer responsable», elegir función y nombre.
2. «Elegir firma» → «+ Nueva firma» → elegir un JPG/PNG, ver la vista previa, «Guardar y usar esta firma». Probar un SVG (se rechaza) y un archivo > 2 MB.
3. Con una firma elegida el nombre se bloquea y pasa a ser el de su propietaria.
4. En «Autorizar uso…» de una firma propia, autorizar a otra cuenta; iniciar sesión con esa cuenta y comprobar que la ve (y que no ve la de nadie más).
5. Finalizar: el PDF REV01 muestra función, nombre e imagen de cada responsable; reabrir desde «Hojas de este código» no cambia nada; «Crear nueva revisión» recupera nombres sin imágenes.

## Dónde se gestionan las firmas
| Dónde | Quién | Qué |
|---|---|---|
| **Mi perfil → Mis firmas** (`/profile`, menú de cuenta) | cualquier usuario | firmas propias con miniatura, alta de una nueva (JPG/PNG), **«Quién puede usarla»** (lista, buscador por nombre, autorizar, revocar) y, aparte, las firmas que otras personas autorizaron |
| **Usuarios → detalle → Firmas** | ADMIN | descripción de las firmas registradas a nombre del usuario (propietario, cuenta activa/inactiva, fecha, quién la registró, estado), alta en su nombre y retiro. **Sin imágenes** y sin administrar su uso |
| **Usuarios → Firmas de personas sin cuenta** (`/users/signatures`) | ADMIN | las firmas bajo su custodia (modelo existente): localizarlas, ver y gestionar quién puede usarlas, registrar nuevas y retirarlas |
| **Hoja de manufactura → «Elegir firma»** | quien edita | solo consume el catálogo: «Sin firma», firmas propias y autorizadas, y «Nueva firma» (mismo alta que Mi perfil). Enlace a «Administrar mis firmas» |

Reglas: un ADMIN que registra una firma para otra persona con cuenta **no es propietario ni obtiene permiso de uso**, no puede autorizarse ni autorizar a terceros en nombre de ella y no ve su imagen; solo la propietaria concede y revoca (lo exige la base de datos). Las pantallas administrativas devuelven 403 a cuentas no ADMIN y las rutas están protegidas por `AdminRoute`.

### Limitación de la consulta administrativa (por la seguridad existente)
Las políticas RLS de la migración 102 NO dan a un ADMIN visibilidad general sobre `manufactura.firmas`. Por eso la consulta administrativa (`GET …/signatures-admin`) solo muestra las firmas que **esa cuenta** registró o incorporó (o cuyo uso tiene autorizado): no verá las que la propia persona subió, ni las que registró otro ADMIN. Para un inventario administrativo completo de metadatos haría falta una **migración 103** pequeña (una función `SECURITY DEFINER` solo para ADMIN que devuelva descripción y estados, nunca el contenido), que no se ha creado ni aplicado; no se ampliaron las políticas RLS.

## Autorización de uso de firmas (completa)
- **Quién autoriza:** solo la propietaria de la firma. En **Mi perfil → Mis firmas → «Quién puede usarla»**: lista de personas con permiso, buscador por nombre para agregar a otra y «Revocar» por persona. Nada se concede solo: quien sube una firma **no recibe** permiso de uso; si un ADMIN sube la firma de otra persona con cuenta, queda a nombre de ella, no se selecciona y se le explica que la propietaria debe autorizarlo.
- **API (`/api/manufacturing-sheets/documents/signatures/:id/…`):** `GET authorizations`, `POST authorize` y `POST revoke` (cuerpo `{ usuarioId }`), `POST retire`. Cada autorización y revocación queda en `audit.cambios` con la cuenta que la realizó.
- **Revocar:** impide asignar la firma a hojas nuevas y finalizar con ella (mensaje claro «una firma asignada ya no está disponible»); el borrador sigue intacto y los PDF y revisiones ya finalizados no cambian.
- **Persona sin cuenta:** por diseño de la migración 102, el ADMIN que la incorpora queda como custodio con permiso de uso (registrado). Cualquier otra persona requiere autorización explícita suya.

## Limitaciones conocidas
- La interfaz no incluye retirar una firma del catálogo (la API ya lo permite: `POST …/retire`).
- Las firmas se reducen a 600 × 240 px como máximo; una firma muy detallada puede perder finura.
- Solo los PDF finalizados imprimen las imágenes; el PDF de borrador mantiene «SIN FIRMA».
- Una firma asignada que ya no esté disponible (autorización revocada o firma retirada) impide finalizar hasta cambiarla o quitarla.
