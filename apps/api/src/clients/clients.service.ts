import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FiscalChangeMode } from '../providers/dto/update-provider.dto';
import { ClientsRepository, type AuditIdentity, type ClientRow } from './clients.repository';
import type { CreateClientDto } from './dto/create-client.dto';
import type { ListClientsDto } from './dto/list-clients.dto';
import type { UpdateClientDto } from './dto/update-client.dto';

interface PostgreSqlError { code?: string; constraint?: string }

export interface ClientResponse {
  data: {
    id: string;
    commercialName: string;
    companyType: string;
    status: string;
    notes: string | null;
    roles: string[];
    fiscal: { id: string; legalName: string; rfc: string; startDate: string | null; endDate: string | null } | null;
  };
}

@Injectable()
export class ClientsService {
  constructor(private readonly repository: ClientsRepository) {}

  async list(input: ListClientsDto) {
    const result = await this.repository.list(input);
    return {
      data: result.clients.map((client) => this.map(client)),
      meta: { page: input.page, pageSize: input.pageSize, total: result.total, totalPages: Math.ceil(result.total / input.pageSize) }
    };
  }

  async detail(id: string): Promise<ClientResponse> {
    const client = await this.repository.findActiveById(id);
    if (!client) throw new NotFoundException('Cliente no encontrado.');
    return { data: this.map(client) };
  }

  async create(input: CreateClientDto, requestId: string, identity: AuditIdentity): Promise<ClientResponse> {
    try {
      return { data: this.map(await this.repository.create(input, requestId, identity)) };
    } catch (error) {
      this.throwKnownError(error);
      throw error;
    }
  }

  async update(id: string, input: UpdateClientDto, requestId: string, identity: AuditIdentity): Promise<ClientResponse> {
    const fiscal = input.fiscal;
    const hasFiscalField = fiscal && (fiscal.legalName !== undefined || fiscal.rfc !== undefined || fiscal.changeMode !== undefined || fiscal.effectiveStartDate !== undefined);
    if (input.commercialName === undefined && input.notes === undefined && !hasFiscalField) {
      throw new BadRequestException({ code: 'EMPTY_PATCH', message: 'El payload PATCH no puede estar vacío.' });
    }
    this.validateFiscal(input);
    try {
      const client = await this.repository.update(id, input, requestId, identity);
      if (!client) throw new NotFoundException('Cliente no encontrado.');
      return { data: this.map(client) };
    } catch (error) {
      this.throwKnownError(error);
      throw error;
    }
  }

  deactivate(id: string, requestId: string, identity: AuditIdentity): Promise<ClientResponse> {
    return this.changeStatus(id, 'INACTIVO', requestId, identity);
  }

  reactivate(id: string, requestId: string, identity: AuditIdentity): Promise<ClientResponse> {
    return this.changeStatus(id, 'ACTIVO', requestId, identity);
  }

  private async changeStatus(id: string, target: 'ACTIVO' | 'INACTIVO', requestId: string, identity: AuditIdentity): Promise<ClientResponse> {
    try {
      const client = await this.repository.changeStatus(id, target, requestId, identity);
      if (!client) throw new NotFoundException('Cliente no encontrado.');
      return { data: this.map(client) };
    } catch (error) {
      this.throwKnownError(error);
      throw error;
    }
  }

  private validateFiscal(input: UpdateClientDto): void {
    const fiscal = input.fiscal;
    if (!fiscal) return;
    const hasLegalName = Boolean(fiscal.legalName?.trim());
    const hasRfc = Boolean(fiscal.rfc?.trim());
    if (hasLegalName !== hasRfc) throw new BadRequestException('Para registrar datos fiscales, completa la razón social y el RFC.');
    if (hasRfc && !/^\S{12,13}$/.test(fiscal.rfc!)) throw new BadRequestException('El RFC debe tener 12 o 13 caracteres y no contener espacios.');
    if (fiscal.changeMode === FiscalChangeMode.NewIdentity && !fiscal.effectiveStartDate) throw new BadRequestException('Indica la fecha desde la que la nueva identidad fiscal está vigente.');
    if (fiscal.changeMode !== FiscalChangeMode.NewIdentity && fiscal.effectiveStartDate) throw new BadRequestException('La fecha de vigencia solo aplica al registrar una nueva identidad fiscal.');
  }

  private throwKnownError(error: unknown): void {
    const code = (error as PostgreSqlError).code;
    const constraint = (error as PostgreSqlError).constraint;
    const conflicts: Record<string, string> = {
      CLIENT_ALREADY_ACTIVE: 'El cliente ya está activo.',
      CLIENT_NAME_RFC_CONFLICT: 'El nombre comercial pertenece a una empresa con una identidad fiscal diferente o sin confirmar.',
      CLIENT_RFC_CONFLICT: 'El RFC pertenece a una empresa con otro nombre comercial.',
      CLIENT_ALREADY_INACTIVE: 'El cliente ya está inactivo.',
      CLIENT_STATUS_NOT_MANAGEABLE: 'El estado actual de la empresa no puede administrarse desde este flujo.'
    };
    if (code && conflicts[code]) throw new ConflictException({ code, message: conflicts[code] });
    if (code === 'FISCAL_REMOVAL_NOT_ALLOWED') throw new BadRequestException({ code, message: 'No es posible eliminar la información fiscal desde esta edición.' });
    if (code === 'FISCAL_CHANGE_MODE_REQUIRED') throw new BadRequestException({ code, message: 'Indica si el cambio de RFC es una corrección o una nueva identidad fiscal.' });
    if (code === '23505' && constraint === 'uq_empresas_nombre_comercial') throw new ConflictException({ code: 'CLIENT_NAME_CONFLICT', message: 'Ya existe una empresa con ese nombre comercial.' });
    if (code === '23505' && constraint === 'uq_empresas_fiscales_rfc') throw new ConflictException({ code: 'CLIENT_RFC_CONFLICT', message: 'Ya existe una empresa con ese RFC.' });
  }

  private map(client: ClientRow) {
    return {
      id: client.id,
      commercialName: client.commercial_name,
      companyType: client.company_type,
      status: client.status,
      notes: client.notes,
      roles: client.roles,
      fiscal: client.fiscal_id && client.legal_name && client.rfc ? {
        id: client.fiscal_id,
        legalName: client.legal_name,
        rfc: client.rfc,
        startDate: client.fiscal_start_date,
        endDate: client.fiscal_end_date
      } : null
    };
  }
}
