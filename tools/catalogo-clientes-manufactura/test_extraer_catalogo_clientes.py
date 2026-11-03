"""Pruebas con PDF SINTÉTICOS (generados al vuelo; no hay datos reales). Ejecutar: python -m unittest discover -s tools/catalogo-clientes-manufactura"""
import sys
import tempfile
import unittest
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).parent))
import extraer_catalogo_clientes as ex  # noqa: E402


def hoja(ruta: Path, cliente: str, codigo: str, extra: str = '', cliente2: str = '') -> None:
    d = fitz.open()
    p = d.new_page(width=800, height=600)
    p.insert_text((40, 110 if cliente2 else 100), 'Cliente:', fontsize=10)
    p.insert_text((100, 98), cliente, fontsize=10)      # un nombre largo se parte: 1.ª línea sobre la etiqueta
    if cliente2:
        p.insert_text((100, 110), cliente2, fontsize=10)
    p.insert_text((520, 100), 'Fecha:', fontsize=10)
    p.insert_text((560, 100), '01/01/2020', fontsize=10)
    p.insert_text((40, 140), 'Código', fontsize=10)
    p.insert_text((80, 140), 'DCMX:', fontsize=10)
    p.insert_text((130, 140), codigo, fontsize=10)
    p.insert_text((40, 180), 'Descripción:', fontsize=10)
    p.insert_text((120, 180), 'BOLSA SINTETICA DE PRUEBA', fontsize=10)
    p.insert_text((40, 500), 'Texto de relleno para superar el mínimo de caracteres de un documento con texto. ' * 3, fontsize=7)
    d.save(ruta)
    d.close()


class Parser(unittest.TestCase):
    def test_prefijos_candidatos_2_a_5(self):
        self.assertEqual(ex.prefijos_candidatos('ANCBPMG01'), {2: 'AN', 3: 'ANC', 4: 'ANCB', 5: 'ANCBP'})
        self.assertEqual(ex.prefijos_candidatos('AB1'), {2: 'AB'})
        self.assertEqual(ex.prefijos_candidatos(''), {})

    def test_parser_actual_no_infalible(self):
        self.assertEqual(ex.prefijo_parser('SCHFPMG001'), 'SCH')
        self.assertIsNone(ex.prefijo_parser('ANCBPMG01'))

    def test_clave_cliente_agrupa_solo_formato(self):
        self.assertEqual(ex.clave_cliente('Audi México, S.A. de C.V.'), ex.clave_cliente('AUDI MEXICO'))
        self.assertNotEqual(ex.clave_cliente('ITE SOLUTIONS'), ex.clave_cliente('MAHLE AGS'))

    def test_parecido_es_solo_pista(self):
        self.assertTrue(ex.parecido('AUDI', 'AUDI MEXICO'))
        self.assertFalse(ex.parecido('ANCHOR', 'FAURECIA'))

    def test_limpiar_codigo(self):
        self.assertEqual(ex.limpiar_codigo(' sch fpmg 001 '), 'SCHFPMG001')


class Extraccion(unittest.TestCase):
    def test_lee_cliente_y_codigo_por_etiqueta_y_no_modifica_origen(self):
        with tempfile.TemporaryDirectory() as t:
            o = Path(t)
            ruta = o / 'SCHFPMG001 prueba.pdf'
            hoja(ruta, 'SCHAEFFLER MEXICO', 'SCHFPMG001')
            antes = ex.sha256_archivo(ruta)
            fila = ex.procesar(ruta, o)
            self.assertEqual(fila['estado'], 'OK')
            self.assertEqual(fila['cliente_raw'], 'SCHAEFFLER MEXICO')
            self.assertEqual(fila['codigo_dcmx'], 'SCHFPMG001')
            self.assertEqual(fila['descripcion'], 'BOLSA SINTETICA DE PRUEBA')
            self.assertEqual(ex.sha256_archivo(ruta), antes)

    def test_nombre_de_cliente_en_dos_lineas(self):
        with tempfile.TemporaryDirectory() as t:
            o = Path(t)
            ruta = o / 'A.pdf'
            hoja(ruta, 'ACS Internacional,', 'ACSFPMG001', cliente2='S de RL de CV')
            self.assertEqual(ex.procesar(ruta, o)['cliente_raw'], 'ACS Internacional, S de RL de CV')

    def test_pdf_sin_texto_se_reporta_escaneado_sin_ocr(self):
        with tempfile.TemporaryDirectory() as t:
            o = Path(t)
            d = fitz.open()
            d.new_page()
            d.save(o / 'E.pdf')
            d.close()
            self.assertEqual(ex.procesar(o / 'E.pdf', o)['estado'], 'ESCANEADO')

    def test_texto_sin_etiqueta_cliente(self):
        with tempfile.TemporaryDirectory() as t:
            o = Path(t)
            d = fitz.open()
            d.new_page().insert_text((40, 100), 'Documento cualquiera sin la etiqueta esperada. ' * 8, fontsize=7)
            d.save(o / 'X.pdf')
            d.close()
            self.assertEqual(ex.procesar(o / 'X.pdf', o)['estado'], 'SIN_ETIQUETA_CLIENTE')

    def test_main_genera_salida_y_exige_origen(self):
        with tempfile.TemporaryDirectory() as t:
            o, s = Path(t) / 'in', Path(t) / 'out'
            o.mkdir()
            hoja(o / 'AAAFPMG001.pdf', 'CLIENTE UNO', 'AAAFPMG001')
            hoja(o / 'AAAFPMG002.pdf', 'CLIENTE UNO', 'AAAFPMG002')
            sys.argv = ['x', '--origen', str(o), '--salida', str(s)]
            self.assertEqual(ex.main(), 0)
            self.assertTrue((s / 'catalogo_clientes_abreviaturas.xlsx').exists())
            self.assertEqual(sorted(p.name for p in o.iterdir()), ['AAAFPMG001.pdf', 'AAAFPMG002.pdf'])
            sys.argv = ['x', '--origen', str(Path(t) / 'no-existe'), '--salida', str(s)]
            self.assertEqual(ex.main(), 2)


if __name__ == '__main__':
    unittest.main()
