import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { identityFromRequest, type AuthenticatedRequest } from '../common/authenticated-request';
import { CreateProviderDto } from './dto/create-provider.dto';
import { ListProvidersDto } from './dto/list-providers.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import type { CreateProviderResponse, GetProviderResponse, ListProvidersResponse } from './providers.service';
import { ProvidersService } from './providers.service';

@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  list(@Query() input: ListProvidersDto): Promise<ListProvidersResponse> {
    return this.providers.list(input);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<GetProviderResponse> {
    if (id < 1) {
      throw new BadRequestException('El identificador del proveedor debe ser un entero positivo.');
    }
    return this.providers.get(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() input: CreateProviderDto, @Req() request: AuthenticatedRequest): Promise<CreateProviderResponse> {
    return this.providers.create(input, request.requestId, identityFromRequest(request));
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() input: UpdateProviderDto, @Req() request: AuthenticatedRequest): Promise<GetProviderResponse> {
    if (id < 1) throw new BadRequestException('El identificador del proveedor debe ser un entero positivo.');
    return this.providers.update(id, input, request.requestId, identityFromRequest(request));
  }

  @Post(':id/deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<GetProviderResponse> {
    if (id < 1) throw new BadRequestException('El identificador del proveedor debe ser un entero positivo.');
    return this.providers.deactivate(id, request.requestId, identityFromRequest(request));
  }

  @Post(':id/reactivate')
  reactivate(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<GetProviderResponse> {
    if (id < 1) throw new BadRequestException('El identificador del proveedor debe ser un entero positivo.');
    return this.providers.reactivate(id, request.requestId, identityFromRequest(request));
  }
}
