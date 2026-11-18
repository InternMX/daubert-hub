"""Verificación de HOJA_PAQ (HP-C: hoja completa con Etiqueta, Dibujo Hoja y firmas; sin dibujo de rollo).
No hay línea base validada: no se compara píxel a píxel.

Uso:  python verificar_hoja_paq.py [--datos RUTA.json ...] [--salida CARPETA]     # por defecto, todos los datos/*.datos.json
Requiere: Node, Google Chrome (headless), PyMuPDF y numpy (CHROME_PATH si Chrome no está en la ruta por defecto).
Escribe en test-results/<caso>/ (ignorado por Git): HTML, PDF y PNG. Código de salida 0 = OK, 1 = falla.

Cada caso declara "esperado":
  valido    → el validador (tools/validate-hoja-paq-data.mjs) debe aceptarlo; se compone, se imprime y se verifica todo.
  tecnico   → el validador debe RECHAZARLO (no es válido para producción) pero se imprime para probar el componente visual.
  invalido  → el validador debe rechazarlo y NO se imprime nada.
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
PERFIL = os.path.join(MS, 'profiles', 'hoja-paq.profile.json')
FUENTE = os.path.join(MS, 'templates', 'hoja-paq', 'hoja-paq.template.html')
COMPOSITOR = os.path.join(MS, 'tools', 'compose-template.mjs')
VALIDADOR = os.path.join(MS, 'tools', 'validate-hoja-paq-data.mjs')
SALIDA = os.path.join(AQUI, 'test-results')
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
CHROME_FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer']
sin_comentarios = lambda t: re.sub(r'/\*.*?\*/|<!--.*?-->', '', t, flags=re.S)
RE_HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
BLOQUES_PERMITIDOS = {'<span class="sin-firma">SIN FIRMA</span>'}               # pruebas: solo marcadores, nunca firmas reales
LIMITE_Y = hp.LIMITE_Y                        # margen inferior de 0.55 in (criterio común)
ANCHO_BLOQUE = 400.4
HOLGURA_MINIMA = hp.HOLGURA_MINIMA              # espacio libre mínimo al final de la página en documentos de producción (criterio común)
IZQ_BLOQUE = (612 - ANCHO_BLOQUE) / 2
ETIQUETAS = ['Cliente:', 'Fecha:', 'Resina VCI:', 'Producto:', 'Color:', 'Código DCMX:', 'Descripción:', 'Composición:', 'PMG', 'CP5000', 'Natural',
             'Presentación:', 'Rollo', 'Paquete', 'Cantidad Por Rollo o Paquete:', 'Hoja:', 'Doblada', 'Extendida', 'Medidas:',
             'Unidad de Medidas:', 'Ancho:', 'Largo:', 'Calibre:', 'PESO BOLSA LB:', 'Etiqueta:', 'Dibujo Hoja']
PROHIBIDAS = ['Fuelle', 'Capa', 'Dibujo Bolsa']                                  # no pertenecen a HOJA_PAQ
TABLAS = ['seccion-datos-generales', 'seccion-tipo-hoja', 'seccion-medidas', 'seccion-peso', 'seccion-etiqueta',
          'encabezado-dibujo-hoja']
DIBUJOS = ['seccion-dibujo-hoja']
SECCIONES = ['encabezado', 'seccion-datos-generales', 'seccion-tipo-hoja', 'seccion-medidas', 'seccion-peso', 'seccion-etiqueta',
             'encabezado-dibujo-hoja', 'seccion-dibujo-hoja', 'seccion-firmas']
MARCAS = ['comp_pmg', 'comp_cp5000', 'comp_natural', 'pres_rollo', 'pres_paquete', 'hoja_doblada', 'hoja_extendida']
OTROS = ['etiqueta', 'firma_elaboro', 'firma_aprobo']

JS_SONDA = r'''<script>
addEventListener("load", function () {
  var hj = document.querySelector(".hoja").getBoundingClientRect(), o = {};
  function m(k, e) { if (!e) return; var r = e.getBoundingClientRect();
    o[k] = [+(.75*(r.left-hj.left)).toFixed(2), +(.75*(r.top-hj.top)).toFixed(2), +(.75*(r.right-hj.left)).toFixed(2), +(.75*(r.bottom-hj.top)).toFixed(2)]; }
  var tablas = %TABLAS%, todos = tablas.concat(%DIBUJOS%, ["seccion-firmas"], %MARCAS%, %OTROS%);
  todos.forEach(function (id) { m(id, document.getElementById(id)); });
  m("encabezado", document.querySelector(".encabezado"));
  tablas.forEach(function (id) { var t = document.querySelector("#" + id + " table"); if (t) m(id + "-tabla", t); });
  var pre = document.createElement("pre"); pre.id = "out"; pre.textContent = JSON.stringify(o); document.body.appendChild(pre);
});
</script></body>'''.replace('%TABLAS%', json.dumps(TABLAS)).replace('%DIBUJOS%', json.dumps(DIBUJOS)).replace('%MARCAS%', json.dumps(MARCAS)).replace('%OTROS%', json.dumps(OTROS))


def validar(datos_ruta):
    r = subprocess.run(['node', VALIDADOR, datos_ruta], capture_output=True, text=True, encoding='utf-8')
    return r.returncode, (r.stderr or r.stdout).strip()


def dentro(palabras, r, tol=1):
    return [w for w in palabras if r[0] - tol <= w[0] and w[2] <= r[2] + tol and r[1] - tol <= w[1] and w[3] <= r[3] + tol]


def verificar(datos_ruta, perfil):
    fallos = []
    datos = json.load(open(datos_ruta, encoding='utf-8'))
    caso, esperado, modalidad = datos['caso'], datos['esperado'], datos['modalidad']
    # 0. contrato: el validador acepta los casos válidos y rechaza los técnicos e inválidos
    codigo, mensaje = validar(datos_ruta)
    if (codigo == 0) != (esperado in ('valido', 'estres')): fallos.append('el validador %s el caso %s: %s' % ('aceptó' if codigo == 0 else 'rechazó', esperado, mensaje))
    if esperado == 'invalido':
        print('%-30s rechazado por el validador (%s) | %s' % (caso, mensaje.replace('\n', ' ').strip('- '), 'OK' if not fallos else 'FALLA (%d)' % len(fallos)))
        for f in fallos: print('   -', f)
        return fallos
    if not (datos['formato'] == perfil['formato'] == 'HOJA_PAQ'): fallos.append('el formato no es HOJA_PAQ')
    cfg = perfil['modalidades'][modalidad]
    carpeta = os.path.join(SALIDA, caso); hp.preparar_carpeta(carpeta)
    shutil.copy(os.path.join(MS, 'templates', 'hoja-paq', 'images', 'DC_logo.jpg'), os.path.join(carpeta, 'images', 'DC_logo.jpg'))
    compuesta = os.path.join(carpeta, 'hoja-paq.composed.html')
    subprocess.run(['node', COMPOSITOR, '--source', FUENTE, '--out', compuesta], capture_output=True, text=True, check=True)
    h = open(compuesta, encoding='utf-8').read()
    # 1. placeholders: plantilla = perfil = datos (la modalidad no es placeholder); sin fuelles ni capas; variante gráfica correcta
    plantilla_ph = set(re.findall(r'\{\{([^}]+)\}\}', sin_comentarios(h)))
    perfil_ph = set(sum(perfil['placeholders'].values(), []))
    dados = set(datos['datos']) | set(datos['visual']) | set(datos['firmas'])
    for nombre, a, b in (('plantilla vs perfil', plantilla_ph, perfil_ph), ('plantilla vs datos', plantilla_ph, dados)):
        if a != b: fallos.append('%s: sin dato %s / sin placeholder %s' % (nombre, sorted(a - b), sorted(b - a)))
    if any('fuelle' in p or p.startswith('capa') for p in plantilla_ph): fallos.append('la plantilla contiene placeholders de fuelles o capas')
    if '@{' in h: fallos.append('parámetros de inclusión sin resolver')
    sc = sin_comentarios(h)
    for k, v in datos['datos'].items(): h = h.replace('{{%s}}' % k, html.escape(str(v), quote=True))
    for k, v in datos['visual'].items():
        if not RE_HEX.match(v): fallos.append('color inválido %s' % k)
        h = h.replace('{{%s}}' % k, v)
    for k, v in datos['firmas'].items():
        if v not in BLOQUES_PERMITIDOS: fallos.append('bloque de firma no permitido en pruebas: %s' % k)
        h = h.replace('{{%s}}' % k, v)
    pendientes = len(re.findall(r'\{\{|\}\}', sin_comentarios(h)))
    if pendientes: fallos.append('placeholders pendientes: %d' % pendientes)
    ruta_html = os.path.join(carpeta, 'hoja-paq.html'); ruta_pdf = os.path.join(carpeta, 'hoja-paq.pdf')
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
    sonda = ruta_html.replace('.html', '.sonda.html')
    open(sonda, 'w', encoding='utf-8-sig', newline='\n').write(open(ruta_html, encoding='utf-8-sig').read().replace('</body>', JS_SONDA))
    try: geo = hp.medir_dom(CHROME, sonda)
    finally: os.remove(sonda)
    # 4. etiquetas, valores, títulos de dibujo
    for e in ETIQUETAS:
        if e not in texto: fallos.append('falta la etiqueta %r' % e)
    if 'Dibujo de rollo' in texto or 'rollo doblado' in texto or 'seccion-dibujo-rollo' in h: fallos.append('HOJA_PAQ no imprime Dibujo de rollo (filas ocultas del Excel)')
    for p in PROHIBIDAS:
        if p in texto: fallos.append('texto que no pertenece a HOJA_PAQ: %r' % p)
    for k, v in datos['datos'].items():
        if k != 'sufijo_titulo' and ' '.join(str(v).split()) not in texto: fallos.append('falta el valor de %s' % k)
    if not ('Hoja de Instrucción de' in texto and 'Manufactura' in texto): fallos.append('falta el título')
    if 'COEXTRUSI' in texto.upper(): fallos.append('el título no debe llevar COEXTRUSIÓN')
    # 5. orden vertical, solapes y límites
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
        if a[0] < IZQ_BLOQUE - 1 or a[2] > IZQ_BLOQUE + ANCHO_BLOQUE + 1 or a[1] < 39 or a[3] > LIMITE_Y: fallos.append('texto fuera del bloque o del área imprimible: %r' % a[4])
    # 6. centrado: tablas y dibujos miden 400.4 pt; el PDF tiene márgenes iguales
    for s in TABLAS:
        t = geo[s + '-tabla']
        if s == 'seccion-peso':      # la fila de peso es más angosta por diseño (B:F): arranca en el borde izquierdo del bloque
            if abs(t[0] - IZQ_BLOQUE) > 0.2: fallos.append('la fila de peso no arranca en el borde del bloque: %.2f pt' % t[0])
            continue
        if abs((t[2] - t[0]) - ANCHO_BLOQUE) > 0.2: fallos.append('ancho de %s: %.2f pt' % (s, t[2] - t[0]))
        if abs(t[0] - (612 - t[2])) > 0.2: fallos.append('%s no está centrada: izq %.2f / der %.2f' % (s, t[0], 612 - t[2]))
    for s in DIBUJOS:
        r = geo[s]
        if abs((r[2] - r[0]) - ANCHO_BLOQUE) > 0.2 or abs(r[0] - IZQ_BLOQUE) > 0.2: fallos.append('%s no coincide con el bloque centrado: %s' % (s, r))
    escala = 2
    pix = pg.get_pixmap(dpi=72 * escala); hp.guardar_png(pix, os.path.join(carpeta, 'hoja-paq.png'))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    y0, y1 = int(geo['seccion-datos-generales'][1] * escala), int(geo['seccion-dibujo-hoja'][3] * escala)
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
    # 8. Etiqueta rosa y completa; dibujos con sus cotas; color de la hoja
    ex0, ey0, ex1, ey1 = geo['etiqueta']
    if not cerca(px(ex0 + 5, (ey0 + ey1) / 2), (218, 150, 148)): fallos.append('Etiqueta no es rosa #DA9694')
    pal_etiqueta = dentro(palabras, geo['etiqueta'], 2)
    if len(' '.join(str(datos['datos']['etiqueta']).split()).split()) + 1 > len(pal_etiqueta): fallos.append('la etiqueta tiene palabras fuera de su celda')
    th = dentro(palabras, geo['seccion-dibujo-hoja'])
    th_txt = ' '.join(w[4] for w in sorted(th, key=lambda w: (round(w[1]), w[0])))
    for k in ('ancho', 'largo'):
        if ' '.join(str(datos['datos'][k]).split()) not in th_txt: fallos.append('el dibujo de la hoja no muestra %s (%s)' % (k, datos['datos'][k]))
    hx0, hy0, hx1, hy1 = geo['seccion-dibujo-hoja']
    if not cerca(px(hx0 + 200, hy0 + 55), hexrgb(datos['visual']['color_bolsa_hex'])): fallos.append('relleno de la hoja %s != %s' % (px(hx0 + 200, hy0 + 55), datos['visual']['color_bolsa_hex']))
    # 9. firmas: dos zonas separadas, con su marcador, simétricas y dentro del bloque
    f1, f2 = geo['firma_elaboro'], geo['firma_aprobo']
    for nombre, r in (('firma_elaboro', f1), ('firma_aprobo', f2)):
        if len(dentro([w for w in palabras if w[4] in ('SIN', 'FIRMA')], r)) != 2: fallos.append('el contenedor %s no contiene el marcador SIN FIRMA' % nombre)
        if abs((r[2] - r[0]) - 105) > 0.2 or abs((r[3] - r[1]) - 70) > 0.2: fallos.append('tamaño de %s: %.1f x %.1f pt' % (nombre, r[2] - r[0], r[3] - r[1]))
    if f1[2] >= f2[0]: fallos.append('las zonas de firma se tocan o se superponen')
    if abs(((f1[0] + f1[2]) / 2 - IZQ_BLOQUE) - (IZQ_BLOQUE + ANCHO_BLOQUE - (f2[0] + f2[2]) / 2)) > 0.5 - 0 and abs((f1[0] + f1[2]) / 2 + (f2[0] + f2[2]) / 2 - 2 * (IZQ_BLOQUE + ANCHO_BLOQUE / 2)) > 0.5:
        fallos.append('las firmas no son simétricas respecto al bloque')
    # 10. altura ocupada
    fin = geo['seccion-firmas'][3]
    fallos += hp.fallo_holgura(fin, HOLGURA_MINIMA)
    fallos += hp.fallo_exceso(fin)
    alto = lambda s: geo[s][3] - geo[s][1]
    fallos, limites = hp.clasificar_limites(esperado, fallos)
    print('%-30s %s | págs %d | pend. %d | márgenes %.1f/%.1f | etiqueta y %.1f | hoja %.1f pt | firmas y %.1f-%.1f | libre %.1f pt | %s%s' % (
        caso, modalidad[:4], len(pdf), pendientes, izq, der, geo['seccion-etiqueta'][1], alto('seccion-dibujo-hoja'),
        geo['seccion-firmas'][1], fin, LIMITE_Y - fin, ('OK' if not fallos else 'FALLA (%d)' % len(fallos)) + hp.informar_limites(carpeta, esperado, limites, len(pdf), fin),
        ' [técnico: el validador lo rechaza]' if esperado == 'tecnico' else ''))
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
