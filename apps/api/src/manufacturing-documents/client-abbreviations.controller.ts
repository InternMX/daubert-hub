import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/authenticated-request';
import { CreateAbbreviationDto, ListAbbreviationsQueryDto, ResolveAbbreviationDto, SuggestionsQueryDto } from './client-abbreviations.dto';
import { ClientAbbreviationsService } from './client-abbreviations.service';
import { actorDeSolicitud } from './documents.controller';
import { ManufacturingEnabledGuard } from './manufacturing-enabled.guard';
import { DetalleValidacionFilter } from './validation-detail.filter';

// Abreviaturas de cliente (TEST). Rutas: /api/manufacturing-sheets/client-abbreviations/…  La identidad sale SOLO de la sesión. Las sugerencias nunca asignan un cliente.
@Controller('manufacturing-sheets/client-abbreviations')
@UseGuards(ManufacturingEnabledGuard)
@UseFilters(DetalleValidacionFilter)
export class ClientAbbreviationsController {
  constructor(private readonly servicio: ClientAbbreviationsService) {}

  /** ¿Catálogo habilitado (migración 104)? y si esta cuenta puede resolver. */
  @Get('status')
  status(@Req() request: AuthenticatedRequest): ReturnType<ClientAbbreviationsService['estado']> { return this.servicio.estado(actorDeSolicitud(request)); }

  @Get('suggestions')
  suggestions(@Query() query: SuggestionsQueryDto, @Req() request: AuthenticatedRequest): ReturnType<ClientAbbreviationsService['sugerir']> {
    return this.servicio.sugerir(actorDeSolicitud(request), query.codigo);
  }

  /** Administración (ADMIN) o, con `clienteId`, consulta de la ficha de un cliente (la base limita a una cuenta GENERAL a lo confirmado y a sus propias propuestas). */
  @Get()
  list(@Query() query: ListAbbreviationsQueryDto, @Req() request: AuthenticatedRequest): ReturnType<ClientAbbreviationsService['listar']> {
    return this.servicio.listar(actorDeSolicitud(request), query.estado, query.q, query.clienteId);
  }

  /** GENERAL propone; ADMIN registra (confirmada por omisión). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateAbbreviationDto, @Req() request: AuthenticatedRequest): ReturnType<ClientAbbreviationsService['crear']> {
    return this.servicio.crear(actorDeSolicitud(request), body);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ResolveAbbreviationDto, @Req() request: AuthenticatedRequest): ReturnType<ClientAbbreviationsService['resolver']> {
    return this.servicio.resolver(actorDeSolicitud(request), id, body.accion, body.motivo);
  }
}
