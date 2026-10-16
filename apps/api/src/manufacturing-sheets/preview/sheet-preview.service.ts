import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapSheetData, type PreviewFamily, type PreviewFormData } from './sheet-data.mapper';

// Vista previa HTML de las Hojas de Instrucción de Manufactura. Reutiliza EXACTAMENTE el compositor (tools/compose-template.mjs) y las plantillas aprobadas: aquí solo
// se sustituyen los placeholders (con escape) y se endurece el HTML para mostrarlo en un iframe aislado. No escribe en disco ni en PostgreSQL.
//
// Ajuste arquitectónico: el compositor es un módulo ESM (.mjs) y la API compila a CommonJS; se carga con import() (sin copiar su lógica).
// Las plantillas y herramientas viven junto a este código (src/ en desarrollo, dist/src/ en producción, copiadas por los assets de nest-cli.json).

const ROOT = resolve(__dirname, '..');
const SOURCES: Record<PreviewFamily, { template: string; images: string }> = {
  BOLSA_PLANA_1: { template: 'templates/bolsa-plana-1/bolsa-plana-1.template.html', images: 'templates/bolsa-plana-1/images' },
  HOJA_PAQ: { template: 'templates/hoja-paq/hoja-paq.template.html', images: 'templates/hoja-paq/images' }
};

export const SIN_FIRMA_MARKER = '<span class="sin-firma">SIN FIRMA</span>';
const PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g;
// Política del iframe: sin scripts, sin red, solo estilos en línea e imágenes incrustadas.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">`;

type Componer = (fuente: string, parametros?: Record<string, string>) => string;
// El compositor es ESM y la API compila a CommonJS: `import()` se emite como require(), y Node >= 22.12 (la imagen de producción usa Node 24) carga módulos ESM síncronos con require().
// Se pasa una RUTA (no un file:// URL): require() no acepta URLs.
const loadComposer = async (file: string): Promise<{ componer: Componer }> => (await import(file)) as { componer: Componer };

export interface SheetPreviewResult {
  html: string;
  familia: PreviewFamily;
  /** La vista previa siempre es un borrador sin aprobar con firmas SIN FIRMA: nunca una hoja emitida. */
  borrador: true;
  firmas: 'SIN_FIRMA';
  completo: boolean;
  faltantes: string[];
  advertencias: string[];
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c] as string);
}

@Injectable()
export class SheetPreviewService {
  private readonly composed = new Map<PreviewFamily, string>();
  private componer: Promise<Componer> | null = null;

  async preview(family: PreviewFamily, form: PreviewFormData): Promise<SheetPreviewResult> {
    const template = await this.composedTemplate(family);
    const mapped = mapSheetData(family, form);
    const values: Record<string, string> = { ...mapped.datos, bloque_firma_elaboro: SIN_FIRMA_MARKER, bloque_firma_aprobo: SIN_FIRMA_MARKER };
    // Una sola pasada sobre la plantilla: un valor con «{{x}}» nunca se vuelve a interpretar. Los textos se escapan; los bloques de firma son el marcador fijo.
    let html = template.replace(PLACEHOLDER, (whole, name: string) => {
      if (name === 'color_bolsa_hex') return mapped.colorBolsaHex ?? whole;          // sin color válido el placeholder queda y la plantilla muestra gris, sin inventar un color
      if (name in values) return name.startsWith('bloque_firma_') ? (values[name] as string) : escapeHtml(values[name] as string);
      return '';
    });
    html = html.replace('<head>', `<head>\n  ${CSP}`);
    html = this.inlineLogo(family, html);
    return { html, familia: family, borrador: true, firmas: 'SIN_FIRMA', completo: mapped.faltantes.length === 0, faltantes: mapped.faltantes, advertencias: mapped.advertencias };
  }

  private async composedTemplate(family: PreviewFamily): Promise<string> {
    const cached = this.composed.get(family);
    if (cached) return cached;
    this.componer ??= loadComposer(resolve(ROOT, 'tools/compose-template.mjs')).then((m) => m.componer);
    const componer = await this.componer;
    const html = componer(resolve(ROOT, SOURCES[family].template), {});
    // Las plantillas aprobadas no contienen JavaScript ni manejadores de eventos: si alguna llegara a tenerlos, la vista previa se niega a mostrarla.
    if (/<script|javascript:|\son[a-z]+\s*=/i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) throw new Error('La plantilla contiene contenido activo.');
    this.composed.set(family, html);
    return html;
  }

  // El PDF existente imprime con la carpeta images/ junto al HTML; en un iframe srcdoc esa ruta relativa no existe, así que el logo se incrusta como data URI (solo en la vista previa).
  private inlineLogo(family: PreviewFamily, html: string): string {
    const logo = readFileSync(resolve(ROOT, SOURCES[family].images, 'DC_logo.jpg'));
    return html.replace('.\\images\\DC_logo.jpg', `data:image/jpeg;base64,${logo.toString('base64')}`);
  }
}
