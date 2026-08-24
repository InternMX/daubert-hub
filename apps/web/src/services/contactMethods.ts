import { apiBaseUrl } from './api';
import type { ContactMethodType } from './contactDirectory';
import { ContactApiError } from './contacts';

export type AddContactMethodType = 'CORREO' | 'TELEFONO' | 'WHATSAPP';
export interface AddContactMethodInput { type: AddContactMethodType; value: string; }
export interface AddedContactMethod { id: string; type: AddContactMethodType; value: string; status: 'ACTIVO'; }
export interface EditContactMethodInput { type?: AddContactMethodType; value?: string; }
export interface EditedContactMethod { id: string; type: AddContactMethodType; value: string; status: 'ACTIVO' | 'INACTIVO'; }

export interface ContactMethodLifecycleResult {
  id: string;
  contactId: string;
  type: ContactMethodType;
  value: string;
  status: 'ACTIVO' | 'INACTIVO';
  isPrimary: boolean;
}

async function changeContactMethodStatus(id: string, action: 'deactivate' | 'reactivate'): Promise<ContactMethodLifecycleResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/contact-methods/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  } catch {
    throw new ContactApiError(0, undefined, null);
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body)) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ContactApiError(response.status, code, requestId);
  }
  return body.data as ContactMethodLifecycleResult;
}

export function deactivateContactMethod(id: string) { return changeContactMethodStatus(id, 'deactivate'); }
export function reactivateContactMethod(id: string) { return changeContactMethodStatus(id, 'reactivate'); }

export async function addContactMethod(contactId: string, input: AddContactMethodInput): Promise<AddedContactMethod> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/contacts/${encodeURIComponent(contactId)}/methods`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  } catch {
    throw new ContactApiError(0, undefined, null);
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body)) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ContactApiError(response.status, code, requestId);
  }
  return body.data as AddedContactMethod;
}

export async function editContactMethod(id: string, input: EditContactMethodInput): Promise<EditedContactMethod> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/contact-methods/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  } catch {
    throw new ContactApiError(0, undefined, null);
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body)) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ContactApiError(response.status, code, requestId);
  }
  return body.data as EditedContactMethod;
}
