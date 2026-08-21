import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactMethodsRepository, type ContactMethodRecord } from './contact-methods.repository';

export interface ContactMethodResponse {
  data: { id: string; contactId: string; type: string; value: string; status: string; isPrimary: boolean };
}

@Injectable()
export class ContactMethodsService {
  constructor(private readonly repository: ContactMethodsRepository) {}

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
}
