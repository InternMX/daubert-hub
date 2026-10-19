import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FAMILIAS, modalidadesDe, type FamilyCode } from './family-registry';
import { mapSheetData, type PreviewFamily, type PreviewFormData } from './sheet-data.mapper';
import { consolidarIncidencias, incidencia, type Incidencia } from './incidencias';
import { revisarCoherencia, type BindReviewContext } from './technical-coherence';

// Vista previa HTML de las Hojas de Instrucción de Manufactura. Reutiliza EXACTAMENTE el compositor (tools/compose-template.mjs), las plantillas aprobadas y los validadores de
// tools/: aquí solo se sustituyen los placeholders (con escape) y se endurece el HTML para mostrarlo en un iframe aislado. No escribe en disco ni en PostgreSQL.
//
// Ajuste arquitectónico: el compositor es un módulo ESM (.mjs) y la API compila a CommonJS; se carga con import() (sin copiar su lógica).
// Las plantillas y herramientas viven junto a este código (src/ en desarrollo, dist/src/ en producción, copiadas por los assets de nest-cli.json).

const ROOT = resolve(__dirname, '..');

export const SIN_FIRMA_MARKER = '<span class="sin-firma">SIN FIRMA</span>';
const PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g;
// Política del iframe: sin scripts, sin red, solo estilos en línea e imágenes incrustadas.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">`;

type Componer = (fuente: string, parametros?: Record<string, string>) => string;
type Validador = (contrato: { formato: string; modalidad?: string; datos: Record<string, string> }) => string[];
// El compositor y los validadores son ESM y la API compila a CommonJS: `import()` se emite como require(), y Node >= 22.12 (la imagen de producción usa Node 24) carga módulos ESM síncronos con require().
// Se pasa una RUTA (no un file:// URL): require() no acepta URLs.
const loadModule = async <T>(file: string): Promise<T> => (await import(file)) as T;

export interface SheetPreviewResult {
  html: string;
  familia: PreviewFamily;
  /** La vista previa siempre es un borrador sin aprobar con firmas SIN FIRMA: nunca una hoja emitida. */
  borrador: true;
  firmas: 'SIN_FIRMA';
  /** Datos TÉCNICOS completos para esta familia (el cliente no cuenta: ver `pendientesEmision`). */
  completo: boolean;
  faltantes: string[];
  advertencias: string[];
  /** Requisitos de una emisión futura que no impiden la demostración (p. ej. «Cliente»). */
  pendientesEmision: string[];
  /** Motivo por el que no se muestra el documento (p. ej. modalidad sin variante gráfica autorizada); null si se muestra. */
  bloqueado: string | null;
  /** Lista ÚNICA de incidencias de esta vista previa (modelo único, sin duplicados por causa): faltantes, valores no válidos, coherencia técnica y bloqueo. `faltantes`, `advertencias` y `pendientesEmision` son proyecciones de ella. */
  incidencias: Incidencia[];
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c] as string);
}

@Injectable()
export class SheetPreviewService {
  private readonly composed = new Map<FamilyCode, string>();
  private componer: Promise<Componer> | null = null;

  async preview(family: PreviewFamily, form: PreviewFormData, context?: BindReviewContext): Promise<SheetPreviewResult> {
    const def = FAMILIAS[family];
    const mapped = mapSheetData(family, form);
    const coherencia = revisarCoherencia(family, form, context);
    const resultado = (extra: Partial<SheetPreviewResult>, adicionales: Incidencia[] = []): SheetPreviewResult => ({
      html: '', familia: family, borrador: true, firmas: 'SIN_FIRMA', completo: mapped.faltantes.length === 0, faltantes: mapped.faltantes, advertencias: mapped.advertencias,
      pendientesEmision: mapped.pendientesEmision, bloqueado: null, incidencias: consolidarIncidencias([...mapped.incidencias, ...coherencia, ...adicionales]), ...extra
    });

    // Modalidades SIN variante gráfica confirmada (perfil): no se genera un documento engañoso.
    const modalidad = (form.modalidad ?? '').trim();
    const bloqueada = modalidadesDe(def).find((m) => m.valor === modalidad && !m.habilitada);
    if (bloqueada) {
      const motivo = `La modalidad ${bloqueada.etiqueta} de ${def.nombre} no está autorizada: ${bloqueada.motivo ?? 'sin variante gráfica confirmada por Manufactura.'}`;
      return resultado({ completo: false, bloqueado: motivo }, [incidencia({ codigo: 'MODALIDAD_NO_AUTORIZADA', nivel: 'ERROR', campos: ['modalidad'], seccion: 'datos', mensaje: motivo, origen: 'PLANTILLA', afectaVistaPrevia: true })]);
    }

    // Red de seguridad: el validador autoritativo de tools/ revisa los datos ya completos (composición fija, indicadores X/NA, cotas…).
    const errores = mapped.faltantes.length === 0 ? await this.validar(def.validador, family, modalidad, mapped.datos) : [];
    if (errores.length > 0) mapped.advertencias.push(...errores.map((e) => `Validación de la familia: ${e}`));
    const incidenciasValidador = errores.map((e) => incidencia({ codigo: 'VALIDACION_FAMILIA', id: `VALIDACION_FAMILIA:${e}`, nivel: 'ERROR', mensaje: `Validación de la familia: ${e}`, seccion: 'datos', origen: 'PLANTILLA', afectaVistaPrevia: true }));

    const template = await this.composedTemplate(family);
    const values: Record<string, string> = { ...mapped.datos, bloque_firma_elaboro: SIN_FIRMA_MARKER, bloque_firma_aprobo: SIN_FIRMA_MARKER };
    // Una sola pasada sobre la plantilla: un valor con «{{x}}» nunca se vuelve a interpretar. Los textos se escapan; los bloques de firma son el marcador fijo.
    let html = template.replace(PLACEHOLDER, (whole, name: string) => {
      if (name in mapped.visual) return mapped.visual[name] ?? whole;          // sin color válido el placeholder queda y la plantilla muestra gris, sin inventar un color
      if (name in values) return name.startsWith('bloque_firma_') ? (values[name] as string) : escapeHtml(values[name] as string);
      return '';
    });
    html = html.replace('<head>', `<head>\n  ${CSP}`);
    html = this.inlineImages(family, html);
    return resultado({ html, completo: mapped.faltantes.length === 0 && mapped.advertencias.length === 0 && errores.length === 0, advertencias: mapped.advertencias }, incidenciasValidador);
  }

  private async validar(validador: { archivo: string; funcion: string } | null, family: FamilyCode, modalidad: string, datos: Record<string, string>): Promise<string[]> {
    if (!validador) return [];
    const modulo = await loadModule<Record<string, Validador>>(resolve(ROOT, 'tools', validador.archivo));
    const formato = JSON.parse(readFileSync(resolve(ROOT, 'profiles', FAMILIAS[family].perfil), 'utf8')) as { formato: string };
    return (modulo[validador.funcion] as Validador)({ formato: formato.formato, ...(modalidad ? { modalidad } : {}), datos });
  }

  private async composedTemplate(family: FamilyCode): Promise<string> {
    const cached = this.composed.get(family);
    if (cached) return cached;
    this.componer ??= loadModule<{ componer: Componer }>(resolve(ROOT, 'tools/compose-template.mjs')).then((m) => m.componer);
    const componer = await this.componer;
    const html = componer(resolve(ROOT, FAMILIAS[family].plantilla), {});
    // Las plantillas aprobadas no contienen JavaScript ni manejadores de eventos: si alguna llegara a tenerlos, la vista previa se niega a mostrarla.
    if (/<script|javascript:|\son[a-z]+\s*=/i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) throw new Error('La plantilla contiene contenido activo.');
    this.composed.set(family, html);
    return html;
  }

  // En srcdoc no existe la carpeta images/ y CSP bloquea la red. Solo se incrustan estos dos recursos FIJOS aprobados; nunca se aceptan rutas del usuario.
  private inlineImages(family: FamilyCode, html: string): string {
    const logo = readFileSync(resolve(ROOT, FAMILIAS[family].imagenes, 'DC_logo.jpg'));
    let result = html.replace('.\\images\\DC_logo.jpg', `data:image/jpeg;base64,${logo.toString('base64')}`);
    if (result.includes('href="images/rollo_doblado_original.png"')) {
      const rollo = readFileSync(resolve(ROOT, FAMILIAS[family].imagenes, 'rollo_doblado_original.png'));
      result = result.replace('href="images/rollo_doblado_original.png"', `href="data:image/png;base64,${rollo.toString('base64')}"`);
    }
    return result;
  }
}
