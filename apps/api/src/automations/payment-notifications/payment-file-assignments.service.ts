import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';
import type { AuditIdentity } from '../../common/authenticated-request';
import type { PaymentFileAssignmentDto } from './dto/payment-file-assignment.dto';
import type { PaymentNotificationFileError } from './payment-notification-file-errors';
import { PaymentFileAssignmentsRepository } from './payment-file-assignments.repository';
import { isIsolatedN8nTestTarget, isProductionN8nTarget } from './payment-file-n8n-target';

const TEST_DATABASE = 'daubert_hub_test';
const PRODUCTION_DATABASE = 'daubert_global';

@Injectable()
export class PaymentFileAssignmentsService {
  constructor(private readonly repository: PaymentFileAssignmentsRepository, private readonly config: ConfigService<EnvironmentConfig, true>) {}

  isTestDatabase(): boolean { return this.config.get('database', { infer: true }).name === TEST_DATABASE; }
  isProductionDatabase(): boolean { return this.config.get('database', { infer: true }).name === PRODUCTION_DATABASE; }

  // The new tables are queried only where the migrations are known to be installed: always in the TEST database; in PRODUCTION only once the
  // independent production flag is on (migrations 015-017 applied). With the flag off the production Hub behaves exactly as before.
  isOperational(): boolean {
    return this.isTestDatabase() || (this.isProductionDatabase() && this.config.get('paymentFileAssignmentsProdEnabled', { infer: true }) === true);
  }

  // Each environment honours ONLY its own flag: a TEST flag never enables PRODUCTION and a PRODUCTION flag never enables TEST.
  isEnabled(): boolean {
    if (this.isTestDatabase()) return this.config.get('paymentFileAssignmentsTestEnabled', { infer: true }) === true;
    if (this.isProductionDatabase()) return this.config.get('paymentFileAssignmentsProdEnabled', { infer: true }) === true;
    return false;
  }

  // The n8n integration is effective only when ALL of these hold: TEST database, point assignments enabled, the READY flag and
  // a reprocess webhook that targets the isolated n8n TEST origin (never the shared/production n8n). The database function
  // (migration 014) is still consulted on every dispatch; this only decides whether it may authorize a reprocess.
  isN8nReady(): boolean {
    if (!this.isEnabled()) return false;
    const webhooks = this.config.get('paymentNotificationsWebhooks', { infer: true });
    // The existing server-to-server token must be configured as well: without it the dispatch could not authenticate.
    if (!webhooks?.webhookToken) return false;
    if (this.isProductionDatabase()) {
      // PRODUCTION: its own READY flag and its own exact webhook target; nothing from the TEST configuration is consulted.
      return this.config.get('paymentFileAssignmentsProdN8nReady', { infer: true }) === true
        && isProductionN8nTarget(webhooks.reprocessWebhookUrl, this.config.get('paymentFileAssignmentsProdN8nOrigin', { infer: true }));
    }
    if (this.config.get('paymentFileAssignmentsN8nReady', { infer: true }) !== true) return false;
    return isIsolatedN8nTestTarget(webhooks.reprocessWebhookUrl, this.config.get('paymentFileAssignmentsN8nTestOrigin', { infer: true }));
  }

  async describe(correoId: string, errors: PaymentNotificationFileError[]) {
    return this.repository.describe(correoId, errors, this.isEnabled(), this.isOperational(), this.isN8nReady());
  }

  async mutate(correoId: string, fileId: string, input: PaymentFileAssignmentDto, requestId: string, identity: AuditIdentity) {
    if (!this.isEnabled() || !identity.userId) throw new ForbiddenException({ code: 'POINT_ASSIGNMENTS_DISABLED', message: 'La asignación puntual no está habilitada para este entorno.' });
    return { data: await this.repository.mutate(correoId, fileId, input, requestId, identity) };
  }

  async reprocessBlockedCorreoIds(ids: string[]) { return this.isOperational() ? this.repository.reprocessBlockedCorreoIds(ids, this.isN8nReady()) : []; }
  protectReprocess<T>(correoId: string, requestId: string, identity: AuditIdentity, dispatch: () => Promise<T>) {
    if (!this.isOperational()) return dispatch();
    return this.repository.protectReprocess(correoId, requestId, identity, dispatch, this.isN8nReady());
  }
}
