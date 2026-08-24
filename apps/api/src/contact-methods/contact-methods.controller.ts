import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import type { RequestWithId } from '../common/request-id.middleware';
import { AddContactMethodDto } from './dto/add-contact-method.dto';
import { ContactMethodsService, type AddedContactMethodResponse, type ContactMethodResponse } from './contact-methods.service';

@Controller('contacts')
export class ContactMethodsForContactsController {
  constructor(private readonly contactMethods: ContactMethodsService) {}

  @Post(':id/methods')
  @HttpCode(HttpStatus.CREATED)
  add(@Param('id') id: string, @Body() input: AddContactMethodDto, @Req() request: RequestWithId): Promise<AddedContactMethodResponse> {
    if (!/^[1-9]\d*$/.test(id)) throw new BadRequestException('El identificador del contacto debe ser un entero positivo.');
    return this.contactMethods.add(id, input, request.requestId);
  }
}

@Controller('contact-methods')
export class ContactMethodsController {
  constructor(private readonly contactMethods: ContactMethodsService) {}

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseIntPipe) id: number, @Req() request: RequestWithId): Promise<ContactMethodResponse> {
    if (id < 1) throw new BadRequestException('El identificador del medio de contacto debe ser un entero positivo.');
    return this.contactMethods.deactivate(id, request.requestId);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@Param('id', ParseIntPipe) id: number, @Req() request: RequestWithId): Promise<ContactMethodResponse> {
    if (id < 1) throw new BadRequestException('El identificador del medio de contacto debe ser un entero positivo.');
    return this.contactMethods.reactivate(id, request.requestId);
  }
}
