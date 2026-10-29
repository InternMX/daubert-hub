import { Inject, Injectable, Logger } from '@nestjs/common';
import { HttpException, HttpStatus, UnprocessableEntityException } from '@nestjs/common';
import type { PreviewFamily, PreviewFormData } from './sheet-data.mapper';
import { SheetPdfRenderer, PDF_RENDERER_OPTIONS, type PdfRendererOptions } from './sheet-pdf.renderer';
import { SheetPreviewService } from './sheet-preview.service';
import type { BindReviewContext } from './technical-coherence';

export interface DraftPdf {
  pdf: Buffer;
  filename: string;
  /** Datos técnicos completos para la familia; si no, el PDF se identifica como INCOMPLETO. */
  completo: boolean;
}

/** Mismo formato que valida la búsqueda en BIND: letras, dígitos, punto, guion y guion bajo (máximo 64). */
const CODIGO_DCMX = /^[A-Za-z0-9._-]{1,64}$/;
const NOMBRES_RESERVADOS_WINDOWS = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
export const NOMBRE_GENERICO = 'HOJA_SIN_CODIGO';

/**
 * Código DCMX utilizable como nombre del archivo y título del PDF, o null si falta o no es válido. El código se conserva TAL CUAL (nunca se sustituye por la descripción ni la familia); solo se
 * rechaza lo que no es un código válido (espacios, separadores de ruta, caracteres de control…), lo que se completa con un nombre genérico en vez de «arreglarlo».
 */
export function codigoDcmxSeguro(codigo: string | undefined): string | null {
  const c = (codigo ?? '').trim();
  if (!CODIGO_DCMX.test(c) || /^[.-]+$/.test(c) || c.startsWith('.')) return null;      // sin archivos ocultos ni nombres solo de puntuación
  return NOMBRES_RESERVADOS_WINDOWS.test(c) ? `_${c}` : c;
}

/** `<CODIGO_DCMX>.pdf`, o un nombre genérico seguro si no hay un código válido. */
export function nombreArchivoBorrador(codigo: string | undefined): string {
  return `${codigoDcmxSeguro(codigo) ?? NOMBRE_GENERICO}.pdf`;
}

/**
 * PDF de borrador de una hoja de manufactura. UNA sola composición: llama al MISMO `SheetPreviewService.preview` que la vista previa (mismos datos, plantilla, escape y validaciones) con la capa de
 * borrador integrada, y entrega ese HTML al renderizador. No acepta HTML ni rutas del cliente, no guarda el documento y no registra contenido de las hojas.
 */
@Injectable()
export class SheetPdfService {
  private readonly logger = new Logger(SheetPdfService.name);
  private readonly renderer: SheetPdfRenderer;

  constructor(private readonly preview: SheetPreviewService, @Inject(PDF_RENDERER_OPTIONS) options: PdfRendererOptions) {
    this.renderer = new SheetPdfRenderer(options);
  }

  get disponible(): boolean { return this.renderer.disponible; }

  async generarBorrador(family: PreviewFamily, form: PreviewFormData, context?: BindReviewContext): Promise<DraftPdf> {
    const resultado = await this.preview.preview(family, form, context, { capaBorrador: true, tituloPdf: codigoDcmxSeguro(form.codigo) ?? NOMBRE_GENERICO });
    // Mismo criterio que la vista previa: lo que no se muestra (modalidad no autorizada) tampoco se imprime.
    if (resultado.bloqueado) throw new UnprocessableEntityException({ code: 'PDF_BLOCKED', message: `${resultado.bloqueado} No se genera un documento para no producir una hoja engañosa.` });
    const t0 = Date.now();
    const salida = await this.renderer.render(resultado.html);
    switch (salida.kind) {
      case 'OK':
        return { pdf: salida.pdf, filename: nombreArchivoBorrador(form.codigo), completo: resultado.completo };
      case 'NO_DISPONIBLE':
        throw new HttpException({ code: 'PDF_NOT_AVAILABLE', message: 'La generación de PDF no está disponible en este entorno.' }, HttpStatus.NOT_IMPLEMENTED);
      case 'OCUPADO':
        throw new HttpException({ code: 'PDF_BUSY', message: 'Hay varios PDF en proceso. Intenta de nuevo en unos segundos.', retryAfterSeconds: 5 }, HttpStatus.TOO_MANY_REQUESTS);
      case 'TIMEOUT':
        this.logger.warn(`PDF de borrador: el renderizado superó el tiempo máximo (${family}, ${Date.now() - t0} ms)`);      // sin código, textos ni datos de la hoja
        throw new HttpException({ code: 'PDF_TIMEOUT', message: 'La generación del PDF tardó demasiado.' }, HttpStatus.GATEWAY_TIMEOUT);
      default:
        this.logger.warn(`PDF de borrador: el renderizado falló (${family})`);
        throw new HttpException({ code: 'PDF_FAILED', message: 'No se pudo generar el PDF.' }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
