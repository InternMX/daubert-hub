import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditIdentity } from '../common/authenticated-request';
import { normalizeAliasList } from '../companies/company-aliases.repository';
import { CreateProviderDto } from './dto/create-provider.dto';
import type { ListProvidersDto } from './dto/list-providers.dto';
import { FiscalChangeMode, type UpdateProviderDto } from './dto/update-provider.dto';
import { ProvidersRepository, type CreatedProviderRecord, type FoundProviderRecord, type ListedProvidersRecord } from './providers.repository';

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

export interface CreateProviderResponse {
  data: {
    id: string;
    commercialName: string;
    providerType: string;
    status: string;
    notes: string | null;
    fiscal: { id: string; legalName: string; rfc: string } | null;
  };
}

export interface ListProvidersResponse {
  data: Array<{
    id: string;
    commercialName: string;
    providerType: string;
    status: string;
    notes: string | null;
    matchedAlias: string | null;
    fiscal: { id: string; legalName: string; rfc: string } | null;
  }>;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface GetProviderResponse {
  data: {
    id: string;
    commercialName: string;
    providerType: string;
    roles: string[];
    status: string;
    notes: string | null;
    aliases: string[];
    otherAliases: Array<{ alias: string; type: string }>;
    fiscal: { id: string; legalName: string; rfc: string } | null;
  };
}

@Injectable()
export class ProvidersService {
  constructor(private readonly repository: ProvidersRepository) {}

  async create(input: CreateProviderDto, requestId: string, identity: AuditIdentity): Promise<CreateProviderResponse> {
    try {
      const created = await this.repository.create(input, requestId, identity);
      return this.mapResponse(created);
    } catch (error) {
      this.throwKnownConflict(error);
      throw error;
    }
  }

  async list(input: ListProvidersDto): Promise<ListProvidersResponse> {
    const listed = await this.repository.list(input);
    return this.mapListResponse(listed, input);
  }

  async get(id: string): Promise<GetProviderResponse> {
    const provider = await this.repository.findById(id);
    if (!provider) {
      throw new NotFoundException('Proveedor no encontrado.');
    }
    return this.mapGetResponse(provider);
  }

  async update(id: string, input: UpdateProviderDto, requestId: string, identity: AuditIdentity): Promise<GetProviderResponse> {
    this.validateFiscalFormat(input);
    const normalizedInput = this.normalizeAliases(input);
    try {
      const provider = await this.repository.update(id, normalizedInput, requestId, identity);
      if (!provider) throw new NotFoundException('Proveedor no encontrado.');
      return this.mapGetResponse(provider);
    } catch (error) {
      this.throwKnownConflict(error);
      throw error;
    }
  }

  async deactivate(id: string, requestId: string, identity: AuditIdentity): Promise<GetProviderResponse> {
    return this.changeStatus(id, 'INACTIVO', requestId, identity);
  }

  async reactivate(id: string, requestId: string, identity: AuditIdentity): Promise<GetProviderResponse> {
    return this.changeStatus(id, 'ACTIVO', requestId, identity);
  }

  private async changeStatus(id: string, status: 'ACTIVO' | 'INACTIVO', requestId: string, identity: AuditIdentity): Promise<GetProviderResponse> {
    try {
      const provider = await this.repository.changeStatus(id, status, requestId, identity);
      if (!provider) throw new NotFoundException('Proveedor no encontrado.');
      return this.mapGetResponse(provider);
    } catch (error) {
      this.throwKnownConflict(error);
      throw error;
    }
  }

  private throwKnownConflict(error: unknown): void {
    const databaseError = error as PostgreSqlError;
    if ((error as { code?: string }).code === 'MULTI_ROLE_PROVIDER') {
      throw new BadRequestException({ code: 'MULTI_ROLE_PROVIDER', message: 'El tipo no puede cambiarse mientras el proveedor tiene varios roles activos.' });
    }
    if ((error as { code?: string }).code === 'FISCAL_REMOVAL_NOT_ALLOWED') {
      throw new BadRequestException({ code: 'FISCAL_REMOVAL_NOT_ALLOWED', message: 'No es posible eliminar la información fiscal desde esta edición.' });
    }
    if ((error as { code?: string }).code === 'FISCAL_CHANGE_MODE_REQUIRED') {
      throw new BadRequestException({ code: 'FISCAL_CHANGE_MODE_REQUIRED', message: 'Indica si el cambio de RFC es una corrección o una nueva identidad fiscal.' });
    }
    if ((error as { code?: string }).code === 'PROVIDER_ALREADY_INACTIVE') {
      throw new ConflictException({ code: 'PROVIDER_ALREADY_INACTIVE', message: 'El proveedor ya está inactivo.' });
    }
    if ((error as { code?: string }).code === 'PROVIDER_ALREADY_ACTIVE') {
      throw new ConflictException({ code: 'PROVIDER_ALREADY_ACTIVE', message: 'El proveedor ya está activo.' });
    }
    if ((error as { code?: string }).code === 'PROVIDER_STATUS_NOT_MANAGEABLE') {
      throw new ConflictException({ code: 'PROVIDER_STATUS_NOT_MANAGEABLE', message: 'El estado actual del proveedor no puede administrarse desde este flujo.' });
    }
    if ((error as { code?: string }).code === 'ALIAS_ALREADY_ASSOCIATED') {
      throw new ConflictException({ code: 'ALIAS_ALREADY_ASSOCIATED', message: 'Este alias ya está asociado a otra empresa.' });
    }
    if (databaseError.code !== '23505') return;
    if (databaseError.constraint === 'uq_empresas_nombre_comercial') {
      throw new ConflictException({ code: 'PROVIDER_NAME_ALREADY_EXISTS', message: 'Ya existe un proveedor o empresa con ese nombre comercial.' });
    }
    if (databaseError.constraint === 'uq_empresas_fiscales_rfc') {
      throw new ConflictException({ code: 'RFC_ALREADY_EXISTS', message: 'Ya existe una empresa registrada con ese RFC.' });
    }
    if (databaseError.constraint === 'uq_alias_empresa_activo') {
      throw new ConflictException({ code: 'ALIAS_ALREADY_ASSOCIATED', message: 'Este alias ya está asociado a otra empresa.' });
    }
  }

  private normalizeAliases(input: UpdateProviderDto): UpdateProviderDto {
    if (input.aliases === undefined) return input;
    try {
      return { ...input, aliases: normalizeAliasList(input.aliases) };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ALIASES_EMPTY') throw new BadRequestException('Los alias no pueden estar vacíos.');
      if (code === 'ALIASES_DUPLICATE') throw new BadRequestException('Los alias no pueden estar duplicados.');
      throw error;
    }
  }

  private validateFiscalFormat(input: UpdateProviderDto): void {
    const fiscal = input.fiscal;
    if (!fiscal) return;
    const hasLegalName = Boolean(fiscal.legalName?.trim());
    const hasRfc = Boolean(fiscal.rfc?.trim());
    if (hasLegalName !== hasRfc) throw new BadRequestException('Para registrar datos fiscales, completa la razón social y el RFC.');
    if (hasRfc && (!/^\S{12,13}$/.test(fiscal.rfc!))) throw new BadRequestException('El RFC debe tener 12 o 13 caracteres y no contener espacios.');
    if (fiscal.changeMode === FiscalChangeMode.NewIdentity && !fiscal.effectiveStartDate) {
      throw new BadRequestException('Indica la fecha desde la que la nueva identidad fiscal está vigente.');
    }
    if (fiscal.changeMode !== FiscalChangeMode.NewIdentity && fiscal.effectiveStartDate) {
      throw new BadRequestException('La fecha de vigencia solo aplica al registrar una nueva identidad fiscal.');
    }
  }

  private mapResponse(created: CreatedProviderRecord): CreateProviderResponse {
    return {
      data: {
        id: created.company.empresa_id,
        commercialName: created.company.nombre_comercial,
        providerType: created.company.tipo_empresa,
        status: created.company.estatus,
        notes: created.company.observaciones,
        fiscal: created.fiscal ? { id: created.fiscal.empresa_fiscal_id, legalName: created.fiscal.razon_social, rfc: created.fiscal.rfc } : null
      }
    };
  }

  private mapListResponse(listed: ListedProvidersRecord, input: ListProvidersDto): ListProvidersResponse {
    return {
      data: listed.providers.map((provider) => ({
        id: provider.id,
        commercialName: provider.commercial_name,
        providerType: provider.provider_type,
        status: provider.status,
        notes: provider.notes,
        matchedAlias: provider.matched_alias,
        fiscal: provider.fiscal_id && provider.legal_name && provider.rfc
          ? { id: provider.fiscal_id, legalName: provider.legal_name, rfc: provider.rfc }
          : null
      })),
      meta: { page: input.page, pageSize: input.pageSize, total: listed.total, totalPages: Math.ceil(listed.total / input.pageSize) }
    };
  }

  private mapGetResponse(provider: FoundProviderRecord): GetProviderResponse {
    return {
      data: {
        id: provider.id,
        commercialName: provider.commercial_name,
        providerType: provider.provider_type,
        roles: provider.roles,
        status: provider.status,
        notes: provider.notes,
        aliases: provider.aliases,
        otherAliases: provider.other_aliases,
        fiscal: provider.fiscal_id && provider.legal_name && provider.rfc
          ? { id: provider.fiscal_id, legalName: provider.legal_name, rfc: provider.rfc }
          : null
      }
    };
  }
}
