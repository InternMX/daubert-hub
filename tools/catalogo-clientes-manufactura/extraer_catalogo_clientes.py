#!/usr/bin/env python3
"""
Extracción masiva (SOLO LECTURA) de las Hojas de Instrucción de Manufactura históricas para descubrir clientes y abreviaturas de código.

- Lee únicamente PDF de la carpeta de origen (no copia, modifica, renombra ni elimina nada). Escribe SOLO en la carpeta de salida.
- Extrae por POSICIÓN de las etiquetas «Cliente:», «Código DCMX:» y «Descripción:» (no infiere de la descripción ni mezcla etiquetas vecinas).
- Detecta prefijos candidatos de 2, 3, 4 y 5 letras (prioriza 3) y el prefijo del parser actual (apps/api/.../code-parser.ts), sin tratarlo como infalible.
- PDF sin texto (escaneados) se reportan aparte; NO se aplica OCR.
- Evita contar duplicados como evidencia independiente (mismo archivo por SHA-256 o mismo contenido normalizado).
- No consulta ni escribe PostgreSQL; no inventa nombres de empresas ni equipara nombres comerciales con razones sociales: las posibles equivalencias solo se SUGIEREN para revisión.

Uso:  python extraer_catalogo_clientes.py --origen CARPETA [--salida CARPETA]   (ver README.md)
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import fitz  # PyMuPDF
import pandas as pd

SALIDA_DEFECTO = Path('salida-catalogo-clientes')   # relativa al directorio de trabajo; configurable con --salida o DAUBERT_SALIDA
MIN_CARACTERES_TEXTO = 150          # menos que esto = PDF sin texto extraíble (escaneado)
TOLERANCIA_Y = 9.0                  # pt: el valor de una celda se imprime ligeramente por encima/debajo de su etiqueta

# Mismo patrón que apps/api/src/manufacturing-sheets/bind-product-interpreter/code-parser.ts (referencia, no infalible).
CODIGO_PARSER = re.compile(r'^(?P<prefijo>[A-Z0-9]*?[A-Z])(?P<material>[FP])(?P<clave>PW\d{2}|PMG|LDPE|NAT|ESD|XOW|CP)(?P<resto>.*)$')
CODIGO_VALIDO = re.compile(r'^[A-Z0-9][A-Z0-9._/\-]{3,39}$')


def sin_acentos(t: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKD', t) if not unicodedata.combining(c))


def norm(t: str) -> str:
    return re.sub(r'\s+', ' ', sin_acentos(t or '').upper()).strip()


# Palabras que son etiquetas del formato (detienen la lectura del valor hacia la derecha).
ETIQUETAS = {'FECHA:', 'RESINA', 'VCI:', 'CI:', 'PRODUCTO:', 'COLOR:', 'CODIGO', 'CODIGO:', 'DCMX:', 'DESCRIPCION:', 'COMPOSICION:', 'PRESENTACION:',
             'ANCHO:', 'LARGO:', 'CALIBRE:', 'PESO', 'CANTIDAD', 'MEDIDAS:', 'UNIDAD', 'NOTAS:', 'ELABORO', 'APROBO', 'CLIENTE:', 'CLIENTE'}


def es_etiqueta(palabra: str) -> bool:
    n = norm(palabra)
    return n in ETIQUETAS or (n.endswith(':') and len(n) > 2)


def banda(words: list, etiqueta: tuple, tolerancia: float = TOLERANCIA_Y) -> list:
    cy = (etiqueta[1] + etiqueta[3]) / 2
    return sorted((w for w in words if abs((w[1] + w[3]) / 2 - cy) <= tolerancia and w is not etiqueta), key=lambda w: w[0])


def valor_derecha(words: list, etiqueta_fin: tuple, etiqueta_ini: tuple | None = None) -> str:
    """Texto que sigue a una etiqueta en su misma fila, hasta la siguiente etiqueta."""
    x_ini = etiqueta_fin[2] - 1
    partes: list[str] = []
    for w in banda(words, etiqueta_fin):
        if w[0] < x_ini or (etiqueta_ini and w is etiqueta_ini):
            continue
        if es_etiqueta(w[4]):
            break
        partes.append(w[4])
    return re.sub(r'\s+', ' ', ' '.join(partes)).strip()


def valor_celda(words: list, etiqueta: tuple, arriba: float = 14.0) -> str:
    """Valor de una celda que puede ocupar VARIAS líneas (un nombre largo se parte: la primera línea sale ligeramente por encima de la etiqueta y la continuación en su fila).
    Región: a la derecha de la etiqueta y por debajo de `arriba` pt sobre ella; se detiene en la primera etiqueta que haya a su derecha (p. ej. «Fecha:», «Resina VCI:»)."""
    x_ini = etiqueta[2] - 1
    y_min, y_max = etiqueta[1] - arriba, etiqueta[3] + 2
    en_region = [w for w in words if w is not etiqueta and w[0] >= x_ini and y_min <= w[1] and (w[1] + w[3]) / 2 <= y_max]
    limites = [w[0] for w in en_region if es_etiqueta(w[4])]
    x_max = min(limites) if limites else float('inf')
    sel = [w for w in en_region if w[2] <= x_max + 1 and not es_etiqueta(w[4])]
    # orden de lectura: líneas de arriba abajo (agrupadas por centro vertical) y de izquierda a derecha
    sel.sort(key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    lineas: list[list] = []
    for w in sel:
        cy = (w[1] + w[3]) / 2
        if lineas and abs(cy - (lineas[-1][0][1] + lineas[-1][0][3]) / 2) <= 4:
            lineas[-1].append(w)
        else:
            lineas.append([w])
    texto = ' '.join(' '.join(x[4] for x in sorted(l, key=lambda w: w[0])) for l in lineas)
    return re.sub(r'\s+', ' ', texto).strip()


def buscar_palabra(words: list, objetivo: str, columna_max: float = 260.0) -> tuple | None:
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        if norm(w[4]) in (objetivo, objetivo.rstrip(':')) and w[0] < columna_max:
            return w
    return None


def buscar_codigo_dcmx(words: list) -> tuple[tuple, tuple] | None:
    """«Código» seguido de «DCMX:» (evita el «Código:» suelto del encabezado de algunos formatos antiguos)."""
    lista = sorted(words, key=lambda w: (round(w[1] / 3), w[0]))
    for i, w in enumerate(lista[:-1]):
        if norm(w[4]) == 'CODIGO' and norm(lista[i + 1][4]) in ('DCMX:', 'DCMX') and abs(lista[i + 1][1] - w[1]) < 4:
            return w, lista[i + 1]
    return None


def limpiar_codigo(valor: str) -> str:
    return re.sub(r'[^A-Z0-9._/\-]', '', (valor or '').upper().replace(' ', ''))


def prefijos_candidatos(codigo: str) -> dict[int, str]:
    letras = re.match(r'^[A-Z]+', codigo or '')
    base = letras.group(0) if letras else ''
    return {n: base[:n] for n in (2, 3, 4, 5) if len(base) >= n}


def prefijo_parser(codigo: str) -> str | None:
    m = CODIGO_PARSER.match(codigo or '')
    return m.group('prefijo') if m else None


SUFIJOS_SOCIEDAD = re.compile(r'\b(S\.? ?A\.?( ?P\.? ?I\.?)?( ?DE ?C\.? ?V\.?)?|S\.? ?DE ?R\.? ?L\.?( ?DE ?C\.? ?V\.?)?|DE C\.? ?V\.?|S\.? ?A\.?|C\.? ?V\.?)\b')


def clave_cliente(texto: str) -> str:
    """Clave para AGRUPAR textos idénticos salvo mayúsculas, acentos, puntuación y sufijos de sociedad. NO afirma equivalencia entre nombres distintos."""
    t = norm(texto)
    t = SUFIJOS_SOCIEDAD.sub(' ', t)
    t = re.sub(r'[^A-Z0-9 ]', ' ', t)
    t = re.sub(r'\b(DE|SA|CV|SAPI|SRL|RL|S|C|V)\b', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def parecido(a: str, b: str) -> bool:
    """Pista (no veredicto) de que dos claves de cliente podrían ser variantes del mismo nombre: una contiene a la otra por palabras, comparten el inicio o son casi iguales."""
    if not a or not b or a == b:
        return False
    ta, tb = set(a.split()), set(b.split())
    return (min(len(a), len(b)) >= 3 and (ta <= tb or tb <= ta)) or a.startswith(b) or b.startswith(a) or difflib.SequenceMatcher(None, a, b).ratio() >= 0.88


def sha256_archivo(ruta: Path) -> str:
    h = hashlib.sha256()
    with ruta.open('rb') as f:
        for bloque in iter(lambda: f.read(1 << 20), b''):
            h.update(bloque)
    return h.hexdigest()


def procesar(ruta: Path, origen: Path) -> dict:
    fila = {'archivo': ruta.name, 'ruta_relativa': str(ruta.relative_to(origen)), 'bytes': ruta.stat().st_size, 'modificado': ruta.stat().st_mtime, 'sha256': sha256_archivo(ruta)}
    try:
        doc = fitz.open(ruta)
    except Exception as e:  # noqa: BLE001 — se reporta como no interpretado
        return {**fila, 'estado': 'ERROR', 'detalle': f'No se pudo abrir: {e}'}
    with doc:
        fila['paginas'] = doc.page_count
        texto_total = ''.join(p.get_text() for p in doc)
        fila['caracteres'] = len(texto_total.strip())
        fila['imagenes'] = sum(len(p.get_images()) for p in doc)
        if fila['caracteres'] < MIN_CARACTERES_TEXTO:
            return {**fila, 'estado': 'ESCANEADO', 'detalle': 'Sin texto extraíble (probable escaneo); no se aplicó OCR.'}
        for pagina in doc:
            words = pagina.get_text('words')
            cli = buscar_palabra(words, 'CLIENTE:')
            if cli:
                break
        else:
            return {**fila, 'estado': 'SIN_ETIQUETA_CLIENTE', 'detalle': 'Hay texto pero no se encontró la etiqueta «Cliente:».'}
        cliente = valor_celda(words, cli)
        cod = buscar_codigo_dcmx(words)
        codigo_raw = valor_derecha(words, cod[1], cod[0]) if cod else ''
        desc_lab = buscar_palabra(words, 'DESCRIPCION:')
        descripcion = valor_celda(words, desc_lab) if desc_lab else ''
        fecha_lab = buscar_palabra(words, 'FECHA:', columna_max=700)
        fecha = valor_derecha(words, fecha_lab) if fecha_lab else ''
        coex = 'COEXTRUSION' in norm(texto_total)
    codigo = limpiar_codigo(codigo_raw)
    stem = limpiar_codigo(ruta.stem.split(' ')[0])
    contenido = norm(re.sub(r'\s+', ' ', texto_total))
    return {**fila, 'estado': 'OK', 'cliente_raw': cliente, 'codigo_raw': codigo_raw, 'codigo_dcmx': codigo if CODIGO_VALIDO.match(codigo) else '',
            'codigo_archivo': stem, 'descripcion': descripcion, 'fecha_hoja': fecha, 'coextrusion': coex, 'hash_contenido': hashlib.sha256(contenido.encode()).hexdigest()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--origen', type=Path, default=os.environ.get('DAUBERT_ORIGEN'), help='carpeta con las hojas históricas (solo lectura); o variable DAUBERT_ORIGEN')
    ap.add_argument('--salida', type=Path, default=Path(os.environ.get('DAUBERT_SALIDA', SALIDA_DEFECTO)), help='carpeta donde se escriben Excel/CSV (se crea)')
    args = ap.parse_args()
    if args.origen is None:
        ap.error('indica --origen (o la variable DAUBERT_ORIGEN)')
    origen: Path = Path(args.origen)
    if not origen.is_dir():
        print(f'No existe la carpeta de origen: {origen}', file=sys.stderr)
        return 2
    args.salida.mkdir(parents=True, exist_ok=True)

    archivos = sorted(p for p in origen.rglob('*') if p.is_file())
    pdfs = [p for p in archivos if p.suffix.lower() == '.pdf']
    otros = [p for p in archivos if p.suffix.lower() != '.pdf']
    print(f'Origen: {origen}\nArchivos: {len(archivos)} (PDF {len(pdfs)}, otros {len(otros)})')

    filas = [procesar(p, origen) for p in pdfs]
    df = pd.DataFrame(filas)

    # ---------------------------------------------------------------- duplicados (no cuentan como evidencia independiente)
    df['duplicado_de'] = ''
    vistos_hash: dict[str, str] = {}
    vistos_cont: dict[str, str] = {}
    for i, r in df.iterrows():
        if r['estado'] != 'OK':
            continue
        if r['sha256'] in vistos_hash:
            df.at[i, 'duplicado_de'] = f"{vistos_hash[r['sha256']]} (mismo archivo)"
        elif r['hash_contenido'] in vistos_cont:
            df.at[i, 'duplicado_de'] = f"{vistos_cont[r['hash_contenido']]} (mismo contenido)"
        else:
            vistos_hash[r['sha256']] = r['archivo']
            vistos_cont[r['hash_contenido']] = r['archivo']
    ok = df[(df['estado'] == 'OK')].copy()
    ok['codigo_final'] = ok.apply(lambda r: r['codigo_dcmx'] or (r['codigo_archivo'] if CODIGO_VALIDO.match(r['codigo_archivo'] or '') else ''), axis=1)
    ok['codigo_origen'] = ok.apply(lambda r: 'etiqueta' if r['codigo_dcmx'] else ('nombre de archivo' if r['codigo_final'] else ''), axis=1)
    ok['codigo_coincide_archivo'] = ok.apply(lambda r: bool(r['codigo_dcmx']) and r['codigo_dcmx'] == r['codigo_archivo'], axis=1)
    ok['cliente_texto'] = ok['cliente_raw'].fillna('').str.strip()
    ok['cliente_clave'] = ok['cliente_texto'].map(clave_cliente)
    ok['prefijo_parser'] = ok['codigo_final'].map(prefijo_parser)
    for n in (2, 3, 4, 5):
        ok[f'prefijo_{n}'] = ok['codigo_final'].map(lambda c, n=n: prefijos_candidatos(c).get(n, ''))
    ok['prefijo_principal'] = ok.apply(lambda r: r['prefijo_parser'] or r['prefijo_3'], axis=1)

    # ---------------------------------------------------------------- no interpretados
    def motivo(r) -> str:
        if r['estado'] != 'OK':
            return r['estado']
        if not r['cliente_texto']:
            return 'CLIENTE_VACIO'
        if not r['codigo_final']:
            return 'SIN_CODIGO'
        return ''
    ok['motivo_no_interpretado'] = ok.apply(motivo, axis=1)
    util = ok[(ok['motivo_no_interpretado'] == '') & (ok['duplicado_de'] == '')].copy()

    # ---------------------------------------------------------------- tipo de valor del campo Cliente
    def tipo_valor(r) -> str:
        t = norm(r['cliente_texto'])
        if re.fullmatch(r'[A-Z]{2,5}', t):
            return 'ABREVIATURA' if any(t == r[f'prefijo_{n}'] for n in (2, 3, 4, 5)) else 'SIGLA_O_NOMBRE_CORTO'
        return 'NOMBRE'
    util['tipo_valor_cliente'] = util.apply(tipo_valor, axis=1)

    # ---------------------------------------------------------------- clientes detectados (agrupados por clave exacta; variantes visibles)
    clientes = []
    for clave, g in util.groupby('cliente_clave'):
        variantes = Counter(g['cliente_texto'])
        clientes.append({
            'cliente_clave': clave, 'texto_mas_frecuente': variantes.most_common(1)[0][0], 'variantes_de_texto': ' | '.join(f'{t} ({n})' for t, n in variantes.most_common()),
            'documentos_unicos': len(g), 'codigos_distintos': g['codigo_final'].nunique(), 'tipo_valor': '/'.join(sorted(set(g['tipo_valor_cliente']))),
            'prefijos_3_letras': ' | '.join(f'{p} ({n})' for p, n in Counter(g['prefijo_3']).most_common()), 'primer_anio': pd.to_datetime(g['modificado'], unit='s').dt.year.min(),
            'ultimo_anio': pd.to_datetime(g['modificado'], unit='s').dt.year.max()})
    df_clientes = pd.DataFrame(clientes).sort_values('documentos_unicos', ascending=False)

    # ---------------------------------------------------------------- asociaciones (cliente_clave × prefijo): una fila por longitud de prefijo
    filas_aso = []
    for (clave, ), g in util.groupby(['cliente_clave']):
        for n in (2, 3, 4, 5):
            for pref, gg in g.groupby(f'prefijo_{n}'):
                if not pref:
                    continue
                filas_aso.append({'cliente_clave': clave, 'cliente_texto': Counter(g['cliente_texto']).most_common(1)[0][0], 'longitud_prefijo': n, 'prefijo': pref,
                                  'documentos_unicos': len(gg), 'codigos_distintos': gg['codigo_final'].nunique(), 'documentos_del_cliente': len(g),
                                  'cobertura_en_cliente': round(len(gg) / len(g), 2), 'ejemplos_codigo': ', '.join(sorted(set(gg['codigo_final']))[:5]),
                                  'ejemplo_archivo': gg['archivo'].iloc[0], 'ejemplo_descripcion': (gg['descripcion'].iloc[0] or '')[:80]})
    df_aso = pd.DataFrame(filas_aso)
    # clientes por prefijo (para detectar prefijos compartidos) y por longitud
    por_pref: dict[tuple[int, str], set[str]] = defaultdict(set)
    for r in filas_aso:
        por_pref[(r['longitud_prefijo'], r['prefijo'])].add(r['cliente_clave'])
    df_aso['clientes_con_este_prefijo'] = df_aso.apply(lambda r: len(por_pref[(r['longitud_prefijo'], r['prefijo'])]), axis=1)
    df_aso['compartido_con'] = df_aso.apply(lambda r: ' | '.join(sorted(por_pref[(r['longitud_prefijo'], r['prefijo'])] - {r['cliente_clave']})), axis=1)

    def sugerencia(r) -> str:
        if r['longitud_prefijo'] != 3:
            return ''
        if r['clientes_con_este_prefijo'] > 1:
            return 'REVISAR: prefijo compartido'
        if r['cobertura_en_cliente'] >= 0.8 and r['codigos_distintos'] >= 2:
            return 'CANDIDATA FUERTE'
        if r['codigos_distintos'] >= 1:
            return 'CANDIDATA (poca evidencia)'
        return ''
    df_aso['sugerencia_revision'] = df_aso.apply(sugerencia, axis=1)
    df_aso = df_aso.sort_values(['longitud_prefijo', 'documentos_unicos'], ascending=[True, False])

    # ---------------------------------------------------------------- conflictos
    conflictos = []
    a3 = df_aso[df_aso['longitud_prefijo'] == 3]
    for pref, g in a3.groupby('prefijo'):
        if g['cliente_clave'].nunique() > 1:
            cl = list(g['cliente_clave'])
            todas = all(parecido(x, y) for i, x in enumerate(cl) for y in cl[i + 1:])
            conflictos.append({'tipo': 'PREFIJO_COMPARTIDO', 'prefijo_o_cliente': pref, 'detalle': ' | '.join(f"{r.cliente_texto} ({r.codigos_distintos} cód.)" for r in g.itertuples()),
                               'documentos': int(g['documentos_unicos'].sum()),
                               'clasificacion': 'POSIBLES VARIANTES DEL MISMO CLIENTE (revisar)' if todas else 'CLIENTES DISTINTOS CON EL MISMO PREFIJO (decidir)'})
    for clave, g in a3.groupby('cliente_clave'):
        if g['prefijo'].nunique() > 1:
            conflictos.append({'tipo': 'CLIENTE_CON_VARIOS_PREFIJOS', 'prefijo_o_cliente': g['cliente_texto'].iloc[0],
                               'detalle': ' | '.join(f"{r.prefijo} ({r.codigos_distintos} cód.)" for r in g.itertuples()), 'documentos': int(g['documentos_unicos'].sum()), 'clasificacion': 'REVISAR'})
    # el mismo código con clientes distintos entre documentos
    for cod, g in util.groupby('codigo_final'):
        if g['cliente_clave'].nunique() > 1:
            conflictos.append({'tipo': 'MISMO_CODIGO_CLIENTES_DISTINTOS', 'prefijo_o_cliente': cod, 'detalle': ' | '.join(f"{t} [{a}]" for t, a in zip(g['cliente_texto'], g['archivo'])), 'documentos': len(g)})
    # código ≠ nombre de archivo
    for r in ok[(~ok['codigo_coincide_archivo']) & (ok['codigo_dcmx'] != '')].itertuples():
        conflictos.append({'tipo': 'CODIGO_DISTINTO_AL_NOMBRE_DE_ARCHIVO', 'prefijo_o_cliente': r.codigo_dcmx, 'detalle': f'archivo {r.archivo} (stem {r.codigo_archivo})', 'documentos': 1})
    # prefijo del parser distinto de las 3 primeras letras / no interpretable
    sin_parser = util[util['prefijo_parser'].isna()]
    if len(sin_parser):
        conflictos.append({'tipo': 'PARSER_ACTUAL_NO_INTERPRETA', 'prefijo_o_cliente': f'{len(sin_parser)} documentos', 'detalle': ', '.join(sorted(set(sin_parser['codigo_final']))[:25]), 'documentos': len(sin_parser)})
    df_conf = pd.DataFrame(conflictos)

    # ---------------------------------------------------------------- posibles equivalencias de nombres (solo sugerencia; sin porcentajes)
    claves = list(df_clientes['cliente_clave'])
    eq = []
    for i, a in enumerate(claves):
        for b in claves[i + 1:]:
            if not a or not b:
                continue
            parecido_ab = parecido(a, b)
            if parecido_ab:
                fa = df_clientes[df_clientes['cliente_clave'] == a].iloc[0]
                fb = df_clientes[df_clientes['cliente_clave'] == b].iloc[0]
                pa = set(util[util['cliente_clave'] == a]['prefijo_3']); pb = set(util[util['cliente_clave'] == b]['prefijo_3'])
                eq.append({'texto_a': fa['texto_mas_frecuente'], 'documentos_a': fa['documentos_unicos'], 'texto_b': fb['texto_mas_frecuente'], 'documentos_b': fb['documentos_unicos'],
                           'prefijos_en_comun': ' | '.join(sorted(pa & pb)), 'nota': 'POSIBLE equivalencia (no verificada): revisar antes de unir'})
    df_eq = pd.DataFrame(eq)
    padre = {c: c for c in claves}
    def raiz(x):
        while padre[x] != x:
            padre[x] = padre[padre[x]]
            x = padre[x]
        return x
    for i, a_ in enumerate(claves):
        for b_ in claves[i + 1:]:
            if parecido(a_, b_):
                padre[raiz(a_)] = raiz(b_)
    grupos: dict[str, list[str]] = defaultdict(list)
    for c_ in claves:
        grupos[raiz(c_)].append(c_)
    ids = {c_: f'G{n:02d}' for n, (_r, miembros) in enumerate(sorted((g_ for g_ in grupos.items() if len(g_[1]) > 1), key=lambda kv: kv[1][0]), 1) for c_ in miembros}
    df_clientes['grupo_posible_equivalencia'] = df_clientes['cliente_clave'].map(lambda c_: ids.get(c_, ''))

    # ---------------------------------------------------------------- hojas auxiliares
    if 'detalle' not in df.columns:
        df['detalle'] = ''
    df_no = pd.concat([
        ok[ok['motivo_no_interpretado'] != ''][['archivo', 'ruta_relativa', 'motivo_no_interpretado', 'cliente_texto', 'codigo_raw', 'codigo_archivo']].rename(columns={'motivo_no_interpretado': 'motivo'}),
        df[df['estado'].isin(['ERROR', 'SIN_ETIQUETA_CLIENTE'])][['archivo', 'ruta_relativa', 'estado', 'detalle']].rename(columns={'estado': 'motivo'})], ignore_index=True)
    df_esc = df[df['estado'] == 'ESCANEADO'][['archivo', 'ruta_relativa', 'paginas', 'caracteres', 'imagenes', 'bytes']]
    # El nombre del archivo es solo una PISTA del código (no reemplaza a la etiqueta): permite ver qué prefijos existen únicamente en documentos escaneados.
    df_esc = df_esc.copy()
    df_esc['codigo_por_nombre'] = df_esc['archivo'].map(lambda n: limpiar_codigo(Path(n).stem.split(' ')[0]))
    df_esc['prefijo_3_por_nombre'] = df_esc['codigo_por_nombre'].map(lambda c: prefijos_candidatos(c).get(3, ''))
    _vistos = set(util['prefijo_3'])
    df_esc['prefijo_ya_visto_en_hojas_con_texto'] = df_esc['prefijo_3_por_nombre'].map(lambda p_: p_ in _vistos)
    df_otros = pd.DataFrame([{'archivo': p.name, 'extension': p.suffix.lower(), 'motivo': 'No es PDF: no se procesó (imágenes no se leen sin OCR; la plantilla/XML no es una hoja)'} for p in otros])
    df_dupes = ok[ok['duplicado_de'] != ''][['archivo', 'codigo_final', 'cliente_texto', 'duplicado_de']]
    evidencia = ok[['archivo', 'ruta_relativa', 'codigo_final', 'codigo_origen', 'codigo_coincide_archivo', 'cliente_texto', 'cliente_clave', 'descripcion', 'fecha_hoja', 'coextrusion',
                    'prefijo_2', 'prefijo_3', 'prefijo_4', 'prefijo_5', 'prefijo_parser', 'duplicado_de', 'motivo_no_interpretado', 'sha256']]

    total_pdf = len(pdfs)
    resumen = [
        ('Carpeta de origen (solo lectura)', str(origen)), ('Archivos en la carpeta', len(archivos)), ('PDF', total_pdf), ('Otros formatos (no procesados)', len(otros)),
        ('PDF con texto extraíble', int((df['estado'].isin(['OK', 'SIN_ETIQUETA_CLIENTE'])).sum())), ('PDF escaneados / sin texto (sin OCR)', int((df['estado'] == 'ESCANEADO').sum())),
        ('PDF con error al abrir', int((df['estado'] == 'ERROR').sum())), ('PDF con texto pero sin etiqueta «Cliente:»', int((df['estado'] == 'SIN_ETIQUETA_CLIENTE').sum())),
        ('Hojas con etiqueta «Cliente:» leída', len(ok)), ('  con cliente no vacío', int((ok['cliente_texto'] != '').sum())), ('  con código DCMX leído de la etiqueta', int((ok['codigo_dcmx'] != '').sum())),
        ('  con código que coincide con el nombre del archivo', int(ok['codigo_coincide_archivo'].sum())), ('Duplicados (no cuentan como evidencia)', int((ok['duplicado_de'] != '').sum())),
        ('Documentos únicos utilizables (cliente + código)', len(util)), ('Códigos DCMX distintos', util['codigo_final'].nunique()),
        ('Textos de cliente distintos (clave de agrupación)', len(df_clientes)), ('  de ellos solo abreviatura / sigla', int((util.groupby('cliente_clave')['tipo_valor_cliente'].agg(lambda s: set(s) <= {'ABREVIATURA', 'SIGLA_O_NOMBRE_CORTO'})).sum())),
        ('Códigos que el parser actual NO interpreta', int(util['prefijo_parser'].isna().sum())), ('Prefijos de 3 letras distintos', util['prefijo_3'].nunique()),
        ('Prefijos de 3 letras compartidos entre clientes distintos', int((a3.groupby('prefijo')['cliente_clave'].nunique() > 1).sum())),
        ('Clientes con más de un prefijo de 3 letras', int((a3.groupby('cliente_clave')['prefijo'].nunique() > 1).sum())), ('Pares de nombres con POSIBLE equivalencia', len(df_eq)),
        ('Documentos no interpretados', len(df_no)), ('Escaneados cuyo prefijo (por nombre de archivo) NO aparece en hojas con texto', int((~df_esc['prefijo_ya_visto_en_hojas_con_texto'].astype(bool)).sum())), ('Cobertura de interpretación (únicos útiles / PDF con texto)', f"{len(util) / max(1, int((df['estado'].isin(['OK', 'SIN_ETIQUETA_CLIENTE'])).sum())):.0%}")]
    df_res = pd.DataFrame(resumen, columns=['concepto', 'valor'])

    hojas = {'Resumen': df_res, 'Clientes_detectados': df_clientes, 'Asociaciones_propuestas': df_aso, 'Conflictos': df_conf, 'Posibles_equivalencias': df_eq,
             'No_interpretados': df_no, 'Escaneados_sin_OCR': df_esc, 'Otros_formatos': df_otros, 'Duplicados': df_dupes, 'Evidencia_por_documento': evidencia}
    with pd.ExcelWriter(args.salida / 'catalogo_clientes_abreviaturas.xlsx', engine='openpyxl') as xw:
        for nombre, d in hojas.items():
            d.to_excel(xw, sheet_name=nombre, index=False)
            ws = xw.sheets[nombre]
            ws.freeze_panes = 'A2'
            for col in ws.columns:
                ws.column_dimensions[col[0].column_letter].width = min(60, max(10, max(len(str(c.value)) if c.value is not None else 0 for c in col[:60]) + 2))
    for nombre, d in hojas.items():
        d.to_csv(args.salida / f'{nombre}.csv', index=False, encoding='utf-8-sig')
    print(df_res.to_string(index=False))
    print(f'\nSalida: {args.salida}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
