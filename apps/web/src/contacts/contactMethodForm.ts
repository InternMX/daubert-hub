import type { AddContactMethodType } from '../services/contactMethods';

export const methodTypes: Array<{ value: AddContactMethodType; label: string }> = [
  { value: 'CORREO', label: 'Correo' },
  { value: 'TELEFONO', label: 'Teléfono' },
  { value: 'WHATSAPP', label: 'WhatsApp' }
];

const phonePattern = /^(?=.*\d)[+\d\s().-]+(?:\s*(?:ext\.?|x)\s*\d+)?$/i;

export function methodPlaceholder(type: AddContactMethodType): string {
  return type === 'CORREO' ? 'correo@empresa.com' : '+52 449 123 4567';
}

export function contactMethodValidationError(type: AddContactMethodType, value: string): string | null {
  if (!value) return 'Ingresa un valor.';
  if (type === 'CORREO' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 320)) return 'Ingresa un correo válido.';
  if (type !== 'CORREO' && (value.length > 100 || !phonePattern.test(value))) return 'Ingresa un número de contacto válido.';
  return null;
}
