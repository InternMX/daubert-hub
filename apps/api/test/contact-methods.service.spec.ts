import { describe, expect, it, vi } from 'vitest';
import { ContactMethodsService } from '../src/contact-methods/contact-methods.service';

const method = { id: '9007199254740993', contact_id: '121', type: 'CORREO', value: 'safe@example.test', status: 'INACTIVO', is_primary: false };

describe('ContactMethodsService', () => {
  it('changes a method lifecycle status without exposing payment-routing data', async () => {
    const changeStatus = vi.fn().mockResolvedValue(method);
    const service = new ContactMethodsService({ changeStatus } as never);
    await expect(service.deactivate(121, 'request-status')).resolves.toEqual({ data: { id: method.id, contactId: '121', type: 'CORREO', value: 'safe@example.test', status: 'INACTIVO', isPrimary: false } });
    expect(changeStatus).toHaveBeenCalledWith(121, 'INACTIVO', 'request-status');
  });

  it.each(['METHOD_ALREADY_INACTIVE', 'METHOD_ALREADY_ACTIVE', 'METHOD_STATUS_NOT_MANAGEABLE', 'CONTACT_NOT_ACTIVE', 'COMPANY_NOT_ACTIVE'])('maps %s to a safe conflict response', async (code) => {
    const service = new ContactMethodsService({ changeStatus: vi.fn().mockRejectedValue({ code }) } as never);
    await expect(service.deactivate(121, 'request-status')).rejects.toMatchObject({ status: 409, response: { code } });
  });

  it('returns a safe 404 for a missing method', async () => {
    const service = new ContactMethodsService({ changeStatus: vi.fn().mockResolvedValue(null) } as never);
    await expect(service.reactivate(121, 'request-status')).rejects.toMatchObject({ status: 404 });
  });
});
