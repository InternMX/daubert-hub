#!/usr/bin/env node
// Compone una plantilla de hoja de manufactura a partir de un archivo fuente con marcadores @include.
//
//   node compose-template.mjs --source <plantilla.fuente.html> --out <salida.html>
//
// Marcadores (una línea completa; la indentación del marcador se descarta, el contenido se inserta tal cual):
//   <!-- @include components/header/header.html -->     (HTML)
//   /* @include components/header/header.css */         (dentro de <style>)
//
// Reglas (determinista, sin dependencias):
//   - Las rutas son relativas a la carpeta `templates/` (el padre de la carpeta del archivo fuente).
//   - Cada archivo incluido debe existir, terminar en salto de línea y no contener otros marcadores.
//   - No se transforma, minifica ni reordena nada: la salida es el fuente con cada marcador sustituido por el contenido exacto.
//   - La salida no contiene JavaScript: este script solo se ejecuta al componer.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

const MARCADOR = /^[ \t]*(?:<!--|\/\*) @include ([A-Za-z0-9_./-]+) (?:-->|\*\/)[ \t]*$/;

export function componer(fuenteRuta) {
  const fuente = resolve(fuenteRuta);
  const raiz = resolve(dirname(fuente), '..');
  const texto = readFileSync(fuente, 'utf8');
  if (texto.includes('\r')) throw new Error(`${fuente}: debe usar finales de línea LF`);
  const salida = [];
  for (const linea of texto.split('\n')) {
    const m = MARCADOR.exec(linea);
    if (!m) {
      salida.push(linea);
      continue;
    }
    const ruta = resolve(raiz, m[1]);
    const rel = relative(raiz, ruta);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Inclusión fuera de templates/: ${m[1]}`);
    const contenido = readFileSync(ruta, 'utf8');
    if (contenido.includes('\r')) throw new Error(`${m[1]}: debe usar finales de línea LF`);
    if (!contenido.endsWith('\n')) throw new Error(`${m[1]}: debe terminar en salto de línea`);
    if (contenido.split('\n').some((l) => MARCADOR.test(l))) throw new Error(`${m[1]}: no se admiten inclusiones anidadas`);
    salida.push(contenido.slice(0, -1)); // el '\n' final se restituye al unir
  }
  return salida.join('\n');
}

const args = process.argv.slice(2);
const valor = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args.includes('--source') || args.includes('--out')) {
  const fuente = valor('--source');
  const salida = valor('--out');
  if (!fuente || !salida) {
    console.error('Uso: node compose-template.mjs --source <fuente.html> --out <salida.html>');
    process.exit(2);
  }
  const html = componer(fuente);
  mkdirSync(dirname(resolve(salida)), { recursive: true });
  writeFileSync(resolve(salida), html, 'utf8');
  console.log(`Plantilla compuesta: ${resolve(salida)} (${Buffer.byteLength(html)} bytes)`);
}
