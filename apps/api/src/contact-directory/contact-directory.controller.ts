import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ContactDirectoryService } from './contact-directory.service';
import { ListContactDirectoryCompaniesDto } from './dto/list-contact-directory-companies.dto';

@Controller('contact-directory/companies')
export class ContactDirectoryController {
  constructor(private readonly directory: ContactDirectoryService) {}
  @Get() list(@Query() query: ListContactDirectoryCompaniesDto) { return this.directory.list(query); }
  @Get(':id') get(@Param('id') id: string) {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) throw new BadRequestException('El identificador de la empresa debe ser un entero positivo.');
    return this.directory.get(id);
  }
}
