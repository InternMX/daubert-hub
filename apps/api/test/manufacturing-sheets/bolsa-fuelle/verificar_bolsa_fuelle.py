"""Verificación de BOLSA_FUELLE (BF-2: hoja completa). No es una regresión píxel a píxel: aún no hay línea base validada.

Uso:  python verificar_bolsa_fuelle.py [--datos RUTA.json ...] [--salida CARPETA]     # por defecto, todos los datos/*.datos.json
Requiere: Node, Google Chrome (headless), PyMuPDF y numpy (CHROME_PATH si Chrome no está en la ruta por defecto).
Escribe en test-results/<caso>/ (ignorado por Git): HTML, PDF y PNG. Código de salida 0 = OK, 1 = falla.
"""
import argparse, glob, html, json, os, re, shutil, subprocess, sys
import fitz
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import hoja_pruebas as hp
AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.abspath(os.path.join(AQUI, '..', '..', '..'))                      # apps/api
MS = os.path.join(API, 'src', 'manufacturing-sheets')
PERFIL = os.path.join(MS, 'profiles', 'bolsa-fuelle.profile.json')
FUENTE = os.path.join(MS, 'templates', 'bolsa-fuelle', 'bolsa-fuelle.template.html')
COMPOSITOR = os.path.join(MS, 'tools', 'compose-template.mjs')
SALIDA = os.path.join(AQUI, 'test-results')
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
CHROME_FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer']
sin_comentarios = lambda t: re.sub(r'/\*.*?\*/|<!--.*?-->', '', t, flags=re.S)
RE_HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
BLOQUES_PERMITIDOS = {'<span class="sin-firma">SIN FIRMA</span>'}               # pruebas: solo marcadores, nunca firmas reales
LIMITE_Y = 792 - 0.55 * 72                                                       # margen inferior de 0.55 in
NOTA = 'Notas: Considerar la altura total de la bolsa a partir del sello'
ETIQUETAS = ['Cliente:', 'Fecha:', 'Resina VCI:', 'Producto:', 'Color:', 'Código DCMX:', 'Descripción:', 'Composición:', 'PMG', 'CP5000', 'Natural',
             'Presentación:', 'Rollo', 'Paquete', 'Cantidad Por Rollo o Paquete:', 'Medidas:', 'Unidad de Medidas:', 'Ancho:', 'Fuelle Derecho',
             'Largo:', 'Fuelle Izquierdo', 'Calibre:', 'PESO LB:', 'Dibujo Bolsa', 'Etiqueta:']
SECCIONES = ['encabezado', 'seccion-datos-generales', 'seccion-medidas', 'seccion-peso', 'seccion-etiqueta', 'seccion-dibujo-bolsa', 'seccion-nota', 'seccion-firmas']

JS_SONDA = r'''<script>
addEventListener("load", function () {
  var hj = document.querySelector(".hoja").getBoundingClientRect(), o = {};
  function m(k, e) { if (!e) return; var r = e.getBoundingClientRect();
    o[k] = [+(.75*(r.left-hj.left)).toFixed(2), +(.75*(r.top-hj.top)).toFixed(2), +(.75*(r.right-hj.left)).toFixed(2), +(.75*(r.bottom-hj.top)).toFixed(2)]; }
  ["seccion-datos-generales","seccion-medidas","seccion-peso","seccion-etiqueta","seccion-dibujo-bolsa","seccion-nota","seccion-firmas","etiqueta","firma_elaboro","firma_aprobo"]
    .forEach(function (id) { m(id, document.getElementById(id)); });
  m("encabezado", document.querySelector(".encabezado"));
  var pre = document.createElement("pre"); pre.id = "out"; pre.textContent = JSON.stringify(o); document.body.appendChild(pre);
});
</script></body>'''


def centro(r): return ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)


def verificar(datos_ruta, perfil):
    fallos = []
    datos = json.load(open(datos_ruta, encoding='utf-8'))
    caso = datos['caso']
    esperado = datos.get('esperado', 'valido')                 # valido (producción) | estres (texto extremo: si no cabe se reporta el límite)
    if not (datos['formato'] == perfil['formato'] == 'BOLSA_FUELLE'): fallos.append('el formato no es BOLSA_FUELLE')
    carpeta = os.path.join(SALIDA, caso); hp.preparar_carpeta(carpeta)
    shutil.copy(os.path.join(MS, 'templates', 'bolsa-fuelle', 'images', 'DC_logo.jpg'), os.path.join(carpeta, 'images', 'DC_logo.jpg'))
    compuesta = os.path.join(carpeta, 'bolsa-fuelle.composed.html')
    subprocess.run(['node', COMPOSITOR, '--source', FUENTE, '--out', compuesta], capture_output=True, text=True, check=True)
    h = open(compuesta, encoding='utf-8').read()
    # 1. placeholders: plantilla = perfil = datos
    plantilla_ph = set(re.findall(r'\{\{([^}]+)\}\}', sin_comentarios(h)))
    perfil_ph = set(sum(perfil['placeholders'].values(), []))
    dados = set(datos['datos']) | set(datos['visual']) | set(datos['firmas'])
    for nombre, a, b in (('plantilla vs perfil', plantilla_ph, perfil_ph), ('plantilla vs datos', plantilla_ph, dados)):
        if a != b: fallos.append('%s: sin dato %s / sin placeholder %s' % (nombre, sorted(a - b), sorted(b - a)))
    # 2. sustitución: texto escapado, colores #RRGGBB, bloques de firma solo SIN FIRMA
    for k, v in datos['datos'].items(): h = h.replace('{{%s}}' % k, html.escape(str(v), quote=True))
    for k, v in datos['visual'].items():
        if not RE_HEX.match(v): fallos.append('color inválido %s' % k)
        h = h.replace('{{%s}}' % k, v)
    for k, v in datos['firmas'].items():
        if v not in BLOQUES_PERMITIDOS: fallos.append('bloque de firma no permitido en pruebas: %s' % k)
        h = h.replace('{{%s}}' % k, v)
    pendientes = len(re.findall(r'\{\{|\}\}', sin_comentarios(h)))
    if pendientes: fallos.append('placeholders pendientes: %d' % pendientes)
    ruta_html = os.path.join(carpeta, 'bolsa-fuelle.html'); ruta_pdf = os.path.join(carpeta, 'bolsa-fuelle.pdf')
    open(ruta_html, 'w', encoding='utf-8-sig', newline='\n').write(h)
    hp.imprimir_pdf(CHROME, CHROME_FLAGS, ruta_html, ruta_pdf)          # PDF temporal nuevo y validado: nunca se analiza un PDF anterior
    # 3. página
    pdf = fitz.open(ruta_pdf); pg = pdf[0]
    if len(pdf) != 1: fallos.append('páginas: %d (se esperaba 1)' % len(pdf))
    if (pg.rect.width, pg.rect.height) != (612.0, 792.0): fallos.append('tamaño de página %s' % pg.rect)
    palabras = pg.get_text('words')
    texto = ' '.join(hp.texto_de_todas_las_paginas(pdf).split())      # integridad del texto en todas las páginas (si desborda, nada se pierde)
    if datos.get('renglones_descripcion') is not None:           # casos de 1 y 2 renglones: el fixture debe ocupar exactamente esos renglones
        n_reng = hp.contar_renglones_descripcion(palabras)
        if n_reng != datos['renglones_descripcion']: fallos.append('la descripción ocupa %d renglones (se esperaban %d)' % (n_reng, datos['renglones_descripcion']))
    # 4. DOM de las secciones
    sonda = ruta_html.replace('.html', '.sonda.html')
    open(sonda, 'w', encoding='utf-8-sig', newline='\n').write(open(ruta_html, encoding='utf-8-sig').read().replace('</body>', JS_SONDA))
    try: geo = hp.medir_dom(CHROME, sonda)
    finally: os.remove(sonda)
    # 5. campos, etiquetas, nota, firmas
    for e in ETIQUETAS:
        if e not in texto: fallos.append('falta la etiqueta %r' % e)
    for k, v in datos['datos'].items():
        if k != 'sufijo_titulo' and ' '.join(str(v).split()) not in texto: fallos.append('falta el valor de %s' % k)
    if NOTA not in texto: fallos.append('falta la nota de manufactura')
    if not ('Hoja de Instrucción de' in texto and 'Manufactura' in texto): fallos.append('falta el título')
    for blq in ('firma_elaboro', 'firma_aprobo'):
        if blq not in geo: fallos.append('falta el contenedor %s' % blq); continue
        x0, y0, x1, y1 = geo[blq]
        dentro = [w for w in palabras if w[4] in ('SIN', 'FIRMA') and x0 - 1 <= w[0] and w[2] <= x1 + 1 and y0 - 1 <= w[1] and w[3] <= y1 + 1]
        if len(dentro) != 2: fallos.append('el contenedor %s no contiene el marcador SIN FIRMA' % blq)
    # 6. orden de secciones, sin solapes ni salidas de la página
    previo = None
    for s in SECCIONES:
        r = geo.get(s)
        if r is None: fallos.append('falta la sección %s' % s); continue
        if previo and r[1] < previo[1][3] - 1.5: fallos.append('la sección %s se solapa con %s (%.1f < %.1f)' % (s, previo[0], r[1], previo[1][3]))
        if r[0] < 0 or r[2] > 612 or r[3] > LIMITE_Y + 0.5: fallos.append('la sección %s sale del área imprimible: %s' % (s, r))
        previo = (s, r)
    for i, a in enumerate(palabras):
        for b in palabras[i + 1:]:
            ix, iy = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
            if ix > 0.8 and iy > 2: fallos.append('superposición de texto: %r y %r' % (a[4], b[4]))
        if a[0] < 18 or a[2] > 18.5 + 493.4 + 1 or a[1] < 39 or a[3] > LIMITE_Y: fallos.append('texto fuera del área imprimible: %r' % a[4])
    # 7. etiqueta sin recortes: todas sus palabras caben en su celda
    ex0, ey0, ex1, ey1 = geo['etiqueta']
    pal_etiqueta = [w for w in palabras if ey0 - 2 <= w[1] and w[3] <= ey1 + 2 and ex0 - 2 <= w[0] and w[2] <= ex1 + 2]
    if len(' '.join(str(datos['datos']['etiqueta']).split()).split()) + 1 > len(pal_etiqueta): fallos.append('la etiqueta tiene palabras fuera de su celda')
    # 8. dibujo: cotas dentro del contenedor y colores impresos
    dx0, dy0, dx1, dy1 = geo['seccion-dibujo-bolsa']
    for k in ('ancho', 'largo', 'fuelle_izquierdo', 'fuelle_derecho'):
        v = str(datos['datos'][k])
        encontrados = [w for w in palabras if w[4] == v and dx0 <= w[0] and w[2] <= dx1 and dy0 <= w[1] and w[3] <= dy1]
        if not encontrados: fallos.append('la cota %s (%s) no aparece dentro del dibujo' % (k, v))
    escala = 150 / 72
    pix = pg.get_pixmap(dpi=150); hp.guardar_png(pix, os.path.join(carpeta, 'bolsa-fuelle.png'))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    hexrgb = lambda c: tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
    cerca = lambda a, b, t=2: all(abs(x - y) <= t for x, y in zip(a, b))      # el rasterizado puede variar 1-2 niveles por canal
    px = lambda x, y: hp.pixel(img, escala, x, y)             # fuera de la imagen lanza FueraDePagina (nunca un IndexError)
    # Los colores del dibujo, la nota y la etiqueta solo se leen si esas secciones están completas en la 1.ª página; si el contenido desborda
    # (más de una página) no se leen píxeles fuera de la imagen: se informa el desbordamiento y la falla queda como consecuencia del límite.
    todo_en_primera_pagina = all(geo[s][3] <= hp.ALTO_PAGINA for s in ('seccion-etiqueta', 'seccion-dibujo-bolsa', 'seccion-nota'))
    if todo_en_primera_pagina:
        bolsa = px(dx0 + 247, dy0 + 120)                         # centro de la bolsa (coordenadas del SVG)
        if not cerca(bolsa, hexrgb(datos['visual']['color_bolsa_hex'])): fallos.append('relleno de la bolsa %s != %s' % (bolsa, datos['visual']['color_bolsa_hex']))
        if not cerca(px(dx0 + 237, dy0 + 183), (36, 64, 98)): fallos.append('la barra inferior no es azul oscuro: %s' % (px(dx0 + 237, dy0 + 183),))
        cotas = hexrgb(datos['visual']['color_cotas_internas_hex'])
        franja = img[int((dy0 + 49) * escala):int((dy0 + 55) * escala), int((dx0 + 112) * escala):int((dx0 + 216) * escala)]
        n_cotas = int((np.abs(franja - np.array(cotas)).max(axis=2) <= 3).sum())
        if n_cotas < 80: fallos.append('las cotas internas casi no se imprimen (%d px de %s)' % (n_cotas, datos['visual']['color_cotas_internas_hex']))
        nota_y = centro(geo['seccion-nota'])[1]
        if not cerca(px(geo['seccion-nota'][0] + 5, nota_y), (255, 255, 0)): fallos.append('la nota no es amarilla: %s' % (px(geo['seccion-nota'][0] + 5, nota_y),))
        if not cerca(px(ex0 + 5, (ey0 + ey1) / 2), (218, 150, 148)): fallos.append('Etiqueta no es rosa #DA9694: %s' % (px(ex0 + 5, (ey0 + ey1) / 2),))
    else:
        fallos.append('no se verificaron los colores del dibujo, la nota y la etiqueta: quedan fuera de la primera página (%d páginas generadas)' % len(pdf))
    fin_firmas = geo['seccion-firmas'][3]
    fallos += hp.fallos_de_limite(fin_firmas)                 # holgura mínima de 20 pt y área imprimible (criterio común)
    fallos, limites = hp.clasificar_limites(esperado, fallos)
    print('%-26s págs %d | pend. %d | etiqueta %.1f pt | dibujo y %.1f-%.1f | nota y %.1f-%.1f | firmas hasta %.1f pt | libre %.1f pt | %s' % (
        caso, len(pdf), pendientes, geo['seccion-etiqueta'][3] - geo['seccion-etiqueta'][1], dy0, dy1, geo['seccion-nota'][1], geo['seccion-nota'][3],
        fin_firmas, LIMITE_Y - fin_firmas, ('OK' if not fallos else 'FALLA (%d)' % len(fallos)) + hp.informar_limites(carpeta, esperado, limites, len(pdf), fin_firmas)))
    for f in fallos[:15]: print('   -', f)
    return fallos


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--datos', nargs='*')
    ap.add_argument('--salida', help='carpeta de resultados alternativa (por defecto test-results)')
    a = ap.parse_args()
    perfil = json.load(open(PERFIL, encoding='utf-8'))
    if a.salida: SALIDA = os.path.abspath(a.salida)
    archivos = a.datos or sorted(glob.glob(os.path.join(AQUI, 'datos', '*.datos.json')))
    print('Formato:', perfil['formato'], '| etapa', perfil['etapa'], '| casos:', len(archivos))
    total = hp.ejecutar_casos(verificar, archivos, perfil)
    print('\nRESULTADO:', 'OK' if not total else 'FALLA (%d)' % total)
    sys.exit(1 if total else 0)
