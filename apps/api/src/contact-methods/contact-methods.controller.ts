import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { identityFromRequest, type AuthenticatedRequest } from '../common/authenticated-request';
import { AddContactMethodDto } from './dto/add-contact-method.dto';
import { EditContactMethodDto } from './dto/edit-contact-method.dto';
import { ContactMethodsService, type AddedContactMethodResponse, type ContactMethodResponse } from './contact-methods.service';

@Controller('contacts')
export class ContactMethodsForContactsController {
  constructor(private readonly contactMethods: ContactMethodsService) {}

  @Post(':id/methods')
  @HttpCode(HttpStatus.CREATED)
  add(@Param('id') id: string, @Body() input: AddContactMethodDto, @Req() request: AuthenticatedRequest): Promise<AddedContactMethodResponse> {
    if (!/^[1-9]\d*$/.test(id)) throw new BadRequestException('El identificador del contacto debe ser un entero positivo.');
    return this.contactMethods.add(id, input, request.requestId, identityFromRequest(request));
  }
}

@Controller('contact-methods')
export class ContactMethodsController {
  constructor(private readonly contactMethods: ContactMethodsService) {}

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  edit(@Param('id') id: string, @Body() input: EditContactMethodDto, @Req() request: AuthenticatedRequest): Promise<AddedContactMethodResponse> {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) throw new BadRequestException('El identificador del medio de contacto debe ser un entero positivo.');
    return this.contactMethods.edit(id, input, request.requestId, identityFromRequest(request));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<ContactMethodResponse> {
    if (id < 1) throw new BadRequestException('El identificador del medio de contacto debe ser un entero positivo.');
    return this.contactMethods.deactivate(id, request.requestId, identityFromRequest(request));
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<ContactMethodResponse> {
    if (id < 1) throw new BadRequestException('El identificador del medio de contacto debe ser un entero positivo.');
    return this.contactMethods.reactivate(id, request.requestId, identityFromRequest(request));
  }
}
