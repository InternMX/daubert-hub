import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ManufacturingSheetsEnabledGuard } from '../../manufacturing-documents/manufacturing-enabled.guard';
import { BindProductsService, type BindProductLookupResponse, type BindRecentResponse } from './bind-products.service';

// Consulta de productos de BIND para manufactura (solo lectura). Autenticada por los guards globales (AuthGuard, MustChangePasswordGuard, RolesGuard):
// deliberadamente NO es @Public(). Sin @Roles(): la consulta está abierta a ADMIN y GENERAL, como el resto de las rutas de negocio.
// Rutas finales: GET /api/manufacturing-sheets/bind-products/by-code/:code y GET /api/manufacturing-sheets/bind-products/by-id/:id
@Controller('manufacturing-sheets/bind-products')
@UseGuards(ManufacturingSheetsEnabledGuard)
export class BindProductsController {
  constructor(private readonly products: BindProductsService) {}

  /** Novedades del catálogo (una página ordenada por fecha de alta). Ruta final: GET /api/manufacturing-sheets/bind-products/recent?skip=0&limit=30[&refresh=1] */
  @Get('recent')
  recent(@Query('skip') skip?: string, @Query('limit') limit?: string, @Query('refresh') refresh?: string): Promise<BindRecentResponse> {
    return this.products.listRecent(skip, limit, refresh === '1');
  }

  @Get('by-code/:code')
  byCode(@Param('code') code: string): Promise<BindProductLookupResponse> {
    return this.products.lookupByCode(code);
  }

  @Get('by-id/:id')
  byId(@Param('id') id: string): Promise<BindProductLookupResponse> {
    return this.products.lookupById(id);
  }
}
