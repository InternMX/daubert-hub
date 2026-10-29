import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Renderizador de PDF de borrador: imprime el HTML YA COMPUESTO y validado con el Chrome local (el mismo motor y los mismos parámetros que las regresiones documentales). Es OPCIONAL y local al
// módulo: sin un Chrome configurado informa NO_DISPONIBLE y no cambia nada en la imagen de producción (node:alpine no incluye navegador). Ver docs/manufacturing-pdf-draft.md.
//
// Aislamiento: proceso hijo SIN shell y con argumentos fijos, perfil de usuario y archivos en un directorio temporal propio (se borra siempre), sin resolución de nombres de red
// (--host-resolver-rules) y sobre HTML con CSP `default-src 'none'` (sin scripts ni recursos remotos). Entrada máxima, tiempo máximo, concurrencia y cola acotados; al vencer el tiempo se
// termina todo el árbol de procesos.

export type PdfRenderOutcome =
  | { kind: 'OK'; pdf: Buffer }
  | { kind: 'NO_DISPONIBLE' }
  | { kind: 'OCUPADO' }
  | { kind: 'TIMEOUT' }
  | { kind: 'ERROR' };

export interface PdfRendererOptions {
  /** Ejecutable de Chrome; null = no configurado. */
  chromePath: string | null;
  /** Argumentos que preceden a los de Chrome (solo para pruebas con un ejecutable simulado). */
  argsPrefix?: string[];
  timeoutMs: number;
  maxConcurrent: number;
  /** Solicitudes en espera además de las que se ejecutan; más allá de este límite se responde OCUPADO. */
  maxQueue: number;
  maxHtmlBytes: number;
  maxPdfBytes: number;
  /** Directorio base de los temporales (por omisión el del sistema); permite a las pruebas aislar y comprobar la limpieza. */
  tmpDir?: string;
}

export const PDF_RENDERER_OPTIONS = 'PDF_RENDERER_OPTIONS';
export const DEFAULT_PDF_RENDERER_OPTIONS: Omit<PdfRendererOptions, 'chromePath'> = { timeoutMs: 25_000, maxConcurrent: 2, maxQueue: 4, maxHtmlBytes: 2_000_000, maxPdfBytes: 10_000_000 };

// Mismos parámetros de impresión que las regresiones documentales (comparar_regresion.py) más el aislamiento: sin perfil compartido, sin extensiones ni red.
const CHROME_FLAGS = ['--headless', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'];

const CANDIDATAS_NO_PRODUCCION = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

/**
 * Chrome configurado explícitamente (MANUFACTURING_PDF_CHROME_PATH) o, SOLO fuera de producción, el instalado en las rutas habituales. En producción nunca se adivina: sin la variable no hay PDF.
 */
export function resolveChromePath(env: NodeJS.ProcessEnv = process.env, existe: (ruta: string) => boolean = existsSync): string | null {
  const explicita = env.MANUFACTURING_PDF_CHROME_PATH?.trim();
  if (explicita) return existe(explicita) ? explicita : null;
  if (env.NODE_ENV === 'production') return null;
  return CANDIDATAS_NO_PRODUCCION.find((ruta) => existe(ruta)) ?? null;
}

function terminarArbol(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch { /* el proceso ya terminó */ }
}

export class SheetPdfRenderer {
  private activos = 0;
  private readonly espera: Array<() => void> = [];

  constructor(private readonly options: PdfRendererOptions) {}

  get disponible(): boolean { return this.options.chromePath !== null; }

  async render(html: string): Promise<PdfRenderOutcome> {
    if (this.options.chromePath === null) return { kind: 'NO_DISPONIBLE' };
    if (Buffer.byteLength(html, 'utf8') > this.options.maxHtmlBytes) return { kind: 'ERROR' };
    if (this.activos >= this.options.maxConcurrent && this.espera.length >= this.options.maxQueue) return { kind: 'OCUPADO' };
    if (this.activos >= this.options.maxConcurrent) await new Promise<void>((resolve) => this.espera.push(resolve));
    else this.activos += 1;                                                    // con turno en espera, el hueco se hereda (ver liberar)
    try {
      return await this.imprimir(html);
    } finally {
      this.liberar();
    }
  }

  private liberar(): void {
    const siguiente = this.espera.shift();
    if (siguiente) siguiente(); else this.activos -= 1;
  }

  private async imprimir(html: string): Promise<PdfRenderOutcome> {
    const carpeta = await mkdtemp(join(this.options.tmpDir ?? tmpdir(), 'daubert-pdf-'));
    try {
      const entrada = join(carpeta, 'hoja.html');
      const salida = join(carpeta, 'hoja.pdf');
      await writeFile(entrada, html, 'utf8');
      const args = [...(this.options.argsPrefix ?? []), ...CHROME_FLAGS, `--user-data-dir=${join(carpeta, 'perfil')}`, `--print-to-pdf=${salida}`, pathToFileURL(entrada).href];
      const resultado = await new Promise<'OK' | 'TIMEOUT' | 'ERROR'>((resolve) => {
        let hijo;
        try {
          hijo = spawn(this.options.chromePath as string, args, { stdio: 'ignore', windowsHide: true, shell: false, detached: process.platform !== 'win32' });
        } catch { resolve('ERROR'); return; }
        let vencido = false;
        const timer = setTimeout(() => { vencido = true; terminarArbol(hijo.pid); }, this.options.timeoutMs);
        hijo.once('error', () => { clearTimeout(timer); resolve('ERROR'); });
        hijo.once('exit', (codigo) => { clearTimeout(timer); terminarArbol(hijo.pid); resolve(vencido ? 'TIMEOUT' : codigo === 0 ? 'OK' : 'ERROR'); });
      });
      if (resultado !== 'OK') return { kind: resultado };
      const info = await stat(salida).catch(() => null);
      if (info === null || info.size === 0 || info.size > this.options.maxPdfBytes) return { kind: 'ERROR' };
      const pdf = await readFile(salida);
      return pdf.subarray(0, 5).toString('latin1') === '%PDF-' ? { kind: 'OK', pdf } : { kind: 'ERROR' };
    } finally {
      await rm(carpeta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    }
  }
}
