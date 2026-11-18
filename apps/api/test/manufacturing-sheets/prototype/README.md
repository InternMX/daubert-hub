# Verificación integral del prototipo (las ocho hojas)

`casos.json` define un caso por hoja (Bolsa Plana 1, Hojas en sus dos modalidades, Bolsa Fuelle, Bolsa Natural, Rollo Continuo, Termoencogible, COEX Azul y COEX Verde) más un caso de texto largo. Lo usan dos pruebas:

- **`test/prototype-sheets.spec.ts`** (Vitest, `npm run test`): la vista previa REAL de cada caso (registro de familias + plantilla aprobada + compositor) es completa, sin placeholders, borrador con firmas `SIN FIRMA`, HTML endurecido (CSP, sin scripts) y sin PostgreSQL; Extendida se rechaza en Rollo Continuo y Termoencogible; el cliente vacío no bloquea la demostración.
- **`verificar_prototipo.py`** (`npm run test:sheets-prototype`, requiere `npm run build --workspace=@daubert/api`): imprime esas vistas previas a PDF con Chrome y comprueba una sola página carta, ≥ 20 pt libres, firmas y que **ningún texto capturado desaparezca** (incluida la etiqueta y la descripción de ~200 caracteres, que crecen sin recortarse). Escribe en `test-results/` (ignorado por Git).

No se modifica ninguna plantilla ni línea base histórica: las regresiones existentes de cada familia siguen siendo la referencia visual.
