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

## Regresión

Ver `test/manufacturing-sheets/regression/coex-confpmg04/README.md`.
