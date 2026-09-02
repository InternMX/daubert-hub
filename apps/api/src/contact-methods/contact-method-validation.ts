import { BadRequestException } from '@nestjs/common';
import { ContactMethodType } from '../contacts/dto/create-contact.dto';

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
