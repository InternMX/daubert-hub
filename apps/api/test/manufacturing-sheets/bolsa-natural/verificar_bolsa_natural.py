"""Verificación de BOLSA_NATURAL (BN-1: hasta Peso lb; BN-2: hoja completa con Etiqueta, dibujo con fuelles y sello, nota y firmas).
La etapa se toma del perfil. No hay línea base validada: no se compara píxel a píxel.

Uso:  python verificar_bolsa_natural.py [--datos RUTA.json ...] [--salida CARPETA]     # por defecto, todos los datos/*.datos.json
Requiere: Node, Google Chrome (headless), PyMuPDF y numpy (CHROME_PATH si Chrome no está en la ruta por defecto).
Escribe en test-results/<caso>/ (ignorado por Git): HTML, PDF y PNG. Código de salida 0 = OK, 1 = falla.

Cada caso declara "esperado":
  valido    → el validador (tools/validate-bolsa-natural-data.mjs) debe aceptarlo; se compone, se imprime y se verifica todo.
  estres    → datos válidos pero extremos: si exceden la página carta o la holgura se reporta «LÍMITE DETECTADO» (no apto para emisión).
  invalido  → el validador debe rechazarlo y NO se imprime nada (p. ej. composición distinta de PMG = NA, ESD = NA, Natural = X).
Además, al iniciar comprueba que la fila Composición de las demás familias no cambió (PMG / CP5000 / Natural, sin ESD).
"""
import argparse, glob, html, json, os, re, shutil, subprocess, sys
import fitz
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import hoja_pruebas as hp
AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.abspath(os.path.join(AQUI, '..', '..', '..'))
MS = os.path.join(API, 'src', 'manufacturing-sheets')
PERFIL = os.path.join(MS, 'profiles', 'bolsa-natural.profile.json')
FUENTE = os.path.join(MS, 'templates', 'bolsa-natural', 'bolsa-natural.template.html')
COMPOSITOR = os.path.join(MS, 'tools', 'compose-template.mjs')
VALIDADOR = os.path.join(MS, 'tools', 'validate-bolsa-natural-data.mjs')
SALIDA = os.path.join(AQUI, 'test-results')
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
CHROME_FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer']
sin_comentarios = lambda t: re.sub(r'/\*.*?\*/|<!--.*?-->', '', t, flags=re.S)
RE_HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
BLOQUES_PERMITIDOS = {'<span class="sin-firma">SIN FIRMA</span>'}               # pruebas: solo marcadores, nunca firmas reales
LIMITE_Y = hp.LIMITE_Y
ANCHO_BLOQUE = 400.4
IZQ_BLOQUE = (612 - ANCHO_BLOQUE) / 2
HOLGURA_MINIMA = hp.HOLGURA_MINIMA
NOTA = 'Notas: Considerar la altura total de la bolsa a partir del sello'
ETIQUETAS_BN1 = ['Cliente:', 'Fecha:', 'Resina VCI:', 'Producto:', 'Color:', 'Código DCMX:', 'Descripción:', 'Composición:', 'PMG', 'ESD', 'Natural',
                 'Presentación:', 'Rollo', 'Paquete', 'Cantidad Por Rollo o Paquete:', 'Medidas:', 'Unidad de Medidas:', 'Ancho:', 'Fuelle Derecho',
                 'Largo:', 'Fuelle Izquierdo', 'Calibre:', 'Peso lb:']
ETIQUETAS_BN2 = ['Dibujo Bolsa', 'Etiqueta:']
PROHIBIDAS = ['CP5000', 'Doblada', 'Extendida', 'Capa', 'PESO LB']             # no pertenecen a BOLSA_NATURAL
SEC_BN1 = ['encabezado', 'seccion-datos-generales', 'seccion-medidas', 'seccion-peso']
SEC_BN2 = ['seccion-etiqueta', 'seccion-dibujo-bolsa', 'seccion-nota', 'seccion-firmas']
TABLAS_BN1 = SEC_BN1[1:]
TABLAS_BN2 = ['seccion-etiqueta', 'seccion-nota']
MARCAS = ['comp_pmg', 'comp_esd', 'comp_natural', 'pres_rollo', 'pres_paquete']
OTROS = ['etiqueta', 'firma_elaboro', 'firma_aprobo']
VISUAL = {'color_bolsa_hex', 'color_cotas_internas_hex'}
FIRMAS = {'bloque_firma_elaboro', 'bloque_firma_aprobo'}
FAMILIAS_EXISTENTES = ['bolsa-fuelle', 'bolsa-plana-1', 'hoja-paq', 'rollo-continuo', 'termoencogible']


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


def validar(datos_ruta):
    r = subprocess.run(['node', VALIDADOR, datos_ruta], capture_output=True, text=True, encoding='utf-8')
    return r.returncode, (r.stderr or r.stdout).strip()


def dentro(palabras, r, tol=1):
    return [w for w in palabras if r[0] - tol <= w[0] and w[2] <= r[2] + tol and r[1] - tol <= w[1] and w[3] <= r[3] + tol]


def verificar_composiciones_existentes():
    """Las demás familias conservan su fila Composición (PMG / CP5000 / Natural) y no reciben ESD."""
    fallos = []
    for fam in FAMILIAS_EXISTENTES:
        destino = os.path.join(SALIDA, '_composicion-existentes', fam + '.html')
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        subprocess.run(['node', COMPOSITOR, '--source', os.path.join(MS, 'templates', fam, fam + '.template.html'), '--out', destino],
                       capture_output=True, text=True, check=True)
        c = sin_comentarios(open(destino, encoding='utf-8').read())
        if '<td class="tipo">CP5000</td>' not in c or 'id="comp_cp5000"' not in c: fallos.append('%s: la fila Composición perdió CP5000' % fam)
        if 'comp_esd' in c or '>ESD<' in c: fallos.append('%s: la fila Composición recibió ESD' % fam)
        if not all(('id="%s"' % i) in c for i in ('comp_pmg', 'comp_natural')): fallos.append('%s: faltan comp_pmg o comp_natural' % fam)
    print('%-40s composición de las demás familias (%s) | %s' % ('_composicion-existentes', ', '.join(FAMILIAS_EXISTENTES), 'OK' if not fallos else 'FALLA (%d)' % len(fallos)))
    for f in fallos: print('   -', f)
    return fallos


def verificar(datos_ruta, perfil):
    fallos = []
    bn2 = perfil['etapa'] != 'BN-1'
    tablas = TABLAS_BN1 + (TABLAS_BN2 if bn2 else [])
    secciones = SEC_BN1 + (SEC_BN2 if bn2 else [])
    datos = json.load(open(datos_ruta, encoding='utf-8'))
    caso, esperado = datos['caso'], datos.get('esperado', 'valido')
    # 0. contrato: el validador acepta los casos válidos y de estrés, y rechaza los inválidos (composición distinta de la del formato, etc.)
    codigo, mensaje = validar(datos_ruta)
    if (codigo == 0) != (esperado in ('valido', 'estres')): fallos.append('el validador %s el caso %s: %s' % ('aceptó' if codigo == 0 else 'rechazó', esperado, mensaje))
    if esperado == 'invalido':
        print('%-40s rechazado por el validador (%s) | %s' % (caso, mensaje.replace('\n', ' ').strip('- ')[:100], 'OK' if not fallos else 'FALLA (%d)' % len(fallos)))
        for f in fallos: print('   -', f)
        return fallos
    if not (datos['formato'] == perfil['formato'] == 'BOLSA_NATURAL'): fallos.append('el formato no es BOLSA_NATURAL')
    carpeta = os.path.join(SALIDA, caso)
    hp.preparar_carpeta(carpeta, os.path.join(MS, 'templates', 'bolsa-natural', 'images'))
    compuesta = os.path.join(carpeta, 'bolsa-natural.composed.html')
    subprocess.run(['node', COMPOSITOR, '--source', FUENTE, '--out', compuesta], capture_output=True, text=True, check=True)
    h = open(compuesta, encoding='utf-8').read()
    sc = sin_comentarios(h)
    # 1. placeholders: plantilla = perfil = datos (sin comp_cp5000 ni capas)
    plantilla_ph = set(re.findall(r'\{\{([^}]+)\}\}', sc))
    perfil_ph = set(sum(perfil['placeholders'].values(), []))
    dados = set(datos['datos']) | set(datos.get('visual', {})) | set(datos['firmas'])
    if not bn2: dados -= VISUAL | FIRMAS | {'etiqueta'}
    for nombre, a, b in (('plantilla vs perfil', plantilla_ph, perfil_ph), ('plantilla vs datos', plantilla_ph, dados)):
        if a != b: fallos.append('%s: sin dato %s / sin placeholder %s' % (nombre, sorted(a - b), sorted(b - a)))
    if 'comp_cp5000' in plantilla_ph or 'comp_cp5000' in datos['datos'] or 'comp_cp5000' in sc or 'CP5000' in sc: fallos.append('BOLSA_NATURAL no incluye CP5000')
    if 'comp_esd' not in plantilla_ph: fallos.append('falta el placeholder comp_esd')
    if any(p.startswith('capa') or p in ('modalidad', 'hoja_doblada', 'hoja_extendida') for p in plantilla_ph): fallos.append('placeholders ajenos al formato')
    if '@{' in h: fallos.append('parámetros de inclusión sin resolver')
    for k, v in datos['datos'].items(): h = h.replace('{{%s}}' % k, html.escape(str(v), quote=True))
    for k, v in datos.get('visual', {}).items():
        if not RE_HEX.match(v): fallos.append('color inválido %s' % k)
        h = h.replace('{{%s}}' % k, v)
    for k, v in datos['firmas'].items():
        if v not in BLOQUES_PERMITIDOS: fallos.append('bloque de firma no permitido en pruebas: %s' % k)
        h = h.replace('{{%s}}' % k, v)
    pendientes = len(re.findall(r'\{\{|\}\}', sin_comentarios(h)))
    if pendientes: fallos.append('placeholders pendientes: %d' % pendientes)
    ruta_html = os.path.join(carpeta, 'bolsa-natural.html'); ruta_pdf = os.path.join(carpeta, 'bolsa-natural.pdf')
    open(ruta_html, 'w', encoding='utf-8-sig', newline='\n').write(h)
    hp.imprimir_pdf(CHROME, CHROME_FLAGS, ruta_html, ruta_pdf)          # PDF temporal nuevo y validado: nunca se analiza un PDF anterior
    # 2. página carta
    pdf = fitz.open(ruta_pdf); pg = pdf[0]
    if len(pdf) != 1: fallos.append('páginas: %d (se esperaba 1)' % len(pdf))
    if (pg.rect.width, pg.rect.height) != (612.0, 792.0): fallos.append('tamaño de página %s' % pg.rect)
    palabras = pg.get_text('words')
    texto = ' '.join(hp.texto_de_todas_las_paginas(pdf).split())      # integridad del texto en todas las páginas (si desborda, nada se pierde)
    if datos.get('renglones_descripcion') is not None:           # casos de 1 y 2 renglones: el fixture debe ocupar exactamente esos renglones
        n_reng = hp.contar_renglones_descripcion(palabras)
        if n_reng != datos['renglones_descripcion']: fallos.append('la descripción ocupa %d renglones (se esperaban %d)' % (n_reng, datos['renglones_descripcion']))
    # 3. DOM
    ids = [s for s in secciones if s != 'encabezado']
    sonda = ruta_html.replace('.html', '.sonda.html')
    open(sonda, 'w', encoding='utf-8-sig', newline='\n').write(open(ruta_html, encoding='utf-8-sig').read().replace('</body>', sonda_js(ids)))
    try: geo = hp.medir_dom(CHROME, sonda)
    finally: os.remove(sonda)
    # 4. etiquetas y valores (los opcionales vacíos no se exigen ni se inventan)
    for e in ETIQUETAS_BN1 + (ETIQUETAS_BN2 if bn2 else []):
        if e not in texto: fallos.append('falta la etiqueta %r' % e)
    for p in PROHIBIDAS:
        if p in texto: fallos.append('texto que no pertenece a BOLSA_NATURAL: %r' % p)
    omitidos = {'sufijo_titulo'} | (set() if bn2 else {'etiqueta'})
    for k, v in datos['datos'].items():
        if k not in omitidos and str(v).strip() and ' '.join(str(v).split()) not in texto: fallos.append('falta el valor de %s' % k)
    if not ('Hoja de Instrucción de' in texto and 'Manufactura' in texto): fallos.append('falta el título')
    if 'COEXTRUSI' in texto.upper(): fallos.append('el título no debe llevar COEXTRUSIÓN')
    if bn2 and NOTA not in texto: fallos.append('falta la nota de manufactura completa')
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
        if s == 'seccion-peso':      # la fila de peso es más angosta por diseño: arranca en el borde izquierdo del bloque
            if abs(t[0] - IZQ_BLOQUE) > 0.2: fallos.append('la fila de peso no arranca en el borde del bloque: %.2f pt' % t[0])
            continue
        if abs((t[2] - t[0]) - ANCHO_BLOQUE) > 0.2: fallos.append('ancho de %s: %.2f pt' % (s, t[2] - t[0]))
        if abs(t[0] - (612 - t[2])) > 0.2: fallos.append('%s no está centrada: izq %.2f / der %.2f' % (s, t[0], 612 - t[2]))
    if bn2:
        r = geo['seccion-dibujo-bolsa']
        if abs((r[2] - r[0]) - ANCHO_BLOQUE) > 0.2 or abs(r[0] - IZQ_BLOQUE) > 0.2: fallos.append('el dibujo no coincide con el bloque centrado: %s' % (r,))
    escala = 2
    pix = pg.get_pixmap(dpi=72 * escala); hp.guardar_png(pix, os.path.join(carpeta, 'bolsa-natural.png'))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    ultimo = 'seccion-firmas' if bn2 else 'seccion-peso'
    y0, y1 = int(geo['seccion-datos-generales'][1] * escala), min(int(geo[ultimo][3] * escala), img.shape[0])
    cols = np.where((img[y0:y1] < 245).any(axis=2).any(axis=0))[0]
    izq, der = cols.min() / escala, 612 - (cols.max() + 1) / escala
    if abs(izq - der) > 1.0: fallos.append('PDF descentrado: margen izquierdo %.1f / derecho %.1f pt' % (izq, der))
    px = lambda x, y: hp.pixel_o_none(img, escala, x, y)             # fuera de la imagen devuelve hp.FUERA (no verificable; nunca un IndexError)
    cerca = lambda a, b, t=2: all(abs(x - y) <= t for x, y in zip(a, b))
    hexrgb = lambda c: tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
    # 7. X y NA dinámicos
    for m in MARCAS:
        r = geo[m]
        if cerca(px(r[0] + 3, (r[1] + r[3]) / 2), (255, 255, 0)) != (datos['datos'][m] == 'X'): fallos.append('la marca %s=%s no se imprime con su color' % (m, datos['datos'][m]))
    fin = geo[ultimo][3]
    if bn2:
        # 8. Etiqueta rosa y completa
        ex0, ey0, ex1, ey1 = geo['etiqueta']
        if not cerca(px(ex0 + 5, (ey0 + ey1) / 2), (218, 150, 148)): fallos.append('Etiqueta no es rosa #DA9694')
        if len(' '.join(str(datos['datos']['etiqueta']).split()).split()) + 1 > len(dentro(palabras, geo['etiqueta'], 2)): fallos.append('la etiqueta tiene palabras fuera de su celda')
        # 9. dibujo: cotas dentro del contenedor y colores impresos (coordenadas del SVG: 1 unidad = 1 pt desde la esquina del contenedor)
        dx0, dy0, dx1, dy1 = geo['seccion-dibujo-bolsa']
        for k in ('ancho', 'largo', 'fuelle_izquierdo', 'fuelle_derecho'):
            v = ' '.join(str(datos['datos'][k]).split())
            if v not in ' '.join(w[4] for w in sorted(dentro(palabras, geo['seccion-dibujo-bolsa']), key=lambda w: (round(w[1]), w[0]))): fallos.append('la cota %s (%s) no aparece dentro del dibujo' % (k, v))
        relleno = hexrgb(datos['visual']['color_bolsa_hex'])
        bolsa = px(dx0 + 247, dy0 + 120)
        if not cerca(bolsa, relleno): fallos.append('relleno de la bolsa %s != %s' % (bolsa, datos['visual']['color_bolsa_hex']))
        franja = img[int((dy0 + 49) * escala):int((dy0 + 55) * escala), int((dx0 + 112) * escala):int((dx0 + 216) * escala)]
        cotas = hexrgb(datos['visual']['color_cotas_internas_hex'])
        n_cotas = int((np.abs(franja - np.array(cotas)).max(axis=2) <= 3).sum()) if franja.size else 0
        if n_cotas < 80: fallos.append('las cotas internas casi no se imprimen (%d px de %s)' % (n_cotas, datos['visual']['color_cotas_internas_hex']))
        # sello inferior: rectángulo plano y frontal del mismo relleno, con bordes negros marcados, sin sombras ni barra de color fija
        sello = re.search(r'<rect class="sello-fondo"([^>]*)/>', sc)
        if not sello: fallos.append('falta el rectángulo del sello de fondo')
        else:
            sx, sy, sw, sh = (float(re.search(r'\s%s="([\d.]+)"' % a, sello.group(1)).group(1)) for a in ('x', 'y', 'width', 'height'))
            if abs(sx - 112) > 0.01 or abs(sw - 270) > 0.01: fallos.append('el sello debe tener el ancho del cuerpo de la bolsa: x=%s ancho=%s' % (sx, sw))
            if 'stroke="#000"' not in sello.group(1) or '{{color_bolsa_hex}}' not in open(compuesta, encoding='utf-8').read().split('class="sello-fondo"')[1].split('/>')[0]:
                fallos.append('el sello debe llevar contorno negro y el relleno {{color_bolsa_hex}}')
            fila_sup = img[int((dy0 + sy) * escala), int((dx0 + sx + 30) * escala):int((dx0 + sx + sw - 30) * escala)] if int((dy0 + sy) * escala) < img.shape[0] else np.zeros((0, 3))
            fila_inf = img[int((dy0 + sy + sh) * escala), int((dx0 + sx + 30) * escala):int((dx0 + sx + sw - 30) * escala)] if int((dy0 + sy + sh) * escala) < img.shape[0] else np.zeros((0, 3))
            if len(fila_sup) == 0 or (fila_sup.max(axis=1) < 90).mean() < 0.9: fallos.append('no se distingue el borde negro superior del sello')
            if len(fila_inf) == 0 or (fila_inf.max(axis=1) < 90).mean() < 0.9: fallos.append('no se distingue el borde negro inferior del sello')
            interior = img[int((dy0 + sy + 1.6) * escala):int((dy0 + sy + sh - 1.6) * escala) + 1, int((dx0 + sx + 8) * escala):int((dx0 + sx + sw - 8) * escala)]
            if interior.size and not (np.abs(interior - np.array(relleno)).max(axis=2) <= 8).all(): fallos.append('el interior del sello difiere del relleno de la bolsa (sombras o líneas)')
            if sh > 8: fallos.append('el sello debe ser un rectángulo delgado y plano (alto %s pt)' % sh)
        if 'fill="#244062"' in sc: fallos.append('BOLSA_NATURAL no usa la barra inferior azul de BOLSA_FUELLE')
        # nota amarilla con texto rojo; Etiqueta rosa
        n0, n1, n2, n3 = geo['seccion-nota']
        if not cerca(px(n0 + 5, (n1 + n3) / 2), (255, 255, 0)): fallos.append('la nota no es amarilla')
        reg_nota = img[int(n1 * escala):int(n3 * escala), int(n0 * escala):int(n2 * escala)]
        rojos = int(((reg_nota[:, :, 0] > 200) & (reg_nota[:, :, 1] < 60) & (reg_nota[:, :, 2] < 60)).sum()) if reg_nota.size else 0
        if rojos < 100: fallos.append('el texto de la nota no es rojo (%d px rojos)' % rojos)
        # 10. firmas: dos zonas separadas, con su marcador, simétricas y dentro del bloque
        f1, f2 = geo['firma_elaboro'], geo['firma_aprobo']
        for nombre, r in (('firma_elaboro', f1), ('firma_aprobo', f2)):
            if len(dentro([w for w in palabras if w[4] in ('SIN', 'FIRMA')], r)) != 2: fallos.append('el contenedor %s no contiene el marcador SIN FIRMA' % nombre)
            if abs((r[2] - r[0]) - 105) > 0.2 or abs((r[3] - r[1]) - 70) > 0.2: fallos.append('tamaño de %s: %.1f x %.1f pt' % (nombre, r[2] - r[0], r[3] - r[1]))
        if f1[2] >= f2[0]: fallos.append('las zonas de firma se tocan o se superponen')
        if abs((f1[0] + f1[2]) / 2 + (f2[0] + f2[2]) / 2 - 2 * (IZQ_BLOQUE + ANCHO_BLOQUE / 2)) > 0.5: fallos.append('las firmas no son simétricas respecto al bloque')
        fin = geo['seccion-firmas'][3]
        fallos += hp.fallo_holgura(fin, HOLGURA_MINIMA)
    fallos += hp.fallo_exceso(fin)
    fallos, limites = hp.clasificar_limites(esperado, fallos)
    detalle = ' | dibujo y %.1f-%.1f | nota y %.1f-%.1f | firmas y %.1f-%.1f' % (geo['seccion-dibujo-bolsa'][1], geo['seccion-dibujo-bolsa'][3], geo['seccion-nota'][1], geo['seccion-nota'][3],
                                                                                 geo['seccion-firmas'][1], fin) if bn2 else ''
    print('%-40s págs %d | pend. %d | márgenes %.1f/%.1f | peso y %.1f-%.1f%s | libre %.1f pt | %s' % (
        caso, len(pdf), pendientes, izq, der, geo['seccion-peso'][1], geo['seccion-peso'][3], detalle, LIMITE_Y - fin,
        ('OK' if not fallos else 'FALLA (%d)' % len(fallos)) + hp.informar_limites(carpeta, esperado, limites, len(pdf), fin)))
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
    total = len(verificar_composiciones_existentes()) + hp.ejecutar_casos(verificar, archivos, perfil)
    print('\nRESULTADO:', 'OK' if not total else 'FALLA (%d)' % total)
    sys.exit(1 if total else 0)
