import { BadRequestException, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import type { RequestWithId } from '../common/request-id.middleware';
import { ContactMethodsService, type ContactMethodResponse } from './contact-methods.service';

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
