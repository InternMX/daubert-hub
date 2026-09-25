import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditIdentity } from '../common/authenticated-request';
import { activeRequiresParaConflict, PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA } from '../payment-notification-settings/payment-notification-para-invariant';
import { resolvePaymentNotificationFlags, validateContactMethod } from './contact-method-validation';
import { ContactMethodsRepository, type ContactMethodRecord } from './contact-methods.repository';
import type { AddContactMethodDto } from './dto/add-contact-method.dto';
import type { EditContactMethodDto } from './dto/edit-contact-method.dto';

export interface ContactMethodResponse {
  data: { id: string; contactId: string; type: string; value: string; status: string; isPrimary: boolean; receivesPaymentNotifications: boolean; paymentRecipientType: string | null };
}
export interface AddedContactMethodResponse {
  data: { id: string; type: string; value: string; status: string; isPrimary: boolean; receivesPaymentNotifications: boolean; paymentRecipientType: string | null };
}

@Injectable()
export class ContactMethodsService {
  constructor(private readonly repository: ContactMethodsRepository) {}

  async add(contactId: string, input: AddContactMethodDto, requestId: string, identity: AuditIdentity): Promise<AddedContactMethodResponse> {
    validateContactMethod(input.type, input.value);
    resolvePaymentNotificationFlags(input.type, input);
    try {
      const method = await this.repository.add(contactId, input, requestId, identity);
      if (!method) throw new NotFoundException('Contacto no encontrado.');
      return this.mapAdded(method);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'COMPANY_NOT_FOUND') throw new NotFoundException('Empresa no encontrada.');
      if (code === 'CONTACT_NOT_ACTIVE') throw new ConflictException({ code, message: 'El contacto debe estar activo para agregar medios.' });
      if (code === 'COMPANY_NOT_ACTIVE') throw new ConflictException({ code, message: 'La empresa debe estar activa para agregar medios de contacto.' });
      if (code === 'CONTACT_METHOD_DUPLICATE' || code === '23505') throw new ConflictException({ code: 'CONTACT_METHOD_DUPLICATE', message: 'El medio de contacto ya existe para este contacto.' });
      throw error;
    }
  }

  async edit(id: string, input: EditContactMethodDto, requestId: string, identity: AuditIdentity): Promise<AddedContactMethodResponse> {
    if (Object.values(input).every((field) => field === undefined)) throw new BadRequestException('Debe proporcionar al menos un campo para editar.');
    try {
      const method = await this.repository.edit(id, input, requestId, identity);
      if (!method) throw new NotFoundException('Medio de contacto no encontrado.');
      return this.mapAdded(method);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA) throw activeRequiresParaConflict();
      if (code === 'METHOD_STATUS_NOT_MANAGEABLE') throw new ConflictException({ code, message: 'El estado actual del medio de contacto no permite editarlo.' });
      if (code === 'CONTACT_NOT_ACTIVE') throw new ConflictException({ code, message: 'El contacto debe estar activo para editar sus medios.' });
      if (code === 'COMPANY_NOT_ACTIVE') throw new ConflictException({ code, message: 'La empresa debe estar activa para editar sus medios de contacto.' });
      if (code === 'CONTACT_METHOD_DUPLICATE' || code === '23505') throw new ConflictException({ code: 'CONTACT_METHOD_DUPLICATE', message: 'El medio de contacto ya existe para este contacto.' });
      throw error;
    }
  }

  deactivate(id: string, requestId: string, identity: AuditIdentity): Promise<ContactMethodResponse> {
    return this.changeStatus(id, 'INACTIVO', requestId, identity);
  }

  reactivate(id: string, requestId: string, identity: AuditIdentity): Promise<ContactMethodResponse> {
    return this.changeStatus(id, 'ACTIVO', requestId, identity);
  }

  private async changeStatus(id: string, status: 'ACTIVO' | 'INACTIVO', requestId: string, identity: AuditIdentity): Promise<ContactMethodResponse> {
    try {
      const method = await this.repository.changeStatus(id, status, requestId, identity);
      if (!method) throw new NotFoundException('Medio de contacto no encontrado.');
      return this.mapResponse(method);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA) throw activeRequiresParaConflict();
      if (code === 'METHOD_ALREADY_INACTIVE') throw new ConflictException({ code, message: 'El medio de contacto ya está inactivo.' });
      if (code === 'METHOD_ALREADY_ACTIVE') throw new ConflictException({ code, message: 'El medio de contacto ya está activo.' });
      if (code === 'METHOD_STATUS_NOT_MANAGEABLE') throw new ConflictException({ code, message: 'El estado actual del medio de contacto no puede administrarse desde este flujo.' });
      if (code === 'CONTACT_NOT_ACTIVE') throw new ConflictException({ code, message: 'El contacto debe estar activo para administrar sus medios.' });
      if (code === 'COMPANY_NOT_ACTIVE') throw new ConflictException({ code, message: 'La empresa debe estar activa para administrar sus medios de contacto.' });
      throw error;
    }
  }

  private mapResponse(method: ContactMethodRecord): ContactMethodResponse {
    return { data: { id: method.id, contactId: method.contact_id, type: method.type, value: method.value, status: method.status, isPrimary: method.is_primary, receivesPaymentNotifications: method.receives_payment_notifications, paymentRecipientType: method.payment_recipient_type } };
  }

  private mapAdded(method: ContactMethodRecord): AddedContactMethodResponse {
    return { data: { id: method.id, type: method.type, value: method.value, status: method.status, isPrimary: method.is_primary, receivesPaymentNotifications: method.receives_payment_notifications, paymentRecipientType: method.payment_recipient_type } };
  }

}
