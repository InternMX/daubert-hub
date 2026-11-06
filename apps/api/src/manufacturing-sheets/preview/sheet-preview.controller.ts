import { Body, Controller, Header, HttpCode, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ManufacturingSheetsEnabledGuard } from '../../manufacturing-documents/manufacturing-enabled.guard';
import type { Response } from 'express';
import { SheetPreviewRequestDto } from './sheet-preview.dto';
import { SheetPdfService } from './sheet-pdf.service';
import { SheetPreviewService, type SheetPreviewResult } from './sheet-preview.service';

// Vista previa HTML de una hoja de manufactura (Bolsa Plana 1 / Hoja Paq): autenticada por los guards globales (no @Public) y SIN persistencia. Es un POST solo porque
// envía el contenido del formulario; no crea ni guarda nada (200, no 201). La respuesta siempre es un borrador sin aprobar con firmas SIN FIRMA.
// Ruta final: POST /api/manufacturing-sheets/previews
@Controller('manufacturing-sheets/previews')
@UseGuards(ManufacturingSheetsEnabledGuard)
export class SheetPreviewController {
  constructor(private readonly preview: SheetPreviewService, private readonly pdf: SheetPdfService) {}

  @Post()
  @HttpCode(200)
  async create(@Body() body: SheetPreviewRequestDto): Promise<{ data: SheetPreviewResult }> {
    return { data: await this.preview.preview(body.familia, body.datos, body.contexto) };
  }

  /**
   * PDF de borrador del MISMO documento (mismo DTO, misma composición y validaciones): POST /api/manufacturing-sheets/previews/pdf. Autenticado por los guards globales (no @Public) y protegido por
   * el CSRF de origen como el resto de los POST. No guarda nada. 422 si la vista previa no mostraría el documento; 501 si el entorno no tiene renderizador; 429 si está ocupado; 504 por tiempo.
   */
  @Post('pdf')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadPdf(@Body() body: SheetPreviewRequestDto, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const documento = await this.pdf.generarBorrador(body.familia, body.datos, body.contexto);
    res.setHeader('Content-Disposition', `attachment; filename="${documento.filename}"`);
    res.setHeader('X-Draft-Complete', documento.completo ? '1' : '0');
    // El tipo solo se fija en el éxito: las respuestas de error siguen siendo JSON.
    return new StreamableFile(documento.pdf, { type: 'application/pdf' });
  }
}
