// Single backend source of truth for "is this company ready to have Payment Notifications
// activated". The Hub UI renders the codes it receives; it never recomputes readiness.

export type PaymentNotificationMissingRequirement =
  | 'DROPBOX_PATH_REQUIRED'
  | 'PAYMENT_PROCESSING_REQUIRED'
  | 'PAYMENT_RECIPIENT_PARA_REQUIRED';

export interface PaymentNotificationReadinessInput {
  dropboxPath: string | null;
  processesPaymentReceipts: boolean;
  // At least one ACTIVE contact with an ACTIVE CORREO method flagged recibe_notificacion_pago and
  // tipo_destinatario_pago = 'PARA'. es_principal is a different concept and is never a substitute.
  hasOperableParaRecipient: boolean;
}

export interface PaymentNotificationReadiness {
  ready: boolean;
  missingRequirements: PaymentNotificationMissingRequirement[];
}

export function evaluatePaymentNotificationReadiness(input: PaymentNotificationReadinessInput): PaymentNotificationReadiness {
  const missingRequirements: PaymentNotificationMissingRequirement[] = [];
  if (!input.dropboxPath || input.dropboxPath.trim() === '') missingRequirements.push('DROPBOX_PATH_REQUIRED');
  if (!input.processesPaymentReceipts) missingRequirements.push('PAYMENT_PROCESSING_REQUIRED');
  if (!input.hasOperableParaRecipient) missingRequirements.push('PAYMENT_RECIPIENT_PARA_REQUIRED');
  return { ready: missingRequirements.length === 0, missingRequirements };
}
