import { Controller, Get, Param } from '@nestjs/common';
import { BindProductsService, type BindProductLookupResponse } from './bind-products.service';

// Consulta de productos de BIND para manufactura (solo lectura). Autenticada por los guards globales (AuthGuard, MustChangePasswordGuard, RolesGuard):
// deliberadamente NO es @Public(). Sin @Roles(): la consulta está abierta a ADMIN y GENERAL, como el resto de las rutas de negocio.
// Rutas finales: GET /api/manufacturing-sheets/bind-products/by-code/:code y GET /api/manufacturing-sheets/bind-products/by-id/:id
@Controller('manufacturing-sheets/bind-products')
export class BindProductsController {
  constructor(private readonly products: BindProductsService) {}

  @Get('by-code/:code')
  byCode(@Param('code') code: string): Promise<BindProductLookupResponse> {
    return this.products.lookupByCode(code);
  }

  @Get('by-id/:id')
  byId(@Param('id') id: string): Promise<BindProductLookupResponse> {
    return this.products.lookupById(id);
  }
}
