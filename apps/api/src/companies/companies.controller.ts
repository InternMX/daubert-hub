import { Controller, Get, Query } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { suggestDropboxPath } from '../payment-notification-settings/dropbox-path';
import { SearchCompaniesDto } from './dto/search-companies.dto';
import { SuggestDropboxPathDto } from './dto/suggest-dropbox-path.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get('search')
  search(@Query() query: SearchCompaniesDto) { return this.companies.search(query); }

  // Calculation only: nothing is written and nothing is persisted. The user confirms (or edits) the
  // suggestion and it reaches the API afterwards as the provider's rutaDropbox.
  @Get('dropbox-path-suggestion')
  suggestDropboxPath(@Query() query: SuggestDropboxPathDto): { data: { suggestedDropboxPath: string | null } } {
    return { data: { suggestedDropboxPath: suggestDropboxPath(query.companyType, query.commercialName) } };
  }
}
