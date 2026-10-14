"""Verificación de ROLLO_CONTINUO (RC-1: hasta Peso; RC-2: hoja completa con Etiqueta, Dibujo de hoja, Dibujo de rollo doblado y firmas).
La etapa se toma del perfil. No hay línea base validada: no se compara píxel a píxel.

Uso:  python verificar_rollo_continuo.py [--datos RUTA.json ...]     # por defecto, todos los datos/*.datos.json
Requiere: Node, Google Chrome (headless), PyMuPDF y numpy (CHROME_PATH si Chrome no está en la ruta por defecto).
Escribe en test-results/<caso>/ (ignorado por Git): HTML, PDF y PNG. Código de salida 0 = OK, 1 = falla.

Cada caso declara "esperado":
  valido    → el validador (tools/validate-rollo-continuo-data.mjs) debe aceptarlo; se compone, se imprime y se verifica todo.
  tecnico   → el validador debe RECHAZARLO (no es válido para producción) pero se imprime para probar un componente visual.
  invalido  → el validador debe rechazarlo y NO se imprime nada.
"""
import argparse, glob, html, json, os, re, shutil, subprocess, sys
import fitz
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.abspath(os.path.join(AQUI, '..', '..', '..'))
MS = os.path.join(API, 'src', 'manufacturing-sheets')
PERFIL = os.path.join(MS, 'profiles', 'rollo-continuo.profile.json')
FUENTE = os.path.join(MS, 'templates', 'rollo-continuo', 'rollo-continuo.template.html')
COMPOSITOR = os.path.join(MS, 'tools', 'compose-template.mjs')
VALIDADOR = os.path.join(MS, 'tools', 'validate-rollo-continuo-data.mjs')
SALIDA = os.path.join(AQUI, 'test-results')
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
CHROME_FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer']
sin_comentarios = lambda t: re.sub(r'/\*.*?\*/|<!--.*?-->', '', t, flags=re.S)
RE_HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
BLOQUES_PERMITIDOS = {'<span class="sin-firma">SIN FIRMA</span>'}               # pruebas: solo marcadores, nunca firmas reales
LIMITE_Y = 792 - 0.55 * 72                    # margen inferior de 0.55 in
ANCHO_BLOQUE = 400.4
IZQ_BLOQUE = (612 - ANCHO_BLOQUE) / 2
HOLGURA_MINIMA = 20.0                         # espacio libre mínimo al final de la página, también con textos extensos (RC-2)
ETIQUETAS_RC1 = ['Cliente:', 'Fecha:', 'Resina VCI:', 'Producto:', 'Color:', 'Código DCMX:', 'Descripción:', 'Composición:', 'PMG', 'CP5000', 'Natural',
                 'Presentación:', 'Rollo', 'Paquete', 'Hoja:', 'Doblada', 'Extendida', 'Medidas:', 'Unidad de Medidas:', 'Ancho:', 'Largo:', 'Calibre:', 'Peso lb:']
ETIQUETAS_RC2 = ['Etiqueta:', 'Dibujo de hoja', 'Dibujo de rollo doblado']
PROHIBIDAS = ['Cantidad', 'Fuelle', 'Capa', 'Dibujo Bolsa', 'Dibujo Hoja', 'PESO']                       # no pertenecen a ROLLO_CONTINUO
SEC_RC1 = ['encabezado', 'seccion-datos-generales', 'seccion-tipo-hoja', 'seccion-medidas', 'seccion-peso']
SEC_RC2 = ['seccion-etiqueta', 'encabezado-dibujo-hoja', 'seccion-dibujo-hoja', 'encabezado-dibujo-rollo', 'seccion-dibujo-rollo', 'seccion-firmas']
TABLAS_RC1 = SEC_RC1[1:]
TABLAS_RC2 = ['seccion-etiqueta', 'encabezado-dibujo-hoja', 'encabezado-dibujo-rollo']
DIBUJOS = ['seccion-dibujo-hoja', 'seccion-dibujo-rollo']
MARCAS = ['comp_pmg', 'comp_cp5000', 'comp_natural', 'pres_rollo', 'pres_paquete', 'hoja_doblada', 'hoja_extendida']
OTROS = ['etiqueta', 'firma_elaboro', 'firma_aprobo']


def sonda_js(secciones_ids):
    return r'''<script>
addEventListener("load", function () {
  var hj = document.querySelector(".hoja").getBoundingClientRect(), o = {};
  function m(k, e) { if (!e) return; var r = e.getBoundingClientRect();
    o[k] = [+(.75*(r.left-hj.left)).toFixed(2), +(.75*(r.top-hj.top)).toFixed(2), +(.75*(r.right-hj.left)).toFixed(2), +(.75*(r.bottom-hj.top)).toFixed(2)]; }
  var ids = %IDS%, tablas = %TABLAS%;
  ids.concat(%MARCAS%, %OTROS%).forEach(function (id) { m(id, document.getElementById(id)); });
  m("encabezado", document.querySelector(".encabezado"));
  tablas.forEach(function (id) { var t = document.querySelector("#" + id + " table"); if (t) m(id + "-tabla", t); });
  var pre = document.createElement("pre"); pre.id = "out"; pre.textContent = JSON.stringify(o); document.body.appendChild(pre);
});
</script></body>'''.replace('%IDS%', json.dumps(secciones_ids)).replace('%TABLAS%', json.dumps(secciones_ids)).replace(
        '%MARCAS%', json.dumps(MARCAS)).replace('%OTROS%', json.dumps(OTROS))


def validar(datos_ruta):
    r = subprocess.run(['node', VALIDADOR, datos_ruta], capture_output=True, text=True, encoding='utf-8')
    return r.returncode, (r.stderr or r.stdout).strip()


def dentro(palabras, r, tol=1):
    return [w for w in palabras if r[0] - tol <= w[0] and w[2] <= r[2] + tol and r[1] - tol <= w[1] and w[3] <= r[3] + tol]


def verificar(datos_ruta, perfil):
    fallos = []
    rc2 = perfil['etapa'] != 'RC-1'
    tablas = TABLAS_RC1 + (TABLAS_RC2 if rc2 else [])
    secciones = SEC_RC1 + (SEC_RC2 if rc2 else [])
    datos = json.load(open(datos_ruta, encoding='utf-8'))
    caso, esperado, modalidad = datos['caso'], datos['esperado'], datos['modalidad']
    # 0. contrato: el validador acepta los casos válidos y rechaza los técnicos e inválidos
    codigo, mensaje = validar(datos_ruta)
    if (codigo == 0) != (esperado == 'valido'): fallos.append('el validador %s el caso %s: %s' % ('aceptó' if codigo == 0 else 'rechazó', esperado, mensaje))
    if esperado == 'invalido':
        print('%-36s rechazado por el validador (%s) | %s' % (caso, mensaje.replace('\n', ' ').strip('- ')[:110], 'OK' if not fallos else 'FALLA (%d)' % len(fallos)))
        for f in fallos: print('   -', f)
        return fallos
    if not (datos['formato'] == perfil['formato'] == 'ROLLO_CONTINUO'): fallos.append('el formato no es ROLLO_CONTINUO')
    carpeta = os.path.join(SALIDA, caso); os.makedirs(os.path.join(carpeta, 'images'))
    shutil.copy(os.path.join(MS, 'templates', 'rollo-continuo', 'images', 'DC_logo.jpg'), os.path.join(carpeta, 'images', 'DC_logo.jpg'))
    compuesta = os.path.join(carpeta, 'rollo-continuo.composed.html')
    subprocess.run(['node', COMPOSITOR, '--source', FUENTE, '--out', compuesta], capture_output=True, text=True, check=True)
    h = open(compuesta, encoding='utf-8').read()
    sc = sin_comentarios(h)
    # 1. placeholders: plantilla = perfil = datos (la modalidad no es placeholder); sin cantidad, fuelles ni capas
    plantilla_ph = set(re.findall(r'\{\{([^}]+)\}\}', sc))
    perfil_ph = set(sum(perfil['placeholders'].values(), []))
    dados = set(datos['datos']) | set(datos['visual']) | set(datos['firmas'])
    if rc2 is False: dados -= {'etiqueta', 'color_bolsa_hex', 'bloque_firma_elaboro', 'bloque_firma_aprobo', 'ancho_rollo'}
    for nombre, a, b in (('plantilla vs perfil', plantilla_ph, perfil_ph), ('plantilla vs datos', plantilla_ph, dados)):
        if a != b: fallos.append('%s: sin dato %s / sin placeholder %s' % (nombre, sorted(a - b), sorted(b - a)))
    if 'cantidad' in plantilla_ph or 'cantidad' in datos['datos'] or 'id="cantidad"' in sc: fallos.append('ROLLO_CONTINUO no tiene la fila Cantidad Por Rollo o Paquete')
    if any('fuelle' in p or p.startswith('capa') for p in plantilla_ph): fallos.append('la plantilla contiene placeholders de fuelles o capas')
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
    if rc2:
        rollo_svg = sc[sc.index('data-modalidad='):]
        if 'data-modalidad="doblado"' not in sc: fallos.append('el dibujo de rollo no es la variante doblada')
        for prohibido in ('<circle', 'stroke-dasharray'):
            if prohibido in rollo_svg[:rollo_svg.index('data-seccion="firmas"')]: fallos.append('el dibujo de rollo contiene %s' % prohibido)
        if 'class="rollo-cuerpo"' not in rollo_svg or 'fill="{{color_bolsa_hex}}"' not in rollo_svg: fallos.append('el rollo doblado debe rellenarse con {{color_bolsa_hex}}')
        if 'stroke="#C4BD97"' not in rollo_svg: fallos.append('el contorno del rollo doblado debe ser #C4BD97')
    ruta_html = os.path.join(carpeta, 'rollo-continuo.html'); ruta_pdf = os.path.join(carpeta, 'rollo-continuo.pdf')
    open(ruta_html, 'w', encoding='utf-8-sig', newline='\n').write(h)
    subprocess.run([CHROME] + CHROME_FLAGS + ['--print-to-pdf=' + ruta_pdf, 'file:///' + ruta_html.replace('\\', '/')], capture_output=True, check=True)
    # 2. página carta
    pdf = fitz.open(ruta_pdf); pg = pdf[0]
    if len(pdf) != 1: fallos.append('páginas: %d (se esperaba 1)' % len(pdf))
    if (pg.rect.width, pg.rect.height) != (612.0, 792.0): fallos.append('tamaño de página %s' % pg.rect)
    palabras = pg.get_text('words')
    texto = ' '.join(' '.join(w[4] for w in palabras).split())
    # 3. DOM
    ids = [s for s in secciones if s != 'encabezado'] + (['seccion-firmas'] if False else [])
    sonda = ruta_html.replace('.html', '.sonda.html')
    open(sonda, 'w', encoding='utf-8-sig', newline='\n').write(open(ruta_html, encoding='utf-8-sig').read().replace('</body>', sonda_js(ids)))
    dom = subprocess.run([CHROME, '--headless', '--disable-gpu', '--window-size=1000,2400', '--dump-dom', 'file:///' + sonda.replace('\\', '/')],
                         capture_output=True, text=True, encoding='utf-8').stdout
    os.remove(sonda)
    geo = json.loads(html.unescape(re.search(r'<pre id="out">(.*?)</pre>', dom, re.S).group(1)))
    # 4. etiquetas y valores
    visibles = ETIQUETAS_RC1 + (ETIQUETAS_RC2 if rc2 else [])
    for e in visibles:
        if e not in texto: fallos.append('falta la etiqueta %r' % e)
    for p in PROHIBIDAS:
        if p in texto: fallos.append('texto que no pertenece a ROLLO_CONTINUO: %r' % p)
    omitidos = {'sufijo_titulo'} | (set() if rc2 else {'etiqueta', 'ancho_rollo'})
    for k, v in datos['datos'].items():
        if k not in omitidos and ' '.join(str(v).split()) not in texto: fallos.append('falta el valor de %s' % k)
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
    # 6. centrado: tablas y dibujos miden 400.4 pt; el PDF tiene márgenes iguales
    for s in tablas:
        t = geo.get(s + '-tabla')
        if t is None: fallos.append('falta la tabla %s' % s); continue
        if s == 'seccion-peso':      # la fila de peso es más angosta por diseño (B:F): arranca en el borde izquierdo del bloque
            if abs(t[0] - IZQ_BLOQUE) > 0.2: fallos.append('la fila de peso no arranca en el borde del bloque: %.2f pt' % t[0])
            continue
        if abs((t[2] - t[0]) - ANCHO_BLOQUE) > 0.2: fallos.append('ancho de %s: %.2f pt' % (s, t[2] - t[0]))
        if abs(t[0] - (612 - t[2])) > 0.2: fallos.append('%s no está centrada: izq %.2f / der %.2f' % (s, t[0], 612 - t[2]))
    if rc2:
        for s in DIBUJOS:
            r = geo[s]
            if abs((r[2] - r[0]) - ANCHO_BLOQUE) > 0.2 or abs(r[0] - IZQ_BLOQUE) > 0.2: fallos.append('%s no coincide con el bloque centrado: %s' % (s, r))
    escala = 2
    pix = pg.get_pixmap(dpi=72 * escala); pix.save(os.path.join(carpeta, 'rollo-continuo.png'))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    ultimo = 'seccion-dibujo-rollo' if rc2 else 'seccion-peso'
    y0, y1 = int(geo['seccion-datos-generales'][1] * escala), int(geo[ultimo][3] * escala)
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
    if rc2:
        # 8. Etiqueta rosa y completa; dibujos con sus cotas y colores
        ex0, ey0, ex1, ey1 = geo['etiqueta']
        if not cerca(px(ex0 + 5, (ey0 + ey1) / 2), (218, 150, 148)): fallos.append('Etiqueta no es rosa #DA9694')
        if len(' '.join(str(datos['datos']['etiqueta']).split()).split()) + 1 > len(dentro(palabras, geo['etiqueta'], 2)): fallos.append('la etiqueta tiene palabras fuera de su celda')
        th = ' '.join(w[4] for w in sorted(dentro(palabras, geo['seccion-dibujo-hoja']), key=lambda w: (round(w[1]), w[0])))
        for k in ('ancho', 'largo'):
            if ' '.join(str(datos['datos'][k]).split()) not in th: fallos.append('el dibujo de la hoja no muestra %s (%s)' % (k, datos['datos'][k]))
        tr = ' '.join(w[4] for w in sorted(dentro(palabras, geo['seccion-dibujo-rollo']), key=lambda w: (round(w[1]), w[0])))
        if ' '.join(str(datos['datos']['ancho_rollo']).split()) not in tr: fallos.append('el dibujo del rollo no muestra ancho_rollo (%s)' % datos['datos']['ancho_rollo'])
        color = hexrgb(datos['visual']['color_bolsa_hex'])
        hx0, hy0 = geo['seccion-dibujo-hoja'][:2]
        if not cerca(px(hx0 + 200, hy0 + 55), color): fallos.append('relleno de la hoja %s != %s' % (px(hx0 + 200, hy0 + 55), datos['visual']['color_bolsa_hex']))
        rx0, ry0 = geo['seccion-dibujo-rollo'][:2]
        if not cerca(px(rx0 + 200, ry0 + 44), color) or not cerca(px(rx0 + 155, ry0 + 44), color): fallos.append('el cuerpo del rollo doblado no es liso del color del producto')
        # 9. firmas: dos zonas separadas, con su marcador, simétricas y dentro del bloque
        f1, f2 = geo['firma_elaboro'], geo['firma_aprobo']
        for nombre, r in (('firma_elaboro', f1), ('firma_aprobo', f2)):
            if len(dentro([w for w in palabras if w[4] in ('SIN', 'FIRMA')], r)) != 2: fallos.append('el contenedor %s no contiene el marcador SIN FIRMA' % nombre)
            if abs((r[2] - r[0]) - 105) > 0.2 or abs((r[3] - r[1]) - 70) > 0.2: fallos.append('tamaño de %s: %.1f x %.1f pt' % (nombre, r[2] - r[0], r[3] - r[1]))
        if f1[2] >= f2[0]: fallos.append('las zonas de firma se tocan o se superponen')
        if abs((f1[0] + f1[2]) / 2 + (f2[0] + f2[2]) / 2 - 2 * (IZQ_BLOQUE + ANCHO_BLOQUE / 2)) > 0.5: fallos.append('las firmas no son simétricas respecto al bloque')
        fin = geo['seccion-firmas'][3]
        if LIMITE_Y - fin < HOLGURA_MINIMA: fallos.append('holgura vertical de %.1f pt (mínimo %.0f pt)' % (LIMITE_Y - fin, HOLGURA_MINIMA))
    if fin > LIMITE_Y: fallos.append('el contenido excede el área imprimible (%.1f > %.1f)' % (fin, LIMITE_Y))
    detalle = ''
    if rc2:
        detalle = ' | hoja %.1f pt | rollo %.1f pt | firmas y %.1f-%.1f' % (geo['seccion-dibujo-hoja'][3] - geo['seccion-dibujo-hoja'][1],
                  geo['seccion-dibujo-rollo'][3] - geo['seccion-dibujo-rollo'][1], geo['seccion-firmas'][1], fin)
    print('%-36s %s | págs %d | pend. %d | márgenes %.1f/%.1f | peso y %.1f-%.1f%s | libre %.1f pt | %s%s' % (
        caso, modalidad[:4], len(pdf), pendientes, izq, der, geo['seccion-peso'][1], geo['seccion-peso'][3], detalle, LIMITE_Y - fin,
        'OK' if not fallos else 'FALLA (%d)' % len(fallos), ' [técnico: el validador lo rechaza]' if esperado == 'tecnico' else ''))
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
