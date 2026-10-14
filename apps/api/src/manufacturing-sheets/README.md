# manufacturing-sheets

Plantillas HTML de las Hojas de Instrucción de Manufactura de Daubert México (HTML → PDF).
Estado: **COEX** (validado contra CONFPMG04) y **BOLSA_FUELLE etapa BF-2** (hoja completa; sin línea base validada).
**HOJA_PAQ etapa HP-2** (hoja completa, modalidades DOBLADA y EXTENDIDA; sin línea base validada).

**Criterio:** el objetivo es estandarizar visualmente todas las hojas (mismo encabezado, tipografía, colores corporativos, datos
generales, Medidas, pesos, etiqueta y firmas), conservando las características y la información técnica de cada formato. No se
reproduce el Excel celda por celda.

## Estructura

```
profiles/                # identifican el formato de forma explícita (nunca por el color) y listan sus placeholders
  coex.profile.json  bolsa-fuelle.profile.json  hoja-paq.profile.json
templates/
  components/            # piezas reutilizables (HTML y CSS)
    base-sheet/              estilos base corporativos de las hojas nuevas (tokens, tablas, alturas) + reglas de impresión
    general-info-vci/        datos generales con Resina VCI, Composición, Presentación y Cantidad
    measures-gussets/        Medidas con ambos fuelles (Unidad, Ancho/Fuelle Derecho, Largo/Fuelle Izquierdo, Calibre)
    weight-row/              fila de peso en libras ({{peso_bolsa_lb}}); el rótulo llega por el parámetro rotulo
    sheet-type-row/          Hoja: Doblada / Extendida (HOJA_PAQ)
    measures-simple/         Medidas sin fuelles: Unidad, Ancho, Largo, Calibre (HOJA_PAQ)
    drawing-title/           franja azul claro de dibujo (parámetros id y titulo)
    sheet-drawing/           Dibujo Hoja: rectángulo con cotas ancho y largo (HOJA_PAQ)
    roll-drawing/            Dibujo de rollo; geometry/extendido.html y geometry/doblado.html, cota ancho_rollo (HOJA_PAQ)
    header/
      header.html            logotipo + título (placeholder {{sufijo_titulo}})
      header.css             estilos propios del encabezado
      header.mobile.css      reglas del encabezado para @media screen (≤ 816 px)
    signatures/
      signatures.html        zona de firmas: bloques de elaboración y aprobación
      signatures.css         posiciones y tamaños de los bloques (COEX)
      signatures.bolsa-fuelle.css  variante de posiciones de BOLSA_FUELLE (se incluye después de signatures.css)
    label-section/
      label-section.html         encabezado «Dibujo Bolsa» (franja azul claro B:K) + fila Etiqueta, en una sola tabla
      label-section.css          estilos de la franja y de la fila Etiqueta
      label-section.heights.css  altura de la fila del encabezado (va dentro del bloque de alturas de la plantilla)
      label-section.bi.html/.css variante B:I (BOLSA_FUELLE): franja y Etiqueta del mismo ancho que las tablas de datos
    note-seal-height/        nota de manufactura de BOLSA_FUELLE (texto fijo)
    gusset-bag-drawing/
      gusset-bag-drawing.html  contenedor del dibujo técnico de bolsa con fuelles (incluye la geometría elegida)
      gusset-bag-drawing.css   estilos comunes del dibujo
      geometry/coex.html       SVG con la geometría de COEX (viewBox, marcadores, bolsa, cotas, barra)
      geometry/coex.css        dimensiones del contenedor para esa geometría
      geometry/bolsa-fuelle.html / .css   geometría propia de BOLSA_FUELLE
  coex/
    coex.template.html   # plantilla fuente con marcadores @include
    images/              # DC_logo.jpg y COEX_Curvas_Trazado_Original.svg (fuente de las curvas)
  bolsa-fuelle/
    bolsa-fuelle.template.html   # BF-1: encabezado, datos generales, Medidas y Peso lb
    images/DC_logo.jpg
tools/
  compose-template.mjs   # compositor (Node, sin dependencias)
```

## Composición

```
node tools/compose-template.mjs --source templates/coex/coex.template.html --out <salida.html>
```

Cada línea `<!-- @include ruta -->` (HTML) o `/* @include ruta */` (dentro de `<style>`) se sustituye por el contenido exacto del
archivo, con ruta relativa a `templates/`. No transforma, minifica ni reordena. La salida no contiene JavaScript.

- **Parámetros:** `<!-- @include ruta nombre=valor otro=valor -->`. En el archivo incluido, cada `@{nombre}` se sustituye por el
  valor (error si falta). No hay herencia: cada inclusión recibe solo los parámetros que se le pasan.
- **Inclusiones anidadas** (máximo 4 niveles). La ruta del archivo anidado puede usar `@{nombre}`; así una plantilla elige,
  por ejemplo, la geometría de un dibujo.
- **Ids únicos:** al final se comprueba que no haya atributos `id` duplicados en el HTML compuesto (fuera de comentarios). Un
  documento con dos dibujos debe darles ids distintos mediante los parámetros.
- Falla si falta un archivo, si no termina en salto de línea, si usa CRLF o si sale de `templates/`.

El HTML compuesto de COEX es **byte a byte idéntico** a la plantilla validada (huella en
`test/manufacturing-sheets/regression/coex-confpmg04/fuente/SHA256SUMS.txt`).

## Componente `header`

- **Datos:** `{{sufijo_titulo}}` (`""` o `" - COEXTRUSIÓN"`). El mismo placeholder aparece además en `<title>` y en el
  `aria-label` de la tabla general; esos dos usos **no** pertenecen al componente y siguen en la plantilla.
- **Dependencias que el componente no define:**
  - `:root`: `--fs-titulo` y `--fuente`.
  - La regla compartida `.encabezado, .tabla-contenedor { width / max-width / margin }`, que se queda en la plantilla porque
    también aplica a las tablas.
  - `.hoja` (padding superior de 0.55 in): el encabezado mide 82.9 pt y deja la información general en y ≈ 122.5 pt.
  - El logotipo se carga como `.\images\DC_logo.jpg`, relativo al HTML.
- Geometría validada: logotipo 183.82 × 42.57 pt (x 23.35, y 68.07); título en x 226–403 pt.

## Componente `signatures`

- **Datos:** `{{bloque_firma_elaboro}}` y `{{bloque_firma_aprobo}}`. El backend los sustituye por un `<img>` de una firma
  autorizada o, en pruebas, por `<span class="sin-firma">SIN FIRMA</span>`. La plantilla no imprime nombre, función ni área:
  esa información ya forma parte de la imagen. No decide quién puede aprobar ni valida la firma.
- **Geometría validada (pt, desde el borde de la página):** elaboración x 76.3, y 655.7, 97.5 × 71.5; aprobación x 298.3,
  y 655.6, 108.8 × 69.5. Las imágenes se ajustan con `object-fit: contain`, sin recortar ni deformar, y no aumentan la altura.
- **Dependencias que el componente no define:** `--ancho-hoja` y `--fs-base` (`:root`). Su origen vertical (y = 642.8 pt)
  es el final del dibujo técnico: la zona mide 84.4 pt y debe ir inmediatamente después de él. Los desplazamientos
  (`left`/`top`) son relativos a esa zona y a la columna izquierda de la hoja (x = 18.5 pt).

## Componente `label-section`

Encabezado «Dibujo Bolsa» y fila Etiqueta, **una sola tabla** (cuadrícula B:K compartida con la tabla general; no se separan
porque comparten columnas y comportamiento de bordes).

- **Datos:** `{{etiqueta}}`.
- **Geometría validada:** franja azul claro `#366092` de B a K en una sola celda (13.6 pt de alto; paddings de 15.350 % y 18.846 %
  mantienen «Dibujo Bolsa» centrado en C:I); fila Etiqueta B:I rosa `#DA9694`, 27.3 pt, sin borde.
- **`label-section.heights.css`:** la regla de altura de la franja se mantiene en un archivo aparte porque debe quedar dentro del
  bloque de alturas de la plantilla; así el HTML compuesto conserva el orden de la cascada (idéntico byte a byte).
- **Dependencias que el componente no define:**
  - `:root`: `--rosa` y `--fs-etiqueta`.
  - Clases compartidas: `.seccion-titulo` y `.titulo-claro` (también usadas por Medidas y capas), `.t-general` y las columnas `k-*`
    (cuadrícula B:K), y `.seccion-pegada` (margen de −1 px).
  - La regla de impresión que fuerza colores (`print-color-adjust`) incluye `.etiqueta-seccion`.
  - Los paddings de `.titulo-dibujo` copian los anchos de las columnas B y J:K: si cambia la cuadrícula hay que sincronizarlos.

## BOLSA_FUELLE (etapa BF-2: hoja completa)

Perfil: `profiles/bolsa-fuelle.profile.json` (`"formato": "BOLSA_FUELLE"`). Compone con el mismo compositor, sin dependencias nuevas.

Orden de la hoja: encabezado, datos generales con **Resina VCI**, Medidas con ambos fuelles, **Peso lb**, Dibujo Bolsa y Etiqueta,
dibujo técnico con fuelles, nota de manufactura y firmas. Una sola página carta.

- **Campos:** los comunes de COEX con el mismo significado (`cliente`, `fecha_`, `producto`, `color`, `codigo`, `descripcion`,
  `comp_*`, `pres_*`, `cantidad`, `unidad_medidas`, `ancho`, `largo`, `fuelle_*`, `calibre`, `peso_bolsa_lb`, `etiqueta`,
  `color_bolsa_hex`, `color_cotas_internas_hex`, `bloque_firma_*`) y uno nuevo: `resina_vci`. 26 placeholders en total.
- **Componentes compartidos con COEX** (sin modificar los de COEX): `header`; `label-section` mediante la variante
  `label-section.bi.html` (franja y Etiqueta de ancho B:I); `gusset-bag-drawing` con la geometría `geometry/bolsa-fuelle`;
  `signatures` con la variante de posiciones `signatures.bolsa-fuelle.css`.
- **Componentes propios:** `base-sheet`, `general-info-vci`, `measures-gussets`, `weight-row` y `note-seal-height`
  (nota amarilla de texto fijo: «Notas: Considerar la altura total de la bolsa a partir del sello»; no existe en COEX).
- **Geometría del dibujo:** SVG `viewBox 0 0 400.4 189.8` (contenedor de 400.4 × 189.8 pt). Esquemática, sin escala: bolsa
  con fuelles simétricos, dos líneas punteadas, cota de ancho (arriba), de largo (izquierda), dos cotas internas de fuelle y barra
  azul oscuro inferior. Los valores de las cotas son placeholders; el relleno viene de `{{color_bolsa_hex}}` y las flechas
  internas de `{{color_cotas_internas_hex}}`. Los textos de fuelle llevan una pastilla blanca para leerse con cualquier color.
- **Firmas:** dos bloques de 105 × 70 pt centrados bajo cada mitad del ancho B:I. El HTML solo recibe `{{bloque_firma_*}}`; las
  imágenes autorizadas las entrega el backend y la plantilla no decide quién puede aprobar.
- **Apariencia:** mismos tokens, tipografía, alturas de fila, colores corporativos y cuadrícula B:I que COEX. `base-sheet/` repite
  los estilos base de COEX; COEX no se tocó (deuda: unificar con una regresión explícita).
- **Diferencia estructural con el Excel:** Resina VCI va en una fila propia bajo Cliente/Fecha.
- **Verificación:** `npm run test:sheets-bolsa-fuelle` (5 casos, sin línea base). Ver `test/manufacturing-sheets/bolsa-fuelle/README.md`.

## Componente `label-section`

Encabezado «Dibujo Bolsa» y fila Etiqueta, **una sola tabla** (cuadrícula B:K compartida con la tabla general; no se separan
porque comparten columnas y comportamiento de bordes).

- **Datos:** `{{etiqueta}}`.
- **Geometría validada:** franja azul claro `#366092` de B a K en una sola celda (13.6 pt de alto; paddings de 15.350 % y 18.846 %
  mantienen «Dibujo Bolsa» centrado en C:I); fila Etiqueta B:I rosa `#DA9694`, 27.3 pt, sin borde.
- **`label-section.heights.css`:** la regla de altura de la franja se mantiene en un archivo aparte porque debe quedar dentro del
  bloque de alturas de la plantilla; así el HTML compuesto conserva el orden de la cascada (idéntico byte a byte).
- **Dependencias que el componente no define:**
  - `:root`: `--rosa` y `--fs-etiqueta`.
  - Clases compartidas: `.seccion-titulo` y `.titulo-claro` (también usadas por Medidas y capas), `.t-general` y las columnas `k-*`
    (cuadrícula B:K), y `.seccion-pegada` (margen de −1 px).
  - La regla de impresión que fuerza colores (`print-color-adjust`) incluye `.etiqueta-seccion`.
  - Los paddings de `.titulo-dibujo` copian los anchos de las columnas B y J:K: si cambia la cuadrícula hay que sincronizarlos.

## BOLSA_FUELLE (etapa BF-1)

Perfil: `profiles/bolsa-fuelle.profile.json` (`"formato": "BOLSA_FUELLE"`). Compone con el mismo compositor, sin dependencias nuevas.

- **Incluye:** encabezado (componente `header`, el mismo de COEX; `sufijo_titulo` va vacío), datos generales con **Resina VCI**
  (`{{resina_vci}}`, campo nuevo), Composición, Presentación, Cantidad, Medidas con ambos fuelles y **Peso lb**
  (`{{peso_bolsa_lb}}`, el mismo dato que «PESO BOLSA LB» de COEX).
- **No incluye (BF-2):** Dibujo Bolsa y Etiqueta, dibujo técnico con fuelles, nota de manufactura y firmas.
- **Apariencia:** mismos tokens, tipografía, alturas de fila, colores corporativos y cuadrícula B:I que COEX, para que ambas
  hojas se vean como un mismo sistema. `base-sheet/` repite los estilos base de COEX; COEX no se tocó (deuda: unificar con
  una prueba de regresión explícita).
- **Diferencia estructural:** Resina VCI va en una fila propia bajo Cliente/Fecha (en el Excel está junto a la fecha).
- **Verificación:** `npm run test:sheets-bolsa-fuelle` (sin línea base; comprueba placeholders, campos, una página carta,
  ausencia de superposiciones y colores impresos). Ver `test/manufacturing-sheets/bolsa-fuelle/README.md`.

## Componente `gusset-bag-drawing`

Dibujo técnico de bolsa con fuelles (debajo de Etiqueta).

```
<!-- @include components/gusset-bag-drawing/gusset-bag-drawing.html id=flecha-bolsa seccion=seccion-dibujo-bolsa geometria=coex -->
/* @include components/gusset-bag-drawing/gusset-bag-drawing.css geometria=coex */
```

- **Parámetros:** `geometria` (archivo en `geometry/`), `id` (prefijo de los marcadores de flecha: `@{id}` y `@{id}-interna`) y
  `seccion` (id del contenedor). Con `id=flecha-bolsa` y `seccion=seccion-dibujo-bolsa` el HTML compuesto es idéntico al validado.
- **Datos:** `{{ancho}}`, `{{largo}}`, `{{fuelle_izquierdo}}`, `{{fuelle_derecho}}`, `{{color_bolsa_hex}}` (relleno de la bolsa) y
  `{{color_cotas_internas_hex}}` (flechas interiores de los fuelles). `{{color}}` es solo el nombre del color.
- **Geometría `coex` (verificada con el PDF original):** `viewBox="0 0 400.4 189.8"`, contenedor de 400.4 × 189.8 pt
  (y 453.0 a 642.8 pt). Otra geometría (p. ej. Bolsa Fuelle) se agrega como `geometry/<nombre>.html` y `.css` sin tocar el
  marco ni la geometría de COEX; no se impone ninguna medida de COEX a otros formatos.
- **Dependencias que el componente no define:** `--fuente` (`:root`); debe ir inmediatamente después de la fila Etiqueta
  (su borde inferior no suma altura) y antes de las firmas, cuyo origen vertical es su final.

## Scripts npm (workspace `@daubert/api`)

Se ejecutan desde `apps/api` (`npm run <script>`) o desde la raíz del monorepo (`npm run <script> -w @daubert/api`).

| Script | Qué hace |
|---|---|
| `sheets:compose` | Compone `templates/coex/coex.template.html` en `tmp/manufacturing-sheets/coex.composed.html` (carpeta ignorada por Git). |
| `test:sheets-regression` | Compone, renderiza CONFPMG04 y compara contra la línea base de COEX. Código de salida 0 = OK, 1 = falla. |
| `sheets:compose:bolsa-fuelle` | Compone la plantilla de BOLSA_FUELLE en `tmp/manufacturing-sheets/bolsa-fuelle.composed.html`. |
| `test:sheets-bolsa-fuelle` | Verifica BOLSA_FUELLE (BF-2) con 5 casos de datos (no es regresión píxel a píxel). |

Requisitos:
- `sheets:compose`: Node (probado con v24). Sin dependencias.
- `test:sheets-regression`: además `python` en el PATH (en Linux/macOS puede ser `python3`; en ese caso ejecutar el script directamente),
  los paquetes `pymupdf` y `numpy`, y Google Chrome (variable `CHROME_PATH` si no está en
  `C:\Program Files\Google\Chrome\Application\chrome.exe`). Entorno de referencia: Windows 11, Chrome 155 y Calibri.
- No forman parte de `npm test`, `lint` ni `build`, que siguen sin cambios.

## Regresión

Ver `test/manufacturing-sheets/regression/coex-confpmg04/README.md`.
