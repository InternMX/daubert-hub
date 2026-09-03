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
import type { RequestWithId } from '../common/request-id.middleware';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { ClientsService } from './clients.service';

interface ClientRequest extends RequestWithId {
  user?: { id?: string | number | null; email?: string | null };
}

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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() input: CreateClientDto, @Req() request: ClientRequest) {
    return this.clients.create(input, request.requestId, this.identity(request));
  }

  @Patch(':clientId')
  update(@Param('clientId') clientId: string, @Body() input: UpdateClientDto, @Req() request: ClientRequest) {
    this.assertId(clientId);
    return this.clients.update(clientId, input, request.requestId, this.identity(request));
  }

  @Post(':clientId/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('clientId') clientId: string, @Req() request: ClientRequest) {
    this.assertId(clientId);
    return this.clients.deactivate(clientId, request.requestId, this.identity(request));
  }

  @Post(':clientId/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('clientId') clientId: string, @Req() request: ClientRequest) {
    this.assertId(clientId);
    return this.clients.reactivate(clientId, request.requestId, this.identity(request));
  }

  private assertId(id: string): void {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new BadRequestException('El identificador del cliente debe ser un entero positivo.');
    }
  }

  private identity(request: ClientRequest): { userId: string | null; userEmail: string | null } {
    return { userId: request.user?.id == null ? null : String(request.user.id), userEmail: request.user?.email ?? null };
  }
}
