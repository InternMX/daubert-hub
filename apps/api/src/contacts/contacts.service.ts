import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactMethodType, ContactType, type CreateContactDto } from './dto/create-contact.dto';
import { ContactsRepository, type CreatedContactRecord } from './contacts.repository';

export interface CreateContactResponse {
  data: {
    id: string;
    companyId: string;
    contactType: string;
    name: string | null;
    area: string | null;
    position: string | null;
    notes: string | null;
    status: string;
    isPrimary: boolean;
    methods: Array<{ id: string; type: string; value: string; status: string; isPrimary: boolean }>;
  };
}

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
}
