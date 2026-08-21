import { Injectable } from '@nestjs/common';
import type { SearchCompaniesDto } from './dto/search-companies.dto';
import { CompaniesRepository } from './companies.repository';

@Injectable()
export class CompaniesService {
  constructor(private readonly repository: CompaniesRepository) {}

  async search(input: SearchCompaniesDto) {
    const companies = await this.repository.search(input.search);
    return { data: companies.map((company) => ({ id: company.id, commercialName: company.commercial_name, companyType: company.company_type, legalName: company.legal_name, rfc: company.rfc, matchedAlias: company.matched_alias })) };
  }
}
