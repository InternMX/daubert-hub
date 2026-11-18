"""Verificación estructural, de contenido y visual de COEX Azul, INDEPENDIENTE de la regresión histórica CONFPMG04 (COEX Verde).

Usa la plantilla COEX existente (sin duplicarla) con los datos de `entrada/coex-azul.datos.json` y el motor de composición/impresión de
`../coex-confpmg04/comparar_regresion.py` (sin ejecutar su comparación). NO hay línea base de píxeles: aún no existe un PDF oficial de COEX Azul y no se
genera una «referencia» a partir del propio borrador. Al terminar comprueba por huella que la entrada y la referencia históricas de CONFPMG04 no cambiaron.

Uso:  python verificar_coex_azul.py [--salida CARPETA]        # o: npm run test:sheets-coex-azul
Requiere Node, Google Chrome (CHROME_PATH), PyMuPDF y numpy. Código de salida 0 = OK, 1 = falla.
"""
import argparse, glob, hashlib, json, os, sys

import fitz
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
AQUI = os.path.dirname(os.path.abspath(__file__))
HIST = os.path.join(AQUI, '..', 'coex-confpmg04')
sys.path.insert(0, HIST)
import comparar_regresion as cr          # motor de composición/impresión (no se ejecuta su comparación)
hp = cr.hp

SALIDA = os.path.join(AQUI, 'test-results')
DATOS = os.path.join(AQUI, 'entrada', 'coex-azul.datos.json')
HISTORICOS = [os.path.join(HIST, 'entrada', 'confpmg04.datos.json')] + sorted(glob.glob(os.path.join(HIST, 'referencia', '*')))
COLORES_APROBADOS = {'color_bolsa_hex': '#558ED5', 'color_capa_interior': '#376092', 'color_capa_intermedia': '#95B3D7', 'color_capa_exterior': '#C6D9F1',
                     'color_cotas_internas_hex': '#FFFFFF'}      # aprobados para la prueba (procedencia en entrada/coex-azul.datos.json y README); el dato no puede desviarse. Las flechas internas son BLANCAS por legibilidad (decisión autorizada, no es el color del Excel: #4A7EBB)
EXTERNAS = '#4A7EBB'                       # flechas externas de ancho y largo: color original del Excel
BARRA = (0x24, 0x40, 0x62)               # #244062: barra inferior fija de COEX, sobresale por ambos lados del cuerpo
ESCALA = 150 / 72                        # el PNG de producir() es de 150 ppp
hexrgb = lambda c: tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
cerca = lambda a, b, t=3: a is not None and all(abs(x - y) <= t for x, y in zip(a, b))


def luminancia(rgb):
    f = lambda c: (c / 255 / 12.92) if c / 255 <= 0.03928 else (((c / 255) + 0.055) / 1.055) ** 2.4
    r, g, b = (f(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contraste(a, b):
    la, lb = sorted((luminancia(a), luminancia(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def huellas():
    return {os.path.relpath(r, HIST): hashlib.sha256(open(r, 'rb').read()).hexdigest() for r in HISTORICOS if os.path.isfile(r)}


def contar(region, color, t=3):
    return int((np.abs(region - np.array(color)).max(axis=2) <= t).sum()) if region.size else 0


def verificar(plantilla):
    j = json.load(open(DATOS, encoding='utf-8'))
    d, v = j['datos'], j['visual']
    fallos, avisos = [], []
    carpeta = os.path.join(SALIDA, j['caso'])
    hp.preparar_carpeta(carpeta)
    r = cr.producir(plantilla, DATOS, carpeta)          # PDF temporal nuevo y validado (hp.imprimir_pdf); nunca se analiza un PDF anterior
    dom, palabras = r['dom'], r['palabras']              # palabras: [texto, x0, y0, x1, y1] de la página 1
    for k, esperado in COLORES_APROBADOS.items():
        if v.get(k, '').upper() != esperado: fallos.append('el color %s del dato (%s) no es el aprobado (%s)' % (k, v.get(k), esperado))
    if j.get('variante') != 'COEX_AZUL': fallos.append('la variante debe declararse explícitamente: COEX_AZUL')
    if r['faltan']: fallos.append('placeholders sin dato: %s' % r['faltan'])
    if r['sobran']: fallos.append('datos sin placeholder: %s' % r['sobran'])
    if r['pendientes']: fallos.append('placeholders pendientes tras renderizar: %d' % r['pendientes'])
    paginas = r['pdf']['paginas']
    if paginas != 1: fallos.append('páginas: %d (se esperaba 1)' % paginas)
    if r['pdf']['tamano_pt'] != [612.0, 792.0]: fallos.append('tamaño de página %s' % r['pdf']['tamano_pt'])
    fin = dom['firmas_zona']['y1']
    fallos += hp.fallos_de_limite(fin)                   # una página y al menos 20 pt libres
    with fitz.open(os.path.join(carpeta, 'confpmg04.pdf')) as pdf:
        texto = ' '.join(hp.texto_de_todas_las_paginas(pdf).split())
    # 1. campos impresos: todos los valores del Excel (los vacíos no se exigen ni se inventan) y los rótulos
    for k, val in d.items():
        s = ' '.join(str(val).split())
        if s and not k.startswith('resaltar_') and s not in texto: fallos.append('falta el valor impreso de %s (%s)' % (k, s))
    for e in ('Cliente:', 'Fecha:', 'Producto:', 'Color:', 'Código DCMX:', 'Descripción:', 'Composición:', 'PMG', 'CP5000', 'Natural', 'Presentación:', 'Rollo', 'Paquete',
              'Cantidad Por Rollo o Paquete:', 'Medidas:', 'Unidad de Medidas:', 'Ancho:', 'Largo:', 'Fuelle Derecho', 'Fuelle Izquierdo', 'Calibre:', 'PESO POR CAPA',
              'Capa Interior', 'Capa Intermedia', 'Capa Exterior', 'PESO BOLSA LB:', 'Dibujo Bolsa', 'Etiqueta:', 'Interior', 'Intermedia', 'Exterior'):
        if e not in texto: fallos.append('falta la etiqueta %r' % e)
    if 'COEXTRUSI' not in texto.upper(): fallos.append('el título debe llevar COEXTRUSIÓN')
    if d['etiqueta'] != '': fallos.append('la etiqueta debe quedar vacía (el Excel no da valor)')
    sig = lambda a: next((w for w in palabras if w[0] == a), None)
    for rotulo, siguiente in (('PMG', 'X'), ('CP5000', 'NA'), ('Natural', 'NA'), ('Rollo', 'X'), ('Paquete', 'NA')):    # X/NA del Excel
        w = sig(rotulo)
        fila = sorted([p for p in palabras if w and abs(p[2] - w[2]) < 3 and p[1] > w[1]], key=lambda p: p[1]) if w else []
        if not w or not any(p[0] == siguiente for p in fila[:3]): fallos.append('selección %s -> %s no se imprime como en el Excel' % (rotulo, siguiente))
    # 2. sin recortes ni superposiciones de texto
    for i, a in enumerate(palabras):
        for b in palabras[i + 1:]:
            ix, iy = min(a[3], b[3]) - max(a[1], b[1]), min(a[4], b[4]) - max(a[2], b[2])
            if ix > 0.8 and iy > 2: fallos.append('superposición de texto: %r y %r' % (a[0], b[0]))
        if a[1] < 0 or a[3] > 612 or a[2] < 39 or a[4] > hp.LIMITE_Y: fallos.append('texto fuera del área imprimible: %r' % a[0])
    # 3. firmas SIN FIRMA dentro de sus contenedores
    for k in ('firma_elaboro', 'firma_aprobo'):
        c = dom[k]
        if sum(1 for w in palabras if w[0] in ('SIN', 'FIRMA') and c['x0'] - 1 <= w[1] and w[3] <= c['x1'] + 1 and c['y0'] - 1 <= w[2] and w[4] <= c['y1'] + 1) != 2:
            fallos.append('el contenedor %s no contiene el marcador SIN FIRMA' % k)
    # 4. colores impresos (PNG de 150 ppp): cuerpo, tres capas, cotas internas y barra inferior
    img = cr.pixmap_a_array(r['png'])
    px = lambda x, y: hp.pixel_o_none(img, ESCALA, x, y)
    dx0, dy0 = dom['dibujo_bolsa']['x0'], dom['dibujo_bolsa']['y0']
    cuerpo = hexrgb(v['color_bolsa_hex'])
    pc = px(dx0 + 257, dy0 + 120)                                      # centro del cuerpo (entre los fuelles punteados)
    if not cerca(pc, cuerpo): fallos.append('cuerpo de la bolsa %s != %s' % (pc, v['color_bolsa_hex']))
    cap = dom['capas']                                                  # los arcos de las tres capas: filas de capas, mitad derecha (sin la franja de encabezado)
    f2, f4 = dom['fila_capas_2'], dom['fila_capas_4']
    ancho_cap = cap['x1'] - cap['x0']
    reg_capas = img[int(f2['y0'] * ESCALA):int(f4['y1'] * ESCALA), int((cap['x0'] + 0.55 * ancho_cap) * ESCALA):int((cap['x0'] + 0.9 * ancho_cap) * ESCALA)]
    for nombre in ('interior', 'intermedia', 'exterior'):
        n = contar(reg_capas, hexrgb(v['color_capa_' + nombre]))
        if n < 120: fallos.append('capa %s: casi no se imprime su color %s (%d px)' % (nombre, v['color_capa_' + nombre], n))
    cotas = hexrgb(v['color_cotas_internas_hex'])
    n1 = contar(img[int((dy0 + 41) * ESCALA):int((dy0 + 46) * ESCALA), int((dx0 + 152) * ESCALA):int((dx0 + 232) * ESCALA)], cotas, 4)
    n2 = contar(img[int((dy0 + 38.5) * ESCALA):int((dy0 + 43.5) * ESCALA), int((dx0 + 286) * ESCALA):int((dx0 + 372) * ESCALA)], cotas, 4)
    if n1 < 60 or n2 < 60: fallos.append('las cotas internas casi no se imprimen con %s (%d y %d px)' % (v['color_cotas_internas_hex'], n1, n2))
    # flechas externas (ancho arriba y largo a la izquierda) en #4A7EBB; valores de los fuelles en negro y legibles
    ext = hexrgb(EXTERNAS)
    ne1 = contar(img[int((dy0 + 19.5) * ESCALA):int((dy0 + 22) * ESCALA), int((dx0 + 152) * ESCALA):int((dx0 + 376) * ESCALA)], ext, 4)
    ne2 = contar(img[int((dy0 + 30) * ESCALA):int((dy0 + 174) * ESCALA), int((dx0 + 131.5) * ESCALA):int((dx0 + 133.5) * ESCALA)], ext, 4)
    if ne1 < 200 or ne2 < 200: fallos.append('las flechas externas de ancho y largo deben imprimirse en %s (%d y %d px)' % (EXTERNAS, ne1, ne2))
    for fuelle in (d['fuelle_izquierdo'], d['fuelle_derecho']):
        w = [p for p in palabras if p[0] == fuelle and dx0 + 140 <= p[1] <= dx0 + 380 and dy0 + 40 <= p[2] <= dy0 + 80]
        if not w: fallos.append('no se encuentra el valor de fuelle %s dentro del cuerpo' % fuelle); continue
        reg = img[int(w[0][2] * ESCALA):int(w[0][4] * ESCALA), int(w[0][1] * ESCALA):int(w[0][3] * ESCALA)]
        negros = int((reg.max(axis=2) < 70).sum()) if reg.size else 0
        if negros < 25: fallos.append('el valor de fuelle %s no se imprime en negro legible (%d px negros)' % (fuelle, negros))
        if contraste((0, 0, 0), cuerpo) < 4.5: fallos.append('el negro sobre el cuerpo no es suficientemente legible')
    if not cerca(px(dx0 + 110, dy0 + 183), BARRA) or not cerca(px(dx0 + 365 + 25, dy0 + 183), BARRA): fallos.append('falta la barra inferior #244062 que sobresale por ambos lados')
    if not cerca(px(dx0 + 110, dy0 + 100), (255, 255, 255)): fallos.append('la barra inferior no debe prolongarse sobre el costado del cuerpo')
    # 5. legibilidad de las cotas internas sobre el relleno (se documenta; el color original no se cambia)
    c_cota = contraste(cotas, cuerpo)
    if c_cota < 3.0:                                                    # blanco (3.4:1) cumple; el aviso solo aparecería con un color de menor contraste
        avisos.append('LEGIBILIDAD: las cotas internas %s sobre el cuerpo %s tienen contraste %.2f:1 (< 3:1); es el color original del Excel y no se modificó. '
                      'Alternativas: #FFFFFF (%.1f:1) o #1F497D (%.1f:1).' % (
                          v['color_cotas_internas_hex'], v['color_bolsa_hex'], c_cota, contraste((255, 255, 255), cuerpo), contraste((0x1F, 0x49, 0x7D), cuerpo)))
    print('%-26s págs %d | pend. %d | firmas hasta %.1f pt | libre %.1f pt | %s' % (j['caso'], paginas, r['pendientes'], fin, hp.LIMITE_Y - fin, 'OK' if not fallos else 'FALLA (%d)' % len(fallos)))
    print('   contraste cotas internas / cuerpo: %.2f:1 | cuerpo %s | capas %s / %s / %s' % (c_cota, v['color_bolsa_hex'], v['color_capa_interior'], v['color_capa_intermedia'], v['color_capa_exterior']))
    for a in avisos: print('   !', a)
    for f in fallos[:15]: print('   -', f)
    return fallos


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', help='carpeta de resultados alternativa (por defecto test-results)')
    a = ap.parse_args()
    if a.salida: SALIDA = os.path.abspath(a.salida)
    antes = huellas()
    total = 0
    print('COEX Azul (independiente de la regresión CONFPMG04; sin línea base de píxeles)')
    try:
        plantilla = cr.componer(os.path.join(SALIDA, 'HM-Template.composed.html'))
        total += len(verificar(plantilla))
    except (hp.ErrorRegeneracion, hp.FueraDePagina) as e:
        print('ERROR DE REGENERACIÓN/MEDICIÓN: %s | FALLA (1)' % e); total += 1
    if huellas() != antes:
        print('ERROR: cambió la entrada o la referencia histórica de CONFPMG04'); total += 1
    else:
        print('Entrada y referencia históricas de CONFPMG04: sin cambios')
    print('\nRESULTADO:', 'OK' if not total else 'FALLA (%d)' % total)
    sys.exit(1 if total else 0)
