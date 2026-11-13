# PDF de borrador · Hojas de Manufactura (Fase 3)

Recorrido cerrado del prototipo: **BIND → Novedades → Preparar hoja → Validar → Descargar PDF de borrador.** El PDF es un borrador de demostración: no es una hoja emitida, no lleva firmas, folios ni aprobación, y no se guarda en ningún lugar.

Este documento sustituye la evaluación previa (`manufacturing-draft-pdf-proposal.md`, bloque D), que quedó diferida por la infraestructura.

## 1. Auditoría técnica (hechos comprobados en el código)

| Elemento | Estado |
|---|---|
| Vista previa | `POST /api/manufacturing-sheets/previews` → `SheetPreviewService.preview`: compone la plantilla aprobada con `tools/compose-template.mjs`, sustituye datos con escape, incrusta el logotipo y el PNG del rollo como `data:` y añade una CSP `default-src 'none'`. El HTML no contiene JavaScript ni recursos remotos (la composición se niega a continuar si la plantilla trae contenido activo). |
| Navegador | El HTML se muestra en un `<iframe sandbox="">` (sin scripts, sin mismo origen, sin navegación). Desde la página no se puede invocar `print()` sobre ese documento, y la marca «BORRADOR · SIN APROBAR» actual es una superposición de React que no forma parte del HTML. |
| Impresión | Las plantillas ya declaran `@page { size: letter portrait; margin: 0 }` y `@media print` (colores forzados, sin márgenes). Las regresiones imprimen con Chrome `--headless --disable-gpu --no-pdf-header-footer`. |
| Fuentes e imágenes | Calibri (con Carlito/Segoe UI/Arial como alternativas) y dos imágenes fijas incrustadas (logotipo; PNG del rollo doblado solo en Termoencogible). Rollo Continuo dibuja su rollo en SVG. |
| Infraestructura | La API de producción es `node:24-alpine`, usuario `node`, sin navegador, sin Python ni fuentes de Office. Las herramientas de PDF existentes (`hoja_pruebas.py`, PyMuPDF, Chrome) son de pruebas y no se copian a la imagen. Las hojas de manufactura **no están desplegadas** en producción. |

## 2. Alternativas evaluadas

| # | Alternativa | Veredicto |
|---|---|---|
| A | **Imprimir desde el navegador («Guardar como PDF»)**: exige poder imprimir el iframe aislado (habría que añadir `allow-same-origin`/`allow-scripts`, debilitando el aislamiento) o imprimir la página completa (incluye la interfaz y la maqueta móvil de 817 px); la marca de borrador seguiría siendo una superposición; el nombre del archivo y los márgenes los decide el usuario; no se puede comprobar de forma automática. | Rechazada: el usuario pidió no debilitar las protecciones y que el PDF lleve la marca dentro del documento. |
| B | Capturar la pantalla (html2canvas/jsPDF) | Prohibida expresamente (raster, sin texto, sin fidelidad). |
| C | Dibujar el PDF con una biblioteca de Node (pdfkit, pdf-lib…) | Rechazada: sería una **segunda implementación** de las ocho plantillas y de sus geometrías. |
| D | **Chromium dentro de la imagen de producción** (Alpine) | No se implementa sin revisión: ~+300–500 MB de imagen, Calibri no existe en Alpine (habría que sustituir por Carlito, métricamente compatible pero con otra forma de letra), el sandbox de Chromium en contenedores exige capacidades o `--no-sandbox`, y cada impresión consume cientos de MB. Es un cambio de infraestructura productiva. |
| **E** | **Renderizado en el servidor (NestJS) con el Chrome local, opcional y aislado** | **Elegida.** |

## 3. Arquitectura elegida

```
Formulario ──POST (mismo DTO que la vista previa)──► SheetPdfService
                                                       │ SheetPreviewService.preview(…, { capaBorrador: true })   ← MISMA composición, datos, escape y validaciones
                                                       │ (422 si la vista previa no mostraría el documento)
                                                       ▼
                                               SheetPdfRenderer ── Chrome local (proceso hijo aislado) ──► PDF
```

- **Una sola fuente documental.** El PDF sale de `SheetPreviewService.preview`, el mismo método de la vista previa. El único añadido es la capa de borrador (`preview/draft-layer.ts`), integrada en la composición y exclusiva del modo PDF. No se tocó ninguna plantilla, perfil ni geometría, y el frontend no replica ninguna regla.
- **Identificación dentro del documento.** Franja superior «BORRADOR · SIN APROBAR» (o «BORRADOR INCOMPLETO · FALTAN DATOS · SIN APROBAR») y pie «Documento de demostración: no es una hoja emitida · Firmas: SIN FIRMA»; los dos bloques de firma conservan «SIN FIRMA». La capa es `position: fixed` en los márgenes de la página Carta (y < 26 pt y y > 768 pt): queda fuera del flujo, no solapa medidas, dibujos ni tablas, y se repite si hubiera más de una página. Texto fijo, sin datos del usuario.
- **Reglas de descarga (frontend, solo presentación):** el botón «Descargar PDF de borrador» está junto a la vista previa y se habilita cuando hay una respuesta vigente de la revisión de los datos actuales, el documento no está bloqueado y no hay contradicciones sin reconocer (mecanismo actual de reconocimiento). Con datos incompletos se permite exportar para revisión, pero se anuncia y el PDF sale marcado INCOMPLETO. Cualquier cambio en los datos cancela la generación en curso: nunca se entrega un PDF de una versión anterior. Una sola generación a la vez (sin descargas duplicadas); fallo real con mensaje y «Reintentar» sin perder el formulario.
- **Endpoint:** `POST /api/manufacturing-sheets/previews/pdf` (autenticación y CSRF de origen globales; no es `@Public`). Acepta solo el DTO de la vista previa (propiedades desconocidas → 400): nunca HTML, rutas ni URLs. Responde `application/pdf`, `Content-Disposition: attachment; filename="<CODIGO_DCMX>.pdf"` (el código tal cual, solo si es un código válido: letras, dígitos, punto, guion y guion bajo, máx. 64; si falta o no es válido, `HOJA_SIN_CODIGO.pdf`; los nombres reservados de Windows llevan un guion bajo inicial) y el **título del PDF** (`/Title`, tomado del `<title>` del HTML solo en modo PDF; no es parte visible ni toca el encabezado del machote) es ese mismo código, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Errores: 422 (documento no mostrable, con su motivo), 429 (ocupado), 501 (sin renderizador en el entorno), 504 (tiempo), 500 (fallo). No se guarda nada.
- **Renderizador (`preview/sheet-pdf.renderer.ts`):** proceso hijo sin shell y con argumentos fijos; mismos parámetros de impresión que las regresiones (`--headless --disable-gpu --no-pdf-header-footer`) más `--no-first-run --disable-extensions --disable-background-networking --host-resolver-rules="MAP * ~NOTFOUND"` (sin resolución de nombres), perfil y archivos en un directorio temporal propio que **siempre** se borra; HTML con CSP `default-src 'none'`. Límites: entrada 2 MB, PDF 10 MB, 25 s de tiempo (se termina todo el árbol de procesos), 2 impresiones simultáneas y 4 en cola (después, 429). Los registros solo contienen la familia y la duración, nunca textos ni datos de la hoja.
- **Chrome es opcional.** Se toma de `MANUFACTURING_PDF_CHROME_PATH` o, **solo fuera de producción**, de las rutas habituales. En producción nada se adivina: sin la variable el servicio responde 501 y la interfaz lo explica; la imagen Docker no cambió. La demostración local usa el Chrome ya instalado, sin instalar nada.

## 4. Verificación sobre el PDF real

`npm run test:sheets-pdf-borrador` (desde `apps/api`, tras `npm run build`) genera con el servicio compilado y el renderizador real los PDF de los casos simulados y comprueba **250 puntos** sobre el PDF (PyMuPDF), entre ellos: Carta 612 × 792 pt y una página en las 10 hojas simuladas y el caso de textos largos; marca BORRADOR / SIN APROBAR dentro del documento (e INCOMPLETO cuando faltan datos) y «SIN FIRMA» en las firmas y el pie; descripción y etiqueta íntegras, calibre literal, código, medidas, pesos y VCI de COEX con su precisión (5 y 6 decimales); color NATURAL (#FFF2CC) en Bolsa Natural; COEX Azul y Verde con sus colores aprobados; logotipo e imagen del rollo de Termoencogible; ningún texto fuera de la página; la capa no se solapa con ningún texto, dibujo, tabla ni imagen; y **equivalencia con la vista previa**: la misma composición impresa sin la capa tiene las mismas palabras en las mismas posiciones (tolerancia 0.15 pt), los mismos dibujos y colores y **0 píxeles distintos** fuera de los márgenes de la capa.

Pruebas unitarias y HTTP (`test/sheet-pdf.spec.ts`, 24 pruebas, incluida una con el Chrome real): capa de borrador, una sola composición, nombre de archivo, resolución de Chrome, renderizador con un Chrome simulado (parámetros, salida inválida, tiempo, concurrencia/cola, limpieza de temporales), servicio (422/501/429/504/500, sin contenido en logs) y endpoint (cabeceras, DTO estricto, no público).

## 5. Riesgos y limitaciones
- **Despliegue:** el PDF funciona donde hay un Chrome (la demostración local). Para un entorno desplegado hay que decidir con revisión: sidecar con Chromium y fuentes en una red restringida, o Chromium en la imagen con sus costos. Hasta entonces el botón responde «no disponible en este entorno».
- **Fuentes:** el PDF usa las fuentes del equipo que imprime. Con Calibri la fidelidad es la de las regresiones; con Carlito/Arial (sin Calibri) las medidas son compatibles pero la forma de la letra cambia.
- **Versión de Chrome:** la regresión histórica CONFPMG04 sigue fallando por metadatos de fuentes de Chrome 156 (ver `manufacturing-stabilization.md`); no se tocó su referencia ni su tolerancia. El PDF de borrador se compara contra la vista previa impresa con el **mismo** Chrome, por lo que esa diferencia no interviene.
- Sin límite de solicitudes por usuario: lo acotan la concurrencia, la cola y el tiempo máximo.
- El PDF no es una emisión: no hay folio, historial, firmas, aprobación ni almacenamiento (diferidos).

## 6. Ajuste posterior: nombre y título del PDF = código DCMX
El archivo se llama `<CODIGO_DCMX>.pdf` (p. ej. `SCHFPMG001.pdf`) y su título de metadatos es el mismo código. El código es el `Code` de BIND de la especificación actual (o el código DCMX válido que el usuario esté usando); nunca se sustituye por la descripción ni la familia. El estado «incompleto» ya no va en el nombre: se indica dentro del documento y en el mensaje de la interfaz. La verificación sobre PDF real (`test:sheets-pdf-borrador`) comprueba el nombre y el metadato `/Title` en todos los casos.
