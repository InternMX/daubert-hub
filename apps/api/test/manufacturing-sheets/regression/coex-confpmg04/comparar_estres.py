"""Pruebas de descripción (1 renglón, 2 renglones y extrema) de COEX, INDEPENDIENTES de la regresión histórica CONFPMG04.

No usa ni modifica `entrada/confpmg04.datos.json`, `referencia/` ni la línea base: reutiliza solo el motor de composición e impresión de
`comparar_regresion.py` (sin ejecutar su comparación) con datos propios de `estres/`. Al terminar comprueba que la entrada y la referencia
históricas siguen byte a byte iguales.

  1 renglón / 2 renglones  → casos de producción: una página carta, holgura >= 20 pt, sin placeholders pendientes y texto íntegro.
  extrema (esperado=estres) → debe desbordar: se reporta LÍMITE DETECTADO (páginas y excedente) y el documento queda marcado como NO apto para emisión.

Uso:  python comparar_estres.py [--datos RUTA.json ...] [--salida CARPETA]      # o: npm run test:sheets-coex-estres
"""
import argparse, glob, hashlib, json, os, sys

import fitz

sys.stdout.reconfigure(encoding='utf-8')
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import comparar_regresion as cr          # motor de composición/impresión de la regresión (no se ejecuta su comparación)
hp = cr.hp

SALIDA = os.path.join(AQUI, 'test-results-estres')
HISTORICOS = [os.path.join(AQUI, 'entrada', 'confpmg04.datos.json')] + sorted(glob.glob(os.path.join(AQUI, 'referencia', '*')))


def huellas():
    out = {}
    for r in HISTORICOS:
        if os.path.isfile(r): out[os.path.relpath(r, AQUI)] = hashlib.sha256(open(r, 'rb').read()).hexdigest()
    return out


def verificar(datos_ruta, plantilla):
    j = json.load(open(datos_ruta, encoding='utf-8'))
    caso, esperado = j['caso'], j.get('esperado', 'valido')
    carpeta = os.path.join(SALIDA, caso)
    hp.preparar_carpeta(carpeta)
    r = cr.producir(plantilla, datos_ruta, carpeta)            # PDF temporal nuevo y validado (hp.imprimir_pdf); nunca un PDF anterior
    fallos = []
    if r['faltan']: fallos.append('placeholders sin dato: %s' % r['faltan'])
    if r['sobran']: fallos.append('datos sin placeholder: %s' % r['sobran'])
    if r['pendientes']: fallos.append('placeholders pendientes tras renderizar: %d' % r['pendientes'])
    paginas = r['pdf']['paginas']
    if paginas != 1: fallos.append('páginas: %d (se esperaba 1)' % paginas)
    fin = r['dom']['firmas_zona']['y1']
    fallos += hp.fallos_de_limite(fin)
    with fitz.open(os.path.join(carpeta, 'confpmg04.pdf')) as pdf:
        texto = ' '.join(hp.texto_de_todas_las_paginas(pdf).split())
        palabras = [(w[0], w[1], w[2], w[3], w[4]) for w in pdf[0].get_text('words')]
    for k, v in j['datos'].items():
        if ' '.join(str(v).split()) and ' '.join(str(v).split()) not in texto: fallos.append('falta el valor de %s' % k)
    if j.get('renglones_descripcion') is not None:
        n = hp.contar_renglones_descripcion(palabras)
        if n != j['renglones_descripcion']: fallos.append('la descripción ocupa %d renglones (se esperaban %d)' % (n, j['renglones_descripcion']))
    fallos, limites = hp.clasificar_limites(esperado, fallos)
    extra = hp.informar_limites(carpeta, esperado, limites, paginas, fin)
    print('%-26s págs %d | pend. %d | firmas hasta %.1f pt | libre %.1f pt | %s%s' % (
        caso, paginas, r['pendientes'], fin, hp.LIMITE_Y - fin, 'OK' if not fallos else 'FALLA (%d)' % len(fallos), extra))
    for f in fallos[:15]: print('   -', f)
    return fallos, (esperado == 'estres' and not limites)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--datos', nargs='*')
    ap.add_argument('--salida', help='carpeta de resultados alternativa (por defecto test-results-estres)')
    a = ap.parse_args()
    if a.salida: SALIDA = os.path.abspath(a.salida)
    archivos = a.datos or sorted(glob.glob(os.path.join(AQUI, 'estres', '*.datos.json')))
    antes = huellas()
    print('COEX: casos de descripción independientes de la regresión CONFPMG04 | casos:', len(archivos))
    total = 0
    try:
        plantilla = cr.componer(os.path.join(SALIDA, 'HM-Template.composed.html'))
        for f in archivos:
            try:
                fallos, sin_limite = verificar(f, plantilla)
                total += len(fallos)
                if sin_limite: print('   · el caso de estrés cabe en la página (no se detectó límite)')
            except (hp.ErrorRegeneracion, hp.FueraDePagina) as e:
                print('%-26s ERROR DE REGENERACIÓN/MEDICIÓN: %s | FALLA (1)' % (os.path.basename(f), e)); total += 1
    finally:
        if huellas() != antes:
            print('ERROR: cambió la entrada o la referencia histórica de CONFPMG04'); total += 1
    print('Entrada y referencia históricas de CONFPMG04: sin cambios' if huellas() == antes else '')
    print('\nRESULTADO:', 'OK' if not total else 'FALLA (%d)' % total)
    sys.exit(1 if total else 0)
