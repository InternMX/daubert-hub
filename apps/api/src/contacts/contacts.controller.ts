import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { RequestWithId } from '../common/request-id.middleware';
import { CreateContactDto } from './dto/create-contact.dto';
import type { CreateContactResponse } from './contacts.service';
import { ContactsService } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() input: CreateContactDto, @Req() request: RequestWithId): Promise<CreateContactResponse> {
    return this.contacts.create(input, request.requestId);
  }
}
