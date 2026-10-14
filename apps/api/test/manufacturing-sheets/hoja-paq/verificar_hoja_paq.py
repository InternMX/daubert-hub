"""Verificación de HOJA_PAQ (HP-1: encabezado, datos generales, tipo de hoja, Medidas sin fuelles y peso).
No hay línea base validada: no se compara píxel a píxel.

Uso:  python verificar_hoja_paq.py [--datos RUTA.json ...]     # por defecto, todos los datos/*.datos.json
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
PERFIL = os.path.join(MS, 'profiles', 'hoja-paq.profile.json')
FUENTE = os.path.join(MS, 'templates', 'hoja-paq', 'hoja-paq.template.html')
COMPOSITOR = os.path.join(MS, 'tools', 'compose-template.mjs')
SALIDA = os.path.join(AQUI, 'test-results')
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
CHROME_FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer']
sin_comentarios = lambda t: re.sub(r'/\*.*?\*/|<!--.*?-->', '', t, flags=re.S)
LIMITE_Y = 792 - 0.55 * 72                    # margen inferior de 0.55 in
ANCHO_BLOQUE = 400.4
PRESUPUESTO_HP2 = 340.0                       # Dibujo Hoja + Dibujo de rollo + Etiqueta + firmas (estimado a partir de BOLSA_FUELLE)
PRESUPUESTO_HP2_EXTENSO = 280.0               # peor caso de textos largos: HP-2 deberá compactar sus dibujos
ETIQUETAS = ['Cliente:', 'Fecha:', 'Resina VCI:', 'Producto:', 'Color:', 'Código DCMX:', 'Descripción:', 'Composición:', 'PMG', 'CP5000', 'Natural',
             'Presentación:', 'Rollo', 'Paquete', 'Cantidad Por Rollo o Paquete:', 'Hoja:', 'Doblada', 'Extendida', 'Medidas:',
             'Unidad de Medidas:', 'Ancho:', 'Largo:', 'Calibre:', 'PESO BOLSA LB:']
PROHIBIDAS = ['Fuelle', 'Capa', 'Dibujo', 'Etiqueta', 'Elaboró', 'Aprobó']     # fuera de HP-1
SECCIONES = ['encabezado', 'seccion-datos-generales', 'seccion-tipo-hoja', 'seccion-medidas', 'seccion-peso']
TABLAS = SECCIONES[1:]
MARCAS = ['comp_pmg', 'comp_cp5000', 'comp_natural', 'pres_rollo', 'pres_paquete', 'hoja_doblada', 'hoja_extendida']

JS_SONDA = r'''<script>
addEventListener("load", function () {
  var hj = document.querySelector(".hoja").getBoundingClientRect(), o = {};
  function m(k, e) { if (!e) return; var r = e.getBoundingClientRect();
    o[k] = [+(.75*(r.left-hj.left)).toFixed(2), +(.75*(r.top-hj.top)).toFixed(2), +(.75*(r.right-hj.left)).toFixed(2), +(.75*(r.bottom-hj.top)).toFixed(2)]; }
  var tablas = %TABLAS%;
  tablas.concat(%MARCAS%).forEach(function (id) { m(id, document.getElementById(id)); });
  m("encabezado", document.querySelector(".encabezado"));
  tablas.forEach(function (id) { var t = document.querySelector("#" + id + " table"); if (t) m(id + "-tabla", t); });
  var pre = document.createElement("pre"); pre.id = "out"; pre.textContent = JSON.stringify(o); document.body.appendChild(pre);
});
</script></body>'''.replace('%TABLAS%', json.dumps(TABLAS)).replace('%MARCAS%', json.dumps(MARCAS))


def verificar(datos_ruta, perfil):
    fallos = []
    datos = json.load(open(datos_ruta, encoding='utf-8'))
    caso = datos['caso']
    if not (datos['formato'] == perfil['formato'] == 'HOJA_PAQ'): fallos.append('el formato no es HOJA_PAQ')
    carpeta = os.path.join(SALIDA, caso); os.makedirs(os.path.join(carpeta, 'images'))
    shutil.copy(os.path.join(MS, 'templates', 'hoja-paq', 'images', 'DC_logo.jpg'), os.path.join(carpeta, 'images', 'DC_logo.jpg'))
    compuesta = os.path.join(carpeta, 'hoja-paq.composed.html')
    subprocess.run(['node', COMPOSITOR, '--source', FUENTE, '--out', compuesta], capture_output=True, text=True, check=True)
    h = open(compuesta, encoding='utf-8').read()
    # 1. composición y placeholders: plantilla = perfil = datos; sin fuelles ni capas
    plantilla_ph = set(re.findall(r'\{\{([^}]+)\}\}', sin_comentarios(h)))
    perfil_ph = set(sum(perfil['placeholders'].values(), []))
    dados = set(datos['datos'])
    for nombre, a, b in (('plantilla vs perfil', plantilla_ph, perfil_ph), ('plantilla vs datos', plantilla_ph, dados)):
        if a != b: fallos.append('%s: sin dato %s / sin placeholder %s' % (nombre, sorted(a - b), sorted(b - a)))
    if any('fuelle' in p or p.startswith('capa') for p in plantilla_ph): fallos.append('la plantilla contiene placeholders de fuelles o capas')
    if '@{' in h: fallos.append('parámetros de inclusión sin resolver')
    for k, v in datos['datos'].items(): h = h.replace('{{%s}}' % k, html.escape(str(v), quote=True))
    pendientes = len(re.findall(r'\{\{|\}\}', sin_comentarios(h)))
    if pendientes: fallos.append('placeholders pendientes: %d' % pendientes)
    ruta_html = os.path.join(carpeta, 'hoja-paq.html'); ruta_pdf = os.path.join(carpeta, 'hoja-paq.pdf')
    open(ruta_html, 'w', encoding='utf-8-sig', newline='\n').write(h)
    subprocess.run([CHROME] + CHROME_FLAGS + ['--print-to-pdf=' + ruta_pdf, 'file:///' + ruta_html.replace('\\', '/')], capture_output=True, check=True)
    # 2. página carta
    pdf = fitz.open(ruta_pdf); pg = pdf[0]
    if len(pdf) != 1: fallos.append('páginas: %d (se esperaba 1)' % len(pdf))
    if (pg.rect.width, pg.rect.height) != (612.0, 792.0): fallos.append('tamaño de página %s' % pg.rect)
    palabras = pg.get_text('words')
    texto = ' '.join(' '.join(w[4] for w in palabras).split())
    # 3. DOM
    sonda = ruta_html.replace('.html', '.sonda.html')
    open(sonda, 'w', encoding='utf-8-sig', newline='\n').write(open(ruta_html, encoding='utf-8-sig').read().replace('</body>', JS_SONDA))
    dom = subprocess.run([CHROME, '--headless', '--disable-gpu', '--window-size=1000,2400', '--dump-dom', 'file:///' + sonda.replace('\\', '/')],
                         capture_output=True, text=True, encoding='utf-8').stdout
    os.remove(sonda)
    geo = json.loads(html.unescape(re.search(r'<pre id="out">(.*?)</pre>', dom, re.S).group(1)))
    # 4. etiquetas, valores y campos característicos
    for e in ETIQUETAS:
        if e not in texto: fallos.append('falta la etiqueta %r' % e)
    for p in PROHIBIDAS:
        if p in texto: fallos.append('texto fuera de HP-1: %r' % p)
    for k, v in datos['datos'].items():
        if k != 'sufijo_titulo' and ' '.join(str(v).split()) not in texto: fallos.append('falta el valor de %s' % k)
    if not ('Hoja de Instrucción de' in texto and 'Manufactura' in texto): fallos.append('falta el título')
    if 'COEXTRUSI' in texto.upper(): fallos.append('el título no debe llevar COEXTRUSIÓN')
    # 5. orden, solapes y límites
    previo = None
    for s in SECCIONES:
        r = geo.get(s)
        if r is None: fallos.append('falta la sección %s' % s); continue
        if previo and r[1] < previo[1][3] - 1.5: fallos.append('la sección %s se solapa con %s' % (s, previo[0]))
        if r[0] < 0 or r[2] > 612 or r[3] > LIMITE_Y + 0.5: fallos.append('la sección %s sale del área imprimible: %s' % (s, r))
        previo = (s, r)
    for i, a in enumerate(palabras):
        for b in palabras[i + 1:]:
            ix, iy = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
            if ix > 0.8 and iy > 2: fallos.append('superposición de texto: %r y %r' % (a[4], b[4]))
    # 6. centrado: las tablas miden 400.4 pt y los márgenes izquierdo y derecho son iguales (DOM y píxeles del PDF)
    for s in TABLAS:
        t = geo[s + '-tabla']
        if s == 'seccion-peso':      # la fila de peso es más angosta por diseño (B:F): arranca en el borde izquierdo del bloque
            if abs(t[0] - (612 - ANCHO_BLOQUE) / 2) > 0.2: fallos.append('la fila de peso no arranca en el borde del bloque: %.2f pt' % t[0])
            continue
        if abs((t[2] - t[0]) - ANCHO_BLOQUE) > 0.2: fallos.append('ancho de %s: %.2f pt' % (s, t[2] - t[0]))
        if abs(t[0] - (612 - t[2])) > 0.2: fallos.append('%s no está centrada: izq %.2f / der %.2f' % (s, t[0], 612 - t[2]))
    escala = 2
    pix = pg.get_pixmap(dpi=72 * escala); pix.save(os.path.join(carpeta, 'hoja-paq.png'))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    y0, y1 = int(geo['seccion-datos-generales'][1] * escala), int(geo['seccion-peso'][3] * escala)
    cols = np.where((img[y0:y1] < 245).any(axis=2).any(axis=0))[0]
    izq, der = cols.min() / escala, 612 - (cols.max() + 1) / escala
    if abs(izq - der) > 1.0: fallos.append('PDF descentrado: margen izquierdo %.1f / derecho %.1f pt' % (izq, der))
    # 7. X y NA dinámicos: solo las marcas con X se imprimen en amarillo
    px = lambda x, y: tuple(int(v) for v in img[int(y * escala), int(x * escala)])
    for m in MARCAS:
        r = geo[m]; c = px(r[0] + 3, (r[1] + r[3]) / 2)
        amarillo = all(abs(a - b) <= 2 for a, b in zip(c, (255, 255, 0)))
        if amarillo != (datos['datos'][m] == 'X'): fallos.append('la marca %s=%s se imprime %s' % (m, datos['datos'][m], c))
    # 8. presupuesto vertical para HP-2 (el caso de descripción extensa es el peor caso: solo debe caber en la página)
    fin = geo['seccion-peso'][3]
    minimo = PRESUPUESTO_HP2_EXTENSO if caso == 'descripcion-extensa' else PRESUPUESTO_HP2
    if LIMITE_Y - fin < minimo: fallos.append('solo quedan %.1f pt para HP-2 (se reservan %.0f)' % (LIMITE_Y - fin, minimo))
    print('%-20s págs %d | pend. %d | márgenes PDF %.1f / %.1f pt | tablas x %.1f-%.1f | parte superior hasta y %.1f | libre para HP-2 %.1f pt | %s' % (
        caso, len(pdf), pendientes, izq, der, geo['seccion-medidas-tabla'][0], geo['seccion-medidas-tabla'][2], fin, LIMITE_Y - fin,
        'OK' if not fallos else 'FALLA (%d)' % len(fallos)))
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
