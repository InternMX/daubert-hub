import { Controller, Get } from '@nestjs/common';
import { configuracionFamilias, type FamilyConfigDto } from './family-registry';

// Configuración de las familias de manufactura (campos, obligatorios, composiciones, colores y modalidades autorizadas) para el formulario. Solo lectura, sin PostgreSQL: el
// REGISTRO del backend es la autoridad y el frontend no replica reglas familiares. Autenticada por los guards globales (no @Public).
// Ruta final: GET /api/manufacturing-sheets/families
@Controller('manufacturing-sheets/families')
export class FamiliesController {
  @Get()
  list(): { data: FamilyConfigDto[] } {
    return { data: configuracionFamilias() };
  }
}
