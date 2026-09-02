import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AddressesRepository, type AddressRow, type AuditIdentity } from './addresses.repository';
import type { CreateAddressDto } from './dto/create-address.dto';
import type { UpdateAddressDto } from './dto/update-address.dto';

export interface AddressData {
  id: string;
  companyId: string;
  tipoDireccion: string;
  calle: string | null;
  numeroExterior: string | null;
  numeroInterior: string | null;
  colonia: string | null;
  codigoPostal: string | null;
  municipio: string | null;
  estado: string | null;
  pais: string | null;
  direccionCompleta: string | null;
  referencias: string | null;
  esPrincipal: boolean;
  fechaInicio: string | null;
  fechaFin: string | null;
  estatus: string;
}

@Injectable()
export class AddressesService {
  constructor(private readonly repository: AddressesRepository) {}

  async list(companyId: string): Promise<{ data: AddressData[] }> {
    const rows = await this.repository.list(companyId);
    if (!rows) throw new NotFoundException('Empresa no encontrada.');
    return { data: rows.map((row) => this.map(row)) };
  }

  async create(companyId: string, input: CreateAddressDto, requestId: string, identity: AuditIdentity): Promise<{ data: AddressData }> {
    this.assertCreate(input);
    try { return { data: this.map(await this.repository.create(companyId, input, requestId, identity)) }; }
    catch (error) { this.throwKnown(error); throw error; }
  }

  async update(id: string, input: UpdateAddressDto, requestId: string, identity: AuditIdentity): Promise<{ data: AddressData }> {
    if (Object.values(input).every((value) => value === undefined)) throw new BadRequestException('Proporciona al menos un campo para actualizar.');
    try {
      const row = await this.repository.update(id, input, requestId, identity);
      if (!row) throw new NotFoundException('Dirección no encontrada.');
      return { data: this.map(row) };
    } catch (error) { this.throwKnown(error); throw error; }
  }

  deactivate(id: string, requestId: string, identity: AuditIdentity): Promise<{ data: AddressData }> { return this.changeStatus(id, 'INACTIVA', requestId, identity); }
  reactivate(id: string, requestId: string, identity: AuditIdentity): Promise<{ data: AddressData }> { return this.changeStatus(id, 'ACTIVA', requestId, identity); }

  private async changeStatus(id: string, status: 'ACTIVA' | 'INACTIVA', requestId: string, identity: AuditIdentity): Promise<{ data: AddressData }> {
    try {
      const row = await this.repository.changeStatus(id, status, requestId, identity);
      if (!row) throw new NotFoundException('Dirección no encontrada.');
      return { data: this.map(row) };
    } catch (error) { this.throwKnown(error); throw error; }
  }

  private assertCreate(input: CreateAddressDto): void {
    if (!input.calle && !input.direccionCompleta) throw new BadRequestException('La dirección requiere calle o dirección completa.');
    if (input.fechaInicio && input.fechaFin && input.fechaInicio > input.fechaFin) throw new BadRequestException('La fecha final no puede ser anterior a la fecha inicial.');
  }

  private throwKnown(error: unknown): void {
    const code = (error as { code?: string }).code;
    if (code === 'COMPANY_NOT_FOUND') throw new NotFoundException('Empresa no encontrada.');
    if (code === 'COMPANY_NOT_ACTIVE') throw new ConflictException({ code, message: 'La empresa no está activa.' });
    if (code === 'ADDRESS_NOT_ACTIVE') throw new ConflictException({ code, message: 'La dirección debe estar activa para editarse.' });
    if (code === 'ADDRESS_ALREADY_ACTIVE') throw new ConflictException({ code, message: 'La dirección ya está activa.' });
    if (code === 'ADDRESS_ALREADY_INACTIVE') throw new ConflictException({ code, message: 'La dirección ya está inactiva.' });
    if (code === 'ADDRESS_STATUS_NOT_MANAGEABLE') throw new ConflictException({ code, message: 'El estado actual de la dirección no puede administrarse.' });
    if (code === 'ADDRESS_CONTENT_REQUIRED') throw new BadRequestException({ code, message: 'La dirección requiere calle o dirección completa.' });
    if (code === 'ADDRESS_DATE_ORDER') throw new BadRequestException({ code, message: 'La fecha final no puede ser anterior a la fecha inicial.' });
    if (code === '23514' || code === '22007') throw new BadRequestException('Los datos de la dirección no cumplen las reglas de contenido o vigencia.');
  }

  private map(row: AddressRow): AddressData {
    return { id: row.direccion_id, companyId: row.empresa_id, tipoDireccion: row.tipo_direccion, calle: row.calle,
      numeroExterior: row.numero_exterior, numeroInterior: row.numero_interior, colonia: row.colonia,
      codigoPostal: row.codigo_postal, municipio: row.municipio, estado: row.estado, pais: row.pais,
      direccionCompleta: row.direccion_completa, referencias: row.referencias, esPrincipal: row.es_principal,
      fechaInicio: row.fecha_inicio, fechaFin: row.fecha_fin, estatus: row.estatus };
  }
}
