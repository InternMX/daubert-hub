# Interpretador de productos de BIND (fase 1: Bolsa Plana 1 y Hojas (HOJA_PAQ))

Función pura (sin red, sin base de datos, sin dependencias nuevas) que interpreta un producto de BIND ERP para **autocompletar los campos comunes** de las hojas de
manufactura. No consulta la API de BIND, no genera documentos, no incluye firmas y no modifica las plantillas.

```ts
import { interpretarProductoBind, sugerirDatosPlantilla } from './bind-product-interpreter';
const resultado = interpretarProductoBind({ ID, Code, Title, Description, Weight, CreationDate });
const datos = sugerirDatosPlantilla(resultado);   // solo lo EXTRAÍDO o SUGERIDO; nunca lo pendiente
```

## Entrada
Solo se leen `ID`, `Code` (código DCMX), `Title` (descripción comercial), `Description` (se conserva sin interpretar), `Weight` (libras) y `CreationDate`
(fecha de **alta en BIND**, no la fecha de emisión de la hoja). Cualquier otro campo (costos, inventarios, precios) se ignora.

## Salida
Cada campo es un `Campo<T>` con `valor`, `origen` (`EXTRAIDO`, `SUGERIDO` o `PENDIENTE`), `fuente` (fragmento del título) y `nota`. También devuelve la lista de
`pendientes`, las `advertencias` (con código estable) y la interpretación auxiliar del código. **La familia siempre queda `PENDIENTE_CONFIRMACION`**
(`posiblesEstaFase` es solo una pista no vinculante: una bolsa de dos dimensiones no es necesariamente Bolsa Plana 1).

## Reglas del título (`title-parser.ts`)
- **Tipo:** Bolsa, Hoja o Papel (el papel prevalece y se marca fuera de alcance). Tipos contradictorios → pendiente.
- **Resina:** PMG, CP5000 (también «CP 5000»), NAT, ESD o XOW. Varias distintas → pendiente. ESD y XOW avisan que no tienen casilla en estas familias.
- **Medidas:** exactamente dos dimensiones `Ancho × Largo` (`x`, `X` o `×`). Una sola, tres o varias expresiones → pendiente. Unidad explícita: `"`, `IN`,
  `PULG…` (pulgadas) o `MM`; en una sola dimensión aplica a ambas. Sin unidad, contradictoria o en `CM` → pendiente (sin conversión).
- **Calibre:** valor y unidad originales (`CAL. 3 MIL` → `3` / `MIL`). `CAL.200` conserva `200` con la unidad/escala **pendiente**: nunca se convierte en `2 MIL`.
- **Presentación:** Rollo o Paquete (ambos → pendiente).
- **Cantidad:** `C/200`, `PAQUETE 100 BOLSAS`, `200 BOLSAS`… Sin la palabra Bolsas/Hojas, la unidad solo se **sugiere** según el tipo.
- **Peso:** `Weight` en libras; cero, negativo, no numérico o ausente → pendiente con advertencia.

## Código como fuente SECUNDARIA (`code-parser.ts`, `code-reconciliation.ts`)
`prefijo variable + F|P + clave + segmentos opcionales + consecutivo`; F = Film, P = Paper. Claves: `PMG`, `CP`, `NAT`, `LDPE`, `ESD`, `XOW` y `PWnn` (papel: PW30, PW33…). No hay longitud fija de prefijo, segmentos ni consecutivo
(`DANFPMGOC09` → segmento `OC`, consecutivo `09`; `CATCFFPMG-014` conserva `CATCF` como prefijo porque sin catálogo no se separa). **`CP` seguido de dígitos no se divide** (`AUDFCP5010`, `KAMFCP500002`…): `claveAmbigua`, sin consecutivo.
Una letra implausible con la clave (p. ej. `P` + PMG: `DAIDPPMG02`) deja el material ambiguo y no se sugiere.

Prioridad: **el Title manda**; el Code solo sugiere cuando el Title omite el dato. Cada campo (`resina`, `tipo`, `material`, `claveMaterial`) lleva `procedencia`:
`TITLE` (extraído del título) · `CODE` (INFERIDO del código; siempre `origen: SUGERIDO`, nunca «extraído») · `TITLE_Y_CODE` (corroborado) · `CONTRADICCION` (se conserva el título o queda pendiente y se advierte con
`CODIGO_RESINA_DISTINTA` / `CODIGO_MATERIAL_DISTINTO`). Si ambas fuentes son insuficientes, el campo queda `PENDIENTE`.
- **Film (F):** `material = FILM` y, si el título no indica la resina, la composición compatible (PMG, CP→CP5000, NAT, LDPE→Natural). **No** determina bolsa, hoja, fuelle ni COEX.
- **Paper (P):** identifica PW30/PW33 y marca `MATERIAL_PAPEL_SIN_PLANTILLA`: producto válido de BIND, familia pendiente y ninguna plantilla plástica.
- La corrección manual del usuario nunca se sobrescribe (el formulario solo precarga al buscar el producto).

## Limitaciones conocidas
- No hay porcentajes de resina (3 %, 2 %…), color, cliente, fecha de emisión, etiqueta ni firmas.
- Los títulos con varias resinas, tipos o medidas se dejan pendientes en lugar de resolverse por heurística.
- La resina se mapea a la Composición solo para PMG / CP5000 / NAT (las casillas de estas familias).
- El idioma y los patrones son los del catálogo actual (español, «C/», «CAL.»); se ampliarán con casos reales de BIND.

## Fase 3.1
`specification-suggestions.ts` (`sugerirEspecificacion`) calcula familia sugerida, resina VCI, color y etiqueta a partir del resultado del intérprete. La familia solo se sugiere con una bolsa de dos medidas sin indicios de fuelle/COEX/tubo/termoencogible (Bolsa Plana 1) o una hoja plástica explícita de dos medidas (Hojas). `CalibreOriginal.textoLiteral` guarda el calibre sin convertir.
