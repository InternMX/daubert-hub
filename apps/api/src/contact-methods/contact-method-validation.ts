import { BadRequestException } from '@nestjs/common';
import { ContactMethodType } from '../contacts/dto/create-contact.dto';
import { PaymentRecipientType } from './dto/payment-recipient-type';

export function validateContactMethod(type: string, value: string): void {
  if (!Object.values(ContactMethodType).includes(type as ContactMethodType)) {
    throw new BadRequestException('El tipo de medio de contacto no es válido.');
  }
  if (!value) throw new BadRequestException('El valor del medio de contacto es obligatorio.');
  if (type === ContactMethodType.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new BadRequestException('El correo electrónico no es válido.');
  }
  if (type === ContactMethodType.Email && value.length > 320) {
    throw new BadRequestException('El correo electrónico excede la longitud máxima permitida.');
  }
  if ((type === ContactMethodType.Phone || type === ContactMethodType.WhatsApp) && value.length > 100) {
    throw new BadRequestException('El número de contacto excede la longitud máxima permitida.');
  }
  if ((type === ContactMethodType.Phone || type === ContactMethodType.WhatsApp) && !/^(?=.*\d)[+\d\s().-]+(?:\s*(?:ext\.?|x)\s*\d+)?$/i.test(value)) {
    throw new BadRequestException('El número de contacto no es válido.');
  }
  if (type === ContactMethodType.Web && !isWebUrl(value)) {
    throw new BadRequestException('La URL del portal o página web no es válida.');
  }
}

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !/\s/.test(value);
  } catch {
    return false;
  }
}

export interface PaymentNotificationFlags {
  receivesPaymentNotifications: boolean;
  paymentRecipientType: PaymentRecipientType | null;
}

interface RequestedPaymentNotificationFlags {
  receivesPaymentNotifications?: boolean;
  paymentRecipientType?: PaymentRecipientType | null;
}

// Resolves the persisted recibe_notificacion_pago / tipo_destinatario_pago pair for a method.
//  - receives=false            => recipient type is normalized to null (whatever was sent).
//  - receives=true             => the method must be CORREO and a recipient type (PARA|CC|CCO) is mandatory.
//  - non-CORREO, not requested => receives=false / null (e.g. an email edited into a phone number).
// `current` (edit only) supplies the values to keep when the request omits them. isPrimary
// (es_principal) is a separate concept and is deliberately not part of this function.
export function resolvePaymentNotificationFlags(
  resultingType: string,
  requested: RequestedPaymentNotificationFlags,
  current?: { receivesPaymentNotifications: boolean; paymentRecipientType: string | null }
): PaymentNotificationFlags {
  const isEmail = resultingType === ContactMethodType.Email;
  const receives = requested.receivesPaymentNotifications ?? (isEmail ? current?.receivesPaymentNotifications ?? false : false);
  if (!receives) return { receivesPaymentNotifications: false, paymentRecipientType: null };
  if (!isEmail) {
    throw new BadRequestException({ code: 'PAYMENT_NOTIFICATION_REQUIRES_EMAIL', message: 'Solo un medio de tipo correo puede recibir notificaciones de pago.' });
  }
  const recipientType = requested.paymentRecipientType ?? (current?.paymentRecipientType as PaymentRecipientType | null | undefined) ?? null;
  if (!recipientType || !Object.values(PaymentRecipientType).includes(recipientType)) {
    throw new BadRequestException({ code: 'PAYMENT_RECIPIENT_TYPE_REQUIRED', message: 'Indica si el destinatario de notificaciones de pago es PARA, CC o CCO.' });
  }
  return { receivesPaymentNotifications: true, paymentRecipientType: recipientType };
}
