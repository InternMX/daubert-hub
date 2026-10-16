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

## Código (`code-parser.ts`, auxiliar)
`prefijo de cliente + F|P + resina + consecutivo (+ segmentos adicionales)`; F = Film, P = Paper. Prefijo y consecutivo de longitud variable. No sobrescribe
el título: si lo contradice (resina o material) solo agrega una advertencia.

## Limitaciones conocidas
- No hay porcentajes de resina (3 %, 2 %…), color, cliente, fecha de emisión, etiqueta ni firmas.
- Los títulos con varias resinas, tipos o medidas se dejan pendientes en lugar de resolverse por heurística.
- La resina se mapea a la Composición solo para PMG / CP5000 / NAT (las casillas de estas familias).
- El idioma y los patrones son los del catálogo actual (español, «C/», «CAL.»); se ampliarán con casos reales de BIND.

## Fase 3.1
`specification-suggestions.ts` (`sugerirEspecificacion`) calcula familia sugerida, resina VCI, color y etiqueta a partir del resultado del intérprete. La familia solo se sugiere con una bolsa de dos medidas sin indicios de fuelle/COEX/tubo/termoencogible (Bolsa Plana 1) o una hoja plástica explícita de dos medidas (Hojas). `CalibreOriginal.textoLiteral` guarda el calibre sin convertir.
