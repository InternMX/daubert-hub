# Guía de demostración · Gestor de Hojas de Manufactura (ambiente de pruebas)

Duración: 30–40 minutos. Ambiente: **TEST** (`daubert_hub_test`, emisión `PRUEBA`). **No** se conecta ni se modifica producción. **Atención:** el PDF finalizado **no lleva ninguna leyenda de prueba** (decisión de diseño: la plantilla se respeta tal cual y TEST se identifica solo en la interfaz). Un PDF de TEST impreso no se distingue de uno válido: usar códigos `DEMO…`, poner «(DEMOSTRACIÓN)» en la descripción y no repartir impresiones.

## 0. Qué debe prepararse antes de la sesión (hoy NO está listo)
Estado comprobado el 2026-11-10 (solo lectura): los contenedores `daubert-hub-test-web-1` y `daubert-hub-test-api-1` están **detenidos desde hace cinco semanas**, es decir, TEST no está en marcha y sus imágenes son anteriores a la versión candidata. Antes de la sesión, alguien autorizado debe:

| # | Preparación | Quién | Nota |
|---|---|---|---|
| P1 | Autorizar la actualización de TEST con la versión candidata | Responsable del Hub | Es un despliegue en TEST; no se hizo en esta fase |
| P2 | Respaldar `daubert_hub_test` y verificar que tiene las migraciones de TEST 101–105 | Operación | Solo lectura para verificar; aplicar lo que falte según sus README |
| P3 | Construir y levantar TEST con `deploy/pilot.test.env` **más** `VITE_MANUFACTURING_UI=true` y `VITE_MANUFACTURING_DOCUMENTS=true` (ver `deploy/pilot.test.manufacturing.env`) | Operación | Sin esas dos variables la interfaz de Manufactura queda oculta |
| P4 | Cuentas de demostración: una **ADMIN** y dos **GENERAL** (para mostrar borradores del equipo), con contraseña ya cambiada | Administrador del Hub | No usar cuentas personales de producción |
| P5 | Firmas de ejemplo (PNG de menos de 2 MB) para Generó y Revisó; una persona «Aprobó» sin firma cargada | Manufactura | La firma se autoriza por usuario |
| P6 | Clientes en el catálogo de TEST (existen AUDI y CATERPILLAR) y dos o tres abreviaturas confirmadas (p. ej. `AUD` → AUDI) | ADMIN | Ver sección 9 |
| P7 | BIND en TEST: credenciales cargadas por quien las custodia **o** decisión de mostrar esa parte con captura manual | Sistemas | Sin credenciales la consulta responde «BIND no está configurado» y el resto funciona |
| P8 | Lista de 3–5 códigos DCMX reales que Manufactura quiera ver (uno por formato de interés) | Manufactura | Sugeridos: `SCHFPMG001` (Bolsa Plana 1), `DANFPMGOC04` (Bolsa Fuelle), uno COEX (p. ej. `CONFPMG04`) |
| P9 | Impresora del área disponible para imprimir un PDF en Carta | Manufactura | Para comprobar márgenes reales |
Alternativa si TEST no puede actualizarse a tiempo: una réplica desechable como la de los ensayos (aislada, con datos sintéticos). Requiere la misma autorización de P1.

## 1. Consulta del producto mediante BIND (3 min)
1. Entrar con la cuenta **GENERAL**. Menú **Hojas de manufactura**.
2. Escribir el código DCMX (`SCHFPMG001`). Mostrar: código, título original de BIND en solo lectura, peso y fecha de alta.
3. Abrir **Novedades del catálogo**: últimos productos dados de alta en BIND.
4. Escribir un código que no existe: mensaje «No se encontró el producto en BIND»; se puede seguir con captura manual.
*Qué observar:* el Hub solo **lee** de BIND; nada se escribe allá.

## 2. Prellenado inteligente (4 min)
1. Con el producto encontrado, mostrar la familia de formato sugerida y los campos ya llenos.
2. Señalar las tres clases de dato: **listo** (tomado tal cual), **sugerido por revisar** (interpretado; requiere confirmación) y **pendiente** (no está en BIND).
3. Ejemplo con información contradictoria o ambigua (dos sistemas de medida, o título y descripción que no coinciden): el sistema **no elige**; pide el dato.

## 3. Interpretación y confirmación de datos técnicos (4 min)
1. Revisar medidas, unidad, calibre (se conserva literal, sin convertir), presentación, cantidad y peso.
2. Confirmar un dato sugerido y corregir otro. Mostrar las advertencias cuando falta un dato obligatorio.
3. En una bolsa con fuelle: la tercera medida se reparte en fuelle derecho e izquierdo como **sugerencia**.
4. En COEX: peso por capa calculado a partir del peso total.

## 4. Creación y autoguardado de borradores (3 min)
1. Crear el borrador. Cambiar un campo y esperar el indicador de guardado.
2. Cerrar la pestaña y volver a entrar: el borrador conserva los cambios.
3. Intentar crear otro documento con el mismo código y variante: el sistema avisa que ya existe.

## 5. Consulta de borradores del equipo (2 min)
1. Entrar con la **segunda cuenta GENERAL**. En «Abiertos» aparece el borrador de la primera cuenta.
2. Abrirlo: se puede **consultar**, no modificar.

## 6. Roles GENERAL y ADMIN (3 min)
| Acción | GENERAL | ADMIN |
|---|---|---|
| Elaborar, guardar y finalizar hojas propias | Sí | Sí |
| Consultar borradores de otros | Solo lectura | Sí |
| Proponer una abreviatura de cliente | Sí (queda por confirmar) | Sí (queda confirmada) |
| Dar de alta o editar clientes | No | Sí |
| Confirmar/rechazar abreviaturas, administrar firmas de otros | No | Sí |
Mostrar un intento de GENERAL sobre una acción de ADMIN (mensaje de permiso).

## 7. Responsables y firmas (5 min)
1. En **Mis firmas**: cargar una imagen de firma (menos de 2 MB). Mostrar que un archivo mayor se rechaza.
2. Autorizar el uso de la firma. Como ADMIN: inventario de firmas y retiro/revocación.
3. En la hoja: asignar **Generó**, **Revisó** y **Aprobó**. Uno de ellos sin imagen de firma: el PDF deja el espacio en blanco con el nombre impreso.
4. Asignar revisor y registrar la revisión.

## 8. Finalización y descarga de PDF (4 min)
1. Finalizar: el sistema valida que no falte nada.
2. Descargar el PDF; mostrar el nombre del archivo con la revisión (`…_REV01.pdf`).
3. Intentar editar la hoja finalizada: no se permite.
4. **Imprimir** el PDF en la impresora del área y revisar márgenes (ver `03-revision-ocho-formatos.md`).

## 9. Historial y nuevas revisiones (3 min)
1. Desde la hoja finalizada: **Nueva revisión**. Cambiar un dato y finalizar → `REV02`.
2. Mostrar el historial: ambas revisiones, quién y cuándo; el PDF de la REV01 sigue disponible.
3. Descartar un borrador de revisión.
4. **Actividad reciente** del Hub: aparecen las hojas emitidas.

## 10. Administración de clientes y abreviaturas (4 min)
1. Como **GENERAL**: en una hoja, elegir cliente con el buscador y **proponer** una asociación para el prefijo del código.
2. Como **ADMIN**: Configuración → *Identificación de clientes* → confirmar o rechazar (con motivo) la propuesta.
3. Volver a escribir un código con ese prefijo: aparece «Cliente sugerido por el código».
4. Prefijo compartido por dos clientes: se muestran las dos alternativas; no se elige sola.
5. Ficha del cliente → *Abreviaturas de código DCMX*.
6. Cliente que no está en el catálogo: captura manual (queda marcado como no verificado).

## Cierre (2 min)
Recoger observaciones en la **lista de aceptación** (`03-revision-ocho-formatos.md`, sección final) y en las fichas de cada formato.
