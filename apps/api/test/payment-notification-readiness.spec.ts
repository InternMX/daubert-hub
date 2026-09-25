import { describe, expect, it } from 'vitest';
import { evaluatePaymentNotificationReadiness } from '../src/payment-notification-settings/payment-notification-readiness';

const complete = { dropboxPath: 'FLETES/TRANSPORTES KARINA', processesPaymentReceipts: true, hasOperableParaRecipient: true };

describe('evaluatePaymentNotificationReadiness', () => {
  it('is ready when path, processing and a PARA recipient are all present', () => {
    expect(evaluatePaymentNotificationReadiness(complete)).toEqual({ ready: true, missingRequirements: [] });
  });

  it('reports DROPBOX_PATH_REQUIRED when the path is missing or blank', () => {
    expect(evaluatePaymentNotificationReadiness({ ...complete, dropboxPath: null })).toEqual({ ready: false, missingRequirements: ['DROPBOX_PATH_REQUIRED'] });
    expect(evaluatePaymentNotificationReadiness({ ...complete, dropboxPath: '  ' }).missingRequirements).toEqual(['DROPBOX_PATH_REQUIRED']);
  });

  it('reports PAYMENT_PROCESSING_REQUIRED when processing is off', () => {
    expect(evaluatePaymentNotificationReadiness({ ...complete, processesPaymentReceipts: false })).toEqual({ ready: false, missingRequirements: ['PAYMENT_PROCESSING_REQUIRED'] });
  });

  it('reports PAYMENT_RECIPIENT_PARA_REQUIRED when there is no operable PARA recipient (CC/CCO only, inactive contact/method, non-email, recibe=false all reduce to this flag)', () => {
    expect(evaluatePaymentNotificationReadiness({ ...complete, hasOperableParaRecipient: false })).toEqual({ ready: false, missingRequirements: ['PAYMENT_RECIPIENT_PARA_REQUIRED'] });
  });

  it('lists every missing requirement, in a stable order', () => {
    expect(evaluatePaymentNotificationReadiness({ dropboxPath: null, processesPaymentReceipts: false, hasOperableParaRecipient: false })).toEqual({
      ready: false,
      missingRequirements: ['DROPBOX_PATH_REQUIRED', 'PAYMENT_PROCESSING_REQUIRED', 'PAYMENT_RECIPIENT_PARA_REQUIRED']
    });
  });

  it('exposes only safe codes', () => {
    const { missingRequirements } = evaluatePaymentNotificationReadiness({ dropboxPath: null, processesPaymentReceipts: false, hasOperableParaRecipient: false });
    for (const code of missingRequirements) expect(code).toMatch(/^[A-Z_]+$/);
  });
});
