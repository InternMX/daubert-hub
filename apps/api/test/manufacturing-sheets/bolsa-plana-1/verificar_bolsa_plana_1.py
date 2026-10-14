"""Verificación de BOLSA_PLANA_1 (BP-1: hasta Peso lb; BP-2: hoja completa con Dibujo Hoja, Etiqueta, bolsa plana con sello, nota y firmas).
La etapa se toma del perfil. No hay línea base validada: no se compara píxel a píxel.

Uso:  python verificar_bolsa_plana_1.py [--datos RUTA.json ...]     # por defecto, todos los datos/*.datos.json
Requiere: Node, Google Chrome (headless), PyMuPDF y numpy (CHROME_PATH si Chrome no está en la ruta por defecto).
Escribe en test-results/<caso>/ (ignorado por Git): HTML, PDF y PNG. Código de salida 0 = OK, 1 = falla.
"""
import argparse, glob, html, json, os, re, shutil, subprocess, sys
import fitz
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.abspath(os.path.join(AQUI, '..', '..', '..'))
MS = os.path.join(API, 'src', 'manufacturing-sheets')
PERFIL = os.path.join(MS, 'profiles', 'bolsa-plana-1.profile.json')
FUENTE = os.path.join(MS, 'templates', 'bolsa-plana-1', 'bolsa-plana-1.template.html')
COMPOSITOR = os.path.join(MS, 'tools', 'compose-template.mjs')
SALIDA = os.path.join(AQUI, 'test-results')
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
CHROME_FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer']
sin_comentarios = lambda t: re.sub(r'/\*.*?\*/|<!--.*?-->', '', t, flags=re.S)
RE_HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
BLOQUES_PERMITIDOS = {'<span class="sin-firma">SIN FIRMA</span>'}               # pruebas: solo marcadores, nunca firmas reales
LIMITE_Y = 792 - 0.55 * 72                    # margen inferior de 0.55 in
ANCHO_BLOQUE = 400.4
IZQ_BLOQUE = (612 - ANCHO_BLOQUE) / 2
HOLGURA_MINIMA = 20.0                         # espacio libre mínimo al final de la página, también con textos extensos (BP-2)
NOTA = 'Notas: En caso de que se fabrique con sello de fondo, considerar la altura total de la bolsa a partir del sello de fondo'
ETIQUETAS_BP1 = ['Cliente:', 'Fecha:', 'Resina VCI:', 'Producto:', 'Color:', 'Código DCMX:', 'Descripción:', 'Composición:', 'PMG', 'CP5000', 'Natural',
                 'Presentación:', 'Rollo', 'Paquete', 'Cantidad Por Rollo o Paquete:', 'Medidas:', 'Unidad de Medidas:', 'Ancho:', 'Largo:', 'Calibre:', 'Peso lb:']
ETIQUETAS_BP2 = ['Dibujo Hoja', 'Etiqueta:']
PROHIBIDAS = ['Fuelle', 'Capa', 'Doblada', 'Extendida', 'Dibujo de rollo', 'rollo doblado', 'Dibujo Bolsa', 'PESO']   # no pertenecen a BOLSA_PLANA_1
SEC_BP1 = ['encabezado', 'seccion-datos-generales', 'seccion-medidas', 'seccion-peso']
SEC_BP2 = ['encabezado-dibujo-hoja', 'seccion-etiqueta', 'seccion-dibujo-bolsa', 'seccion-nota', 'seccion-firmas']
TABLAS_BP1 = SEC_BP1[1:]
TABLAS_BP2 = ['encabezado-dibujo-hoja', 'seccion-etiqueta', 'seccion-nota']
MARCAS = ['comp_pmg', 'comp_cp5000', 'comp_natural', 'pres_rollo', 'pres_paquete']
OTROS = ['etiqueta', 'firma_elaboro', 'firma_aprobo']


def sonda_js(ids):
    return r'''<script>
addEventListener("load", function () {
  var hj = document.querySelector(".hoja").getBoundingClientRect(), o = {};
  function m(k, e) { if (!e) return; var r = e.getBoundingClientRect();
    o[k] = [+(.75*(r.left-hj.left)).toFixed(2), +(.75*(r.top-hj.top)).toFixed(2), +(.75*(r.right-hj.left)).toFixed(2), +(.75*(r.bottom-hj.top)).toFixed(2)]; }
  var ids = %IDS%;
  ids.concat(%MARCAS%, %OTROS%).forEach(function (id) { m(id, document.getElementById(id)); });
  m("encabezado", document.querySelector(".encabezado"));
  ids.forEach(function (id) { var t = document.querySelector("#" + id + " table"); if (t) m(id + "-tabla", t); });
  var pre = document.createElement("pre"); pre.id = "out"; pre.textContent = JSON.stringify(o); document.body.appendChild(pre);
});
</script></body>'''.replace('%IDS%', json.dumps(ids)).replace('%MARCAS%', json.dumps(MARCAS)).replace('%OTROS%', json.dumps(OTROS))


def dentro(palabras, r, tol=1):
    return [w for w in palabras if r[0] - tol <= w[0] and w[2] <= r[2] + tol and r[1] - tol <= w[1] and w[3] <= r[3] + tol]


def verificar(datos_ruta, perfil):
    fallos = []
    bp2 = perfil['etapa'] != 'BP-1'
    secciones = SEC_BP1 + (SEC_BP2 if bp2 else [])
    tablas = TABLAS_BP1 + (TABLAS_BP2 if bp2 else [])
    datos = json.load(open(datos_ruta, encoding='utf-8'))
    caso = datos['caso']
    if not (datos['formato'] == perfil['formato'] == 'BOLSA_PLANA_1'): fallos.append('el formato no es BOLSA_PLANA_1')
    carpeta = os.path.join(SALIDA, caso); os.makedirs(os.path.join(carpeta, 'images'))
    shutil.copy(os.path.join(MS, 'templates', 'bolsa-plana-1', 'images', 'DC_logo.jpg'), os.path.join(carpeta, 'images', 'DC_logo.jpg'))
    compuesta = os.path.join(carpeta, 'bolsa-plana-1.composed.html')
    subprocess.run(['node', COMPOSITOR, '--source', FUENTE, '--out', compuesta], capture_output=True, text=True, check=True)
    h = open(compuesta, encoding='utf-8').read()
    sc = sin_comentarios(h)
    # 1. placeholders: plantilla = perfil = datos; sin elementos ajenos al formato
    plantilla_ph = set(re.findall(r'\{\{([^}]+)\}\}', sc))
    perfil_ph = set(sum(perfil['placeholders'].values(), []))
    dados = set(datos['datos']) | set(datos['visual']) | set(datos['firmas'])
    if not bp2: dados -= {'etiqueta', 'color_bolsa_hex', 'bloque_firma_elaboro', 'bloque_firma_aprobo'}
    for nombre, a, b in (('plantilla vs perfil', plantilla_ph, perfil_ph), ('plantilla vs datos', plantilla_ph, dados)):
        if a != b: fallos.append('%s: sin dato %s / sin placeholder %s' % (nombre, sorted(a - b), sorted(b - a)))
    if any('fuelle' in p or p.startswith('capa') or p.startswith('hoja_') or p == 'ancho_rollo' for p in plantilla_ph): fallos.append('placeholders ajenos al formato')
    if '@{' in h: fallos.append('parámetros de inclusión sin resolver')
    for k, v in datos['datos'].items(): h = h.replace('{{%s}}' % k, html.escape(str(v), quote=True))
    for k, v in datos['visual'].items():
        if not RE_HEX.match(v): fallos.append('color inválido %s' % k)
        h = h.replace('{{%s}}' % k, v)
    for k, v in datos['firmas'].items():
        if v not in BLOQUES_PERMITIDOS: fallos.append('bloque de firma no permitido en pruebas: %s' % k)
        h = h.replace('{{%s}}' % k, v)
    pendientes = len(re.findall(r'\{\{|\}\}', sin_comentarios(h)))
    if pendientes: fallos.append('placeholders pendientes: %d' % pendientes)
    if bp2:
        if 'class="sello-fondo"' not in sc: fallos.append('el dibujo no tiene la línea del sello de fondo')
        if 'class="rollo' in sc or 'curva' in sc or 'doblado' in sc: fallos.append('el dibujo contiene elementos de otros formatos')
    ruta_html = os.path.join(carpeta, 'bolsa-plana-1.html'); ruta_pdf = os.path.join(carpeta, 'bolsa-plana-1.pdf')
    open(ruta_html, 'w', encoding='utf-8-sig', newline='\n').write(h)
    subprocess.run([CHROME] + CHROME_FLAGS + ['--print-to-pdf=' + ruta_pdf, 'file:///' + ruta_html.replace('\\', '/')], capture_output=True, check=True)
    # 2. página carta
    pdf = fitz.open(ruta_pdf); pg = pdf[0]
    if len(pdf) != 1: fallos.append('páginas: %d (se esperaba 1)' % len(pdf))
    if (pg.rect.width, pg.rect.height) != (612.0, 792.0): fallos.append('tamaño de página %s' % pg.rect)
    palabras = pg.get_text('words')
    texto = ' '.join(' '.join(w[4] for w in palabras).split())
    # 3. DOM
    ids = [s for s in secciones if s != 'encabezado']
    sonda = ruta_html.replace('.html', '.sonda.html')
    open(sonda, 'w', encoding='utf-8-sig', newline='\n').write(open(ruta_html, encoding='utf-8-sig').read().replace('</body>', sonda_js(ids)))
    dom = subprocess.run([CHROME, '--headless', '--disable-gpu', '--window-size=1000,2400', '--dump-dom', 'file:///' + sonda.replace('\\', '/')],
                         capture_output=True, text=True, encoding='utf-8').stdout
    os.remove(sonda)
    geo = json.loads(html.unescape(re.search(r'<pre id="out">(.*?)</pre>', dom, re.S).group(1)))
    # 4. etiquetas, valores y nota
    for e in ETIQUETAS_BP1 + (ETIQUETAS_BP2 if bp2 else []):
        if e not in texto: fallos.append('falta la etiqueta %r' % e)
    for p in PROHIBIDAS:
        if p in texto: fallos.append('texto que no pertenece a BOLSA_PLANA_1: %r' % p)
    omitidos = {'sufijo_titulo'} | (set() if bp2 else {'etiqueta'})
    for k, v in datos['datos'].items():
        if k not in omitidos and ' '.join(str(v).split()) not in texto: fallos.append('falta el valor de %s' % k)
    if bp2 and NOTA not in texto: fallos.append('la nota de manufactura no aparece completa')
    if not ('Hoja de Instrucción de' in texto and 'Manufactura' in texto): fallos.append('falta el título')
    if 'COEXTRUSI' in texto.upper(): fallos.append('el título no debe llevar COEXTRUSIÓN')
    # 5. orden vertical, solapes y límites
    previo = None
    for s in secciones:
        r = geo.get(s)
        if r is None: fallos.append('falta la sección %s' % s); continue
        if previo and r[1] < previo[1][3] - 1.5: fallos.append('la sección %s se solapa con %s (%.1f < %.1f)' % (s, previo[0], r[1], previo[1][3]))
        if r[0] < 0 or r[2] > 612 or r[3] > LIMITE_Y + 0.5: fallos.append('la sección %s sale del área imprimible: %s' % (s, r))
        previo = (s, r)
    for i, a in enumerate(palabras):
        for b in palabras[i + 1:]:
            ix, iy = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
            if ix > 0.8 and iy > 2: fallos.append('superposición de texto: %r y %r' % (a[4], b[4]))
        if a[0] < IZQ_BLOQUE - 1 or a[2] > IZQ_BLOQUE + ANCHO_BLOQUE + 1 or a[1] < 39 or a[3] > LIMITE_Y: fallos.append('texto fuera del bloque o del área imprimible: %r' % a[4])
    # 6. centrado
    for s in tablas:
        t = geo.get(s + '-tabla')
        if t is None: fallos.append('falta la tabla %s' % s); continue
        if s == 'seccion-peso':      # la fila de peso es más angosta por diseño (B:F): arranca en el borde izquierdo del bloque
            if abs(t[0] - IZQ_BLOQUE) > 0.2: fallos.append('la fila de peso no arranca en el borde del bloque: %.2f pt' % t[0])
            continue
        if abs((t[2] - t[0]) - ANCHO_BLOQUE) > 0.2: fallos.append('ancho de %s: %.2f pt' % (s, t[2] - t[0]))
        if abs(t[0] - (612 - t[2])) > 0.2: fallos.append('%s no está centrada: izq %.2f / der %.2f' % (s, t[0], 612 - t[2]))
    if bp2:
        r = geo['seccion-dibujo-bolsa']
        if abs((r[2] - r[0]) - ANCHO_BLOQUE) > 0.2 or abs(r[0] - IZQ_BLOQUE) > 0.2: fallos.append('el dibujo no coincide con el bloque centrado: %s' % (r,))
    escala = 2
    pix = pg.get_pixmap(dpi=72 * escala); pix.save(os.path.join(carpeta, 'bolsa-plana-1.png'))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    ultimo = 'seccion-firmas' if bp2 else 'seccion-peso'
    y0, y1 = int(geo['seccion-datos-generales'][1] * escala), int(geo['seccion-nota' if bp2 else 'seccion-peso'][3] * escala)
    cols = np.where((img[y0:y1] < 245).any(axis=2).any(axis=0))[0]
    izq, der = cols.min() / escala, 612 - (cols.max() + 1) / escala
    if abs(izq - der) > 1.0: fallos.append('PDF descentrado: margen izquierdo %.1f / derecho %.1f pt' % (izq, der))
    px = lambda x, y: tuple(int(v) for v in img[int(y * escala), int(x * escala)])
    cerca = lambda a, b, t=2: all(abs(x - y) <= t for x, y in zip(a, b))
    hexrgb = lambda c: tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
    # 7. X y NA dinámicos
    for m in MARCAS:
        r = geo[m]
        if cerca(px(r[0] + 3, (r[1] + r[3]) / 2), (255, 255, 0)) != (datos['datos'][m] == 'X'): fallos.append('la marca %s=%s no se imprime con su color' % (m, datos['datos'][m]))
    fin = geo[ultimo][3]
    detalle = ''
    if bp2:
        # 8. Etiqueta rosa y completa; dibujo con cotas, color y línea de sello; nota amarilla
        ex0, ey0, ex1, ey1 = geo['etiqueta']
        if not cerca(px(ex0 + 5, (ey0 + ey1) / 2), (218, 150, 148)): fallos.append('Etiqueta no es rosa #DA9694')
        if len(' '.join(str(datos['datos']['etiqueta']).split()).split()) + 1 > len(dentro(palabras, geo['etiqueta'], 2)): fallos.append('la etiqueta tiene palabras fuera de su celda')
        dx0, dy0, dx1, dy1 = geo['seccion-dibujo-bolsa']
        th = ' '.join(w[4] for w in sorted(dentro(palabras, geo['seccion-dibujo-bolsa']), key=lambda w: (round(w[1]), w[0])))
        for k in ('ancho', 'largo'):
            if ' '.join(str(datos['datos'][k]).split()) not in th: fallos.append('el dibujo no muestra %s (%s)' % (k, datos['datos'][k]))
        color = hexrgb(datos['visual']['color_bolsa_hex'])
        if not cerca(px(dx0 + 200, dy0 + 55), color): fallos.append('relleno de la bolsa %s != %s' % (px(dx0 + 200, dy0 + 55), datos['visual']['color_bolsa_hex']))
        # línea del sello: una fila oscura dentro de la bolsa, cerca del borde inferior, y relleno de color por debajo de ella
        col = [px(dx0 + 200, dy0 + 23 + k * 0.5) for k in range(0, 2 * 95)]
        oscuros = [k for k, c in enumerate(col) if max(c) < 90]
        if not oscuros: fallos.append('no se imprime la línea del sello de fondo')
        else:
            y_sello = 23 + oscuros[-1] / 2 if False else 23 + (oscuros[-2] if len(oscuros) > 1 else oscuros[-1]) * 0.5
            if not (95 - 22 <= y_sello - 23 <= 95 - 4): fallos.append('la línea del sello no está cerca del borde inferior (a %.1f pt del borde)' % (118 - y_sello))
        nota = geo['seccion-nota']
        if not cerca(px(nota[0] + 5, (nota[1] + nota[3]) / 2), (255, 255, 0)): fallos.append('la nota no es amarilla')
        f1, f2 = geo['firma_elaboro'], geo['firma_aprobo']
        for nombre, r in (('firma_elaboro', f1), ('firma_aprobo', f2)):
            if len(dentro([w for w in palabras if w[4] in ('SIN', 'FIRMA')], r)) != 2: fallos.append('el contenedor %s no contiene el marcador SIN FIRMA' % nombre)
            if abs((r[2] - r[0]) - 105) > 0.2 or abs((r[3] - r[1]) - 70) > 0.2: fallos.append('tamaño de %s: %.1f x %.1f pt' % (nombre, r[2] - r[0], r[3] - r[1]))
        if f1[2] >= f2[0]: fallos.append('las zonas de firma se tocan o se superponen')
        if abs((f1[0] + f1[2]) / 2 + (f2[0] + f2[2]) / 2 - 2 * (IZQ_BLOQUE + ANCHO_BLOQUE / 2)) > 0.5: fallos.append('las firmas no son simétricas respecto al bloque')
        if LIMITE_Y - fin < HOLGURA_MINIMA: fallos.append('holgura vertical de %.1f pt (mínimo %.0f pt)' % (LIMITE_Y - fin, HOLGURA_MINIMA))
        detalle = ' | dibujo y %.1f-%.1f | nota y %.1f-%.1f | firmas y %.1f-%.1f' % (dy0, dy1, nota[1], nota[3], geo['seccion-firmas'][1], fin)
    if fin > LIMITE_Y: fallos.append('el contenido excede el área imprimible (%.1f > %.1f)' % (fin, LIMITE_Y))
    print('%-26s págs %d | pend. %d | márgenes %.1f/%.1f | peso y %.1f-%.1f%s | libre %.1f pt | %s' % (
        caso, len(pdf), pendientes, izq, der, geo['seccion-peso'][1], geo['seccion-peso'][3], detalle, LIMITE_Y - fin, 'OK' if not fallos else 'FALLA (%d)' % len(fallos)))
    for f in fallos[:15]: print('   -', f)
    return fallos


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--datos', nargs='*')
    a = ap.parse_args()
    perfil = json.load(open(PERFIL, encoding='utf-8'))
    shutil.rmtree(SALIDA, ignore_errors=True)
    archivos = a.datos or sorted(glob.glob(os.path.join(AQUI, 'datos', '*.datos.json')))
    print('Formato:', perfil['formato'], '| etapa', perfil['etapa'], '| casos:', len(archivos))
    total = sum(len(verificar(f, perfil)) for f in archivos)
    print('\nRESULTADO:', 'OK' if not total else 'FALLA (%d)' % total)
    sys.exit(1 if total else 0)
