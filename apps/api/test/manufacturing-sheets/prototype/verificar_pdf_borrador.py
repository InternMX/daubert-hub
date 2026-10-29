# -*- coding: utf-8 -*-
"""Verifica los PDF de borrador REALES (no solo el HTML) generados por generar_pdfs_borrador.cjs con el servicio compilado.

Por cada caso simulado comprueba: tamaño Carta y una página; textos de los datos (descripción y etiqueta íntegras, calibre literal, peso y VCI con su precisión, código); identificación BORRADOR /
SIN APROBAR / SIN FIRMA (e INCOMPLETO cuando faltan datos) dentro del documento; que la capa no toque medidas, dibujos ni tablas; colores (NATURAL, COEX Azul/Verde); imágenes; y la EQUIVALENCIA con la
vista previa (la misma composición impresa sin la capa): mismas palabras en las mismas posiciones, mismos dibujos y cero píxeles distintos fuera de los márgenes de la capa.

Uso (desde apps/api): python test/manufacturing-sheets/prototype/verificar_pdf_borrador.py [CARPETA_PDF]   (los genera primero con: node test/.../generar_pdfs_borrador.cjs CARPETA)
Código de salida 0 = todo correcto; 1 = alguna comprobación falló. Esta prueba NO sustituye la regresión histórica CONFPMG04 (se reporta aparte).
"""
import json
import os
import subprocess
import sys

import fitz

AQUI = os.path.dirname(os.path.abspath(__file__))
CARPETA = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, 'test-results', 'pdf-borrador'))
TOL = 0.15                       # pt, la misma tolerancia de coordenadas de las regresiones
BANDA_SUP = 26.0                 # pt: la capa ocupa y < 26 (franja superior)
BANDA_INF = 768.0                # pt: y > 768 (pie)
fallos, hechos = [], []


def ok(cond, msg):
    (hechos if cond else fallos).append(msg)
    return cond


def palabras(pg):
    return [[w[4], w[0], w[1], w[2], w[3]] for w in pg.get_text('words')]


def en_banda(w):
    return w[4] < BANDA_SUP or w[2] > BANDA_INF


def dibujos(pg):
    area = pg.rect.width * pg.rect.height
    return [d for d in pg.get_drawings() if d['rect'].width * d['rect'].height < 0.9 * area]


def hex_fill(d):
    f = d.get('fill')
    return '#%02X%02X%02X' % tuple(round(c * 255) for c in f) if f else None


def main():
    if not os.path.isfile(os.path.join(CARPETA, 'resumen.json')):
        print('No hay PDF generados en %s. Ejecuta primero generar_pdfs_borrador.cjs.' % CARPETA); return 2
    resumen = {r['id']: r for r in json.load(open(os.path.join(CARPETA, 'resumen.json'), encoding='utf-8'))}
    casos = {c['id']: c for c in json.load(open(os.path.join(AQUI, 'casos.json'), encoding='utf-8'))}
    for cid, r in resumen.items():
        caso = casos.get(cid) or {'familia': r['familia'], 'datos': {}}
        d = caso['datos']
        pdf = fitz.open(os.path.join(CARPETA, cid + '.pdf')); base = fitz.open(os.path.join(CARPETA, cid + '.sin-capa.pdf'))
        pg, bg = pdf[0], base[0]
        pre = '[%s] ' % cid
        incompleto = cid.startswith('incompleto')
        # 1. Carta y una página (los ejemplos normales y el caso de textos largos caben en una sola)
        ok(pdf.page_count == 1 and base.page_count == 1, pre + 'una página (borrador y vista)')
        ok(abs(pg.rect.width - 612) < 0.5 and abs(pg.rect.height - 792) < 0.5, pre + 'tamaño Carta 612 x 792 pt')
        w, b = palabras(pg), palabras(bg)
        texto = ' '.join(x[0] for x in w)
        # 2. identificación dentro del documento (no una superposición de la interfaz)
        marca = ' '.join(x[0] for x in w if x[4] < BANDA_SUP)
        ok('BORRADOR' in marca and 'APROBAR' in marca and 'SIN' in marca, pre + 'franja superior «BORRADOR · SIN APROBAR» dentro del PDF')
        ok(('INCOMPLETO' in marca) == incompleto, pre + ('identificado como INCOMPLETO' if incompleto else 'no marcado INCOMPLETO'))
        ok(sum(1 for x in w if x[0] == 'FIRMA') >= 3, pre + 'SIN FIRMA en los dos bloques de firma y en el pie')
        ok('BORRADOR-INCOMPLETO' in r['archivo'] if incompleto else r['archivo'].startswith('BORRADOR_') and r['archivo'].endswith('.pdf'), pre + 'nombre de archivo seguro (%s)' % r['archivo'])
        # 3. sin recortes: todo el texto dentro de la página y el contenido técnico fuera de los márgenes de la capa
        ok(all(x[1] >= 0 and x[3] <= 612 + 0.1 and x[2] >= 0 and x[4] <= 792 for x in w), pre + 'ningún texto fuera de la página')
        ok(all(en_banda(x) or x[4] <= BANDA_INF for x in w), pre + 'el contenido termina antes del pie (último texto %.1f pt)' % max(x[4] for x in w if not en_banda(x)))
        # 4. datos: textos íntegros, calibre literal y precisiones
        if d:
            for clave in ('codigo', 'calibre', 'ancho', 'largo'):
                if d.get(clave): ok(d[clave] in texto, pre + '%s «%s» presente' % (clave, d[clave]))
            for clave in ('descripcion', 'etiqueta'):
                if d.get(clave): ok(all(t in texto.split() for t in d[clave].split()), pre + '%s completa (todas sus palabras)' % clave)
            for clave in ('pesoCapaInterior', 'pesoCapaIntermedia', 'pesoCapaExterior', 'lbVciInterior', 'lbVciIntermedia', 'lbVciExterior'):
                if d.get(clave): ok(d[clave] in texto.split(), pre + '%s = %s con su precisión' % (clave, d[clave]))
        # 5. la capa no toca medidas, dibujos ni tablas
        franjas = [x for x in w if en_banda(x)]
        resto = [x for x in w if not en_banda(x)]
        def cruza(p, q): return not (p[3] <= q[1] or p[1] >= q[3] or p[4] <= q[2] or p[2] >= q[4])
        ok(not [1 for x in resto for f in franjas if cruza(x, f)], pre + 'ningún texto técnico se solapa con la capa de borrador')
        dib = dibujos(pg)
        tocan = [dr for dr in dib if dr['rect'].y0 < BANDA_SUP - 1 or dr['rect'].y1 > BANDA_INF + 1]
        ok(not tocan, pre + 'ningún dibujo, tabla ni imagen invade las franjas de la capa')
        imgs = pg.get_image_info()
        ok(all(i['bbox'][1] >= BANDA_SUP - 1 and i['bbox'][3] <= BANDA_INF + 1 for i in imgs), pre + 'imágenes completas dentro del área de contenido')
        # 6. equivalencia con la vista previa: mismas palabras en las mismas posiciones; mismos dibujos; 0 píxeles distintos fuera de la capa
        rb = [x for x in b if not en_banda(x)]
        ok(len(rb) == len(resto) and all(p[0] == q[0] and max(abs(p[i] - q[i]) for i in range(1, 5)) <= TOL for p, q in zip(rb, resto)), pre + 'textos y posiciones idénticos a la vista previa (tolerancia %.2f pt)' % TOL)
        ok(sorted(filter(None, map(hex_fill, dibujos(bg)))) == sorted(filter(None, map(hex_fill, dib))) and len(dibujos(bg)) == len(dib), pre + 'mismos dibujos y colores que la vista previa')
        ok(len(bg.get_image_info()) == len(imgs), pre + 'mismas imágenes que la vista previa')
        pa, pb = pg.get_pixmap(dpi=100), bg.get_pixmap(dpi=100)
        y0, y1 = int(BANDA_SUP / 72 * 100) + 1, int(BANDA_INF / 72 * 100)
        a, c = pa.samples, pb.samples
        n, ancho = pa.n, pa.width
        distintos = 0
        for y in range(y0, y1):
            fila = slice(y * ancho * n, (y + 1) * ancho * n)
            if a[fila] != c[fila]:
                distintos += sum(1 for x in range(ancho) if a[(y * ancho + x) * n:(y * ancho + x) * n + 3] != c[(y * ancho + x) * n:(y * ancho + x) * n + 3])
        ok(distintos == 0, pre + 'cero píxeles distintos fuera de la capa (%d)' % distintos)
        # 7. colores y familias
        fills = {hex_fill(dr) for dr in dib}
        if cid == 'bolsa-natural': ok('#FFF2CC' in fills and 'NATURAL' in texto.split(), pre + 'color NATURAL (#FFF2CC) en el dibujo y el texto')
        if cid == 'coex-azul': ok({'#558ED5', '#376092', '#95B3D7', '#C6D9F1'} <= fills and '#00B050' not in fills, pre + 'COEX Azul con sus colores aprobados')
        if cid == 'coex-verde': ok({'#00B050', '#92D050', '#D7E4BD'} <= fills and '#558ED5' not in fills, pre + 'COEX Verde con sus colores aprobados')
        if cid == 'termoencogible': ok(len(imgs) >= 2 and all(i['width'] > 10 and i['height'] > 10 for i in imgs), pre + 'imagen del rollo doblado y logotipo presentes (%d imágenes)' % len(imgs))
        if cid == 'rollo-continuo': ok(len(dib) > 20, pre + 'dibujos vectoriales del rollo presentes (%d)' % len(dib))
        ok(bool(imgs), pre + 'logotipo presente')
        # 8. generar PNG para la comparación visual (vista previa | PDF)
        png = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, pa.width * 2, pa.height), False)
        png.set_rect(png.irect, (255, 255, 255))
        pb_rgb, pa_rgb = fitz.Pixmap(fitz.csRGB, pb), fitz.Pixmap(fitz.csRGB, pa)
        png.copy(pb_rgb, pb_rgb.irect)
        pa_rgb.set_origin(pa.width, 0); png.copy(pa_rgb, pa_rgb.irect)
        png.save(os.path.join(CARPETA, cid + '.comparacion.png'))
    print('Comprobaciones correctas: %d | fallidas: %d' % (len(hechos), len(fallos)))
    for f in fallos: print('  FALLA:', f)
    return 1 if fallos else 0


if __name__ == '__main__':
    sys.exit(main())
