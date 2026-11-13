"""Ejecuta las regresiones documentales existentes sin modificar sus referencias. No conecta a servicios externos."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
BASE = Path(__file__).resolve().parent.parent
CASOS = [
    'regression/coex-confpmg04/comparar_regresion.py',
    'regression/coex-azul/verificar_coex_azul.py',
    'bolsa-plana-1/verificar_bolsa_plana_1.py',
    'hoja-paq/verificar_hoja_paq.py',
    'bolsa-fuelle/verificar_bolsa_fuelle.py',
    'bolsa-natural/verificar_bolsa_natural.py',
    'rollo-continuo/verificar_rollo_continuo.py',
    'termoencogible/verificar_termoencogible.py',
    'common/test_hoja_pruebas.py',
    'prototype/verificar_prototipo.py',
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', required=True)
    args = ap.parse_args()
    destino = Path(args.salida).resolve()
    destino.mkdir(parents=True, exist_ok=True)
    resultados = []
    for relativo in CASOS:
        inicio = time.monotonic()
        r = subprocess.run([sys.executable, str(BASE / relativo)], capture_output=True, encoding='utf-8', errors='replace', timeout=600)
        duracion = round(time.monotonic() - inicio, 2)
        nombre = relativo.replace('/', '_').replace('.py', '.txt')
        (destino / nombre).write_text(r.stdout + '\n' + r.stderr, encoding='utf-8')
        resultados.append({'prueba': relativo, 'codigoSalida': r.returncode, 'segundos': duracion, 'detalle': nombre})
        print(f'{relativo}: {"OK" if r.returncode == 0 else "FALLA"} ({duracion}s)', flush=True)
    (destino / 'regresiones-resultados.json').write_text(json.dumps(resultados, ensure_ascii=False, indent=2), encoding='utf-8')
    return int(any(r['codigoSalida'] != 0 for r in resultados))


if __name__ == '__main__':
    sys.exit(main())
