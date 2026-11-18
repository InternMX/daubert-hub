"""Prueba de regresion de COEX Verde (CONFPMG04).

Uso (desde cualquier carpeta):
  python comparar_regresion.py                        # compone la plantilla COEX (node) y la compara contra la referencia
  python comparar_regresion.py --plantilla RUTA.html  # compara un HTML ya compuesto (sin pasar por la composicion)
  python comparar_regresion.py --generar-linea-base   # SOLO con aprobacion: reemplaza la referencia

Requiere: Node (compositor, sin dependencias), Google Chrome (headless), PyMuPDF (fitz) y numpy.
No modifica la plantilla. Escribe en test-results/ (temporal, ignorado por Git) o, con --generar-linea-base, en referencia/.
"""
import argparse, hashlib, html, json, os, platform, re, shutil, subprocess, sys
import fitz
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'common'))
import hoja_pruebas as hp
AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.abspath(os.path.join(AQUI, '..', '..', '..', '..'))     # apps/api
PLANTILLAS = os.path.join(API, 'src', 'manufacturing-sheets', 'templates', 'coex')
FUENTE_PLANTILLA = os.path.join(PLANTILLAS, 'coex.template.html')   # fuente con marcadores @include
COMPOSITOR = os.path.join(API, 'src', 'manufacturing-sheets', 'tools', 'compose-template.mjs')
SALIDA = os.path.join(AQUI, 'test-results')
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
CHROME_FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer']   # parametros de impresion usados en la validacion
DPI_RASTER = 150
TOL_COORD = 0.15      # pt: tolerancia entre medidas de la linea base y las actuales
CAMPOS_COLOR = {'color_capa_interior', 'color_capa_intermedia', 'color_capa_exterior', 'color_bolsa_hex', 'color_cotas_internas_hex'}
BLOQUES_PERMITIDOS = {'<span class="sin-firma">SIN FIRMA</span>'}    # en pruebas solo se admite el marcador, nunca firmas reales
RE_HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
sin_comentarios = lambda t: re.sub(r'/\*.*?\*/|<!--.*?-->', '', t, flags=re.S)


def cargar_datos(ruta):
    j = json.load(open(ruta, encoding='utf-8'))
    plano = {}
    for k, v in j['datos'].items():
        plano[k] = html.escape(str(v), quote=True)                  # texto: siempre escapado
    for k, v in j['visual'].items():
        if k in CAMPOS_COLOR and not RE_HEX.match(v):
            raise ValueError('color invalido en %s: %r' % (k, v))   # colores: solo #RRGGBB
        plano[k] = v
    for k, v in j['firmas'].items():
        if v not in BLOQUES_PERMITIDOS:
            raise ValueError('bloque de firma no permitido en pruebas: %s' % k)
        plano[k] = v                                                # HTML de confianza (backend), solo el marcador SIN FIRMA
    return j, plano


def placeholders(texto):
    return set(re.findall(r'\{\{([^}]+)\}\}', sin_comentarios(texto)))


def renderizar_html(plantilla, plano):
    h = open(plantilla, encoding='utf-8').read()
    esperados, dados = placeholders(h), set(plano)
    faltan, sobran = sorted(esperados - dados), sorted(dados - esperados)
    for k, v in plano.items():
        h = h.replace('{{%s}}' % k, v)
    pendientes = len(re.findall(r'\{\{|\}\}', sin_comentarios(h)))
    return h, faltan, sobran, pendientes


def componer(destino):
    """Compone coex.template.html (+ componentes) en `destino` con el compositor de Node."""
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    subprocess.run(['node', COMPOSITOR, '--source', FUENTE_PLANTILLA, '--out', destino], capture_output=True, text=True, check=True)
    return destino


def version_chrome():
    r = subprocess.run(['powershell', '-NoProfile', '-Command', "(Get-Item '%s').VersionInfo.ProductVersion" % CHROME],
                       capture_output=True, text=True)
    return r.stdout.strip()


def imprimir_pdf(html_ruta, pdf_ruta):
    # PDF temporal nuevo y validado: nunca se analiza (ni se aprueba) un PDF anterior; si falla se informa la ruta y no se toca el existente
    hp.imprimir_pdf(CHROME, CHROME_FLAGS, html_ruta, pdf_ruta)


JS_SONDA = r'''<script>
addEventListener("load", function () {
  var hoja = document.querySelector(".hoja").getBoundingClientRect(), o = {};
  function m(k, e) { if (!e) return; var r = e.getBoundingClientRect();
    o[k] = {x0: +(.75*(r.left-hoja.left)).toFixed(2), y0: +(.75*(r.top-hoja.top)).toFixed(2), x1: +(.75*(r.right-hoja.left)).toFixed(2), y1: +(.75*(r.bottom-hoja.top)).toFixed(2)}; }
  var q = function (s) { return document.querySelector(s); };
  m("encabezado", q(".encabezado")); m("logo", q(".logo")); m("titulo", q(".titulo"));
  m("info_general", q("table.t-general tbody")); m("medidas", q("#seccion-medidas")); m("capas", q("#seccion-coex-capas"));
  m("peso_bolsa", q("#seccion-peso-bolsa")); m("dibujo_bolsa_encabezado", q("#encabezado-dibujo-bolsa"));
  m("etiqueta", q("#seccion-etiqueta-valor")); m("dibujo_bolsa", q("#seccion-dibujo-bolsa"));
  m("firmas_zona", q("#seccion-firmas")); m("firma_elaboro", q("#firma_elaboro")); m("firma_aprobo", q("#firma_aprobo"));
  [["info", "table.t-general tbody"], ["medidas", "#seccion-medidas"], ["capas", "#seccion-coex-capas"]].forEach(function (p) {
    document.querySelectorAll(p[1] + " tr").forEach(function (tr, i) { m("fila_" + p[0] + "_" + (i + 1), tr); }); });
  var pre = document.createElement("pre"); pre.id = "out"; pre.textContent = JSON.stringify(o); document.body.appendChild(pre);
});
</script></body>'''


def medir_dom(html_ruta):
    sonda = html_ruta.replace('.html', '.sonda.html')
    t = open(html_ruta, encoding='utf-8-sig').read().replace('</body>', JS_SONDA)
    open(sonda, 'w', encoding='utf-8-sig', newline='\n').write(t)
    try: return hp.medir_dom(CHROME, sonda)
    finally: os.remove(sonda)


def medir_pdf(pdf_ruta):
    pdf = fitz.open(pdf_ruta); pg = pdf[0]
    palabras = [[w[4], round(w[0], 1), round(w[1], 1), round(w[2], 1), round(w[3], 1)] for w in pg.get_text('words')]
    logo = [list(map(lambda v: round(v, 2), im['bbox'])) for im in pg.get_image_info()]
    fuentes = sorted({f[3] for f in pg.get_fonts()})
    return {'paginas': len(pdf), 'tamano_pt': [pg.rect.width, pg.rect.height], 'logo_bbox': logo,
            'ultimo_texto_bottom': round(max(p[4] for p in palabras), 1), 'fuentes_incrustadas': fuentes}, palabras, pg


def pixmap_a_array(pix):
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)


def producir(plantilla, datos_ruta, carpeta):
    os.makedirs(os.path.join(carpeta, 'images'), exist_ok=True)
    shutil.copy(os.path.join(PLANTILLAS, 'images', 'DC_logo.jpg'), os.path.join(carpeta, 'images', 'DC_logo.jpg'))
    j, plano = cargar_datos(datos_ruta)
    h, faltan, sobran, pendientes = renderizar_html(plantilla, plano)
    html_ruta = os.path.join(carpeta, 'confpmg04.html'); pdf_ruta = os.path.join(carpeta, 'confpmg04.pdf')
    open(html_ruta, 'w', encoding='utf-8-sig', newline='\n').write(h)
    imprimir_pdf(html_ruta, pdf_ruta)
    pdf_info, palabras, pg = medir_pdf(pdf_ruta)
    pix = pg.get_pixmap(dpi=DPI_RASTER); hp.guardar_png(pix, os.path.join(carpeta, 'confpmg04.png'))
    dom = medir_dom(html_ruta)
    return dict(faltan=faltan, sobran=sobran, pendientes=pendientes, pdf=pdf_info, palabras=palabras, dom=dom, png=pix)


def entorno():
    return {'motor': 'Google Chrome (headless, --print-to-pdf)', 'version_chrome': version_chrome(), 'parametros_chrome': CHROME_FLAGS,
            'so': platform.platform(), 'pymupdf': fitz.__doc__.split('\n')[0] if fitz.__doc__ else fitz.VersionBind,
            'dpi_raster': DPI_RASTER, 'tamano_pagina': 'letter portrait (612 x 792 pt)', '@page': 'size: letter portrait; margin: 0',
            'fuente_solicitada': 'Calibri, Carlito, "Segoe UI", Arial, Helvetica, sans-serif', 'tolerancia_coordenadas_pt': TOL_COORD}


def sha(ruta):
    return hashlib.sha256(open(ruta, 'rb').read()).hexdigest()


def escribir_sumas(plantilla_compuesta):
    """HM-Template.html = plantilla compuesta; las imagenes salen de templates/coex/images."""
    with open(os.path.join(AQUI, 'fuente', 'SHA256SUMS.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('%s  HM-Template.html\n' % sha(plantilla_compuesta))
        for ruta in ('images/DC_logo.jpg', 'images/COEX_Curvas_Trazado_Original.svg'):
            f.write('%s  %s\n' % (sha(os.path.join(PLANTILLAS, ruta)), ruta))


def generar_linea_base(plantilla, datos_ruta):
    ref = os.path.join(AQUI, 'referencia')
    plantilla = plantilla or componer(os.path.join(SALIDA, 'HM-Template.composed.html'))
    escribir_sumas(plantilla)
    r = producir(plantilla, datos_ruta, ref)
    assert not r['faltan'] and not r['sobran'] and r['pendientes'] == 0, (r['faltan'], r['sobran'], r['pendientes'])
    json.dump({'dom_pt': r['dom'], 'pdf': r['pdf'], 'nota': 'Medidas del HTML renderizado (pt desde el borde superior izquierdo de la pagina; x medido desde el borde de .hoja). Tolerancia %.2f pt.' % TOL_COORD},
              open(os.path.join(ref, 'coordenadas.json'), 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
    json.dump(r['palabras'], open(os.path.join(ref, 'texto_posiciones.json'), 'w', encoding='utf-8', newline='\n'), ensure_ascii=False)
    json.dump(entorno(), open(os.path.join(ref, 'entorno.json'), 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
    print('Linea base generada en', ref)


def comparar(plantilla, datos_ruta):
    ref = os.path.join(AQUI, 'referencia')
    plantilla = plantilla or componer(os.path.join(SALIDA, 'HM-Template.composed.html'))
    r = producir(plantilla, datos_ruta, SALIDA)
    base = json.load(open(os.path.join(ref, 'coordenadas.json'), encoding='utf-8'))
    base_txt = json.load(open(os.path.join(ref, 'texto_posiciones.json'), encoding='utf-8'))
    env_base = json.load(open(os.path.join(ref, 'entorno.json'), encoding='utf-8')); env = entorno()
    fallos = []
    # 0. huella de la plantilla (informativa: la regresion real es la de coordenadas y pixeles)
    sumas = {l.split('  ')[1].strip(): l.split('  ')[0] for l in open(os.path.join(AQUI, 'fuente', 'SHA256SUMS.txt'), encoding='utf-8') if l.strip()}
    huella = ('igual a SHA256SUMS (la composicion reproduce byte a byte la plantilla validada)' if sha(plantilla) == sumas.get('HM-Template.html')
              else 'DISTINTA de SHA256SUMS (el HTML compuesto cambio; la regresion de coordenadas y pixeles decide si hay efecto visual)')
    # 1. placeholders
    if r['faltan']: fallos.append('placeholders sin dato: %s' % r['faltan'])
    if r['sobran']: fallos.append('datos sin placeholder: %s' % r['sobran'])
    if r['pendientes']: fallos.append('placeholders pendientes tras renderizar: %d' % r['pendientes'])
    # 2. pagina
    if r['pdf']['paginas'] != 1: fallos.append('paginas: %d (se esperaba 1)' % r['pdf']['paginas'])
    if r['pdf']['tamano_pt'] != base['pdf']['tamano_pt']: fallos.append('tamano de pagina %s' % r['pdf']['tamano_pt'])
    # 3. coordenadas del DOM
    maxd = 0.0
    for k, v in base['dom_pt'].items():
        a = r['dom'].get(k)
        if a is None: fallos.append('falta la medida %s' % k); continue
        for c in ('x0', 'y0', 'x1', 'y1'):
            d = abs(a[c] - v[c]); maxd = max(maxd, d)
            if d > TOL_COORD: fallos.append('%s.%s: %.2f -> %.2f (dif %.2f pt)' % (k, c, v[c], a[c], d))
    # 4. texto y posiciones del PDF
    if len(r['palabras']) != len(base_txt): fallos.append('numero de palabras en el PDF: %d -> %d' % (len(base_txt), len(r['palabras'])))
    else:
        for b, a in zip(base_txt, r['palabras']):
            if b[0] != a[0] or max(abs(b[i] - a[i]) for i in range(1, 5)) > TOL_COORD:
                fallos.append('palabra %r: %s -> %s' % (b[0], b[1:], a[1:]))
    # 5. pixeles: se cuentan siempre; solo cuentan como falla si el entorno coincide con la linea base
    claves = ('version_chrome', 'so', 'pymupdf', 'parametros_chrome', 'dpi_raster')
    distintas = [k for k in claves if env[k] != env_base[k]]
    entorno_igual = not distintas
    A = pixmap_a_array(r['png']); B = pixmap_a_array(fitz.Pixmap(os.path.join(ref, 'confpmg04.png')))
    if A.shape != B.shape:
        pixeles = 'la imagen cambio de tamano %s -> %s' % (B.shape, A.shape)
        if entorno_igual: fallos.append(pixeles)
    else:
        n = int((A != B).any(axis=2).sum())
        pixeles = '%d pixeles distintos' % n
        if entorno_igual and n: fallos.append('imagen: %d pixeles distintos' % n)
        if not entorno_igual:
            pixeles += ' (INFORMATIVO: el entorno difiere en %s; solo es concluyente si coincide)' % distintas
    if not entorno_igual:
        print('Entorno actual: Chrome %s | linea base: Chrome %s' % (env['version_chrome'], env_base['version_chrome']))
    print('Plantilla compuesta:' if plantilla.endswith('composed.html') else 'Plantilla:', plantilla)
    print('Huella de la plantilla:', huella)
    print('Entorno igual al de la linea base:', 'SI' if entorno_igual else 'NO')
    print('Placeholders: faltan %d, sobran %d, pendientes %d' % (len(r['faltan']), len(r['sobran']), r['pendientes']))
    print('Paginas:', r['pdf']['paginas'], '| ultimo texto bottom:', r['pdf']['ultimo_texto_bottom'], 'pt')
    print('Mayor diferencia de coordenadas: %.2f pt (tolerancia %.2f)' % (maxd, TOL_COORD))
    print('Pixeles:', pixeles)
    if fallos:
        print('\nRESULTADO: FALLA (%d)' % len(fallos)); [print(' -', f) for f in fallos[:25]]
        return 1
    print('\nRESULTADO: OK'); return 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--generar-linea-base', action='store_true')
    ap.add_argument('--plantilla', default=None)
    ap.add_argument('--datos', default=os.path.join(AQUI, 'entrada', 'confpmg04.datos.json'))
    a = ap.parse_args()
    try:
        if a.generar_linea_base:
            generar_linea_base(a.plantilla, a.datos)
        else:
            sys.exit(comparar(a.plantilla, a.datos))
    except hp.ErrorRegeneracion as e:
        print('\nRESULTADO: FALLA (1)\n - ERROR DE REGENERACIÓN (no se compara ningún PDF anterior): %s' % e)
        sys.exit(1)
