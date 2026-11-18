"""Verificación integral del PROTOTIPO: la vista previa real (servicio compilado) de las ocho hojas se imprime a PDF con Chrome y se comprueba.

Uso:  python verificar_prototipo.py [--salida CARPETA]       (o: npm run test:sheets-prototype; requiere `npm run build --workspace=@daubert/api`)
Requiere: Node, Google Chrome (CHROME_PATH si no está en la ruta por defecto) y PyMuPDF.

Casos «normal» (las ocho hojas): una sola página carta, al menos 20 pt libres al final, todo el texto presente, firmas SIN FIRMA, sin placeholders pendientes.
Casos «largo» (etiqueta y descripción extensas): ningún texto se pierde en silencio (se verifica en TODAS las páginas); el número de páginas se informa como LÍMITE si excede una.
Escribe en test-results/ (ignorado por Git) HTML y PDF. Código de salida 0 = OK, 1 = falla.
"""
import argparse, json, os, re, subprocess, sys
import fitz

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import hoja_pruebas as hp

AQUI = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get('CHROME_PATH', r'C:\Program Files\Google\Chrome\Application\chrome.exe')
FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer']
norm = lambda t: re.sub(r'\s+', ' ', t).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default=os.path.join(AQUI, 'test-results'))
    args = ap.parse_args()
    os.makedirs(args.salida, exist_ok=True)
    r = subprocess.run(['node', os.path.join(AQUI, 'generar_prototipo.cjs'), args.salida], capture_output=True, text=True, encoding='utf-8')
    print((r.stdout + r.stderr).strip())
    if r.returncode != 0: return 1
    casos = {c['id']: c for c in json.load(open(os.path.join(AQUI, 'casos.json'), encoding='utf-8'))}
    resumen = {c['id']: c for c in json.load(open(os.path.join(args.salida, 'resumen.json'), encoding='utf-8'))}
    fallas, limites = [], []
    for id_, caso in casos.items():
        info = resumen[id_]
        html = os.path.join(args.salida, id_ + '.html')
        pdf_ruta = os.path.join(args.salida, id_ + '.pdf')
        mala = []
        if info['bloqueado']: mala.append('bloqueado: ' + info['bloqueado'])
        if not info['completo']: mala.append('datos técnicos incompletos: %s' % info['faltantes'])
        if any(a.startswith('Validación de la familia') for a in info['advertencias']): mala.append('el validador de la familia rechazó los datos: %s' % info['advertencias'])
        texto_html = open(html, encoding='utf-8').read()
        sin_comentarios = re.sub(r'<!--.*?-->|/\*.*?\*/', '', texto_html, flags=re.S)
        if re.search(r'\{\{[A-Za-z0-9_]+\}\}', sin_comentarios): mala.append('quedan placeholders sin resolver')
        try:
            hp.imprimir_pdf(CHROME, FLAGS, html, pdf_ruta)
        except hp.ErrorRegeneracion as e:
            fallas.append('%s: %s' % (id_, e)); continue
        with fitz.open(pdf_ruta) as pdf:
            paginas = pdf.page_count
            p1 = pdf[0]
            ancho, alto = round(p1.rect.width), round(p1.rect.height)
            todo = norm(hp.texto_de_todas_las_paginas(pdf))
            fin = max([w[3] for w in p1.get_text('words')] + [0])
        d = caso['datos']
        if (ancho, alto) != (612, 792): mala.append('la página no es carta (%dx%d)' % (ancho, alto))
        for etiqueta in ('SIN FIRMA',):
            if todo.count(etiqueta) < 2: mala.append('faltan los dos bloques «SIN FIRMA»')
        # Integridad del texto: nada capturado puede desaparecer (se compara palabra por palabra; la descripción y la etiqueta salen escapadas pero legibles).
        for campo in ('codigo', 'descripcion', 'etiqueta', 'calibre'):
            valor = norm(d.get(campo, ''))
            if valor and not all(palabra in todo for palabra in valor.split(' ')): mala.append('texto de «%s» recortado o ausente en el PDF' % campo)
        if caso['tipo'] == 'normal':
            if paginas != 1: mala.append('ocupa %d páginas (debe ser una)' % paginas)
            elif hp.fallo_holgura(fin): mala.append('holgura insuficiente al final de la página (%.1f pt)' % (hp.LIMITE_Y - fin))
        else:
            if paginas != 1: limites.append('%s: LÍMITE DETECTADO: %d páginas (el texto sigue completo)' % (id_, paginas))
        print('%-36s %s  páginas=%d  fin=%.1f pt' % (id_, 'OK ' if not mala else 'FALLA', paginas, fin))
        for m in mala: fallas.append('%s: %s' % (id_, m))
    for l in limites: print(l)
    if fallas:
        print('\nFALLAS:'); [print(' -', f) for f in fallas]
        return 1
    print('\nPrototipo: las %d hojas pasan.' % len(casos))
    return 0


if __name__ == '__main__':
    sys.exit(main())
