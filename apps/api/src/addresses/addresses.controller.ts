import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import type { RequestWithId } from '../common/request-id.middleware';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

interface AddressRequest extends RequestWithId {
  user?: { id?: string | number | null; email?: string | null };
}

@Controller()
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get('companies/:companyId/addresses')
  list(@Param('companyId') companyId: string): ReturnType<AddressesService['list']> {
    this.assertId(companyId, 'empresa');
    return this.addresses.list(companyId);
  }

  @Post('companies/:companyId/addresses')
  @HttpCode(HttpStatus.CREATED)
  create(@Param('companyId') companyId: string, @Body() input: CreateAddressDto, @Req() request: AddressRequest): ReturnType<AddressesService['create']> {
    this.assertId(companyId, 'empresa');
    return this.addresses.create(companyId, input, request.requestId, this.identity(request));
  }

  @Patch('addresses/:addressId')
  update(@Param('addressId') id: string, @Body() input: UpdateAddressDto, @Req() request: AddressRequest): ReturnType<AddressesService['update']> {
    this.assertId(id, 'dirección');
    return this.addresses.update(id, input, request.requestId, this.identity(request));
  }

  @Post('addresses/:addressId/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('addressId') id: string, @Req() request: AddressRequest): ReturnType<AddressesService['deactivate']> {
    this.assertId(id, 'dirección');
    return this.addresses.deactivate(id, request.requestId, this.identity(request));
  }

  @Post('addresses/:addressId/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('addressId') id: string, @Req() request: AddressRequest): ReturnType<AddressesService['reactivate']> {
    this.assertId(id, 'dirección');
    return this.addresses.reactivate(id, request.requestId, this.identity(request));
  }

  private assertId(id: string, entity: string): void {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) throw new BadRequestException(`El identificador de ${entity} debe ser un entero positivo.`);
  }

  private identity(request: AddressRequest): { userId: string | null; userEmail: string | null } {
    return { userId: request.user?.id == null ? null : String(request.user.id), userEmail: request.user?.email ?? null };
  }
}
