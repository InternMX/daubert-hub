import { BadRequestException, Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ContactDirectoryService } from './contact-directory.service';
import { ListContactDirectoryCompaniesDto } from './dto/list-contact-directory-companies.dto';

@Controller('contact-directory/companies')
export class ContactDirectoryController {
  constructor(private readonly directory: ContactDirectoryService) {}
  @Get() list(@Query() query: ListContactDirectoryCompaniesDto) { return this.directory.list(query); }
  @Get(':id') get(@Param('id', ParseIntPipe) id: number) { if (id < 1) throw new BadRequestException('El identificador de la empresa debe ser un entero positivo.'); return this.directory.get(id); }
}
