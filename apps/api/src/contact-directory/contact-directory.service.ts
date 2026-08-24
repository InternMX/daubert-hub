import { Injectable, NotFoundException } from '@nestjs/common';
import type { ListContactDirectoryCompaniesDto } from './dto/list-contact-directory-companies.dto';
import { ContactDirectoryRepository } from './contact-directory.repository';

@Injectable()
export class ContactDirectoryService {
  constructor(private readonly repository: ContactDirectoryRepository) {}
  async list(input: ListContactDirectoryCompaniesDto) {
    const result = await this.repository.list(input);
    return { data: result.companies.map((company) => ({ id: company.id, commercialName: company.commercial_name, companyType: company.company_type, contactCount: Number(company.contact_count), matchedAlias: company.matched_alias })), meta: { page: input.page, pageSize: input.pageSize, total: result.total, totalPages: Math.ceil(result.total / input.pageSize) } };
  }
  async get(id: number) {
    const result = await this.repository.findById(id);
    if (!result) throw new NotFoundException('Empresa no encontrada.');
    return { data: { company: { id: result.company.id, commercialName: result.company.commercial_name, companyType: result.company.company_type }, contacts: result.contacts.map((contact) => ({ id: contact.id, name: contact.name, contactType: contact.contact_type, area: contact.area, position: contact.position, notes: contact.notes, isPrimary: contact.is_primary, methods: contact.methods.map((method) => ({ id: method.id, type: method.type, value: method.value, isPrimary: method.is_primary })), inactiveMethods: contact.inactiveMethods.map((method) => ({ id: method.id, type: method.type, value: method.value, isPrimary: method.is_primary })) })) } };
  }
}
