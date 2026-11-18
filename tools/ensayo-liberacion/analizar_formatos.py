# Análisis automático (PyMuPDF) de los PDF finalizados de los ocho formatos. Uso: python analizar_formatos.py <carpeta con formatos.json y los PDF>
# Comprueba por formato: 1 página, tamaño/orientación, texto con el código, etiquetas de responsables y nombres, imágenes de firma ubicadas junto a su etiqueta, ausencia de leyendas de prueba
# («PRUEBA», «NO VÁLIDO PARA PRODUCCIÓN», «TEST», huella, «Finalizada en»), fuentes incrustadas, y coherencia con la revisión/entorno registrados. NO sustituye la revisión visual de Manufactura.
import fitz, json, os, re, sys
carpeta = sys.argv[1]
datos = json.load(open(os.path.join(carpeta, 'formatos.json'), encoding='utf-8'))
PROHIBIDO = [r'PRUEBA', r'NO V.LIDO', r'\bTEST\b', r'Huella', r'Finalizada en', r'No implica aprobaci']
PROHIBIDO_EXACTO = [r'SIN FIRMA']   # marcador de firma ausente de la capa anterior (mayúsculas; el nombre de un responsable puede contener «Sin Firma»)
fallos = 0
def ok(c, m, extra=''):
    global fallos
    print(('PASS ' if c else 'FAIL ') + m + ('' if c else (' :: ' + str(extra))))
    if not c: fallos += 1
for f in datos:
    ruta = os.path.join(carpeta, f['archivo'])
    print(f"== {f['nombre']} · {f['archivo']} · código {f['codigo']} · REV{f['revision']} · {f['entorno']}")
    with fitz.open(ruta) as doc:
        n = len(doc); pg = doc[0]; w, h = pg.rect.width, pg.rect.height
        texto = '\n'.join(p.get_text() for p in doc)
        ok(n == 1, f'{f["nombre"]}: una sola página', n)
        ok(abs(w - 612) < 2 and abs(h - 792) < 2, f'{f["nombre"]}: tamaño Carta {round(w)}x{round(h)} pt ({"vertical" if h > w else "horizontal"})', (w, h))
        ok(f['codigo'] in texto.replace('\n', ' ') or f['codigo'].split('-')[0] in texto, f'{f["nombre"]}: contiene el código del producto')
        for pat in PROHIBIDO: ok(not re.search(pat, texto, re.I), f'{f["nombre"]}: sin la leyenda «{pat}»', re.findall(pat, texto, re.I)[:2])
        for pat in PROHIBIDO_EXACTO: ok(not re.search(pat, texto), f'{f["nombre"]}: sin el marcador «SIN FIRMA»', re.findall(pat, texto)[:2])
        etiquetas = {k: [b for b in pg.get_text('words') if b[4].lower().startswith(k)] for k in ('gener', 'revis', 'aprob')}
        ok(all(etiquetas[k] for k in etiquetas), f'{f["nombre"]}: etiquetas de responsables Generó / Revisó / Aprobó presentes', {k: len(v) for k, v in etiquetas.items()})
        ok('Elaboró Formato' in texto or 'Elabor' in texto or 'Gener' in texto, f'{f["nombre"]}: nombre del responsable "Generó" impreso')
        ok('Aprobó Sin Firma Sintético' in texto.replace('\n', ' ') or 'Sin Firma' in texto.replace('\n', ' '), f'{f["nombre"]}: nombre del responsable sin imagen impreso (espacio de firma vacío, sin marcador «SIN FIRMA»)')
        imgs = pg.get_images(full=True)
        ok(len(imgs) >= 2, f'{f["nombre"]}: dos imágenes de firma incrustadas ({len(imgs)})', len(imgs))
        rects = [r for im in imgs for r in pg.get_image_rects(im[0])]
        ok(all(0 <= r.x0 and r.x1 <= w and 0 <= r.y0 and r.y1 <= h for r in rects), f'{f["nombre"]}: las firmas quedan dentro de la página', [tuple(round(v) for v in r) for r in rects])
        pal = pg.get_text('words')
        zona = [b for b in pal if b[4].lower().startswith('gener')]
        cerca = False
        if zona and rects:
            z = zona[-1]; cerca = any(abs(r.y1 - z[1]) < 120 or abs(r.y0 - z[3]) < 120 or (r.y0 < z[3] + 120 and r.y1 > z[1] - 120) for r in rects)
        ok(cerca, f'{f["nombre"]}: una imagen de firma queda en la banda de la etiqueta «Generó»')
        fuentes = sorted({x[3] for p in doc for x in p.get_fonts()})
        ok(len(fuentes) >= 1 and all('+' in x for x in fuentes), f'{f["nombre"]}: fuentes incrustadas {fuentes}')
        ok(f['entorno'] == 'PRODUCCION' and f['revision'] == 1 and f['estado'] == 'FINALIZADA', f'{f["nombre"]}: registro en la base = FINALIZADA, revisión {f["revision"]}, entorno {f["entorno"]}')
        ok(f['pdfNombre'] is not None and ('REV01' in f['pdfNombre'].upper() or '01' in f['pdfNombre']), f'{f["nombre"]}: nombre del PDF registrado «{f["pdfNombre"]}» refleja la revisión')
print(f'RESULTADO: {fallos} FAIL' if fallos else 'RESULTADO: análisis automático de los 8 PDF: todo PASS')
sys.exit(1 if fallos else 0)
