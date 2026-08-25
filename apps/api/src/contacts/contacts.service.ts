import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactMethodType, ContactType, type CreateContactDto } from './dto/create-contact.dto';
import type { UpdateContactDto } from './dto/update-contact.dto';
import { ContactsRepository, type ContactRow, type CreatedContactRecord } from './contacts.repository';

interface ContactData {
    id: string;
    companyId: string;
    contactType: string;
    name: string | null;
    area: string | null;
    position: string | null;
    notes: string | null;
    status: string;
    isPrimary: boolean;
}
export interface CreateContactResponse { data: ContactData & { methods: Array<{ id: string; type: string; value: string; status: string; isPrimary: boolean }> }; }
export interface UpdateContactResponse { data: ContactData; }

@Injectable()
export class ContactsService {
  constructor(private readonly repository: ContactsRepository) {}

  async create(input: CreateContactDto, requestId: string): Promise<CreateContactResponse> {
    this.validate(input);
    try {
      return this.mapResponse(await this.repository.create(input, requestId));
    } catch (error) {
      this.throwKnownError(error);
      throw error;
    }
  }

  async update(id: string, input: UpdateContactDto, requestId: string): Promise<UpdateContactResponse> {
    if (Object.keys(input).length === 0) throw new BadRequestException('Proporciona al menos un campo para actualizar.');
    try {
      const contact = await this.repository.update(id, input, requestId);
      if (!contact) throw new NotFoundException('Contacto no encontrado.');
      return this.mapContactResponse(contact);
    } catch (error) {
      this.throwKnownError(error);
      throw error;
    }
  }

  deactivate(id: string, requestId: string): Promise<UpdateContactResponse> {
    return this.changeStatus(id, 'INACTIVO', requestId);
  }

  reactivate(id: string, requestId: string): Promise<UpdateContactResponse> {
    return this.changeStatus(id, 'ACTIVO', requestId);
  }

  private async changeStatus(id: string, status: 'ACTIVO' | 'INACTIVO', requestId: string): Promise<UpdateContactResponse> {
    try {
      const contact = await this.repository.changeStatus(id, status, requestId);
      if (!contact) throw new NotFoundException('Contacto no encontrado.');
      return this.mapContactResponse(contact);
    } catch (error) {
      this.throwKnownError(error);
      throw error;
    }
  }

  private validate(input: CreateContactDto): void {
    if (input.contactType === ContactType.Person && !input.name) {
      throw new BadRequestException('El nombre es obligatorio para contactos de tipo PERSONA.');
    }
    if ((input.contactType === ContactType.Area || input.contactType === ContactType.GenericMailbox) && !input.area) {
      throw new BadRequestException('El área es obligatoria para este tipo de contacto.');
    }
    const methods = new Set<string>();
    for (const method of input.methods) {
      if (!method.value) throw new BadRequestException('El valor del medio de contacto es obligatorio.');
      if (method.type === ContactMethodType.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(method.value)) {
        throw new BadRequestException('El correo electrónico no es válido.');
      }
      if ((method.type === ContactMethodType.Phone || method.type === ContactMethodType.WhatsApp) && method.value.length > 100) {
        throw new BadRequestException('El número de contacto excede la longitud máxima permitida.');
      }
      const value = method.type === ContactMethodType.Email ? method.value.toLowerCase() : method.value;
      const key = `${method.type}\u0000${value}`;
      if (methods.has(key)) throw new BadRequestException('No se permiten medios de contacto duplicados.');
      methods.add(key);
    }
  }

  private throwKnownError(error: unknown): void {
    const code = (error as { code?: string }).code;
    if (code === 'COMPANY_NOT_FOUND') throw new NotFoundException('Empresa no encontrada.');
    if (code === 'COMPANY_INACTIVE') throw new ConflictException({ code, message: 'La empresa está inactiva.' });
    if (code === 'COMPANY_BLOCKED') throw new ConflictException({ code, message: 'La empresa está bloqueada.' });
    if (code === 'COMPANY_NOT_ACTIVE') throw new ConflictException({ code, message: 'La empresa no está activa.' });
    if (code === 'CONTACT_NOT_ACTIVE') throw new ConflictException({ code, message: 'El contacto debe estar activo para editarse.' });
    if (code === 'CONTACT_ALREADY_INACTIVE') throw new ConflictException({ code, message: 'El contacto ya está inactivo.' });
    if (code === 'CONTACT_ALREADY_ACTIVE') throw new ConflictException({ code, message: 'El contacto ya está activo.' });
    if (code === 'CONTACT_STATUS_NOT_MANAGEABLE') throw new ConflictException({ code, message: 'El estado actual del contacto no puede administrarse desde este flujo.' });
    if (code === 'PERSON_NAME_REQUIRED') throw new BadRequestException({ code, message: 'El nombre es obligatorio para contactos de tipo PERSONA.' });
    if (code === 'CONTACT_AREA_REQUIRED') throw new BadRequestException({ code, message: 'El área es obligatoria para este tipo de contacto.' });
    if (code === 'CONTACT_NAME_NOT_ALLOWED') throw new BadRequestException({ code, message: 'El nombre no aplica para este tipo de contacto.' });
    if (code === 'CONTACT_POSITION_NOT_ALLOWED') throw new BadRequestException({ code, message: 'El cargo no aplica para este tipo de contacto.' });
    if (code === 'CONTACT_TYPE_NOT_EDITABLE') throw new ConflictException({ code, message: 'Este tipo de contacto no puede editarse desde este flujo.' });
    if (code === 'CONTACT_NO_CHANGES') throw new BadRequestException({ code, message: 'Proporciona al menos un cambio aplicable.' });
  }

  private mapResponse(created: CreatedContactRecord): CreateContactResponse {
    return {
      data: {
        id: created.contact.contacto_id,
        companyId: created.contact.empresa_id,
        contactType: created.contact.tipo_contacto,
        name: created.contact.nombre,
        area: created.contact.area,
        position: created.contact.cargo,
        notes: created.contact.observaciones,
        status: created.contact.estatus,
        isPrimary: created.contact.es_contacto_principal,
        methods: created.methods.map((method) => ({ id: method.medio_id, type: method.tipo_medio, value: method.valor, status: method.estatus, isPrimary: method.es_principal }))
      }
    };
  }

  private mapContactResponse(contact: ContactRow): UpdateContactResponse {
    return { data: { id: contact.contacto_id, companyId: contact.empresa_id, contactType: contact.tipo_contacto, name: contact.nombre, area: contact.area, position: contact.cargo, notes: contact.observaciones, status: contact.estatus, isPrimary: contact.es_contacto_principal } };
  }
}
