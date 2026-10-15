"""Utilidades comunes de las pruebas de impresión de las Hojas de Instrucción de Manufactura (COEX, Bolsa Fuelle, Hoja Paq, Rollo Continuo,
Bolsa Plana 1 y Termoencogible). Centralizan los criterios compartidos; cada verificador conserva sus comprobaciones específicas.

1. Regeneración segura del PDF (VT-1): cada PDF se imprime en un archivo temporal NUEVO, se valida (Chrome terminó bien, el archivo existe, no está
   vacío, empieza por %PDF y se abre con PyMuPDF) y solo entonces reemplaza al anterior. Nunca se analiza un PDF previo: si algo falla se lanza
   ErrorRegeneracion con la ruta afectada y el resultado anterior queda intacto (no se borra nada por adelantado).
2. Criterios de impresión (VT-2/VT-3): una página carta, holgura mínima de 20 pt, clasificación de los casos de estrés (LÍMITE DETECTADO) y marca de
   «no apto para emisión productiva».
"""
import json, html, os, re, subprocess, sys, uuid
import fitz

LIMITE_Y = 792 - 0.55 * 72            # margen inferior de 0.55 in
ALTO_PAGINA = 792.0
HOLGURA_MINIMA = 20.0                 # espacio libre mínimo al final de la página en los documentos de producción
TIMEOUT_CHROME = 180
MARCA_NO_APTO = 'NO_APTO_PARA_EMISION.txt'


class ErrorRegeneracion(Exception):
    """El PDF (o la medición del DOM) no pudo regenerarse en esta ejecución: es un error real, nunca un límite aceptado."""


class FueraDePagina(Exception):
    """Se pidió leer un píxel fuera de la imagen de la página (no se convierte en límite aceptado)."""


# ---------------------------------------------------------------- regeneración segura
def _cmd(chrome):
    return [chrome] if isinstance(chrome, str) else list(chrome)


def _temporal(ruta):
    d, n = os.path.split(ruta)
    return os.path.join(d, '.nuevo-%s-%s' % (uuid.uuid4().hex[:8], n))


def _quitar_silencioso(ruta):
    try: os.remove(ruta)
    except OSError: pass


def _publicar(tmp, destino):
    """Reemplaza `destino` por `tmp`. Si el destino está bloqueado (p. ej. abierto en un visor) falla indicando la ruta; el original no cambia."""
    try:
        os.replace(tmp, destino)
    except OSError as e:
        _quitar_silencioso(tmp)
        raise ErrorRegeneracion('no se pudo escribir %s (¿está abierto en un visor o bloqueado?): %s' % (destino, e))


def imprimir_pdf(chrome, flags, html_ruta, pdf_ruta, timeout=TIMEOUT_CHROME):
    """Imprime `html_ruta` en `pdf_ruta` con Chrome y devuelve `pdf_ruta` solo si ESTA ejecución produjo un PDF válido."""
    tmp = _temporal(pdf_ruta)
    try:
        try:
            r = subprocess.run(_cmd(chrome) + list(flags) + ['--print-to-pdf=' + tmp, 'file:///' + html_ruta.replace('\\', '/')],
                               capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise ErrorRegeneracion('Chrome no terminó en %d s al generar %s' % (timeout, pdf_ruta))
        except OSError as e:
            raise ErrorRegeneracion('no se pudo ejecutar Chrome para generar %s: %s' % (pdf_ruta, e))
        if r.returncode != 0:
            cola = (r.stderr or b'').decode('utf-8', 'replace').strip().splitlines()[-1:] or ['']
            raise ErrorRegeneracion('Chrome falló (código %d) al generar %s: %s' % (r.returncode, pdf_ruta, cola[0][:200]))
        if not os.path.isfile(tmp):
            raise ErrorRegeneracion('Chrome terminó sin generar el PDF %s' % pdf_ruta)
        if os.path.getsize(tmp) == 0:
            raise ErrorRegeneracion('Chrome generó un PDF vacío para %s' % pdf_ruta)
        with open(tmp, 'rb') as f:
            if f.read(5) != b'%PDF-': raise ErrorRegeneracion('el archivo generado para %s no es un PDF' % pdf_ruta)
        try:
            with fitz.open(tmp) as d:
                if d.page_count < 1: raise ErrorRegeneracion('el PDF generado para %s no tiene páginas' % pdf_ruta)
        except ErrorRegeneracion:
            raise
        except Exception as e:
            raise ErrorRegeneracion('el PDF generado para %s está dañado: %s' % (pdf_ruta, e))
        _publicar(tmp, pdf_ruta)
        return pdf_ruta
    finally:
        _quitar_silencioso(tmp)


def guardar_png(pix, ruta):
    """Guarda el rasterizado de forma atómica; si `ruta` está bloqueada falla indicándola (no deja un PNG antiguo sin avisar)."""
    tmp = _temporal(ruta)
    try:
        pix.save(tmp)
    except Exception as e:
        _quitar_silencioso(tmp)
        raise ErrorRegeneracion('no se pudo generar el PNG %s: %s' % (ruta, e))
    _publicar(tmp, ruta)


def medir_dom(chrome, sonda_ruta, ventana='1000,2400', timeout=TIMEOUT_CHROME):
    """Vuelca el DOM del HTML con la sonda y devuelve el JSON medido. Cualquier fallo de Chrome es un ErrorRegeneracion."""
    try:
        r = subprocess.run(_cmd(chrome) + ['--headless', '--disable-gpu', '--window-size=' + ventana, '--dump-dom', 'file:///' + sonda_ruta.replace('\\', '/')],
                           capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ErrorRegeneracion('Chrome no terminó en %d s al medir %s' % (timeout, sonda_ruta))
    except OSError as e:
        raise ErrorRegeneracion('no se pudo ejecutar Chrome para medir %s: %s' % (sonda_ruta, e))
    salida = r.stdout.decode('utf-8', 'replace')
    m = re.search(r'<pre id="out">(.*?)</pre>', salida, re.S)
    if r.returncode != 0 or not m:
        raise ErrorRegeneracion('Chrome no devolvió las medidas del DOM de %s (código %d)' % (sonda_ruta, r.returncode))
    try:
        return json.loads(html.unescape(m.group(1)))
    except ValueError as e:
        raise ErrorRegeneracion('las medidas del DOM de %s no son JSON válido: %s' % (sonda_ruta, e))


def preparar_carpeta(carpeta, origen_imagenes=None):
    """Crea la carpeta de un caso SIN borrar nada (los resultados de otros casos y ejecuciones se conservan)."""
    os.makedirs(os.path.join(carpeta, 'images'), exist_ok=True)
    if origen_imagenes:
        import shutil
        shutil.copytree(origen_imagenes, os.path.join(carpeta, 'images'), dirs_exist_ok=True)


def pixel(img, escala, x, y):
    """Color RGB en (x, y) pt; si cae fuera de la imagen lanza FueraDePagina (nunca un IndexError ni un valor inventado)."""
    i, j = int(y * escala), int(x * escala)
    if not (0 <= i < img.shape[0] and 0 <= j < img.shape[1]):
        raise FueraDePagina('el punto (%.1f, %.1f) pt está fuera de la página (%d x %d px)' % (x, y, img.shape[1], img.shape[0]))
    return tuple(int(v) for v in img[i, j])


def ejecutar_casos(verificar, archivos, perfil):
    """Ejecuta cada caso; un ErrorRegeneracion (o FueraDePagina) se informa con su ruta y cuenta como falla real. Devuelve el total de fallas."""
    total = 0
    for f in archivos:
        try:
            total += len(verificar(f, perfil))
        except (ErrorRegeneracion, FueraDePagina) as e:
            try: nombre = json.load(open(f, encoding='utf-8')).get('caso', os.path.basename(f))
            except Exception: nombre = os.path.basename(f)
            print('%-40s ERROR DE REGENERACIÓN/MEDICIÓN: %s | FALLA (1)' % (nombre, e))
            total += 1
    return total


# ---------------------------------------------------------------- criterios de impresión
def fallos_de_limite(fin, holgura_minima=HOLGURA_MINIMA):
    """Fallas de límite vertical de una hoja de producción cuyo contenido termina en `fin` pt: holgura mínima y exceso del área imprimible."""
    f = []
    if LIMITE_Y - fin < holgura_minima: f.append('holgura vertical de %.1f pt (mínimo %.0f pt)' % (LIMITE_Y - fin, holgura_minima))
    if fin > LIMITE_Y: f.append('el contenido excede el área imprimible (%.1f > %.1f)' % (fin, LIMITE_Y))
    return f


def es_falla_de_limite(f):
    return f.startswith(('páginas:', 'holgura vertical', 'el contenido excede', 'texto fuera del')) or 'sale del área imprimible' in f


def es_consecuencia_de_limite(f):
    """Efectos secundarios de que parte de la hoja pase a otra página (las firmas dejan de estar en la primera, no se pueden leer sus píxeles...)."""
    return ('no contiene el marcador SIN FIRMA' in f or f.startswith(('tamaño de firma', 'las zonas de firma')) or 'fuera de la primera página' in f)


def clasificar_limites(esperado, fallos):
    """Devuelve (fallos_reales, limites). Solo en los casos de estrés las fallas de límite se separan de las reales; los placeholders pendientes,
    errores de regeneración, textos faltantes y cualquier otra falla nunca se convierten en límite."""
    if esperado != 'estres': return fallos, []
    limites = [f for f in fallos if es_falla_de_limite(f)]
    if limites: limites += [f for f in fallos if f not in limites and es_consecuencia_de_limite(f)]
    return [f for f in fallos if f not in limites], limites


def informar_limites(carpeta, esperado, limites, paginas, fin):
    """Escribe/borra la marca de «no apto para emisión», imprime el detalle y devuelve el sufijo de la línea de resultado."""
    marca = os.path.join(carpeta, MARCA_NO_APTO)
    if esperado != 'estres': return ''
    if not limites:
        _quitar_silencioso(marca)
        return ' [estrés: cabe en la página, sin límite excedido]'
    exc = max(0.0, fin - LIMITE_Y)
    detalle = 'páginas generadas: %d | holgura %.1f pt (mínimo %.0f pt)%s' % (paginas, LIMITE_Y - fin, HOLGURA_MINIMA, ' | excedente %.1f pt' % exc if exc else '')
    with open(marca, 'w', encoding='utf-8', newline='\n') as f:
        f.write('LÍMITE DETECTADO (caso de estrés). Este documento NO es apto para emisión productiva.\n%s\n' % detalle)
        for l in limites: f.write('- %s\n' % l)
    print('   ! LÍMITE DETECTADO (caso de estrés; NO apto para emisión productiva; no se truncó ni se escaló nada): ' + detalle)
    for l in limites[:6]: print('       · ' + l)
    return ' [ESTRÉS: LÍMITE DETECTADO, no apto para emisión, no es regresión]'
