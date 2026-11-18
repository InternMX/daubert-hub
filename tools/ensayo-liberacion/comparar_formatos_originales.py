# Material de revisión visual de los ocho formatos (Fase 6E): compara el PDF exportado del Excel ORIGINAL con el PDF generado por el Gestor (datos sintéticos).
# Solo lee PDF y escribe en la carpeta de salida (fuera del repositorio). No decide la aprobación: mide y señala lo que las personas de Manufactura deben mirar.
#   python comparar_formatos_originales.py <carpeta_originales> <carpeta_generados> <carpeta_salida>
# Salidas: <formato>_COMPARACION.png (original | generado), metricas.json y Revision_Ocho_Formatos.pdf (comparación + ficha de aprobación por formato).
import sys, os, json, re, collections
import fitz  # PyMuPDF

ORIG, GEN, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
FORMATOS = [('Bolsa Plana 1', 'Bolsa_Plana_1', 'Bolsa Plana 1'), ('Hojas', 'Hojas', 'Hoja Paq'), ('Bolsa Fuelle', 'Bolsa_Fuelle', 'Bolsa Fuelle'), ('Bolsa Natural', 'Bolsa_Natural', 'Bolsa Natural'),
            ('Rollo Continuo', 'Rollo_Continuo', 'Rollo Continuo'), ('Termoencogible', 'Termoencogible', 'Termoencogible'), ('COEX Azul', 'COEX_Azul', 'COEX Azul'), ('COEX Verde', 'COEX_Verde', 'COEX Verde')]
# Texto que identifica cada formato en el PDF generado (título o rasgo propio de la plantilla).
RASGOS = {'Bolsa Plana 1': ['BOLSA'], 'Hojas': ['HOJA'], 'Bolsa Fuelle': ['FUELLE'], 'Bolsa Natural': ['FUELLE', 'NATURAL'], 'Rollo Continuo': ['ROLLO'], 'Termoencogible': ['TERMOENCOGIBLE'], 'COEX Azul': ['COEX'], 'COEX Verde': ['COEX']}

def norm(s): return re.sub(r'[^a-záéíóúñü]+', ' ', s.lower()).strip()

def medir(path):
    doc = fitz.open(path); p = doc[0]
    fuentes = collections.Counter(); tam = collections.Counter(); palabras = []
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                t = s['text'].strip()
                if not t: continue
                fuentes[re.sub(r'^[A-Z]{6}\+', '', s['font'])] += len(t); tam[round(s['size'], 1)] += len(t)
    for w in p.get_text('words'): palabras.append(w[4])
    cajas = [fitz.Rect(d['rect']) for d in p.get_drawings() if d.get('rect') is not None] + [fitz.Rect(b[:4]) for b in p.get_text('blocks')] + [fitz.Rect(i['bbox']) for i in p.get_image_info()]
    cajas = [c for c in cajas if c.width > 0.5 and c.height > 0.5 and c.width < p.rect.width * 0.999]
    u = fitz.Rect(cajas[0]) if cajas else fitz.Rect(p.rect)
    for c in cajas[1:]: u |= c
    u &= p.rect
    return {'paginas': doc.page_count, 'ancho_pt': round(p.rect.width, 1), 'alto_pt': round(p.rect.height, 1), 'fuentes': dict(fuentes.most_common(6)), 'tamanos_pt': dict(sorted(tam.items(), key=lambda x: -x[1])[:6]),
            'contenido_pt': [round(u.x0, 1), round(u.y0, 1), round(u.x1, 1), round(u.y1, 1)], 'margenes_pt': {'izq': round(u.x0, 1), 'sup': round(u.y0, 1), 'der': round(p.rect.width - u.x1, 1), 'inf': round(p.rect.height - u.y1, 1)},
            'imagenes': len(p.get_image_info()), 'palabras': len(palabras), 'rellenos': rellenos(p), 'texto': ' '.join(palabras)}, doc

def rellenos(p):   # colores de relleno predominantes (por área), como #RRGGBB
    area = collections.Counter()
    for d in p.get_drawings():
        c = d.get('fill'); rc = d.get('rect')
        if c is None or rc is None: continue
        h = '#%02X%02X%02X' % tuple(int(round(v * 255)) for v in c[:3])
        if h in ('#FFFFFF',): continue
        area[h] += abs(fitz.Rect(rc).width * fitz.Rect(rc).height)
    return [h for h, _ in area.most_common(5)]

def etiquetas(texto):   # frases de rótulo: secuencias en mayúsculas de 2+ letras (los rótulos de la hoja), sin cifras
    return set(m for m in re.findall(r'[A-ZÁÉÍÓÚÑ]{3,}', texto.upper()))

metricas = []; paquete = fitz.open()
for nombre, base, pestana in FORMATOS:
    po = os.path.join(ORIG, base + '_ORIGINAL.pdf'); pg = os.path.join(GEN, base + '_REV01.pdf')
    mo, do = medir(po); mg, dg = medir(pg)
    eo, eg = etiquetas(mo['texto']), etiquetas(mg['texto'])
    solo_orig = sorted(eo - eg); solo_gen = sorted(eg - eo)
    correcto = all(r in mg['texto'].upper() for r in RASGOS[nombre])
    obs = []
    fo = next(iter(mo['fuentes']), '?'); fg = next(iter(mg['fuentes']), '?')
    if norm(fo) != norm(fg): obs.append(f'Fuente: el original usa {", ".join(list(mo["fuentes"])[:3])}; el generado usa {", ".join(list(mg["fuentes"])[:3])} (Carlito sustituye a Calibri con las mismas métricas; revisar el trazo de las letras y los acentos).')
    if (mo['ancho_pt'], mo['alto_pt']) != (mg['ancho_pt'], mg['alto_pt']): obs.append(f'Tamaño de página distinto: original {mo["ancho_pt"]}x{mo["alto_pt"]} pt, generado {mg["ancho_pt"]}x{mg["alto_pt"]} pt.')
    else: obs.append(f'Mismo tamaño de página (Carta, {mg["ancho_pt"]}x{mg["alto_pt"]} pt).')
    if mo['paginas'] != mg['paginas']: obs.append(f'Páginas: original {mo["paginas"]}, generado {mg["paginas"]}.')
    dm = {k: round(mg['margenes_pt'][k] - mo['margenes_pt'][k], 1) for k in mo['margenes_pt']}
    grandes = {k: v for k, v in dm.items() if abs(v) >= 9}
    if grandes: obs.append('Márgenes del contenido distintos (generado menos original, en puntos; 72 pt = 1 pulgada): ' + ', '.join(f'{k} {v:+}' for k, v in grandes.items()) + '. Revisar la ubicación del recuadro en la hoja impresa.')
    else: obs.append('Márgenes del contenido equivalentes (diferencia menor de 1/8 de pulgada por lado).')
    cerca = {k: v for k, v in mg['margenes_pt'].items() if v < 21.6}
    if cerca: obs.append('IMPRESIÓN: en el generado hay contenido a menos de 0.3 pulgadas del borde (' + ', '.join(f'{k} {round(v / 72, 2)} in' for k, v in cerca.items()) + '). Imprimir en la impresora real y comprobar que no se corta.')
    if mo['rellenos'][:3] != mg['rellenos'][:3]: obs.append('Colores de relleno predominantes: original ' + ', '.join(mo['rellenos'][:4]) + '; generado ' + ', '.join(mg['rellenos'][:4]) + '. Revisar el color de las celdas de rótulo y de las bandas.')
    to = max(mo['tamanos_pt'], key=mo['tamanos_pt'].get) if mo['tamanos_pt'] else 0; tg = max(mg['tamanos_pt'], key=mg['tamanos_pt'].get) if mg['tamanos_pt'] else 0
    if abs(to - tg) >= 0.6: obs.append(f'Tamaño de letra predominante: original {to} pt, generado {tg} pt (el Excel se imprime a escala; comparar la altura real de la letra).')
    if solo_orig: obs.append('Rótulos del original que no aparecen con el mismo texto en el generado: ' + ', '.join(solo_orig[:18]) + (' …' if len(solo_orig) > 18 else '') + '. Pueden ser datos de ejemplo del Excel o rótulos renombrados: confirmar.')
    if solo_gen: obs.append('Texto del generado que no está en el original: ' + ', '.join(solo_gen[:18]) + (' …' if len(solo_gen) > 18 else '') + '. Incluye los datos sintéticos de la prueba y los responsables Generó/Revisó/Aprobó.')
    if mo['imagenes'] != mg['imagenes']: obs.append(f'Imágenes incrustadas: original {mo["imagenes"]}, generado {mg["imagenes"]} (el generado incluye firmas sintéticas; el dibujo del producto se traza de otra forma).')
    metricas.append({'formato': nombre, 'pestana_excel': pestana, 'original': os.path.basename(po), 'generado': os.path.basename(pg), 'generado_corresponde_al_formato': correcto,
                     'original_metricas': {k: v for k, v in mo.items() if k != 'texto'}, 'generado_metricas': {k: v for k, v in mg.items() if k != 'texto'}, 'diferencia_margenes_pt': dm, 'a_revisar': obs})
    # Comparación lado a lado
    z = 150 / 72; io = do[0].get_pixmap(matrix=fitz.Matrix(z, z)); ig = dg[0].get_pixmap(matrix=fitz.Matrix(z, z))
    hoja = paquete.new_page(width=792, height=612)
    hoja.insert_text((36, 30), f'{nombre} - comparación para revisión visual', fontsize=14, fontname='helv')
    hoja.insert_text((36, 46), f'Izquierda: ORIGINAL (pestaña «{pestana}» del Excel, exportada a PDF).   Derecha: GENERADO por el Gestor (datos SINTÉTICOS de prueba, {os.path.basename(pg)}).', fontsize=8, fontname='helv')
    ancho = (792 - 72 - 14) / 2; alto = ancho * 792 / 612
    r1 = fitz.Rect(36, 56, 36 + ancho, 56 + alto); r2 = fitz.Rect(792 - 36 - ancho, 56, 792 - 36, 56 + alto)
    hoja.insert_image(r1, pixmap=io); hoja.insert_image(r2, pixmap=ig); hoja.draw_rect(r1, color=(0.6, 0.6, 0.6), width=0.5); hoja.draw_rect(r2, color=(0.6, 0.6, 0.6), width=0.5)
    paquete.get_page_pixmap(paquete.page_count - 1, matrix=fitz.Matrix(2, 2)).save(os.path.join(OUT, base + '_COMPARACION.png'))
    # Ficha
    f = paquete.new_page(width=612, height=792); y = 50
    f.insert_text((50, y), f'Ficha de aprobación - {nombre}', fontsize=15, fontname='helv'); y += 22
    f.insert_text((50, y), f'Original: pestaña «{pestana}».   Generado: {os.path.basename(pg)} (datos sintéticos).', fontsize=9, fontname='helv'); y += 18
    f.insert_text((50, y), 'Puntos que la medición automática pide revisar:', fontsize=10, fontname='hebo'); y += 6
    for o in obs:
        caja = fitz.Rect(58, y, 562, y + 60); usado = f.insert_textbox(caja, '- ' + o, fontsize=8.5, fontname='helv'); y += (60 - usado) + 4 if usado >= 0 else 64
    y += 8; f.insert_text((50, y), 'Revisión del área de Manufactura (marcar):', fontsize=10, fontname='hebo'); y += 16
    for item in ['Encabezado, logotipo y título del formato', 'Datos del producto y del cliente en su lugar', 'Dibujo y cotas del producto (proporciones, flechas, colores)', 'Tabla de especificaciones / composición / presentación',
                 'Tipo de letra legible y tamaños adecuados', 'Colores (bandas, color del producto)', 'Responsables Generó / Revisó / Aprobó y espacios de firma', 'Impresión en Carta: márgenes y que nada se corte']:
        f.draw_rect(fitz.Rect(58, y - 8, 67, y + 1), width=0.7); f.insert_text((74, y), item + '      [  ] correcto   [  ] cambiar: ____________________________', fontsize=8.5, fontname='helv'); y += 17
    y += 10; f.insert_text((50, y), 'RESULTADO:    [  ] APROBADO      [  ] CAMBIOS SOLICITADOS      [  ] PENDIENTE', fontsize=11, fontname='hebo'); y += 22
    f.insert_text((50, y), 'Estado actual: PENDIENTE (sin revisión del área de Manufactura).', fontsize=9, fontname='helv'); y += 22
    f.insert_text((50, y), 'Cambios solicitados: ______________________________________________________________________', fontsize=9, fontname='helv'); y += 18
    f.insert_text((50, y), '_____________________________________________________________________________________', fontsize=9, fontname='helv'); y += 26
    f.insert_text((50, y), 'Nombre y firma: ______________________________      Fecha: ________________', fontsize=9, fontname='helv')
json.dump(metricas, open(os.path.join(OUT, 'metricas.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
paquete.save(os.path.join(OUT, 'Revision_Ocho_Formatos.pdf'))
for m in metricas:
    print(f"== {m['formato']} · corresponde={m['generado_corresponde_al_formato']} · original {m['original_metricas']['ancho_pt']}x{m['original_metricas']['alto_pt']} p{m['original_metricas']['paginas']} · generado {m['generado_metricas']['ancho_pt']}x{m['generado_metricas']['alto_pt']} p{m['generado_metricas']['paginas']}")
    print('   fuentes O:', list(m['original_metricas']['fuentes'])[:3], ' G:', list(m['generado_metricas']['fuentes'])[:3], ' margenes O:', m['original_metricas']['margenes_pt'], ' G:', m['generado_metricas']['margenes_pt'])
