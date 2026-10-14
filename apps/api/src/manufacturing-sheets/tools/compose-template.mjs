#!/usr/bin/env node
// Compone una plantilla de hoja de manufactura a partir de un archivo fuente con marcadores @include.
//
//   node compose-template.mjs --source <plantilla.fuente.html> --out <salida.html>
//
// Marcadores (una línea completa; la indentación del marcador se descarta, el contenido se inserta tal cual):
//   <!-- @include components/header/header.html -->                       (HTML)
//   /* @include components/header/header.css */                           (dentro de <style>)
//   <!-- @include ruta nombre=valor otro=valor -->                        (con parámetros)
//
// Reglas (determinista, sin dependencias):
//   - Las rutas son relativas a la carpeta `templates/` (el padre de la carpeta del archivo fuente).
//   - Cada archivo incluido debe existir, usar LF y terminar en salto de línea.
//   - Parámetros: `nombre=valor` con valor [A-Za-z0-9_.-]. En el archivo incluido, cada `@{nombre}` se sustituye por el valor
//     (error si falta) ANTES de procesar sus propios marcadores. No hay herencia: cada inclusión recibe solo sus parámetros.
//   - Un archivo incluido puede incluir otros (máximo 4 niveles); su ruta puede usar `@{nombre}` para elegir, por ejemplo, la
//     geometría de un dibujo.
//   - No se transforma, minifica ni reordena nada más: la salida es el fuente con cada marcador sustituido por el contenido.
//   - Al final se comprueba que no haya atributos `id` duplicados en el HTML compuesto (fuera de comentarios).
//   - La salida no contiene JavaScript: este script solo se ejecuta al componer.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

const MARCADOR = /^[ \t]*(?:<!--|\/\*) @include ([A-Za-z0-9_./@{}-]+)((?: [A-Za-z0-9_]+=[A-Za-z0-9_.@{}&#;:-]+)*) (?:-->|\*\/)[ \t]*$/;
const TOKEN = /@\{([A-Za-z0-9_]+)\}/g;
const MAX_PROFUNDIDAD = 4;

function sustituir(texto, parametros, origen) {
  return texto.replace(TOKEN, (_, nombre) => {
    if (!(nombre in parametros)) throw new Error(`${origen}: parámetro sin valor @{${nombre}}`);
    return parametros[nombre];
  });
}

function leerLF(ruta, etiqueta) {
  const contenido = readFileSync(ruta, 'utf8');
  if (contenido.includes('\r')) throw new Error(`${etiqueta}: debe usar finales de línea LF`);
  return contenido;
}

function expandir(texto, parametros, raiz, profundidad, origen) {
  if (profundidad > MAX_PROFUNDIDAD) throw new Error(`${origen}: demasiados niveles de inclusión`);
  const salida = [];
  for (const linea of sustituir(texto, parametros, origen).split('\n')) {
    const m = MARCADOR.exec(linea);
    if (!m) {
      salida.push(linea);
      continue;
    }
    const ruta = resolve(raiz, m[1]);
    const rel = relative(raiz, ruta);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Inclusión fuera de templates/: ${m[1]}`);
    const hijos = {};
    for (const par of m[2].trim().split(' ').filter(Boolean)) {
      const [nombre, valor] = par.split('=');
      hijos[nombre] = valor;
    }
    const contenido = leerLF(ruta, m[1]);
    if (!contenido.endsWith('\n')) throw new Error(`${m[1]}: debe terminar en salto de línea`);
    const expandido = expandir(contenido, hijos, raiz, profundidad + 1, m[1]);
    salida.push(expandido.slice(0, -1)); // el '\n' final se restituye al unir
  }
  return salida.join('\n');
}

function comprobarIdsUnicos(html) {
  const sinComentarios = html.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '');
  const vistos = new Map();
  for (const [, id] of sinComentarios.matchAll(/\sid="([^"]+)"/g)) vistos.set(id, (vistos.get(id) ?? 0) + 1);
  const duplicados = [...vistos].filter(([, n]) => n > 1).map(([id]) => id);
  if (duplicados.length) throw new Error(`Atributos id duplicados en el HTML compuesto: ${duplicados.join(', ')}`);
}

export function componer(fuenteRuta) {
  const fuente = resolve(fuenteRuta);
  const raiz = resolve(dirname(fuente), '..');
  const html = expandir(leerLF(fuente, fuente), {}, raiz, 0, fuente);
  comprobarIdsUnicos(html);
  return html;
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
