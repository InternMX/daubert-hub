import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import type { RequestWithId } from '../common/request-id.middleware';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import type { CreateContactResponse, UpdateContactResponse } from './contacts.service';
import { ContactsService } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() input: CreateContactDto, @Req() request: RequestWithId): Promise<CreateContactResponse> {
    return this.contacts.create(input, request.requestId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() input: UpdateContactDto, @Req() request: RequestWithId): Promise<UpdateContactResponse> {
    if (!/^[1-9]\d*$/.test(id)) throw new BadRequestException('El identificador del contacto debe ser un entero positivo.');
    return this.contacts.update(id, input, request.requestId);
  }
}
