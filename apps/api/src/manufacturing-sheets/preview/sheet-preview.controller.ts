import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { SheetPreviewRequestDto } from './sheet-preview.dto';
import { SheetPreviewService, type SheetPreviewResult } from './sheet-preview.service';

// Vista previa HTML de una hoja de manufactura (Bolsa Plana 1 / Hoja Paq): autenticada por los guards globales (no @Public) y SIN persistencia. Es un POST solo porque
// envía el contenido del formulario; no crea ni guarda nada (200, no 201). La respuesta siempre es un borrador sin aprobar con firmas SIN FIRMA.
// Ruta final: POST /api/manufacturing-sheets/previews
@Controller('manufacturing-sheets/previews')
export class SheetPreviewController {
  constructor(private readonly preview: SheetPreviewService) {}

  @Post()
  @HttpCode(200)
  async create(@Body() body: SheetPreviewRequestDto): Promise<{ data: SheetPreviewResult }> {
    return { data: await this.preview.preview(body.familia, body.datos) };
  }
}
