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

/** Nombre de archivo seguro: lista cerrada de caracteres, longitud acotada y sustituto fijo si el código falta. Nunca incluye datos libres. */
export function nombreArchivoBorrador(codigo: string | undefined, familia: string, completo: boolean): string {
  const limpio = (codigo ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+/, '').slice(0, 40);
  return `${completo ? 'BORRADOR' : 'BORRADOR-INCOMPLETO'}_${limpio || 'SIN-CODIGO'}_${familia}.pdf`;
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
    const resultado = await this.preview.preview(family, form, context, { capaBorrador: true });
    // Mismo criterio que la vista previa: lo que no se muestra (modalidad no autorizada) tampoco se imprime.
    if (resultado.bloqueado) throw new UnprocessableEntityException({ code: 'PDF_BLOCKED', message: `${resultado.bloqueado} No se genera un documento para no producir una hoja engañosa.` });
    const t0 = Date.now();
    const salida = await this.renderer.render(resultado.html);
    switch (salida.kind) {
      case 'OK':
        return { pdf: salida.pdf, filename: nombreArchivoBorrador(form.codigo, family, resultado.completo), completo: resultado.completo };
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
