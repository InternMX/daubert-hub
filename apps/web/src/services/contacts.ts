import { apiBaseUrl } from './api';

export type CreateContactType = 'PERSONA' | 'AREA' | 'BUZON_GENERICO';
export type CreateContactMethodType = 'CORREO' | 'TELEFONO' | 'WHATSAPP';

export interface CreateContactInput {
  companyId: string;
  contactType: CreateContactType;
  name: string | null;
  area: string | null;
  position: string | null;
  notes: string | null;
  methods: Array<{ type: CreateContactMethodType; value: string }>;
}

export interface CreatedContact {
  id: string;
  companyId: string;
  contactType: CreateContactType;
  name: string | null;
  area: string | null;
  position: string | null;
  notes: string | null;
  status: string;
  isPrimary: boolean;
  methods: Array<{ id: string; type: CreateContactMethodType; value: string; status: string; isPrimary: boolean }>;
}

export type UpdateContactInput = Partial<Pick<CreatedContact, 'name' | 'area' | 'position' | 'notes'>>;
export type UpdatedContact = Omit<CreatedContact, 'methods'>;

export interface ContactLifecycleResult {
  id: string;
  companyId: string;
  contactType: CreateContactType;
  name: string | null;
  area: string | null;
  position: string | null;
  notes: string | null;
  status: string;
  isPrimary: boolean;
}

export class ContactApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, public readonly requestId: string | null) {
    super('Contact API request failed');
  }
}

export async function createContact(input: CreateContactInput): Promise<{ contact: CreatedContact; requestId: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/contacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  } catch {
    throw new ContactApiError(0, undefined, null);
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ContactApiError(response.status, code, requestId);
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) throw new ContactApiError(response.status, undefined, requestId);
  return { contact: body.data as CreatedContact, requestId };
}

export async function updateContact(id: string, input: UpdateContactInput): Promise<{ contact: UpdatedContact; requestId: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/contacts/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  } catch {
    throw new ContactApiError(0, undefined, null);
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ContactApiError(response.status, code, requestId);
  }
  if (typeof body !== 'object' || body === null || !('data' in body)) throw new ContactApiError(response.status, undefined, requestId);
  return { contact: body.data as UpdatedContact, requestId };
}

async function changeContactStatus(id: string, action: 'deactivate' | 'reactivate'): Promise<ContactLifecycleResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/contacts/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  } catch {
    throw new ContactApiError(0, undefined, null);
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null || !('data' in body)) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    throw new ContactApiError(response.status, code, requestId);
  }
  return body.data as ContactLifecycleResult;
}

export function deactivateContact(id: string): Promise<ContactLifecycleResult> { return changeContactStatus(id, 'deactivate'); }
export function reactivateContact(id: string): Promise<ContactLifecycleResult> { return changeContactStatus(id, 'reactivate'); }
