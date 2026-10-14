"""Verificación de BOLSA_FUELLE etapa BF-1 (no es una regresión píxel a píxel: BF aún no tiene línea base validada).

Uso:  python verificar_bf1.py [--datos RUTA.json]
Requiere: Node, Google Chrome (headless), PyMuPDF y numpy (CHROME_PATH si Chrome no está en la ruta por defecto).
Escribe en test-results/ (ignorado por Git). Código de salida 0 = OK, 1 = falla.
"""
import argparse, html, json, os, re, shutil, subprocess, sys
import fitz
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
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

# Etiquetas y campos que debe presentar BF-1 (estructura del machote Excel, con la apariencia corporativa común)
ETIQUETAS = ['Cliente:', 'Fecha:', 'Resina VCI:', 'Producto:', 'Color:', 'Código DCMX:', 'Descripción:', 'Composición:', 'PMG', 'CP5000', 'Natural',
             'Presentación:', 'Rollo', 'Paquete', 'Cantidad Por Rollo o Paquete:', 'Medidas:', 'Unidad de Medidas:', 'Ancho:', 'Fuelle Derecho',
             'Largo:', 'Fuelle Izquierdo', 'Calibre:', 'PESO LB:']
COLORES = {'amarillo #FFFF00': (255, 255, 0), 'azul oscuro #244062': (36, 64, 98), 'azul claro #366092': (54, 96, 146)}


def main(datos_ruta):
    fallos, avisos = [], []
    perfil = json.load(open(PERFIL, encoding='utf-8'))
    datos = json.load(open(datos_ruta, encoding='utf-8'))
    assert datos['formato'] == perfil['formato'] == 'BOLSA_FUELLE'          # el formato es explícito, no depende del color
    shutil.rmtree(SALIDA, ignore_errors=True); os.makedirs(os.path.join(SALIDA, 'images'))
    shutil.copy(os.path.join(MS, 'templates', 'bolsa-fuelle', 'images', 'DC_logo.jpg'), os.path.join(SALIDA, 'images', 'DC_logo.jpg'))
    compuesta = os.path.join(SALIDA, 'bolsa-fuelle.composed.html')
    subprocess.run(['node', COMPOSITOR, '--source', FUENTE, '--out', compuesta], capture_output=True, text=True, check=True)
    h = open(compuesta, encoding='utf-8').read()
    # 1. placeholders: plantilla = perfil = datos
    plantilla_ph = set(re.findall(r'\{\{([^}]+)\}\}', sin_comentarios(h)))
    perfil_ph = set(sum(perfil['placeholders'].values(), []))
    dados = set(datos['datos']) | set(datos['visual']) | set(datos['firmas'])
    for nombre, a, b in (('plantilla vs perfil', plantilla_ph, perfil_ph), ('plantilla vs datos', plantilla_ph, dados)):
        if a != b: fallos.append('%s: sin dato %s / sin placeholder %s' % (nombre, sorted(a - b), sorted(b - a)))
    # 2. sustitución (texto escapado, colores #RRGGBB)
    for k, v in datos['datos'].items(): h = h.replace('{{%s}}' % k, html.escape(str(v), quote=True))
    for k, v in datos['visual'].items():
        if not RE_HEX.match(v): fallos.append('color inválido %s' % k)
        h = h.replace('{{%s}}' % k, v)
    pendientes = len(re.findall(r'\{\{|\}\}', sin_comentarios(h)))
    if pendientes: fallos.append('placeholders pendientes: %d' % pendientes)
    ruta_html = os.path.join(SALIDA, 'bolsa-fuelle.html'); ruta_pdf = os.path.join(SALIDA, 'bolsa-fuelle.pdf')
    open(ruta_html, 'w', encoding='utf-8-sig', newline='\n').write(h)
    subprocess.run([CHROME] + CHROME_FLAGS + ['--print-to-pdf=' + ruta_pdf, 'file:///' + ruta_html.replace('\\', '/')], capture_output=True, check=True)
    # 3. página
    pdf = fitz.open(ruta_pdf); pg = pdf[0]
    if len(pdf) != 1: fallos.append('páginas: %d (se esperaba 1)' % len(pdf))
    if (pg.rect.width, pg.rect.height) != (612.0, 792.0): fallos.append('tamaño de página %s' % pg.rect)
    palabras = pg.get_text('words')
    texto = ' '.join(w[4] for w in palabras)
    # 4. campos y etiquetas presentes
    for e in ETIQUETAS:
        if e not in texto: fallos.append('falta la etiqueta %r' % e)
    for k, v in datos['datos'].items():
        if k != 'sufijo_titulo' and str(v) not in ' '.join(texto.split()): fallos.append('falta el valor de %s: %r' % (k, v))
    if 'Hoja de Instrucción de Manufactura' not in texto.replace('  ', ' ') and not ('Hoja de Instrucción de' in texto and 'Manufactura' in texto):
        fallos.append('falta el título')
    # 5. sin superposiciones ni texto fuera del área
    for i, a in enumerate(palabras):
        for b in palabras[i + 1:]:
            ix, iy = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
            if ix > 0.8 and iy > 2: fallos.append('superposición: %r y %r' % (a[4], b[4]))
        if a[0] < 18 or a[2] > 18.5 + 493.4 + 1 or a[1] < 39 or a[3] > 792 - 39.6: fallos.append('texto fuera del área imprimible: %r' % a[4])
    # 6. colores impresos
    pix = pg.get_pixmap(dpi=150); pix.save(os.path.join(SALIDA, 'bolsa-fuelle.png'))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    conteos = {n: int((np.abs(img - np.array(c)).max(axis=2) <= 2).sum()) for n, c in COLORES.items()}
    for n, c in conteos.items():
        if c < 500: fallos.append('color %s casi no se imprime (%d px)' % (n, c))
    # 7. geometría de las secciones (informativa)
    sonda = ruta_html.replace('.html', '.sonda.html')
    js = ('<script>addEventListener("load",function(){var hj=document.querySelector(".hoja").getBoundingClientRect(),o={};'
          '["encabezado","seccion-datos-generales","seccion-medidas","seccion-peso"].forEach(function(id){var e=document.getElementById(id)||document.querySelector("."+id);'
          'var r=e.getBoundingClientRect();o[id]=[+(.75*(r.top-hj.top)).toFixed(1),+(.75*(r.bottom-hj.top)).toFixed(1),+(.75*(r.left-hj.left)).toFixed(1),+(.75*(r.right-hj.left)).toFixed(1)];});'
          'var p=document.createElement("pre");p.id="out";p.textContent=JSON.stringify(o);document.body.appendChild(p);});</script></body>')
    open(sonda, 'w', encoding='utf-8-sig', newline='\n').write(open(ruta_html, encoding='utf-8-sig').read().replace('</body>', js))
    dom = subprocess.run([CHROME, '--headless', '--disable-gpu', '--window-size=1000,2400', '--dump-dom', 'file:///' + sonda.replace('\\', '/')],
                         capture_output=True, text=True, encoding='utf-8').stdout
    os.remove(sonda)
    geo = json.loads(html.unescape(re.search(r'<pre id="out">(.*?)</pre>', dom, re.S).group(1)))
    ultimo = max(w[3] for w in palabras)
    print('Formato:', perfil['formato'], '| etapa', perfil['etapa'])
    print('Placeholders en la plantilla: %d | pendientes tras sustituir: %d' % (len(plantilla_ph), pendientes))
    print('Páginas: %d | último texto: %.1f pt (límite %.1f pt) | libre: %.1f pt' % (len(pdf), ultimo, 792 - 39.6, 792 - 39.6 - ultimo))
    for id_, (y0, y1, x0, x1) in geo.items():
        print('  %-24s y %6.1f - %6.1f  (%.1f pt)   x %5.1f - %5.1f' % (id_, y0, y1, y1 - y0, x0, x1))
    print('Píxeles de color corporativo:', conteos)
    print('Palabras detectadas:', len(palabras))
    if fallos:
        print('\nRESULTADO: FALLA (%d)' % len(fallos)); [print(' -', f) for f in fallos[:30]]
        return 1
    print('\nRESULTADO: OK'); return 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--datos', default=os.path.join(AQUI, 'datos', 'bf1-ejemplo.datos.json'))
    sys.exit(main(ap.parse_args().datos))
