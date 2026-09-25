import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditIdentity } from '../common/authenticated-request';
import type { UpdatePaymentNotificationSettingsDto } from './dto/update-payment-notification-settings.dto';
import { evaluatePaymentNotificationReadiness, type PaymentNotificationReadiness } from './payment-notification-readiness';
import { PaymentNotificationSettingsRepository, type PaymentNotificationSettingsRow } from './payment-notification-settings.repository';

export interface PaymentNotificationSettingsResponse {
  data: {
    companyId: string;
    dropboxPath: string | null;
    processesPaymentReceipts: boolean;
    notificationsActive: boolean;
    destinationPath: string | null;
    readiness: PaymentNotificationReadiness;
  };
}

// Structured domain error: HTTP 409 with a stable `code` and the same safe requirement codes the
// GET readiness exposes. No SQL or internal detail ever reaches the client.
export const PAYMENT_NOTIFICATIONS_NOT_READY = 'PAYMENT_NOTIFICATIONS_NOT_READY';

@Injectable()
export class PaymentNotificationSettingsService {
  constructor(private readonly repository: PaymentNotificationSettingsRepository) {}

  async get(companyId: string): Promise<PaymentNotificationSettingsResponse> {
    const row = await this.repository.find(companyId);
    if (!row) throw new NotFoundException('Empresa no encontrada.');
    return this.map(row);
  }

  async update(companyId: string, input: UpdatePaymentNotificationSettingsDto, requestId: string, identity: AuditIdentity): Promise<PaymentNotificationSettingsResponse> {
    if (input.processesPaymentReceipts === undefined && input.notificationsActive === undefined) {
      throw new BadRequestException('Proporciona al menos un campo para actualizar.');
    }
    const result = await this.repository.update(companyId, input, (row, next) => this.readinessFor(row, next.processesPaymentReceipts).ready, requestId, identity);
    if (result.status === 'NOT_FOUND') throw new NotFoundException('Empresa no encontrada.');
    if (result.status === 'NOT_READY') {
      const readiness = this.readinessFor(result.current, input.processesPaymentReceipts ?? result.current.processes_payment_receipts);
      throw new ConflictException({
        code: PAYMENT_NOTIFICATIONS_NOT_READY,
        message: 'La empresa aún no cumple los requisitos para activar las notificaciones de pago.',
        missingRequirements: readiness.missingRequirements
      });
    }
    return this.map(result.current);
  }

  private readinessFor(row: PaymentNotificationSettingsRow, processesPaymentReceipts: boolean): PaymentNotificationReadiness {
    return evaluatePaymentNotificationReadiness({
      dropboxPath: row.dropbox_path,
      processesPaymentReceipts,
      hasOperableParaRecipient: row.has_operable_para_recipient
    });
  }

  private map(row: PaymentNotificationSettingsRow): PaymentNotificationSettingsResponse {
    return {
      data: {
        companyId: row.company_id,
        dropboxPath: row.dropbox_path,
        processesPaymentReceipts: row.processes_payment_receipts,
        notificationsActive: row.notifications_active,
        // Only meaningful once a path exists; a company without ruta_dropbox exposes no destination.
        destinationPath: row.dropbox_path && row.destination_path ? row.destination_path : null,
        readiness: this.readinessFor(row, row.processes_payment_receipts)
      }
    };
  }
}
