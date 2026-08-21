import { Controller, Get, Query } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { SearchCompaniesDto } from './dto/search-companies.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get('search')
  search(@Query() query: SearchCompaniesDto) { return this.companies.search(query); }
}
