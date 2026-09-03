import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeAliasList } from '../companies/company-aliases.repository';
import { AliasesRepository, type AuditIdentity, type CompanyAliases } from './aliases.repository';

interface PostgreSqlError { code?: string; constraint?: string }

@Injectable()
export class AliasesService {
  constructor(private readonly repository: AliasesRepository) {}

  async list(companyId: string): Promise<{ data: CompanyAliases }> {
    const result = await this.repository.list(companyId);
    if (!result) throw new NotFoundException('Empresa no encontrada.');
    return { data: result };
  }

  async replace(companyId: string, aliases: string[], requestId: string, identity: AuditIdentity): Promise<{ data: CompanyAliases }> {
    const normalized = this.normalize(aliases);
    try {
      const result = await this.repository.replace(companyId, normalized, requestId, identity);
      if (!result) throw new NotFoundException('Empresa no encontrada.');
      return { data: result };
    } catch (error) {
      this.throwKnown(error);
      throw error;
    }
  }

  private normalize(aliases: string[]): string[] {
    try {
      return normalizeAliasList(aliases);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ALIASES_EMPTY') throw new BadRequestException('Los alias no pueden estar vacíos.');
      if (code === 'ALIASES_DUPLICATE') throw new BadRequestException('Los alias no pueden estar duplicados.');
      throw error;
    }
  }

  private throwKnown(error: unknown): void {
    const code = (error as { code?: string }).code;
    const constraint = (error as PostgreSqlError).constraint;
    if (code === 'ALIAS_ALREADY_ASSOCIATED') throw new ConflictException({ code, message: 'Este alias ya está asociado a otra empresa.' });
    if (code === '23505' && constraint === 'uq_alias_empresa_activo') throw new ConflictException({ code: 'ALIAS_ALREADY_ASSOCIATED', message: 'Este alias ya está asociado a otra empresa.' });
  }
}
