# Palabras de un PDF con su posición (PyMuPDF): salida JSON {"paginas": n, "palabras": [[pagina, x0, y0, x1, y1, texto], ...]}. Solo lectura.
import json
import sys

import fitz  # PyMuPDF

with fitz.open(sys.argv[1]) as doc:
    palabras = []
    for i, pagina in enumerate(doc, start=1):
        for x0, y0, x1, y1, texto, *_ in pagina.get_text("words"):
            palabras.append([i, round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2), texto])
    print(json.dumps({"paginas": len(doc), "palabras": palabras}, ensure_ascii=False))
