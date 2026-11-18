"""Pruebas de la utilidad común (hoja_pruebas.py): demuestran que ningún verificador puede aprobar un PDF antiguo ni confundir un error de
renderizado con un límite. Usan un «Chrome» simulado (script de Python) para provocar cada escenario.

Uso:  python test_hoja_pruebas.py        # o: npm run test:sheets-common
"""
import os, sys, tempfile, textwrap, unittest
import fitz

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hoja_pruebas as hp

FAKE = textwrap.dedent('''
    import os, sys, time
    modo = os.environ.get('FAKE_MODE', 'ok')
    destino = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--print-to-pdf=')), None)
    if '--dump-dom' in sys.argv:
        if modo == 'dom-ok': print('<pre id="out">{"a": [1, 2, 3, 4]}</pre>')
        sys.exit(1 if modo == 'falla' else 0)
    if modo == 'falla': sys.stderr.write('Chrome simulado: fallo'); sys.exit(3)
    if modo == 'lento': time.sleep(30)
    if modo == 'sin-archivo': sys.exit(0)                     # termina bien pero no escribe nada (salida no actualizada)
    if modo == 'vacio': open(destino, 'wb').close(); sys.exit(0)
    if modo == 'basura': open(destino, 'wb').write(b'esto no es un pdf'); sys.exit(0)
    if modo == 'pdf-roto': open(destino, 'wb').write(b'%PDF-1.4\\nroto'); sys.exit(0)
    import fitz
    d = fitz.open(); d.new_page(width=612, height=792).insert_text((72, 72), 'NUEVO'); d.save(destino)
''')


def pdf_con_texto(ruta, texto):
    d = fitz.open(); d.new_page(width=612, height=792).insert_text((72, 72), texto); d.save(ruta); d.close()


def texto_pdf(ruta):
    with fitz.open(ruta) as d: return d[0].get_text().strip()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.fake = os.path.join(self.dir, 'fake_chrome.py')
        with open(self.fake, 'w', encoding='utf-8') as f: f.write(FAKE)
        self.chrome = [sys.executable, self.fake]
        self.html = os.path.join(self.dir, 'h.html')
        with open(self.html, 'w') as f: f.write('<html></html>')
        self.pdf = os.path.join(self.dir, 'salida.pdf')

    def tearDown(self):
        os.environ.pop('FAKE_MODE', None)
        self.tmp.cleanup()

    def imprimir(self, modo, **kw):
        os.environ['FAKE_MODE'] = modo
        return hp.imprimir_pdf(self.chrome, ['--headless'], self.html, self.pdf, **kw)


class RegeneracionSegura(Base):
    def test_genera_un_pdf_nuevo(self):
        pdf_con_texto(self.pdf, 'ANTIGUO')
        self.assertEqual(self.imprimir('ok'), self.pdf)
        self.assertEqual(texto_pdf(self.pdf), 'NUEVO')
        self.assertEqual([n for n in os.listdir(self.dir) if n.startswith('.nuevo-')], [], 'no deben quedar temporales')

    def test_resultado_antiguo_no_se_aprueba(self):
        """Chrome termina con código 0 pero no actualiza la salida: existe un PDF válido de una ejecución previa y NO debe aceptarse."""
        pdf_con_texto(self.pdf, 'ANTIGUO')
        with self.assertRaises(hp.ErrorRegeneracion) as c: self.imprimir('sin-archivo')
        self.assertIn(self.pdf, str(c.exception))
        self.assertEqual(texto_pdf(self.pdf), 'ANTIGUO', 'el resultado anterior no se toca ni se borra')

    def test_pdf_no_generado(self):
        with self.assertRaises(hp.ErrorRegeneracion) as c: self.imprimir('sin-archivo')
        self.assertIn('sin generar', str(c.exception)); self.assertIn(self.pdf, str(c.exception))

    def test_fallo_de_chrome(self):
        pdf_con_texto(self.pdf, 'ANTIGUO')
        with self.assertRaises(hp.ErrorRegeneracion) as c: self.imprimir('falla')
        self.assertIn('código 3', str(c.exception)); self.assertIn(self.pdf, str(c.exception))
        self.assertEqual(texto_pdf(self.pdf), 'ANTIGUO')

    def test_chrome_inexistente(self):
        with self.assertRaises(hp.ErrorRegeneracion):
            hp.imprimir_pdf(os.path.join(self.dir, 'no-existe.exe'), [], self.html, self.pdf)

    def test_tiempo_agotado(self):
        with self.assertRaises(hp.ErrorRegeneracion) as c: self.imprimir('lento', timeout=2)
        self.assertIn('no terminó', str(c.exception))

    def test_archivos_invalidos(self):
        for modo in ('vacio', 'basura', 'pdf-roto'):
            with self.subTest(modo):
                with self.assertRaises(hp.ErrorRegeneracion): self.imprimir(modo)
                self.assertFalse(os.path.exists(self.pdf), 'un archivo inválido nunca se publica como resultado')

    @unittest.skipUnless(sys.platform == 'win32', 'el bloqueo de archivos por un visor es propio de Windows')
    def test_pdf_bloqueado(self):
        """El PDF anterior está abierto sin compartir (como en un visor): no se puede reemplazar, se informa la ruta y no se analiza el viejo."""
        import ctypes
        from ctypes import wintypes
        pdf_con_texto(self.pdf, 'ANTIGUO')
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.CreateFileW.restype = wintypes.HANDLE
        k.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        h = k.CreateFileW(self.pdf, 0x80000000, 0, None, 3, 0x80, None)      # GENERIC_READ, sin compartir, OPEN_EXISTING
        self.assertNotEqual(h, wintypes.HANDLE(-1).value, 'no se pudo bloquear el archivo de prueba')
        try:
            with self.assertRaises(hp.ErrorRegeneracion) as c: self.imprimir('ok')
            self.assertIn(self.pdf, str(c.exception)); self.assertIn('bloqueado', str(c.exception))
            self.assertEqual([n for n in os.listdir(self.dir) if n.startswith('.nuevo-')], [], 'no deben quedar temporales')
        finally:
            k.CloseHandle(h)
        self.assertEqual(texto_pdf(self.pdf), 'ANTIGUO')

    def test_png_bloqueado_o_invalido(self):
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 4, 4), False)
        ruta = os.path.join(self.dir, 'x.png')
        hp.guardar_png(pix, ruta); self.assertTrue(os.path.getsize(ruta) > 0)
        with self.assertRaises(hp.ErrorRegeneracion): hp.guardar_png(pix, os.path.join(self.dir, 'no-existe', 'x.png'))


class MedicionDom(Base):
    def test_dom_correcto(self):
        os.environ['FAKE_MODE'] = 'dom-ok'
        self.assertEqual(hp.medir_dom(self.chrome, self.html), {'a': [1, 2, 3, 4]})

    def test_fallo_de_chrome_en_el_dom(self):
        for modo in ('falla', 'ok'):        # código de error, o salida sin medidas
            os.environ['FAKE_MODE'] = modo
            with self.assertRaises(hp.ErrorRegeneracion): hp.medir_dom(self.chrome, self.html)


class Criterios(unittest.TestCase):
    def test_limites_de_produccion(self):
        self.assertEqual(hp.fallos_de_limite(hp.LIMITE_Y - 20.0), [])
        self.assertEqual(len(hp.fallos_de_limite(hp.LIMITE_Y - 19.9)), 1)
        self.assertEqual(len(hp.fallos_de_limite(hp.LIMITE_Y + 5)), 2)

    def test_valido_nunca_separa_limites(self):
        fallos = ['páginas: 2 (se esperaba 1)', 'holgura vertical de -3.0 pt (mínimo 20 pt)']
        self.assertEqual(hp.clasificar_limites('valido', fallos), (fallos, []))

    def test_estres_separa_solo_limites(self):
        fallos = ['páginas: 2 (se esperaba 1)', 'el contenedor firma_elaboro no contiene el marcador SIN FIRMA', 'placeholders pendientes: 2',
                  'el PDF no se regeneró', 'falta el valor de cliente']
        reales, lim = hp.clasificar_limites('estres', fallos)
        self.assertEqual(reales, ['placeholders pendientes: 2', 'el PDF no se regeneró', 'falta el valor de cliente'])
        self.assertEqual(len(lim), 2)

    def test_estres_sin_limite_en_firmas_no_los_oculta(self):
        """Sin una falla de límite, un problema de firmas sigue siendo una falla real (no se disfraza de consecuencia)."""
        reales, lim = hp.clasificar_limites('estres', ['el contenedor firma_elaboro no contiene el marcador SIN FIRMA'])
        self.assertEqual((len(reales), lim), (1, []))

    def test_pixel_fuera_de_pagina(self):
        import numpy as np
        img = np.zeros((1650, 1275, 3), dtype=int)
        self.assertEqual(hp.pixel(img, 150 / 72, 10, 10), (0, 0, 0))
        with self.assertRaises(hp.FueraDePagina): hp.pixel(img, 150 / 72, 10, 795)        # el caso que producía el IndexError de Bolsa Fuelle

    def test_marca_no_apto(self):
        with tempfile.TemporaryDirectory() as d:
            s = hp.informar_limites(d, 'estres', ['páginas: 2 (se esperaba 1)'], 2, 770.9)
            self.assertIn('LÍMITE DETECTADO', s); self.assertTrue(os.path.exists(os.path.join(d, hp.MARCA_NO_APTO)))
            s = hp.informar_limites(d, 'estres', [], 1, 600.0)
            self.assertIn('cabe', s); self.assertFalse(os.path.exists(os.path.join(d, hp.MARCA_NO_APTO)))
            self.assertEqual(hp.informar_limites(d, 'valido', [], 1, 600.0), '')


class TodosLosVerificadoresUsanLaUtilidad(unittest.TestCase):
    """Guarda estática: ningún verificador puede volver a imprimir/medir con Chrome por su cuenta (sin la validación del PDF nuevo)."""
    AQUI = os.path.dirname(os.path.abspath(__file__))
    ARCHIVOS = ['bolsa-fuelle/verificar_bolsa_fuelle.py', 'hoja-paq/verificar_hoja_paq.py', 'rollo-continuo/verificar_rollo_continuo.py',
                'bolsa-plana-1/verificar_bolsa_plana_1.py', 'termoencogible/verificar_termoencogible.py', 'regression/coex-confpmg04/comparar_regresion.py']

    def test_sin_chrome_directo_ni_borrado_masivo(self):
        for rel in self.ARCHIVOS:
            with self.subTest(rel):
                t = open(os.path.join(self.AQUI, '..', rel), encoding='utf-8').read()
                for uso in ('hp.imprimir_pdf(', 'hp.medir_dom(', 'hp.guardar_png('):
                    self.assertTrue(uso in t, 'falta ' + uso)
                for prohibido in ("'--print-to-pdf='", "'--dump-dom'", 'shutil.rmtree(SALIDA'):
                    self.assertFalse(prohibido in t, 'no debe usarse ' + prohibido + ' (Chrome directo o borrado masivo de resultados)')


CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')


@unittest.skipUnless(os.path.exists(CHROME), 'requiere Google Chrome (CHROME_PATH)')
class DesbordamientoBolsaFuelle(unittest.TestCase):
    """Reproduce el IndexError de Bolsa Fuelle (lectura de píxeles fuera de la imagen cuando el contenido pasa a la 2.ª página)."""
    AQUI = os.path.dirname(os.path.abspath(__file__))
    VERIFICADOR = os.path.join(AQUI, '..', 'bolsa-fuelle', 'verificar_bolsa_fuelle.py')
    DATOS = os.path.join(AQUI, '..', 'bolsa-fuelle', 'datos', 'descripcion-desborde.datos.json')

    def ejecutar(self, datos):
        import subprocess
        with tempfile.TemporaryDirectory() as salida:
            r = subprocess.run([sys.executable, self.VERIFICADOR, '--datos', datos, '--salida', salida], capture_output=True, text=True, encoding='utf-8')
            marca = os.path.exists(os.path.join(salida, 'descripcion-desborde', hp.MARCA_NO_APTO))
        return r, marca

    def test_estres_con_desborde_reporta_el_limite_sin_excepcion(self):
        r, marca = self.ejecutar(self.DATOS)
        self.assertNotIn('Traceback', r.stderr); self.assertNotIn('IndexError', r.stderr)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn('LÍMITE DETECTADO', r.stdout); self.assertIn('páginas generadas: 2', r.stdout); self.assertIn('excedente', r.stdout)
        self.assertTrue(marca, 'el documento de estrés debe quedar marcado como no apto para emisión')

    def test_el_mismo_desborde_como_caso_de_produccion_se_rechaza(self):
        import json
        d = json.load(open(self.DATOS, encoding='utf-8')); d['esperado'] = 'valido'
        with tempfile.TemporaryDirectory() as t:
            ruta = os.path.join(t, 'desborde-produccion.datos.json')
            with open(ruta, 'w', encoding='utf-8') as f: json.dump(d, f, ensure_ascii=False)
            r, _ = self.ejecutar(ruta)
        self.assertNotIn('Traceback', r.stderr)
        self.assertEqual(r.returncode, 1, 'un documento de producción que desborda no puede aprobarse')
        self.assertIn('páginas: 2', r.stdout); self.assertNotIn('LÍMITE DETECTADO', r.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
