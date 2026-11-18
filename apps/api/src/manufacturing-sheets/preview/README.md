# Vista previa HTML de las hojas de manufactura (fase 3)

Muestra, junto al formulario editable, la plantilla HTML **real y aprobada** de la familia elegida con los datos capturados. Es un **borrador sin aprobar**: no guarda nada,
no admite firmas reales y no emite ninguna hoja.

## Endpoint
`POST /api/manufacturing-sheets/previews` — autenticado por los guards globales (no `@Public`; ADMIN y GENERAL), respuesta `200` (no crea nada).

```json
{ "familia": "BOLSA_PLANA_1", "datos": { "codigo": "SCHFPMG001", "descripcion": "…", "composicion": "PMG", "presentacion": "PAQUETE", "cantidad": "200", "cantidadUnidad": "BOLSAS",
  "ancho": "13", "largo": "16", "unidadDimensiones": "IN", "pesoLb": "0.0428", "colorHex": "#538DD5" } }
```
Respuesta: `{ data: { html, familia, borrador: true, firmas: "SIN_FIRMA", completo, faltantes[], advertencias[] } }`.

- **Familias:** `BOLSA_PLANA_1` y `HOJA_PAQ` (esta última exige `modalidad`: `DOBLADA` o `EXTENDIDA`). Otras familias responden 400.
- **Validación (DTO):** solo campos conocidos con longitud acotada y enums cerrados; el `ValidationPipe` global rechaza cualquier otra propiedad (incluidos bloques de firma). Los formatos numéricos y de color **no** se rechazan: mientras
  el usuario escribe puede haber valores a medias y se informan como advertencias.

## Cómo se compone
1. `sheet-data.mapper.ts` traduce los campos del formulario a los placeholders de la plantilla (X/NA, `200 Bolsas`, `13"`, `0.0428`…). Lo ausente o no válido queda **vacío**: no se imprime NA ni X sin selección y no se inventan valores.
2. `sheet-preview.service.ts` obtiene la plantilla compuesta con **`componer()` de `tools/compose-template.mjs`** (el mismo compositor que usan las pruebas y el PDF), la guarda en caché por familia y sustituye los placeholders
   en **una sola pasada** con el texto **escapado** (un valor con `{{x}}` nunca se vuelve a interpretar). Las firmas son el marcador fijo `SIN FIRMA`. Sin color válido, `{{color_bolsa_hex}}` queda sin resolver y la plantilla muestra el
   dibujo en gris (no se inventa un color). Si una plantilla tuviera scripts o manejadores de eventos, la vista previa se niega a mostrarla.
3. Se añade una CSP al HTML (`default-src 'none'; style-src 'unsafe-inline'; img-src data:`) y el logo se incrusta como `data:` URI (en un iframe `srcdoc` la ruta relativa `images/` no existe; el PDF existente sigue imprimiendo con esa carpeta).
   Las plantillas, su CSS y sus geometrías **no se modifican**.

## ESM / CommonJS y build
El compositor es un módulo ESM (`.mjs`) y la API compila a CommonJS. TypeScript emite `import()` como `require()`: se pasa una **ruta** (no un `file://`) y Node ≥ 22.12 (la imagen usa Node 24) carga el módulo ESM síncrono con `require()`.
`nest build` solo compila TypeScript, así que `nest-cli.json` declara `assets` que copian `templates/`, `tools/` y `profiles/` a `dist/src/manufacturing-sheets/` (el servicio los busca junto a su propio código, en `src/` y en `dist/`).
Comprobado también contra el **build real** (`dist/`), no solo en Vitest.

## En el frontend (`apps/web/src/manufacturing`)
`SheetPreviewPanel` no reconstruye la hoja con componentes MUI: muestra el HTML en un `<iframe sandbox="" srcDoc>` (sin scripts, sin formularios, sin mismo origen, sin navegación) escalado con `transform` (817 × 1120 px: el ancho evita que las
plantillas apliquen su diseño móvil, que empieza en 816 px). Cada cambio del formulario se envía con **debounce de 400 ms**; la solicitud anterior se cancela y las respuestas fuera de orden se descartan. «Ampliar» abre la hoja completa
con las mismas proporciones. La marca de agua y las etiquetas **BORRADOR · SIN APROBAR** / **Firmas: SIN FIRMA** son superposiciones de la interfaz: no forman parte del HTML de las plantillas.
Los datos faltantes (`faltantes`) y las `advertencias` se muestran bajo el documento.

## No hace (todavía)
Persistir especificaciones o PostgreSQL, firmar o aprobar, emitir hojas definitivas, generar el PDF desde este flujo, ni las otras seis familias.

## Deuda técnica
- **Validaciones duplicadas parcialmente:** el formulario (`specificationForm.ts`) valida obligatorios para guiar al usuario y el backend (`sheet-data.mapper.ts`) vuelve a calcular `faltantes` para la vista previa. Las listas de campos obligatorios por familia deberían
  vivir en un solo contrato (p. ej. en el perfil de cada familia) que el frontend reciba del backend.
- El filtro global de excepciones oculta el detalle de los errores 5xx: el panel solo distingue «no disponible» y «datos no válidos».

## Fase 3.1 (contrato y sugerencias)
- **Calibre literal:** el contrato recibe un único `calibre` (texto, máx. 40) en lugar de `calibreValor`/`calibreUnidad`. Se imprime **exactamente** como lo confirmó el usuario (`200`, `250`, `300`, `2 MIL`, `2.7`, `3 MIL`): sin convertir, sin dividir ni multiplicar por 100 y sin agregar unidades. La plantilla imprime `{{calibre}}` sin sufijos; no fue necesario modificar ninguna plantilla.
- **Obligatorios en el borrador:** además de los existentes, `cliente` y `colorNombre` (`faltantes`). Que el cliente esté vinculado al catálogo lo valida el formulario (el backend de la vista previa no consulta PostgreSQL).
- **Color unificado:** el formulario mantiene un único estado de color que alimenta `colorNombre` (texto del documento) y `colorHex` (dibujo); la concentración del color es independiente de la Resina VCI.
- **Etiqueta:** hasta 500 caracteres (antes 200) para no truncar el `Title` completo de BIND; se imprime completo y la fila de la plantilla crece (no se recorta).
- «Hoja Paq» se muestra como **Hojas** en la interfaz; el identificador `HOJA_PAQ` no cambia.

## Prototipo integral · bloque A (registro de familias)
- **`family-registry.ts` es la única fuente de verdad de las familias**: campos visibles, obligatorios, composiciones, colores y modalidades (estas salen de `profiles/*.profile.json`). `GET /api/manufacturing-sheets/families` lo entrega al formulario; el frontend no replica reglas por familia. Una prueba (`families-sync.spec.ts`) mantiene sincronizada la copia que usan las pruebas del frontend (`UPDATE_FAMILY_FIXTURE=1` la regenera).
- Familias habilitadas: Bolsa Plana 1, Hojas (`HOJA_PAQ`), Bolsa Fuelle y Bolsa Natural. Las demás se incorporan en los bloques siguientes.
- **Niveles de validación:** `completo`/`faltantes` = datos técnicos de la familia (el cliente NO cuenta); `pendientesEmision` lista lo que exigirá una emisión futura (hoy, el cliente identificado). Una modalidad sin variante gráfica autorizada devuelve `bloqueado` y no genera documento.
- Fuelles: `fuelle_derecho` y `fuelle_izquierdo`; el color de las flechas internas sigue al color elegido (datos aprobados: blanco sobre azul, `#4A7EBB` sobre verde, negro en Bolsa Natural).
- Bolsa Natural: composición fija PMG = NA, ESD = NA, Natural = X; sin formulación VCI automática.

## Incidencias (modelo único de advertencias)

Todo problema técnico o dato pendiente se expresa con `Incidencia` (`incidencias.ts`; es el `TechnicalNotice` ampliado): `id` estable de la **causa** (`CODIGO` o `CODIGO:campo`, no el texto), `codigo`, `nivel` (`INFORMACION` · `PENDIENTE` · `CONTRADICCION` · `ERROR`), `campos`, `seccion`, `mensaje`, `resumen` breve, `origen`, `afectaVistaPrevia` y `reconocible`.

- La respuesta de `POST /previews` trae **una** lista `incidencias` (sin ids repetidos): datos faltantes (`FALTANTE:campo`), valores no válidos (`VALOR_INVALIDO:campo`), coherencia técnica, modalidad no autorizada y cliente vacío (informativo). `faltantes`, `advertencias` y `pendientesEmision` son proyecciones de esa lista, solo por compatibilidad.
- Las advertencias de los parsers de Title y Code se clasifican en `bind-product-interpreter/advertencias-catalogo.ts` (severidad, id, campos del formulario, sección); una tabla decide qué solo *explica* un dato faltante y qué es redundante (producto de papel ⊂ material de papel sin plantilla).
- Misma causa → mismo id en todas las fuentes (p. ej. `TITLE_CODE:composicion` en el intérprete y en la coherencia), de modo que el frontend la cuenta una vez. El backend es la autoridad; React solo consolida, ubica y resume.
- Solo las contradicciones (y avisos de revisión explícitos como `TEXTO_EXTENSO`) son `reconocible`; un error o un dato faltante nunca se reconoce. El reconocimiento lo guarda el navegador con una huella de los datos que originaron la incidencia y caduca si cambian.
