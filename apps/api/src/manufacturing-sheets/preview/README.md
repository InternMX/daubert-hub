# Vista previa HTML de las hojas de manufactura (fase 3)

Muestra, junto al formulario editable, la plantilla HTML **real y aprobada** de la familia elegida con los datos capturados. Es un **borrador sin aprobar**: no guarda nada,
no admite firmas reales y no emite ninguna hoja.

## Endpoint
`POST /api/manufacturing-sheets/previews` — autenticado por los guards globales (no `@Public`; ADMIN y GENERAL), respuesta `200` (no crea nada).

```json
{ "familia": "BOLSA_PLANA_1", "datos": { "codigo": "SCHFPMG001", "descripcion": "…", "composicion": "PMG", "presentacion": "PAQUETE", "cantidad": "200", "cantidadUnidad": "BOLSAS",
  "ancho": "13", "largo": "16", "unidadDimensiones": "IN", "calibreValor": "3", "calibreUnidad": "MIL", "pesoLb": "0.0428", "colorHex": "#538DD5" } }
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
