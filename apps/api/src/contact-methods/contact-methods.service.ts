import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactMethodType } from '../contacts/dto/create-contact.dto';
import { ContactMethodsRepository, type ContactMethodRecord } from './contact-methods.repository';
import type { AddContactMethodDto } from './dto/add-contact-method.dto';

export interface ContactMethodResponse {
  data: { id: string; contactId: string; type: string; value: string; status: string; isPrimary: boolean };
}
export interface AddedContactMethodResponse {
  data: { id: string; type: string; value: string; status: string };
}

@Injectable()
export class ContactMethodsService {
  constructor(private readonly repository: ContactMethodsRepository) {}

  async add(contactId: string, input: AddContactMethodDto, requestId: string): Promise<AddedContactMethodResponse> {
    this.validateNewMethod(input);
    try {
      const method = await this.repository.add(contactId, input, requestId);
      if (!method) throw new NotFoundException('Contacto no encontrado.');
      return { data: { id: method.id, type: method.type, value: method.value, status: method.status } };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'COMPANY_NOT_FOUND') throw new NotFoundException('Empresa no encontrada.');
      if (code === 'CONTACT_NOT_ACTIVE') throw new ConflictException({ code, message: 'El contacto debe estar activo para agregar medios.' });
      if (code === 'COMPANY_NOT_ACTIVE') throw new ConflictException({ code, message: 'La empresa debe estar activa para agregar medios de contacto.' });
      if (code === 'CONTACT_METHOD_DUPLICATE' || code === '23505') throw new ConflictException({ code: 'CONTACT_METHOD_DUPLICATE', message: 'El medio de contacto ya existe para este contacto.' });
      throw error;
    }
  }

  deactivate(id: number, requestId: string): Promise<ContactMethodResponse> {
    return this.changeStatus(id, 'INACTIVO', requestId);
  }

  reactivate(id: number, requestId: string): Promise<ContactMethodResponse> {
    return this.changeStatus(id, 'ACTIVO', requestId);
  }

  private async changeStatus(id: number, status: 'ACTIVO' | 'INACTIVO', requestId: string): Promise<ContactMethodResponse> {
    try {
      const method = await this.repository.changeStatus(id, status, requestId);
      if (!method) throw new NotFoundException('Medio de contacto no encontrado.');
      return this.mapResponse(method);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'METHOD_ALREADY_INACTIVE') throw new ConflictException({ code, message: 'El medio de contacto ya está inactivo.' });
      if (code === 'METHOD_ALREADY_ACTIVE') throw new ConflictException({ code, message: 'El medio de contacto ya está activo.' });
      if (code === 'METHOD_STATUS_NOT_MANAGEABLE') throw new ConflictException({ code, message: 'El estado actual del medio de contacto no puede administrarse desde este flujo.' });
      if (code === 'CONTACT_NOT_ACTIVE') throw new ConflictException({ code, message: 'El contacto debe estar activo para administrar sus medios.' });
      if (code === 'COMPANY_NOT_ACTIVE') throw new ConflictException({ code, message: 'La empresa debe estar activa para administrar sus medios de contacto.' });
      throw error;
    }
  }

  private mapResponse(method: ContactMethodRecord): ContactMethodResponse {
    return { data: { id: method.id, contactId: method.contact_id, type: method.type, value: method.value, status: method.status, isPrimary: method.is_primary } };
  }

  private validateNewMethod(input: AddContactMethodDto): void {
    if (!input.value) throw new BadRequestException('El valor del medio de contacto es obligatorio.');
    if (input.type === ContactMethodType.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
      throw new BadRequestException('El correo electrónico no es válido.');
    }
    if (input.type === ContactMethodType.Email && input.value.length > 320) {
      throw new BadRequestException('El correo electrónico excede la longitud máxima permitida.');
    }
    if ((input.type === ContactMethodType.Phone || input.type === ContactMethodType.WhatsApp) && input.value.length > 100) {
      throw new BadRequestException('El número de contacto excede la longitud máxima permitida.');
    }
    if ((input.type === ContactMethodType.Phone || input.type === ContactMethodType.WhatsApp) && !/^(?=.*\d)[+\d\s().-]+(?:\s*(?:ext\.?|x)\s*\d+)?$/i.test(input.value)) {
      throw new BadRequestException('El número de contacto no es válido.');
    }
  }
}
