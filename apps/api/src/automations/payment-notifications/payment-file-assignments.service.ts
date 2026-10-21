import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';
import type { AuditIdentity } from '../../common/authenticated-request';
import type { PaymentFileAssignmentDto } from './dto/payment-file-assignment.dto';
import type { PaymentNotificationFileError } from './payment-notification-file-errors';
import { PaymentFileAssignmentsRepository } from './payment-file-assignments.repository';
import { isIsolatedN8nTestTarget } from './payment-file-n8n-target';

@Injectable()
export class PaymentFileAssignmentsService {
  constructor(private readonly repository: PaymentFileAssignmentsRepository, private readonly config: ConfigService<EnvironmentConfig, true>) {}

  // Outside the TEST database the new tables are never queried: migration 012 is not installed there.
  isTestDatabase(): boolean { return this.config.get('database', { infer: true }).name === 'daubert_hub_test'; }

  isEnabled(): boolean {
    return this.isTestDatabase()
      && this.config.get('paymentFileAssignmentsTestEnabled', { infer: true }) === true;
  }

  // The n8n integration is effective only when ALL of these hold: TEST database, point assignments enabled, the READY flag and
  // a reprocess webhook that targets the isolated n8n TEST origin (never the shared/production n8n). The database function
  // (migration 014) is still consulted on every dispatch; this only decides whether it may authorize a reprocess.
  isN8nReady(): boolean {
    if (!this.isEnabled() || this.config.get('paymentFileAssignmentsN8nReady', { infer: true }) !== true) return false;
    const webhooks = this.config.get('paymentNotificationsWebhooks', { infer: true });
    // The existing server-to-server token must be configured as well: without it the dispatch could not authenticate.
    if (!webhooks?.webhookToken) return false;
    return isIsolatedN8nTestTarget(webhooks.reprocessWebhookUrl, this.config.get('paymentFileAssignmentsN8nTestOrigin', { infer: true }));
  }

  async describe(correoId: string, errors: PaymentNotificationFileError[]) {
    return this.repository.describe(correoId, errors, this.isEnabled(), this.isTestDatabase(), this.isN8nReady());
  }

  async mutate(correoId: string, fileId: string, input: PaymentFileAssignmentDto, requestId: string, identity: AuditIdentity) {
    if (!this.isEnabled() || !identity.userId) throw new ForbiddenException({ code: 'POINT_ASSIGNMENTS_DISABLED', message: 'La asignación puntual no está habilitada para este entorno.' });
    return { data: await this.repository.mutate(correoId, fileId, input, requestId, identity) };
  }

  async reprocessBlockedCorreoIds(ids: string[]) { return this.isTestDatabase() ? this.repository.reprocessBlockedCorreoIds(ids, this.isN8nReady()) : []; }
  protectReprocess<T>(correoId: string, requestId: string, identity: AuditIdentity, dispatch: () => Promise<T>) {
    if (!this.isTestDatabase()) return dispatch();
    return this.repository.protectReprocess(correoId, requestId, identity, dispatch, this.isN8nReady());
  }
}
