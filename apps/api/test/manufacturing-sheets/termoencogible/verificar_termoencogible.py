"""Verificación de TERMOENCOGIBLE (TE-1: hasta Peso lb; TE-2: hoja completa con Etiqueta, Dibujo de rollo doblado, Dibujo de presentación final y firmas).
La etapa se toma del perfil. No hay línea base validada: no se compara píxel a píxel.

Uso:  python verificar_termoencogible.py [--datos RUTA.json ...] [--salida CARPETA]     # por defecto, todos los datos/*.datos.json
Requiere: Node, Google Chrome (headless), PyMuPDF y numpy (CHROME_PATH si Chrome no está en la ruta por defecto).
Escribe en test-results/<caso>/ (ignorado por Git): HTML, PDF y PNG. Código de salida 0 = OK, 1 = falla.

Cada caso declara "esperado":
  valido    → el validador (tools/validate-termoencogible-data.mjs) debe aceptarlo; se compone, se imprime y se verifica todo.
  estres    → datos válidos pero extremos (no son el uso habitual: las descripciones reales ocupan uno o dos renglones). Se verifica todo igual, pero
              si el contenido excede la página carta o la holgura mínima NO se aprueba en silencio ni se cuenta como regresión: se reporta como
              «LÍMITE DETECTADO» (no se reduce la escala ni se trunca nada). Cualquier otra falla sí cuenta.
  tecnico   → el validador debe RECHAZARLO (no es válido para producción) pero se imprime para probar un componente visual.
  invalido  → el validador debe rechazarlo y NO se imprime nada.
"""
import argparse, glob, html, json, os, re, shutil, subprocess, sys, time
import fitz
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.abspath(os.path.join(AQUI, '..', '..', '..'))
MS = os.path.join(API, 'src', 'manufacturing-sheets')
PERFIL = os.path.join(MS, 'profiles', 'termoencogible.profile.json')
FUENTE = os.path.join(MS, 'templates', 'termoencogible', 'termoencogible.template.html')
COMPOSITOR = os.path.join(MS, 'tools', 'compose-template.mjs')
VALIDADOR = os.path.join(MS, 'tools', 'validate-termoencogible-data.mjs')
SALIDA = os.path.join(AQUI, 'test-results')
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
CHROME_FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer']
sin_comentarios = lambda t: re.sub(r'/\*.*?\*/|<!--.*?-->', '', t, flags=re.S)
BLOQUES_PERMITIDOS = {'<span class="sin-firma">SIN FIRMA</span>'}               # pruebas: solo marcadores, nunca firmas reales
LIMITE_Y = 792 - 0.55 * 72                    # margen inferior de 0.55 in
ANCHO_BLOQUE = 400.4
IZQ_BLOQUE = (612 - ANCHO_BLOQUE) / 2
HOLGURA_MINIMA = 20.0                         # espacio libre mínimo al final de la página, también con textos extensos (TE-2)
ETIQUETAS_TE1 = ['Cliente:', 'Fecha:', 'Resina VCI:', 'Producto:', 'Color:', 'Código DCMX:', 'Descripción:', 'Composición:', 'PMG', 'CP5000', 'Natural',
                 'Presentación:', 'Rollo', 'Paquete', 'Hoja:', 'Doblada', 'Extendida', 'Medidas:', 'Unidad de Medidas:', 'Ancho:', 'Largo:', 'Calibre:', 'Peso lb:']
ETIQUETAS_TE2 = ['Etiqueta:', 'Dibujo de rollo doblado', 'Dibujo de presentación final', 'Inicio']
PROHIBIDAS = ['Apertura', 'Cantidad', 'Fuelle', 'Capa', 'Dibujo Bolsa', 'Dibujo Hoja', 'Dibujo de hoja', 'PESO', 'Notas:']   # no pertenecen a TERMOENCOGIBLE
SEC_TE1 = ['encabezado', 'seccion-datos-generales', 'seccion-tipo-hoja', 'seccion-medidas', 'seccion-peso']
SEC_TE2 = ['seccion-etiqueta', 'encabezado-dibujo-rollo-doblado', 'seccion-dibujo-rollo-doblado', 'encabezado-dibujo-presentacion-final',
           'seccion-dibujo-presentacion-final', 'seccion-firmas']
TABLAS_TE1 = SEC_TE1[1:]
TABLAS_TE2 = ['seccion-etiqueta', 'encabezado-dibujo-rollo-doblado', 'encabezado-dibujo-presentacion-final']
DIBUJOS = ['seccion-dibujo-rollo-doblado', 'seccion-dibujo-presentacion-final']
MARCAS = ['comp_pmg', 'comp_cp5000', 'comp_natural', 'pres_rollo', 'pres_paquete', 'hoja_doblada', 'hoja_extendida']
OTROS = ['etiqueta', 'firma_elaboro', 'firma_aprobo']
COTAS = ['ancho_doblado', 'medida_pliegue', 'largo_presentacion_final', 'ancho_presentacion_final']


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
  var im = document.querySelector("#seccion-dibujo-rollo-doblado image"); if (im) { m("imagen-rollo", im); o["imagen-rollo-ok"] = im.getAttribute("href") || ""; }
  var pre = document.createElement("pre"); pre.id = "out"; pre.textContent = JSON.stringify(o); document.body.appendChild(pre);
});
</script></body>'''.replace('%IDS%', json.dumps(ids)).replace('%MARCAS%', json.dumps(MARCAS)).replace('%OTROS%', json.dumps(OTROS))


def validar(datos_ruta):
    r = subprocess.run(['node', VALIDADOR, datos_ruta], capture_output=True, text=True, encoding='utf-8')
    return r.returncode, (r.stderr or r.stdout).strip()


def dentro(palabras, r, tol=1):
    return [w for w in palabras if r[0] - tol <= w[0] and w[2] <= r[2] + tol and r[1] - tol <= w[1] and w[3] <= r[3] + tol]


def verificar(datos_ruta, perfil):
    fallos = []
    te2 = perfil['etapa'] != 'TE-1'
    tablas = TABLAS_TE1 + (TABLAS_TE2 if te2 else [])
    secciones = SEC_TE1 + (SEC_TE2 if te2 else [])
    datos = json.load(open(datos_ruta, encoding='utf-8'))
    caso, esperado, modalidad = datos['caso'], datos['esperado'], datos['modalidad']
    # 0. contrato: el validador acepta los casos válidos y rechaza los técnicos e inválidos
    codigo, mensaje = validar(datos_ruta)
    if (codigo == 0) != (esperado in ('valido', 'estres')): fallos.append('el validador %s el caso %s: %s' % ('aceptó' if codigo == 0 else 'rechazó', esperado, mensaje))
    if esperado == 'invalido':
        print('%-40s rechazado por el validador (%s) | %s' % (caso, mensaje.replace('\n', ' ').strip('- ')[:100], 'OK' if not fallos else 'FALLA (%d)' % len(fallos)))
        for f in fallos: print('   -', f)
        return fallos
    if not (datos['formato'] == perfil['formato'] == 'TERMOENCOGIBLE'): fallos.append('el formato no es TERMOENCOGIBLE')
    carpeta = os.path.join(SALIDA, caso)
    shutil.copytree(os.path.join(MS, 'templates', 'termoencogible', 'images'), os.path.join(carpeta, 'images'))
    compuesta = os.path.join(carpeta, 'termoencogible.composed.html')
    subprocess.run(['node', COMPOSITOR, '--source', FUENTE, '--out', compuesta], capture_output=True, text=True, check=True)
    h = open(compuesta, encoding='utf-8').read()
    sc = sin_comentarios(h)
    # 1. placeholders: plantilla = perfil = datos (la modalidad no es placeholder); sin cantidad, fuelles ni capas
    plantilla_ph = set(re.findall(r'\{\{([^}]+)\}\}', sc))
    perfil_ph = set(sum(perfil['placeholders'].values(), []))
    dados = set(datos['datos']) | set(datos['firmas'])
    if not te2: dados -= set(COTAS) | {'etiqueta', 'bloque_firma_elaboro', 'bloque_firma_aprobo'}
    for nombre, a, b in (('plantilla vs perfil', plantilla_ph, perfil_ph), ('plantilla vs datos', plantilla_ph, dados)):
        if a != b: fallos.append('%s: sin dato %s / sin placeholder %s' % (nombre, sorted(a - b), sorted(b - a)))
    if 'cantidad' in plantilla_ph or 'cantidad' in datos['datos'] or 'id="cantidad"' in sc: fallos.append('TERMOENCOGIBLE no tiene la fila Cantidad Por Rollo o Paquete')
    if any('fuelle' in p or p.startswith('capa') or p in ('ancho_rollo', 'color_bolsa_hex') for p in plantilla_ph): fallos.append('placeholders ajenos al formato')
    if '@{' in h: fallos.append('parámetros de inclusión sin resolver')
    for k, v in datos['datos'].items(): h = h.replace('{{%s}}' % k, html.escape(str(v), quote=True))
    for k, v in datos['firmas'].items():
        if v not in BLOQUES_PERMITIDOS: fallos.append('bloque de firma no permitido en pruebas: %s' % k)
        h = h.replace('{{%s}}' % k, v)
    pendientes = len(re.findall(r'\{\{|\}\}', sin_comentarios(h)))
    if pendientes: fallos.append('placeholders pendientes: %d' % pendientes)
    if te2:
        if 'geometry/' in sc or 'class="rollo-cuerpo"' in sc: fallos.append('no debe usarse la geometría del rollo continuo')
        if '<image' not in sc: fallos.append('falta la imagen original del rollo doblado')
        m_fin = re.search(r'<rect class="presentacion-final"([^>]*)/>', sc)
        if not m_fin: fallos.append('falta el rectángulo de la presentación final')
        elif 'fill="#fff"' not in m_fin.group(1) or 'stroke="#000"' not in m_fin.group(1): fallos.append('la presentación final debe ser un rectángulo blanco con contorno negro')
    ruta_html = os.path.join(carpeta, 'termoencogible.html'); ruta_pdf = os.path.join(carpeta, 'termoencogible.pdf')
    open(ruta_html, 'w', encoding='utf-8-sig', newline='\n').write(h)
    t0 = time.time() - 2
    subprocess.run([CHROME] + CHROME_FLAGS + ['--print-to-pdf=' + ruta_pdf, 'file:///' + ruta_html.replace('\\', '/')], capture_output=True, check=True)
    if not os.path.exists(ruta_pdf) or os.path.getmtime(ruta_pdf) < t0: fallos.append('el PDF no se regeneró (¿está abierto en un visor? ciérrelo y repita la prueba)')
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
    # 4. etiquetas y valores (los opcionales vacíos no se exigen ni se inventan)
    for e in ETIQUETAS_TE1 + (ETIQUETAS_TE2 if te2 else []):
        if e not in texto: fallos.append('falta la etiqueta %r' % e)
    for p in PROHIBIDAS:
        if p in texto: fallos.append('texto que no pertenece a TERMOENCOGIBLE: %r' % p)
    omitidos = {'sufijo_titulo'} | (set() if te2 else set(COTAS) | {'etiqueta'})
    for k, v in datos['datos'].items():
        if k not in omitidos and str(v).strip() and ' '.join(str(v).split()) not in texto: fallos.append('falta el valor de %s' % k)
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
    cota_pliegue = set(str(datos['datos'].get('medida_pliegue', '')).split())
    for i, a in enumerate(palabras):
        for b in palabras[i + 1:]:
            ix, iy = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
            if te2 and a[4] in cota_pliegue and b[4] in cota_pliegue: continue      # texto rotado de medida_pliegue: sus cajas se solapan sin que el texto lo haga
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
    if te2:
        for s in DIBUJOS:
            r = geo[s]
            if abs((r[2] - r[0]) - ANCHO_BLOQUE) > 0.2 or abs(r[0] - IZQ_BLOQUE) > 0.2: fallos.append('%s no coincide con el bloque centrado: %s' % (s, r))
    escala = 2
    pix = pg.get_pixmap(dpi=72 * escala); pix.save(os.path.join(carpeta, 'termoencogible.png'))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    ultimo = 'seccion-dibujo-presentacion-final' if te2 else 'seccion-peso'
    y0, y1 = int(geo['seccion-datos-generales'][1] * escala), int(geo[ultimo][3] * escala)
    cols = np.where((img[y0:y1] < 245).any(axis=2).any(axis=0))[0]
    izq, der = cols.min() / escala, 612 - (cols.max() + 1) / escala
    if abs(izq - der) > 1.0: fallos.append('PDF descentrado: margen izquierdo %.1f / derecho %.1f pt' % (izq, der))
    px = lambda x, y: tuple(int(v) for v in img[int(y * escala), int(x * escala)])
    cerca = lambda a, b, t=2: all(abs(x - y) <= t for x, y in zip(a, b))
    # 7. X y NA dinámicos
    for m in MARCAS:
        r = geo[m]
        if cerca(px(r[0] + 3, (r[1] + r[3]) / 2), (255, 255, 0)) != (datos['datos'][m] == 'X'): fallos.append('la marca %s=%s no se imprime con su color' % (m, datos['datos'][m]))
    fin = geo[ultimo][3]
    detalle = ''
    if te2:
        # 8. Etiqueta rosa y completa
        ex0, ey0, ex1, ey1 = geo['etiqueta']
        if not cerca(px(ex0 + 5, (ey0 + ey1) / 2), (218, 150, 148)): fallos.append('Etiqueta no es rosa #DA9694')
        if len(' '.join(str(datos['datos']['etiqueta']).split()).split()) + 1 > len(dentro(palabras, geo['etiqueta'], 2)): fallos.append('la etiqueta tiene palabras fuera de su celda')
        # 9. dibujo de rollo doblado: imagen original visible (trazos azules) y cotas dinámicas dentro de su contenedor
        d1 = geo['seccion-dibujo-rollo-doblado']
        t1 = ' '.join(w[4] for w in sorted(dentro(palabras, d1), key=lambda w: (round(w[1]), w[0])))
        for k in ('ancho_doblado', 'medida_pliegue'):
            if ' '.join(str(datos['datos'][k]).split()) not in t1: fallos.append('el dibujo del rollo doblado no muestra %s (%s)' % (k, datos['datos'][k]))
        for rotulo in ('Inicio',):
            if rotulo not in t1: fallos.append('el dibujo del rollo doblado no muestra «%s»' % rotulo)
        reg1 = img[int(d1[1] * escala):int(d1[3] * escala), int(d1[0] * escala):int(d1[2] * escala)]
        azules = int(((reg1[:, :, 2] > 150) & (reg1[:, :, 0] < 120) & (reg1[:, :, 2] - reg1[:, :, 0] > 60)).sum())
        if azules < 200: fallos.append('no se imprimen los trazos azules de la figura original (%d px)' % azules)
        # 9b. la figura queda dentro de su contenedor (con margen) y las franjas azules de los dos encabezados de dibujo se imprimen continuas
        im = geo.get('imagen-rollo')
        if not im or im[1] < d1[1] + 1 or im[3] > d1[3] - 1 or im[0] < d1[0] or im[2] > d1[2]: fallos.append('la imagen del rollo doblado no queda dentro de su contenedor con margen: %s / %s' % (im, d1))
        for s_enc in ('encabezado-dibujo-rollo-doblado', 'encabezado-dibujo-presentacion-final'):
            e = geo[s_enc + '-tabla']
            for xa, xb in ((e[0] + 1, e[0] + 60), (e[2] - 60, e[2] - 1)):       # laterales sin texto: toda la franja debe ser azul #366092
                reg = img[int((e[1] + 0.3) * escala):int((e[3] - 0.3) * escala), int(xa * escala):int(xb * escala)]
                malos = int((reg.min(axis=2) > 200).sum())       # blanco (fondo de la figura); los bordes antialias con otras filas no cuentan
                if malos: fallos.append('la franja %s tiene %d px que son blancos dentro de la franja #366092 (figura o fondo blanco invadiéndola)' % (s_enc, malos))
        # 10. presentación final: rectángulo blanco con contorno negro, sin color de producto; cotas dinámicas
        d2 = geo['seccion-dibujo-presentacion-final']
        t2 = ' '.join(w[4] for w in sorted(dentro(palabras, d2), key=lambda w: (round(w[1]), w[0])))
        for k in ('largo_presentacion_final', 'ancho_presentacion_final'):
            if ' '.join(str(datos['datos'][k]).split()) not in t2: fallos.append('el dibujo de la presentación final no muestra %s (%s)' % (k, datos['datos'][k]))
        if not cerca(px(d2[0] + 200, d2[1] + 40), (255, 255, 255)): fallos.append('el rectángulo de la presentación final debe tener fondo blanco: %s' % (px(d2[0] + 200, d2[1] + 40),))
        reg2 = img[int(d2[1] * escala):int(d2[3] * escala), int(d2[0] * escala):int(d2[2] * escala)]
        if int((reg2.max(axis=2) < 60).sum()) < 300: fallos.append('no se imprime el contorno negro de la presentación final')
        # 11. firmas: dos zonas separadas, con su marcador, simétricas y dentro del bloque
        f1, f2 = geo['firma_elaboro'], geo['firma_aprobo']
        for nombre, r in (('firma_elaboro', f1), ('firma_aprobo', f2)):
            if len(dentro([w for w in palabras if w[4] in ('SIN', 'FIRMA')], r)) != 2: fallos.append('el contenedor %s no contiene el marcador SIN FIRMA' % nombre)
            if abs((r[2] - r[0]) - 105) > 0.2 or abs((r[3] - r[1]) - 70) > 0.2: fallos.append('tamaño de %s: %.1f x %.1f pt' % (nombre, r[2] - r[0], r[3] - r[1]))
        if f1[2] >= f2[0]: fallos.append('las zonas de firma se tocan o se superponen')
        if abs((f1[0] + f1[2]) / 2 + (f2[0] + f2[2]) / 2 - 2 * (IZQ_BLOQUE + ANCHO_BLOQUE / 2)) > 0.5: fallos.append('las firmas no son simétricas respecto al bloque')
        fin = geo['seccion-firmas'][3]
        if LIMITE_Y - fin < HOLGURA_MINIMA: fallos.append('holgura vertical de %.1f pt (mínimo %.0f pt)' % (LIMITE_Y - fin, HOLGURA_MINIMA))
        detalle = ' | rollo doblado %.1f pt | final %.1f pt | firmas y %.1f-%.1f' % (d1[3] - d1[1], d2[3] - d2[1], geo['seccion-firmas'][1], fin)
    if fin > LIMITE_Y: fallos.append('el contenido excede el área imprimible (%.1f > %.1f)' % (fin, LIMITE_Y))
    limites = []
    if esperado == 'estres':
        es_limite = lambda f: f.startswith(('páginas:', 'holgura vertical', 'el contenido excede', 'texto fuera del bloque o del área')) or 'sale del área imprimible' in f
        limites = [f for f in fallos if es_limite(f)]
        if limites: limites += [f for f in fallos if f not in limites and ('no contiene el marcador SIN FIRMA' in f or f.startswith('tamaño de firma'))]   # consecuencia de pasar a la 2.ª página
        fallos = [f for f in fallos if f not in limites]
    print('%-40s %s | págs %d | pend. %d | márgenes %.1f/%.1f | peso y %.1f-%.1f%s | libre %.1f pt | %s%s' % (
        caso, modalidad[:4], len(pdf), pendientes, izq, der, geo['seccion-peso'][1], geo['seccion-peso'][3], detalle, LIMITE_Y - fin,
        ('OK' if not fallos else 'FALLA (%d)' % len(fallos)) + (' [ESTRÉS: LÍMITE DETECTADO, no es regresión]' if limites else ' [estrés: cabe en la página]' if esperado == 'estres' else ''),
        ' [técnico: el validador lo rechaza]' if esperado == 'tecnico' else ''))
    for f in limites[:6]: print('   ! LÍMITE (caso de estrés; el formato no cabe con este texto, sin truncar ni escalar): ' + f)
    for f in fallos[:15]: print('   -', f)
    return fallos


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--datos', nargs='*')
    ap.add_argument('--salida', help='carpeta de resultados alternativa (por defecto test-results)')
    a = ap.parse_args()
    perfil = json.load(open(PERFIL, encoding='utf-8'))
    if a.salida: SALIDA = os.path.abspath(a.salida)
    shutil.rmtree(SALIDA, ignore_errors=True)
    archivos = a.datos or sorted(glob.glob(os.path.join(AQUI, 'datos', '*.datos.json')))
    print('Formato:', perfil['formato'], '| etapa', perfil['etapa'], '| casos:', len(archivos))
    total = sum(len(verificar(f, perfil)) for f in archivos)
    print('\nRESULTADO:', 'OK' if not total else 'FALLA (%d)' % total)
    sys.exit(1 if total else 0)
