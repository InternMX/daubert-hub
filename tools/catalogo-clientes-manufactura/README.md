# Extractor de clientes y abreviaturas históricas (Hojas de Instrucción de Manufactura)

Herramienta **local, de solo lectura**, para descubrir qué clientes aparecen en las hojas históricas y con qué prefijo de código DCMX.
No toca PostgreSQL, no crea empresas ni asociaciones, no modifica los PDF de origen y no aplica OCR.

## Requisitos
Python 3.11+ con `pymupdf`, `pandas` y `openpyxl` (`pip install pymupdf pandas openpyxl`).

## Uso
```
python tools/catalogo-clientes-manufactura/extraer_catalogo_clientes.py --origen "<carpeta con los PDF>" --salida "<carpeta de salida>"
```
También se aceptan las variables `DAUBERT_ORIGEN` y `DAUBERT_SALIDA` (la salida por defecto es `./salida-catalogo-clientes`).
La carpeta de salida **no debe estar dentro del repositorio**: contiene información real de clientes y no se versiona.

## Qué hace
- Lee «Cliente:» y «Código DCMX:» por la **posición** de las etiquetas (no infiere desde la descripción).
- Prefijos candidatos de 2 a 5 letras; compara con el parser actual sin tratarlo como infalible.
- PDF sin texto (escaneados) se listan aparte; otros formatos también.
- Duplicados (mismo SHA-256 o mismo contenido) no cuentan como evidencia independiente.
- Las equivalencias entre nombres de cliente son solo **pistas** para revisión humana.

## Salida
`catalogo_clientes_abreviaturas.xlsx` (+ un CSV por hoja): Resumen, Clientes_detectados, Asociaciones_propuestas, Conflictos,
Posibles_equivalencias, No_interpretados, Escaneados_sin_OCR, Otros_formatos, Duplicados y Evidencia_por_documento.

## Pruebas (PDF sintéticos, sin datos reales)
```
python -m unittest discover -s tools/catalogo-clientes-manufactura
```
