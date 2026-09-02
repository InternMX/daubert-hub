import type { AddContactMethodType } from '../services/contactMethods';

export const methodTypes: Array<{ value: AddContactMethodType; label: string }> = [
  { value: 'CORREO', label: 'Correo' },
  { value: 'TELEFONO', label: 'Teléfono' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'WEB', label: 'Portal / página web' }
];

const phonePattern = /^(?=.*\d)[+\d\s().-]+(?:\s*(?:ext\.?|x)\s*\d+)?$/i;

export function methodPlaceholder(type: AddContactMethodType): string {
  if (type === 'CORREO') return 'correo@empresa.com';
  if (type === 'WEB') return 'https://portal.empresa.com';
  return '+52 449 123 4567';
}

export function methodValueLabel(type: AddContactMethodType): string {
  return type === 'WEB' ? 'URL' : 'Valor';
}

export function contactMethodValidationError(type: AddContactMethodType, value: string): string | null {
  if (!value) return 'Ingresa un valor.';
  if (type === 'CORREO' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 320)) return 'Ingresa un correo válido.';
  if ((type === 'TELEFONO' || type === 'WHATSAPP') && (value.length > 100 || !phonePattern.test(value))) return 'Ingresa un número de contacto válido.';
  if (type === 'WEB' && !isWebUrl(value)) return 'Ingresa una URL válida.';
  return null;
}

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !/\s/.test(value);
  } catch {
    return false;
  }
}
