import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { identityFromRequest, type AuthenticatedRequest } from '../common/authenticated-request';
import { Roles } from '../security/route-access.decorators';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { ClientsService } from './clients.service';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@Query() input: ListClientsDto) {
    return this.clients.list(input);
  }

  @Get(':clientId')
  detail(@Param('clientId') clientId: string) {
    this.assertId(clientId);
    return this.clients.detail(clientId);
  }

  // El alta definitiva de un cliente (incluida la que agrega el rol CLIENTE a una empresa existente) es solo de ADMIN. Lo impone el RolesGuard global (403 ROLE_NOT_ALLOWED): no depende de la interfaz.
  // La consulta (GET) y el resto de rutas conservan su acceso actual.
  @Roles('ADMIN')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() input: CreateClientDto, @Req() request: AuthenticatedRequest) {
    return this.clients.create(input, request.requestId, identityFromRequest(request));
  }

  @Patch(':clientId')
  update(@Param('clientId') clientId: string, @Body() input: UpdateClientDto, @Req() request: AuthenticatedRequest) {
    this.assertId(clientId);
    return this.clients.update(clientId, input, request.requestId, identityFromRequest(request));
  }

  @Post(':clientId/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('clientId') clientId: string, @Req() request: AuthenticatedRequest) {
    this.assertId(clientId);
    return this.clients.deactivate(clientId, request.requestId, identityFromRequest(request));
  }

  @Post(':clientId/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('clientId') clientId: string, @Req() request: AuthenticatedRequest) {
    this.assertId(clientId);
    return this.clients.reactivate(clientId, request.requestId, identityFromRequest(request));
  }

  private assertId(id: string): void {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new BadRequestException('El identificador del cliente debe ser un entero positivo.');
    }
  }
}
