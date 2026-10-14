# manufacturing-sheets

Plantillas HTML de las Hojas de Instrucción de Manufactura de Daubert México (HTML → PDF).
Estado: solo **COEX Verde** (validado contra CONFPMG04). Bolsa Fuelle y Hoja Paq aún no existen.

## Estructura

```
templates/
  components/            # piezas reutilizables (HTML y CSS)
    header/
      header.html            logotipo + título (placeholder {{sufijo_titulo}})
      header.css             estilos propios del encabezado
      header.mobile.css      reglas del encabezado para @media screen (≤ 816 px)
    signatures/
      signatures.html        zona de firmas: bloques de elaboración y aprobación
      signatures.css         posiciones y tamaños de los bloques
  coex/
    coex.template.html   # plantilla fuente con marcadores @include
    images/              # DC_logo.jpg y COEX_Curvas_Trazado_Original.svg (fuente de las curvas)
tools/
  compose-template.mjs   # compositor (Node, sin dependencias)
```

## Composición

```
node tools/compose-template.mjs --source templates/coex/coex.template.html --out <salida.html>
```

Cada línea `<!-- @include ruta -->` (HTML) o `/* @include ruta */` (dentro de `<style>`) se sustituye por el contenido exacto del
archivo, con ruta relativa a `templates/`. No transforma, minifica ni reordena. Falla si falta un archivo, si no termina en
salto de línea, si usa CRLF, si sale de `templates/` o si anida inclusiones. La salida no contiene JavaScript.

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

## Scripts npm (workspace `@daubert/api`)

Se ejecutan desde `apps/api` (`npm run <script>`) o desde la raíz del monorepo (`npm run <script> -w @daubert/api`).

| Script | Qué hace |
|---|---|
| `sheets:compose` | Compone `templates/coex/coex.template.html` en `tmp/manufacturing-sheets/coex.composed.html` (carpeta ignorada por Git). |
| `test:sheets-regression` | Compone, renderiza CONFPMG04 y compara contra la línea base de COEX. Código de salida 0 = OK, 1 = falla. |

Requisitos:
- `sheets:compose`: Node (probado con v24). Sin dependencias.
- `test:sheets-regression`: además `python` en el PATH (en Linux/macOS puede ser `python3`; en ese caso ejecutar el script directamente),
  los paquetes `pymupdf` y `numpy`, y Google Chrome (variable `CHROME_PATH` si no está en
  `C:\Program Files\Google\Chrome\Application\chrome.exe`). Entorno de referencia: Windows 11, Chrome 155 y Calibri.
- No forman parte de `npm test`, `lint` ni `build`, que siguen sin cambios.

## Regresión

Ver `test/manufacturing-sheets/regression/coex-confpmg04/README.md`.
